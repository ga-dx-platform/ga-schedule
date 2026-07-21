-- Progress-log attachments (PDF / images)
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).

-- 1. Store attachment metadata on each progress log.
--    Each element: { "path": "...", "name": "...", "type": "...", "size": 123 }
alter table public.task_logs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 1b. Allow editing a progress log (note / progress / attachments). The
--     original task_logs policies only covered select/insert/delete, so without
--     this an UPDATE (used when editing a log or attaching files) is blocked.
drop policy if exists "task_logs_update" on public.task_logs;
create policy "task_logs_update" on public.task_logs for update
  using (exists (select 1 from public.projects p where p.id = task_logs.project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = task_logs.project_id and p.created_by = auth.uid()));

-- 2. Private Storage bucket that holds the actual files.
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- 3. Access is scoped to the owner of the project the file belongs to.
--    Object path is `<project_id>/<log_id>/<file>`, so the first folder is the
--    project id and we reuse the same ownership rule as the task_logs table.
drop policy if exists "task_attach_select" on storage.objects;
create policy "task_attach_select" on storage.objects for select to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select p.id::text from public.projects p where p.created_by = auth.uid()
  )
);

drop policy if exists "task_attach_insert" on storage.objects;
create policy "task_attach_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select p.id::text from public.projects p where p.created_by = auth.uid()
  )
);

drop policy if exists "task_attach_delete" on storage.objects;
create policy "task_attach_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select p.id::text from public.projects p where p.created_by = auth.uid()
  )
);
