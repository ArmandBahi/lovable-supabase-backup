# API reference — `BackupsackupSupabaseService`

Module: [`src/services/supabase-service.ts`](../src/services/supabase-service.ts)

Small wrapper around [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) for one-shot CLI usage: **no persisted session**, **no auto token refresh**.

---

## Related configuration type

`BackupsackupSupabaseService` is constructed with **`LovableSupabaseBackupConfig`** (exported from [`src/index.ts`](../src/index.ts)).

| Field | Type | Used by this service |
|--------|------|----------------------|
| `url` | `string` | `createClient` base URL (e.g. `https://<ref>.supabase.co`) |
| `anonKey` | `string` | Supabase anon / publishable key |
| `userEmail` | `string` | Not read by `BackupsackupSupabaseService`; callers pass credentials to `signInUser` |
| `userPassword` | `string` | Same as above |
| `tablesListView` | `string` | Name of the Postgres **view** passed to `fetchTablesList()` |

Environment variables typically map to this type in the app entry (see `index.ts`).

---

## Type: `FetchTableOptions`

Optional arguments for `fetchTableRows`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `select` | `string` | `*` | PostgREST `select` expression |
| `limit` | `number` | — | Max rows when used **without** `offset` |
| `offset` | `number` | — | Used **with** `limit` to set a range (inclusive bounds via `.range`) |

---

## Class: `BackupsackupSupabaseService`

### Constructor

```ts
new BackupsackupSupabaseService(config: LovableSupabaseBackupConfig)
```

Creates an internal `SupabaseClient` with:

- `auth.persistSession`: `false`
- `auth.autoRefreshToken`: `false`

---

### `signInUser(email, password)`

```ts
signInUser(email: string, password: string): Promise<void>
```

| Parameter | Description |
|-----------|-------------|
| `email` | Database auth user email |
| `password` | Same user’s password |

**Behavior:** Calls `client.auth.signInWithPassword`. Subsequent `fetchTableRows` / `fetchTablesList` use this user’s JWT, so **RLS** applies as for that user.

**Throws:**

- The error returned by Supabase Auth when sign-in fails
- `Error` with message `signInWithPassword returned no session` if the response has no session

---

### `fetchTableRows(table, options?)`

```ts
fetchTableRows<T extends Record<string, unknown> = Record<string, unknown>>(
  table: string,
  options?: FetchTableOptions,
): Promise<T[]>
```

| Parameter | Description |
|-----------|-------------|
| `table` | Table or view name exposed on the PostgREST schema (usually `public`) |
| `options` | Optional `select`, `limit`, `offset` (see above) |

**Returns:** Array of row objects. Empty array if no rows.

**Throws:** PostgREST / Supabase client error on HTTP or query failure.

**Notes:**

- Requires policies that allow the **anon key** and/or the **signed-in user** to `SELECT` as appropriate.
- If both `limit` and `offset` are set, pagination uses `.range(offset, offset + limit - 1)`.

---

### `fetchTablesList()`

```ts
fetchTablesList(): Promise<string[]>
```

**Behavior:** Runs `fetchTableRows(this.config.tablesListView)` then maps each row with **`row.table_name`** to a string.

**Returns:** List of table names to iterate for backup.

**Throws:** Same as `fetchTableRows` if the view is missing, RLS blocks access, or rows lack `table_name`.

**Database contract:** The view named in `tablesListView` must expose a column **`table_name`** (see project `README.md` for an example view).

---

## Usage sketch

```ts
const supabase = new BackupsackupSupabaseService(config);
await supabase.signInUser(config.userEmail, config.userPassword);
const tables = await supabase.fetchTablesList();
for (const table of tables) {
  const rows = await supabase.fetchTableRows(table);
}
```
