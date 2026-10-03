# Memory.md — Era project memory

**Updated:** 2026-10-01 · Read this before touching `app.js` or `db/db.js`.

## 1. What this project is
Single-folder, static, zero-dependency **character** assistant for a clinic ("Era"): inline SVG
clinician (v3.5) with lip sync, Web Speech in/out, and dashboard answers from the doctor-scoped
server tools. The browser holds no local brain — every answer comes from `/api/assistant/chat`.

## 2. Key decisions & why
| Decision | Why |
|---|---|
| JS-file "database" (`window.EraDB`) instead of real DB | Project is static/dependency-free by rule; JSON-in-JS keeps zero-install, and the table shape maps 1:1 to SQL for the later swap (Architecture.md §5). |
| Keyword scoring, not regex-per-topic | 15 topics × phrasings would explode regexes; scoring gives graceful best-match and a clean `null` fall-through. |
| Health lookup **after** schedule intents | "how many appointments today" contains no health keywords, but a single over-eager keyword (e.g. *weight* in diet row) must never shadow schedule answers; ordering makes intent overlap deterministic. |
| Word-boundary/prefix token match | Earlier `t.includes(k)` matched "w**eat**her" → diet row. Tokens (`w===n` or `w.startsWith(n)` when `n≥4`) killed that class of bug; prefixes catch *vaccine/vaccines*. |
| Schedule stored only in localStorage | User edits must survive reload; `db.js` seeds it on first run (`load(KEY.sch,null) \|\| EraDB.seedSchedule.slice()`). |
| Greeting mentions health skill | Otherwise users never discover the v1.1 feature. |
| `speak()` strips `•` and `—` | Screen-reader-friendly bullets sound broken through TTS. |

### v3.8 — NVIDIA NVCF voice (what changed & why)
| Decision | Why |
|---|---|
| **v3.9.1: BOTH transports flake independently — try HTTP then gRPC** | Same function-id, two serving paths. Verified gRPC healthy during an HTTP-down window (and later the reverse). Server: 3× HTTP → 2× `python tts-grpc.py` (riva gRPC client, `pip install --user nvidia-riva-client`; tool-only dep, app stays zero-npm). gRPC `synthesize()` returns `resp.audio` = raw s16le PCM → bridge builds the 44-byte WAV header itself. gRPC has NO list_voices method (HTTP only). |
|---|---|
| **Upstream is FLAKY — design for it** | NVCF's Triton ensemble intermittently returns `400 "Mapping failed. Check that all pronunciations…"` for MINUTES at a time, for ANY text (same text was 200 earlier — it's time-based, not input-based). Defense: server retries 4x (0.8/2/4.5s backoff) + validates `RIFF` header + LRU WAV cache (20) + browser fallback in `speak()`. Do not trust a single success/failure as proof. |
| Server proxy `/api/tts`, not browser→NVIDIA direct | The API key must never reach the browser; also NVCF would CORS-block a direct call. Key in gitignored `nvcf.key` or `NVIDIA_API_KEY` env — never hardcode, never log. |
| NVCF synth is **multipart/form-data**, field is **`language`** | First JSON attempt returned `400 Bad Request, empty text input`. Schema lives in `{base}/openapi.json` (Riva HTTP API 1.9.0). Response is a raw RIFF/WAVE — play directly in `<audio>`. |
| Voice name embeds the language | `Magpie-Multilingual.EN-US.Sofia` → derive `language=EN-US` from the name (regex on the name). List from `GET /v1/audio/list_voices`. |
| v3.9: browser speechSynthesis REMOVED (user request) | Only Magpie-Multilingual voices now — `speak()` is a single NVCF path; upstream failure → status message, no fallback voices. `stopSpeak()` consolidates the old stop/cancel paths. Mic input is unaffected (SpeechRecognition stays). |
| `speakSeq` token still guards everything | stop/new reply/logout must call `stopSpeak()` — playback and (any future) chains share the token. |
|---|---|
| Server proxy `/api/tts`, not browser→NVIDIA direct | The API key must never reach the browser; also NVCF would CORS-block a direct call. Key in gitignored `nvcf.key` or `NVIDIA_API_KEY` env — never hardcode, never log. |
| NVCF synth is **multipart/form-data**, field is **`language`** | First JSON attempt returned `400 Bad Request, empty text input`. Schema lives in `{base}/openapi.json` (Riva HTTP API 1.9.0). Response is a raw RIFF/WAVE — play directly in `<audio>`. |
| Voice name embeds the language | `Magpie-Multilingual.EN-US.Sofia` → derive `language=en-US` from the name (regex on the name). List from `GET /v1/audio/list_voices`. |
| v3.9: browser speechSynthesis REMOVED (user request) | Only Magpie-Multilingual voices now — `speak()` is a single NVCF path; upstream failure → status message, no fallback voices. `stopSpeak()` consolidates the old stop/cancel paths. Mic input is unaffected (SpeechRecognition stays). |
| `speakSeq` token still guards everything | stop/new reply/logout must call `stopSpeak()` — playback and (any future) chains share the token. |

### v4.0 — Sofia-only voice + auto-language (what changed & why)
| Decision | Why |
|---|---|
| ONE voice: Sofia EN-US (default) + HI-IN only; server filters `/api/tts/voices`, app hard-filters too | User request ("only 1 voice, ladki ki voice"). Sofia exists in EN-US, HI-IN, AR-AR — Arabic dropped per "only hindi english hinglish". |
| Auto-language per reply in `pickVoice()`: Devanagari → हिन्दी, romanised Hinglish word-list → हिन्दी, else selected voice | User wants Hindi/English/Hinglish without picking languages manually. Verified live: roman Hindi text synthesizes fine with HI-IN. |
| `language` field must be proper-case (`en-US`), never voice-name case (`EN-US`) | Uppercase tag → Triton `400 "Mapping failed"` EVERY time (root cause of era-server.log failures). Derive then re-case `xx`+`-`+`YY`. |
| TTS failure log now records EVERY attempt (`errs[]`), not just the last | gRPC error used to overwrite the HTTP errors, hiding the real cause during debugging. |
| Stale `S.ttsVoice` (old localStorage, e.g. Mia) never breaks `pickVoice()` | Falls back to `SOFIA.en`; Settings save normalizes it. |

### v4.1 — Production posture (what changed & why)
| Decision | Why |
|---|---|
| `.env` file WINS over shell env (`process.env[m[1]]=…` unconditionally) | This box exports junk shell-wide (`PORT=0` broke the first launch). One source of truth per process. |
| `POST /api/tts` validates `SOFIA_VOICES` (400 BAD_VOICE), same const as the list endpoint | Audit proved Louise (FR) still synthesized → "Sofia only" was cosmetic. Single owner = list & guard can't drift. |
| HTTPS mirror reuses the shared `handler(req,res)` — NOT the `http.Server` instance | `https.createServer(opts, serverInstance)` throws `listener must be function` at startup (bit us live). |
| `start-era.cmd` MUST be CRLF; launch with an ABSOLUTE path | LF batch files: labels/goto misfire; this sandbox sets `NoDefaultCurrentDirectoryInExePath` so bare `cmd /c start-era.cmd` is "not recognized". |
| Demo appointment rows (reason `APPOINTMENT …`) re-dated to today/tomorrow at every start | Seed dates froze at first DB creation → "appointments tomorrow" answered empty forever after day one. |
| `schtasks` logon-task registration left to the user (elevation denied in-session) | Watchdog still runs manually; README documents the one-line register command. |

### v4.2 — Modular split (what changed & why)
| Decision | Why |
|---|---|
| server.js (531 lines) → 7 modules under `lib/`: env → auth → database → tools → brain → tts → router; server.js = thin entry (config init + listeners + test exports) | Two consecutive design audits capped at 4/10 while every concern lived in one file. Now each concern is readable alone; dependencies flow one way (router → everything; env → everything). |
| `SOFIA_VOICES` has ONE owner (`lib/env.js`); both the voice list and the synthesize 400-guard import it | Policy was stated twice (drift risk). |
| TTS retry/cache/key pipeline extracted to `lib/tts.js` returning `{wav,errs}` | Router now owns only HTTP; fixed the latent `lastErr`-after-`errs` bug in the gRPC catch during the move. |
| `__test` export surface preserved exactly (test/security.test.js, token.js untouched) | Behavior-preserving refactor: same endpoints, same .env/nvcf.key/certs handling, same :8000/:8443. Verified: 18/18 suite, EN/HI/Hinglish 200 RIFF, Louise 400, watchdog restart to new code. |

### v4.3 — Demo login is a switch, not a side effect (what changed & why)
| Decision | Why |
|---|---|
| `DEMO_LOGIN` flag in `lib/env.js` (default ON, `DEMO_LOGIN=0` to disable); router checks the flag, NOT the JWT_SECRET value | v4.1 tied demo-login to "no real secret" — going live silently killed the start screen's advertised demo users (dead end the user hit). Now demo access is an explicit product decision, independent of auth strength. |
| Frontend still advertises the demo users; endpoint is ON by default | The login screen and the endpoint must agree — a screen offering dead buttons is worse than no feature. |
| One-click demo sign-in re-verified in-browser after the un-gate (greeting + TTS + chat) | Contract: "click a demo user → signed in as that doctor". |

### v3.5 — Character UI (what changed & why)
| Decision | Why |
|---|---|
| Greeting guarded by `sessionStorage` (not localStorage) | User chose "once per login session": sessionStorage dies with the tab session, so a fresh login re-greets but a refresh doesn't. Cleared explicitly on logout. |
| Viseme lip sync from TTS `onboundary` word events | Only zero-dep way to approximate phoneme timing; vowel content of each word picks the mouth shape (round/ooh for u/o words, wide/open otherwise). rAF jaw loop covers engines without boundary events (e.g. some Safari voices). |
| No chat panel — voice-only replies + hidden `aria-live` | User explicitly wanted the character, not a chat UI. `#live` keeps replies accessible when TTS is off and satisfies a11y review. |
| SVG replaces `assets/era.png` in the workspace | Lip sync needs an animatable mouth; the PNG can't. The PNG stays on the auth card (logo). |
| v3.6: mouth is a clipPath rig (`#mouthClipPath` in defs) | Pixar-look needs teeth/tongue that stay inside the mouth while the viseme shape morphs — clipping gives that for free. `app.js` swaps the clip path's `d` via the `MOUTH` set; never draw over `#mouthGrp` elsewhere. |
| v3.7: photo mode = `<img>` probe, not a config flag | `assets/era3d.png` loads → `#photoWrap` replaces the SVG; error → SVG stays. No build step, no setting to remember — the user just drops the file (chat-pasted images can't be written to disk by the agent). |
| v3.7: sentence-chained TTS with `speakSeq` token | Per-sentence utterances give natural pacing + allow tiny rate/pitch jitter; the token makes stop/new-reply/logout abort the chain (Web Speech `cancel()` fires `onend`, which would otherwise keep speaking). |
| Server-side reply() kept, local brain removed | All answers must stay doctor-scoped server-side; removes the localStorage schedule mutation path entirely. |

## 2b. v2.0 — SQLite + API (what changed & why)
| Decision | Why |
|---|---|
| `node:sqlite` (`DatabaseSync`), zero deps | A real SQL file DB with no driver install; keeps the no-npm rule. Node ≥ 22.5; one ExperimentalWarning at start is expected. |
| `server.js` owns DB + static files | One process serves app + API; replaced the Python http.server (kill it first — port 8000 clash). |
| API-first with offline fallback (`ask()`) | Browser calls `/api/qa`; on fetch failure uses bundled rows — the app never dies when the server does. |
| Dual-export `db.js` (factory, UMD-style) | Same file feeds the browser (`window.EraDB`) and seeds/queries SQLite in Node (`module.exports`). |
| `package.json` pins `"type":"commonjs"` | The user's HOME folder has a package.json with `"type":"module"`; ancestor resolution broke `server.js` (`require is not defined`). The project-local pin wins — do not delete it. |
| `keywords`: JSON string in SQL, array in seed | SQLite TEXT column; `scoreRows` parses defensively (accepts both). Early bug: `JSON.parse` on the seed array crashed — caught by the Node smoke test. |

## 2c. v3.0 — RMS-ready security layer (what changed & why)
| Decision | Why |
|---|---|
| `verifyJWT` accepts Bearer **or** HttpOnly cookie | Dashboard pages can't always set headers; cookie keeps the token out of JS. |
| `scopeDoctor()` centralizes scoping | Doctors are pinned to their own doctorId; only admin may pass an explicit `doctor_id` — one choke point, no per-tool drift. |
| `routeIntent` separate from tools | The "AI" is replaceable (swap for an LLM) while auth stays in the tool layer — prompt is never a security boundary. |
| `sanitize` strips `doctor_id`/`patient_id` in responses | Data minimization; the client never learns internal keys. |
| Scratch DB via `ERA_DB` env for tests | Write tools mutate state; without isolation, run #2 fails on already-cancelled rows. `server.js` resolves it at require-time — set it **before** requiring. |
| Demo-login disabled by `JWT_SECRET` env | Demo convenience can't leak into production; a real RMS brings its own login. |

### v3.0 bug post-mortems (both caught by verification, not review)
- **JWT verify always failed:** `Buffer.from(s).toString()` decodes UTF-8, not base64url — payload
  parsed as garbage while the *signature* was valid. Fix: `Buffer.from(s,'base64url').toString('utf8')`.
- **`tool_result` collapsed to `""`:** JSON replacer returned the *key* (`k`) instead of *value*
  (`v`) when dropping internal ids, stringifying the whole object. Fix: replacer `(k,v)=>…`.

## 2d. v3.1 — Full RMS spec pass (key notes)
- Workspace inspection confirmed **no separate RMS project exists** — Era IS the existing project;
  the spec was implemented in-place (no rebuild). DB backed up before reseeding.
- Passwords: scrypt (`crypto.scryptSync`, static salt `era-salt-v1`) + `timingSafeEqual`. Demo-grade —
  swap for bcrypt/argon2 with per-user salts before production.
- Fresh seed required: pre-v3.1 DBs lack `password_hash`; delete `db/era.db` (after backup) to reseed.
- REST + AI tools accept both key styles (`date`/`appointment_date`, `start_time`/`appointment_time`)
  so the spec's naming and Era's tool naming coexist.
- Test 3 over HTTP returns **404** (not 403) by design: ownership failures are indistinguishable
  from "doesn't exist" to avoid resource enumeration.

## 3. Gotchas / what breaks it
- **SQLite duplicate-column error text is "duplicate column name: …", not "already exists"** — the
  idempotent-migration catch must match both or boot #2 crashes (cost a restart loop in v3.1).
- **Login is sign-in + sign-up combined** (user request): unknown email+password auto-creates an
  account (201); wrong password on an existing account still 401s with a hint. Don't "restore" a
  hard register flow.
- **Chat 403 → friendly 200 denial for non-doctor roles:** admin/reception asking for doctor data
  get `ok:true, denied:true` + guidance text; the tool layer still enforces security. Don't turn
  this back into a raw 403 — the browser console errors confused the user.
- **Prefix matching ≥ 4 chars only** — shorter prefixes would make `wa` match *walk* and *water*.
  Keep single-word keywords ≥ 4 chars (Rules.md §3).
- `findAnswer` normalizes away punctuation; keywords are matched lowercase — keep them lowercase.
- v3.5 removed the client `reply()` brain, chat log, and schedule editor — don't reintroduce local
  intent handling in `app.js`; answers come only from `/api/assistant/chat` (Rules 5).
- v3.6 character geometry: mouth center ≈ (150,166); viseme `MOUTH` paths in `app.js` are tuned to
  it. If you move the mouth in `index.html`, re-tune `MOUTH` + the teeth/tongue rects inside
  `#mouthGrp` together — they move as a set. Brows use a generic Q-control-point raise (works for
  any brow path).
- v3.7 photo mode: `assets/era3d.png` is the character image (v3.7.1: copy of `era.png`, the 3D
  render with transparent background). v3.7.2: **SVG model deleted** — the photo is the only
  character, visible by default in HTML (no load-event race). Rig helpers in `app.js` no-op safely
  (element refs empty). Photo framing knobs: `--eraPhotoW/H/X/Y` in `style.css :root`. New static
  assets must be added to the `STATIC` map in `server.js`.
- v3.7 voice: `speakSeq` must be bumped in every cancellation path (Stop button, `doLogout`,
  starting a new reply). Miss one and the sentence chain keeps talking after cancel. Local voices
  only — cloud TTS would break Rules 3 (privacy/no third-party calls).
- `reply(q)` now keeps the **raw** input in `input` because `q` is lowercased in place — pass
  `input` (not `q`) to `findAnswer`. (It's case-safe either way, but that's the contract.)
- Deleting localStorage = reset to seed; that's a feature (Rules §3), don't "fix" it.
- Mic on `file://` is blocked in Chrome — always serve via the local server; that's why
  the README insists on `python -m http.server`.
- `era-server.log` is server output, not project data; safe to delete/git-ignore.

## 4. Environment notes
- Windows + bash (Git Bash): use POSIX syntax; `python` = Python 3.13, `node` = v24.
- Server running on **:8000** is `node server.js` (nohup, log in `era-server.log`); stop old
  listeners first — port clash. `db/era.db` regenerates if deleted; **test runs never touch it**
  (they use `db/era.test.db` via `ERA_DB`).
- **Editing `server.js` requires a server restart** — the running process keeps old code; a curl
  against a stale server will fail even after a correct fix (cost us a debug loop in v3.0).
- Verification loop used: `node --check` → Node smoke test of `findAnswer` (set `global.window={}`,
  `require('./db/db.js')`) → `curl` the served paths for 200.

## 5. If resuming mid-task
1. Check `Task.md` — shipped vs backlog tells you the frontier.
2. Retrieval changes ⇒ re-run the 7-case smoke test (fever/diet/BP hit; weather/schedule miss).
3. Doc updates travel with code changes (Rules.md §7); bump versions + dates.
4. If a health answer misfires, check keyword collisions **and** intent ordering in `reply()` first.
