# GA Schedule — Claude Code Guide

## Project Context

**Owner:** Sekson Nilertram (Micky) — GA Supervisor, Ajinomoto Thailand (Sri Ayudhaya Building)  
**Team:** GA (General Affairs) Department  
**Purpose:** Internal Gantt Chart / Project Schedule tool — replacing manual Excel tracking  
**Related systems:** ga-equipment-control (equipment borrowing), doc-handover (document handover)

This is part of the **GA DX Platform** — a suite of internal web tools built on the same stack
(single HTML file · Vanilla JS · Tailwind CDN · Supabase · GitHub Pages).

---

## Stack & Constraints

```
Frontend   : HTML + Vanilla JS (NO frameworks)
Styling    : Tailwind CSS via CDN (no build step)
Database   : Supabase (PostgreSQL + RLS)
Auth       : Supabase Auth
Hosting    : GitHub Pages  →  mickyzek.github.io/ga-schedule  (or ga-dx-platform org)
Fonts      : Noto Sans Thai (body) + DM Mono (labels/mono) via Google Fonts CDN
```

**Critical constraint:** The entire app must live in `index.html`.  
No separate `.js` or `.css` files. GitHub Pages serves this as a static site.

---

## Supabase Config

```js
// Inject your project values here
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co'
const SUPABASE_ANON = 'YOUR_ANON_KEY'
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON)
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
font-family: 'Noto Sans Thai', sans-serif;   /* all UI text */
font-family: 'DM Mono', monospace;            /* labels, badges, codes */
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
thai_holidays   date, name, year
```

### Task Types
- `task` — regular task (has duration)
- `milestone` — zero-duration marker (diamond shape on Gantt)
- `parent` — phase/group (children roll up progress)

### Task Status
`Not Started` · `In Progress` · `Completed` · `Cancelled`

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

## Working Days Logic

```js
function addWorkDays(startDate, n) {
  // Skip weekends (getDay() === 0 || 6)
  // Skip thai_holidays table entries
  // Return end date after n working days
}
```

Thai holidays: query `thai_holidays` table or fallback to hardcoded list for current year.

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

## App Structure (inside index.html)

```
<head>
  Google Fonts (Noto Sans Thai + DM Mono)
  Tailwind CDN
  Supabase CDN
  <style> custom CSS variables & glass utilities </style>
</head>
<body>
  <!-- Background orbs (decorative) -->
  <!-- #app wrapper -->
    <!-- #navbar -->
    <!-- #toolbar -->
    <!-- #main -->
      <!-- #left  = task table (660px fixed width) -->
      <!-- #right = gantt chart (flex: 1, overflow-x: auto) -->
    <!-- #status-bar -->
  <!-- #task-modal (add/edit task) -->
  <!-- #dep-modal  (add/manage dependency links) -->
  <!-- #proj-modal (project switcher) -->
  <script> entire app logic </script>
</body>
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
// Always use .select() with explicit columns
// Always handle errors: const { data, error } = await supabase.from(...)
// Use .order('sort_order') for tasks
// Use RLS: tasks belong to projects, projects belong to users
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

- ❌ Do not split the app into multiple files
- ❌ Do not add npm/yarn/vite/webpack
- ❌ Do not use React, Vue, Alpine, or any JS framework
- ❌ Do not change `--nt-teal` or `--nt-indigo` values
- ❌ Do not use `localStorage` as the primary data store
- ❌ Do not hardcode task data (always load from Supabase)
- ❌ Do not write English in UI labels visible to users
