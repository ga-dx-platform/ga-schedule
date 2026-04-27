# GA Schedule

> Gantt Chart Project Management · GA Team · Ajinomoto Thailand

![Design System](docs/preview-neontide.png)

## Overview

ระบบ Gantt Chart สำหรับทีม General Affairs (GA) ใช้วางแผนและติดตามโปรเจกต์ภายใน  
รองรับ Task hierarchy (WBS), Dependency types (FS/SS/FF/SF), Progress rollup, Baseline comparison

## Tech Stack

| | |
|--|--|
| **Frontend** | HTML + Vanilla JS (single file) |
| **Styling** | Tailwind CSS CDN + Custom CSS Variables |
| **Database** | Supabase (PostgreSQL + RLS) |
| **Auth** | Supabase Auth |
| **Hosting** | GitHub Pages |
| **Fonts** | Noto Sans Thai + DM Mono |

## Features

### Phase 1 — Core ✅
- Multi-project support
- Task CRUD with WBS hierarchy (parent/child)
- Gantt Chart (SVG, interactive)
- Working days calculation (skip weekends + Thai holidays)
- Progress % with auto rollup for parent tasks

### Phase 2 — Advanced
- Dependency types: **FS · SS · FF · SF**
- Status: Not Started · In Progress · Completed · Cancelled
- Category: General · Develop · Test · Meeting
- Export **CSV** (UTF-8 BOM สำหรับ Excel ภาษาไทย)

### Phase 3 — Pro
- Baseline snapshot & comparison
- Export **PNG / PDF**
- Collapse/expand WBS groups
- Thai holiday calendar

## Design System

**Neon Tide Palette** — `#00F5AA → #3B00FF` on Light Glass Background

| Token | Value |
|-------|-------|
| Primary gradient | `#00F5AA → #3B00FF` |
| Background | `#f5f7fc → #e6eaf5` |
| Navbar | `#0a0f1e → #0d1630` |
| Font | Noto Sans Thai + DM Mono |

See [`docs/design.md`](docs/design.md) for full design system documentation.

## Quick Start

### 1. Clone repo

```bash
git clone https://github.com/ga-dx-platform/ga-schedule.git
cd ga-schedule
```

### 2. Setup Supabase

1. สร้าง project ใหม่ใน [Supabase](https://supabase.com)
2. รัน SQL จาก `docs/schema.sql` ใน SQL Editor
3. Copy `Project URL` และ `anon key`

### 3. Configure

เปิด `index.html` และแก้ไข:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co'
const SUPABASE_ANON = 'YOUR_ANON_KEY'
```

### 4. Run locally

```bash
# ใช้ Live Server extension ใน VS Code
# หรือ
npx serve .
```

เปิด `http://localhost:3000`

### 5. Deploy

Push ขึ้น `main` branch → GitHub Pages deploy อัตโนมัติ

## File Structure

```
ga-schedule/
├── index.html          ← entire app (HTML + CSS + JS)
├── README.md
└── docs/
    ├── AGENT.md        ← guide for AI agents (Codex)
    ├── CLAUDE.md       ← guide for Claude Code
    ├── design.md       ← design system & color tokens
    └── schema.sql      ← Supabase PostgreSQL schema
```

## Related Projects

| Project | Description |
|---------|-------------|
| [ga-equipment-control](https://github.com/ga-dx-platform/ga-equipment-control) | ระบบยืม-คืนอุปกรณ์ |
| [doc-handover](https://github.com/mickyzek/doc-handover) | ระบบส่งมอบเอกสาร |

## Contributing

สำหรับทีม GA เท่านั้น — ติดต่อ Micky (GA Supervisor) เพื่อขอสิทธิ์

---

*GA DX Platform · Ajinomoto Thailand · Sri Ayudhaya Building*
