# Architecture.md — Era

**Version:** 3.9.0 (NVIDIA-only voice) · **Last updated:** 2026-10-01

## 1. Shape
Static SPA + tiny local API server, **zero npm dependencies**. One page, three browser scripts,
one Node server. The AI-doctor knowledge base lives in **SQLite** (`db/era.db`), served over
`/api/qa`; the browser keeps an offline fallback so the app never breaks.

```
era-assistant/
├── index.html        # single page: auth card, character photo stage, settings <dialog>
├── nvcf.key          # NVIDIA NVCF API key (gitignored — never committed, never logged)
├── style.css         # all styling + keyframe animations (float, breathe, glow, listen, blink)
├── app.js            # session, greeting (once per login session), TTS/ASR glue, lip-sync rig
├── server.js         # Node server: SQLite setup + /api/health + /api/qa + static files
├── package.json      # pins CommonJS (guards against ancestor "type":"module"); npm start
├── db/
│   ├── db.js         # dual-export module (browser global + Node): seed, scoring, ask(), fallback
│   └── era.db        # SQLite database (generated on first server start; git-ignorable)
├── assets/era.png    # avatar
├── Prd.md  Architecture.md  Rules.md  Design.md  Task.md  Memory.md  README.md
└── era-server.log    # server output (git-ignorable)
```

## 2. Runtime data flow (v3.5 — voice-only character)
```
login (auth card) → showApp()
        │
        ├─ sessionStorage.era_greeted? ── no ──► personalized greeting → speak()
        │     "Good morning, Dr. Amit! … How can I assist you today?"
        └─ yes → quiet restore (character idles; no re-greeting on refresh)
doctor input (mic | slim text fallback)
        │
        ▼
   ask(text) → POST /api/assistant/chat {message}
        │
        ▼
   server: routeIntent → tools (scoped by req.user.doctorId) → reply + tool_result
        │
        ▼
   speak(reply) ─► POST /api/tts (JWT) → server proxy → NVIDIA NVCF synthesize → WAV → <audio>
        │   voice: S.ttsVoice (Settings dropdown; default Magpie-Multilingual.EN-US.Sofia)
        └─ on failure → status message (v3.9: NO browser-voice fallback; speechSynthesis removed)
   (stopSpeak() cancels playback on stop/new reply/logout; the API key stays server-side in nvcf.key)
```
The browser has **no local brain**: dashboard questions are answered only by the doctor-scoped
server tools, and identity never comes from the client. (`/api/qa` remains available as a fallback API.)

## 3. The database layer (v2.0)
**Engine:** SQLite via `node:sqlite` (`DatabaseSync`) — built into Node ≥ 22.5, no driver package.
**File:** `db/era.db`, created and seeded on server start. Expect one `ExperimentalWarning` line.

| Table | Rows | Schema |
|---|---|---|
| `ai_doctor` | 15 | `id INTEGER PK, q TEXT, keywords TEXT (JSON array), a TEXT` |
| `schedule` | 4 seed | `id INTEGER PK AUTOINCREMENT, time TEXT 'HH:MM', type TEXT CHECK meeting\|appointment, title TEXT` |

**Seeding is idempotent:** `ai_doctor` rows are upserted from `db/db.js` on every start (file is the
source of truth); `schedule` inserts only when the table is empty (users own that data).
**API:** `GET /api/health` → row counts + version · `GET /api/qa?q=…` → scored best match
(`{found, id, question, answer, score, source:'sqlite'}` or `{found:false}`).
**Scoring (`scoreRows`, shared browser/server):** phrases substring-match +2; single words match
exact token or ≥4-char prefix +1; keywords stored as a JSON string in SQL, plain array in the seed —
the parser tolerates both. Highest score wins; 0 → miss.

## 4. Client persistence (v3.5)
`localStorage` (`era_settings`) holds voice settings only — the chat log and schedule editor left
with the chat panel. `sessionStorage` (`era_greeted`) guards the once-per-login-session greeting and
is cleared on sign-out. Clearing storage = reset to defaults.

## 5. Browser APIs used
| API | Purpose | Guard |
|---|---|---|
| Web Speech `SpeechRecognition` | mic input | feature-detected; message + typed fallback |
| `speechSynthesis` | voice out | feature-detected; toggle in settings |
| `fetch('/api/qa')` | health answers | try/catch → offline fallback |
| `localStorage` | persistence | try/catch wrapper (`load`) |
| `<dialog>` | settings modal | native element |

## 5b. RMS integration layer (v3.0)
Implemented per the RMS assistant spec — the assistant is embeddable in an existing dashboard;
**no dashboard is built here**.

```
RMS Login → JWT/session → requireAuth → requireRole/requireDoctor → /api/assistant/chat
  → routeIntent (pluggable "AI") → tools layer (each re-validates ownership)
  → parameterized SQL scoped to req.user.doctorId → sanitize() → reply + card data → dashboard
```

- **Identity:** `verifyJWT()` (HS256, `Authorization: Bearer` or `era_token` HttpOnly cookie) is the
  only source of `req.user = {id, doctorId, role}`. Never from body/query/URL/AI args.
- **Authorization:** `requireAuth` / `requireRole` / `requireDoctor` / `scopeDoctor` — a doctor is
  always scoped to their own `doctorId`; an admin may pass an explicit `doctor_id` (scoped to exactly
  that); `reception` gets health Q&A only (403 on doctor-scoped tools).
- **Tools:** `getMyAppointments, getMySchedule, getMyPatients, getAppointmentDetails,
  getAvailableSlots` (+ writes `create/reschedule/cancelAppointment`). All parameterized; writes
  check patient-linkage/appointment ownership first; 409 on slot clash.
- **Chat flow:** `routeIntent(msg, user)` maps language → tool + args (the "AI" slot; swap for an
  LLM function-caller without touching auth/tools), then executes **through the same tool layer**
  as direct calls — one permission path for UI and API.
- **Data minimization:** scoped queries + LIMIT/OFFSET; `sanitize()` strips `doctor_id`/`patient_id`
  from everything returned to the client/AI.
- **Audit:** `assistant_audit(user_id, doctor_id, action, tool_name, request_id, success, detail)`
  on every chat/tool/login/denied call. No message bodies, no secrets.
- **Errors:** 401 "Please sign in…", 403/404 "I can only access information available to your RMS
  account." — never SQL, stack traces, or other doctors' data.
- **Swap-in:** replace `verifyJWT` with the real RMS auth, keep the DB or port the schema
  (§3), set `CORS` to the dashboard origin, set `JWT_SECRET` (auto-disables demo-login).

## 6. Swap path upward
1. **LLM:** the API seam already exists — make `/api/qa` call an LLM (schedule + history in context),
   keep SQLite keyword scoring as fallback; or have `reply()` try the LLM first.
2. **Bigger DB:** `ai_doctor` maps 1:1 to Postgres (`keywords TEXT[]`); swap `DatabaseSync` for
   `pg` behind the same endpoints — the client never changes.
3. **Calendar sync:** replace the schedule source with Google Calendar/CalDAV events mapped to
   `{time, type, title}`.
