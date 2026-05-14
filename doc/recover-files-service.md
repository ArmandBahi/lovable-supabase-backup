# API reference — `RecoverFilesService`

Module: [`src/services/recover-files-service.ts`](../src/services/recover-files-service.ts)

Filesystem helpers for the **recover** flow (no database calls).

---

## `getMigrationsList(): string[]`

- Resolves the migrations directory: if `MIGRATIONS_FOLDER/migrations` exists, it is used; otherwise `MIGRATIONS_FOLDER` is treated as the folder that contains `*.sql` files (compatible with a `…/supabase` checkout or a `…/supabase/migrations` path).
- Returns **absolute paths** to every `.sql` file, sorted by filename (Supabase timestamp prefix order).

Throws if the directory is missing or unreadable.

---

## `getLastBackupFolder(): string`

Returns the **newest** run directory under `backups/` at the repo root (same naming convention as `BackupFilesService`: `YYYY-MM-DD_HH-mm-ss`).

Throws if `backups/` does not exist or no matching folder is present.

---

## `getLastBackupFiles(): string[]`

Lists every `*.json` file in the **newest** backup run folder (via `getLastBackupFolder()`). Returns absolute paths.

Throws with the same conditions as reading that folder if it is missing or unreadable.

---

## `parseBackupFile(file: string): Record<string, unknown>[]`

Reads a backup file: **one JSON document** that must be an **array** of row objects. Whitespace-only files yield `[]`. Invalid JSON or a non-array root throws an `Error` with a short message.

---

## `getLastBackupDatas(): { table: string; data: Record<string, unknown>[] }[]`

Combines `getLastBackupFiles()` with `parseBackupFile` for each path. The logical **table** name is the filename stem (basename without `.json`).
