// server/services/brain.js — deterministic intent ladder (no LLM, no API cost).
// ORDER IS CORRECTNESS: write-intents before read-intents (Era bug N1 pre-fixed),
// reschedule/cancel before book, patient chart before generic health Q&A.
'use strict';
const { db, localDay, friendlyDate, fmt12 } = require('../db/connection');
const { answerFor } = require('./knowledge');
const { runTool } = require('./tools');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RE = {
  reschedule: /\b(reschedule|move|postpone|shift)\b.*\b(appointment|appt|visit)?\s*#?(\d+)?/i,
  cancel: /\b(cancel|cancle)\b/i,
  invoicePaid: /\b(mark|set)?\s*invoice\s*#?(\d+)\s*(as\s*)?(paid|paied)\b/i,
  createPlan: /\b(create|make|new)\b.*\bplan\b/i,
  updateTooth: /\b(mark|record|update)\b.*\b(tooth|teeth|daant)\b.*#?(\d{2})\b/i,
  book: /\b(book|schedule|fix)\b.*\b(appointment|appt|visit|slot)\b/i,
  nextAppt: /\bnext\b.*\b(appointment|appt|visit|patient)\b/i,
  chart: /\b(chart|teeth|tooth)\b.*\bof\b|\bchart for\b|\bshow.*\bchart\b/i,
  today: /\b(today|aaj)\b/i, tomorrow: /\b(tomorrow|kal)\b/i,
  appointments: /\b(appointments?|appts?|schedule|visits?)\b/i,
  slots: /\b(free|available|open)\b.*\b(slots?|times?)\b/i,
  patients: /\b(patients?|register|records?)\b/i,
  plans: /\b(plans?|treatment plans?)\b/i,
  invoices: /\b(invoices?|bills?|payments?|unpaid|paid)\b/i,
  treatments: /\b(treatments?|procedures?|price|charges|cost of)\b/i,
  greeting: /^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/i,
  help: /\bhelp\b|\bwhat can you do\b/i
};

// "4pm", "4 pm", "16:00", "at 4" → {start_time:"16:00"}
function pickTime(text) {
  const m = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i.exec(text);
  if (!m) return null;
  let h = +m[1]; const min = m[2] || '00'; const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}
function pickDate(text) {
  if (RE.tomorrow.test(text)) return localDay(1);
  if (RE.today.test(text)) return localDay(0);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso) return iso[1];
  return null; // callers default sensibly
}
function patientNameFrom(text) {
  const m = /\bfor\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/.exec(text);
  return m ? m[1] : null;
}

function routeIntent(message, u) {
  const text = String(message || '').slice(0, 500);
  const T = (name, args) => ({ tool: name, args });

  // ---------- WRITE intents first ----------
  if (RE.reschedule.test(text)) {
    const id = /\b(?:appointment|appt)?\s*#?(\d+)\b/.exec(text.replace(RE.reschedule, ''));
    const t = pickTime(text);
    if (t) return T('rescheduleAppointment', { appointment_id: id ? +id[1] : id, date: pickDate(text), start_time: t });
  }
  if (RE.cancel.test(text)) {
    const id = /\b(?:appointment|appt)?\s*#?(\d+)\b/.exec(text.replace(RE.cancel, ''));
    if (id) return T('cancelAppointment', { appointment_id: +id[1] });
  }
  const inv = RE.invoicePaid.exec(text);
  if (inv) return T('markInvoicePaid', { invoice_id: +inv[2] });
  if (RE.createPlan.test(text)) {
    const pid = /\bpatient\s*#?(\d+)\b/i.exec(text);
    const items = [];
    for (const tn of ['Scaling', 'RCT', 'Crown', 'Extraction', 'Whitening', 'Filling']) {
      if (new RegExp(tn, 'i').test(text)) items.push({ treatment_name: tn, tooth_fdi: (new RegExp(tn + String.raw`\s+(?:on\s+)?#?(\d{2})`, 'i').exec(text) || [])[1] });
    }
    if (items.length) return T('createTreatmentPlan', { patient_id: pid ? +pid[1] : null, title: 'Treatment plan', items });
  }
  const tooth = RE.updateTooth.exec(text);
  if (tooth) {
    const status = /\b(decayed|cavity|filled|root canal|missing|crowned|implant|healthy)\b/i.exec(text);
    return T('updateToothRecord', { patient_id: (/\bpatient\s*#?(\d+)\b/i.exec(text) || [])[1], tooth_fdi: tooth[3], tooth_status: (status ? status[1] : 'decayed').replace(' ', '_').replace('cavity', 'decayed') });
  }
  if (RE.book.test(text)) {
    const t = pickTime(text);
    const date = pickDate(text) || localDay(1);
    if (t) return T('createAppointment', { date, start_time: t, patient_name: patientNameFrom(text) });
  }

  // ---------- READ intents ----------
  if (RE.nextAppt.test(text)) {
    const rows = runTool(u, 'getMyAppointments', { upcoming: true });
    const next = rows.find(r => r.status === 'scheduled');
    return { text: next ? `Your next appointment is ${friendlyDate(next.appointment_date)} at ${fmt12(next.start_time)}${next.patient_name ? ' — ' + next.patient_name : ''}.` : 'You have no upcoming appointments.' };
  }
  const chartM = RE.chart.exec(text);
  if (chartM) {
    const name = patientNameFrom(text) || (/\bof\s+([A-Z][a-z]+)/.exec(text) || [])[1];
    const p = name ? db.prepare(`SELECT p.id,p.name FROM patients p JOIN dentist_patients dp ON dp.patient_id=p.id
      WHERE dp.dentist_id=? AND p.name LIKE ?`).get(u.dentistId, `%${name}%`) : null;
    if (p) {
      const { records } = runTool(u, 'getPatientChart', { patient_id: p.id });
      if (!records.length) return { text: `${p.name} has no tooth records yet.` };
      const summary = records.map(r => `${r.tooth_fdi} ${r.tooth_status.replace('_', ' ')}`).join(', ');
      return { text: `${p.name}'s chart has ${records.length} record(s): ${summary}.` };
    }
    return { text: name ? `I could not find a patient named ${name} in your register.` : 'Which patient\'s chart should I open? Say, for example: show the chart of Ravi.' };
  }
  if (RE.slots.test(text)) {
    const date = pickDate(text) || localDay(1);
    const slots = runTool(u, 'getAvailableSlots', { date });
    return { text: slots.length ? `Available slots on ${friendlyDate(date)}: ` + slots.slice(0, 8).map(s => fmt12(s.time)).join(', ') + '.' : `No open slots on ${friendlyDate(date)} — your day is full or you have no hours that day.` };
  }
  if (RE.patients.test(text)) {
    const rows = runTool(u, 'getMyPatients', {});
    return { text: rows.length ? `You have ${rows.length} patient(s): ` + rows.slice(0, 6).map(p => p.name).join(', ') + (rows.length > 6 ? '…' : '') + '.' : 'No patients are linked to your account yet.' };
  }
  if (RE.plans.test(text)) {
    const rows = runTool(u, 'getMyPlans', {});
    return { text: rows.length ? `You have ${rows.length} treatment plan(s): ` + rows.slice(0, 5).map(p => `#${p.id} ${p.title} (${p.status})`).join(', ') + '.' : 'No treatment plans yet.' };
  }
  if (RE.invoices.test(text)) {
    const unpaid = /\bunpaid\b/i.test(text);
    const rows = runTool(u, 'getMyInvoices', unpaid ? { status: 'unpaid' } : {});
    if (!rows.length) return { text: unpaid ? 'No unpaid invoices — all clear.' : 'No invoices on file.' };
    return { text: `${rows.length} invoice(s): ` + rows.slice(0, 6).map(i => `#${i.id} ₹${i.amount - i.discount - i.paid_amount} due (${i.status})`).join(', ') + '.' };
  }
  if (RE.appointments.test(text)) {
    const date = pickDate(text) || localDay(0);
    const rows = runTool(u, 'getMyAppointments', { date });
    if (!rows.length) return { text: `You have no appointments ${friendlyDate(date)}.` };
    return { text: `You have ${rows.length} appointment(s) ${friendlyDate(date)}:\n` +
      rows.map(a => `• ${fmt12(a.start_time)}–${fmt12(a.end_time)} — ${a.patient_name || 'Walk-in'}${a.reason ? ' (' + a.reason + ')' : ''}`).join('\n') };
  }
  if (RE.treatments.test(text)) {
    const rows = runTool(u, 'getTreatments', {});
    const one = rows.find(t => new RegExp('\\b' + t.name.split(' ')[0], 'i').test(text));
    if (one) return { text: `${one.name} costs ₹${one.default_cost} and takes about ${one.default_minutes} minutes.` };
    return { text: 'Our treatments: ' + rows.slice(0, 8).map(t => `${t.name} ₹${t.default_cost}`).join(', ') + '.' };
  }
  if (RE.greeting.test(text)) {
    const h = new Date().getHours();
    return { text: `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${u.name}! Ask me about appointments, patients, charts, plans or invoices.` };
  }
  if (RE.help.test(text)) {
    return { text: 'I can book, reschedule or cancel appointments, show patient charts, create treatment plans, check invoices and answer common dental questions — just ask in plain words.' };
  }

  // ---------- dental knowledge Q&A LAST (clinic data wins over generic advice) ----------
  const kb = answerFor(text);
  if (kb) return { text: kb.a };

  return { text: "I can help with appointments, patients, tooth charts, treatment plans, invoices and common dental questions. Try: 'my appointments tomorrow' or 'show Ravi's chart'." };
}

module.exports = { routeIntent, pickTime, pickDate };
