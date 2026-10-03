# Design.md — Era UI

**Version:** 2.5.0 (NVIDIA-only voice) · **Last updated:** 2026-10-01

## 1. Design language
Calm clinical palette, soft rounded surfaces (radius 14–28 px), pill buttons, airy spacing.
One accent does the work: **teal**. Everything else is quiet blues and greys.
Typography: **Manrope** (400/600/800) via Google Fonts, fallback `system-ui, sans-serif`.

## 2. Tokens (`style.css :root`)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#eef5f7` | page background |
| `--ink` | `#123240` | text |
| `--mut` | `#5d7784` | secondary text, timestamps |
| `--teal` | `#1f9d9a` | accent: buttons, bubbles, waves |
| `--blue` | `#7fa8cf` | focus rings, ring gradient |
| `--card` | `#fff` | panels |

## 3. Layout
Single centered character stage (`main`, max 1100 px): one `#face` card (max 460 px wide) holds the
whorow (identity + sign out), the SVG character stage, wave bars, status, controls and the slim
fallback text input. No chat panel — Era's voice and presence are the interface.

## 4. The character (photo, v3.7.2)
- `assets/era3d.png` (3D character render, transparent background) is the character — visible by
  default in `#photoWrap` (the v3.6 SVG rig was removed in v3.7.2). Floats (`float`) and breathes
  (`breathe`); `talk` scale-pulse while speaking. Cover-cropped with `--eraPhotoW/H/X/Y` knobs in
  `:root` (`50% 12%` default keeps the face in frame).
- **Lip sync:** the mouth is a **clip rig** — `#mouthClipPath` (in `defs`) is swapped through the
  `MOUTH` viseme set (rest/closed/wide/round/open/ooh) on TTS `onboundary` word events; teeth
  (`#fdfdfd` bar) and tongue (ellipse) sit inside the clipped `#mouthGrp`. A rAF jaw loop adds
  continuous motion; `onend` restores the rest shape.
- **Idle life:** randomized blinks (`.eye` scaleY via JS, 0.09 s ease) + occasional brow raises
  (JS swaps the brow `Q` control point, generic for any geometry). `.eye` needs
  `transform-box: fill-box` for SVG scaling.
- **Listening:** eyes squint (`.eye` scaleY .55), rings pulse red (`listen`), mic turns `#d64545`.
- **Speaking:** wave bars animate (`bar`, staggered delays).
- **Photo mode (v3.7):** if `assets/era3d.png` loads, `#photoWrap` (clean image, no overlay) replaces
  the SVG and inherits the same motion — float/breathe idle, `talk` scale pulse while speaking.
  Missing/broken file keeps the SVG rig (graceful fallback).
- States live on `#face[data-state]`: `idle | listening | speaking`; `#status` text mirrors them.

## 5. Replies (voice-only)
Replies are spoken, not rendered as bubbles. `#live` (`.sr-only`, `aria-live="polite"`) carries the
current reply text for screen readers and for when "Era speaks" is off. Chat bubbles and the
message-entrance animation were removed with the chat panel in v3.5.

## 6. Components
- **Two-view flow (v3.5):** ① `#auth` — doctor login/signup card only; ② `<main>` — the workspace:
  Era herself (pop-up greeting on entry, voice loop). `.view` = fullscreen gradient screens; JS
  `show()` toggles `.hidden`. The "Meet Era" intro card and chat panel were removed in v3.5.
- **Chips**: quiet pill buttons (`#eef5f7` bg, `#cfe0e6` border, 0.85 rem).
- **Settings `<dialog>`**: 24 px radius, width `min(460px, 92vw)`, dark backdrop `#123240aa`;
  stacked labeled fields: name, "Era speaks replies", "Greet me when I start", voice select,
  rate/pitch sliders. (Schedule editor and clear-chat-history removed with the chat panel in v3.5.)

## 7. Accessibility & motion
- `:focus-visible` gets a 3 px `--blue` outline everywhere.
- `#live` (`.sr-only`) is `aria-live="polite"` — every Era reply is announced even when TTS is off;
  mic/settings buttons carry `title` tooltips.
- `prefers-reduced-motion: reduce` kills all animations globally.

## 8. Voice UX rules
- Era speaks only the *reply text*, ONLY in **NVIDIA Sofia's voice** (v4.0: single female voice —
  all other personas removed) via the `/api/tts` proxy — natural, human-like delivery.
- Settings **NVIDIA Voice** is a 2-option select: "Sofia · English" (default) / "Sofia · हिन्दी".
  Language itself is auto-picked per reply (Devanagari/romanised Hinglish → हिन्दी Sofia).
- Mic press stops current audio first (no overlap while listening); Stop cancels instantly.
- Voice service unreachable → `#status` shows "Voice service unavailable"; Era stays silent until
  NVIDIA recovers (retries + WAV cache live server-side).
