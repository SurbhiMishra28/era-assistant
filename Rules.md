# Rules.md — How to Work On Era

**Version:** 4.4 · **Last updated:** 2026-10-05

## 1. Rules that must not be broken

1. **No npm packages.** Node's built-in tools only — `node:http`, `node:sqlite`, `node:fs`, `node:crypto`.
   No frameworks, no bundlers, no packages. If something can't ship without tooling, ask first.
1b. **Server code is CommonJS.** `package.json` sets `"type": "commonjs"` on purpose, because a folder
   higher up has `"type": "module"` and would otherwise break the server. Don't remove it.
2. **One page.** Everything lives in `index.html`. Don't add pages or routing.
3. **Privacy.** All sound comes from NVIDIA cloud text-to-speech, through our own `/api/tts` — that is
   the only voice path and it was agreed with the user. The key lives in `NVIDIA_API_KEY` or the
   gitignored `nvcf.key`, and never reaches the browser or the log. Nothing else leaves the machine:
   no analytics, no other outside calls. Loading web fonts is fine. Microphone **input** stays local in
   the browser.

   ⚠️ Reply text sent to NVIDIA includes real patient details — names, dates of birth, prescriptions.
   That is a known, unaddressed risk. Treat it as something to fix, not something to copy.
4. **Medical safety.** Era never diagnoses. Each health answer must point to a doctor for anything
   urgent. This is done by writing it into the answer, not by the server adding it — so if you write a
   new row, include the pointer yourself. All 15 rows have one now; there is a test that fails if any
   row is missing it.
4b. **Security.** Identity comes only from `verifyJWT`. Every tool re-checks ownership through
   `scopeDoctor()`. SQL always uses bound parameters. Never log message text or secrets. Never put
   SQL, stack traces or internal IDs in an error. Demo sign-in is controlled by `DEMO_LOGIN`
   (`1` on, `0` off; on by default).
4c. **Never double-book.** Use `slotClash()` from `lib/tools.js` for every booking and rescheduling
   path. It checks real interval overlap. Do not go back to comparing `start_time` for equality — that
   let a 09:00–10:30 appointment be overlapped by a 09:30 one.
4d. **Speak the real error.** An `httpErr` message is written to be safe to say out loud, so say it.
   The chat handler used to answer "I can only access information available to your RMS account" for
   every failure, which turned a taken slot into a fake permissions message. Never do that again: a
   refusal means a 403 or 404, nothing else.
4e. **Dates are local.** Use `EraDB.localDay()` / `localTime()` from `db/db.js`, never
   `toISOString()` or SQL's `date('now')`. This box is IST, where UTC rolls over at 05:30 — that used
   to make the early morning "yesterday". All date comparisons now pass a bound local string.
4f. **Throttle both ways.** Login throttling counts failures per `(IP + email)` and separately per IP.
   Only a success for that account clears its own counter; never clear the per-IP one, or a colleague
   on the same network re-arms an attacker's budget.
5. **One brain, always through the server.** All answers go through `POST /api/assistant/chat`. `app.js`
   never answers a clinic question on its own. The character speaks the reply; there is no chat panel.
5b. **The character is `assets/era3d.png`,** shown by default inside `#photoWrap`. Its movement is CSS
   only: float and breathe, plus a talking pulse while speaking. The old drawing rig was removed in
   3.7.2 — the helpers still in `app.js` (mouth shapes, blinking, eyebrows) do nothing without the
   drawing elements, so if you bring it back, add those elements first. Any new file the browser needs
   must be added to the `STATIC` list in `lib/router.js`.
5c. **The greeting fires once per login,** guarded by `sessionStorage.era_greeted` and cleared on
   sign-out. Keep it there — it must die with the tab.
5d. **One voice path.** `speak()` posts to `/api/tts`, gets a WAV, and plays it. There is no browser
   speech fallback; don't bring one back. On failure Era shows a status message. `stopSpeak()` must be
   called on stop, on a new reply, and on sign-out, or the audio keeps playing. The upstream request
   must stay `multipart/form-data` with a `language` field — changing it to JSON breaks it.
5e. **Sofia only.** `SOFIA_VOICES` in `lib/env.js` is the single list, and both the voice list and the
   refusal check read it. Don't write the names in two places.

## 2. Code style

- Compact plain JavaScript. Short helpers, template literals.
- Keep the section comments in `app.js` (`// ---- voice out`, `// ---- brain`, and so on).
- Keep the dense one-line style. Match what's there; don't reformat it. Don't add a formatter config.
- Element IDs are the contract between the HTML and the JavaScript. Change one, change both.
- Every file stays small enough to read on its own. That was the reason for the 4.2 split — don't
  fold `lib/` back into `server.js`.

## 3. Data rules

- **`db/db.js` owns the 15 health answers** and the sample schedule. It fills the database every time
  the server starts. Edit it there, never by hand in `era.db`.
- Health answers live in the database only. Don't hardcode health sentences in the reply code.
- `keywords` is a JSON string in SQL and a plain array in the file; the matching code accepts both.
  New keywords go in lowercase, and single-word ones need 4 letters or more or the matching misses.
- Schedule times are `HH:MM` in 24-hour form. Types are only `meeting` or `appointment`.
- Only read `localStorage` through the existing `load()` wrapper. Only settings are stored there now.
- Database changes must add, never remove or rewrite existing columns.

## 4. Matching rules

- Clinic questions are matched before health questions, so "how many appointments today" can never
  return health advice.
- A multi-word keyword matches anywhere in the text and scores 2. A single word must match a whole
  word, or be the start of a word of 4 letters or more, and scores 1.
- Highest score wins. Nothing matched means no answer — not a guess.

## 5. Support and access

- Target current Chrome and Edge. On Safari and Firefox, typing works and the microphone button says why.
- Every control must be reachable by keyboard, with a visible focus ring.
- Respect `prefers-reduced-motion`.

## 6. Before calling anything done

Run all of these:

```
node --check server.js app.js db/db.js token.js        # and each file in lib/
npm test                                      # 40 checks must pass
node server.js                                # then open http://localhost:8000
```

And by hand:

- `/api/health` reports 15 health answers, 4 schedule rows and the current version.
- "i have a fever" through the chat endpoint returns the fever answer; "what is the weather" does not.
- "book an appointment tomorrow at 4pm for Ravi" books it. "reschedule appointment 1 to tomorrow at
  3pm" moves it. "add a meeting called Review at 3 pm" adds it.
- Book a long appointment, then ask for free slots — none of the times inside it should be offered.
- Booking a time inside an existing appointment is refused with the real reason, not a permissions
  message.
- Signing in as Dr. Amit shows only his appointments. As Dr. Rahul, only his.
- Another doctor's appointment cannot be read, moved, or deleted, whatever you ask.
- Signing out clears the session. Signing back in as the same user works.
- Get the password wrong 8 times, then once more: that last attempt says "wait a moment".
- If `render.yaml` was used to deploy, open the URL it produced and confirm `/api/health` answers
  (the free tier sleeps; the first wake takes 30–50 s).

## 7. Documents

`Prd.md`, `Architecture.md`, `Design.md`, `Rules.md`, `Task.md`, `Memory.md` and `implementation.md`
are updated in the same change that alters behaviour, with the version and date at the top. If the
code does not do something a document promises, either build it or correct the document in the same
change — do not leave them disagreeing. `docs/` holds the long-form guides
(`Features-and-Flows.md`, `Features-and-Flows-Simple.md`) and their PDFs — those are snapshots of
these files, so when the core docs change, the PDFs go stale.

Write plainly. Short sentences. No jargon where a plain word will do.

## 8. Known problems — do not build on these

Fix these before extending the same code:

- Patient details go to NVIDIA for speech. `sanitize()` strips internal IDs only, so names, dates of
  birth and medications leave the machine. This needs a decision, not a workaround.
- A token already handed out stays valid for 8 hours after the cookie is cleared. Logout cannot revoke it.
- An unknown email becomes a doctor account immediately. No verification step.
- The login throttle is in-memory: it resets on restart and does nothing across two machines.
- No confirmation step before a write, so a misheard number can cancel a real appointment.
- A booking sentence missing the time fails outright instead of asking for it in the next turn.
- The browser's offline `ask()` / `findAnswerFallback()` in `db/db.js` are never called.
- The character has no lip sync and no fallback image if `assets/era3d.png` goes missing.
- The PDFs in `docs/` are snapshots of older text and go stale whenever the core docs change.

## 9. Fixed in 4.4 — don't reintroduce these

- Voice booking, rescheduling, details-by-number and adding meetings now work. `pickDateTime()` in
  `lib/brain.js` is what reads date, time and patient out of a sentence; add new phrasings there.
- Booking and rescheduling both go through `slotClash()` for interval overlap. A `start_time=?`
  equality test is the bug that let double-bookings through — never write one.
- The chat error handler speaks the real reason for every failure.
- `localDay()` / `localTime()` from `db/db.js` are used everywhere a date is compared.
- The session cookie carries `Secure` over TLS, and login is throttled per account and per address.
- `token.js` persona names match the seed, and `CORS_ORIGIN` comes from `.env`.