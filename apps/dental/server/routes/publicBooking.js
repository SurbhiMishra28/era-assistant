// server/routes/publicBooking.js — the ONLY unauthenticated write in the system.
// Rate-limited 5/10min/IP, strictly validated, interval-overlap checked, source='public'.
'use strict';
const express = require('express');
const { db, localDay } = require('../db/connection');
const { h } = require('../middleware/helpers');
const { audit } = require('../services/audit');
const { addMin } = require('../services/tools');

const router = express.Router();
const tries = new Map();
const W = 10 * 60 * 1000, MAX = 5;
const ipOf = req => String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
function limited(req) {
  const now = Date.now(), ip = ipOf(req);
  const hit = (tries.get(ip) || []).filter(ts => now - ts < W);
  tries.set(ip, hit);
  return hit.length >= MAX;
}
const note = req => { const ip = ipOf(req); tries.set(ip, (tries.get(ip) || []).concat(Date.now())); };

const PHONE = /^[0-9+\-\s]{7,15}$/;

router.get('/public/slots', h((req, res) => {
  if (limited(req)) return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS', message: 'Too many requests. Please wait a few minutes.' });
  note(req);
  const dentistId = +req.query.dentist, date = String(req.query.date || '');
  if (!dentistId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'dentist and date (YYYY-MM-DD) are required.' });
  const den = db.prepare('SELECT d.id,u.name FROM dentists d JOIN users u ON u.id=d.user_id WHERE d.id=?').get(dentistId);
  if (!den) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Unknown dentist.' });
  const dow = new Date(date + 'T00:00:00').getDay();
  const win = db.prepare('SELECT start_time,end_time FROM dentist_schedules WHERE dentist_id=? AND day_of_week=?').all(dentistId, dow);
  if (!win.length) return res.json({ ok: true, data: [] });
  const busy = db.prepare(`SELECT start_time,end_time FROM appointments
    WHERE dentist_id=? AND appointment_date=? AND status!='cancelled'`).all(dentistId, date);
  const slots = [];
  for (const w of win) for (let t = w.start_time; t < w.end_time;) {
    const end = addMin(t, 30);
    if (!busy.some(b => t < b.end_time && b.start_time < end)) slots.push({ time: t });
    t = end;
  }
  res.json({ ok: true, data: slots, dentist: den.name });
}));

router.post('/public/booking', h((req, res, reqId) => {
  if (limited(req)) { audit(null, null, 'public_booking_throttled', null, reqId, false, null, 'booking', null);
    return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS', message: 'Too many booking attempts. Please wait a few minutes.' }); }
  note(req);
  const b = req.body || {};
  const dentistId = +b.dentist_id, date = String(b.date || ''), time = String(b.time || '');
  const name = String(b.name || '').trim().slice(0, 120);
  const phone = String(b.phone || '').trim();
  const reason = String(b.reason || '').trim().slice(0, 200);
  if (!dentistId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw Object.assign(new Error('dentist, date (YYYY-MM-DD) and time (HH:MM) are required.'), { status: 400, err: 'BAD_REQUEST' });
  if (!name) throw Object.assign(new Error('Please tell us your name.'), { status: 400, err: 'BAD_REQUEST' });
  if (!PHONE.test(phone)) throw Object.assign(new Error('Please enter a valid phone number (7–15 digits).'), { status: 400, err: 'BAD_REQUEST' });
  const today = localDay(0);
  if (date < today || date > localDay(14)) throw Object.assign(new Error('Please pick a date within the next 14 days.'), { status: 400, err: 'BAD_REQUEST' });
  const den = db.prepare('SELECT id FROM dentists WHERE id=?').get(dentistId);
  if (!den) throw Object.assign(new Error('Unknown dentist.'), { status: 404, err: 'NOT_FOUND' });
  const end = addMin(time, 30);
  const clash = db.prepare(`SELECT 1 x FROM appointments WHERE dentist_id=? AND appointment_date=? AND status!='cancelled'
    AND ? < end_time AND start_time < ?`).get(dentistId, date, time, end);
  if (clash) { audit(null, null, 'public_booking_clash', null, reqId, false, date + ' ' + time, 'booking', dentistId);
    return res.status(409).json({ ok: false, error: 'SLOT_TAKEN', message: 'That slot was just taken — please pick another.' }); }
  const id = db.prepare(`INSERT INTO appointments(dentist_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason,source)
    VALUES (?,?,?,?,?,?,'scheduled',?,'public')`).run(dentistId, null, name, date, time, end, reason || 'Booking via website').lastInsertRowid;
  audit(null, null, 'public_booking', null, reqId, true, name + ' ' + date + ' ' + time, 'booking', id);
  res.status(201).json({ ok: true, data: { id, date, time, name } });
}));

module.exports = router;
