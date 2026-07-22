-- ============================================================
-- 005 — Read-only share link (Tier 1)
-- ============================================================
-- Lets the owner hand out an unguessable link so someone (e.g. a manager) can
-- VIEW one project without an account, while everything stays locked down by
-- RLS (migration 004). Access is granted only through SECURITY DEFINER functions
-- that return data for the matching share_token and nothing else.
--
-- Run in the Supabase dashboard: SQL Editor -> New query -> Run. Idempotent.
-- Requires 004 to be applied first.

-- ── 1. Per-project share token (null = not shared) ───────────
alter table public.projects add column if not exists share_token uuid;
create index if not exists idx_projects_share_token on public.projects(share_token);

-- ── 2. Read-only accessors (bypass RLS, scoped to the token) ──
-- SECURITY DEFINER runs as the function owner, so it can read past RLS — but each
-- one only ever returns rows whose project.share_token matches the passed token.
-- A null/unknown token matches nothing.

create or replace function public.get_shared_project(p_token uuid)
returns table (id uuid, name text, description text)
language sql security definer stable
set search_path = public
as $$
  select id, name, description
  from public.projects
  where share_token = p_token
$$;

create or replace function public.get_shared_tasks(p_token uuid)
returns setof public.tasks
language sql security definer stable
set search_path = public
as $$
  select t.*
  from public.tasks t
  join public.projects p on p.id = t.project_id
  where p.share_token = p_token
$$;

create or replace function public.get_shared_deps(p_token uuid)
returns setof public.dependencies
language sql security definer stable
set search_path = public
as $$
  select d.*
  from public.dependencies d
  join public.projects p on p.id = d.project_id
  where p.share_token = p_token
$$;

create or replace function public.get_shared_logs(p_token uuid)
returns setof public.task_logs
language sql security definer stable
set search_path = public
as $$
  select l.*
  from public.task_logs l
  join public.projects p on p.id = l.project_id
  where p.share_token = p_token
$$;

-- ── 3. Allow viewers (even unauthenticated) to call them ─────
grant execute on function public.get_shared_project(uuid) to anon, authenticated;
grant execute on function public.get_shared_tasks(uuid)   to anon, authenticated;
grant execute on function public.get_shared_deps(uuid)    to anon, authenticated;
grant execute on function public.get_shared_logs(uuid)    to anon, authenticated;

-- To revoke a share link, just clear the token:
--   update public.projects set share_token = null where id = '<project-id>';
-- (or generate a new one from the app, which replaces the old link).
