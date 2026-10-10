// server/services/fdi.js — FDI tooth validation: adult 11–48 (quadrant 1–4 × 1–8),
// primary 55–85 (quadrant 5–8 × 1–5). Anything else is invalid → 400 at the caller.
'use strict';

const TOOTH_STATUS = ['healthy', 'decayed', 'filled', 'root_canal', 'crowned', 'missing', 'implant'];

function validTooth(t) {
  const m = /^(\d)(\d)$/.exec(String(t || '').trim());
  if (!m) return false;
  const q = +m[1], pos = +m[2];
  if (q >= 1 && q <= 4) return pos >= 1 && pos <= 8;   // adult
  if (q >= 5 && q <= 8) return pos >= 1 && pos <= 5;   // primary
  return false;
}

module.exports = { validTooth, TOOTH_STATUS };
