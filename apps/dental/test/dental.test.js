// test/dental.test.js — supertest over the real Express app, isolated scratch DB.
// Run: npm test  (DB_FILE env points at a throwaway file; the real dental.db is never touched)
'use strict';
const path = require('path');
const scratch = path.join(__dirname, 'era.dental.test.db');
const fs = require('fs');
for (const f of [scratch, scratch + '-wal', scratch + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
process.env.DB_FILE = scratch;
process.env.JWT_SECRET = 'test-secret';
process.env.PORT = '0'; // never bind a real port for the app-level listener

const { test, before, after } = require('node:test');
const assert = require('assert');
const request = require('supertest');
const { app } = require('../server/index.js');
const { db, localDay } = require('../server/db/connection.js');
const { validTooth } = require('../server/services/fdi.js');
const { slotClash } = require('../server/services/tools.js');

let agent;              // supertest agent keeps cookies (login once, reuse)
const TOMORROW = localDay(1);

before(async () => {
  agent = request.agent(app);
  const r = await agent.post('/api/auth/demo-login').send({ who: 'dentistA' });
  assert.strictEqual(r.status, 200, 'demo login for dentistA must work');
});

after(() => { try { for (const f of [scratch, scratch + '-wal', scratch + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });

// ---------- FDI validator (DB4) ----------
test('FDI: adult and primary ranges valid, junk invalid', () => {
  for (const t of ['11', '18', '21', '24', '38', '48', '55', '65', '85']) assert.ok(validTooth(t), t + ' must be valid');
  for (const t of ['10', '19', '09', '49', '56', '50', '86', '88', '91', '5', 'abc', '', '116']) assert.ok(!validTooth(t), t + ' must be invalid');
});

// ---------- isolation (Rules §1.2): dentist B never sees A's data ----------
test('isolation: dentist B cannot read A\'s patient chart (404)', async () => {
  const b = request.agent(app);
  await b.post('/api/auth/demo-login').send({ who: 'dentistB' });
  const r = await b.get('/api/chart/1'); // Ravi belongs to dentist A
  assert.strictEqual(r.status, 404);
  assert.ok(!/Ravi/.test(r.text), 'must not leak patient data');
});

test('isolation: dentist B cannot write A\'s patient chart (404)', async () => {
  const b = request.agent(app);
  await b.post('/api/auth/demo-login').send({ who: 'dentistB' });
  const r = await b.post('/api/chart/1').send({ tooth_fdi: '17', tooth_status: 'decayed' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM tooth_records WHERE tooth_fdi=?').get('17').c, 0, 'no row written');
});

test('isolation: appointment CRUD is scoped — B cannot cancel A\'s appointment', async () => {
  const b = request.agent(app);
  await b.post('/api/auth/demo-login').send({ who: 'dentistB' });
  const r = await b.delete('/api/appointments/1'); // A's seeded appointment
  assert.strictEqual(r.status, 404);
  const row = db.prepare('SELECT status FROM appointments WHERE id=1').get();
  assert.ok(row && row.status !== 'cancelled', 'A\'s appointment must survive');
});

// ---------- auth (BE3) ----------
test('auth: no token → 401 on resources', async () => {
  const r = await request(app).get('/api/patients');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.error, 'AUTH_REQUIRED');
});
test('auth: wrong password → 401 without existence leak', async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'meera@dental.local', password: 'wrongwrong' });
  assert.strictEqual(r.status, 401);
  assert.ok(!/no such|not found|unknown user/i.test(r.body.message), r.body.message);
});
test('auth: unknown email auto-signs up (201)', async () => {
  const r = await request(app).post('/api/auth/login').send({ email: 'newdoc@dental.local', password: 'pass1234' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.user.role, 'dentist');
});

// ---------- FDI enforced at the API (BE5) ----------
test('chart: invalid FDI is a 400, valid record saves (201)', async () => {
  const bad = await agent.post('/api/chart/2').send({ tooth_fdi: '99', tooth_status: 'decayed' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'BAD_FDI');
  const bad2 = await agent.post('/api/chart/2').send({ tooth_fdi: '16', tooth_status: 'purple' });
  assert.strictEqual(bad2.status, 400);
  const ok = await agent.post('/api/chart/2').send({ tooth_fdi: '26', tooth_status: 'filled', treatment_id: 3, notes: 'test' });
  assert.strictEqual(ok.status, 201);
});

// ---------- slot clash = interval overlap (BE4) ----------
test('slotClash: overlap refused 409, touching end allowed', async () => {
  // next MONDAY: Meera works Mon–Fri, and demo seed only occupies tomorrow — keeps the date clean
  const dm = new Date(); dm.setDate(dm.getDate() + (((1 - dm.getDay()) % 7 + 7) % 7 || 7));
  const MON = `${dm.getFullYear()}-${String(dm.getMonth() + 1).padStart(2, '0')}-${String(dm.getDate()).padStart(2, '0')}`;
  const mk = await agent.post('/api/appointments').send({ date: MON, start_time: '09:00', end_time: '10:30', patient_name: 'Long' });
  assert.strictEqual(mk.status, 201, mk.body.message || '');
  const overlap = await agent.post('/api/appointments').send({ date: MON, start_time: '09:30', patient_name: 'X' });
  assert.strictEqual(overlap.status, 409);
  const touch = await agent.post('/api/appointments').send({ date: MON, start_time: '10:30', patient_name: 'Y' });
  assert.strictEqual(touch.status, 201);
  db.prepare('DELETE FROM appointments WHERE id=?').run(mk.body.data.appointment_id);
  db.prepare('DELETE FROM appointments WHERE id=?').run(touch.body.data.appointment_id);
});

// ---------- public booking (BE7) ----------
const nextWorkDay = () => { // dentist 1 (Meera) works Mon–Fri; skip to the next weekday
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
test('public booking: valid 201 + source=public; bad phone 400; past date 400; clash 409', async () => {
  const WORKDAY = nextWorkDay();
  const free = (await request(app).get(`/api/public/slots?dentist=1&date=${WORKDAY}`)).body.data;
  assert.ok(free.length > 0, `must have free slots on a working day (${WORKDAY}) — got none`);
  const slot = free[free.length - 1].time; // latest free slot — least likely to be taken mid-test
  const ok = await request(app).post('/api/public/booking').send({ dentist_id: 1, date: WORKDAY, time: slot, name: 'Kabir', phone: '9810022223', reason: 'pain' });
  assert.strictEqual(ok.status, 201, ok.body.message || '');
  const row = db.prepare('SELECT source,patient_name FROM appointments WHERE id=?').get(ok.body.data.id);
  assert.strictEqual(row.source, 'public'); assert.strictEqual(row.patient_name, 'Kabir');
  db.prepare('DELETE FROM appointments WHERE id=?').run(ok.body.data.id);

  const badPhone = await request(app).post('/api/public/booking').send({ dentist_id: 1, date: WORKDAY, time: '12:00', name: 'A', phone: 'abc' });
  assert.strictEqual(badPhone.status, 400);
  const past = await request(app).post('/api/public/booking').send({ dentist_id: 1, date: '2020-01-01', time: '12:00', name: 'A', phone: '9810022223' });
  assert.strictEqual(past.status, 400);
  // book a real slot via doctor, then try public into the same interval
  const seed = db.prepare(`INSERT INTO appointments(dentist_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason,source)
    VALUES (1,NULL,'Busy',?,'12:00','12:30','scheduled','x','doctor')`).run(WORKDAY).lastInsertRowid;
  const clash = await request(app).post('/api/public/booking').send({ dentist_id: 1, date: WORKDAY, time: '12:00', name: 'C', phone: '9810022224' });
  assert.strictEqual(clash.status, 409);
  db.prepare('DELETE FROM appointments WHERE id=?').run(seed);
});

test('public booking: 6th attempt in 10 min → 429', async () => {
  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await request(app).post('/api/public/booking').send({ dentist_id: 1, date: TOMORROW, time: `0${i}:00`, name: 'T', phone: '9810022225' });
    last = r.status; // first requests fail validation (00:00 etc may be valid times) but STILL count
  }
  assert.strictEqual(last, 429, 'the limiter must trip after 5 attempts');
});

// ---------- plans + invoices (BE6) ----------
test('plan: one transaction creates plan+items+invoice; item done recompute; invoice paid', async () => {
  const mk = await agent.post('/api/plans').send({ patient_id: 2, title: 'Test plan', items: [
    { treatment_name: 'Scaling', cost: 800, visit_no: 1 }, { tooth_fdi: '36', cost: 2500, visit_no: 2 }] });
  assert.strictEqual(mk.status, 201);
  const planId = mk.body.data.plan_id;
  const det = await agent.get(`/api/plans/${planId}`);
  assert.strictEqual(det.body.data.items.length, 2);
  const inv = db.prepare('SELECT * FROM invoices WHERE plan_id=?').get(planId);
  assert.ok(inv && inv.amount === 3300 && inv.status === 'unpaid', 'auto-invoice must exist');

  const item = det.body.data.items[0];
  const done = await agent.patch(`/api/plans/${planId}/items/${item.id}`).send({ status: 'done' });
  assert.strictEqual(done.status, 200);

  const paid = await agent.patch(`/api/invoices/${inv.id}`).send({ paid_amount: 3300 });
  assert.strictEqual(paid.body.data.status, 'paid');
  const half = await agent.patch(`/api/invoices/${inv.id}`).send({ paid_amount: 1000 });
  assert.strictEqual(half.body.data.status, 'partial'); // can regress if edited
  // cleanup
  db.prepare('DELETE FROM invoices WHERE id=?').run(inv.id);
  db.prepare('DELETE FROM plan_items WHERE plan_id=?').run(planId);
  db.prepare('DELETE FROM treatment_plans WHERE id=?').run(planId);
});

// ---------- reception role (F8) ----------
test('reception: can list invoices but cannot write charts (403)', async () => {
  const r = request.agent(app);
  await r.post('/api/auth/demo-login').send({ who: 'reception' });
  const inv = await r.get('/api/invoices');
  assert.strictEqual(inv.status, 200);
  const chart = await r.get('/api/chart/1');
  assert.strictEqual(chart.status, 403);
});

// ---------- assistant brain (BE8) ----------
test('assistant: books by voice with date+time, denies reception, answers KB with safety line', async () => {
  const chat = await agent.post('/api/assistant/chat').send({ message: `book an appointment tomorrow at 5pm for Ravi` });
  assert.strictEqual(chat.status, 200);
  assert.strictEqual(chat.body.tool, 'createAppointment');
  assert.ok(chat.body.write);
  db.prepare('DELETE FROM appointments WHERE id=?').run(chat.body.tool_result.appointment_id);

  const rec = request.agent(app);
  await rec.post('/api/auth/demo-login').send({ who: 'reception' });
  const denied = await rec.post('/api/assistant/chat').send({ message: 'book an appointment tomorrow at 5pm for Ravi' });
  assert.strictEqual(denied.body.denied, true);
  assert.ok(/dental account/.test(denied.body.reply));

  const kb = await agent.post('/api/assistant/chat').send({ message: 'I have a toothache since night' });
  assert.ok(/visit your dentist/i.test(kb.body.reply), 'KB answers must carry the safety line');
});

test('chat history: today conversation exists with user+era rows; cross-user read → 404', async () => {
  const list = await agent.get('/api/assistant/conversations');
  assert.strictEqual(list.status, 200);
  const today = list.body.data.find(c => c.day === localDay(0));
  assert.ok(today, 'today conversation must exist after chats');
  const one = await agent.get(`/api/assistant/conversations/${today.id}`);
  const roles = one.body.data.messages.map(m => m.role);
  assert.ok(roles.includes('user') && roles.includes('era'));
  const b = request.agent(app);
  await b.post('/api/auth/demo-login').send({ who: 'dentistB' });
  const cross = await b.get(`/api/assistant/conversations/${today.id}`);
  assert.strictEqual(cross.status, 404);
});

// ---------- health (F14) ----------
test('health: ok shape', async () => {
  const r = await request(app).get('/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.ok(r.body.version);
});
