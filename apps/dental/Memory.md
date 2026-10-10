# DentEra — Memory (facts that must survive context loss)

**Version:** 1.1.0 · **Date:** 2026-10-06

## What this is
- **DentEra** = dental practice website **inside** `era-assistant/dental/` — separate from the Era general
  clinic assistant (v4.5) that owns the repo root. Two products, one repo, **no code sharing** (copy
  patterns, never import across `../lib/`).
-  Planned 2026-10-06 via feature-dev: placement `dental/ sub-project`, features = **all four**
  (practice dashboard, FDI dental chart, treatment plans + billing, public booking), AI = **Era-style
  deterministic engine + Sofia**. Stack revised SAME DAY to **React + Express** (user decision):
  Vite React client + Express server + better-sqlite3 + bcryptjs/jsonwebtoken; Era's logic is COPIED
  into services, never imported; the 13-table schema and port 8100 are unchanged.

## Hard decisions (do not re-litigate)
1. The 7 root docs (Prd/Architecture/…/implementation.md) belong to **Era v4.5** — the dental docs are the
   separate set in `dental/`. Never "merge" them.
2. Dental runs on **port 8100** (HTTPS 8444) so both servers can run side-by-side with Era (8000/8443).
3. Public booking is the **only** unauthenticated write; rate-limited 5/10min/IP; `source='public'`.
4. FDI tooth ids are validated by `validTooth()` in `server/services/fdi.js` — adult 11–48 (quadrant 1–4 × 1–8),
   primary 55–85 (quadrant 5–8 × 1–5); anything else is a 400.

## Gotchas inherited from Era (learned the hard way)
- `.env` beats shell env — a `PORT=8971` on the command line will NOT override `.env` (Era smoke test
  proved this; the log showed the `.env` port).
- Kill background servers by the **node child PID from the log**, not the shell PID (`taskkill //F //PID`).
- SQLite is experimental in Node 24 → its warning line in the log is normal; `grep -o "node:[0-9]*"` finds the PID.
- Git Bash on Windows: use `taskkill //F`, POSIX `rm -f`; repo-local scratch DBs via `ERA_DB=db/x.test.db`.
- Concurrent threads edit this repo — **re-read a file before editing it**, even mid-session.

## Test/demo facts (planned)
- Demo accounts will be: `meera@dental.local` (dentistA), `arjun@dental.local` (dentistB),
  `desk@dental.local` (reception) — password `password123`, gated by `DEMO_LOGIN`.
- Verification ritual per phase: `node --check` every touched file → `npm test` (scratch DB) → curl smoke → kill node child PID.
