// server/routes/admin.js — clinic-wide Admin Panel API (v1.2, additive).
// Role-gated: 'admin' + 'reception' only. READ-ONLY — invoice payments stay on
// /api/invoices (markInvoicePaid already allows non-dentist roles by design).
// Every query is parameterized; no patient data leaves dentist scoping here.
'use strict';
const express = require('express');
const { db, localDay } = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');
const { h } = require('../middleware/helpers');
const { audit } = require('../services/audit');

const router = express.Router();

router.use((req, res, next) => {
  try { req.auth = requireRole('admin', 'reception')(requireAuth(req)); next(); }
  catch (e) { res.status(e.status || 401).json({ ok: false, error: e.err || 'AUTH_REQUIRED', message: e.message }); }
});

// KPI cards for the overview tab
router.get('/overview', h((req, res, reqId) => {
  const t0 = localDay(0), t7 = localDay(7);
  const one = (sql, ...args) => db.prepare(sql).get(...args).c;
  const data = {
    patients: one('SELECT COUNT(*) c FROM patients'),
    users: one('SELECT COUNT(*) c FROM users'),
    dentists: one('SELECT COUNT(*) c FROM dentists'),
    appts_today: one('SELECT COUNT(*) c FROM appointments WHERE appointment_date=?', t0),
    appts_week: one('SELECT COUNT(*) c FROM appointments WHERE appointment_date BETWEEN ? AND ?', t0, t7),
    plans_active: one("SELECT COUNT(*) c FROM treatment_plans WHERE status='active'"),
    public_bookings: one("SELECT COUNT(*) c FROM appointments WHERE source='public'"),
    unpaid: one("SELECT COUNT(*) c FROM invoices WHERE status!='paid'"),
    unpaid_due: db.prepare("SELECT COALESCE(SUM(amount-discount-paid_amount),0) c FROM invoices WHERE status!='paid'").get().c,
    treatments: one('SELECT COUNT(*) c FROM treatments')
  };
  audit(req.auth.sub, null, 'list', 'admin_overview', reqId, true, null, 'admin', null);
  res.json({ ok: true, data });
}));

// clinic-wide appointments for the next `days` days (default 7)
router.get('/appointments', h((req, res, reqId) => {
  const days = Math.min(Math.max(+req.query.days || 7, 1), 31);
  const rows = db.prepare(`
    SELECT a.id, a.appointment_date, a.start_time, a.end_time, a.status, a.reason, a.source,
           a.patient_name, p.name AS registered_patient, u.name AS dentist
    FROM appointments a
    JOIN dentists dn ON dn.id = a.dentist_id
    JOIN users u ON u.id = dn.user_id
    LEFT JOIN patients p ON p.id = a.patient_id
    WHERE a.appointment_date BETWEEN ? AND ?
    ORDER BY a.appointment_date, a.start_time
    LIMIT 200`).all(localDay(0), localDay(days));
  audit(req.auth.sub, null, 'list', 'admin_appointments', reqId, true, null, 'admin', null);
  res.json({ ok: true, data: rows });
}));

// all patients with their linked dentists + visit count
router.get('/patients', h((req, res, reqId) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.phone, p.gender, p.medical_notes,
      (SELECT GROUP_CONCAT(DISTINCT u2.name) FROM dentist_patients dp
        JOIN dentists dn ON dn.id = dp.dentist_id JOIN users u2 ON u2.id = dn.user_id
        WHERE dp.patient_id = p.id) AS dentists,
      (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS visits
    FROM patients p ORDER BY p.id LIMIT 200`).all();
  audit(req.auth.sub, null, 'list', 'admin_patients', reqId, true, null, 'admin', null);
  res.json({ ok: true, data: rows });
}));

// last 40 assistant/audit events (who did what, when)
router.get('/audit', h((req, res, reqId) => {
  const rows = db.prepare(`
    SELECT aa.id, aa.action, aa.tool_name, aa.success, aa.detail, aa.created_at,
           u.name AS user
    FROM assistant_audit aa LEFT JOIN users u ON u.id = aa.user_id
    ORDER BY aa.id DESC LIMIT 40`).all();
  audit(req.auth.sub, null, 'list', 'admin_audit', reqId, true, null, 'admin', null);
  res.json({ ok: true, data: rows });
}));

module.exports = router;
