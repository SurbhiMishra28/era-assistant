# DentEra — Rules

**Version:** 1.1.0 · **Date:** 2026-10-06
Inherits Era's [../Rules.md](../Rules.md) discipline. These rules are NON-NEGOTIABLE for `dental/`.

## 1. Security rules

1. **Identity comes ONLY from the JWT** (cookie or Bearer) — never from the request body or AI output.
   `scopeDentist()` overrides any client-sent `dentist_id`.
2. **Ownership in the WHERE clause** — every read/update/delete ends with `AND dentist_id=?` (or the
   `dentist_patients` join). Another dentist's chart/plan/invoice is a **404**, never a 403 that
   confirms existence.
3. **Parameterized queries only** — every value is a `?` placeholder. SQL injection must be inert (tested).
4. **Public booking is the only unauthenticated write** — and it is: rate-limited (5 attempts/10 min/IP),
   validated (name ≤120, phone regex `^[0-9+\-\s]{7,15}$`, date in next 14 days, time HH:MM),
   future-only, and checked against `slotClash` (interval overlap, not start equality).
5. **PHI never in URLs** — patient names go in bodies/JSON, not query strings. Audit rows may hold
   truncated details only (300 chars).
6. **Secrets stay out of git** — `.env`, `nvcf.key`, `certs/`, `*.db` are gitignored; `.env.example`
   carries placeholders.
7. **Audit everything** — login attempts, assistant tool calls, public bookings (pass + fail) all write
   `assistant_audit` with `request_id`.

## 2. Code rules

1. **npm allowed (stack change, v1.1.0)** — server: Express + better-sqlite3 + bcryptjs + jsonwebtoken + cookie-parser + cors; client: Vite + React + React Router. Keep the list short and purposeful — no UI kits, no ORM.
2. **Additive migrations only** — new tables/columns are added, existing data is never destroyed or reshaped.
3. **One owner per concern** — schema `server/db/schema.sql`, identity `server/middleware/auth.js`, SQL
   `server/services/tools.js`, understanding `server/services/brain.js`, voice `server/services/tts.js`,
   HTTP `server/routes/*.js`, UI `client/src/`. `dental/` never imports Era's `../lib/` or `../db/`.
4. **The brain never answers from thin air** — clinic data replies come from tools; the knowledge base
   only answers general dental questions and always appends the "visit your dentist" safety line.
5. **Every reply is speakable** — `toolReply()` produces human sentences (times as "11:00 AM", dates as
   "tomorrow"), because the assistant speaks them via Sofia.
6. **Check before done** — server: `node --check` + `npm test` green; client: `npm run build` passes; new
   features add tests (scratch DB via `ERA_DB`, never the real `dental.db`).

## 3. Doc rules

1. These 7 docs live in `dental/` and describe ONLY the dental sub-project — the Era root docs stay
   untouched (they are a different product at v4.5).
2. Version bumps: schema/behaviour change ⇒ bump VERSION (root package.json) + package.json together.
3. Honest status marks: ❌ not built, 🔶 partial, ✅ done — no wishful ✅.
