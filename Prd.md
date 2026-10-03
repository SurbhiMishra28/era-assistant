# Prd.md — Era: AI Face & Voice Clinic Assistant

**Version:** 3.9.0 (NVIDIA-only voice) · **Status:** Live · **Last updated:** 2026-10-01

## 1. Overview
Era is a browser-based **character** assistant for a doctor's clinic: a 3D-look (Pixar-style)
animated clinician who pops up the moment a doctor signs in, greets them by name, and **speaks
every reply out loud with lip sync**. She accepts spoken questions (mic) or typed input (slim
fallback line), and answers from **two knowledge sources**:

1. **The doctor's dashboard data** — appointments, patients, prescriptions, working hours,
   scoped to the authenticated doctor through the RMS tool layer (`/api/assistant/chat`).
2. **General health guidance** — a 15-row AI-doctor knowledge base served from **SQLite**
   (`db/era.db`) through the chat brain (with `/api/qa` as the raw fallback API), covering fever,
   cold, headaches, blood pressure, diabetes, hydration, sleep, exercise, diet, stress, antibiotics,
   vaccines, back pain, allergies, and emergency warning signs.

Everything runs locally: static SPA + a zero-dependency Node server with SQLite, with **JWT-based,
role-aware, doctor-isolated assistant endpoints** ready to embed in an existing RMS dashboard
(no dashboard is built here — Era is the assistant).

## 2. Goals
- Let clinic staff ask about their day by voice, hands-free.
- Give instant first-aid / lifestyle guidance from a curated local knowledge base.
- Stay a **single static folder** — open and run, zero install.

## 2b. RMS integration requirements (v3.0)
- The assistant always operates under the **authenticated** doctor's identity; the frontend never
  supplies or modifies `doctor_id`, and AI/tool arguments can never widen scope.
- Role-aware behavior: `doctor` (own data only), `admin` (explicit cross-doctor scope only),
  `reception` (health Q&A only).
- Tools for read **and** write (book/reschedule/cancel) with ownership checks, conflict checks,
  confirmation-worthy effects, and audit logging.
- Safe errors and data minimization in every response.

## 3. Non-goals (v1)
- Real patient records, prescriptions, or PHI storage.
- Diagnosis. Era gives general guidance and always points to a doctor for urgent signs.
- Multi-day calendar; the model is "today only".

## 4. User stories
| # | As a doctor I want… | So that… | Status |
|---|---|---|---|
| U1 | a friendly face that greets me and speaks | it feels like an assistant, not a form | ✅ |
| U2 | to ask "what's next" / "how many appointments" by voice | I can plan between patients | ✅ |
| U3 | to add a meeting by saying "add a meeting called Review at 3 pm" | I don't stop to type | ✅ |
| U4 | to ask health questions ("what to do for a fever") | I get consistent, safe guidance from the DB | ✅ v1.1 |
| U5 | my name, voice, speed, schedule saved | Era personalizes without re-setup | ✅ |

## 5. Functional requirements
- **FR1 Start flow (v3.5):** after login the workspace appears with **Era popped up**: a personalized
  spoken greeting ("Good morning, Dr. Amit! I'm Era, your assistant. How can I assist you today?")
  — once per login session; refreshes restore quietly.
- **FR2 Conversation (v3.5):** voice-first — mic input, spoken replies; one slim text input remains
  as fallback. No chat log; replies are voice-only with an `aria-live` region for accessibility.
- **FR3 Voice & lip sync:** mic button (Web Speech API, Chrome/Edge); TTS with voice/rate/pitch
  controls; 3D-look SVG character lip-syncs via viseme mouth shapes (clip rig with teeth + tongue)
  driven by TTS word-boundary events (+ rAF jaw loop fallback); idle blinks and brow movement keep
  her alive.
- **FR3b Photo mode (v3.7):** drop a character render at `assets/era3d.png` and it replaces the SVG
  rig automatically (same float/breathe/talk-pulse motion); missing file falls back to the SVG.
- **FR3c Voice (v4.0):** Era speaks ONLY in **NVIDIA Sofia's voice** (user request: one voice,
  female, no personas) through the server proxy `POST /api/tts` — `Magpie-Multilingual.EN-US.Sofia`
  (default) and `Magpie-Multilingual.HI-IN.Sofia`. Per-reply auto-language: Devanagari or romanised
  Hinglish → हिन्दी Sofia; everything else → English Sofia (Settings can pin हिन्दी). Browser
  speechSynthesis stays removed — if the voice service is unreachable, Era shows a status message
  instead of speaking. The API key stays server-side (`nvcf.key`, gitignored). Mic input still
  uses browser SpeechRecognition.
- **FR4 Schedule brain:** count/list meetings & appointments, next upcoming item (vs current clock), add-by-voice.
- **FR5 Health brain (v2.0):** free-text questions hit `/api/qa` (SQLite `ai_doctor` table); the browser
  falls back to bundled rows when the API is unreachable; schedule intents still win on overlap.
- **FR6 Settings dialog:** name, Era-speaks toggle, greet toggle, voice select, speed, pitch, schedule editor
  (`HH:MM | type | title` per line), clear chat history.
- **FR7 Persistence:** settings, schedule, and chat (last 200) in localStorage; knowledge base in SQLite
  (`db/era.db`), seeded on first server start from `db/db.js`.

## 6. Acceptance criteria
- Asking "i have a fever" returns the fever guidance from the database, spoken aloud.
- Asking "what is the weather" does **not** falsely match any health entry (word-boundary matching).
- "how many appointments today" returns the count and list — never a health answer.
- Deleting `db/era.db` (or localStorage) restores seeds; `node server.js` recreates both.
- App works offline except fonts (graceful fallback).

## 7. Success metrics
- First-response latency < 500 ms for local answers (SQLite lookup); < 1.5 s through the API.
- Zero false-positive health answers on schedule queries (keyword-boundary test suite in repo history).
- 15/15 knowledge rows reachable through natural phrasing.
