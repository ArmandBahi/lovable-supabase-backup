# lovable-supabase-backup

Small **Node** tool for **Lovable / Supabase** projects: it connects with your app credentials, lists your public tables, and saves each table as a **CSV** under `backups/<date-time>/`. Older runs are trimmed automatically (last few runs kept).

## What you need on Supabase

1. **A list of tables** exposed as a **view** with a column named **`table_name`** (see SQL below). Your `.env` must point to that view name (`TABLES_LIST_VIEW`).
2. **A database user** (email / password) that is allowed to **read** those tables under your **RLS** rules — same idea as a normal app user used for exports.
3. Your project **URL** and **anon (publishable) key** (as in the Lovable frontend env).

## Configure

```bash
cp .env.sample .env
```

Fill `.env`:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — from the Supabase / Lovable project  
- `SUPABASE_USER_EMAIL`, `SUPABASE_USER_PASSWORD` — user used for backup reads  
- `TABLES_LIST_VIEW` — name of the Postgres view (e.g. `exportable_tables`)

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

## More detail

API-style notes for the services: [`doc/supabase-service.md`](doc/supabase-service.md), [`doc/backup-files-services.md`](doc/backup-files-services.md).
