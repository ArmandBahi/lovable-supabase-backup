# lovable-supabase-backup

Small **Node** tool for **Lovable / Supabase** projects.

- **Backup mode** — connects with app credentials (like the front end), lists public tables, writes each table to a **CSV** under `backups/<date-time>/`. Older runs are trimmed automatically.
- **Recover mode** (self-hosted DR drills) — connects with **`pg`** to your recover Postgres, optionally resets **`public`**, then replays **`MIGRATIONS_FOLDER`** SQL in filename order.

## What you need on Supabase (backup mode)

1. **A list of tables** exposed as a **view** with a column named **`table_name`** (see SQL below). Your `.env` must point to that view name (`TABLES_LIST_VIEW`).
2. **A database user** (email / password) that is allowed to **read** those tables under your **RLS** rules — same idea as a normal app user used for exports.
3. Your project **URL** and **anon (publishable) key** (as in the Lovable frontend env).

## Configure

```bash
cp .env.sample .env
```

Fill `.env` (see also [`.env.sample`](./.env.sample)):

- **Modes:** set **`BACKUP_MODE=true`** for CSV export from the cloud project, or **`RECOVER_MODE=true`** for local Postgres replay (set the other to `false`). If both are `false`, `main` exits without work; if both are `true`, only backup runs (`index.ts` order).
- **Backup (production API):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD`, `TABLES_LIST_VIEW`
- **Recover (Postgres):** `MIGRATIONS_FOLDER` (e.g. path to your app’s `supabase` directory or its `migrations` folder), `RECOVER_PG_HOST`, `RECOVER_PG_PORT`, `RECOVER_PG_USER` (through **Supavisor** use `postgres.<POOLER_TENANT_ID>`), `RECOVER_PG_PASSWORD`, `RECOVER_PG_DATABASE`

`VITE_SUPABASE_PROJECT_ID` is optional for the script; keep it if you use it elsewhere.


## Table list view

In order to backup all the tables, we need to know the list of tables.


Ask lovable to create a view that returns the list of tables.
```sql
create or replace view public.exportable_tables as
select
  t.table_schema,
  t.table_name,
  t.table_type
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
order by t.table_name;
```

Grant **`select`** on this view (and **`select`** on the tables you export) to the roles / policies that match your backup user.

## Run

```bash
npm install
npm start
```

Backups appear in **`backups/`** at the root of this repo (one folder per run).

## Recover (self-hosted)

1. Start your **self-hosted** Supabase stack and note `POSTGRES_PORT`, `POSTGRES_PASSWORD`, and `POOLER_TENANT_ID` from `infra/supabase/.env`.
2. Set `RECOVER_MODE=true`, `BACKUP_MODE=false`, and the `RECOVER_PG_*` + `MIGRATIONS_FOLDER` variables (see above).
3. The script resolves migration paths, checks connectivity, runs **`recreatePublicSchema()`**, then **`playMigrations()`**.

Details, pooler vs direct Postgres, and limitations of the SQL retry path are documented in:

- [`doc/recover-supabase-service.md`](doc/recover-supabase-service.md)
- [`doc/recover-files-service.md`](doc/recover-files-service.md)

## More detail (services)

| Topic | Doc |
|-------|-----|
| Backup via Supabase JS + CSV writer | [`doc/backup-supabase-service.md`](doc/backup-supabase-service.md), [`doc/backup-files-services.md`](doc/backup-files-services.md) |
| Recover via `pg` + migrations | [`doc/recover-supabase-service.md`](doc/recover-supabase-service.md) |
| Recover file listing / backup folder | [`doc/recover-files-service.md`](doc/recover-files-service.md) |
