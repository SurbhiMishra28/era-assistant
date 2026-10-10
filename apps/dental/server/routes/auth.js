// server/routes/auth.js — login / auto-signup / logout / me / demo-login.
// Throttle = TWO counters (Era's lesson): per (IP+email) clears on that account's success;
// per IP never clears (one colleague logging in must not re-arm an attacker).
'use strict';
const express = require('express');
const { db } = require('../db/connection');
const { mintToken, verifyJWT, requireAuth, bcrypt } = require('../middleware/auth');
const { h } = require('../middleware/helpers');
const { audit } = require('../services/audit');

const router = express.Router();
const tries = new Map();
const ipOf = req => String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
const PRUNE = (k, now, w) => (tries.get(k) || []).filter(ts => now - ts < w);
const W = 15 * 60 * 1000, PAIR_MAX = 8, IP_MAX = 30;

function tooMany(req, email) {
  const now = Date.now();
  const pair = ipOf(req) + '|' + email.toLowerCase();
  const hit = PRUNE(pair, now, W); tries.set(pair, hit);
  if (hit.length >= PAIR_MAX) return Math.ceil((W - (now - hit[0])) / 1000);
  const h2 = PRUNE(ipOf(req), now, W); tries.set(ipOf(req), h2);
  if (h2.length >= IP_MAX) return Math.ceil((W - (now - h2[0])) / 1000);
  return 0;
}
const noteFail = (req, email) => { const now = Date.now();
  const pair = ipOf(req) + '|' + email.toLowerCase();
  tries.set(pair, PRUNE(pair, now, W).concat(now));
  tries.set(ipOf(req), PRUNE(ipOf(req), now, W).concat(now)); };

// Secure only when the request really is TLS (Render sets x-forwarded-proto). Marking it Secure on
// plain-HTTP localhost makes browsers/agents drop the cookie → instant 401 loop (Era's isTLS rule).
const isTLS = req => !!req.secure || /^https/i.test(String(req.headers['x-forwarded-proto'] || ''));
const cookieFor = req => ({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 * 1000, secure: isTLS(req) });
const profileOf = u => {
  const d = db.prepare('SELECT id,specialty FROM dentists WHERE user_id=?').get(u.id);
  return { id: u.id, name: u.name, role: u.role, dentistId: d ? d.id : null, specialty: d ? d.specialty : null };
};

router.post('/login', h((req, res, reqId) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const password = String((req.body || {}).password || '');
  const wait = tooMany(req, email);
  if (wait) { audit(null, null, 'login_throttled', null, reqId, false, null, 'auth', null);
    return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS', retry_after_s: wait,
      message: 'Too many sign-in attempts. Please wait a minute and try again.' }); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Please enter a valid email address.'), { status: 400, err: 'BAD_REQUEST' });
  if (password.length < 4) throw Object.assign(new Error('Please use a password with at least 4 characters.'), { status: 400, err: 'BAD_REQUEST' });
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (row && row.password_hash) {
    if (!bcrypt.compareSync(password, row.password_hash)) { noteFail(req, email);
      audit(row.id, null, 'login_failed', null, reqId, false, null, 'auth', row.id);
      throw Object.assign(new Error('Wrong password for this email. New here? A new email creates an account automatically.'), { status: 401, err: 'BAD_CREDENTIALS' }); }
    const prof = profileOf(row);
    const t = mintToken(prof, prof.dentistId);
    audit(row.id, prof.dentistId, 'login', null, reqId, true, null, 'auth', row.id);
    return res.cookie('dent_token', t, cookieFor(req)).status(200).json({ ok: true, token: t, user: prof });
  }
  // unknown email → auto sign-up as a dentist (Era's onboarding trick)
  const name = (email.split('@')[0].replace(/[._\-+]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase())) || 'New Dentist';
  const uid = db.prepare('INSERT INTO users(name,role,email,password_hash) VALUES (?,?,?,?)').run(name, 'dentist', email, bcrypt.hashSync(password, 10)).lastInsertRowid;
  const did = db.prepare('INSERT INTO dentists(user_id,specialty) VALUES (?,?)').run(uid, 'General Dentistry').lastInsertRowid;
  const t = mintToken({ id: uid, name, role: 'dentist' }, did);
  audit(uid, did, 'register', null, reqId, true, null, 'auth', uid);
  return res.cookie('dent_token', t, cookieFor(req)).status(201).json({ ok: true, created: true, token: t, user: { id: uid, name, role: 'dentist', dentistId: did } });
}));

router.post('/logout', h((req, res, reqId) => {
  const u = verifyJWT(req);
  if (u) audit(u.sub, u.dentistId, 'logout', null, reqId, true, null, 'auth', u.sub);
  return res.clearCookie('dent_token', { path: '/' }).status(200).json({ ok: true });
}));

router.get('/me', h((req, res) => {
  const u = requireAuth(req);
  return res.status(200).json({ ok: true, user: profileOf(db.prepare('SELECT * FROM users WHERE id=?').get(u.sub) || {}) });
}));

// demo personas (DEMO_LOGIN=1) — for the bundled UI and reviewers
router.post('/demo-login', h((req, res, reqId) => {
  if (process.env.DEMO_LOGIN === '0') return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  const who = String((req.body || {}).who || '');
  const map = { dentistA: 'meera@dental.local', dentistB: 'arjun@dental.local', reception: 'desk@dental.local', admin: 'admin@dental.local' };
  const email = map[who];
  if (!email) throw Object.assign(new Error('Unknown demo user.'), { status: 400, err: 'BAD_REQUEST' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u) throw Object.assign(new Error('Demo user missing — seed the DB first.'), { status: 404, err: 'NOT_FOUND' });
  const prof = profileOf(u);
  const t = mintToken(prof, prof.dentistId);
  audit(u.id, prof.dentistId, 'demo_login', null, reqId, true, null, 'auth', u.id);
  return res.cookie('dent_token', t, cookieFor(req)).status(200).json({ ok: true, token: t, user: prof });
}));

module.exports = router;
