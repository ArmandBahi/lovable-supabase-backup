# API reference — `BackupFilesService`

Module: [`src/services/backup-files-service.ts`](../src/services/backup-files-service.ts)

Handles **on-disk backup layout**: timestamped run folders under the package `backups` directory and **CSV** export per table.

---

## Related configuration type

Constructor accepts **`LovableSupabaseBackupConfig`** from [`src/index.ts`](../src/index.ts). The service **stores** this object for future use; current **CSV** logic does not read individual fields from it.

---

## Backup layout

| Path | Description |
|------|-------------|
| `<packageRoot>/backups/` | Root backup directory (resolved from compiled output: `../../backups` relative to `dist/services`) |
| `<packageRoot>/backups/YYYY-MM-DD_HH-mm-ss/` | One folder per run (local date/time when the service is constructed) |

Each successful `writeTableCsv` creates:

`<activeRunFolder>/<sanitizedTableName>.csv`

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

### `writeTableCsv(tableName, data)`

```ts
writeTableCsv(tableName: string, data: any[]): boolean
```

| Parameter | Description |
|-----------|-------------|
| `tableName` | Logical table name; used to build the filename after sanitization (non-alphanumeric → `_`, empty → `table`) |
| `data` | Row objects; serialized as CSV rows |

**Returns:**

- `true` — File written successfully (UTF-8)
- `false` — No active backup folder, or any error during write (errors are swallowed; no exception)

**CSV rules:**

- Header = union of all object keys in **first-seen order** across rows
- `null` / `undefined` → empty field
- Objects / arrays → `JSON.stringify` then CSV escaping
- RFC 4180-style quoting when needed (`"`, `,`, CR/LF)

---

## Private helpers (reference only)

These are **not** part of the public API; listed for behavior transparency.

| Method | Role |
|--------|------|
| `newBackupFolder()` | Create `YYYY-MM-DD_HH-mm-ss` directory under `backups/` |
| `removePreviousBackups()` | Delete old run folders beyond retention |
| `removeDirSync(dir)` | Recursive directory delete |
| `safeFileBaseName(tableName)` | Filename-safe segment |
| `cellToCsvField` / `csvEscapeField` / `rowsToCsv` | CSV serialization |

---

## Usage sketch

```ts
const files = new BackupFilesService(config);
for (const table of tables) {
  const rows = await supabase.fetchTableRows(table);
  if (!files.writeTableCsv(table, rows)) {
    console.error(`Failed to write ${table}`);
  }
}
```
