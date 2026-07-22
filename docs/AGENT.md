# GA Schedule — Agent Guide

Gantt Chart project management app for the GA team at Ajinomoto (Sri Ayudhaya Building).

> For the full, detailed context see [`CLAUDE.md`](CLAUDE.md). This file is the short version.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + Vanilla JS (no framework, no build step) |
| Styling | Custom CSS in `style.css` (CSS variables, light/dark themes) — **no Tailwind** |
| Charts | Chart.js (dashboard) + html2canvas / jsPDF (PNG/PDF export), all via CDN |
| Database | Supabase (PostgreSQL + RLS + Storage) |
| Auth | Supabase Auth — **anonymous sign-in** (`ensureAuth()`) |
| Host | GitHub Pages (static) |
| Fonts | Inter + Noto Sans Thai + DM Mono (Google Fonts CDN) |

## File Structure

```
ga-schedule/
├── index.html        ← markup, <head> CDN links, DOM for all views/modals
├── style.css         ← all styling (CSS variables, light + dark themes)
├── app.js            ← all application logic (loaded with defer)
├── README.md
└── docs/
    ├── AGENT.md      ← this file
    ├── CLAUDE.md     ← detailed context for Claude Code
    ├── design.md     ← design system & tokens
    ├── schema.sql    ← Supabase table definitions (fresh install)
    └── migrations/   ← incremental idempotent SQL migrations
```

## Hard Rules

- **Keep the three-file layout** — do not inline `style.css` / `app.js` back into `index.html`
- **No build step** — no webpack / vite / rollup / npm scripts
- **No CSS framework** — styling is plain CSS in `style.css` (no Tailwind)
- **No JS framework** — no React, Vue, Alpine, Angular
- **Thai UI labels** — all user-facing text in Thai; code & comments in English
- **Supabase is the source of truth** — never use `localStorage` as primary data store
  (it is only used for per-project UI settings and theme)
- **UTF-8 BOM on CSV export** — so Thai text opens correctly in Excel
- **Do not change the Neon Tide palette** (`--nt-teal` / `--nt-indigo`) without updating `design.md`

## Config (hardcoded for GitHub Pages)

```js
const SUPABASE_URL  = 'https://xxxx.supabase.co'
const SUPABASE_ANON = 'your-anon-key'   // public anon key; access is gated by RLS
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON) // client is named `db`
```

## Supabase Tables (see docs/schema.sql)

- `projects` — project list (`created_by = auth.uid()` drives RLS)
- `tasks` — task rows with `parent_id` for WBS hierarchy, plus `locked`, `sort_order`
- `dependencies` — FS / SS / FF / SF links (app UI creates FS & SS)
- `baselines` — point-in-time snapshots of tasks (`snapshot_json`)
- `task_logs` — timestamped progress notes per task, with `attachments` (jsonb) →
  files in the private `task-attachments` Storage bucket (see `migrations/001`)
- `thai_holidays` — Thai public holidays for working-day calculations

## Features

### Core
- Project CRUD (multi-project) · Task CRUD with WBS hierarchy
- Interactive SVG Gantt (drag/resize bars, drag-to-link)
- Working-days calculation (skip weekends + Thai holidays) — cascade only
- Progress % rollup (bottom-up auto for parents)

### Advanced
- Dependency cascade (FS) · Status & category (custom categories)
- Views: Gantt · Kanban · Calendar · Dashboard
- Import/Export: CSV (UTF-8 BOM) · JSON backup

### Pro
- Baseline snapshot & comparison · Export PNG / PDF
- Undo/redo · Progress logs with attachments

## Do NOT

- Do not add a bundler or a build process
- Do not split into more HTML files or re-merge into one file
- Do not add Tailwind or any CSS/JS framework
- Do not use `localStorage` as primary storage (Supabase is the source of truth)
- Do not change the Neon Tide palette without updating `design.md`
- Do not remove Thai language from UI labels
