import * as fs from "fs/promises";
import * as path from "path";

import { Client } from "pg";

import type { LovableSupabaseBackupConfig } from "..";
import { createClient } from "@supabase/supabase-js";

/** Fields passed to `pg` for the recover Postgres target (often Supavisor in session mode). */
export type RecoverPgConnectionConfig = {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
};

export type DbUser = {
    id: string;
    email: string;
    full_name: string;
    roles: string[];
    created_at: string;
}

export class RecoverSupabaseService {
    private readonly config: LovableSupabaseBackupConfig;

    constructor(config: LovableSupabaseBackupConfig) {
        this.config = config;
    }

    /**
     * Builds a configuration object for `pg` from `RECOVER_PG_*` env-backed fields.
     *
     * Validated: `recoverPgPort` must parse to a TCP port in 1–65535.
     *
     * @returns Host, port, user, password, and database for the recover target
     *   (often Supavisor session mode, e.g. user `postgres.<POOLER_TENANT_ID>`).
     * @throws {Error} When `recoverPgPort` is not a valid port number.
     */
    getConnectionConfig(): RecoverPgConnectionConfig {
        const port = Number.parseInt(this.config.recoverPgPort, 10);
        if (!Number.isFinite(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid RECOVER_PG_PORT: ${this.config.recoverPgPort}`);
        }

        return {
            host: this.config.recoverPgHost,
            port,
            user: this.config.recoverPgUser,
            password: this.config.recoverPgPassword,
            database: this.config.recoverPgDatabase,
        };
    }

    /**
     * Checks that the recover database is reachable and accepts credentials.
     *
     * Opens a short-lived client, runs `SELECT 1`, then closes the connection.
     *
     * @returns `true` when connectivity and authentication succeed, `false` otherwise.
     */
    async assertConnection(): Promise<boolean> {
        const pgConfig = this.getConnectionConfig();
        const client = new Client(pgConfig);
        this.silencePgClientErrors(client);
        try {
            await client.connect();
            const res = await client.query<{ ok: number }>("SELECT 1 AS ok");
            return res.rows[0]?.ok === 1;
        } catch {
            return false;
        } finally {
            await client.end().catch(() => undefined);
        }
    }

    /**
     * Lists ordinary tables in `public` (not views or foreign tables).
     *
     * @returns Table names, ordered lexicographically.
     */
    async getTablesList(): Promise<string[]> {
        return this.withClient(async (client) => {
            const res = await client.query<{ tablename: string }>(
                `SELECT tablename
                    FROM pg_catalog.pg_tables
                    WHERE schemaname = $1
                    ORDER BY tablename`,
                ["public"],
            );
            return res.rows.map((r: any) => r.tablename);
        });
    }

    /**
     * Recreates the public schema.
     *
     * @returns The name of the archived public schema.
     */
    async recreatePublicSchema(): Promise<boolean> {
        return this.withClient(async (client) => {
            const archived = await this.chooseUniqueArchivedPublicName(client);
            const quoted = this.quoteArchivedSchemaIdent(archived);

            await client.query("BEGIN");
            try {
                await client.query(
                    `ALTER SCHEMA public RENAME TO ${quoted}`,
                );
                await client.query(
                    RecoverSupabaseService.sqlFreshPublicSchemaStatements(),
                );
                await client.query(
                    `DROP SCHEMA IF EXISTS ${quoted} CASCADE`,
                );
                await client.query("COMMIT");
                return true;
            } catch (err) {
                await client.query("ROLLBACK").catch(() => undefined);
                throw err;
            }
        });
    }

    /**
     * Drops the given tables in `public` in one statement (`CASCADE` clears FKs and dependent objects).
     * Use before {@link playMigrations} when migrations recreate the DDL from scratch.
     *
     * @param tables Unqualified table names (must match `[a-zA-Z_][a-zA-Z0-9_]*`).
     */
    async dropTables(tables: string[]): Promise<void> {
        if (tables.length === 0) {
            return;
        }
        for (const t of tables) {
            this.assertSafePgIdentifier(t);
        }
        const qualified = tables.map((t) => `public.${t}`).join(", ");
        const sql = `DROP TABLE IF EXISTS ${qualified} CASCADE`;
        await this.withClient((client) => client.query(sql));
    }

    /**
     * Runs each migration file in order (full file sent as one query; multiple statements per file are allowed by PostgreSQL).
     *
     * Uses **one short-lived connection per file** so Supavisor/poolers are less likely to terminate a long session mid-DDL.
     * For heavy migration runs, connecting **directly to Postgres** (bypass pooler) is still more reliable — see infra docs.
     *
     * @param migrations Paths to `.sql` files: absolute, or relative to `migrationsFolder` from config.
     */
    async playMigrations(migrations: string[]): Promise<void> {
        for (const migrationPath of migrations) {
            const resolved = this.resolveMigrationFilePath(migrationPath);
            const sql = await fs.readFile(resolved, "utf8");

            const success = await this.playMigrationSql(sql, resolved);
            if (!success) {
                console.error(`Migration failed (${resolved})`);
                process.exit(1);
            }
        }
    }

    /**
     * Create a user in the recover database.
     * @param email - The email of the user.
     * @param userId - The user ID.
     */
    async createRecoverDbAdminUser(email: string, userId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.query(
                `INSERT INTO public.profiles (user_id, full_name)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id) DO NOTHING`,
                [userId, email],
            );
        });
        await this.setUserAdmin(userId);
    }

    /**
     * Fait un insert dans la table user_roles pour mettre le user en admin.
     * @param userId - The user ID.
     */
    async setUserAdmin(userId: string): Promise<void> {
        await this.withClient(async (client) => {
            await client.query(
                `INSERT INTO public.user_roles (user_id, role)
                 VALUES ($1, 'admin'::public.app_role)
                 ON CONFLICT (user_id, role) DO NOTHING`,
                [userId],
            );
        });
    }

    /**
     * Fetch users that already exist in the recover target through the edge function.
     *
     * The function is called with an authenticated bearer token obtained from
     * `RECOVER_DB_USER` / `RECOVER_DB_PASSWORD` against `RECOVER_DB_URL`.
     *
     * @param functionUrl - Edge function URL (`.../functions/v1/list-users`)
     * @returns Existing users returned by the edge function payload (`{ users: [...] }`)
     */
    async fetchRecoverDbExistingUsers(functionUrl: string): Promise<DbUser[]> {
        if (
            !this.config.recoverDbUrl ||
            !this.config.recoverDbKey ||
            !this.config.recoverDbUser ||
            !this.config.recoverDbPassword
        ) {
            throw new Error(
                "Missing recover DB auth envs: RECOVER_DB_URL, RECOVER_DB_KEY, RECOVER_DB_USER, RECOVER_DB_PASSWORD",
            );
        }

        const authClient = createClient(this.config.recoverDbUrl, this.config.recoverDbKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
        const { data, error } = await authClient.auth.signInWithPassword({
            email: this.config.recoverDbUser,
            password: this.config.recoverDbPassword,
        });
        if (error) {
            throw error;
        }
        if (!data.session?.access_token) {
            throw new Error("Could not authenticate to fetch existing users");
        }

        const response = await fetch(functionUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${data.session.access_token}`,
                apikey: this.config.recoverDbKey,
            },
        });
        if (!response.ok) {
            const responseBody = await response.text();
            throw new Error(
                `recover list-users function failed (${response.status}): ${responseBody}`,
            );
        }

        const payload = (await response.json()) as {
            users?: DbUser[];
        };
        if (!Array.isArray(payload.users)) {
            throw new Error("recover list-users function returned an invalid payload");
        }
        return payload.users;
    }

    /**
     * Uses de RECOVER_DB_CREATE_USER_FUNCTION_URL to create the users.
     * The function is called with an authenticated bearer token obtained from
     * `RECOVER_DB_USER` / `RECOVER_DB_PASSWORD` against `RECOVER_DB_URL`.
     * @param functionUrl - Edge function URL (`.../functions/v1/create-user`)
     * @param users - The users to create.
     */
    async createRecoverDbUsers(functionUrl: string, users: Record<string, unknown>[]): Promise<void> {
        if (
            !this.config.recoverDbUrl ||
            !this.config.recoverDbKey ||
            !this.config.recoverDbUser ||
            !this.config.recoverDbPassword
        ) {
            throw new Error(
                "Missing recover DB auth envs: RECOVER_DB_URL, RECOVER_DB_KEY, RECOVER_DB_USER, RECOVER_DB_PASSWORD",
            );
        }

        const authClient = createClient(this.config.recoverDbUrl, this.config.recoverDbKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
        const { data, error } = await authClient.auth.signInWithPassword({
            email: this.config.recoverDbUser,
            password: this.config.recoverDbPassword,
        });
        if (error) {
            throw error;
        }
        if (!data.session?.access_token) {
            throw new Error("Could not authenticate to create users");
        }

        const allowedRoles = new Set([
            "manager",
            "chef_projet",
            "prospecteur",
            "teleprospecteur",
            "support",
        ]);

        for (const user of users) {
            const email = typeof user.email === "string" ? user.email.trim() : "";
            if (!email) {
                console.warn("Skipping user creation: missing email", user);
                continue;
            }

            const fullName = typeof user.full_name === "string" && user.full_name.trim().length > 0
                ? user.full_name.trim()
                : email;

            const rawRoles = Array.isArray(user.roles)
                ? user.roles.filter((role): role is string => typeof role === "string")
                : [];
            const role = rawRoles.find((r) => allowedRoles.has(r)) ?? "support";

            // Password is required by the edge function contract; user will be forced to change it.
            const tempPassword = `Tmp#${Math.random().toString(36).slice(2, 10)}A1!`;

            const response = await fetch(functionUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${data.session.access_token}`,
                    apikey: this.config.recoverDbKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email,
                    password: tempPassword,
                    full_name: fullName,
                    role,
                }),
            });

            if (!response.ok) {
                const responseBody = await response.text();
                throw new Error(
                    `recover create-user function failed for ${email} (${response.status}): ${responseBody}`,
                );
            }
        }
    }

    /**
     * Sync users from backup to the recover database by using edge functions.
     *
     * Flow:
     * 1) list existing users in recover DB
     * 2) compute users missing by email
     * 3) create only missing users
     *
     * @param listUsersFunctionUrl - Edge function URL (`.../functions/v1/list-users`)
     * @param createUserFunctionUrl - Edge function URL (`.../functions/v1/create-user`)
     * @param backupUsers - Users loaded from `users.json`
     * @returns Counts for logging/observability
     */
    async syncRecoverDbUsers(
        listUsersFunctionUrl: string,
        createUserFunctionUrl: string,
        backupUsers: Record<string, unknown>[],
    ): Promise<DbUser[]> {
        const usersInDatabase = await this.fetchRecoverDbExistingUsers(listUsersFunctionUrl);
        console.log(`Found ${usersInDatabase.length} users in the recover database`);
        const usersToCreate = backupUsers.filter(
            (user) =>
                !usersInDatabase.some(
                    (existingUser) => existingUser.email === user.email,
                ),
        );
        console.log(`Found ${usersToCreate.length} users to create`);
        await this.createRecoverDbUsers(createUserFunctionUrl, usersToCreate);
        console.log(`Created ${usersToCreate.length} users in the recover database`);

        // Redo a fetch to get the definitive users in the database
        return await this.fetchRecoverDbExistingUsers(listUsersFunctionUrl);

    }

    /**
     * Build an ID mapping from backup users to recover DB users, matched by email.
     *
     * Result format:
     * - key: backup user id
     * - value: recover database user id
     */
    buildRecoverUserIdMapping(
        backupUsers: Record<string, unknown>[],
        usersInDatabase: DbUser[],
    ): Record<string, string> {
        const recoverIdByEmail = new Map<string, string>();
        for (const user of usersInDatabase) {
            const email = user.email.trim().toLowerCase();
            if (!email) {
                continue;
            }
            recoverIdByEmail.set(email, user.id);
        }

        const mapping: Record<string, string> = {};
        for (const backupUser of backupUsers) {
            const backupId = typeof backupUser.id === "string" ? backupUser.id : "";
            const backupEmail = typeof backupUser.email === "string"
                ? backupUser.email.trim().toLowerCase()
                : "";
            if (!backupId || !backupEmail) {
                continue;
            }

            const recoverId = recoverIdByEmail.get(backupEmail);
            if (!recoverId) {
                continue;
            }
            mapping[backupId] = recoverId;
        }

        return mapping;
    }

    /**
     * Plays a migration SQL statement.
     *
     * @param sql - The SQL statement to play.
     * @param resolved - The resolved path to the migration file.
     * @returns `true` if the migration succeeded, `false` otherwise.
     */
    private async playMigrationSql(sql: string, resolved: string): Promise<boolean> {
        return await this.withClient(async (client) => {
            try {
                await client.query(sql);
                return true;
            } catch (err) {
                console.info(`SQL Statement failed, trying without inserts: ${resolved}`);

                // Essaye en passant par cleanSqlStatements
                const cleanSql = this.cleanSqlStatements(sql);
                try {
                    await client.query(cleanSql);
                    return true;
                } catch (err2) {
                    const detail =
                        err instanceof Error ? err.message : String(err);
                    throw new Error(
                        `Migration failed (${resolved}): ${detail}`,
                    );
                }
            }
        });
    }

    /**
     * Asserts that the provided string is a safe PostgreSQL identifier (e.g., table or column name).
     * Throws an error if the string does not conform to allowed PostgreSQL identifier syntax.
     *
     * @param name - The identifier to check.
     * @throws {Error} If the identifier is not safe for use as a PostgreSQL identifier.
     */
    private assertSafePgIdentifier(name: string): void {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            throw new Error(`Invalid PostgreSQL identifier: ${name}`);
        }
    }

    /**
     * Resolves a migration file path. If the input path is absolute, returns it as-is.
     * If the input path is relative, resolves it relative to the migrationsFolder in the config.
     *
     * @param filePath - The path to the migration SQL file (absolute or relative).
     * @returns The absolute path to the migration file.
     */
    private resolveMigrationFilePath(filePath: string): string {
        return path.isAbsolute(filePath)
            ? filePath
            : path.resolve(this.config.migrationsFolder, filePath);
    }

    /**
     * Opens a PostgreSQL client, executes the provided function with the client, and ensures cleanup.
     * Handles connecting and disconnecting to the database, guaranteeing closure even on error.
     *
     * @template T The return type of the provided function.
     * @param fn - The async function to execute, receiving a connected PostgreSQL client.
     * @returns The result of the executed function.
     */
    private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
        const client = new Client(this.getConnectionConfig());
        this.silencePgClientErrors(client);
        await client.connect();
        try {
            return await fn(client);
        } finally {
            await client.end().catch(() => undefined);
        }
    }

    /**
     * Avoids crashing the process when the pooler closes the TCP session asynchronously (`error` event on `Client`).
     */
    private silencePgClientErrors(client: Client): void {
        client.on("error", () => undefined);
    }

    /**
     * Same date layout as BackupFilesService folder names (`YYYY-MM-DD_HH-mm-ss`),
     * plus `_mmm` milliseconds to reduce collisions on scripted reruns.
     */
    private archivedPublicSchemaNameCandidate(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const ms = String(now.getMilliseconds()).padStart(3, "0");
        return `public_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_${ms}`;
    }

    /**
     * Chooses a unique archived public schema name.
     *
     * @param client - The PostgreSQL client.
     * @returns The unique archived public schema name.
     */
    private async chooseUniqueArchivedPublicName(client: Client): Promise<string> {
        const base = this.archivedPublicSchemaNameCandidate();
        for (let n = 0; n < 50; n++) {
            const tryName = n === 0 ? base : `${base}_dup${n}`;
            this.assertArchivedSchemaNameTrusted(tryName);
            const res = await client.query<{ cnt: string }>(
                `SELECT COUNT(*)::text AS cnt FROM pg_catalog.pg_namespace WHERE nspname = $1`,
                [tryName],
            );
            if (res.rows[0]?.cnt === "0") {
                return tryName;
            }
        }
        throw new Error(
            "could not allocate a unique archive schema name (too many collisions)",
        );
    }

    /** 
     * Validates names we invent so quoted identifiers cannot break out (SQL injection barrier). 
     *
     * @param name - The name to validate.
     * @throws {Error} If the name is not valid.
     */
    private assertArchivedSchemaNameTrusted(name: string): void {
        if (
            name.length === 0 ||
            name.length > 63 ||
            !/^public_[A-Za-z0-9_-]+$/.test(name)
        ) {
            throw new Error(`Invalid archived public schema name: ${name}`);
        }
    }

    /**
     * Quotes an archived public schema name.
     *
     * @param name - The name to quote.
     * @returns The quoted name.
     */
    private quoteArchivedSchemaIdent(name: string): string {
        this.assertArchivedSchemaNameTrusted(name);
        return `"${name.replace(/"/g, "\"\"")}"`;
    }

    /**
     * Recreates Supabase-ish defaults for empty `public` (roles `anon`, `authenticated`,
     * `service_role` must exist on the cluster).
     */
    private static sqlFreshPublicSchemaStatements(): string {
        return `
            -- SCHEMA: public

            -- DROP SCHEMA IF EXISTS public ;

            CREATE SCHEMA IF NOT EXISTS public
                AUTHORIZATION pg_database_owner;

            COMMENT ON SCHEMA public
                IS 'standard public schema';

            GRANT USAGE ON SCHEMA public TO PUBLIC;

            GRANT USAGE ON SCHEMA public TO anon;

            GRANT USAGE ON SCHEMA public TO authenticated;

            GRANT ALL ON SCHEMA public TO pg_database_owner;

            GRANT USAGE ON SCHEMA public TO postgres;

            GRANT USAGE ON SCHEMA public TO service_role;
            `.trim();
    }

    /**
     * Clean the SQL statements by removing the comments and the inserts.
     * @param sql - The SQL statements to clean.
     * @returns The cleaned SQL statements.
     */
    private cleanSqlStatements(sql: string): string {

        // remove the comments
        sql = sql.replace(/--.*$/gm, '');

        // process by statement
        const sqlStatements = sql.split(";");
        const cleanedSqlStatements: string[] = [];
        for (const sqlStatement of sqlStatements) {

            // remove the new lines
            let cleanedSqlStatement = sqlStatement;
            if (cleanedSqlStatement.trim().startsWith('INSERT INTO')) {
                break;
            }

            // add the statement to the list
            cleanedSqlStatements.push(cleanedSqlStatement);
        }

        return cleanedSqlStatements.join(";\n");
    }

    /**
     * Inserts backup rows into `public` tables in the given order.
     *
     * Temporarily sets **`session_replication_role = replica`** so foreign-key checks (and most
     * table triggers) are skipped for this session — inserts can run in **arbitrary table order**.
     * Requires sufficient privilege (typically **superuser** / role `postgres`). If `SET` fails,
     * reconnect with a direct Postgres superuser instead of the pooler role, or reorder rows by FK.
     *
     * @param datas One entry per table: validated table name and row objects (column set from first row).
     */
    public async importDataFromBackupDatas(
        datas: { table: string; data: Record<string, unknown>[] }[],
    ): Promise<void> {
        await this.withClient(async (client) => {
            try {
                // disable foreign key checks
                await client.query(
                    "SET session_replication_role = 'replica'",
                );
            } catch (e) {
                const hint =
                    e instanceof Error ? e.message : String(e);
                throw new Error(
                    `Cannot disable FK checks (session_replication_role=replica). Use a superuser-capable connection (e.g. user "postgres" on the direct DB port), not only the pooler role: ${hint}`,
                );
            }
            try {
                for (const { table, data } of datas) {
                    if (data.length === 0) continue;

                    this.assertSafePgIdentifier(table);
                    const columns = Object.keys(data[0])
                        .map(this.pgIdentifierQuote.bind(this))
                        .join(", ");

                    const valuesPlaceholders: string[] = [];
                    const valuesArray: unknown[] = [];

                    data.forEach((row) => {
                        const rowPlaceholders: string[] = [];
                        Object.values(row).forEach((value) => {
                            valuesArray.push(value);
                            rowPlaceholders.push(`$${valuesArray.length}`);
                        });
                        valuesPlaceholders.push(
                            `(${rowPlaceholders.join(", ")})`,
                        );
                    });

                    const insertSQL = `INSERT INTO public.${this.pgIdentifierQuote(table)} (${columns}) VALUES ${valuesPlaceholders.join(", ")}`;

                    try {
                        await client.query(insertSQL, valuesArray);
                    } catch (err) {
                        console.error('insertSQL', insertSQL);
                        console.error('valuesArray', valuesArray);
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        console.error(`Failed to import data into ${table}: ${msg}`);
                        throw err;
                    }
                }
            } finally {
                await client
                    .query("SET session_replication_role = 'origin'")
                    .catch(() => undefined);
            }
        });
    }

    /**
     * Simple identifier quoting for PostgreSQL (danger: does not escape double-quotes within names!)
     */
    private pgIdentifierQuote(name: string): string {
        return `"${name}"`;
    }

    /**
     * Execute the grants SQL.
     * @returns Promise<void>
     */
    public async executeGrants(): Promise<void> {
        const sql = `
            GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

            GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
            GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
            GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
        `;
        await this.withClient(async (client) => {
            try {
                await client.query(sql);
                console.log('Grants successfully executed.');
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`Failed to execute grants SQL: ${msg}`);
                throw err;
            }
        });
    }

    /**
     * Execute the post-recovery SQL.
     * @param sqlFilePath - The path to the SQL file to execute.
     * @returns Promise<void>
     */
    public async executePostRecoverySql(sqlFilePath: string): Promise<void> {
        // read the sql file
        const sql = await fs.readFile(sqlFilePath, "utf8");
        // execute the sql
        await this.withClient(async (client) => {
            try {
                await client.query(sql);
                console.log(`Executed post-recovery SQL: ${sqlFilePath}`);
            } catch (err) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                console.error(`Failed to execute post-recovery SQL: ${msg}`);
                throw err;
            }
        });
    }
}
