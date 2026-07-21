-- Progress-log attachments (PDF / images)
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
--
-- Access model: this app uses anonymous auth and its existing policies (e.g.
-- task_logs_all) grant access to ANY signed-in user (auth.uid() is not null),
-- not by project ownership. These policies match that model so attachments work
-- the same way the rest of the app does.

-- 1. Store attachment metadata on each progress log.
--    Each element: { "path": "...", "name": "...", "type": "...", "size": 123 }
alter table public.task_logs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 1b. Allow editing a progress log (note / progress / attachments). The original
--     task_logs policies only covered select/insert/delete, so an UPDATE (used
--     when editing a log or attaching files) needs its own policy.
drop policy if exists "task_logs_update" on public.task_logs;
create policy "task_logs_update" on public.task_logs for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- 2. Private Storage bucket that holds the actual files.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- 3. Storage access for the bucket: any signed-in user, matching task_logs_all.
--    (Object path is `<project_id>/<log_id>/<file>`.)
drop policy if exists "task_attach_select" on storage.objects;
create policy "task_attach_select" on storage.objects for select to authenticated
using (bucket_id = 'task-attachments' and auth.uid() is not null);

drop policy if exists "task_attach_insert" on storage.objects;
create policy "task_attach_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'task-attachments' and auth.uid() is not null);

drop policy if exists "task_attach_delete" on storage.objects;
create policy "task_attach_delete" on storage.objects for delete to authenticated
using (bucket_id = 'task-attachments' and auth.uid() is not null);
