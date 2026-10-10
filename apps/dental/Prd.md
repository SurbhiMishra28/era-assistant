# DentEra — Dental Care for Doctors · PRD

**Version:** 1.1.0 · **Date:** 2026-10-06 · **Status:** Planning (no code yet)
**Parent project:** [../Prd.md](../Prd.md) (Era v4.5 general clinic assistant — this is a SEPARATE sub-project in `dental/`)

## 1. Product in one line

A **dental practice website** for doctors: manage dental patients, a **tooth-wise dental chart (FDI)**,
treatment plans with billing, a **public booking page** for patients, and an **AI assistant** ("Era Dental")
that answers spoken/typed dental questions from the clinic's own data — built on the same zero-dependency
stack as Era.

## 2. Users

| User | Needs |
|---|---|
| **Dentist** (primary) | Day view of appointments, patient dental chart, tooth-wise treatment records, plans & billing, voice/text assistant |
| **Reception / Admin** | Booking desk: walk-in appointments, unpaid invoices list, clinic overview |
| **Patient** (no login) | Book an appointment on the public page with dentist, date, time |

## 3. Goals

1. Doctors get a **complete dental record per tooth** — FDI numbering (11–48 adult, 55–85 primary)
2. **Treatment plans + invoices** live in the same place as the chart (no paper)
3. Patients can **book without calling** (public page, no login)
4. AI assistant reads **only the signed-in dentist's own scoped data** — same security model as Era
5. **React + Express** (npm allowed — stack revised same day per user decision), one SQLite file, deployable on Render free tier

## 4. User stories

| # | Story | Status |
|---|---|---|
| U1 | As a dentist I log in (email+password or demo) and see my day | ❌ to build |
| U2 | As a dentist I open a patient's **dental chart** and mark tooth 16 as decayed / tooth 36 root-canal done | ❌ to build |
| U3 | As a dentist I create a **treatment plan** ("RCT on 36, crown on 36 — 3 visits") and track each item | ❌ to build |
| U4 | As a dentist I ask *"my appointments tomorrow"* / *"show Ravi's chart"* and hear the answer in Sofia's voice | ❌ to build |
| U5 | As reception I see **unpaid invoices** and mark one paid | ❌ to build |
| U6 | As a patient I visit the public page, pick a dentist + free slot, and book with my name+phone | ❌ to build |
| U7 | As a dentist I see bookings that came from the public page marked `source:public` | ❌ to build |

## 5. Functional requirements

- **FR1 Auth** — email+password (bcrypt-hashed), auto sign-up, demo login switch; JWT (8h) via HttpOnly cookie; roles `dentist | admin | reception`
- **FR2 Practice dashboard** — today's appointments, quick stats (today's patients, unpaid invoices), patient register
- **FR3 Dental chart** — interactive 32-tooth grid; per-tooth status (`healthy|decayed|filled|root_canal|crowned|missing|implant`) + treatment history
- **FR4 Treatments & plans** — catalogue of standard treatments with default cost/minutes; multi-visit plans with per-item status
- **FR5 Billing** — invoice per plan/visit: amount, discount, paid; status `unpaid|partial|paid`
- **FR6 Public booking** — `/book` page (no login): dentist → next-14-days date → free slot → name+phone+reason; rate-limited
- **FR7 AI assistant** — voice-first (NVIDIA Sofia, EN+HI) + chat panel with per-day history (same UX as Era v4.5 chat panel)
- **FR8 Audit** — every assistant tool call and public booking attempt lands in `assistant_audit`

## 6. Non-goals (v1)

- ❌ Patient login/portal — patients book as guests; portal is Phase 2
- ❌ Payments gateway (UPI/card) — invoices record manual payments only
- ❌ X-ray/image uploads — text records only in v1
- ❌ Multi-clinic chains — one clinic per deployment
- ❌ Real LLM — assistant is the deterministic Era-style engine (predictability in a medical context)

## 7. Success criteria

- `npm test` in `dental/` passes ≥ 20 checks (isolation, FDI validity, slot clash, booking limits)
- A dentist can go login → open chart → mark tooth → raise plan → mark invoice paid in one session
- A guest can book a slot in under 30 seconds without an account
