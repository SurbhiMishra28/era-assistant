// server/services/tools.js — the 15 dental tools (SPEC implementation.md §3).
// scopeDentist is the bodyguard: the client's dentist_id is ALWAYS overridden by the JWT's.
// This is the only service that touches clinic tables. Ownership lives in the WHERE clause.
'use strict';
const { db, localDay, localTime } = require('../db/connection');
const { httpErr } = require('../middleware/auth');
const { validTooth, TOOTH_STATUS } = require('./fdi');

// a dentist can only touch patients linked to them (admin bypasses for reception desk work)
function assertPatientMine(dentistId, patientId) {
  const ok = db.prepare('SELECT 1 x FROM dentist_patients WHERE dentist_id=? AND patient_id=?').get(dentistId, patientId);
  if (!ok) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
}

// interval overlap, never start-time equality (Era bug N2 pre-fixed): touching ends allowed
function slotClash(dentistId, date, start, end, ignoreId) {
  const rows = db.prepare(`SELECT id,start_time,end_time FROM appointments
    WHERE dentist_id=? AND appointment_date=? AND status!='cancelled'`).all(dentistId, date);
  return rows.some(r => start < r.end_time && r.start_time < end && r.id !== ignoreId);
}

const tools = {

  getMyAppointments(u, { date, upcoming } = {}) {
    const d = u.dentistId;
    let sql = `SELECT id,appointment_date,start_time,end_time,status,reason,patient_id,patient_name,source
      FROM appointments WHERE dentist_id=?`;
    const p = [d];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { sql += ' AND appointment_date=?'; p.push(date); }
    if (upcoming) { sql += " AND status!='cancelled' AND (appointment_date>? OR (appointment_date=? AND start_time>=?))"; p.push(localDay(0), localDay(0), localTime()); }
    sql += ' ORDER BY appointment_date,start_time LIMIT 100';
    return db.prepare(sql).all(...p);
  },

  getMySchedule(u) {
    return db.prepare('SELECT day_of_week,start_time,end_time FROM dentist_schedules WHERE dentist_id=? ORDER BY day_of_week').all(u.dentistId);
  },

  getMyPatients(u, { q } = {}) {
    const like = `%${String(q || '').trim()}%`;
    return db.prepare(`SELECT p.id,p.name,p.dob,p.phone,p.gender,p.medical_notes
      FROM patients p JOIN dentist_patients dp ON dp.patient_id=p.id
      WHERE dp.dentist_id=? AND (?='%' OR p.name LIKE ? OR p.phone LIKE ?) ORDER BY p.name LIMIT 100`)
      .all(u.dentistId, like, like, like);
  },

  getPatientChart(u, { patient_id } = {}) {
    const pid = +patient_id; if (!pid) throw httpErr(400, 'BAD_REQUEST', 'patient_id is required.');
    assertPatientMine(u.dentistId, pid);
    const patient = db.prepare('SELECT id,name,dob,phone,gender,medical_notes FROM patients WHERE id=?').get(pid);
    if (!patient) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    const records = db.prepare(`SELECT t.id,t.tooth_fdi,t.tooth_status,t.condition,t.visit_date,t.cost,t.notes,
      tr.name AS treatment_name FROM tooth_records t LEFT JOIN treatments tr ON tr.id=t.treatment_id
      WHERE t.patient_id=? ORDER BY t.id`).all(pid);
    const byTooth = {};
    for (const r of records) (byTooth[r.tooth_fdi] = byTooth[r.tooth_fdi] || []).push(r);
    return { patient, records, byTooth };
  },

  getTreatments() {
    return db.prepare('SELECT id,name,default_cost,default_minutes,category FROM treatments ORDER BY category,name').all();
  },

  getMyPlans(u, { patient_id } = {}) {
    const d = u.dentistId;
    const rows = patient_id
      ? db.prepare('SELECT * FROM treatment_plans WHERE dentist_id=? AND patient_id=? ORDER BY id DESC').all(d, +patient_id)
      : db.prepare('SELECT * FROM treatment_plans WHERE dentist_id=? ORDER BY id DESC LIMIT 50').all(d);
    return rows;
  },

  getPlanDetails(u, { plan_id } = {}) {
    const plan = db.prepare('SELECT * FROM treatment_plans WHERE id=? AND dentist_id=?').get(+plan_id, u.dentistId);
    if (!plan) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    const items = db.prepare(`SELECT pi.*, t.name AS treatment_name FROM plan_items pi
      LEFT JOIN treatments t ON t.id=pi.treatment_id WHERE pi.plan_id=? ORDER BY pi.visit_no, pi.id`).all(plan.id);
    return { plan, items };
  },

  getMyInvoices(u, { status } = {}) {
    const d = u.dentistId;
    const st = String(status || '');
    if (u.role !== 'dentist') // reception/admin see the whole clinic's invoices
      return st ? db.prepare('SELECT * FROM invoices WHERE status=? ORDER BY id DESC LIMIT 100').all(st)
        : db.prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT 100').all();
    return st ? db.prepare(`SELECT i.* FROM invoices i JOIN dentist_patients dp ON dp.patient_id=i.patient_id
      WHERE dp.dentist_id=? AND i.status=? ORDER BY i.id DESC LIMIT 100`).all(d, st)
      : db.prepare(`SELECT i.* FROM invoices i JOIN dentist_patients dp ON dp.patient_id=i.patient_id
      WHERE dp.dentist_id=? ORDER BY i.id DESC LIMIT 100`).all(d);
  },

  getAvailableSlots(u, { date } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw httpErr(400, 'BAD_REQUEST', 'date (YYYY-MM-DD) is required.');
    const dow = new Date(date + 'T00:00:00').getDay();
    const win = db.prepare('SELECT start_time,end_time FROM dentist_schedules WHERE dentist_id=? AND day_of_week=?').all(u.dentistId, dow);
    if (!win.length) return [];
    const busy = db.prepare(`SELECT start_time,end_time FROM appointments
      WHERE dentist_id=? AND appointment_date=? AND status!='cancelled'`).all(u.dentistId, date);
    const slots = [];
    for (const w of win) {
      for (let t = w.start_time; t < w.end_time;) {
        const end = addMin(t, 30);
        if (!busy.some(b => t < b.end_time && b.start_time < end)) slots.push({ date, time: t });
        t = end;
      }
    }
    return slots;
  },

  createAppointment(u, { date, start_time, end_time, patient_id, patient_name, reason } = {}) {
    const d = u.dentistId;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw httpErr(400, 'BAD_REQUEST', 'A valid date (YYYY-MM-DD) is required.');
    if (!/^\d{2}:\d{2}$/.test(start_time || '')) throw httpErr(400, 'BAD_REQUEST', 'A valid start time (HH:MM) is required.');
    const end = /^\d{2}:\d{2}$/.test(end_time || '') ? end_time : addMin(start_time, 30);
    let pid = null, pname = String(patient_name || '').slice(0, 120) || null;
    if (patient_id) { pid = +patient_id; assertPatientMine(d, pid); pname = db.prepare('SELECT name FROM patients WHERE id=?').get(pid)?.name || pname; }
    if (!pid && !pname) throw httpErr(400, 'BAD_REQUEST', 'A patient_id or patient_name is required.');
    if (end <= start_time) throw httpErr(400, 'BAD_REQUEST', 'End time must be after start time.');
    if (slotClash(d, date, start_time, end)) throw httpErr(409, 'SLOT_TAKEN', 'That time overlaps an appointment already booked.');
    const id = db.prepare(`INSERT INTO appointments(dentist_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason,source)
      VALUES (?,?,?,?,?,?, 'scheduled', ?, 'doctor')`).run(d, pid, pname, date, start_time, end, String(reason || 'Consultation').slice(0, 200)).lastInsertRowid;
    return { created: true, appointment_id: id };
  },

  updateToothRecord(u, { patient_id, tooth_fdi, tooth_status, condition, treatment_id, cost, notes } = {}) {
    const d = u.dentistId;
    const pid = +patient_id; if (!pid) throw httpErr(400, 'BAD_REQUEST', 'patient_id is required.');
    assertPatientMine(d, pid);
    if (!validTooth(tooth_fdi)) throw httpErr(400, 'BAD_FDI', `Invalid FDI tooth number: ${tooth_fdi}. Use 11–48 (adult) or 55–85 (primary).`);
    if (!TOOTH_STATUS.includes(tooth_status)) throw httpErr(400, 'BAD_STATUS', 'Invalid tooth status.');
    if (treatment_id && !db.prepare('SELECT 1 x FROM treatments WHERE id=?').get(treatment_id)) throw httpErr(400, 'BAD_REQUEST', 'Unknown treatment.');
    const id = db.prepare(`INSERT INTO tooth_records(patient_id,dentist_id,tooth_fdi,tooth_status,condition,treatment_id,visit_date,cost,notes)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(pid, d, String(tooth_fdi).trim(), tooth_status,
      condition ? String(condition).slice(0, 200) : null, treatment_id || null, localDay(0),
      Number.isFinite(+cost) && cost !== '' ? +cost : null, notes ? String(notes).slice(0, 300) : null).lastInsertRowid;
    return { created: true, record_id: id, tooth_fdi: String(tooth_fdi).trim(), tooth_status };
  },

  createTreatmentPlan(u, { patient_id, title, items } = {}) {
    const d = u.dentistId;
    const pid = +patient_id; if (!pid) throw httpErr(400, 'BAD_REQUEST', 'patient_id is required.');
    assertPatientMine(d, pid);
    const list = Array.isArray(items) ? items : [];
    if (!String(title || '').trim() || !list.length) throw httpErr(400, 'BAD_REQUEST', 'A title and at least one item are required.');
    const total = list.reduce((s, it) => s + (+it.cost || 0), 0);
    const tx = db.transaction(() => {
      const planId = db.prepare('INSERT INTO treatment_plans(patient_id,dentist_id,title,status,total_estimate) VALUES (?,?,?,?,?)')
        .run(pid, d, String(title).slice(0, 120), 'active', total).lastInsertRowid;
      const ins = db.prepare('INSERT INTO plan_items(plan_id,tooth_fdi,treatment_id,visit_no,cost,status) VALUES (?,?,?,?,?,?)');
      list.forEach((it, i) => {
        if (it.tooth_fdi && !validTooth(it.tooth_fdi)) throw httpErr(400, 'BAD_FDI', `Invalid FDI tooth number: ${it.tooth_fdi}`);
        ins.run(planId, it.tooth_fdi ? String(it.tooth_fdi).trim() : null, it.treatment_id || null, +it.visit_no || i + 1, +it.cost || 0, 'planned');
      });
      return planId;
    });
    const plan_id = tx();
    db.prepare(`INSERT INTO invoices(patient_id,plan_id,amount,discount,paid_amount,status) VALUES (?,?,?,0,0,'unpaid')`)
      .run(pid, plan_id, total);
    return { created: true, plan_id, total_estimate: total };
  },

  updatePlanItem(u, { item_id, status } = {}) {
    const d = u.dentistId;
    if (!['planned', 'done', 'cancelled'].includes(status)) throw httpErr(400, 'BAD_REQUEST', 'Invalid item status.');
    const item = db.prepare(`SELECT pi.*, p.dentist_id FROM plan_items pi JOIN treatment_plans p ON p.id=pi.plan_id WHERE pi.id=?`)
      .get(+item_id);
    if (!item || item.dentist_id !== d) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    db.prepare("UPDATE plan_items SET status=? WHERE id=?").run(status, item.id);
    if (status === 'done' && item.tooth_fdi) { // completing a visit records it on the chart too
      db.prepare(`INSERT INTO tooth_records(patient_id,dentist_id,tooth_fdi,tooth_status,condition,treatment_id,visit_date,cost,notes)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(item.plan_id && db.prepare('SELECT patient_id FROM treatment_plans WHERE id=?').get(item.plan_id).patient_id,
        d, item.tooth_fdi, 'filled', 'Plan item completed', item.treatment_id, localDay(0), item.cost, `Plan item #${item.id}`);
    }
    return { updated: true, item_id: item.id, status };
  },

  markInvoicePaid(u, { invoice_id, paid_amount, discount } = {}) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(+invoice_id);
    if (!inv) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    if (u.role === 'dentist') assertPatientMine(u.dentistId, inv.patient_id);
    const paid = Math.max(0, +paid_amount || inv.amount - inv.discount);
    const disc = Math.max(0, +discount || inv.discount);
    const status = paid >= inv.amount - disc ? 'paid' : (paid > 0 ? 'partial' : 'unpaid');
    db.prepare("UPDATE invoices SET paid_amount=?, discount=?, status=?, updated_at=datetime('now') WHERE id=?")
      .run(paid, disc, status, inv.id);
    return { updated: true, invoice_id: inv.id, status, paid_amount: paid };
  },

  cancelAppointment(u, { appointment_id } = {}) {
    const r = db.prepare("UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=? AND dentist_id=?")
      .run(+appointment_id, u.dentistId);
    if (!r.changes) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    return { cancelled: true, appointment_id: +appointment_id };
  },

  rescheduleAppointment(u, { appointment_id, date, start_time, end_time } = {}) {
    const d = u.dentistId;
    const ap = db.prepare('SELECT * FROM appointments WHERE id=? AND dentist_id=?').get(+appointment_id, d);
    if (!ap) throw httpErr(404, 'NOT_FOUND', 'You are not authorized to access this resource.');
    const date2 = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : ap.appointment_date;
    const st = /^\d{2}:\d{2}$/.test(start_time || '') ? start_time : ap.start_time;
    const en = /^\d{2}:\d{2}$/.test(end_time || '') ? end_time : addMin(st, 30);
    if (slotClash(d, date2, st, en, ap.id)) throw httpErr(409, 'SLOT_TAKEN', 'That time overlaps an appointment already booked.');
    db.prepare("UPDATE appointments SET appointment_date=?, start_time=?, end_time=?, updated_at=datetime('now') WHERE id=?")
      .run(date2, st, en, ap.id);
    return { updated: true, appointment_id: ap.id, date: date2, start_time: st };
  }
};

const addMin = (t, mins) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + mins;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

const WRITE = new Set(['createAppointment', 'updateToothRecord', 'createTreatmentPlan', 'updatePlanItem', 'markInvoicePaid', 'cancelAppointment', 'rescheduleAppointment']);

function runTool(u, name, args) {
  const fn = tools[name];
  if (!fn) throw httpErr(400, 'BAD_TOOL', `Unknown tool: ${name}`);
  return fn(u, args || {});
}

module.exports = { tools, runTool, WRITE, slotClash, assertPatientMine, addMin };
