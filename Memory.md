# Memory.md — Things Worth Knowing About Era

**Version:** 4.4 · **Last updated:** 2026-10-05

Read this before changing `app.js`, anything in `lib/`, or `db/db.js`.

## 1. What this project is

One folder, no packages to install: a web page and a small Node.js server with a local database. A
doctor signs in, a 3D character greets them, and they ask questions by voice or by typing. Answers
come from that doctor's own clinic data and from a list of 15 general health answers, then get spoken
in NVIDIA Sofia's voice.

The same folder is pushed to GitHub (`main`) and deployed on Render
(https://era-assistant.onrender.com). Render's free tier sleeps after ~15 idle minutes and wipes its
disk on redeploy — the database fallback chain re-seeds it on the next start.

The browser holds no answers of its own. Everything goes to `/api/assistant/chat`, which decides what
to do and runs the query with the right permissions.

## 2. Why things are the way they are

| Decision | Reason |
|---|---|
| No npm packages | Project rule. Node's built-in tools are enough. |
| `package.json` sets `"type": "commonjs"` | A folder higher up has `"type": "module"`, which broke the server. The project-local setting wins. Don't remove it. |
| Keyword scoring rather than one rule per topic | 15 topics times many phrasings would explode into dozens of rules. Scoring gives a best match that degrades gracefully, and a clean "no match" when nothing fits. |
| Health answers looked up after clinic questions | "How many appointments today" has no health words in it, but one over-eager keyword could still steal it. Checking clinic questions first makes the order predictable. |
| Words match whole words, or start a word of 4+ letters | An earlier version matched anywhere in the text, so "w**eat**her" hit the diet answer. This fixed that whole class of bug. Prefixes still catch "vaccine" from "vaccines". |
| Only settings are stored in the browser | The chat log and the schedule editor were removed along with the chat panel. |
| Greeting mentions what Era can do | Otherwise nobody discovers the health answers. |
| Replies are spoken, not printed | The user wanted the character, not a chat screen. A hidden region keeps it accessible when the sound is off. |
| Greeting uses session storage, not local storage | The user asked for "once per login session". Session storage dies with the tab, so a refresh is quiet but a new sign-in greets again. |
| `.env` beats shell values | This machine exports junk like `PORT=0`, which broke the first launch. The file is the only source of truth. |
| Demo sign-in is a switch, not a side effect | It used to turn itself off whenever a real secret was set. That silently killed the demo buttons on the sign-in card — the screen was offering something that no longer worked. Now it's an explicit choice, on by default. |
| `SOFIA_VOICES` lives in one place | It was written down twice, once for the voice list and once for the refusal check. They drifted. One owner, both readers. |
| The retry and caching code is its own file | The router used to own it, which is why a bug hid in there after the split. It now returns both the audio and the list of things that went wrong. |
| Sample appointments move to today and tomorrow on every start | They were set once when the database was first created and then froze. "What do I have tomorrow" answered empty forever after. |
| HTTPS uses the same request handler, not the same server object | Passing a server instance to `https.createServer` throws at startup. That bit us live. |
| The watchdog script must use Windows line endings | Batch files misfire on line feeds. And it must be launched by full path. |
| SQLite adds missing columns but never removes any | Someone's real data must survive an upgrade. |
| Submission guides and PDFs live in `docs/` | Sheets and reviews need long-form and simple-language versions; they are snapshots, so they go stale when the core docs change. |

## 3. Gotchas that will cost you time

**Fixed in 4.4 — understand why, so they don't come back:**

- **`pickDateTime()` in `lib/brain.js` is what makes voice booking work.** It pulls the date, time and
  patient name out of a sentence. Look for `am`/`pm` *before* trying the 24-hour pattern, or "3:30 pm"
  is read as 03:30. Match the number and its meridiem together, or "3pm" with no space is missed.
- **Reschedule is matched before booking.** "move appointment 3 to tomorrow" contains words the
  booking rule likes, so the reschedule pattern must come first or it books instead of moving.
- **`slotClash()` is the only way to check a slot is free.** It compares intervals. The old
  `start_time=?` test let a 09:00–10:30 appointment be overlapped by a 09:30 one. Both `lib/tools.js`
  and the REST endpoint must use it.
- **`localDay()` / `localTime()` are the only date source.** `toISOString()` and SQL's `date('now')`
  are UTC; this box is IST and rolls over at 05:30, so the early morning read as "yesterday".
- **`httpErr` messages are meant to be spoken aloud.** Say them. The chat handler used to answer "I
  can only access information available to your RMS account" for every failure, so a taken slot sounded
  like a permissions problem.
- **The login throttle needs two counters.** Per `(IP + email)` stops one account being guessed; per IP
  stops spraying. Only a success clears its own account's counter — clearing the per-IP one on success
  lets any colleague behind the same NAT re-arm an attacker's budget.
- **`token.js` persona names must match `lib/database.js`'s seed.** They drifted once (Dr. Sharma /
  Dr. Verma) and the CLI exited 1 for every persona.
- **The test runner awaits async tests now.** Before that, a failing async test still printed PASS. If
  you add an HTTP test, return the promise — `t()` tracks it.

**Still true, and easy to trip over:**

- **Patient details reach NVIDIA's cloud for speech.** Names, dates of birth, medications. `sanitize()`
  strips internal IDs only. This is the biggest open risk.
- **A token stays valid for 8 hours after the cookie is cleared.** Logout cannot revoke it.
- **Sign-in also signs people up.** An unknown email plus any 4-character password becomes a new
  doctor account. Don't restore a separate register step — that was a deliberate choice — but do know
  this endpoint will create accounts for anyone.
- **The sign-in throttle is in-memory.** It resets on restart and does nothing across two machines.
- **There is no confirmation before a write,** so a misheard number can cancel a real appointment.
- **A booking sentence that is missing the time fails outright** — no follow-up turn asks for it.
- **Duplicate-column errors say "duplicate column name",** not "already exists". The migration code
  has to catch both spellings or the second start crashes. This caused a restart loop once.
- **Staff who aren't doctors get a friendly "you can't see that"** with a 200 status, not a 403. That
  was deliberate — a raw 403 in the console confused the user. Note they still get the shared clinic
  schedule answered normally, which is not a denial.
- **Prefix matching needs 4 letters or more,** otherwise "wa" matches both "walk" and "water".
- **Keywords are stored lowercase.** Keep them that way.
- **Don't put clinic logic back into `app.js`.** Answers come from the server only.
- **The refused state is now used.** `app.js` passes a resting state into `speak()` and asks for
  `'denied'` when the server refuses, so the red rings in `style.css` finally show.
- **`index.html` no longer loads `db/db.js`** — it was unhooked, and `app.js` bumped to `?v=4.3.0`,
  in a change that was not mine, partway through the 4.4 session. So `window.EraDB` no longer exists
  in the browser, and `ask()` / `findAnswerFallback()` in `db/db.js` are dead code. `/api/qa` still
  answers as a raw endpoint but nothing in `app.js` calls it. Nothing breaks either way: `app.js`
  never referenced `EraDB`. An earlier note here claimed this removal had happened *and* that
  `/api/qa` was gone — both were wrong at the time.
- **There is no character if the image is missing.** The drawing fallback was removed in 3.7.2.
- **The lip-sync code does nothing.** The character is a picture now. The mouth-shape, blink and
  eyebrow helpers find no elements and quietly do nothing.
- **Any new file the browser needs must be added to the static list** in `lib/router.js`, or it will
  404.
- **Deleting browser storage resets the settings.** That's intended.
- **The microphone doesn't work from a file on disk.** Chrome blocks it. Always go through the server.
- **`era-server.log` is output, not data.** Safe to delete.
- **All 15 health answers carry a "see a doctor" pointer now,** and a test fails if one is added
  without it. The pointer is hand-written into each answer; the server does not add one.
- **Testing a cloud deploy takes patience.** After ~15 idle minutes the first request waits
  30–50 s for the wake-up, and the database may be freshly re-seeded — don't mistake that for data
  loss on your machine. `render.yaml` now holds the build and start commands.

## 4. This machine

- Windows. The server runs as `node server.js` on port 8000, output going to `era-server.log`. Kill
  the old listener first or the port clashes.
- Node 24, Python 3.13. Node 22.5 or newer is required, for the built-in database.
- `db/era.db` is real data — it regenerates if deleted, after a backup. Tests never touch it; they use
  `db/era.test.db` through the `ERA_DB` setting.
- **Editing server code needs a restart.** The running process keeps the old code, so testing against
  it fails even when your change was right. That cost a debug loop once.
- Checking work: `node --check` on every file, then `npm test`, then hit the running server.
- The health answer check: fever, diet and blood pressure should match; weather and clinic questions
  should not.

## 5. Picking up where you left off

1. Read `Task.md`. The open items are at the bottom.
2. Fix the broken things in section 3 before adding anything new on top of them.
3. If a health answer misfires, check for two things: two answers sharing a keyword, and the order
   clinic questions are checked in.
4. When behaviour changes, change the documents in the same pass. Bump the version and date at the
   top of each one you touch.
5. If code and a document disagree, one of them is wrong. Fix whichever it is — don't leave them
   disagreeing.