# DentEra — Architecture

**Version:** 1.1.0 · **Date:** 2026-10-06
Sibling of Era's [../Architecture.md](../Architecture.md) — same discipline (scoped tools, audit, additive
migrations), **React + Express stack** (revised same day per user decision).

## 1. Stack (revised to React + Express, v1.1.0)

| Layer | Choice | Why |
|---|---|---|
| Client | **React 18 + Vite + React Router** (plain CSS, mint theme) | component UI for chart/dashboard; fast dev server |
| Server | **Express 4** (Node ≥20), CommonJS | routers per resource, battle-tested middleware model |
| Database | **better-sqlite3**, one file `server/db/dental.db` | synchronous + fast, prepared statements, no ORM |
| Auth | bcryptjs + jsonwebtoken + cookie-parser | scrypt→bcrypt swap OK, JWT 8h HttpOnly cookie unchanged |
| AI | same intent-ladder brain + 15-row dental KB + NVIDIA Sofia proxy (copied logic) | deterministic, no LLM cost |
| Testing | node:test + supertest (server), Vitest (client) | HTTP-layer tests like Era's |
| Deploy | Render: static Vite build + Express API (one service or two) | free tier |

**Rule that survives the stack change:** Era's code is never imported — logic is copied into `server/services/`;
security rules (JWT-only identity, ownership-in-WHERE, parameterized queries, audit) are identical.

## 2. Folder layout

```
era-assistant/
└─ dental/                          ← SELF-CONTAINED sub-project (never imports Era's ../lib or ../db)
   ├─ Prd.md · Architecture.md · Design.md · Rules.md · Task.md · Memory.md · implementation.md
   │  Features.md · Flows.md
   ├─ package.json                  workspaces: server + client · scripts: dev / test / build
   ├─ .env.example                  PORT=8100, JWT_SECRET, NVIDIA_API_KEY, CORS_ORIGIN, ERA_DB-like DB_FILE
   ├─ server/                       Express API
   │  ├─ index.js                   entry: env → middleware → routes → listen :8100
   │  ├─ db/
   │  │  ├─ schema.sql              13 tables (single source of truth, idempotent CREATE IF NOT EXISTS)
   │  │  └─ connection.js           better-sqlite3 open + PRAGMA foreign_keys + demo seed (Era database.js logic)
   │  ├─ middleware/auth.js         bcryptjs + jsonwebtoken 8h + requireAuth/requireRole/requireDentist
   │  ├─ services/
   │  │  ├─ tools.js                13 dental tools — scopeDentist bodyguard; ONLY service touching clinic tables
   │  │  ├─ brain.js                intent ladder (reschedule-before-book, chart, plan, invoice, dental Q&A)
   │  │  ├─ tts.js                  Sofia via NVCF HTTP×3 → gRPC×2, LRU cache 20 (Era logic copied)
   │  │  ├─ fdi.js                  validTooth() FDI validator + tooth helpers
   │  │  └─ knowledge.js            15 dental Q&A rows + safety line
   │  └─ routes/                    auth · patients · appointments · chart · plans · invoices · publicBooking · assistant · health
   ├─ client/                       Vite React app
   │  ├─ index.html · vite.config.js (proxy /api → :8100)
   │  └─ src/
   │     ├─ main.jsx · App.jsx (routes: /login /dashboard /patients/:id /book)
   │     ├─ api.js                  fetch wrapper (credentials: 'include')
   │     ├─ pages/                  Login · Dashboard · PatientDetail · PublicBooking
   │     ├─ components/             ToothChart · ChatDrawer · DayView · StatsPills · PatientTable · InvoiceList
   │     └─ styles/                 mint theme (Design.md tokens)
   └─ test/                         supertest suite (scratch DB via ERA_DB-style DB_FILE)
```

## 3. Database — 13 clinic tables + 2 chat tables (`server/db/dental.db`)

| Table | Purpose / key columns |
|---|---|
| `users` | login accounts — role CHECK `dentist/admin/reception`, email UNIQUE, password_hash |
| `dentists` | profile — user_id UNIQUE FK, specialty, room_no |
| `patients` | name, dob, phone, gender, medical_notes (allergies!) |
| `dentist_patients` | isolation join — UNIQUE(dentist_id, patient_id) |
| `appointments` | dentist_id, patient_id?, patient_name, date, start/end, status `scheduled/completed/cancelled/no_show`, reason, **source `doctor/public`** |
| `dentist_schedules` | working hours per weekday (0–6, start, end) |
| `treatments` | catalogue — name, default_cost, default_minutes, category `preventive/restorative/endodontic/periodontic/orthodontic/surgical/cosmetic/other` |
| `tooth_records` | **the chart** — patient_id, dentist_id, tooth_fdi (validated), tooth_status `healthy/decayed/filled/root_canal/crowned/missing/implant`, condition, treatment_id?, visit_date, cost, notes |
| `treatment_plans` | patient_id, dentist_id, title, status `draft/active/completed/cancelled`, total_estimate |
| `plan_items` | plan_id, tooth_fdi, treatment_id, visit_no, cost, status `planned/done/cancelled` |
| `invoices` | patient_id, plan_id?, amount, discount, paid_amount, status `unpaid/partial/paid`, issued_at |
| `ai_doctor` | dental Q&A — q, keywords JSON, a |
| `assistant_audit` | every tool call / booking attempt (same shape as Era) |
| `conversations` | chat drawer — UNIQUE(user_id, day) |
| `conversation_messages` | role user/era, text, tool, FK cascade delete |

Safety: `PRAGMA foreign_keys = ON`, parameterized `?` queries everywhere, indexes on
`(dentist_id,appointment_date)`, `tooth_records(patient_id)`, `invoices(status)`.

## 4. API map (one `handler()` ladder in router.js)

| Method+Path | Auth | Does |
|---|---|---|
| `POST /api/auth/login` · `/logout` | none | sign-in / auto sign-up · clear cookie |
| `GET /api/assistant/me` | ✓ | identity from token |
| `POST /api/assistant/demo-login` | DEMO_LOGIN | persona select (`dentistA/dentistB/reception`) |
| `POST /api/assistant/chat` | ✓ | brain → tool → sanitized reply (audit) |
| `GET/POST /api/appointments`, `GET/PATCH/DELETE /api/appointments/:id` | dentist | CRUD, ownership in WHERE |
| `GET /api/patients`, `GET /api/patients/:id` | dentist | scoped register |
| `GET/POST /api/chart/:patientId` | dentist | tooth_records read/write (FDI validated) |
| `GET/POST /api/plans` · `PATCH /api/plans/:id/items/:itemId` | dentist | plans + item status |
| `GET /api/invoices` · `PATCH /api/invoices/:id` | dentist/reception | billing, mark paid |
| `GET /api/health` | none | `{ok, version}` |
| **`POST /api/public/booking`** | **none (rate-limited 5/10min/IP)** | guest books future slot — validates name/phone/date/time, checks slotClash |
| `GET /api/public/slots?dentist=&date=` | none (rate-limited) | free slots for the booking page |

## 5. AI pipeline (Era-style, deterministic)

```
🎙️/⌨️ ──▶ /api/assistant/chat ──▶ requireAuth ──▶ routeIntent ladder:
   1 cancel/reschedule  2 mark invoice paid  3 create plan  4 update tooth record
   5 next appointment   6 chart of patient   7 day view     8 slots  9 patients
   10 plans/invoices    11 treatments catalogue  12 dental Q&A (15 topics)
   13 greeting/help
 ──▶ runTool (scopeDentist) ──▶ sanitize ──▶ toolReply (human sentence) ──▶ audit
 reply text ──▶ /api/tts ──▶ Sofia (EN-US/HI-IN) ──▶ WAV blob ──▶ Audio play
```

Denied/staff behaviour, chat panel with per-day history, and `pickDateTime` (12h/24h, aaj/kal)
are all carried over from Era's design — same file roles, dental vocabulary.

## 6. Request flow (one message, end to end)

```
React (api.js, credentials:'include') ──▶ Express router ──▶ auth middleware ──▶ services/brain.routeIntent
   ──▶ services/tools.runTool ──▶ dental.db ──▶ rows ──▶ sanitize+toolReply ──▶ JSON reply ──▶ speak+chat drawer
```

Ports: dental API on **8100**; Vite dev server :5173 proxies `/api` → 8100. Production: Express serves
`client/dist` as static — one process, one port.
