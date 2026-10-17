# Era — Features & Working Flows

**Era** is an AI face & voice clinic assistant: a single-page vanilla-JS browser app plus a **zero-npm-dependency Node ≥ 22.5 server** with SQLite (`node:sqlite`), which speaks every reply through **NVIDIA NVCF** in one voice — **Sofia** (English / हिन्दी / Hinglish, picked automatically). This document lists every feature with its implementation, then walks through the complete working flows of the system. *(v4.4 · compiled from the codebase · October 2026)*

> Rows marked ⚠️ describe behaviour that is a **known limitation or deliberate trade-off**, not a bug.
> Gaps found in the 4.3 audit were **fixed in 4.4** — see the end of this document.

## System at a glance

| Piece | Technology | Where |
|---|---|---|
| Client | Single-page vanilla JS, Manrope font, photo character, voice-first UI | `index.html`, `app.js`, `style.css`, `assets/era3d.png` |
| Server | Node built-ins only (`node:http`, `node:sqlite`, `node:fs`, `node:crypto`) | `server.js` + `lib/*.js` |
| Database | SQLite via `node:sqlite` `DatabaseSync`, FK enforcement, 10 tables | `lib/database.js` → `db/era.db` |
| Knowledge base | 15-row AI-doctor Q&A + word-boundary keyword scoring | `db/db.js` (Node-side; `index.html` no longer loads it) |
| Voice | NVIDIA NVCF Magpie-Multilingual — Sofia EN-US + HI-IN only | `lib/tts.js`, `tts-grpc.py` (gRPC bridge) |
| Auth | scrypt password hashing + HS256 JWT (8 h), Bearer or HttpOnly cookie | `lib/auth.js` |
| Config | gitignored `.env` loader (file wins over shell env), `nvcf.key`, optional certs | `lib/env.js` |
| Tests | 40-check suite on an isolated scratch DB (18 rule checks + 22 HTTP/regression) | `test/security.test.js` |

**Module map (v4.2 split):** `env → auth → database → tools → brain → tts → router`; `server.js` is a thin entry point that owns listeners and the `__test` export surface only.

## Part 1 — Features list with implementation

### 1. Identity & access control

| Feature | What it does | Implementation |
|---|---|---|
| One-click demo login | Signs in as Dr. Amit / Dr. Rahul / Dr. Priya / Admin / Front Desk without typing | `POST /api/assistant/demo-login` (lib/router.js): guarded by the `DEMO_LOGIN` switch (lib/env.js, default ON; `DEMO_LOGIN=0` → endpoint 404s). Maps `who` → seeded user name, mints a JWT, audited as `demo_login` |
| Email sign-in **and** auto sign-up | One form logs in existing users and registers new ones | `POST /api/auth/login` (lib/router.js): valid email + password ≥ 4 chars; known email → scrypt verify → 200; unknown email → creates `users` (role `doctor`) + `doctors` row → 201 `created:true`; wrong password → 401 with a helpful hint |
| Password hashing | Passwords never stored plain | `crypto.scryptSync(pw,'era-salt-v1',32)` hex + `timingSafeEqual` compare (lib/auth.js) — demo-grade salt, documented swap path to bcrypt/argon2 |
| JWT sessions | Stateless 8-hour tokens | `mintToken` / `verifyJWT` (lib/auth.js): HS256 HMAC, base64url payload `{sub, role, doctorId, name, iat, exp}`; accepted from `Authorization: Bearer` **or** the HttpOnly `era_token` cookie; signature + expiry checked on every request |
| Role model | `doctor` / `admin` / `reception` | `requireAuth`, `requireRole(roles)`, `requireDoctor` middleware (lib/auth.js); friendly denial texts, never raw internals |
| Doctor scoping | Every query pinned to the authenticated doctor | `scopeDoctor` (lib/tools.js): doctors are pinned to their own `doctorId`; **only admin** may pass an explicit `doctor_id` (validated integer); AI/frontend-supplied ids never widen scope |
| Session restore | Reload keeps you signed in | Client `loadMe()` → `GET /api/assistant/me` → user + doctor profile → straight into the workspace |
| Logout | Ends the session cleanly | `POST /api/auth/logout` clears the cookie (audited); client clears the greeting flag, aborts audio + mic |
| Test-token CLI | Mint JWTs for API testing | `token.js`, driven through the preserved `__test` export surface of server.js. **v4.4 fixed** — the persona map listed Dr. Sharma / Dr. Verma, who no longer existed, and had no entry for Dr. Priya; it now matches the seed exactly |
| Login protection | Slows down repeated password guesses | **v4.4:** per `(IP + email)` and per IP counters → `429` with a retry hint. In-memory and per-process, so it resets on restart and does nothing across machines |
| Cookie hardening | Marks the session cookie secure | **v4.4:** `Secure` on TLS / behind a TLS-terminating proxy. Logout still cannot revoke a token already issued — that needs a denylist or refresh tokens |

### 2. AI assistant chat (the brain)

| Feature | What it does | Implementation |
|---|---|---|
| Chat endpoint | The single answering path | `POST /api/assistant/chat` (lib/router.js `chat()`): requireAuth → direct tool call *or* `routeIntent` → friendly denial path for non-doctors → `runTool` → `sanitize` → `toolReply` wording → audit |
| Intent routing | Maps natural language to tools | `routeIntent(msg, user)` (lib/brain.js): next appointment · cancel `#id` · reschedule/move · details by number · book/create · add meeting · meetings · appointments (today/tomorrow) · working hours / available slots · schedule / agenda / my day · what's next · patients · prescriptions · profile · health KB · greeting · fallback |
| Voice write path | Completes a booking from one spoken sentence | **v4.4:** `pickDateTime()` (lib/brain.js) extracts date, time and patient name from the sentence — `today`/`tomorrow`/ISO/`12 March`/the 15th, `16:45`/`3pm`/`3:30 pm`/`half past 2`/`3 o'clock`/`tomorrow morning`. Meridiem is detected **before** the 24-hour pattern, so `3:30 pm` is 15:30 |
| Reschedule by voice | Moves an appointment | **v4.4:** pattern matched **before** the booking rule (both match "move appointment 1 to tomorrow"), extracting the id + date + time |
| Details by number | One appointment, not the whole list | **v4.4:** `getAppointmentDetails` is now reachable from a sentence |
| Add a meeting | "add a meeting called Review at 3 pm" | **v4.4:** `createMeeting` tool + `POST/DELETE /api/clinic-schedule`. The `schedule` table has no `doctor_id` and no patient data — a clinic-wide notice board, so any signed-in user may read and write it |
| Overlap detection | Refuses a booking that overlaps an existing one | **v4.4:** `slotClash()` (lib/tools.js) does real interval overlap (`start_time < :end AND end_time > :start`), used by both the AI tools and `POST /api/appointments`. `getAvailableSlots` keeps whole booked intervals, so times inside a long appointment are no longer offered |
| Real error text | Era says what actually went wrong | **v4.4:** the `chat()` catch speaks the `httpErr` message instead of a blanket access denial; only a genuine crash (no numeric `.code`) gets a generic sentence |
| Login throttle | Blunts password guessing | **v4.4:** two counters — per `(IP + email)` (cap 8, cleared by that account's success) and per IP (cap 30, **never** cleared by a success, so a colleague behind the same NAT cannot re-arm an attacker). Exceeded → `429 TOO_MANY_ATTEMPTS` with `retry_after_s` |
| Secure cookie | Token never crosses plaintext | **v4.4:** `Secure` added when the socket is TLS or `x-forwarded-proto: https` — deliberately not on plain `:8000`, which would break the local run |
| Local dates | "Today" means today | **v4.4:** `EraDB.localDay()/localTime()` from `db/db.js` replace `toISOString()` and SQL `date('now')` everywhere. This box is IST; UTC rolls over at 05:30 and used to report the early morning as yesterday |
| CORS origin | Embeddable without editing source | **v4.4:** `CORS_ORIGIN` from `.env` (was hardcoded `http://localhost:5500`); `Access-Control-Allow-Methods` now includes PATCH and DELETE |
| Shared-schedule answers | Admin/reception (no doctorId) still get day answers | brain.js answers meeting/schedule/next questions from the shared `schedule` table (`clinicDay` / `nextClinic`) — clinic-wide data, safe for every role |
| Health knowledge base | 15 curated first-aid/lifestyle rows | `ai_doctor` table; `EraDB.scoreRows` (db/db.js): phrase substring +2, single-word exact/prefix ≥ 4 chars +1; highest score wins, 0 → miss; keywords stored as JSON string in SQL, array in seed |
| Medical-safety pointer | Every answer points to a doctor for anything urgent | **v4.4:** all 15 rows now carry one, and a test fails if a row is added without it. It is still hand-written into the answer text — the server does not append anything |
| Human-sounding replies | Tool rows become spoken sentences | `toolReply` (lib/router.js): friendly dates (`today` / `tomorrow` / weekday), 12-hour TTS-friendly times, bulleted lists; write confirmations ("Booked your appointment (#12).") |
| Data minimization | Internal keys never leave the server | `sanitize()` strips `doctor_id` / `patient_id` from every `tool_result`. ⚠️ It strips **IDs only** — `getAppointmentDetails` still returns patient `name`, `dob` and `phone`, and that text is POSTed to NVIDIA for speech. See *Known gaps* §G1 |
| Audit trail | Every chat/tool/login/denied/error is recorded | `assistant_audit(user_id, doctor_id, action, tool_name, request_id, success, detail, resource, resource_id)`; no message bodies, no secrets |
| Safe errors | No SQL, stack traces, or enumeration | Uniform 401 "Please sign in…", 403/404 "I can only access information available to your RMS account."; ownership failures are 404 (indistinguishable from *not exists*); every response carries a `request_id` |

### 3. RMS data layer

| Feature | What it does | Implementation |
|---|---|---|
| SQLite engine | Real SQL file database, zero driver install | `node:sqlite` `DatabaseSync`; `PRAGMA foreign_keys = ON` per connection; one `ExperimentalWarning` expected |
| RMS schema | Multi-user clinic model | `users, doctors, patients, doctor_patients, doctor_schedules, appointments, prescriptions, assistant_audit` + `ai_doctor` + `schedule`; FKs, CHECKs, timestamps, 8 indexes on doctor-scoped fields |
| Ownership pattern | Doctor-level isolation in SQL | Every read/write includes `AND doctor_id=?` in the WHERE clause — never `WHERE id` alone |
| REST resources | Dashboard-ready API | `GET/POST /api/appointments` (filters `date/from/to/status/upcoming`, LIMIT 100) · `GET/PATCH/DELETE /api/appointments/:id` · `GET /api/schedule` · `GET /api/patients` (LIMIT ≤ 50 + OFFSET) · `GET /api/patients/:id` · `GET/POST/PATCH/DELETE /api/prescriptions[/:id]` |
| AI tools | Read + write through one permission path | lib/tools.js: `getMyAppointments, getMySchedule, getMyPatients, getAppointmentDetails, getAvailableSlots, getMyProfile, getMyPrescriptions` + writes `createAppointment, rescheduleAppointment, cancelAppointment` — each re-validates ownership; slot clash → 409; foreign patient → 403 |
| Smart slot search | Free 30-minute slots per working day | `getAvailableSlots`: walks `doctor_schedules` windows for the weekday and subtracts whole booked **intervals**, defaults 30-min length (`addMin`) |
| Slot-clash detection | Refuses a booking that overlaps an existing one | `slotClash()` (lib/tools.js): `start_time < :candidateEnd AND end_time > :candidateStart`, optionally excluding the row being moved. Used by `createAppointment`, `rescheduleAppointment` and `POST /api/appointments` |
| Idempotent seeding | Self-healing demo data | `ai_doctor` upserted from `db/db.js` on **every** start (source of truth); `schedule` seeded only when empty; on empty `users`: 5 users (3 doctors with specialties, Admin, Front Desk — `password123` hashed), 5 patients + linkages, weekly schedules, 4 demo appointments, 2 prescriptions |
| Demo freshness | "Tomorrow" never answers empty | `APPOINTMENT …` demo rows are re-dated — first to **today**, rest to **tomorrow** — at every server start |
| Additive migrations | Old DBs upgrade in place | `ALTER TABLE` for `users.password_hash`, `appointments.patient_name`, audit `resource`/`resource_id`; tolerant of "duplicate column" errors, never destructive |
| Cloud fallback chain | Boots anywhere (Render free tier) | lib/database.js tries `ERA_DB` path → repo-local `db/era.db` → `os.tmpdir()/era.db`, `mkdirSync(recursive)` each, logs `[era] SQLite: <path>` |

### 4. Voice pipeline (NVIDIA NVCF)

| Feature | What it does | Implementation |
|---|---|---|
| TTS proxy | The API key never reaches the browser | `POST /api/tts` (JWT required, lib/router.js) → `synthesize` (lib/tts.js) → NVCF; WAV streamed back as `audio/wav` |
| One voice: Sofia | Single female voice, two languages | `SOFIA_VOICES = ['Magpie-Multilingual.EN-US.Sofia','Magpie-Multilingual.HI-IN.Sofia']` — **single owner** in lib/env.js; the voices list filters to it and `POST /api/tts` rejects anything else with `400 BAD_VOICE` |
| Auto-language | Hindi/Hinglish replies speak in हिन्दी | Client `pickVoice(text)` (app.js): Devanagari regex or romanised-Hinglish word-list → `HI-IN.Sofia`; otherwise the selected/EN Sofia |
| Proper-case language tags | Avoids Triton "Mapping failed" | `language` derived from the voice name then re-cased `en-US` / `hi-IN` (uppercase `EN-US` breaks synthesis — root cause of past live failures) |
| Dual-transport retry | Survives NVCF flakiness | 3× HTTP multipart (`text/language/voice/sample_rate_hz=22050/LINEAR_PCM`, 60 s timeout, 0.8/2 s backoff) → 2× gRPC via `python tts-grpc.py` (90 s timeout, raw PCM wrapped in a 44-byte WAV header); every payload validated as real RIFF before serving/caching; every attempt logged into `errs[]` |
| WAV cache | Repeats instant, upstream down-tolerant | LRU Map keyed `voice+\ntext`, cap 20, refreshed on hit |
| Voice list | Settings dropdown, filtered | `GET /api/tts/voices` (JWT): fetches NVCF list, filters to Sofia EN+HI, marks default; 503 when no key, 502 when upstream down; client falls back to a built-in two-option list |
| Spoken replies | Voice-only interface | Client `speak()`: `POST /api/tts` with `pickVoice`, 65 s timeout → blob → `<audio>` object URL; failure → status "Voice service unavailable" — **no** browser-voice fallback by design (v3.9 removal) |
| Playback guard | Stop/new-reply/logout kill audio instantly | `speakSeq` generation token + `stopSpeak()` (pauses, revokes object URL, resets mouth); mic press stops current audio first |
| Mic input | Hands-free questions | Web Speech `SpeechRecognition` (`en-IN`), feature-detected; unsupported → spoken hint + slim typed input |

### 5. Client & UI

| Feature | What it does | Implementation |
|---|---|---|
| Two-view flow | Auth card ↔ workspace | `show('auth'|'app')` toggles `.hidden`; startup `loadMe()` decides (flash-of-content guard) |
| Pop-up greeting | Personalized, once per login session | `sessionStorage.era_greeted` (cleared on logout): time-of-day + name → "Good morning, Dr. Amit! I'm Era…" after 400 ms; refresh = quiet restore |
| Photo character | 3D-look clinician is the interface | `assets/era3d.png` in `#photoWrap`, CSS `float`/`breathe` idle + `talk` pulse on `[data-state=speaking]`; framing knobs `--eraPhotoW/H/X/Y`; status pill `#status` (Ready / Listening… / Speaking… / Thinking…), pulsing rings, wave bars |
| Voice-first UX | Talk button, spoken replies, no chat panel | Mic → `ask(transcript)`; one slim text input as fallback (Enter/Send); replies update `#live` (`.sr-only`, `aria-live=polite`) so they stay accessible when TTS is off |
| Settings dialog | Name, speak/greet toggles, NVIDIA voice | `<dialog id=set>`: native modal; voice select filled from `/api/tts/voices` (Sofia EN/हिन्दी); saved to `localStorage.era_settings` via try/catch-wrapped helpers |
| Accessibility | Keyboard + screen-reader friendly | `:focus-visible` outlines, `title` tooltips, `prefers-reduced-motion` kills animations, hidden live region |
| Fresh assets | Stale-JS protection | Static files served with `Cache-Control: no-cache`; scripts cache-busted `?v=4.0.0` |
| Embedding CORS | Ready for a dashboard origin | CORS headers from `CORS_ORIGIN` in `.env` (default `http://localhost:5500`) with credentials; OPTIONS → 204; methods include PATCH and DELETE; request body capped at 100 KB |
| Denied state | Visible feedback when a request is refused | `app.js` passes a resting state into `speak()` and uses `'denied'` when the server refuses, so the red rings in `style.css` now appear — 4.4 wired up a style that had been dead since it was written |
| Offline health answers | Page keeps working without the server | The browser-side brain is gone: `index.html` no longer loads `db/db.js`, so there is no `window.EraDB`. `ask()` / `findAnswerFallback()` remain in the module as dead code and `/api/qa` still answers as a raw endpoint, but nothing in `app.js` calls it. There is no offline mode |

### 6. Ops, configuration & verification

| Feature | What it does | Implementation |
|---|---|---|
| `.env` configuration | One source of truth per process | lib/env.js parses gitignored `.env`, **file wins over shell env** (defeats box-wide junk like `PORT=0`); keys: `PORT` (8000), `HTTPS_PORT` (8443), `ERA_DB`, `JWT_SECRET`, `DEMO_LOGIN`, `NVIDIA_TTS_URL`, `NVIDIA_TTS_VOICE`, `NVIDIA_API_KEY` |
| Secret handling | Keys never committed/logged | `NVIDIA_API_KEY` env or gitignored `nvcf.key` read server-side only (lib/tts.js), never logged, never sent to the client |
| HTTPS mirror | Local TLS for mic-friendly testing | When gitignored `certs/key.pem` + `cert.pem` exist → second listener on 8443 sharing the same `handler` |
| Watchdog | Server always comes back | `start-era.cmd` (CRLF, absolute path) restarts `node server.js` every 3 s; optional logon Scheduled Task |
| Thin entry + test seam | Clean imports for tests | `server.js` listens only when `require.main === module`; exports `__test` (auth, tools, runTool, scopeDoctor, routeIntent, db, EraDB, audit, sanitize, toolReply) |
| Security suite | 40 checks green | `test/security.test.js` on a scratch DB (`ERA_DB` env, set before require): auth, roles, scoping, ownership, audit, sanitization — **plus 22 checks that drive the real `handler` over a socket** (sign-in, cookies, 404-not-403 on foreign rows, CORS methods, login throttle, Sofia-only guard, `DEMO_LOGIN` off, static `no-cache`) and 10 regression tests for the 4.4 fixes |
| Render deploy | Cloud hosting | ⚠️ **Not reproducible from this repo** — there is no `render.yaml`, `Dockerfile` or CI config. Settings go in the Render dashboard: `ERA_DB=/var/data/era.db`, `DEMO_LOGIN=1`, `JWT_SECRET`, `NVIDIA_API_KEY`. Build = `npm test`, start = `npm start`. Free-tier disk is ephemeral (DB re-seeds after each deploy) and the instance sleeps after ~15 min idle (wake ≈30–50 s). The previously published URL `https://era-assistant.onrender.com` is **unverified** — nothing in the repo confirms it is live |

## Part 2 — Full working flows

### Flow 1 — Startup & seeding

1. `node server.js` requires **lib/env.js first** → gitignored `.env` parsed, file values overwrite shell env.
2. **lib/database.js** opens SQLite through the fallback chain (`ERA_DB` → `db/era.db` → temp dir), runs `PRAGMA foreign_keys=ON`, logs the chosen path.
3. Schema is created `IF NOT EXISTS` (10 tables + 8 indexes); additive migrations upgrade pre-v3.1 databases.
4. Seeding: `ai_doctor` upserted from `db/db.js`; `schedule` and `users` seeded only when empty (demo clinic: doctors, patients, linkages, schedules, prescriptions).
5. Demo `APPOINTMENT …` rows re-dated to today/tomorrow so voice queries always have data.
6. **server.js** starts HTTP on `PORT`; optional HTTPS mirror on 8443; `__test` exports attached; the app serves at `http://localhost:8000` (static map: index.html, app.js, style.css, db/db.js, era.png, era3d.png).

### Flow 2 — Sign-in (three paths)

- **Demo:** persona select → `POST /api/assistant/demo-login {who}` → JWT minted + `Set-Cookie: era_token (HttpOnly, SameSite=Lax)` → workspace.
- **Email:** form submit → `POST /api/auth/login` → 200 "Welcome back" / 201 "Account created" / 400-401 with message → `ME` stored → workspace.
- **Session restore:** page load → `GET /api/assistant/me` → 200 → straight to workspace; otherwise the auth view shows.

### Flow 3 — Pop-up greeting (once per login session)

`showApp()` → checks `sessionStorage.era_greeted` → if unset and "Greet me" is on: flag set, greeting composed from the clock + authenticated name, spoken after 400 ms. Refreshes restore quietly; logout clears the flag.

### Flow 4 — The core voice loop (ask → answer → speak)

```
🎤 mic press → stopSpeak() → SpeechRecognition (en-IN) listens
      │ transcript
      ▼
ask(text) → POST /api/assistant/chat {message}        (JWT via cookie)
      ▼
requireAuth → verifyJWT ──✗──► 401 "Please sign in…" → client prompts re-sign-in
      ▼ ok
routeIntent(message, user)                  [lib/brain.js]
      │  intent ladder: next appointment → cancel #N → book/create → meetings
      │  → appointments (today/tomorrow) → slots/working hours → schedule/my day
      │  → what's next → patients → prescriptions → profile → health KB
      ▼
runTool(user, tool, args)                   [lib/tools.js]
      │  scopeDoctor → parameterized SQL … WHERE doctor_id=?
      ▼
sanitize(tool_result) → toolReply(tool,out) → audit(action, tool, request_id)
      ▼
reply text → client: #live (aria-live) updated, status "Speaking…"
      ▼
speak(reply) → POST /api/tts {text, voice: pickVoice(text)}
      ▼
lib/tts.js: LRU cache(20) hit? → WAV ──────────────────────────┐
      ▼ miss                                                   │
3× HTTP multipart → NVCF synthesize (proper-case language)     │
      ▼ fail                                                   │
2× gRPC (python tts-grpc.py) → RIFF validated each attempt     │
      ▼ ok                                                     ▼
WAV → <audio> playback   (speakSeq token cancels on Stop / new reply / logout)
      ✗ all attempts fail → 502 → status "Voice service unavailable — please try again shortly"
```

Step details:

1. **Auth first:** identity comes only from the JWT; a 401 mid-session makes the client say "Your session expired" and return to the auth view.
2. **Intent ladder** (first match wins): "next appointment" → newest scheduled row beyond now; "cancel 12" → write tool with id; "book/add … appointment" → create flow; "meetings" → shared `schedule`; "appointments tomorrow" → dated tool call; "available slots/free" → slot generator; "patients/prescriptions/my profile" → their tools; **health phrasing falls through to the knowledge base**; greeting/fallback texts keep the assistant helpful.
3. **Tool execution:** `scopeDoctor` pins the doctor (admin may pass an explicit `doctor_id`); all SQL parameterized; 404 for foreign rows, 403 for foreign patients, 409 for clashes.
4. **Reply shaping:** `toolReply` converts rows to spoken prose; `sanitize` strips internal ids; the audit row records user, doctor, action, tool, request id.
5. **Speech:** the client picks Sofia EN or HI automatically, the server runs the cache → 3×HTTP → 2×gRPC ladder, validates RIFF, caches, and streams WAV; the `speakSeq` token makes Stop/new-reply/logout silence the speaker instantly.

### Flow 5 — Health question (knowledge base)

"i have a fever" matches no tool intent → `EraDB.scoreRows` scores all 15 `ai_doctor` rows (substring +2, word-boundary/prefix +1) → best match returns generic guidance → spoken in Sofia. "what is the weather" scores 0 → honest fallback message, never a false health answer.

All 15 rows carry a "see a doctor" pointer for anything urgent, and a test fails if a new row is added without one. The wording is still part of the stored answer — the server appends nothing.

### Flow 6 — Write actions (book / reschedule / cancel / add meeting)

All four work from voice as of 4.4. Argument extraction happens in `pickDateTime()` (lib/brain.js); the
tools themselves were already correct and are covered by tests.

1. **Cancel by id** — *"cancel appointment 12"* → number extracted → `cancelAppointment` → ownership in
   the WHERE → soft cancel → "Cancelled appointment #12."
2. **Book** — *"book an appointment tomorrow at 4pm for Ravi"* → `{date: tomorrow, start_time: "16:00",
   patient_name: "Ravi"}` → `createAppointment`: patient-linkage check (403) → `slotClash()` interval
   check (409) → INSERT with a 30-minute default → "Booked your appointment (#13.)"
   Understood: `today` / `tomorrow` / `day after tomorrow`, ISO dates, `12 March`, `the 15th`, 24-hour
   `16:45`, 12-hour `3pm` / `3:30 pm` / `half past 2` / `3 o'clock`, and `morning`/`afternoon`/`evening`.
   **If the sentence has no time the call fails** with a spoken request for the missing detail — there
   is no multi-turn slot filling yet.
3. **Reschedule** — *"reschedule appointment 1 to tomorrow at 3pm"* → `rescheduleAppointment` →
   ownership → `slotClash(..., exceptId)` so the row ignores itself → UPDATE → "Rescheduled
   appointment #1." The reschedule pattern is matched **before** the booking rule, because both match
   "move appointment 1 to tomorrow".
4. **Details by number** — *"show me details of appointment 1"* → `getAppointmentDetails` (it used to
   fall through and return the whole list).
5. **Add a meeting** — *"add a meeting called Team Sync at 7pm"* → `createMeeting` → INSERT into the
   shared `schedule` table → "Added team sync to the clinic schedule at 7:00 PM." That table has no
   `doctor_id` and no patient data, so any signed-in user may read and write it. Removing an entry is
   `deleteMeeting` / `DELETE /api/clinic-schedule/:id`.

Every write is audited with `resource`/`resource_id`. Confirmation chips before firing writes are still
on the backlog (R4).

### Flow 7 — Admin & Front Desk experience

Users without a `doctorId` get **shared-schedule answers** ("3 meetings and 2 appointments today…") from the clinic `schedule` table. Asking for doctor-owned data returns a friendly `200 {denied:true}` with guidance — the tool layer still enforces security underneath; no raw 403 console noise. Admin can still call tools directly with an explicit `doctor_id` (validated by `scopeDoctor`).

### Flow 8 — Embedding into a real RMS dashboard

1. Dashboard authenticates (its own login or Era's), holds the JWT.
2. REST: `GET /api/appointments?upcoming=1`, patients with pagination, prescriptions CRUD — all doctor-scoped server-side; CORS is pre-locked to the dashboard origin with credentials.
3. Or drive the assistant directly: `POST /api/assistant/chat {tool, args}` (dashboard buttons) — same authorization as voice.
4. Swap-in for production: replace `verifyJWT` with the real RMS auth, drop the demo seed, point CORS at the dashboard origin, set `DEMO_LOGIN=0`.

### Flow 9 — Degradation & recovery matrix

| Situation | Behavior |
|---|---|
| NVCF upstream flaky (400 "Mapping failed", timeouts) | 3× HTTP → 2× gRPC → LRU cache; if all fail → 502 → Era shows "Voice service unavailable", stays silent until recovery (no browser-voice fallback by design) |
| No NVIDIA key configured | 503 `TTS_NOT_CONFIGURED`; voices list degrades to the built-in Sofia-only dropdown |
| Wrong voice requested | 400 `BAD_VOICE` — Sofia-only enforced at the endpoint, not just the dropdown |
| Language tag casing | Always re-cased to `en-US`/`hi-IN` (uppercase voice-name casing breaks Triton) |
| `ERA_DB` directory missing / read-only (Render) | Fallback chain: repo `db/` → OS temp dir; app still boots and re-seeds |
| Chat API unreachable | Client: "I cannot reach the clinic server right now…" (chat answers are server-only by design; the browser-side fallback was removed in v4.3) |
| Session expired (401) | "Your session expired — please sign in again." + automatic return to auth view |
| Mic unsupported (Firefox/Safari) | Spoken hint + the slim typed input |
| Slot already taken | 409 → "That time overlaps an appointment you already have at that time." — real interval overlap, so a longer booking blocks everything inside it |
| Chat tool returns 400/409 | The real reason is spoken (4.4). It used to answer "I can only access information available to your RMS account" for every non-401, so a taken slot sounded like a permissions problem |
| Login attempts | Per `(IP + email)` cap of 8 and per-IP cap of 30 in a 15-minute window → `429` with `retry_after_s`. Only that account's success clears its own counter; the per-IP one is never reset |
| Sign-in over HTTPS | Cookie carries `Secure` when the socket is TLS or `x-forwarded-proto: https`. Deliberately omitted on plain `:8000`, which would break the local run |
| Stale client code | Static served `no-cache` + `?v=4.0.0` cache-bust |

### Flow 10 — Verification & deployment

- `npm test` → **40/40** on an isolated scratch DB (`ERA_DB` set before requiring the server): 18 rule checks, 12 driving the real `handler` over a socket, 10 regression tests for the 4.4 fixes.
- `node --check` per file; `GET /api/health` shows row counts and version `4.4.0`; a fever question through `/api/assistant/chat` hits the knowledge base, "what is the weather" does not (boundary check).
- Local run: `node server.js` (or `start-era.cmd` watchdog) → http://localhost:8000 + optional https://localhost:8443.
- Cloud: `render.yaml` holds build (`npm test`), start (`npm start`) and the health check path. Secrets go in the hosting dashboard — `JWT_SECRET`, `NVIDIA_API_KEY`, `DEMO_LOGIN=0`, `CORS_ORIGIN`, `ERA_DB=/var/data/era.db`. Free tier sleeps after ~15 min (wake ≈30–50 s) and the ephemeral disk means the DB re-seeds after each redeploy.

## Appendix — API endpoint map

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | Liveness + row counts + version |
| `POST /api/auth/login` | — | Sign-in **or** auto sign-up → JWT + cookie |
| `POST /api/auth/logout` | optional | Clears the session cookie (audited) |
| `POST /api/assistant/demo-login` | `DEMO_LOGIN=1` | One-click demo session (Amit/Rahul/Priya/Admin/Front Desk) |
| `GET /api/assistant/me` | JWT | Current user + doctor profile |
| `POST /api/assistant/chat` | JWT | Message **or** direct tool call → reply + tool_result |
| `GET /api/tts/voices` | JWT | Sofia-filtered NVCF voice list |
| `POST /api/tts` | JWT | Text → WAV (cache + dual-transport retry) |
| `GET /api/appointments` | doctor | List with `date/from/to/status/upcoming` filters |
| `POST /api/appointments` | doctor | Create (patient link check, clash → 409) |
| `GET/PATCH/DELETE /api/appointments/:id` | doctor | Read/update/cancel, ownership in WHERE |
| `GET /api/schedule` | doctor | Weekly working hours |
| `GET /api/clinic-schedule` | JWT | Shared clinic day plan (clinic-wide, no PHI) |
| `POST /api/clinic-schedule` | JWT | Add a meeting `{time, title, type?}` |
| `DELETE /api/clinic-schedule/:id` | JWT | Remove a meeting |
| `GET /api/patients` · `GET /api/patients/:id` | doctor | Paginated patient list / detail (cross-doctor → 404) |
| `GET/POST/PATCH/DELETE /api/prescriptions[/:id]` | doctor | Prescriptions CRUD, doctor-scoped |

## Appendix - Known gaps

### Fixed in 4.4

Every item below was reproduced against the running code first, then fixed. Each has a regression test
that fails if the bug comes back.

| # | Was | Now |
|---|---|---|
| G1 | Voice booking always 400'd - no args ever reached the tool | `pickDateTime()` (lib/brain.js) extracts date, time and patient name from the sentence |
| G2 | `rescheduleAppointment` / `getAppointmentDetails` unreachable by voice | both routed; reschedule matched *before* the booking rule, which used to swallow it |
| G3 | Clash check compared start times for equality, so overlapping bookings succeeded | `slotClash()` interval check in the tools **and** the REST endpoint; the slot finder hides times inside a long appointment |
| G4 | Every non-401 chat error was announced as an access denial | the real `httpErr` message is spoken; only a genuine crash gets a generic sentence |
| G5 | No HTTP-layer tests | 22 new checks drive the real `handler` over a socket; the runner now awaits async tests so a failure cannot pass silently |
| G6 | No login rate limiting | per `(IP + email)` cap 8 and per-IP cap 30 -> 429 with `retry_after_s` |
| G7a | 5 health rows had no see-a-doctor pointer | all 15 have one, and a test enforces it |
| G8a | Cookie never marked secure | `Secure` on TLS / behind a TLS-terminating proxy, deliberately not on plain :8000 |
| G9 | `token.js` personas stale, Priya missing | matches the seed exactly |
| G10 | `[data-state=denied]` styled but never set | wired through the resting state passed into `speak()` |
| G11 | CORS origin hardcoded to localhost | `CORS_ORIGIN` from `.env`; PATCH and DELETE added to the method list |
| G12 | No write path for the shared `schedule` table | `createMeeting` / `deleteMeeting` + `GET/POST/DELETE /api/clinic-schedule` |
| G13 | Versions disagreed (3.1.0 / 3.0.0 / 2.0.0 / 3.9.0) | all report 4.4.0 |
| G14 | No deploy config in the repo | `render.yaml` added, with build/start/health-check |
| G15 | `today` used UTC - wrong for the first 5.5 hours on an IST box | `localDay()` / `localTime()` in `db/db.js`, used by the seed, tools, brain, API and tests |

### Still open

| Gap | Where | Effect |
|---|---|---|
| **Patient PHI is sent to NVIDIA for speech** | `lib/router.js` + `sanitize()` (strips IDs only) | Names, dates of birth and medications leave the machine. **The biggest open risk** - needs a decision before real patient data |
| Logout cannot revoke an issued token | `lib/router.js` | A stolen token stays valid up to 8 h after sign-out |
| Login throttle is in-memory | `lib/router.js` | Resets on restart; useless across more than one machine |
| No confirmation before a write | `app.js` | A misheard number can cancel a real appointment |
| A booking sentence with no time fails outright | `lib/brain.js` | No multi-turn slot filling to ask for the missing detail |
| Unknown email becomes a doctor instantly | `lib/router.js` | No email verification - an open account-creation endpoint |
| No lip sync, no character fallback | `index.html` | The SVG was removed in 3.7.2; the rig helpers in `app.js` no-op |
| Offline health answers are dead code | `db/db.js` | `ask()` / `findAnswerFallback()` are never called - there is no offline mode |
| Generated PDFs are stale | `docs/*.pdf` | Built from pre-4.4 text; regenerate after editing |
| A full stale copy of the project sits in the folder | `.kilo/worktrees/probable-gondola/` | Git-ignored via `.git/info/exclude`, but it confuses searches and file dialogs |
