# Era — RMS-Ready AI Clinic Assistant

A character-based voice assistant you can drop into an existing RMS dashboard. Era appears the moment
a doctor signs in — she greets them by name, speaks every answer aloud, and answers dashboard
questions from that doctor's own scoped data. Multi-user, role-aware, with **strict doctor-level
data isolation enforced in the backend** — never in the AI or the frontend.

**Character:** the 3D character render `assets/era3d.png` — floats, breathes, pulses while speaking.
**Voice:** Era speaks ONLY in **NVIDIA Sofia's voice** (EN-US + HI-IN) via the server proxy —
English, हिन्दी and Hinglish are auto-picked per reply (v4.0; every other persona removed).
The key lives in gitignored `nvcf.key` (or `NVIDIA_API_KEY` env).

## Run (demo mode)
```
node server.js          # or: npm start
npm test                # 40 checks (spec TEST 1–10 + auth/FK/isolation + the HTTP layer)
```
→ **http://localhost:8000** · **sign in with any email + password** — a new email is stored
automatically as a new account (auto sign-up); returning users just enter the same credentials.

### Production mode (v4.1, this deployment)
`JWT_SECRET` in gitignored `.env` mints real JWTs; demo login on the start screen is a switch —
`DEMO_LOGIN=0` in `.env` turns it off for a real deployment; a self-signed TLS cert
(`certs/key.pem`+`cert.pem`) adds an HTTPS mirror on **:8443**; `start-era.cmd` is an auto-restart
watchdog (register at logon with: `schtasks /Create /TN "Era Assistant" /TR <path\to\start-era.cmd>
/SC ONLOGON` — needs an admin prompt once). Demo appointments re-date themselves to today/tomorrow
on every start; `/api/tts` rejects any non-Sofia voice (400).

Demo shortcuts (Amit/Rahul/Priya/Admin/Front Desk) are on the start screen:

| Demo user | Email | Password | doctor_id |
|---|---|---|---|
| Dr. Amit | `amit@rms.local` | `password123` | 1 |
| Dr. Rahul | `rahul@rms.local` | `password123` | 2 |
| Dr. Priya | `priya@rms.local` | `password123` | 3 |
| Admin | `admin@rms.local` | `password123` | — |
| Front Desk | `desk@rms.local` | `password123` | — |

Try: *"what appointments do I have tomorrow?"*, *"my patients"*, *"my prescriptions"*,
*"free slots tomorrow"*, *"cancel appointment 2"*, *"book an appointment tomorrow at 4pm for Ravi"*,
*"reschedule appointment 1 to tomorrow at 3pm"*, *"add a meeting called Review at 3 pm"* — then sign
in as Dr. Rahul and try the same: **each doctor only ever sees their own data.**

Health Q&A (fever, BP, diet…) works for every signed-in user from the SQLite knowledge base.

## Mint a token for API testing
```
node token.js doctorA        # also: doctorB | admin | reception
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/assistant/me
```

## Security tests
```
node test/security.test.js   # 40 checks: isolation, 401/403, injection, sanitization, HTTP layer
```

## Endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | none | email+password (scrypt-hashed) → JWT cookie + token |
| `GET /api/appointments` | JWT doctor | **scoped to authenticated doctor**; filters: `?date= ?from= ?to= ?status= ?upcoming=1` |
| `GET /api/appointments/:id` | JWT doctor | ownership-enforced read (`WHERE id=? AND doctor_id=?`) → 404 if not yours |
| `POST /api/appointments` | JWT doctor | create — `doctor_id` from auth, body `doctor_id` ignored; 409 on clash. ⚠️ clash check compares the start time only, so long appointments can be overlapped |
| `GET /api/patients` | JWT doctor | the signed-in doctor's patients, paginated (`?limit= ?offset=`) |
| `PATCH/DELETE /api/appointments/:id` | JWT doctor | ownership-enforced (`WHERE id=? AND doctor_id=?`) |
| `GET /api/patients/:id` | JWT doctor | ownership-enforced patient read (404 if not yours) |
| `GET/POST/PATCH/DELETE /api/prescriptions[/:id]` | JWT doctor | full prescription CRUD, all doctor-scoped |
| `GET /api/schedule` | JWT doctor | logged-in doctor's working hours only |
| `GET/POST/DELETE /api/clinic-schedule[/:id]` | JWT | shared clinic day plan; anyone signed in can add or remove a meeting (no patient data in it) |
| `GET /api/assistant/me` | JWT | authenticated identity + doctor profile |
| `POST /api/assistant/chat` | JWT | `{message}` → intent → authorized tool → safe reply (+ card data) |
| `POST /api/tts` | JWT | NVIDIA NVCF TTS proxy → `audio/wav` (key stays server-side in `nvcf.key`) |
| `GET /api/tts/voices` | JWT | NVCF voice list for the Settings dropdown |
| `POST /api/assistant/demo-login` | none | demo sessions; ON by default, **set `DEMO_LOGIN=0` to disable** for a real deployment |
| `POST /api/auth/logout` | none | clears the session cookie (the token itself stays valid until it expires) |
| `GET /api/health` | none | liveness: server up, row counts, version |

## Wiring into your real RMS (no dashboard code included, by design)
1. **Auth:** replace `verifyJWT()` in `lib/auth.js` with your existing JWT/session verification
   (same secret/issuer). It must fill `req.user = { id, doctorId, role }`. Set `JWT_SECRET` to a long
   random value and set `DEMO_LOGIN=0` to turn off the demo users.
2. **Data:** keep your own DB — the tool layer (`tools` in `lib/tools.js`) is the only place that
   queries; every function scopes by the **authenticated** `doctorId` via `scopeDoctor()`. Point the
   prepared statements at your tables or port the 10-table schema (Architecture.md §3).
3. **Frontend:** copy `index.html` + `app.js` + `style.css` (the character + voice loop) into your
   dashboard page, or iframe/`fetch()` the endpoints — the UI never sends identity; it only sends
   `{message}`. Remember to add any new asset to the `STATIC` map in `lib/router.js`.
4. **CORS:** set `Access-Control-Allow-Origin` in `lib/router.js` to your dashboard origin.

Zero npm dependencies · Node ≥ 22.5 · SQLite via `node:sqlite`.

Before real use: set `DEMO_LOGIN=0`, set a long random `JWT_SECRET`, set `CORS_ORIGIN` to your
dashboard, and note that patient names, dates of birth and medications are sent to NVIDIA for speech —
see `Task.md`.

Docs: `implementation.md` · `Prd.md` · `Architecture.md` · `Design.md` · `Rules.md` · `Task.md` · `Memory.md`.
