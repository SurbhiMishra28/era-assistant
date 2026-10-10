# DentEra — Features list with implementation

**Version:** 1.1.0 · **Date:** 2026-10-06
Companion docs: [Prd.md](Prd.md) (why) · [Flows.md](Flows.md) (step-by-step behaviour) · [Task.md](Task.md) (when).
Status marks: ❌ not built · 🔶 partial · ✅ done. **Everything below is planned, nothing built yet.**
**Stack note (v1.1.0):** server = Express + better-sqlite3, client = React (Vite) — "Era pattern" below
means copy the LOGIC, not the framework.

## Quick map — feature → phase → core files

| ID | Feature | Phase | Tables | Primary endpoints | UI home |
|---|---|---|---|---|---|
| F1 | Auth & roles | 2 | users, dentists | `/api/auth/*`, `/api/assistant/me` | login card |
| F2 | Practice dashboard | 2 | (reads others) | appointments, invoices (read) | dashboard |
| F3 | Patient register | 2 | patients, dentist_patients | `/api/patients` | dashboard |
| F4 | Appointments | 2 | appointments, dentist_schedules | `/api/appointments` CRUD | dashboard day view |
| F5 | Dental chart (FDI) | 3 | tooth_records | `/api/chart/:patientId` | chart widget |
| F6 | Treatments catalogue | 4 | treatments | `/api/treatments` | chart side panel |
| F7 | Treatment plans | 4 | treatment_plans, plan_items | `/api/plans`, `PATCH items` | patient detail |
| F8 | Billing / invoices | 4 | invoices | `/api/invoices`, `PATCH :id` | stats + patient detail |
| F9 | Public booking | 5 | appointments (`source='public'`) | `/api/public/slots`, `/api/public/booking` | PublicBooking page (`/book`) |
| F10 | AI brain (13 tools) | 6 | (reads/writes others) | `/api/assistant/chat` | chat drawer |
| F11 | Sofia voice (TTS) | 6 | — | `/api/tts`, `/api/tts/voices` | settings + drawer |
| F12 | Chat panel + history | 6 | conversations, conversation_messages | `/api/assistant/conversations` | chat drawer |
| F13 | Audit trail | 2–6 | assistant_audit | (server-side only) | — |
| F14 | Health & ops | 1 | — | `/api/health` | — |
| F15 | Chat history store | 6 | conversations, conversation_messages | `/api/assistant/conversations` | chat drawer |

---

## F1 — Authentication & roles ❌
**What:** dentist/reception sign in; unknown email auto-creates a dentist account; demo personas behind `DEMO_LOGIN`.
**Implementation:** bcryptjs hashing, HS256 JWT 8h in HttpOnly `dent_token` cookie (+ Bearer for curl). Roles `dentist|admin|reception`; `requireDentist` for chart/plan writes. Login throttle: 8 tries/15 min per (IP+email), 30/IP (Era's two-counter lesson).
**Era pattern:** copy the LOGIC of Era's `lib/auth.js` + login route into `server/middleware/auth.js` + `server/routes/auth.js` (same shape, new stack).

## F2 — Practice dashboard ❌
**What:** one glance = today's appointments (with `public` badge), 3 stat pills (today's patients · active plans · unpaid invoices), patient search.
**Implementation:** 3 parallel GETs on login: `appointments?upcoming=1&limit=20`, `patients?limit=50`, `invoices?status=unpaid`. Pills computed client-side. Poll every 60 s while tab visible.
**Era pattern:** day-view rows of Era's `getMyAppointments` reply, but as list UI instead of speech.

## F3 — Patient register ❌
**What:** add/edit patient (name, dob, phone, gender, **medical_notes** — allergies shown with ⚠️).
**Implementation:** `patients` + `dentist_patients` isolation join; `GET /api/patients?q=` searches `LIKE` on name/phone (parameterized); `POST` auto-links creator dentist. Phone UNIQUE-ish: duplicate phone returns existing patient id with `200 existing:true` (walk-in safety).
**Era pattern:** `scopeDoctor` → here `scopeDentist` bodyguard at top of `tools.js`.

## F4 — Appointments ❌
**What:** book/move/cancel visits; clash detection by **interval overlap**, not start equality.
**Implementation:** `appointments` (status `scheduled/completed/cancelled/no_show`); `slotClash(dentistId,date,start,end)` = overlap math against same-day non-cancelled rows; `PATCH` for move/status; `no_show` is dental-specific (extra vs Era).
**Era pattern:** Era's `tools.js` `slotClash` + `createAppointment` (bug N2 pre-fixed here).

## F5 — Dental chart (FDI) ❌ — *the hero feature*
**What:** 32-tooth interactive grid; per-tooth status colour + full treatment history.
**Implementation:** `tooth_records(patient_id, dentist_id, tooth_fdi, tooth_status CHECK 7 values, condition, treatment_id?, visit_date, cost, notes)`. `GET /api/chart/:patientId` returns records grouped by tooth + patient summary; `POST` appends a history row (validated by `validTooth()`: adult `11–48`, primary `55–85`). UI: two rows of 8 `<button>` teeth, colour legend, per-tooth side panel. Write requires dentist role.
**Era pattern:** none (new) — but write path follows the same scope + validate + audit rules.

## F6 — Treatments catalogue ❌
**What:** 12 standard treatments with default cost/minutes/category (seeded).
**Implementation:** `treatments` table, read-only API; plan items and tooth records reference `treatment_id`; dentist may override cost at record time (original default preserved).

## F7 — Treatment plans ❌
**What:** multi-visit plan ("Full mouth rehab": Scaling → RCT 36 → Crown 36) with per-item status.
**Implementation:** `treatment_plans` (status `draft/active/completed/cancelled`, total_estimate) + `plan_items` (visit_no, tooth_fdi, treatment_id, cost, status `planned/done/cancelled`). `POST /api/plans` inserts plan+items in **one transaction**; `PATCH /api/plans/:id/items/:itemId` flips item status and recomputes totals. Voice: `createTreatmentPlan` tool accepts items[] in one sentence ("create a plan for Sara: scaling, RCT on 36, crown on 36").

## F8 — Billing / invoices ❌
**What:** invoice per plan/visit; mark paid (full/partial); unpaid list on dashboard.
**Implementation:** `invoices(patient_id, plan_id?, amount, discount, paid_amount, status CHECK unpaid/partial/paid, issued_at)`. `PATCH /api/invoices/:id {paid_amount}` recomputes status (`paid_amount>=amount→paid`, `>0→partial`); reception role allowed on invoices only. All money = integer rupees (no floats).

## F9 — Public booking ❌ — *the only unauthenticated write*
**What:** guest books a real slot without an account.
**Implementation:** `GET /api/public/slots?dentist=&date=` (rate-limited read) + `POST /api/public/booking` — 5 attempts/10 min/IP, validates name ≤120, phone `^[0-9+\-\s]{7,15}$`, date within next 14 days, HH:MM, then `slotClash` → inserts `appointments` with `source='public'`, `patient_id=NULL`, `patient_name+reason` from body. 409 speaks "that slot was just taken". Reception sees these with a badge.
**Era pattern:** Era's demo-login throttle map → reused for the booking limiter.

## F10 — AI brain (13 tools) ❌
**What:** deterministic intent ladder; answers come ONLY from scoped data or the 15-row dental KB (+safety line).
**Implementation:** ladder order = `reschedule → cancel → markInvoicePaid → createPlan → updateToothRecord → next appointment → patient chart → day view → slots → patients → plans → invoices → treatments → dental Q&A → greeting → help` (writes before reads — Era bug N1 pre-fixed). `routeIntent(message, user)` returns `{tool,args}` or `{text}`; date/time parsing via Era's `pickDateTime` (12h/24h, aaj/kal).

## F11 — Sofia voice ❌
**What:** every reply speaks in NVIDIA Sofia (EN-US default, HI-IN auto for हिन्दी/Hinglish).
**Implementation:** `server/services/tts.js` carries Era's pipeline logic (HTTP×3 → gRPC×2, LRU cache 20, RIFF validation); React picks voice per reply, `AbortSignal.timeout(65000)`; no fallback voices.

## F12 — Chat panel + per-day history ❌
**What:** doctor↔Era Dental conversation visible in a drawer; past days as tag chips; delete a day.
**Implementation:** `conversations` (UNIQUE user_id+day) + `conversation_messages` (role user/era, tool); `logChatTurn` best-effort on every spoken/typed exchange; endpoints `GET /api/assistant/conversations`, `GET …/:id`, `DELETE …/:id` — ownership by `user_id`, cross-user = 404. Same drawer UX as Era v4.5.

## F13 — Audit trail ❌
**What:** who did what, when, with which request id.
**Implementation:** `audit()` on login (pass/fail/throttle), every tool call, every public booking attempt, every 500. Shape identical to Era's `assistant_audit`.

## F14 — Health & ops ❌
**What:** `/api/health` → `{ok, db:'sqlite', version}` for uptime checks; no-cache static; `?v=` asset busting; own `render.yaml` in Phase 7.
