import fs from "fs";
import path from "path";
import { LovableSupabaseBackupConfig } from "..";

export class BackupFilesService {
    private readonly config: LovableSupabaseBackupConfig;
    private readonly backupsDir = path.resolve(__dirname, "../../backups");
    private activeBackupFolder: string | null = null;
    private previousBackupFoldersToKeep: number = 5;

    constructor(config: LovableSupabaseBackupConfig) {
        this.config = config;

        // Create the backups directory if it doesn't exist
        this.activeBackupFolder = this.newBackupFolder();

        // Remove previous backups
        this.removePreviousBackups();
    }

    /**
     * Writes the data of a table to a JSON file in the active backup folder.
     * Content is a single JSON array of row objects (PostgREST-shaped values).
     * @param tableName - Logical table or view name (used for the `.json` filename)
     * @param data - Rows to serialize
     * @returns `true` if the file was written successfully; `false` if there is no active folder or write failed
     */
    writeTableJson(tableName: string, data: any[]): boolean {
        if (this.activeBackupFolder == null) {
            return false;
        }
        try {
            const filePath = path.join(
                this.activeBackupFolder,
                `${this.safeFileBaseName(tableName)}.json`,
            );
            const content = JSON.stringify(data) + "\n";
            fs.writeFileSync(filePath, content, { encoding: "utf8" });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Creates a new backup folder with the current date and time.
     * The folder name is the current date and time in the format YYYY-MM-DD_HH-mm-ss.
     * The folder is created in the backupsDir.
     * The folder is returned.
     */
    private newBackupFolder(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const folderName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const fullPath = path.join(this.backupsDir, folderName);
        fs.mkdirSync(this.backupsDir, { recursive: true });
        fs.mkdirSync(fullPath, { recursive: true });
        return fullPath;
    }

    /**
     * Removes older backup run folders under {@link backupsDir}, keeping only the
     * {@link previousBackupFoldersToKeep} most recent (by folder name, which matches chronological order).
     * Only deletes directories whose names match `YYYY-MM-DD_HH-mm-ss`.
     */
    private removePreviousBackups(): void {
        const nameRe = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
        const keepCount = Math.max(1, this.previousBackupFoldersToKeep);

        if (!fs.existsSync(this.backupsDir)) {
            return;
        }

        let dirents: fs.Dirent[] = [];
        try {
            dirents = fs.readdirSync(this.backupsDir, { withFileTypes: true });
        } catch {
            return;
        }

        const backupNames = dirents
            .filter((d) => d.isDirectory() && nameRe.test(d.name))
            .map((d) => d.name);
        backupNames.sort((a, b) => b.localeCompare(a));

        const toRemove = backupNames.slice(keepCount);
        for (const name of toRemove) {
            try {
                this.removeDirSync(path.join(this.backupsDir, name));
            } catch {
                // Skip folders that cannot be removed
            }
        }
    }

    /**
     * Recursively deletes a directory and its contents.
     */
    private removeDirSync(dir: string): void {
        if (!fs.existsSync(dir)) {
            return;
        }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.removeDirSync(full);
            } else {
                fs.unlinkSync(full);
            }
        }
        fs.rmdirSync(dir);
    }

    /**
     * Turns a table name into a safe filename segment (no path separators or odd characters).
     * @param tableName - Raw table or view name
     * @returns Sanitized base name, or `"table"` if nothing usable remains
     */
    private safeFileBaseName(tableName: string): string {
        const base = tableName.replace(/[^a-zA-Z0-9_-]/g, "_");
        return base.length > 0 ? base : "table";
    }
}
