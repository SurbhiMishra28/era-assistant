# Task.md — Era work tracker

**Updated:** 2026-10-01

**Status: v4.2 — modular split (lib/env, auth, database, tools, brain, tts, router; server.js = thin entry) + production posture.**

## ✅ Shipped
- [x] **v3.9.1 — gRPC bridge (diagnosis via official riva client):** upstream "Triton Mapping failed"
  windows hit BOTH transports independently — gRPC was healthy while HTTP was down (and vice versa).
  `/api/tts` now tries 3× HTTP then 2× `python tts-grpc.py` (Riva gRPC client, same function-id,
  WAV built from raw PCM on stdout), validating RIFF each time. `nvidia-riva-client` installed via
  `pip --user` (diagnostic/bridge tool only — app itself stays zero-npm-dep). gRPC path confirmed
  serving real audio during an HTTP-down window.
- [x] **v3.9 — Voice providers removed (user request):** all `speechSynthesis` machinery deleted —
  `voices` list, `refreshBrowserVoices`, `pickVoice()`, `speakFallback()` sentence chain, viseme/
  jaw-loop lip-sync helpers, `speechSynthesis.cancel()` in every path. `speak()` = single NVCF path
  (fetch WAV via `/api/tts` → `<audio>`); on failure Era shows a status message instead of speaking.
  Mic (input) still uses browser SpeechRecognition. Settings save no longer stores rate/pitch.
- [x] **v3.8.1 — Settings cleanup (user request):** Speed/Pitch sliders removed (NVIDIA voice has no
  rate/pitch params; they only affected the fallback). Settings Voice is now "NVIDIA Voice" —
  friendly labels ("Sofia · EN-US", "Mia (calm) · EN-US") grouped by language in `<optgroup>`s:
  English (EN-US) first, then हिन्दी (HI-IN: Sofia/Leo/Siwei/Pascal), then the rest. Offline default
  list includes a Hindi voice. rate/pitch stay in S as fallback-only defaults (no UI).
- [x] **v4.1 — Go-live production posture (audit pass):** gitignored `.env` (PORT/HTTPS_PORT/JWT_SECRET;
  file wins over the box's junk shell env) — real 64-char secret auto-disables `/api/assistant/demo-login`;
  optional HTTPS mirror on :8443 from gitignored self-signed `certs/{key,cert}.pem` when present;
  `POST /api/tts` now REJECTS any voice outside Sofia EN/HI (400 BAD_VOICE — audit proved FR voices
  still synthesized before); demo "APPOINTMENT …" rows re-dated to today/tomorrow at every start
  ("my appointments tomorrow" never answers empty again); `start-era.cmd` auto-restart watchdog
  (CRLF!) + logon Scheduled Task ("Era Assistant"; schtasks needs admin — grant on request).
- [x] **v3.8 — NVIDIA NVCF voice (user request):** browser voice providers demoted to fallback.
  New server proxy: `POST /api/tts` (JWT-protected, multipart upstream, WAV out) +
  `GET /api/tts/voices`. Key stored server-side in gitignored `nvcf.key` (or `NVIDIA_API_KEY` env);
  never logged or sent to the browser. Default voice `Magpie-Multilingual.EN-US.Sofia`; Settings
  Voice dropdown lists all NVCF voices. app.js plays the returned WAV via `<audio>`, falls back to
  the browser sentence chain on failure. NVCF quirks: multipart form-data (not JSON), `language`
  field name, response is a raw RIFF/WAVE file.
- [x] **v3.7.2 — SVG model removed (user request):** the character is now solely the photo
  (`assets/era3d.png`, visible by default — no load-event race, no JS dependency). Rig helpers in
  `app.js` remain but no-op safely (mouth/eyes/brows element refs are empty). Photo motion lives in
  CSS (float/breathe + talk-pulse on `[data-state=speaking]`).
- [x] **v3.7.1 — Photo mode live + voice tune:** `assets/era3d.png` saved (copy of the project's 3D
  character render — transparent background) so Era now appears as the photo; cover-crop display
  with `--eraPhotoW/H/X/Y` tuning knobs in `:root`. Voice: per-sentence human rate jitter, Neural
  voices keep native pitch (slider blends 35%), ~140–260 ms breath pause between sentences, mouth
  returns to rest during pauses.
- [x] **v3.7 — Photo mode + human voice (user request):** drop a render at `assets/era3d.png` and it
  replaces the SVG character (clean image, same float/breathe/talk-pulse motion; SVG fallback when
  absent; whitelisted in `server.js` STATIC + missing-file guard). Voice: `pickVoice()` prefers
  Edge Natural/Neural (Aria/Jenny) then Chrome Google voices; replies speak sentence-by-sentence
  with subtle prosody jitter; `speakSeq` token cancels chains on stop/new reply/logout.
- [x] **v3.6.1 — Character restyle (user choices: fair skin kept, open long hair, grey+white outfit):**
  ponytail → center-parted open hair (back mass past shoulders + face-framing locks), blue scrubs →
  light grey apron with V-neck trim under the white coat. Rig untouched (mouth clip, visemes, blinks).
- [x] **v3.6 — 3D-look character (user request, image-based):** flat SVG replaced with a
  Pixar-style character — gradient skin/hair/scrubs/coat, glossy brown eyes with catchlights and
  lashes, side-swept hair + ponytail, crossed arms, badge + stethoscope, soft blurred shadows.
  Mouth rebuilt as a clipPath rig (teeth + tongue clipped inside the viseme shape); `MOUTH` viseme
  paths re-tuned to the new geometry; brow flick made geometry-independent. Zero dependencies kept;
  greeting/lip-sync/security behavior unchanged.
- [x] **v3.5 — Character UI (user request):** "Meet Era" intro card and chat panel removed — Era IS
  the interface now. SVG character rig (blinks, brow flicks, viseme mouth), pop-up personalized
  greeting once per login session (`sessionStorage.era_greeted`, cleared on logout), TTS
  word-boundary lip sync with rAF jaw fallback, voice-only replies (+ `aria-live` `#live` for a11y),
  mic-first input with one slim text fallback. Backend untouched — all answers still flow through
  `/api/assistant/chat` and the doctor-scoped tools.
- [x] **v3.1 — Full RMS spec (§1–30):** real login (`POST /api/auth/login`, scrypt-hashed passwords,
  constant-time compare), `PRAGMA foreign_keys=ON` per connection, `prescriptions` table +
  `GET /api/prescriptions[/:id]`, REST resources (`GET/POST/PATCH/DELETE /api/appointments`,
  `/api/schedule`, `/api/patients`) with the `WHERE id=? AND doctor_id=?` ownership pattern everywhere,
  `doctor_id` from `req.user` only (body/query/AI ignored), spec test accounts (Amit/Rahul/Priya),
  audit `resource`/`resource_id` columns, DB backup before migration (`db/era.backup-*.db`),
  **16/16 tests** incl. spec TEST 1–10 over live HTTP.
- [x] **v1.0 — MVP:** animated face, TTS, mic input, typed chat, schedule brain, settings, localStorage.
- [x] **v1.1 — Knowledge base:** 15-row AI-doctor Q&A + keyword retrieval (word-boundary scoring).
- [x] **v2.0 — SQLite + API:** `node:sqlite`, `server.js` (`/api/qa`, `/api/health`), seed-on-start, offline fallback, dual-export `db/db.js`, `package.json` CommonJS pin.
- [x] **v3.0 — RMS-ready assistant (the pasted spec, implemented in Era):**
  - JWT (HS256) auth middleware; identity **only** from token/cookie — never body/query/AI args.
  - Roles: `doctor` / `admin` / `reception`; centralized `requireAuth` / `requireRole` / `requireDoctor` / `scopeDoctor`.
  - RMS schema: `users, doctors, patients, doctor_patients, doctor_schedules, appointments, assistant_audit` + FKs, CHECKs, timestamps, indexes on all doctor-scoped fields.
  - Tools: `getMyAppointments, getMySchedule, getMyPatients, getAppointmentDetails, getAvailableSlots` + writes `createAppointment, rescheduleAppointment, cancelAppointment` — each re-validates ownership; parameterized SQL only.
  - `POST /api/assistant/chat`: the spec's 11-step server flow (routeIntent = pluggable "AI"; swap for an LLM without touching auth/tools).
  - Audit log (`assistant_audit`): user/doctor/action/tool/request_id/success; no prompts or secrets stored.
  - Data minimization: scoped queries + LIMIT/OFFSET + `sanitize()` strips `doctor_id`/`patient_id` from anything leaving the server.   - Frontend: server-derived identity (`/me`), persona picker + demo-login (v4.3: `DEMO_LOGIN` switch, default ON; `DEMO_LOGIN=0` disables), appointment/schedule/patient/slot cards, permission-denied state, offline fallback.
  - `token.js` CLI to mint test JWTs; `test/security.test.js` — **15/15 pass**, isolated scratch DB per run.

## 🔜 Next up
- [x] **v3.4 — Spec gap closure (§7/§8/§13/§14):** `GET /api/appointments/:id`, `GET /api/patients/:id`,
  prescription create/update/delete (REST), `patient_name` column (migrated additively) accepted on
  appointment create in REST **and** AI tools; 3 new regression tests → suite now 18/18.
- [x] **v3.3 — Three-view UI:** ① auth page (login/signup only) → ② "Meet Era" getting-started
  (avatar, feature steps, Get Started) → ③ workspace (face + chat + voice). Flash-of-content guard,
  auth page messages, session restore on reload; logout available from workspace and intro.
- [x] **v3.3 — Appointments panel removed from UI** (user request): chat cards are the only
  appointment surface in the client; `/api/appointments` + tools remain fully available for the
  embedding dashboard.
- [x] **v3.2 — Logout:** `POST /api/auth/logout` clears the HttpOnly cookie (audited); /me afterwards = 401.
  Stateless-JWT note: instant revocation needs a denylist (backlogged with R5).
- [ ] **R1 LLM behind /chat:** replace `routeIntent` with a function-calling LLM (tools unchanged; prompt ≠ security boundary).
- [ ] **R2 Real RMS wiring:** your login + your DB per README §"Wiring into your real RMS".
- [ ] **R3 Pagination everywhere** (`getMyPatients` has LIMIT/OFFSET; apply to appointments if lists grow).
- [ ] **R4 Confirmation UX for writes:** show a confirm chip before `createAppointment`/`cancel` fires.
- [ ] **R5 Refresh tokens + logout revocation** (current tokens are 8 h, stateless).

## 🧭 Later
- [ ] R6 Postgres swap (`node:sqlite` → `pg`) for multi-user production.
- [ ] R7 PWA + offline caching; calendar sync; Hindi/regional voice input.

## 🐞 Known issues
- None open. (Fixed in v3.0: base64url decode bug, JSON replacer bug, scratch-DB test isolation.)
