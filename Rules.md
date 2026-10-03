# Rules.md — Era project conventions

**Version:** 3.9.0 (NVIDIA-only voice) · **Last updated:** 2026-10-01

## 1. Hard rules
1. **Zero npm dependencies.** No frameworks, bundlers, or packages — Node built-ins only
   (`node:http`, `node:sqlite`, `node:fs`). If a feature can't ship without tooling, escalate first.
1b. **CommonJS server code.** `package.json` pins `"type": "commonjs"` (an ancestor folder ships a
   `"type": "module"` package.json that would otherwise break `server.js`). Don't remove it.
2. **Single page.** All UI lives in `index.html`; do not add pages or routing.
3. **Privacy (v3.9, user-approved exception):** assistant reply TEXT is synthesized by NVIDIA NVCF
   cloud TTS (Magpie-Multilingual, via the `/api/tts` proxy) — the ONLY voice path. The API key lives
   server-side only — `NVIDIA_API_KEY` env or gitignored `nvcf.key` — and is never logged or sent
   to the browser. Everything else stays local: no analytics, no other third-party calls (fonts CDN
   allowed with graceful fallback). Mic INPUT still uses the browser's local SpeechRecognition.
4. **Medical safety:** Era never diagnoses. Guidance is generic; every urgent-topic answer
   must include a "see a doctor / emergency" pointer (see `ai_doctor` rows).
4b. **Security invariants (RMS spec):** identity comes only from `verifyJWT`; every tool re-validates
   ownership via `scopeDoctor()`; parameterized SQL only; never log message bodies or secrets;
   never leak SQL/stack traces/internal ids in errors; demo-login must stay disabled whenever
   `JWT_SECRET` is set.
5. **One brain, async.** All answers flow through `POST /api/assistant/chat` (server-side
   `routeIntent` → scoped tools). `app.js` never answers dashboard questions locally; callers
   must `await ask()`. The character speaks the reply — voice-only, no chat panel.
5b. **Character contract (v3.7.2):** the character is `assets/era3d.png` in `#photoWrap`, visible
   by default (no load-event logic). Motion is CSS-only: float/breathe + `talk` pulse on
   `[data-state=speaking]`. The old SVG rig was removed; `app.js` rig helpers (visemes/blink/brow)
   remain but no-op safely — if a mouth/eyes rig is ever reintroduced, re-add the elements before
   relying on them. Assets are served via the `STATIC` map in `server.js` — new assets must be
   added there.
5d. **Voice (v3.9, NVIDIA-only):** `speak()` = single path: `POST /api/tts` (multipart upstream,
   see Memory.md) → WAV → `<audio>`. There is NO browser speechSynthesis fallback — do not
   reintroduce it; on upstream failure Era shows a status message. `S.ttsVoice` comes from the
   Settings dropdown (Magpie voice list, grouped by language). `speakSeq` still guards playback —
   stop/new reply/logout must call `stopSpeak()` or the audio keeps playing. NVCF request shape is
   fixed (multipart form-data, `language` field); don't "simplify" it to JSON.
5c. **Greeting fires once per login session** (guarded by `sessionStorage.era_greeted`, cleared on
   logout). Refreshes restore quietly. Don't move the flag to localStorage — it must die with the tab session.

## 2. Code style
- Compact ES2022+ vanilla JS; short helpers (`$`, `load`, `save`, `fmt`); template literals.
- Section comments in `app.js`: `// ---- voice out`, `// ---- brain`, etc. Keep them.
- No semicolon-less lines mid-statement; keep the existing dense one-liner style — match it,
  don't reformat. Don't introduce a linter/prettier config.
- DOM ids are stable API between HTML and JS (`#log`, `#face[data-state]`, `#sSched`, …).
  Renaming one means renaming both.

## 3. Data rules
- **`db/db.js` is the source of truth** for `ai_doctor` (15 rows) and default schedule; it seeds SQLite
  (`db/era.db`) on every server start (QA upserted, schedule only when empty).
- **Server = read-only knowledge.** Add/curate rows in `db/db.js`, not by editing `era.db` by hand.
- SQLite `keywords` are a JSON string; seed rows use a plain array — `scoreRows` accepts both.
- Never read `localStorage` without the `load()` try/catch wrapper (v3.5: only `era_settings` remains
  client-side; chat history and schedule edits were removed with the chat panel).
- Schedule times are `HH:MM` 24-hour strings; types are only `meeting` | `appointment`.
- Health answers come from the DB only — no ad-hoc health strings inside `reply()`.
- New knowledge rows: append to `doctorQA` with a fresh `id`, lowercase `keywords` including
  likely phrasings; single-word keywords ≥ 4 chars only (boundary/prefix matching relies on it).

## 4. Retrieval rules (`scoreRows`)
- Schedule intents are matched **before** the health lookup in `reply()`.
- Multi-word keyword = substring match (+2); single word = exact token or ≥4-char prefix (+1).
- Highest score wins; 0 → miss (`found:false` over the API, `null` in the fallback).

## 5. Browser support & a11y
- Target evergreen Chrome/Edge; Safari/Firefox get typed chat (mic button explains why).
- Every new control is keyboard-reachable; interactive elements keep `:focus-visible` outlines.
- Respect `prefers-reduced-motion`; don't add non-essential animation outside existing keyframes.

## 6. Verification before done
- `node --check server.js db/db.js app.js` passes (run per file).
- API smoke test: `/api/health` shows 15/4 rows; `/api/qa?q=fever` hits; `q=weather` misses.
- Fallback smoke test: `EraDB.findAnswerFallback` works in Node without a server.
- `node server.js` serves the app at http://localhost:8000 and the mic works in Chrome/Edge.

## 7. Docs
- `Prd.md`, `Architecture.md`, `Design.md`, `Rules.md`, `Task.md`, `Memory.md` are updated in
  the same change that alters behavior. Version bump + date at the top of each touched doc.
- README stays the 5-line quickstart; depth belongs in the docs above.
