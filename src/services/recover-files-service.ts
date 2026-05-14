import fs from "fs";
import path from "path";

import type { LovableSupabaseBackupConfig } from "..";

const BACKUP_FOLDER_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

export class RecoverFilesService {
    private readonly config: LovableSupabaseBackupConfig;

    constructor(config: LovableSupabaseBackupConfig) {
        this.config = config;
    }

    /**
     * Resolves `MIGRATIONS_FOLDER` into the directory containing `*.sql` files.
     * If `base/migrations` exists, it is used; otherwise `base` itself.
     */
    private getMigrationsDir(): string {
        const base = path.resolve(this.config.migrationsFolder);
        const nested = path.join(base, "migrations");
        if (
            fs.existsSync(nested) &&
            fs.statSync(nested).isDirectory()
        ) {
            return nested;
        }
        return base;
    }

    /**
     * Lists migration SQL files in the migrations folder, sorted ascending by filename (Supabase timestamp prefix order).
     *
     * @returns Absolute paths to each `.sql` file (for use with Postgres migration runners).
     */
    getMigrationsList(): string[] {
        const dir = this.getMigrationsDir();
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
            throw new Error(`Migrations directory not found: ${dir}`);
        }

        let direntsRoot: fs.Dirent[] = [];
        try {
            direntsRoot = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            throw new Error(
                `Failed to read migrations directory ${dir}: ${e instanceof Error ? e.message : String(e)
                }`,
            );
        }

        const sqlFiles = direntsRoot
            .filter((d) => d.isFile() && d.name.endsWith(".sql"))
            .map((d) => d.name);
        sqlFiles.sort((a, b) => a.localeCompare(b));

        return sqlFiles.map((n) => path.join(dir, n));
    }

    /**
     * Returns the newest backup run folder path (`repo/backups/YYYY-MM-DD_HH-mm-ss`, same convention as BackupFilesService).
     *
     * @throws {Error} When `backups` is missing or no matching run folder exists.
     */
    getLastBackupFolder(): string {
        const backupsDir = path.resolve(__dirname, "../../backups");
        if (!fs.existsSync(backupsDir)) {
            throw new Error(`Backups directory not found: ${backupsDir}`);
        }

        let dirents: fs.Dirent[] = [];
        try {
            dirents = fs.readdirSync(backupsDir, { withFileTypes: true });
        } catch (e) {
            throw new Error(
                `Failed to read backups directory: ${e instanceof Error ? e.message : String(e)
                }`,
            );
        }

        const backupNames = dirents
            .filter((d) => d.isDirectory() && BACKUP_FOLDER_NAME_RE.test(d.name))
            .map((d) => d.name);
        backupNames.sort((a, b) => b.localeCompare(a));

        if (backupNames.length === 0) {
            throw new Error(
                `No backup run folders (${BACKUP_FOLDER_NAME_RE}) under ${backupsDir}`,
            );
        }

        return path.join(backupsDir, backupNames[0]);
    }
}
