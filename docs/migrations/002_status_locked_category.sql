-- Task status values, locked flag, and free-text category.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
--
-- Brings an existing database in line with the app, which:
--   * uses two extra status values ('On Hold', 'Delayed'),
--   * lets a task be locked (excluded from cascade / drag / delete),
--   * allows user-defined categories (not just the original 4).

-- 1. Extend the task_status enum with the values the app already writes.
--    add value if not exists is a no-op when the value is already present.
do $$
begin
  alter type public.task_status add value if not exists 'On Hold';
  alter type public.task_status add value if not exists 'Delayed';
exception
  when undefined_object then
    -- status column is plain text (never an enum) — nothing to extend.
    null;
end$$;

-- 2. Lock flag used by the app (cascade skip, drag/delete guard).
alter table public.tasks
  add column if not exists locked boolean default false;

-- 3. Custom categories: the Settings panel lets users add their own category
--    names, so category must be free text rather than a fixed enum. This is a
--    no-op if the column is already text.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name = 'category' and data_type = 'USER-DEFINED'
  ) then
    alter table public.tasks alter column category type text using category::text;
  end if;
end$$;
