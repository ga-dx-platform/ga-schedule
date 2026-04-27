# GA Schedule — Agent Guide

Gantt Chart project management app for GA team at Ajinomoto (Sri Ayudhaya Building).

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + Vanilla JS + Tailwind CSS (CDN) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email or magic link) |
| Host | GitHub Pages — single file `index.html` |
| Fonts | Noto Sans Thai + DM Mono (Google Fonts CDN) |

## File Structure

```
ga-schedule/
├── index.html        ← entire app (HTML + CSS + JS in one file)
├── README.md
├── docs/
│   ├── AGENT.md      ← this file
│   ├── CLAUDE.md     ← detailed context for Claude Code
│   ├── design.md     ← design system & tokens
│   └── schema.sql    ← Supabase table definitions
```

## Hard Rules

- **Single file only** — never split into separate JS/CSS files
- **Tailwind CDN** — do not set up a build process
- **Supabase JS CDN** — `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- **No frameworks** — no React, Vue, or Angular
- **Thai UI labels** — all user-facing text in Thai, code/comments in English
- **UTF-8 BOM on CSV export** — so Thai text opens correctly in Excel

## Environment Variables (inject at build or hardcode for GitHub Pages)

```js
const SUPABASE_URL  = 'https://xxxx.supabase.co'
const SUPABASE_ANON = 'your-anon-key'
```

## Features in Scope

### Core (Phase 1)
- [ ] Project CRUD (multi-project support)
- [ ] Task CRUD with WBS hierarchy (parent_id)
- [ ] Gantt chart (SVG, rendered in browser)
- [ ] Working days calculation (skip weekends)
- [ ] Thai holiday calendar integration

### Advanced (Phase 2)
- [ ] Dependency types: FS · SS · FF · SF
- [ ] Progress % rollup (bottom-up auto)
- [ ] Status: Not Started · In Progress · Completed · Cancelled
- [ ] Category: General · Develop · Test · Meeting
- [ ] Export CSV (UTF-8 BOM)

### Pro (Phase 3)
- [ ] Baseline snapshot & comparison
- [ ] Export PNG / PDF
- [ ] Email report (weekly summary)

## Supabase Tables (see docs/schema.sql)

- `projects` — project list
- `tasks` — task rows with parent_id for WBS
- `dependencies` — FS/SS/FF/SF links between tasks
- `baselines` — snapshot of tasks at a point in time
- `thai_holidays` — Thai public holiday calendar

## Design Tokens (see docs/design.md)

- Primary gradient: `#00F5AA → #3B00FF` (Neon Tide)
- Background: `#f5f7fc → #e6eaf5` (light gray)
- Navbar: `#0a0f1e → #0d1630` (dark navy)
- Glass cards: `rgba(255,255,255,.75)` + `backdrop-filter: blur(24px)`

## Do NOT

- Do not add a bundler (webpack, vite, rollup)
- Do not create multiple HTML files
- Do not use localStorage as primary storage (Supabase is the source of truth)
- Do not change the Neon Tide color palette without updating `design.md`
- Do not remove Thai language from UI labels
