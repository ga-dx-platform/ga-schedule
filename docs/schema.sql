-- ============================================================
-- GA Schedule — Supabase Schema
-- Project: ga-schedule
-- Stack: Supabase (PostgreSQL) + RLS
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROJECTS
-- ============================================================
create table public.projects (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  description   text,
  color         text default '#3B00FF',     -- project accent color
  created_by    uuid references auth.users(id) on delete cascade,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

comment on table public.projects is 'GA Schedule projects';

-- RLS
alter table public.projects enable row level security;

create policy "Users can view their own projects"
  on public.projects for select
  using (auth.uid() = created_by);

create policy "Users can create projects"
  on public.projects for insert
  with check (auth.uid() = created_by);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = created_by);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = created_by);

-- ============================================================
-- TASKS
-- ============================================================
create type public.task_type as enum ('task', 'milestone', 'parent');
create type public.task_status as enum ('Not Started', 'In Progress', 'Completed', 'Cancelled');
create type public.task_category as enum ('General', 'Develop', 'Test', 'Meeting');

create table public.tasks (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  parent_id       uuid references public.tasks(id) on delete cascade,  -- null = root level
  name            text not null,
  type            public.task_type default 'task',
  category        public.task_category default 'General',
  status          public.task_status default 'Not Started',
  start_date      date not null default current_date,
  duration_days   integer not null default 1 check (duration_days >= 1),
  progress_pct    integer not null default 0 check (progress_pct between 0 and 100),
  assignee        text,
  notes           text,
  sort_order      integer default 0,    -- for drag-and-drop reorder
  is_collapsed    boolean default false, -- client hint for collapsed parent
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

comment on table public.tasks is 'Tasks with WBS hierarchy (parent_id)';
comment on column public.tasks.parent_id is 'null = root level task/phase';
comment on column public.tasks.duration_days is 'Working days only (weekends excluded)';
comment on column public.tasks.progress_pct is 'For parent tasks this is calculated client-side from children';

-- Index for common queries
create index idx_tasks_project_id    on public.tasks(project_id);
create index idx_tasks_parent_id     on public.tasks(parent_id);
create index idx_tasks_sort_order    on public.tasks(project_id, sort_order);

-- RLS
alter table public.tasks enable row level security;

create policy "Users can view tasks in their projects"
  on public.tasks for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.created_by = auth.uid()
    )
  );

create policy "Users can insert tasks in their projects"
  on public.tasks for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.created_by = auth.uid()
    )
  );

create policy "Users can update tasks in their projects"
  on public.tasks for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.created_by = auth.uid()
    )
  );

create policy "Users can delete tasks in their projects"
  on public.tasks for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and p.created_by = auth.uid()
    )
  );

-- ============================================================
-- DEPENDENCIES
-- ============================================================
create type public.dep_type as enum ('FS', 'SS', 'FF', 'SF');

create table public.dependencies (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  from_task_id    uuid not null references public.tasks(id) on delete cascade,
  to_task_id      uuid not null references public.tasks(id) on delete cascade,
  dep_type        public.dep_type not null default 'FS',
  lag_days        integer default 0,   -- positive = delay, negative = overlap
  created_at      timestamptz default now(),

  -- Prevent duplicate links
  unique (from_task_id, to_task_id),
  -- Prevent self-reference
  check (from_task_id <> to_task_id)
);

comment on table public.dependencies is 'Task dependencies: FS=Finish-to-Start, SS=Start-to-Start, FF=Finish-to-Finish, SF=Start-to-Finish';
comment on column public.dependencies.lag_days is 'Positive = delay after constraint, Negative = overlap allowed';

create index idx_deps_project   on public.dependencies(project_id);
create index idx_deps_from_task on public.dependencies(from_task_id);
create index idx_deps_to_task   on public.dependencies(to_task_id);

-- RLS
alter table public.dependencies enable row level security;

create policy "Users can manage dependencies in their projects"
  on public.dependencies for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = dependencies.project_id
        and p.created_by = auth.uid()
    )
  );

-- ============================================================
-- BASELINES
-- ============================================================
create table public.baselines (
  id            uuid primary key default uuid_generate_v4(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,                        -- e.g. "Baseline v1 - Apr 2026"
  snapshot_json jsonb not null,                       -- full tasks array at time of snapshot
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now()
);

comment on table public.baselines is 'Point-in-time snapshots of project tasks for baseline comparison';
comment on column public.baselines.snapshot_json is 'Array of task objects: [{id, name, start_date, duration_days, progress_pct, ...}]';

create index idx_baselines_project on public.baselines(project_id);

-- RLS
alter table public.baselines enable row level security;

create policy "Users can manage baselines in their projects"
  on public.baselines for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = baselines.project_id
        and p.created_by = auth.uid()
    )
  );

-- ============================================================
-- THAI HOLIDAYS
-- ============================================================
create table public.thai_holidays (
  id      serial primary key,
  date    date not null unique,
  name    text not null,        -- ชื่อวันหยุด (Thai)
  year    integer generated always as (extract(year from date)::integer) stored
);

comment on table public.thai_holidays is 'Thai public holidays — used for working days calculation';

-- Index for fast lookup by year
create index idx_holidays_year on public.thai_holidays(year);
create index idx_holidays_date on public.thai_holidays(date);

-- RLS: holidays are public read, only service role can write
alter table public.thai_holidays enable row level security;

create policy "Anyone can read thai holidays"
  on public.thai_holidays for select
  using (true);

-- ============================================================
-- SEED: Thai Holidays 2026
-- (Add more years as needed)
-- ============================================================
insert into public.thai_holidays (date, name) values
  ('2026-01-01', 'วันขึ้นปีใหม่'),
  ('2026-01-13', 'วันหยุดชดเชยวันเด็กแห่งชาติ'),
  ('2026-02-05', 'วันมาฆบูชา'),
  ('2026-04-06', 'วันจักรี'),
  ('2026-04-13', 'วันสงกรานต์'),
  ('2026-04-14', 'วันสงกรานต์'),
  ('2026-04-15', 'วันสงกรานต์'),
  ('2026-05-01', 'วันแรงงานแห่งชาติ'),
  ('2026-05-04', 'วันฉัตรมงคล'),
  ('2026-05-05', 'วันมหาปีติ (วันหยุดชดเชย)'),
  ('2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'),
  ('2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10'),
  ('2026-08-12', 'วันแม่แห่งชาติ'),
  ('2026-10-13', 'วันคล้ายวันสวรรคต ร.9'),
  ('2026-10-23', 'วันปิยมหาราช'),
  ('2026-12-05', 'วันพ่อแห่งชาติ'),
  ('2026-12-10', 'วันรัฐธรรมนูญ'),
  ('2026-12-31', 'วันสิ้นปี');

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_projects
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger set_updated_at_tasks
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- HELPER VIEW: tasks with WBS path
-- ============================================================
create or replace view public.tasks_with_wbs as
with recursive wbs_cte as (
  -- Root tasks
  select
    id, project_id, parent_id, name, type, category, status,
    start_date, duration_days, progress_pct, assignee, sort_order,
    0 as depth,
    cast(row_number() over (partition by project_id order by sort_order) as text) as wbs_path
  from public.tasks
  where parent_id is null

  union all

  -- Child tasks
  select
    t.id, t.project_id, t.parent_id, t.name, t.type, t.category, t.status,
    t.start_date, t.duration_days, t.progress_pct, t.assignee, t.sort_order,
    w.depth + 1,
    w.wbs_path || '.' ||
      cast(row_number() over (partition by t.parent_id order by t.sort_order) as text)
  from public.tasks t
  join wbs_cte w on t.parent_id = w.id
)
select *, wbs_path as wbs from wbs_cte;

comment on view public.tasks_with_wbs is 'Tasks with calculated WBS number (e.g. 1, 1.1, 1.2, 2, 2.1)';
