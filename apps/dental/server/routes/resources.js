// server/routes/resources.js — patients, appointments, chart, plans, invoices.
// Identity ALWAYS from req.auth (set by requireAuthMw); ownership in the WHERE clause.
'use strict';
const express = require('express');
const { db } = require('../db/connection');
const { requireAuth, requireDentist, httpErr } = require('../middleware/auth');
const { h } = require('../middleware/helpers');
const { audit } = require('../services/audit');
const { tools, runTool, slotClash } = require('../services/tools');
const { validTooth, TOOTH_STATUS } = require('../services/fdi');

const router = express.Router();

// attach auth to every resource call
router.use((req, res, next) => {
  try { req.auth = requireAuth(req); next(); }
  catch (e) { res.status(401).json({ ok: false, error: 'AUTH_REQUIRED', message: e.message }); }
});
const D = u => requireDentist(u); // throws 403 for reception on dentist-only resources

// ---------- patients ----------
router.get('/patients', h((req, res, reqId) => {
  const d = D(req.auth);
  const rows = tools.getMyPatients({ dentistId: d }, { q: req.query.q });
  audit(req.auth.sub, d, 'list', 'patients', reqId, true, null, 'patients', null);
  res.json({ ok: true, data: rows });
}));

router.post('/patients', h((req, res, reqId) => {
  const d = D(req.auth);
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw httpErr(400, 'BAD_REQUEST', 'A patient name is required.');
  const phone = String(b.phone || '').trim();
  // walk-in safety: same phone returns the existing patient instead of a duplicate
  if (phone) {
    const dup = db.prepare(`SELECT p.id FROM patients p JOIN dentist_patients dp ON dp.patient_id=p.id
      WHERE dp.dentist_id=? AND p.phone=?`).get(d, phone);
    if (dup) return res.json({ ok: true, existing: true, data: { id: dup.id } });
  }
  const id = db.prepare('INSERT INTO patients(name,dob,phone,gender,medical_notes) VALUES (?,?,?,?,?)')
    .run(name, b.dob || null, phone || null, b.gender || null, b.medical_notes ? String(b.medical_notes).slice(0, 300) : null).lastInsertRowid;
  db.prepare('INSERT INTO dentist_patients(dentist_id,patient_id) VALUES (?,?)').run(d, id);
  audit(req.auth.sub, d, 'create', 'patients', reqId, true, null, 'patients', id);
  res.status(201).json({ ok: true, data: { id } });
}));

// ---------- appointments ----------
router.get('/appointments', h((req, res, reqId) => {
  const d = D(req.auth);
  const rows = tools.getMyAppointments({ dentistId: d }, { date: req.query.date, upcoming: req.query.upcoming === '1' });
  audit(req.auth.sub, d, 'list', 'appointments', reqId, true, null, 'appointments', null);
  res.json({ ok: true, data: rows });
}));

router.post('/appointments', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = runTool({ dentistId: d }, 'createAppointment', req.body || {});
  audit(req.auth.sub, d, 'create', 'appointments', reqId, true, null, 'appointments', out.appointment_id);
  res.status(201).json({ ok: true, data: out });
}));

router.patch('/appointments/:id', h((req, res, reqId) => {
  const d = D(req.auth);
  const b = req.body || {};
  if (b.status && ['scheduled', 'completed', 'cancelled', 'no_show'].includes(b.status)) {
    const r = db.prepare("UPDATE appointments SET status=?, updated_at=datetime('now') WHERE id=? AND dentist_id=?").run(b.status, +req.params.id, d);
    if (!r.changes) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    audit(req.auth.sub, d, 'update', 'appointments', reqId, true, null, 'appointments', +req.params.id);
    return res.json({ ok: true });
  }
  const out = runTool({ dentistId: d }, 'rescheduleAppointment', { appointment_id: +req.params.id, date: b.appointment_date || b.date, start_time: b.start_time || b.appointment_time, end_time: b.end_time });
  audit(req.auth.sub, d, 'update', 'appointments', reqId, true, null, 'appointments', out.appointment_id);
  res.json({ ok: true, data: out });
}));

router.delete('/appointments/:id', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = runTool({ dentistId: d }, 'cancelAppointment', { appointment_id: +req.params.id });
  audit(req.auth.sub, d, 'delete', 'appointments', reqId, true, null, 'appointments', out.appointment_id);
  res.json({ ok: true, data: out });
}));

// ---------- chart (FDI) ----------
router.get('/chart/:patientId', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = tools.getPatientChart({ dentistId: d }, { patient_id: +req.params.patientId });
  audit(req.auth.sub, d, 'get', 'chart', reqId, true, null, 'chart', +req.params.patientId);
  res.json({ ok: true, data: out });
}));

router.post('/chart/:patientId', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = runTool({ dentistId: d }, 'updateToothRecord', { ...(req.body || {}), patient_id: +req.params.patientId });
  audit(req.auth.sub, d, 'create', 'chart', reqId, true, JSON.stringify(req.body || {}).slice(0, 200), 'chart', +req.params.patientId);
  res.status(201).json({ ok: true, data: out });
}));

// ---------- treatments (catalogue, any signed-in user) ----------
router.get('/treatments', h((req, res) => res.json({ ok: true, data: tools.getTreatments() })));

// ---------- plans ----------
router.get('/plans', h((req, res, reqId) => {
  const d = D(req.auth);
  const rows = tools.getMyPlans({ dentistId: d }, { patient_id: req.query.patient_id });
  audit(req.auth.sub, d, 'list', 'plans', reqId, true, null, 'plans', null);
  res.json({ ok: true, data: rows });
}));

router.get('/plans/:id', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = tools.getPlanDetails({ dentistId: d }, { plan_id: +req.params.id });
  audit(req.auth.sub, d, 'get', 'plans', reqId, true, null, 'plans', +req.params.id);
  res.json({ ok: true, data: out });
}));

router.post('/plans', h((req, res, reqId) => {
  const d = D(req.auth);
  const out = runTool({ dentistId: d }, 'createTreatmentPlan', req.body || {});
  audit(req.auth.sub, d, 'create', 'plans', reqId, true, null, 'plans', out.plan_id);
  res.status(201).json({ ok: true, data: out });
}));

router.patch('/plans/:planId/items/:itemId', h((req, res, reqId) => {
  const d = D(req.auth);
  const item = db.prepare('SELECT pi.id FROM plan_items pi JOIN treatment_plans p ON p.id=pi.plan_id WHERE pi.id=? AND p.id=? AND p.dentist_id=?').get(+req.params.itemId, +req.params.planId, d);
  if (!item) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
  const out = runTool({ dentistId: d }, 'updatePlanItem', { item_id: +req.params.itemId, status: (req.body || {}).status });
  audit(req.auth.sub, d, 'update', 'plan_items', reqId, true, null, 'plans', +req.params.itemId);
  res.json({ ok: true, data: out });
}));

// ---------- invoices ----------
router.get('/invoices', h((req, res, reqId) => {
  const rows = tools.getMyInvoices(req.auth, { status: req.query.status });
  audit(req.auth.sub, req.auth.dentistId, 'list', 'invoices', reqId, true, null, 'invoices', null);
  res.json({ ok: true, data: rows });
}));

router.patch('/invoices/:id', h((req, res, reqId) => {
  const b = req.body || {};
  const out = runTool(req.auth, 'markInvoicePaid', { invoice_id: +req.params.id, paid_amount: b.paid_amount, discount: b.discount });
  audit(req.auth.sub, req.auth.dentistId, 'update', 'invoices', reqId, true, null, 'invoices', +req.params.id);
  res.json({ ok: true, data: out });
}));

// schedule (own working hours)
router.get('/schedule', h((req, res) => res.json({ ok: true, data: tools.getMySchedule({ dentistId: D(req.auth) }) })));

module.exports = router;
