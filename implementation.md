# implementation.md — What Era Is Built From

**Version:** 4.4 · **Last updated:** 2026-10-05

Era is a voice assistant for a clinic. A doctor signs in, asks a question out loud or types it, and
Era answers using only that doctor's own clinic data, then speaks the reply in one voice (NVIDIA
Sofia).

This file lists what exists today. Where something is planned but not built, it says so.

## 1. Main features

| # | Feature | How it works |
|---|---------|--------------|
| 1 | Login | Type an email and password. A new email is registered automatically. Five demo users are one click away (Dr. Amit, Dr. Rahul, Dr. Priya, Admin, Front Desk). |
| 2 | Demo switch | The demo users can be turned off with `DEMO_LOGIN=0` in `.env`. They are on by default so the start screen never shows dead buttons. |
| 3 | Password safety | Passwords are hashed with scrypt before saving. Plain text is never stored. |
| 4 | Session token | After login the server issues a signed token that lasts 8 hours and is kept in a cookie. No valid token means no data. |
| 5 | Roles | Three roles: `doctor` (own data only), `admin` (may ask for a specific doctor), `reception` (health questions only). The role is checked inside every database query, not just in the page. |
| 6 | Database | SQLite, built into Node.js, so there is nothing to install. 10 tables. The file is created and filled with sample data on first start. |
| 7 | Appointments | List by day, book, reschedule, cancel. Every query is limited to the signed-in doctor. A taken slot is refused on **overlap**, so a long appointment can't be double-booked by one starting inside it. |
| 8 | Free slots | Reads the doctor's weekly hours, hides everything already booked, and shows what is left in 30-minute steps. |
| 9 | Patients and prescriptions | A doctor sees only the patients linked to them and the prescriptions they wrote. |
| 10 | Chat brain | Every question goes to one endpoint. A rule-based router reads the sentence and picks an action: next appointment, book, reschedule, cancel, appointment details, free slots, patients, prescriptions, profile, meetings, schedule, or a health question. Booking sentences have their **date, time and patient name read out of the message**, so one spoken sentence is enough. |
| 11 | Meetings | "Add a meeting called Review at 3 pm" adds it to the shared clinic schedule. The schedule has no doctor ID — it is a clinic-wide notice board with no patient data. |
| 12 | Health answers | 15 ready answers stored in the database (fever, blood pressure, diabetes, sleep, diet, stress and more). The server scores them by word match and speaks the best one. All 15 carry a "see a doctor" pointer, written into each answer. |
| 12 | Voice | NVIDIA cloud voice **Sofia** — English and हिन्दी. The language is picked for each reply on its own. The API key never leaves the server. |
| 13 | Voice reliability | Tries 3 times over HTTP, then 2 times through a gRPC backup. Audio is checked before it plays. The last 20 replies are kept in memory so repeats are instant. |
| 14 | Voice-first screen | A 3D character image, moving wave bars, and a status line (Ready / Listening / Thinking / Speaking). Microphone input plus a typing box. One spoken greeting per login. |
| 15 | Privacy | Internal IDs (`doctor_id`, `patient_id`) are removed from every reply before it leaves the server. Chat text is not written to the audit log beyond a short prefix. |
| 16 | Audit log | Every login, chat, tool call and refusal is recorded with who, what, when, and a request ID. |
| 17 | Friendly errors | Each failure says what actually went wrong — taken slot, wrong request, or someone else's data. No raw error codes, no SQL. |
| 18 | Sign-in protection | Repeated wrong passwords are counted per account and per address. Past the limit the server answers "try again shortly" without even checking the password. |
| 19 | Safe hosting | The database tries three locations in order, so the app starts even where the disk is read-only. It also starts an HTTPS copy on port 8443 when certificates are present, and the session cookie is marked secure there. A `render.yaml` makes the cloud deploy reproducible. |
| 20 | Automatic tests | **40 checks** (`npm test`) on a throwaway database. 18 test the clinic rules; 22 drive the real server over a socket to cover sign-in, cookies, permissions, throttling and the fixes listed below. |
| 21 | No npm packages | Pure Node.js 22.5 or newer. No frameworks. Plain HTML, CSS and JavaScript on the front. A small watchdog script restarts the server if it stops. |
| 22 | Right time zone | "Today" and "tomorrow" use the computer's own calendar date, not UTC. On an IST machine the UTC clock rolls over at 05:30, which used to make Era call the morning "yesterday". |

## 2. Files

```
era-assistant/
├── index.html         one page: login card, character, settings
├── app.js             sign-in, greeting, voice in/out, talking to the server
├── style.css          all styling and animation
├── server.js          thin entry point: starts HTTP + HTTPS, exports for tests
├── lib/
│   ├── env.js         settings, loads .env (must be loaded first)
│   ├── auth.js        password hashing, tokens, role checks
│   ├── database.js    opens SQLite, creates tables, fills sample data
│   ├── tools.js       the only code that reads clinic data
│   ├── brain.js       turns a sentence into a tool call
│   ├── tts.js         talks to NVIDIA, retries, caching
│   └── router.js      HTTP endpoints, audit log, static files
├── db/
│   ├── db.js          sample health answers + matching, used by the server
│   └── era.db         the database (created on first run)
├── test/security.test.js   the 40 checks
├── assets/era3d.png   the character
├── certs/             optional self-signed certificate for HTTPS
├── tts-grpc.py        backup voice path
├── start-era.cmd      Windows auto-restart watchdog
└── nvcf.key           NVIDIA key (never committed)
```

## 3. How a question flows

```
doctor signs in
   → server checks the token, remembers who they are
   → doctor asks "what appointments do I have tomorrow?" (voice or typed)
   → POST /api/assistant/chat
   → routeIntent() reads the sentence and picks a tool
   → the tool runs a database query limited to that doctor's ID
   → internal IDs are removed
   → reply text is sent to POST /api/tts
   → server asks NVIDIA for audio → WAV file → browser plays it
```

The browser never decides what a doctor is allowed to see. It only sends the question.

## 4. Database

SQLite file `db/era.db`, opened through Node's built-in `node:sqlite`. There is one `ExperimentalWarning`
line at start — that is expected.

| Table | Sample rows | What it holds |
|---|---|---|
| `users` | 7 | Names, roles, emails, hashed passwords |
| `doctors` | 5 | Links a user to a doctor record and specialty |
| `patients` | 5 | Name, date of birth, phone |
| `doctor_patients` | 5 | Which doctor looks after which patient |
| `doctor_schedules` | 4 | Weekly working hours |
| `appointments` | 4 | Date, time, status, reason |
| `prescriptions` | 2 | Medication, dose, instructions |
| `assistant_audit` | grows | Every action taken |
| `ai_doctor` | 15 | Health questions and answers |
| `schedule` | 4 | Shared clinic day plan |

Eight indexes keep the common lookups fast. Foreign keys are switched on, so an appointment cannot
point at a doctor who does not exist.

**Where the file goes.** The server tries `ERA_DB`, then `db/era.db` in the project, then the system
temp folder. Whichever works is printed at start. This is why the app still boots on cheap cloud
hosting with no permanent disk.

**Old databases.** If the file was made before version 3.1 it gets extra columns added on start. Old
data is never deleted.

## 5. Endpoints

| Endpoint | Who can call it | What it does |
|---|---|---|
| `POST /api/auth/login` | anyone | Email and password → token cookie |
| `POST /api/auth/logout` | anyone | Clears the cookie |
| `POST /api/assistant/demo-login` | anyone, unless `DEMO_LOGIN=0` | Signs in as a sample user |
| `GET /api/assistant/me` | signed in | Who am I |
| `POST /api/assistant/chat` | signed in | Question → answer |
| `GET /api/appointments` | doctor, admin | List, with day and status filters |
| `POST /api/appointments` | doctor, admin | Book. A slot that **overlaps** an existing appointment is refused |
| `GET/PATCH/DELETE /api/appointments/:id` | doctor, admin | Read, move, or remove one appointment |
| `GET /api/patients`, `GET /api/patients/:id` | doctor, admin | Only that doctor's patients |
| `GET/POST/PATCH/DELETE /api/prescriptions[/:id]` | doctor, admin | Full prescription records |
| `GET /api/schedule` | doctor, admin | That doctor's weekly hours |
| `GET /api/clinic-schedule` | signed in | The shared clinic day plan (meeting and appointment times) |
| `POST /api/clinic-schedule` | signed in | Add a meeting, e.g. `{time:"15:00", title:"Review"}` |
| `DELETE /api/clinic-schedule/:id` | signed in | Remove a meeting from the shared plan |
| `POST /api/tts` | signed in | Text → audio |
| `GET /api/tts/voices` | signed in | Which voices are available |
| `GET /api/health` | anyone | Server check: is it up, row counts, version |

## 6. Tests

`npm test` runs 40 checks on a separate database file, so your real data is never touched.

- **10 checks follow the clinic spec:** a doctor sees only their own rows, a doctor ID in the request
  is ignored, another doctor's appointment cannot be read, moved, or deleted, a missing token is
  refused, injection attempts do nothing, and "show me Dr. Rahul's appointments" cannot cross doctors.
- **8 more cover the clinic rules:** password hashing, foreign keys, per-doctor separation, ID
  removal, cross-doctor cancellation, prescription scoping, and booking by name.
- **12 drive the real server over a socket:** no token is a 401, sign-in returns a cookie, `/me`
  reads it back, another doctor's row is a 404 and survives a delete attempt, front desk gets a
  friendly refusal, CORS carries the right methods, repeated bad passwords hit the throttle, a
  non-Sofia voice is refused, demo sign-in honours its switch, and static files are served fresh.
- **10 are regression tests** for the bugs fixed in 4.4, so they cannot come back quietly: voice
  booking really books, reschedule routes correctly, 12-hour times are not misread, overlapping
  bookings are refused, free slots hide times inside a long appointment, errors speak the real reason,
  meetings can be added, dates use the local day, and every health answer has a safety pointer.

All 40 pass.

## 7. What is still open

Being straight about the rest, so nobody is surprised:

- **Patient details go to NVIDIA.** Names, dates of birth and medications are part of the reply text
  that gets sent for speech. Only internal IDs are stripped. Needs a decision before real patient data
  is used.
- **Signing out does not cancel a token** that was already issued. The cookie is cleared, but the
  token stays valid until it expires.
- **Anyone can create an account** by using a new email, and it becomes a doctor straight away. There
  is no email verification.
- **The sign-in throttle is in-memory,** so it resets when the server restarts and doesn't work across
  several machines. Fine for one box; not a substitute for a real firewall.
- **The character has no lip sync and no backup picture.** She is an image, so her mouth doesn't move.
- **The browser's offline copy of the health answers is unused,** so the page needs the server for
  everything.
- **The generated PDFs in `docs/` are out of date** — they were built from the older text.

## 8. Swapping in a real system

1. **Real sign-in:** replace `verifyJWT()` in `lib/auth.js` with your own check. It must fill in the
   user ID, doctor ID and role.
2. **Real database:** `lib/tools.js` is the only file that reads clinic data. Point those queries at
   your tables. The pages do not change.
3. **A real AI model:** `lib/brain.js` is the one function to replace. Tools, permissions and audit
   stay exactly as they are.
4. **Turn the demo off:** set `DEMO_LOGIN=0`, set `JWT_SECRET` to a long random value, and set
   `CORS_ORIGIN` to your dashboard's address.
5. **Add HTTPS:** put a certificate and key in `certs/`. The server starts a secure copy on 8443 and
   marks the session cookie secure there.

## 9. Settings you can change (`.env`)

| Setting | Default | What it does |
|---|---|---|
| `PORT` | 8000 | The web address |
| `HTTPS_PORT` | 8443 | The secure address, when a certificate exists |
| `JWT_SECRET` | a demo value | Signs the session tokens. **Set this.** |
| `DEMO_LOGIN` | `1` | `0` turns off the five demo users |
| `CORS_ORIGIN` | `http://localhost:5500` | Which dashboard origin may call the API |
| `LOGIN_MAX_ATTEMPTS` | 8 | Wrong passwords allowed per account before a pause |
| `LOGIN_IP_MAX_ATTEMPTS` | 30 | Wrong passwords allowed per address, never reset by a success |
| `LOGIN_WINDOW_MS` | 900000 | How long that count is remembered |
| `ERA_DB` | `db/era.db` | Where the database file lives |
| `NVIDIA_API_KEY` | — | The NVIDIA key, if not using `nvcf.key` |