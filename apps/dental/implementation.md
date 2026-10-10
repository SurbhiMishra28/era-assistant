# DentEra — Implementation guide (how to build it, file by file)

**Version:** 1.1.0 · **Date:** 2026-10-06
Companion to [Architecture.md](Architecture.md) (the WHAT) — this is the HOW, in build order, for the
**React + Express** stack.

## 1. Build order (one PR-sized step each)

| Step | Files | Done when |
|---|---|---|
| 1. Scaffold | root `package.json` (workspaces), `server/package.json` (express, better-sqlite3, bcryptjs, jsonwebtoken, cookie-parser, cors, supertest), `client/` via `npm create vite@latest -- --template react`, `.env.example`, `.gitignore` | `npm run dev` boots API :8100 + Vite :5173, `/api/health` 200 through the proxy |
| 2. DB | `server/db/schema.sql` (13 tables), `server/db/connection.js` + seed (Era `database.js` logic copied) | tables + seed on boot; second boot re-dates demo appointments |
| 3. Auth | `server/middleware/auth.js` + `routes/auth.js` | cookie login from React login page; 401 without token; throttle |
| 4. Core API | `services/tools.js` (read tools) + `routes/appointments.js`, `routes/patients.js` | dentist sees only own rows (supertest proves it) |
| 5. Chart | `services/fdi.js` + `routes/chart.js` + `client` `ToothChart` component | click tooth → update status → colour changes |
| 6. Plans/Invoices | `routes/plans.js`, `routes/invoices.js` + client pages | plan with 2 items → mark done → invoice paid |
| 7. Booking | `routes/publicBooking.js` + client `PublicBooking` page (React Router `/book`) | guest books from another browser without login |
| 8. Assistant | `services/brain.js`, `services/tts.js`, `routes/assistant.js` + `ChatDrawer` component | voice question answered in Sofia; drawer saves history |
| 9. Tests/Deploy | `test/*.test.js` (supertest, scratch DB), `render.yaml` | ≥20 checks green; `npm run build` + live smoke pass |

## 2. Seed data (first boot, idempotent)

- **Users:** Dr. Meera Iyer `meera@dental.local` (dentist, id→dentist 1), Dr. Arjun Shah `arjun@dental.local`
  (2), Reception `desk@dental.local` — password `password123` (bcrypt-hashed now).
- **Patients (4):** Ravi Kumar, Sara Khan, Meena Iyer, Kavya Reddy — split 2/2 between dentists via
  `dentist_patients`.
- **Treatments catalogue (12):** Consultation 300/15min · Scaling 800/30 · Composite Filling 1200/30 ·
  RCT (per visit) 2500/45 · Crown (Metal-Ceramic) 4500/45 · Extraction (Simple) 900/20 · Surgical
  Extraction 2200/45 · Braces Consult 500/20 · Teeth Whitening 5000/60 · Implant (fixture) 25000/60 ·
  Fluoride Varnish 700/15 · Paediatric Filling 900/30.
- **Appointments:** 4 rows — 2 today, 2 tomorrow, mixed dentists, one `source='public'`; re-dated every boot
  (Era's freshness trick, reason prefix `APPOINTMENT …`).
- **Dentist schedules:** dentist 1 → Mon–Fri 09:00–17:00 · dentist 2 → Tue–Sat 10:00–18:00.
- **Tooth records (chart demo, Ravi):** 16 decayed, 36 root_canal+RCT record, 46 filled, 26 healthy-note.
- **Treatment plan (Sara):** "Full mouth rehab" active — items: Scaling (visit 1), RCT 36 (visit 2),
  Crown 36 (visit 3); invoice unpaid ₹8,300 (800+2500+4500+500 discount).

## 3. The 13 tools (`server/services/tools.js` — scopeDentist bodyguard first)

| # | Tool | Type | Notes |
|---|---|---|---|
| 1 | `getMyAppointments` | read | date/`today`/`tomorrow`; joins patient name |
| 2 | `getMySchedule` | read | from `dentist_schedules` |
| 3 | `getMyPatients` | read | via `dentist_patients` join |
| 4 | `getPatientChart` | read | tooth_records grouped by tooth_fdi; **must verify patient belongs to dentist** |
| 5 | `getTreatments` | read | catalogue (public-safe data) |
| 6 | `getMyPlans` / 7 `getPlanDetails` | read | plan + items + totals |
| 8 | `getMyInvoices` | read | status filter; reception allowed |
| 9 | `getAvailableSlots` | read | schedule ∩ date − booked (interval overlap!) |
| 10 | `createAppointment` | write | slotClash check; `source:'doctor'` |
| 11 | `updateToothRecord` | write | FDI + status validated; appends history row |
| 12 | `createTreatmentPlan` | write | items[] atomic in one transaction |
| 13 | `markInvoicePaid` / `cancelAppointment` | write | ownership in WHERE; amounts recomputed |

Reception/admin: appointments + invoices + schedule only; chart/plan tools deny with the friendly
`denied:true` reply (Era's pattern).

## 4. Intent ladder order (`brain.js`) — order IS correctness

`reschedule → cancel → markInvoicePaid → createPlan → updateToothRecord → next appointment →
patient chart → day view → slots → patients → plans → invoices → treatments → dental Q&A → greeting → help`
(Write-intents before read-intents, exactly like Era fixed its "move appointment" bug.)

## 5. Dental knowledge base (15 rows, `server/services/knowledge.js`)

toothache · sensitivity · bleeding gums · bad breath · cavity · wisdom tooth · RCT fear/myths ·
braces care · brushing basics · flossing · baby teeth · staining/whitening · dry mouth ·
grinding (bruxism) · knocked-out tooth (emergency: 30-min window) — every answer ends with the
safety line: *"This is general guidance — please visit your dentist for real care."*

## 6. Test checklist (supertest + node:test, scratch DB via `DB_FILE`)

1. Isolation: dentist A never reads/writes dentist B's chart/plan/appointment (tools + HTTP 404)
2. FDI: `validTooth('16')=true`, `('19')=false`, `('55')=true`, `('91')=false`, `'abc'`→400
3. slotClash: overlap refused (09:00–10:30 blocks 09:30), touching end allowed (10:30 OK)
4. Public booking: valid → 201 + `source:'public'`; bad phone → 400; past date → 400; taken slot → 409;
   6th attempt in 10 min → 429
5. Auth: no token → 401; wrong password → 401 (no user-existence leak); login throttle → 429
6. Invoice: `markInvoicePaid` recompute → `paid`; other dentist's invoice → 404
7. Injection inert; assistant denial for reception is 200+`denied:true`

## 7. Known traps (from Era's history — pre-solved here)

- Booking intent must extract **date+time** (12h/24h, "aaj/kal") *before* routing to create — Era's N1 bug.
- `slotClash` = **interval overlap**, never start-time equality — Era's N2 bug.
- Errors speak their **real reason** (409 = "slot taken"), not a fake access-denial — Era's N3 bug.
- Static files served `no-cache`; asset URLs carry `?v=` for hard refresh.
