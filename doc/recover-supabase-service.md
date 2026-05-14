# API reference — `RecoverSupabaseService`

Module: [`src/services/recover-supabase-service.ts`](../src/services/recover-supabase-service.ts)

PostgreSQL (`pg` driver) helper for **disaster-recovery / drills** against a **self-hosted** Supabase (or any Postgres). It does **not** use the Supabase HTTP API for DDL.

---

## Related configuration

`RecoverSupabaseService` is constructed with **`LovableSupabaseBackupConfig`** from [`src/index.ts`](../src/index.ts).

| Field | Maps from env | Role |
|--------|----------------|------|
| `migrationsFolder` | `MIGRATIONS_FOLDER` | Root for resolving migration file paths (see [`recover-files-service.md`](./recover-files-service.md)) |
| `recoverPgHost` | `RECOVER_PG_HOST` | Usually `127.0.0.1` when the DB port is published to the host |
| `recoverPgPort` | `RECOVER_PG_PORT` | Host port mapped from Docker (often Supavisor session port) |
| `recoverPgUser` | `RECOVER_PG_USER` | Through **Supavisor**: `postgres.<POOLER_TENANT_ID>` — *not* plain `postgres` |
| `recoverPgPassword` | `RECOVER_PG_PASSWORD` | `POSTGRES_PASSWORD` from the self-host `.env` |
| `recoverPgDatabase` | `RECOVER_PG_DATABASE` | Typically `postgres` |

### Pooler vs direct Postgres

- **Session mode (Supavisor)**: use the URL form documented by Supabase (`postgres.<tenant id>` user, port exposed as `POSTGRES_PORT`).
- **Heavy DDL**: large migrations may be more reliable with a **direct** connection to the `db` container (map its port, user `postgres`) — see [Supabase self-hosting — Accessing Postgres](https://supabase.com/docs/guides/self-hosting/docker#accessing-postgres).

---

## `getConnectionConfig()`

Builds a `pg` config object from `RECOVER_PG_*`. Throws if the port is not a valid TCP port.

---

## `assertConnection()`

Opens a short-lived client, runs `SELECT 1`. Returns `false` on failure (no throw) if connect/query fails.

---

## `getTablesList()`

Returns base table names in **`public`** from `pg_catalog.pg_tables` (ordered by name). Does not list views.

---

## `recreatePublicSchema()`

Runs in a **transaction**:

1. Picks a unique name `public_YYYY-MM-DD_HH-mm-ss_mmm` (suffix `_dupN` if needed).
2. `ALTER SCHEMA public RENAME TO "<that name>"` — everything that was in `public` (tables, enums, functions, …) moves into the renamed schema.
3. Applies `sqlFreshPublicSchemaStatements()` (see [Fresh `public` schema grants](#fresh-public-schema-grants)) to create a new **`public`** with Supabase-oriented grants (roles such as `anon`, `authenticated`, `service_role`, `supabase_admin`, `postgres`, `pg_database_owner`).
4. `DROP SCHEMA IF EXISTS "<that name>" CASCADE` — **removes the renamed schema** so the old DDL/data does **not** stay on disk as a long-lived archive. Net effect: **empty `public`**, previous objects are **deleted** (after the rename step, dropped in the same transaction).

Returns `true` on success. On error: `ROLLBACK`, then rethrows.

If you need to **keep** the renamed schema for forensics, remove or adjust step 4 in code before running a drill.

### Fresh `public` schema grants

The embedded SQL uses `CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION pg_database_owner`, default privileges for roles `postgres` and `supabase_admin`, etc. This mirrors common **Supabase Postgres** images; if roles are missing on a vanilla Postgres, statements may fail.

---

## `dropTables(tables: string[])`

`DROP TABLE IF EXISTS public.<name>, … CASCADE` for validated identifiers. Optional alternative when you do not use `recreatePublicSchema()`.

---

## `playMigrations(paths: string[])`

For each file (absolute path, or relative to `MIGRATIONS_FOLDER`):

1. Reads UTF-8 SQL.
2. Executes it with **`playMigrationSql`** — **one new `pg` connection per file** to reduce pooler timeouts.

### `playMigrationSql` — fallback when execution fails

1. Runs the file as a **single** `client.query(sql)` (PostgreSQL accepts multiple statements in one simple query).
2. If that throws, logs to the console and retries after `cleanSqlStatements(sql)`.

### `cleanSqlStatements` (limitations)

Used only on the **retry** path. It:

- Strips end-of-line `--` comments with a regex (can break SQL that contains `--` inside string literals).
- Splits on `;` (fragile for dollar-quoted bodies or semicolons inside strings).
- **Stops appending statements after the first line that starts with `INSERT INTO`**: anything after that `INSERT` in the same file is **not** executed on retry.

**Implication:** seed `INSERT`s (e.g. default `user_roles`) should usually run on the **first** attempt. If the first attempt fails for a reason that triggers retry, inserts may be skipped or partially skipped — fix the root error or split seeds into separate migration files.

---

## `importDataFromBackupDatas(datas)`

Bulk `INSERT` per table from in-memory row arrays. For the **whole** client connection:

1. Runs `SET session_replication_role = 'replica'` so **foreign keys are not checked** and inserts can run in any table order (also skips most user triggers).
2. Restores `SET session_replication_role = 'origin'` in a **`finally`** block.

If step 1 fails (common when the DB user is **not** a superuser), the method throws with a hint: use a **direct** Postgres connection as **`postgres`** on the `db` port, not only Supavisor’s pooler user.

---

## Internal helpers

| Helper | Purpose |
|--------|--------|
| `withClient` | Connect, run callback, always `end()` |
| `silencePgClientErrors` | Subscribes to `client.on('error')` so Supavisor async disconnects do not crash Node |

---

## See also

- [`recover-files-service.md`](./recover-files-service.md) — migration file listing, latest backup folder
- [`backup-supabase-service.md`](./backup-supabase-service.md) — production CSV export over the Supabase JS client
