# GA Schedule — Design System

> **Neon Tide on Light Glass**  
> White–Gray Gradient · Glassmorphism · Noto Sans Thai · `#00F5AA → #3B00FF`

---

## Color Tokens

### Neon Tide Palette (Primary)

| Token | Value | Usage |
|-------|-------|-------|
| `--nt-teal` | `#00F5AA` | Develop bars, SS dep line, teal accents |
| `--nt-indigo` | `#3B00FF` | General bars, primary buttons, FS dep line, IN PROGRESS badge |
| `--nt-grad` | `135deg, #00F5AA → #3B00FF` | Primary button, Save button, progress fill, milestone |
| `--nt-grad-r` | `135deg, #3B00FF → #00F5AA` | Reversed gradient (decorative) |
| `--nt-grad-90` | `90deg, #00F5AA → #3B00FF` | Horizontal gradient (progress bar) |
| `--nt-teal-soft` | `#e0fdf4` | Add Link button bg |
| `--nt-indigo-soft` | `#ede9ff` | Hover state bg, IN PROGRESS badge bg |
| `--nt-glow-both` | `0 4px 24px rgba(59,0,255,.18), 0 2px 8px rgba(0,245,170,.12)` | Button glow shadow |

### Background

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-page` | `160deg, #f5f7fc → #e6eaf5` | Page background (fixed) |
| `--bg-surface` | `135deg, #fff → #f6f8fd` | Card surfaces |
| `--bg-nav` | `110deg, #0a0f1e → #0d1630` | Navbar background |

### Glass

| Token | Value | Usage |
|-------|-------|-------|
| `--glass` | `rgba(255,255,255,.75)` | Default card glass |
| `--glass-hi` | `rgba(255,255,255,.92)` | Table rows, modal |
| `--glass-border` | `rgba(255,255,255,.95)` | Card borders |
| `--glass-shadow` | `0 2px 16px rgba(59,0,255,.07)` | Default card shadow |
| `--glass-shadow-hi` | `0 6px 32px rgba(59,0,255,.12)` | Elevated card shadow |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--green` / `--green-soft` | `#059669` / `#d1fae5` | COMPLETED status |
| `--amber` / `--amber-soft` | `#d97706` / `#fef3c7` | Meeting category, FF dep line |
| `--red` / `--red-soft` | `#e11d48` / `#ffe4e6` | CANCELLED, Today line, Delete |
| `--purple` / `--purple-soft` | `#7c3aed` / `#ede9fe` | (reserved / future use) |

### Text

| Token | Value |
|-------|-------|
| `--txt-primary` | `#0f172a` |
| `--txt-secondary` | `#475569` |
| `--txt-muted` | `#94a3b8` |

### Border

| Token | Value |
|-------|-------|
| `--bdr` | `rgba(59,0,255,.10)` |
| `--bdr-mid` | `rgba(59,0,255,.18)` |
| `--bdr-teal` | `rgba(0,245,170,.25)` |

---

## Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| Body / UI | Noto Sans Thai | 400 | 12–14px |
| Heading | Noto Sans Thai | 600–700 | 16–30px |
| Labels / Codes / Badges | DM Mono | 500 | 9–11px |

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

---

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--r-sm` | `6px` | Buttons, inputs, badges |
| `--r-md` | `10px` | Toolbar, small cards |
| `--r-lg` | `14px` | Main cards, table wrap |
| `--r-xl` | `20px` | Modal |

---

## Component Specs

### Navbar
- Height: `52px`
- Background: `var(--bg-nav)` dark navy gradient
- Top shimmer border: `linear-gradient(90deg, transparent, #00F5AA 40%, #3B00FF 60%, transparent)`
- Icon box: `rgba(0,245,170,.2) → rgba(59,0,255,.25)` gradient bg with teal border
- Primary button: Neon Tide gradient + glow shadow

### Toolbar
- Background: `var(--glass-hi)` + `backdrop-filter: blur(24px)`
- Add Task button: `var(--nt-grad)` + `font-weight:600` + glow
- Add Link button: teal soft bg `#e0fdf4`

### Task Table
- Column order: `# · expand · Task Name · Start · End · Assign · Dur · % · Status · Category · Actions`
- Header bg: `linear-gradient(90deg, #edf0f9, #e6eaf5)`
- Row hover: `linear-gradient(90deg, rgba(0,245,170,.04), rgba(59,0,255,.03))`
- Parent row bg: `linear-gradient(90deg, rgba(59,0,255,.05), rgba(0,245,170,.02))`
- Cancelled row: `opacity: 0.5`
- Progress bar (parent): width `38px`, height `4px`, fill = `var(--nt-grad-90)`
- Dep count badge: `--nt-indigo-soft` bg, `#3B00FF` text, DM Mono

### Gantt Bars

| Category | Style |
|----------|-------|
| General | `linear-gradient(90deg, #3B00FF, #5a20ff)` + indigo glow |
| Develop | `linear-gradient(90deg, #00b87a, #00F5AA)` + teal glow |
| Test | `linear-gradient(90deg, #059669, #10b981)` |
| Meeting | `linear-gradient(90deg, #c05621, #d97706)` |
| Parent bar | `linear-gradient(90deg, #0a0f1e, #0d1630)` height `8px` |
| Cancelled | `rgba(0,0,0,.08)` + dashed border |
| Milestone | `var(--nt-grad)` rotated 45° diamond + glow |
| Today line | `var(--red)` vertical gradient, `opacity: .7` |

### Status Badges (pill shape, `border-radius: 20px`, DM Mono)

| Status | Background | Color | Border |
|--------|------------|-------|--------|
| COMPLETED | `#d1fae5` | `#059669` | `rgba(5,150,105,.2)` |
| IN PROGRESS | `#ede9ff` | `#3B00FF` | `rgba(59,0,255,.18)` |
| NOT STARTED | `#f1f5f9` | `#94a3b8` | `rgba(59,0,255,.10)` |
| CANCELLED | `#ffe4e6` | `#e11d48` | `rgba(225,29,72,.18)` |

### Category Colors

| Category | Dot Color |
|----------|-----------|
| General | `#5a20ff` |
| Develop | `#00b87a` |
| Test | `#10b981` |
| Meeting | `#d97706` |

### Dependency Type Tags (DM Mono, `border-radius: 5px`)

| Type | Background | Color | Meaning |
|------|------------|-------|---------|
| FS | `#ede9ff` | `#3B00FF` | Finish → Start (ใช้บ่อยที่สุด) |
| SS | `#e0fdf4` | `#00a06e` | Start → Start |
| FF | `#fef3c7` | `#d97706` | Finish → Finish |
| SF | `#ffe4e6` | `#e11d48` | Start → Finish (หายาก) |

### Dependency Arrow Lines (SVG)
- `stroke-dasharray: 5,3`
- `stroke-width: 1.5`
- FS: stroke `#3B00FF`, arrowhead at `to.x1`
- SS: stroke `#00b87a`, arrowhead at `to.x1`
- FF: stroke `#d97706`, arrowhead at `to.x2`
- SF: stroke `#e11d48`, arrowhead at `to.x2`
- Type label: white rect bg + color text, DM Mono 7px

### Modal
- `border-radius: var(--r-xl)` = 20px
- Top accent line: `var(--nt-grad-90)` height `2px`
- Background: `rgba(255,255,255,.88)` + `backdrop-filter: blur(36px)`
- Header bg: `linear-gradient(90deg, rgba(59,0,255,.05), rgba(0,245,170,.04))`
- Save button: `var(--nt-grad)` + glow
- Input focus: `border-color: #3B00FF` + `box-shadow: 0 0 0 3px rgba(59,0,255,.1)`

---

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  NAVBAR (dark navy, 52px)                   │
├─────────────────────────────────────────────┤
│  TOOLBAR (glass-hi, ~44px)                  │
├──────────────────────┬──────────────────────┤
│  TASK TABLE (660px)  │  GANTT CHART (flex)  │
│  - col header        │  - month/day header  │
│  - task rows         │  - gantt bars        │
│  - + Add task row    │  - dep SVG arrows    │
├──────────────────────┴──────────────────────┤
│  STATUS BAR (24px, bg-secondary)            │
└─────────────────────────────────────────────┘
```

---

## Background Orbs (Decorative)

```css
.orb-1 { width:500px; height:500px; background:rgba(0,245,170,.06); top:-180px; left:-120px; filter:blur(120px); }
.orb-2 { width:450px; height:450px; background:rgba(59,0,255,.07);  bottom:-140px; right:-120px; filter:blur(120px); }
.orb-3 { width:320px; height:320px; background:rgba(59,0,255,.04);  top:38%; left:42%; filter:blur(120px); }
```
