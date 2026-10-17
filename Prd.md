# Prd.md — What Era Should Do

**Version:** 4.4 · **Status:** Working demo · **Last updated:** 2026-10-05

## 1. What Era is

Era is a voice assistant for a clinic. When a doctor signs in, a 3D character appears, greets them by
name, and answers their questions out loud. They can speak or type.

Answers come from two places:

1. **The doctor's own clinic data** — appointments, patients, prescriptions, working hours. Only the
   data belonging to the signed-in doctor.
2. **General health guidance** — 15 common questions answered from a local list (fever, cold,
   headache, blood pressure, diabetes, water, sleep, exercise, diet, stress, antibiotics, vaccines,
   back pain, allergies, and when to get help urgently).

Everything runs from one folder: a simple web page plus a small Node.js server with a local database.
No installation, no packages to download.

## 2. Goals

- Let clinic staff ask about their day by voice, without touching the keyboard.
- Give clear everyday health guidance from a reviewed local list.
- Stay a single folder that opens and runs.
- Run for real: pushed to GitHub and deployed live on Render (https://era-assistant.onrender.com).

## 3. Rules about clinic data

- Era always works under the signed-in doctor's identity. The web page never sends a doctor ID, and
  nothing an AI tool is told can widen what that doctor may see.
- Roles: **doctor** sees only their own data. **admin** may name one specific doctor to look at.
  **reception** gets health questions only.
- Reading and changing data both go through the same checks: ownership, double-booking, and a
  written record of every action.
- Replies never include internal IDs, raw database errors, or another doctor's information.

## 4. What this project is not for

- Storing real patient records or real prescriptions. The data here is made up.
- Diagnosing illness. Era gives general guidance and points to a doctor for anything urgent.
- A full calendar. Today and tomorrow are what matter.

## 5. User stories

| # | As a doctor I want… | So that… | Status |
|---|---|---|---|
| U1 | a character that greets me and speaks | it feels like an assistant, not a form | ✅ works |
| U2 | to ask "what's next" or "how many appointments" by voice | I can plan between patients | ✅ works |
| U3 | to add a meeting by saying "add a meeting called Review at 3 pm" | I don't stop to type | ✅ works |
| U4 | to ask health questions | I get the same safe answer every time | ✅ works |
| U5 | my name and voice choice remembered | Era doesn't need setting up again | ✅ works |
| U6 | to book an appointment by voice in one sentence | I never touch the keyboard | ✅ works — the date, time and patient are read out of the sentence |
| U7 | to move an appointment to another time by voice | fixing a clash is quick | ✅ works |
| U8 | to add a meeting and take it off the shared clinic list | the whole day plan is in one place | ✅ add works; remove works through the API |
| U9 | to be told what actually went wrong | I trust what Era says | ✅ works — a taken slot no longer sounds like a permissions problem |

## 6. What the app must do

- **FR1 Opening:** after signing in the workspace appears and Era greets them by name, once per login.
  Refreshing the page does not greet again.
- **FR2 Talking:** voice first — microphone in, spoken replies out. One typing box stays as a backup.
  No chat log. Replies also go into a screen-reader region so they are available when sound is off.
- **FR3 Voice:** Era speaks only in NVIDIA Sofia's voice, through the server, which keeps the API key
  private. English, हिन्दी and Hinglish are chosen for each reply automatically. If the voice service
  is down, Era shows a message instead of speaking. The browser's own speech voices are not used.
- **FR4 Day questions:** count and list appointments and meetings, say what is next, answer from
  the shared clinic schedule for staff who are not doctors, and add a meeting by voice.
- **FR5 Health questions:** match the question against the local list of 15 answers. All 15 carry a
  "see a doctor" pointer for anything urgent.
- **FR6 Settings:** your name, whether Era speaks, whether she greets you, and which voice to use.
- **FR7 Saving:** settings are remembered in the browser. Health answers live in the database.
- **FR8 Speaking a booking correctly:** "book an appointment tomorrow at 4pm for Ravi" books it without
  asking again. The date, time and patient are read out of the sentence. Times like "3pm", "3:30 pm",
  "16:45", "half past 2" and "tomorrow morning" are all understood.
- **FR9 Never double-book:** a booking that overlaps an existing appointment is refused, whatever the
  length of either. The free-slot list hides times inside a long appointment.
- **FR10 Stop password guessing:** repeated wrong passwords for one account are counted, and past the
  limit the server stops checking and asks the person to wait.
- **FR8 Demo login:** one-click sign-in for five sample users (three doctors, Admin, Front Desk),
  controlled by the `DEMO_LOGIN` switch so it can be turned off before real use.
- **FR9 Changing data:** appointments can be booked, moved and cancelled through the same checks —
  ownership, free slot, double-booking — and every action is written to the audit log.
- **FR10 Hosting:** the database is looked for in three places in order, so the app starts even on
  hosts that wipe their disk; it re-seeds itself on the next start.

## 7. What has to be true when it's done

- "I have a fever" returns the fever guidance and says it out loud.
- "What is the weather" does not match any health answer.
- "How many appointments today" returns appointments, never a health answer.
- Dr. Amit signs in and sees his two appointments. Dr. Rahul signs in and sees only his one. Neither
  can see the other's, whatever they ask.
- Deleting the database file and starting again rebuilds everything.
- If the folder is read-only, the app still starts by using a different location.
- `npm test` passes all 40 checks on a throwaway database.
- After a deploy, https://era-assistant.onrender.com answers `/api/health` (the first wake after an
  idle period takes 30–50 seconds).

## 8. How well it should work

- Health answers come back in well under a second.
- Health answers never appear when a clinic question was asked.
- All 15 health topics are reachable by ordinary phrasing.

## 9. Known shortfalls

These are real today and are the next work list:

- **Patient details are sent to NVIDIA's cloud** to be turned into speech — names, dates of birth,
  medications. Only internal IDs are stripped before sending. This is the biggest open risk and needs
  a decision before any real patient data is used.
- **Signing out does not cancel a token** that was already handed out. The cookie is cleared, but the
  token stays valid until it expires.
- **Anyone can create a doctor account** with any email address. There is no email confirmation.
- **The sign-in throttle lives in memory**, so it resets when the server restarts and does nothing
  across several machines.
- **A misheard number can cancel a real appointment.** There is no confirmation step before a write.
- **The character has no lip sync and no backup picture.** She is an image, so her mouth doesn't move.
- **The page needs the server for everything.** The browser's offline copy of the health answers is
  still in the code but is never used.
- **The generated PDFs in `docs/` are out of date.**
- **A booking sentence that is missing the time fails** instead of asking for it in the next turn.