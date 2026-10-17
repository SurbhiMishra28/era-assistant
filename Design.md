# Design.md — How Era Looks

**Version:** 4.4 · **Last updated:** 2026-10-05

## 1. The look

Calm and clinical. Soft rounded corners, pill-shaped buttons, plenty of space. One colour does the
work — **teal**. Everything else is quiet blues and greys.

Text is **Manrope** (400, 600, 800) from Google Fonts, falling back to the system font if it can't
load.

## 2. Colours (`style.css` `:root`)

| Name | Value | Used for |
|---|---|---|
| `--bg` | `#eaf4f6` | Page background |
| `--ink` | `#123240` | Text |
| `--mut` | `#5d7784` | Secondary text |
| `--teal` | `#1f9d9a` | Buttons, waves |
| `--teal2` | `#0e7c7b` | Button gradient end |
| `--blue` | `#7fa8cf` | Focus rings, outer rings |
| `--card` | `#fff` | Panels |
| `--err` | `#b3261e` | Errors |

## 3. Layout

One centred card, at most 460px wide. Inside it, top to bottom:

- who is signed in, and a sign-out button
- the character on a soft stage with two rings behind her
- five wave bars
- the name "Era" and a status line
- three buttons: Talk, Stop, Settings
- one typing box

That's the whole screen. There is no chat panel.

## 4. The character

`assets/era3d.png` is the character — a 3D render on a transparent background. She floats gently and
pulses slightly while speaking. Her framing is set by four numbers at the top of `style.css`:
`--eraPhotoW`, `--eraPhotoH`, `--eraPhotoX`, `--eraPhotoY`. The default `50% 12%` keeps her face in
frame.

Her movement is CSS only, driven by the `data-state` attribute on `#face`:

| State | What happens |
|---|---|
| `idle` | Slow float. This is the resting look. |
| `listening` | Rings pulse and turn red, microphone button turns red, status says "Listening…" |
| `speaking` | She pulses, the wave bars animate, status says "Speaking…" |
| `denied` | Her rings turn red and the status turns red. Used when the server refuses a request, so a refusal no longer looks like idle. |

**There is no lip sync.** It existed until version 3.7.2 and was removed when the character became a
picture. The mouth-shape, blinking and eyebrow code is still in `app.js` but does nothing, because
those drawing elements are gone from the page. If you bring it back, you need to add the elements
back first. Don't describe it as working.

**If the picture is missing,** there is no fallback character. The page will show the stage empty. The
old promise that a missing picture falls back to a drawing is no longer true.

## 5. Replies

Replies are spoken, not printed as chat bubbles. The text also goes into `#live`, which is invisible
but announced by screen readers — so the reply is available when the sound is off, and there is a
live region for accessibility.

## 6. Parts

- **Two screens.** `#auth` is the sign-in card. `<main>` is the workspace. JavaScript switches between
  them by adding or removing `hidden`.
- **Sign-in card.** The logo, "Doctor Login", an email box, a password box, one button, a status
  line, and a small row offering the five demo users.
- **Buttons.** Pill shaped, teal gradient, lift slightly on hover and press down when clicked.
- **Settings.** A native dialog, 24px corners, dark backdrop. Four things: your name, whether Era
  speaks, whether she greets you, and which voice to use. A short note explains the voice choice.
  Speed and pitch sliders, the schedule editor, and the clear-history button were all removed — don't
  add them back by accident when reading older versions of this file.

## 7. Access and motion

- Every button, input and select has a 3px blue focus ring.
- `#live` announces every reply.
- Buttons carry `title` tooltips.
- `prefers-reduced-motion: reduce` switches off all animation.

## 8. Voice behaviour

- Era speaks only the reply text, only in NVIDIA Sofia's voice.
- The Settings voice list has two options: Sofia in English, and Sofia in हिन्दी. Which one is used
  is decided per reply — Hindi or Hinglish text gets the Hindi voice.
- Pressing the microphone stops whatever is playing first, so the two never overlap.
- Stop cuts off immediately.
- If the voice service can't be reached, the status line says so and Era stays quiet. Retrying and the
  saved audio are handled on the server.

## 9. Known design gaps

- The character has no expression while listening, and no lip movement while speaking, because those
  effects needed the drawing rig that was removed in 3.7.2.
- There is no visible indication that sound is switched off. If "Era speaks replies" is unticked, the
  only sign is that nothing comes out.
- The red `denied` styling shows only as long as Era is speaking. When the reply finishes she returns
  to her normal look, so a refusal is easy to miss if you weren't watching.
- The reply text lives in an invisible screen-reader region. There is no on-screen transcript, so a
  doctor who can't hear her has nothing to read either.
- If `assets/era3d.png` is missing the stage is simply empty — no fallback character exists. The
  Render deploy always ships the image, but a locally deleted asset leaves a blank stage with only
  the status line alive.