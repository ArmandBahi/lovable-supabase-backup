# lovable-supabase-backup

## Configuration

### Table list view

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