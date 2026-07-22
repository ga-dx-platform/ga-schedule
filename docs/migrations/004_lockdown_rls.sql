-- ============================================================
-- 004 — Lock down RLS to per-owner (created_by = auth.uid())
-- ============================================================
-- WHY: the deployed policies currently let ANY signed-in user (including a
-- brand-new anonymous one) read and write ALL data. Because the app is on public
-- GitHub Pages with a public anon key, that means anyone who opens the URL can
-- see and edit every project. This migration scopes access to the owner.
--
-- Run it in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (idempotent).
--
-- ⚠️ ORDER MATTERS — do these first, or you will lock yourself out:
--   1. Sign in to the app once with your email (Account modal) so a row exists
--      in auth.users for you.
--   2. In step 2 below, replace the email with the SAME email you signed in with.
--   3. Then run this whole script in the Supabase SQL Editor.
-- If anything goes wrong you are never truly locked out: you can always fix data
-- from this same SQL editor (it runs as a privileged role, bypassing RLS).

-- ── 1. New projects auto-fill created_by with the inserter ───
--    so the app's insert({name}) keeps working without code changes.
alter table public.projects alter column created_by set default auth.uid();

-- ── 2. Backfill existing rows (created_by is currently null) ──
--    👇 THIS IS THE ONLY LINE YOU EDIT — put your login email here:
update public.projects
set created_by = (select id from auth.users where email = 'mickyzek@gmail.com')
where created_by is null;

-- Fail loudly if the email was not found (nothing got assigned).
do $$
declare n int;
begin
  select count(*) into n from public.projects where created_by is null;
  if n > 0 then
    raise exception 'Still % project(s) with null created_by — check that owner_email matches a signed-in user', n;
  end if;
end$$;

-- ── 3. Drop EVERY existing policy on these tables ────────────
--    (we don't know the exact permissive policy names, so clear them all,
--     then recreate the correct per-owner set below.)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('projects','tasks','dependencies','baselines','task_logs')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end$$;

-- ── 4. Recreate per-owner policies ───────────────────────────
-- projects: owner only
create policy "projects_select" on public.projects for select
  using (auth.uid() = created_by);
create policy "projects_insert" on public.projects for insert
  with check (auth.uid() = created_by);
create policy "projects_update" on public.projects for update
  using (auth.uid() = created_by);
create policy "projects_delete" on public.projects for delete
  using (auth.uid() = created_by);

-- helper predicate reused below: the row's project belongs to the caller
-- tasks
create policy "tasks_all" on public.tasks for all
  using (exists (select 1 from public.projects p where p.id = tasks.project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = tasks.project_id and p.created_by = auth.uid()));

-- dependencies
create policy "deps_all" on public.dependencies for all
  using (exists (select 1 from public.projects p where p.id = dependencies.project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = dependencies.project_id and p.created_by = auth.uid()));

-- baselines
create policy "baselines_all" on public.baselines for all
  using (exists (select 1 from public.projects p where p.id = baselines.project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = baselines.project_id and p.created_by = auth.uid()));

-- task_logs
create policy "task_logs_all" on public.task_logs for all
  using (exists (select 1 from public.projects p where p.id = task_logs.project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = task_logs.project_id and p.created_by = auth.uid()));

-- ── 5. (Optional) block anonymous users from creating junk ───
-- With the above, anonymous visitors already see nothing and cannot touch your
-- data — but they COULD still create their own isolated projects. To stop even
-- that, disable Anonymous sign-ins in the dashboard AND gate the app behind a
-- login screen (app change), or replace projects_insert with a check that the
-- caller is not anonymous:
--
--   drop policy "projects_insert" on public.projects;
--   create policy "projects_insert" on public.projects for insert
--     with check (auth.uid() = created_by
--       and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
--
-- Leave this out if you still want the anonymous fallback to be usable.

-- NOTE: Storage bucket policies (task-attachments) are still "any authenticated
-- user" from migration 001. The bucket is private (signed URLs only), but if you
-- want attachments locked to owners too, tighten those separately.
