// server/services/knowledge.js — dental Q&A lookup: keyword scoring over the ai_doctor table.
'use strict';
const { db } = require('../db/connection');

function answerFor(message) {
  const text = String(message || '').toLowerCase();
  const rows = db.prepare('SELECT id,q,keywords,a FROM ai_doctor').all();
  let best = null, bestScore = 0;
  for (const r of rows) {
    let kws = []; try { kws = JSON.parse(r.keywords); } catch {}
    let score = 0;
    for (const k of kws) if (text.includes(String(k).toLowerCase())) score += 2;
    if (text.includes(String(r.q).toLowerCase())) score += 3;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 2 ? { id: best.id, q: best.q, a: best.a } : null;
}
const count = () => db.prepare('SELECT COUNT(*) c FROM ai_doctor').get().c;

module.exports = { answerFor, count };
