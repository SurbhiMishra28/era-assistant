# Architecture.md — How Era Is Put Together

**Version:** 4.4 · **Last updated:** 2026-10-05

## 1. The shape

One web page and one Node.js server. No packages to install.

```
era-assistant/
├── index.html          the whole interface: sign-in card, character, settings
├── app.js              sign-in, greeting, voice in and out, asking the server questions
├── style.css           all styling and animation
├── server.js           entry point: starts the server, optional HTTPS, exports for tests
├── lib/
│   ├── env.js          settings; loads .env first so it always wins over shell values
│   ├── auth.js         password hashing, signing and checking tokens, role checks
│   ├── database.js     opens SQLite, creates tables, fills sample data
│   ├── tools.js        the only code that reads clinic data
│   ├── brain.js        turns a sentence into a tool call
│   ├── tts.js          asks NVIDIA for audio, retries, caches
│   └── router.js       endpoints, CORS, audit log, static files, chat
├── db/
│   ├── db.js           the 15 health answers, matching, shared date helpers
│   └── era.db          the database, created on first run
├── test/security.test.js   40 checks
├── render.yaml         reproducible cloud deploy
├── docs/               long-form guides and PDFs (Features-and-Flows, simple version)
├── assets/era3d.png    the character image
├── certs/              optional self-signed certificate (not committed)
├── tts-grpc.py         backup voice path when the normal one is down
├── start-era.cmd       Windows script that restarts the server if it stops
├── nvcf.key            NVIDIA key (not committed)
└── .env                settings (not committed)
```

`server.js` used to hold everything. It was split in version 4.2 so each job sits in one readable
file. The order they depend on is one way only: `router` uses all the others, `env` is used by all.

## 2. What happens when a doctor asks something

```
sign in
  → the server checks the cookie and remembers the user
  → Era greets them by name (once per login)
  → doctor asks by voice or types
  → POST /api/assistant/chat
  → routeIntent() reads the sentence, picks a tool
  → the tool queries the database, limited to that doctor's ID
  → internal IDs are removed from the result
  → the reply text goes to POST /api/tts
  → the server asks NVIDIA for audio, gets a WAV file, sends it back
  → the browser plays it
```

Two things matter here. First, the browser holds no answers of its own — every clinic question goes
to the server. Second, the server never trusts the browser about who the doctor is.

## 3. The database

**Engine:** SQLite through Node's built-in `node:sqlite`. Node 22.5 or newer. Nothing to install. One
`ExperimentalWarning` line at start is normal.

**File:** `db/era.db`, created and filled on first run.

**Where it looks for the file.** Three places, in order: the path in `ERA_DB`, then `db/era.db` in the
project, then the system temp folder. Each one is tried with the folder created if needed, and
whichever works is printed at start. Cheap cloud hosting often has no permanent disk, and this is why
the app still starts there instead of crashing and restarting forever.

**Tables:**

| Table | Sample rows | What it holds |
|---|---|---|
| `ai_doctor` | 15 | Health question, keywords, answer |
| `schedule` | 4 | Shared clinic day plan |
| `users` | 5 | Name, role, email, hashed password |
| `doctors` | 3 | Links a user to a doctor record, plus specialty |
| `patients` | 5 | Name, date of birth, phone |
| `doctor_patients` | 5 | Which doctor looks after which patient |
| `doctor_schedules` | 4 | Weekly working hours |
| `appointments` | 4 | Date, time, status, reason |
| `prescriptions` | 2 | Medication, dose, instructions |
| `assistant_audit` | grows | Every action, with who and when |

**Indexes:** eight, on the columns that get filtered — appointment by doctor, by date, by both,
schedule by doctor, patient link by doctor and by patient, prescriptions by doctor and by doctor
plus patient.

**Safety:** foreign keys are switched on, so an appointment cannot point at a doctor who isn't there.
Status and role columns have `CHECK` limits, so only valid values can be stored.

**Sample data is filled in every time the app starts.** The 15 health answers are updated from
`db/db.js` (that file is the source of truth). Everything else is only inserted when its table is
empty, so real data is never overwritten. The four sample appointments are moved onto today and
tomorrow each start, so "what do I have tomorrow" never answers empty.

**Matching (`scoreRows`, in `db/db.js`):** a phrase that appears in the question scores 2 points; a
single word scores 1 if it matches exactly or is the start of a 4-letter-or-longer word. Highest score
wins. No match means no answer. This is why "what is the weather" doesn't turn up the diet answer.

## 4. What the browser stores

Only settings, under `era_settings` in local storage: name, whether Era speaks, whether she greets,
and the voice choice. The greeting flag lives in session storage so it disappears with the tab and
fires once per login. Clearing storage resets to defaults.

## 5. Browser features used

| Feature | Used for | If it's missing |
|---|---|---|
| Web Speech `SpeechRecognition` | Microphone input | Era says to use Chrome or Edge; typing still works |
| `fetch` | Talking to the server | A clear "cannot reach the clinic server" message |
| `localStorage` / `sessionStorage` | Remembering settings | try/catch wrapper, so nothing breaks in private mode |
| `<dialog>` | Settings window | Native element, no library |
| `Audio` | Playing the returned WAV | Fails silently to the status line |

The browser's own speech voices are deliberately not used. All sound comes from NVIDIA.

## 6. Signing in and permissions

```
sign in → token → check token → /api/assistant/chat → pick tool
  → query limited to that doctor's ID → remove internal IDs → reply → dashboard
```

- **Identity** comes from one place only: `verifyJWT()` in `lib/auth.js`, reading the signed cookie or
  an `Authorization: Bearer` header. Never from the page, the query string, or anything an AI tool is
  told.
- **Roles.** `requireAuth` checks there is a valid token. `requireRole` checks the role.
  `requireDoctor` returns the doctor's own ID and refuses anyone without one. `scopeDoctor()` in
  `lib/tools.js` is the single place that decides which doctor a query is about: a doctor is always
  pinned to their own ID, and only an admin may name a different one.
- **Tools.** `getMyAppointments`, `getMySchedule`, `getMyPatients`, `getAppointmentDetails`,
  `getAvailableSlots`, `getMyProfile`, `getMyPrescriptions`, and the three writes
  `createAppointment`, `rescheduleAppointment`, `cancelAppointment`. Every one uses bound parameters,
  re-checks ownership, and returns a taken-slot error rather than overwriting.
- **Chat.** `routeIntent(sentence, user)` maps language to a tool, then runs it through that same tool
  layer. There is one permission path whether the request came from the page or from the assistant.
- **Less data out.** Queries are limited and paginated. `sanitize()` removes `doctor_id` and
  `patient_id` from anything returned. It does not remove patient names, dates of birth or
  medications, and that text is sent to the voice service — see *Where it can grow*.
- **Audit.** Every chat, tool call, login and refusal is written with the user, doctor, action, tool
  name, request ID, and whether it worked. Message text is not stored.
- **Errors.** Each failure says what actually went wrong. A refusal is a 403 or 404; a taken slot is a
  409; a bad request is a 400. Never SQL, never a stack trace, never another doctor's data.
- **No double-booking.** `slotClash()` in `lib/tools.js` checks real interval overlap, so a long
  appointment blocks every time inside it. It is used by the AI tools and the REST endpoint alike.
- **Throttling.** Failed sign-ins are counted per `(IP + email)` and per IP. Only a success for that
  account clears its own counter.
- **Dates are local.** `localDay()` / `localTime()` in `db/db.js` are the only date source. UTC would
  report the early morning as yesterday on an IST machine.
- **One rule.** `lib/tools.js` is the only file that reads clinic tables. Everything else goes
  through it. The one exception is the shared `schedule` table, which has no doctor and no patient
  data — it is readable and writable by anyone signed in.

**Plugging in a real clinic system:** replace `verifyJWT()` with your own sign-in check, point
`lib/tools.js` at your tables, set `CORS_ORIGIN` to your dashboard's address, set `JWT_SECRET` to a
long random value, and set `DEMO_LOGIN=0`.

## 7. Where it can grow

1. **A real AI model.** `lib/brain.js` is one function. Replace it with a model that can call tools.
   Permissions and audit stay exactly as they are — that is the point of keeping them separate.
2. **A bigger database.** The health answers map one-to-one onto a normal table. Swap `DatabaseSync`
   for a Postgres client behind the same endpoints; the page does not change.
3. **A real calendar.** The `schedule` table already has add and remove (`/api/clinic-schedule`).
   Replace its source with calendar events mapped to `{time, type, title}`.
4. **Keeping patient data off the voice service.** The reply text goes to NVIDIA, and it contains
   patient details. A mode that reads numbers back without names would close this.
5. **A shared throttle.** Move the in-memory login counter to Redis or the database so it survives a
   restart and works across machines.

## 8. Running it

```
node server.js          # or npm start
npm test                # the 40 checks
```

HTTP on port 8000. HTTPS on 8443 when `certs/` has a certificate. The server can be started by
`start-era.cmd`, which restarts it three seconds after it stops.

The same folder is pushed to GitHub (`main`) and runs live on Render
(https://era-assistant.onrender.com) — build runs the tests, start runs the server. The free tier
sleeps after ~15 idle minutes and wipes its disk on redeploys; the fallback chain re-seeds the
database on the next start.