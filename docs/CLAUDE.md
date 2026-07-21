# GA Schedule — Claude Code Guide

## Project Context

**Owner:** Sekson Nilertram (Micky) — GA Supervisor, Ajinomoto Thailand (Sri Ayudhaya Building)  
**Team:** GA (General Affairs) Department  
**Purpose:** Internal Gantt Chart / Project Schedule tool — replacing manual Excel tracking  
**Related systems:** ga-equipment-control (equipment borrowing), doc-handover (document handover)

This is part of the **GA DX Platform** — a suite of internal web tools built on the same stack
(static site · Vanilla JS · custom CSS · Supabase · GitHub Pages).

---

## Stack & Constraints

```
Frontend   : HTML + Vanilla JS (NO frameworks, no build step)
Styling    : Custom CSS in style.css (CSS variables, no Tailwind)
Database   : Supabase (PostgreSQL + RLS + Storage)
Auth       : Supabase Auth (anonymous sign-in)
Hosting    : GitHub Pages  →  mickyzek.github.io/ga-schedule  (or ga-dx-platform org)
Fonts      : Inter (UI) + Noto Sans Thai (Thai text) + DM Mono (labels/mono), Google Fonts CDN
```

**File structure:** The app is split across three files, all served statically:

| File | Contents |
|------|----------|
| `index.html` | Markup, `<head>` CDN links, DOM for all views/modals |
| `style.css` | All styling (CSS variables, light/dark themes, components) |
| `app.js` | All application logic (loaded with `defer`) |

No bundler — files are linked directly. Keep this three-file layout; do not inline
everything back into `index.html`, and do not add a build tool.

**CDN dependencies** (loaded in `index.html` `<head>`): `@supabase/supabase-js`,
`chart.js` (dashboard charts), `html2canvas` + `jspdf` (PDF/image export),
Font Awesome (icons).

---

## Supabase Config

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co'
const SUPABASE_ANON = 'YOUR_ANON_KEY'
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)  // client is named `db`
// ensureAuth() signs in anonymously so RLS (projects.created_by = auth.uid()) applies
```

CDN import (place in `<head>`):
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

---

## Design System (summary — full details in docs/design.md)

### Neon Tide Palette
```css
--nt-teal:   #00F5AA   /* Develop bars, SS lines */
--nt-indigo: #3B00FF   /* General bars, primary buttons, FS lines */
--nt-grad:   linear-gradient(135deg, #00F5AA, #3B00FF)
```

### Backgrounds
```css
--bg-page: linear-gradient(160deg, #f5f7fc, #e6eaf5)  /* page, fixed */
--bg-nav:  linear-gradient(110deg, #0a0f1e, #0d1630)   /* navbar */
--glass:   rgba(255,255,255,.75) + backdrop-filter:blur(24px)
```

### Fonts
```css
font-family: 'Inter', sans-serif;    /* UI text (Noto Sans Thai covers Thai) */
font-family: 'DM Mono', monospace;   /* labels, badges, dates, codes */
```

### Key radius values
```css
--r-sm: 6px  --r-md: 10px  --r-lg: 14px  --r-xl: 20px
```

---

## Data Model (see docs/schema.sql for full DDL)

```
projects        id, name, description, created_by, created_at
tasks           id, project_id, parent_id, name, type, category,
                start_date, duration_days, progress_pct, status,
                assignee, sort_order, created_at, updated_at
dependencies    id, project_id, from_task_id, to_task_id, dep_type (FS|SS|FF|SF)
baselines       id, project_id, name, snapshot_json, created_at
task_logs       id, task_id, project_id, note, progress_pct, logged_by,
                attachments (jsonb), logged_at
thai_holidays   date, name, year
```

Progress logs (`task_logs`) store timestamped notes per task; `attachments` is a
jsonb array of `{path,name,type,size}` referencing files in the private
`task-attachments` Storage bucket. See `docs/migrations/001_log_attachments.sql`.

### Task Types
- `task` — regular task (has duration)
- `milestone` — zero-duration marker (diamond shape on Gantt)
- `parent` — phase/group (children roll up progress)

### Task Status
`Not Started` · `In Progress` · `Completed` · `Cancelled` · `On Hold` · `Delayed`

### Task Category → Gantt bar color
| Category | Bar gradient |
|----------|-------------|
| General | `#3B00FF → #5a20ff` |
| Develop | `#00b87a → #00F5AA` |
| Test | `#059669 → #10b981` |
| Meeting | `#c05621 → #d97706` |

### Dependency Types (FS/SS/FF/SF)
| Type | From point | To point | Arrow at |
|------|-----------|---------|----------|
| FS | from.end | to.start | to.start |
| SS | from.start | to.start | to.start |
| FF | from.end | to.end | to.end |
| SF | from.start | to.end | to.end |

---

## Working Days / Skip-Weekends Logic

A task's own end date is **always calendar-based**: `taskEnd(t)` = start + (duration − 1)
calendar days. Bars and manual drag/resize therefore land on any day, weekends included.

The **Skip Weekends** toggle (`state.skipWeekends`) affects **dependency cascade only** —
when a predecessor moves, `nextWorkingDayAfter()` pushes the successor's start off
non-working days, and `addWD()` (used for lag) counts working days instead of calendar days.

- `isNonWorkingDay(date)` — true for weekend days (`settings.weekendDays`, default `[0,6]`)
  or any date in the holiday set (`state.holidays` + `settings.holidays`).
- Calendar cache is rebuilt via `invalidateCalendarCache()` whenever settings/holidays change.

---

## Progress Rollup

Parent task `progress_pct` = average of all direct children (recursive).  
Display `(auto)` label next to % when it's a calculated value.

```js
function rollupProgress(taskId) {
  const children = tasks.filter(t => t.parent_id === taskId)
  if (!children.length) return tasks.find(t => t.id === taskId).progress_pct
  return Math.round(children.reduce((s, c) => s + rollupProgress(c.id), 0) / children.length)
}
```

---

## Gantt Rendering Approach

- Use **inline SVG** inside a `<div>` container (not Canvas)
- Day column width = `DAY_PX * zoom` (default `DAY_PX = 18`)
- Zoom levels: `0.25x` (Month) → `1x` (Day) → `2x` (Week)
- Weekend columns: light gray background `rgba(0,0,0,.025)`
- Today vertical line: `var(--red)` with gradient fade top/bottom
- Dependency arrows: curved `<path>` with `stroke-dasharray="5,3"`
- Type label on arrow: white rect + colored text in DM Mono

---

## CSV Export

Always include UTF-8 BOM for Thai Excel compatibility:
```js
const csv = '\uFEFF' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
```

Columns: `WBS · Task Name · Type · Category · Start · End · Duration · % · Status · Assignee`

---

## App Structure

```
index.html
  <head>
    Google Fonts (Inter + Noto Sans Thai + DM Mono)
    CDN scripts (Supabase, Chart.js, html2canvas, jsPDF, Font Awesome)
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <!-- #navbar / #toolbar -->
    <!-- #main: #left = task table · #right = gantt chart -->
    <!-- view containers: gantt · kanban · calendar · dashboard -->
    <!-- modals: task (with Progress Log tab) · dependency · project · settings -->
    <!-- #status-bar -->
    <script src="app.js" defer></script>
  </body>

style.css   — all styles, CSS variables, light + dark (body.dark-mode) themes
app.js      — all logic: state, Supabase I/O, render(), views, modals, export
```

---

## Coding Patterns to Follow

### State management
```js
let state = {
  projects: [],
  tasks: [],
  deps: [],
  currentProjectId: null,
  zoom: 1,
  collapsed: {},   // { taskId: true/false }
  editingTaskId: null,
}
```

### Render cycle
```
loadFromSupabase() → updateState() → render() → renderTaskList() + renderGantt()
```

### Supabase patterns
```js
// Client is `db` (not `supabase`)
// Always handle errors: const { data, error } = await db.from(...)
// Use .order('sort_order') for tasks
// RLS: tasks/logs belong to projects, projects belong to users (created_by = auth.uid())
// Any table hit by an UPDATE needs an explicit update RLS policy (RLS is enabled)
```

---

## Related GA DX Projects (for context)

| Repo | Description |
|------|-------------|
| `ga-equipment-control` | Equipment borrowing/returning system (Supabase, same stack) |
| `doc-handover` | Physical document handover with signature canvas |

Reuse patterns from these projects where possible — especially Supabase auth flow and modal patterns.

---

## What NOT to do

- ❌ Do not inline `style.css` / `app.js` back into `index.html` (keep the three-file layout)
- ❌ Do not add npm/yarn/vite/webpack or any build step
- ❌ Do not add Tailwind or a CSS framework (styling is plain CSS in `style.css`)
- ❌ Do not use React, Vue, Alpine, or any JS framework
- ❌ Do not change `--nt-teal` or `--nt-indigo` values
- ❌ Do not use `localStorage` as the primary data store
- ❌ Do not hardcode task data (always load from Supabase)
- ❌ Do not write English in UI labels visible to users
