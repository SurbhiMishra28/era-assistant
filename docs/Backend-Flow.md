# Era — Backend Flow: how the database is called & how the API works

> **v4.4.0** · companion to [Architecture.md](../Architecture.md) · every `file:line` link in this document was verified against the current source (2026-10-06).
> House style: no wall of jargon. Every section starts from what the machine is *actually doing*, then names the function.

## Contents

1. [The one-paragraph picture](#1-the-one-paragraph-picture)
2. [The big map](#2-the-big-map)
3. [Part A — How the database is called](#3-part-a--how-the-database-is-called)
4. [Part B — How the API works](#4-part-b--how-the-api-works)
5. [The one-line summary](#5-the-one-line-summary)

---

## 1. The one-paragraph picture

Era is a five-actor play. A **browser page** (`app.js`) captures the doctor's question and sends it as one small JSON object. An **Node server** (`server.js` → `lib/router.js`) receives it, checks *who is asking* (`lib/auth.js`), decides *what the question means* (`lib/brain.js`), and answers it from *one SQLite file* (`lib/database.js`), either directly or through `lib/tools.js`. The reply goes back as JSON, and the server also renders it as speech through NVIDIA Sofia (`lib/tts.js`). Every step leaves a row in the audit table.

> **The golden rule that holds the whole design together:** the database may only be touched from three files — [lib/tools.js](../lib/tools.js) (patient / appointment / prescription data), [lib/brain.js](../lib/brain.js) (clinic notice-board and health Q&A only), and [lib/router.js](../lib/router.js) (REST CRUD). Patient data is **always** scoped by the *authenticated* doctorId — never by anything the browser or the AI supplies.

---

## 2. The big map

```
 Browser (app.js)                    SERVER (one process)                        DISK
┌──────────────┐   HTTP+JSON   ┌──────────────────────────────────────┐   ┌─────────────┐
│  🎤/⌨️  ask() │ ────────────▶ │ server.js (front door)               │   │             │
└──────────────┘               │   └─▶ lib/router.js  handler() L56   │   │             │
                               │        ├─ lib/auth.js verifyJWT()    │   │             │
                               │        │      → turns req into a user│   │             │
                               │        ├─ lib/brain.js routeIntent() │   │             │
                               │        │      → which tool?          │   │             │
                               │        ├─ lib/tools.js  runTool()    │───┼─▶ db/era.db │
                               │        │      (the ONLY file that    │   │  (SQLite)   │
                               │        │       touches RMS tables)   │◀──┼── rows back │
                               │        └─ lib/router.js toolReply()  │   └─────────────┘
                               │             + audit() on every touch │
                               └──────────────────────────────────────┘
```

The request flows **down** one side and the data flows **back up** the same side. There is no queue, no worker, no second process — one Node process, one connection, one file.

---

## 3. Part A — How the database is called

### 3.1 Step 1 — One connection, opened with a parachute

The whole server runs on a single SQLite connection created with Node's **built-in** driver (this is why the project has zero npm dependencies):

```js
const {DatabaseSync}=require('node:sqlite');              // lib/database.js L4
...
for(const cand of [DB_FILE, path.join(__dirname,'..','db','era.db'), path.join(os.tmpdir(),'era.db')]){
 try{fs.mkdirSync(path.dirname(cand),{recursive:true});db=new DatabaseSync(cand);dbFile=cand;break}
 catch(e){console.warn(`[era] DB ${cand} unavailable ...`)}   // L13-18: the fallback chain
}
```

It tries three locations in order — the configured `ERA_DB` path, the repo's own `db/era.db`, then the OS temp directory — so the app boots anywhere (Render's free tier ships no persistent disk; the DB simply rebuilds and re-seeds). Two more opening rituals:

- [`PRAGMA foreign_keys = ON`](../lib/database.js#L21) — an appointment pointing at a non-existent doctor *must fail* (there is a test for this).
- The module ends with `module.exports={db,EraDB}` ([L113](../lib/database.js#L113)) — the connection is the export.

### 3.2 Step 2 — the require cache hands everyone the *same* `db`

Node loads a module **once** no matter how many files require it. `tools.js`, `brain.js` and `router.js` all begin with:

```js
const {db,EraDB}=require('./database');
```

…and all three receive the **identical connection object**. One schema, one source of truth, and no code path can accidentally open a second database. (The seed, migrations and the 10-table schema all live inside the same module — see the `CREATE TABLE` block and the seed at [L71](../lib/database.js#L71).)

### 3.3 Step 3 — every query is a prepared statement

Nothing in Era builds SQL by gluing strings together. Every statement uses `?` placeholders, and the driver binds the values:

| Call | Returns | Example |
|---|---|---|
| `.all(...)` | array of rows | `db.prepare('SELECT ... WHERE doctor_id=?').all(d)` |
| `.get(...)`  | one row or `undefined` | `db.prepare('SELECT ... WHERE id=? AND doctor_id=?').get(id,d)` |
| `.run(...)`  | change count / lastInsertRowid | `db.prepare("UPDATE ... SET status='cancelled' WHERE id=? AND doctor_id=?").run(id,d)` |

Because values are **bound**, never interpolated, an attack like `' OR '1'='1'; DROP TABLE appointments;--` arrives as a harmless *string value* — the security suite proves this in [TEST 8](../test/security.test.js) and the table survives.

### 3.4 Step 4 — the access ladder (who may touch what)

| Layer | Tables it touches | How it is scoped |
|---|---|---|
| [`scopeDoctor`](../lib/tools.js#L8) in **tools.js** | PHI: `appointments`, `patients`, `prescriptions`, `doctor_schedules`, `doctor_patients` | A doctor is **always** scoped to their own `doctorId`; only an `admin` may pass a `doctor_id` argument, and it is validated, not trusted |
| **brain.js** ([routeIntent](../lib/brain.js#L8)) | non-PHI only: `schedule` (clinic notice board), `ai_doctor` (health Q&A via [`scoreRows`](../db/db.js#L61)) | Safe for any signed-in role — there is no patient data in these tables |
| **router.js** REST CRUD | same PHI tables, direct queries | Ownership lives **inside the WHERE clause**: `WHERE id=? AND doctor_id=?` ([comment at L115](../lib/router.js#L115)) — never `WHERE id` alone |
| [`audit()`](../lib/router.js#L46) | `assistant_audit` | one row per action: who, what, which tool, success/failure, `request_id` |

If a query would return another doctor's row, the answer is a **404** — Era does not even confirm the row exists (no resource enumeration).

### 3.5 Step 5 — a real query's full journey

*"my appointments tomorrow"*, end to end:

| # | Where | What happens |
|---|---|---|
| 1 | [app.js:104](../app.js#L104) | `POST /api/assistant/chat` with `{message}` (cookie rides along) |
| 2 | [router.js:56](../lib/router.js#L56) | `handler()` matches method+path, mints a `request_id` |
| 3 | [auth.js:16](../lib/auth.js#L16) | `verifyJWT()` reads cookie/Bearer → user `{id:1, role:'doctor', doctorId:1}` |
| 4 | [router.js:256](../lib/router.js#L256) | `chat()` hands the message to the brain |
| 5 | [brain.js:8](../lib/brain.js#L8) | intent ladder matches `/appointments?/` → `{tool:'getMyAppointments', args:{date:'2026-10-07'}}` |
| 6 | [tools.js:93](../lib/tools.js#L93) | `runTool(u,'getMyAppointments',args)` |
| 7 | [tools.js:26](../lib/tools.js#L26) | `scopeDoctor(u)` → `1` → `db.prepare('...WHERE doctor_id=? AND appointment_date=?').all(1, date)` |
| 8 | SQLite | only Amit's rows come back — Rahul's and Priya's were filtered by the SQL itself |
| 9 | [router.js:303](../lib/router.js#L303) | `sanitize()` strips internal `doctor_id`/`patient_id` fields from the result |
| 10 | [router.js:285](../lib/router.js#L285) → [app.js:83](../app.js#L83) | `toolReply()` renders *"You have 2 appointments: …"* → `speak()` → Sofia's voice |

### 3.6 The write path — booking with a seatbelt

Writes add one guard before the `INSERT`: [`slotClash`](../lib/tools.js#L20) checks for **interval overlap**, not equal start times — a 09:00–10:30 appointment blocks a 09:30 booking (the old start-time-equality bug is pinned by regression tests). No clash → `INSERT` with `doctor_id` taken from auth (the body's value is ignored); clash → **409 `SLOT_TAKEN`**, and the chat error path *speaks the real reason* instead of a generic denial.

### 3.7 Every touch is recorded

[`audit()`](../lib/router.js#L46) wraps every meaningful action — login, tool runs, REST writes, denials, even the throttled attempts — into `assistant_audit` with the same `request_id` that the JSON reply carries. Debugging rule of thumb: *take the `request_id` from the response, find the matching audit rows.*

---

## 4. Part B — How the API works

### 4.1 There is no Express — just a handler ladder

One function receives **every** request, HTTP and HTTPS alike: [`handler()`](../lib/router.js#L56).

```js
const handler=(req,res)=>{ const {pathname:p}=url.parse(req.url,true);
 if(req.method==='OPTIONS') return json(res,204,{})       // CORS preflight → 204
 if(req.method==='GET' && p==='/api/health'){...}          // method + path must both match
 if(req.method==='POST'&&p==='/api/auth/login'){...}       // [L195]
 if(/^\/api\/appointments\/\d+$/.test(p)){...}             // :id extracted by regex
 ...}
```

Each line is a tiny router: match method + path → authenticate → do the work → `json()`. That is the whole framework.

### 4.2 The anatomy of every request

- **CORS** headers on every reply ([L17](../lib/router.js#L17)), origin from `CORS_ORIGIN` in `.env` (v4.4: configurable, was hardcoded before). `OPTIONS` is answered `204` with the allowed methods (PATCH and DELETE included).
- **Body reading** — [`readBody()`](../lib/router.js#L49) parses JSON and **destroys the connection above 100 KB**: cheap DoS protection.
- **Uniform reply shape**, always:

```json
{ "ok": true, "data": …, "request_id": "a1b2c3" }
{ "ok": false, "error": "SLOT_TAKEN", "message": "That time overlaps…", "request_id": "a1b2c3" }
```

- **Errors** — functions throw `httpErr(code, 'ERR_CODE', 'safe spoken message')`; [`restErr()`](../lib/router.js#L50) turns those into status codes. Anything 5xx logs server-side and returns a generic sentence — the real error never leaks to the client.

### 4.3 Authentication — two doors into the same token

| Door | Used by | How |
|---|---|---|
| `era_token` **cookie** | the bundled UI | `Set-Cookie` on login — `HttpOnly`, `SameSite=Lax`, `Secure` only when the connection is TLS |
| `Authorization: Bearer <jwt>` | curl / dashboards | minted by [`node token.js`](../token.js) |

[`verifyJWT()`](../lib/auth.js#L16) accepts either, checks the HMAC signature and expiry, and returns `{id, role, doctorId, name}`. Guards then gatekeep: [`requireAuth`](../lib/auth.js#L23) (401 without identity), [`requireRole`](../lib/auth.js#L24) (403 with the wrong role), [`requireDoctor`](../lib/auth.js#L25) (403 without a doctor profile). Identity comes **only** from the token — never from the request body or the AI's arguments.

The auth endpoints: [`POST /api/auth/login`](../lib/router.js#L195) (email + password → JWT **and** cookie; an unknown email auto-creates the account and logs straight in — that is why status 201 exists), [`POST /api/auth/logout`](../lib/router.js#L225) (clears the cookie), and [`POST /api/assistant/demo-login`](../lib/router.js#L234) (the five demo personas; `DEMO_LOGIN=0` turns it into a 404). Failed logins feed a **two-counter throttle** ([`tries`](../lib/router.js#L29): 8 per (IP+email), 30 per IP, 15-minute window) → **429** with `retry_after_s`.

### 4.4 The endpoint map

| Endpoint | Auth | Handler | Purpose |
|---|---|---|---|
| `POST /api/auth/login` | ❌ | [L195](../lib/router.js#L195) | email+password → JWT + cookie (auto sign-up on new email) |
| `POST /api/auth/logout` | ❌ | [L225](../lib/router.js#L225) | clears the session cookie |
| `POST /api/assistant/demo-login` | ❌ | [L234](../lib/router.js#L234) | `{who:"doctorA"…}` → demo session (switchable off) |
| `GET /api/assistant/me` | ✅ | [L228](../lib/router.js#L228) | identity + doctor profile |
| `POST /api/assistant/chat` | ✅ | [L256](../lib/router.js#L256) | **Era's heart** — `{message}` or `{tool,args}` |
| `GET /api/appointments` | 👨‍⚕️ | [L87](../lib/router.js#L87) | list, filters `?date= ?from= ?to= ?status= ?upcoming=1` |
| `POST /api/appointments` | 👨‍⚕️ | [L100](../lib/router.js#L100) | create — 409 on clash, `doctor_id` from auth |
| `GET/PATCH/DELETE /api/appointments/:id` | 👨‍⚕️ | ownership in WHERE | read/update/cancel, 404 if not yours |
| `GET /api/schedule` | 👨‍⚕️ | [L138](../lib/router.js#L138) | the doctor's own working hours |
| `GET/POST/DELETE /api/clinic-schedule[/:id]` | ✅ | [L142](../lib/router.js#L142) | shared clinic notice board (any staff) |
| `GET /api/patients[/:id]` | 👨‍⚕️ | [L153](../lib/router.js#L153) | the signed-in doctor's patients |
| `GET/POST/PATCH/DELETE /api/prescriptions[/:id]` | 👨‍⚕️ | [L162](../lib/router.js#L162) | full CRUD, doctor-scoped |
| `GET /api/tts/voices` · `POST /api/tts` | ✅ | [L62](../lib/router.js#L62) / [L72](../lib/router.js#L72) | Sofia-only voice list & synthesis proxy |
| `GET /api/health` | ❌ | [L60](../lib/router.js#L60) | liveness: row counts + version |

### 4.5 How the browser calls the API

One helper, used everywhere ([app.js:6](../app.js#L6)):

```js
const api=async(p,o={})=>{ const r=await fetch(p,{credentials:'same-origin',...o});
  return {status:r.status, data:await r.json()} };
```

- **chat** — [ask()](../app.js#L102) → `api('/api/assistant/chat', {method:'POST', body:…{message}})` ([L104](../app.js#L104))
- **voice** — [speak()](../app.js#L83) posts `{text, voice}` to `/api/tts` ([L88](../app.js#L88)), receives a WAV **blob**, plays it with `new Audio(URL.createObjectURL(blob))`
- **identity** — `/api/assistant/me` on startup; a 401 drops the user back to the login card
- **demo login** — [demoLogin()](../app.js#L9)

Note what the browser *never* does: touch SQLite, build SQL, or assert its own identity. It sends `{message}` — the server decides everything else.

### 4.6 Testing by hand (no UI)

```bash
node token.js doctorA        # mint a JWT (doctorB | doctorC | admin | reception)
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/assistant/me

curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"message":"my patients"}' http://localhost:8000/api/assistant/chat
```

### 4.7 The chat endpoint's two modes

1. **`{message}`** — the spoken/typed path: [routeIntent](../lib/brain.js#L8) picks the tool, [`pickDateTime`](../lib/brain.js#L74) pulls the date/time/patient out of the sentence ("tomorrow at 4pm for Ravi" → `{date, start_time:'16:00', patient_name:'Ravi'}`).
2. **`{tool, args}`** — the dashboard-button path: the named tool runs directly, still authorized inside [chat()](../lib/router.js#L256).

A user **without** a doctorId asking for doctor data gets **200 + `denied:true`** with a friendly sentence — a raw 403 would be bad UX, so the tool layer enforces the denial anyway. Non-doctor data (clinic schedule, health Q&A) is served to every role.

### 4.8 Status-code cheat sheet

| Code | Meaning in Era | Typical source |
|---|---|---|
| 200 | done (including polite denials with `denied:true`) | chat, reads |
| 201 | created — including "that email was new, account made" | login, POSTs |
| 400 | the request itself is malformed | validation guards |
| 401 | sign in first | `requireAuth` |
| 403 | wrong role / no doctor profile | `requireRole`, `requireDoctor` |
| 404 | **not yours** (existence not even confirmed) | ownership-in-WHERE reads |
| 409 | slot clash / duplicate meeting | `slotClash`, `createMeeting` |
| 429 | login throttled (too many attempts) | two-counter throttle |
| 502 | NVIDIA voice upstream failed | TTS proxy |

---

## 5. The one-line summary

> **The API is one handler ladder that authenticates first and dispatches second; the database is one connection touched only through `?`-placeholder queries scoped by the authenticated doctorId — and every touch leaves an audit row.**

*Related reading: [Architecture.md](../Architecture.md) · [Features-and-Flows.md](Features-and-Flows.md) · [../test/security.test.js](../test/security.test.js) (the 40 guards that pin all of this down).*
