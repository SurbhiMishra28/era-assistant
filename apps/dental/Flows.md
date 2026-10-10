# DentEra — Full working flow

**Version:** 1.0.0 · **Date:** 2026-10-06
Companion to [Features.md](Features.md) (what each feature is) — this is HOW everything actually flows,
step by step. Ports: dental **8100** (Era stays on 8000; both can run together).

## 1. System map

```
 BROWSER                          SERVER (one process, :8100)                 DISK
┌───────────────────┐            ┌───────────────────────────────────┐   ┌──────────────┐
│ React app (Vite)  │──login──▶  │ Express (front door)              │   │              │
│ /login /dashboard │            │  └▶ routes/*.js                   │   │              │
│ /book /patients   │  HTTP+JSON │      ├▶ middleware/auth.js verify │   │              │
│  🦷 ToothChart    │──+cookie──▶│      ├▶ services/brain.routeIntent│   │  server/db/  │
│  💬 ChatDrawer    │            │      ├▶ services/tools.runTool ───┼──▶│  dental.db   │
│  🎤 Sofia voice   │◀───────────│      └▶ sanitize+toolReply+audit  │◀──│  (15 tables) │
└───────────────────┘  WAV+JSON  └───────────────────────────────────┘   └──────────────┘
                                        │
                                        ▼ /api/tts
                              NVIDIA NVCF → Sofia WAV (key never leaves server)
```

**Golden rule (same as Era):** DB ko chhoone wali code sirf `tools.js` + chart/plan/invoice routes;
identity sirf JWT se; har touch `assistant_audit` me.

## 2. Startup flow (before anyone visits)

1. `server/index.js` loads env config FIRST (`.env` beats shell — Era's gotcha) → PORT 8100, JWT_SECRET, voices.
2. `server/db/connection.js` opens `dental.db` (better-sqlite3) with the DB_FILE fallback chain.
3. `PRAGMA foreign_keys=ON` → create 15 tables IF NOT EXISTS → additive migrations → seed on first boot
   (2 dentists, reception, 4 patients, 4 re-dated appointments, 12 treatments, 1 plan + 3 items,
   2 invoices, 4 demo tooth_records, 15 dental Q&A).
4. **Freshness ritual:** demo appointments re-dated to today/tomorrow so the dashboard is never empty.
5. HTTP listener :8100 (+HTTPS :8444 if certs exist) → every request enters the same `handler()`.

## 3. Login flow

`email+password → throttle check (8/15min pair, 30/IP) → validate → user row lookup →
match? bcrypt verify + mint JWT (8h) : (unknown? auto-signup as dentist + dentist_patients empty) →
Set-Cookie dent_token (HttpOnly) → dashboard loads, 3 GETs fire`.

## 4. Feature working flows

### F4 — Book appointment (voice) — 10 steps
1. Dentist: 🎤 *"book an appointment tomorrow at 4 pm for Ravi"*
2. React `ask()` (api.js) → POST `/api/assistant/chat` `{message}` + cookie
3. `handler()` → `verifyJWT` → user `{id, role, dentistId:1}`
4. `routeIntent`: write-intent "book" → `pickDateTime` → `{tool:'createAppointment', args:{date:tomorrow,start_time:'16:00',patient_name:'Ravi'}}`
5. `runTool` → `scopeDentist` forces dentistId=1 → `slotClash` (interval overlap) → INSERT (`source:'doctor'`)
6. `audit('createAppointment', success)` → `sanitize` strips dentist_id/patient_id
7. `toolReply` → *"Booked your appointment (#5)."* → JSON `{reply, request_id}`
8. Browser: `speak(reply)` → POST `/api/tts` → Sofia WAV → 🔊
9. Chat drawer: user bubble + era bubble appended; `logChatTurn` stored both (F12)
10. Dashboard day-view refreshes → new row visible

### F5 — Dental chart update — 8 steps
1. Patient register → open **Ravi** → chart grid renders from `GET /api/chart/1` (grouped by tooth)
2. Tooth **16** shows red (decayed — seeded record)
3. Dentist clicks 16 → side panel: history rows + actions
4. Action: *Record treatment* → Composite Filling, cost ₹1200, visit today
5. `POST /api/chart/1` `{tooth_fdi:'16', tooth_status:'filled', treatment_id:2, cost:1200}` (dentist role required)
6. Server: `validTooth('16')` ✓ → dentist owns Ravi (`dentist_patients`) ✓ → INSERT history row
7. Grid re-renders: 16 turns filled-colour ✓ (legend + aria-label updated)
8. History panel now shows: decayed (May) → filled (today)

### F7 → F8 — Plan to payment — 7 steps
1. Sara's chart → *"Create treatment plan"* → items: Scaling, RCT on 36, Crown on 36
2. `POST /api/plans` — plan + 3 `plan_items` in ONE transaction → status `active`, estimate ₹7,800
3. Visits happen: dentist flips each item `planned → done` (`PATCH items/:itemId`)
4. Invoice auto-issued on first done item: `{amount:7800, discount:500, status:'unpaid'}`
5. Patient pays ₹2,000 → reception `PATCH /api/invoices/2 {paid_amount:2000}` → status `partial`
6. Final payment → `paid_amount:7300 ≥ amount-discount` → status `paid` ✓
7. Dashboard pill "Unpaid invoices" drops; voice: *"mark invoice 2 paid"* works via `markInvoicePaid`

### F9 — Public booking (no login) — 8 steps
1. Patient opens the `/book` page → picks **Dr. Meera** → date **tomorrow** → `GET /api/public/slots`
2. Server: rate-limit check (5/10min/IP) → schedule Mon 09:00–17:00 − booked intervals → free slots JSON
3. Patient picks **16:00**, enters name "Kabir" + phone + "tooth pain" → POST `/api/public/booking`
4. Server validates: name ✓ phone regex ✓ date in 14 days ✓ → `slotClash` ✓
5. INSERT: `appointments{dentist:1, patient_name:'Kabir', reason:'tooth pain', source:'public'}` → 201
6. Booking page: success card with summary ("See you tomorrow, 4:00 PM")
7. Next morning: Dr. Meera's dashboard shows the row with **`public` badge** + walk-in option to link patient
8. If a doctor booked 16:00 in between → step 4 fails → **409** → friendly re-pick message

### F10–F12 — AI question, end to end (read path)
`"show Ravi's chart"` → chat POST → verifyJWT → routeIntent matches *patient chart* before health Q&A →
`getPatientChart` (verifies Ravi ∈ dentist's patients, else 404-shaped denial) → grouped teeth summary →
reply: *"Ravi has 4 recorded teeth: 16 filled, 36 root canal, 46 filled, 26 healthy"* → audit → speak
(Sofia EN/HI auto) → both bubbles persisted under today's conversation → chips update counts.

### F13 — Audit (always)
Login pass/fail · tool call (name+args truncated) · public booking attempt (pass AND fail) · any 500 —
all rows carry `request_id`, which every JSON reply echoes back for support.

## 5. Failure behaviour (speakable, tested)

| Case | Status | What user hears/sees |
|---|---|---|
| No/expired token | 401 | "Please sign in to use the assistant." |
| Wrong password | 401 | no user-existence leak; throttle after cap → **429** + retry hint |
| Another dentist's chart/plan/invoice | **404** | "You are not authorized…" (no existence leak) |
| Reception hits dentist-only tool | 200 `{denied:true}` | friendly guidance, not an error |
| Booking overlap | **409** | "That time overlaps an appointment already booked." |
| Bad FDI / bad phone / past date | **400** | field-specific message |
| NVIDIA down | **502** | "Voice service unavailable — please try again shortly." (text reply still works) |
| History write fails | chat continues | best-effort persistence, server log only |

## 6. One-sentence summary

*Doctor logs in once; everything she says or clicks becomes a scoped tool call on one SQLite file;
patients book themselves on a public page; every answer comes back as a speakable sentence — and every
single touch leaves an audit trail.*
