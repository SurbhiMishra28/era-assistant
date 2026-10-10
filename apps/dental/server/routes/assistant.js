// server/routes/assistant.js — chat endpoint (brain → tool → sanitized reply → audit),
// per-day conversation history (the chat drawer's API), and the Sofia TTS proxy.
'use strict';
const express = require('express');
const { db, localDay } = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { h } = require('../middleware/helpers');
const { audit } = require('../services/audit');
const { routeIntent } = require('../services/brain');
const { runTool, WRITE } = require('../services/tools');
const { nvidiaKey, synthesize, SOFIA_VOICES, DEFAULT_VOICE } = require('../services/tts');

const router = express.Router();

const sanitize = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'dentist_id' || k === 'patient_id') ? undefined : v));

function toolReply(tool, out, intent) {
  if (intent && intent.tool && WRITE.has(intent.tool)) {
    if (tool === 'createAppointment') return `Booked your appointment (#${out.appointment_id}).`;
    if (tool === 'rescheduleAppointment') return `Rescheduled appointment #${out.appointment_id} to ${out.date} at ${out.start_time}.`;
    if (tool === 'cancelAppointment') return `Cancelled appointment #${out.appointment_id}.`;
    if (tool === 'updateToothRecord') return `Recorded tooth ${out.tooth_fdi} as ${out.tooth_status.replace('_', ' ')}.`;
    if (tool === 'createTreatmentPlan') return `Created the treatment plan (#${out.plan_id}) with an estimate of ₹${out.total_estimate}.`;
    if (tool === 'updatePlanItem') return `Plan item marked ${out.status}.`;
    if (tool === 'markInvoicePaid') return `Invoice #${out.invoice_id} is now ${out.status}.`;
    return 'Done.';
  }
  return 'Done.';
}

// chat history persistence (best-effort) — one conversation per user per day
function logChatTurn(userId, message, reply, tool) {
  try {
    const day = localDay(0);
    db.prepare('INSERT INTO conversations(user_id,day,title) VALUES (?,?,?) ON CONFLICT(user_id,day) DO NOTHING')
      .run(userId, day, 'Chat — ' + day);
    const c = db.prepare('SELECT id FROM conversations WHERE user_id=? AND day=?').get(userId, day);
    db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,tool) VALUES (?,'user',?,?)").run(c.id, String(message).slice(0, 500), tool || null);
    db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,tool) VALUES (?,'era',?,?)").run(c.id, String(reply).slice(0, 2000), tool || null);
    db.prepare("UPDATE conversations SET updated_at=datetime('now') WHERE id=?").run(c.id);
  } catch (e) { console.warn('[dentera] chat history skipped:', e.message); }
}

const DENY = 'I can only access information available to your dental account. Sign in as a dentist to use chart, plan and appointment tools.';

router.post('/assistant/chat', h((req, res, reqId) => {
  const u = requireAuth(req); // {sub, role, dentistId, name}
  const message = String((req.body || {}).message || '').slice(0, 500).trim();
  if (!message) return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'message is required.' });
  const intent = routeIntent(message, { dentistId: u.dentistId, role: u.role, name: u.name });
  if (intent.tool && u.dentistId == null) { // reception/admin: friendly denial, tool layer still enforces
    audit(u.sub, null, 'chat_denied', intent.tool, reqId, false, message.slice(0, 100));
    logChatTurn(u.sub, message, DENY, intent.tool);
    return res.json({ ok: true, denied: true, request_id: reqId, tool: intent.tool, reply: DENY });
  }
  let out = null;
  if (intent.tool) out = runTool({ dentistId: u.dentistId, role: u.role }, intent.tool, intent.args || {});
  audit(u.sub, u.dentistId, intent.tool || 'reply', intent.tool || null, reqId, true, message.slice(0, 100));
  const reply = intent.tool ? toolReply(intent.tool, out, intent) : intent.text;
  logChatTurn(u.sub, message, reply, intent.tool || null);
  res.json({ ok: true, request_id: reqId, tool: intent.tool || null,
    tool_result: out ? sanitize(out) : null, write: !!(intent.tool && WRITE.has(intent.tool)), reply });
}));

router.get('/assistant/conversations', h((req, res, reqId) => {
  const u = requireAuth(req);
  const rows = db.prepare(`SELECT c.id,c.day,c.title,c.updated_at,
    (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id=c.id) AS messages
    FROM conversations c WHERE c.user_id=? ORDER BY c.day DESC, c.id DESC LIMIT 30`).all(u.sub);
  res.json({ ok: true, data: rows });
}));

router.get('/assistant/conversations/:id', h((req, res, reqId) => {
  const u = requireAuth(req);
  const c = db.prepare('SELECT id,day,title,updated_at FROM conversations WHERE id=? AND user_id=?').get(+req.params.id, u.sub);
  if (!c) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'You are not authorized to access this resource.' });
  const messages = db.prepare('SELECT role,text,tool,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY id').all(c.id);
  res.json({ ok: true, data: { ...c, messages } });
}));

router.delete('/assistant/conversations/:id', h((req, res, reqId) => {
  const u = requireAuth(req);
  const r = db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(+req.params.id, u.sub);
  audit(u.sub, u.dentistId, 'delete', 'conversations', reqId, !!r.changes, null, 'conversations', +req.params.id);
  if (!r.changes) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'You are not authorized to access this resource.' });
  res.json({ ok: true });
}));

// Sofia TTS proxy — same guard as Era: only the two Sofia voices pass
router.post('/assistant/tts', h(async (req, res, reqId) => {
  const u = requireAuth(req);
  const text = String((req.body || {}).text || '').slice(0, 2000).trim();
  if (!text) return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'text is required.' });
  const voice = String((req.body || {}).voice || '').slice(0, 120) || DEFAULT_VOICE;
  if (!SOFIA_VOICES.includes(voice)) return res.status(400).json({ ok: false, error: 'BAD_VOICE', message: 'Only Sofia voices are available (English / हिन्दी).' });
  if (!nvidiaKey()) return res.status(503).json({ ok: false, error: 'TTS_NOT_CONFIGURED', message: 'No NVIDIA API key configured.' });
  const { wav, errs } = await synthesize({ text, voice });
  audit(u.sub, u.dentistId, 'tts', voice, reqId, !!wav);
  if (!wav) { console.error(reqId, 'tts_failed', errs.join(' | '));
    return res.status(502).json({ ok: false, error: 'TTS_FAILED', message: 'Voice service unavailable. Please try again shortly.' }); }
  res.set('Content-Type', 'audio/wav').set('Cache-Control', 'no-store').send(wav);
}));

module.exports = router;
