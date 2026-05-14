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

    /**
     * Returns the paths to the backup files (JSON files) for the last backup folder.
     *
     * @returns The paths to the backup files.
     */
    getLastBackupFiles(): string[] {
        const lastBackupFolder = this.getLastBackupFolder();
        if (!fs.existsSync(lastBackupFolder)) {
            throw new Error(`Backup folder not found: ${lastBackupFolder}`);
        }

        let dirents: fs.Dirent[] = [];
        try {
            dirents = fs.readdirSync(lastBackupFolder, { withFileTypes: true });
        } catch (e) {
            throw new Error(
                `Failed to read backup folder: ${e instanceof Error ? e.message : String(e)}`
            );
        }

        const jsonFiles = dirents
            .filter((d) => d.isFile() && d.name.endsWith(".json"))
            .map((d) => path.join(lastBackupFolder, d.name));

        return jsonFiles;
    }

    /**
     * Parse a backup file (JSON array of row objects) and return the data.
     * @param file - The path to the backup file.
     * @returns The data from the backup file.
     */
    parseBackupFile(file: string): Record<string, unknown>[] {
        const content = fs.readFileSync(file, "utf-8").trim();
        if (content.length === 0) {
            return [];
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Invalid JSON in backup file ${file}: ${msg}`);
        }
        if (!Array.isArray(parsed)) {
            throw new Error(
                `Backup file ${file} must contain a JSON array of row objects`,
            );
        }
        return parsed as Record<string, unknown>[];
    }

    /**
     * Get the data from the last backup files.
     * @returns The data from the last backup files.
     */
    getLastBackupDatas(): { table: string, data: Record<string, unknown>[] }[] {
        const backupFiles = this.getLastBackupFiles();
        return backupFiles.map((filePath) => {
            // table name is file name without extension
            const fileName = path.basename(filePath, ".json");
            const data = this.parseBackupFile(filePath);
            return {
                table: fileName,
                data,
            };
        });
    }
}
