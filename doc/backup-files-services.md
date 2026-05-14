# API reference — `BackupFilesService`

Module: [`src/services/backup-files-service.ts`](../src/services/backup-files-service.ts)

Handles **on-disk backup layout**: timestamped run folders under the package `backups` directory and **JSON** export per table.

---

## Related configuration type

Constructor accepts **`LovableSupabaseBackupConfig`** from [`src/index.ts`](../src/index.ts). The service **stores** this object for future use; current **JSON** write logic does not read individual fields from it.

---

## Backup layout

| Path | Description |
|------|-------------|
| `<packageRoot>/backups/` | Root backup directory (resolved from compiled output: `../../backups` relative to `dist/services`) |
| `<packageRoot>/backups/YYYY-MM-DD_HH-mm-ss/` | One folder per run (local date/time when the service is constructed) |

Each successful `writeTableJson` creates:

`<activeRunFolder>/<sanitizedTableName>.json`

File content is one **JSON array** of row objects (`[]` when there are no rows), UTF-8, compact `JSON.stringify` plus a trailing newline.

---

## Class: `BackupFilesService`

### Internal retention (not configurable via public API)

| Property | Default | Description |
|----------|---------|-------------|
| `previousBackupFoldersToKeep` | `5` | After creating a new run folder, older run folders matching `YYYY-MM-DD_HH-mm-ss` are deleted so that only the **`max(1, previousBackupFoldersToKeep)`** newest remain |

Folders that **do not** match that name pattern are **not** removed.

---

### Constructor

```ts
new BackupFilesService(config: LovableSupabaseBackupConfig)
```

**Side effects (order):**

1. **`newBackupFolder()`** — Ensures `backups/` exists, creates a new timestamped subdirectory, sets **`activeBackupFolder`** to its absolute path.
2. **`removePreviousBackups()`** — Prunes older timestamped run folders per retention rules above.

---

### `writeTableJson(tableName, data)`

```ts
writeTableJson(tableName: string, data: any[]): boolean
```

| Parameter | Description |
|-----------|-------------|
| `tableName` | Logical table name; used to build the filename after sanitization (non-alphanumeric → `_`, empty → `table`) |
| `data` | Row objects; serialized with `JSON.stringify` as one array |

**Returns:**

- `true` — File written successfully (UTF-8)
- `false` — No active backup folder, or any error during write (errors are swallowed; no exception)

---

## Private helpers (reference only)

These are **not** part of the public API; listed for behavior transparency.

| Method | Role |
|--------|------|
| `newBackupFolder()` | Create `YYYY-MM-DD_HH-mm-ss` directory under `backups/` |
| `removePreviousBackups()` | Delete old run folders beyond retention |
| `removeDirSync(dir)` | Recursive directory delete |
| `safeFileBaseName(tableName)` | Filename-safe segment |

---

## Usage sketch

```ts
const files = new BackupFilesService(config);
for (const table of tables) {
  const rows = await supabase.fetchTableRows(table);
  if (!files.writeTableJson(table, rows)) {
    console.error(`Failed to write ${table}`);
  }
}
```
