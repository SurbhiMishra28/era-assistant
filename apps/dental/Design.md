# DentEra — Design (UI/UX)

**Version:** 1.1.0 · **Date:** 2026-10-06
Same design language as Era ([../Design.md](../Design.md)): one card, glass surfaces — but a **dental mint
theme** and a tooth-grid hero.

## 1. Screens (3 total)

### ① Login (`index.html` — `#auth` view)
Card: logo + "Dentist Login" + email/password + demo `<select>` (Dr. Meera/dentistA, Dr. Arjun/dentistB,
Reception) + "try it". Identical mechanics to Era's login (auto sign-up, 429 throttle message).

### ② Dashboard (`index.html` — `#dash` view)
- **Header row:** dentist name/role + Sign out
- **Day view:** today's appointments list (time, patient, reason, `source:public` badge)
- **Stats row:** 3 pills — Today's patients · Active plans · Unpaid invoices
- **Patient register:** searchable list → opens patient detail
- **Dental chart (per patient):** the hero widget (spec below)
- **Assistant:** `💬 Chats` button opens the chat drawer (bubbles + per-day chips) — same UX as Era v4.5's panel
- **Settings `<dialog>`:** display name, voice on/off, greeting on/off, Sofia voice select

### ③ Public booking (`/book` route, React — no login)
Mint hero → 4 steps in one card: **1** pick dentist · **2** pick date (next 14 days) · **3** pick a free slot
(from `/api/public/slots`) · **4** name + phone + reason → confirm → success state with summary. Friendly
errors: "That slot was just taken — please pick another."

## 2. Dental chart widget (the core UI)

```
UPPER                        18 17 16 15 | 14 13 12 11          ← FDI quadrant 1
                             48 47 46 45 | 44 43 42 41          ← quadrant 4 (LOWER)
```

- Two rows of **8 tooth buttons** each (32 total, adult FDI). Each button = a mini tooth SVG
- **Colour = `tooth_status`:** healthy `#e8f6f4` · decayed `#fdecec` · filled `#e3eef3` ·
  root_canal `#f4e9ff` · crowned `#fff4dd` · missing (crossed out, `#eee`) · implant `#dff0ff`
- Click a tooth → side panel: history list (`tooth_records` rows) + actions:
  *Update status · Record treatment (picks from catalogue, stores cost) · Add note*
- Primary teeth (55–85) v1: dropdown behind "Show child teeth" toggle — grid stays adult by default
- Status colours are also the chart legend — always visible, not colour-only (icon shapes differ:
  ✓ filled, ✕ missing, ⚡ root canal) for accessibility

## 3. Theme tokens (`style.css`)

| Token | Value | Era equivalent |
|---|---|---|
| `--mint` | `#0fa795` (primary actions, user bubbles) | `--teal #1f9d9a` |
| `--mint2` | `#0b7c72` (gradient end) | `--teal2` |
| `--bg` | `#e9f6f3` aurora backdrop | `--bg #eaf4f6` |
| `--ink / --mut / --card` | `#10332e / #55746d / #fff` | same roles |
| Font | Manrope 400/600/800 | same |
| Card | `border-radius:28px`, glass blur, soft mint shadows | same |
| Animations | float/breathe/pop + `@media (prefers-reduced-motion: reduce)` kill-switch | same |

## 4. Assistant panel

Same component as Era's v4.5 chat panel: right drawer, `Today`/`Yesterday`/date chips, user bubble right
(mint), Era Dental bubble left (white), empty-state hint, notes row. Voice: replies auto-pick Sofia
EN-US/HI-IN exactly like Era (`isDevanagari`/Hinglish detection).

## 5. Accessibility & trust

- `aria-live` region for spoken replies (kept out of the chat drawer to avoid double announcement)
- Focus-visible rings on every control; tooth buttons are real `<button>`s with `aria-label="Tooth 16 — decayed"`
- Safety line under every dental Q&A answer: "This is general guidance — please visit your dentist for real care."
- Public booking page states clearly: no account needed, phone used only for the appointment
