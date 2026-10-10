// server/db/connection.js — better-sqlite3 open + schema + demo seed (idempotent).
// Single owner of the DB handle; every service imports this one connection.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

// fallback chain like Era: DB_FILE env → server/db/dental.db → tmpdir (cloud disks may be read-only)
const candidates = [
  process.env.DB_FILE || null,
  path.join(__dirname, 'dental.db'),
  path.join(os.tmpdir(), 'dental.db')
].filter(Boolean);

let db = null, dbFile = null;
for (const cand of candidates) {
  try { fs.mkdirSync(path.dirname(cand), { recursive: true }); db = new Database(cand); dbFile = cand; break; }
  catch (e) { console.warn(`[dentera] DB ${cand} unavailable (${e.code || e.message})`); }
}
if (!db) throw new Error('No writable SQLite location found');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log(`[dentera] SQLite: ${dbFile}`);

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// ---------------- helpers (Era's local-date logic — never toISOString for day math) ----------------
const pad2 = n => String(n).padStart(2, '0');
const localDay = off => { const d = new Date(); d.setDate(d.getDate() + (off || 0));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const localTime = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const friendlyDate = s => { if (s === localDay(0)) return 'today'; if (s === localDay(1)) return 'tomorrow';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return s;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
const fmt12 = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return t || '';
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}`; };

// ---------------- demo seed (first boot only, idempotent) ----------------
function seed() {
  const bcrypt = require('bcryptjs');
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) { redate(); return; }
  const hash = bcrypt.hashSync('password123', 10);
  const insUser = db.prepare('INSERT INTO users(name,role,email,password_hash) VALUES (?,?,?,?)');
  const insDen = db.prepare('INSERT INTO dentists(user_id,specialty,room_no) VALUES (?,?,?)');
  const meera = insUser.run('Dr. Meera Iyer', 'dentist', 'meera@dental.local', hash).lastInsertRowid;
  const arjun = insUser.run('Dr. Arjun Shah', 'dentist', 'arjun@dental.local', hash).lastInsertRowid;
  insUser.run('Reception', 'reception', 'desk@dental.local', hash);
  const d1 = insDen.run(meera, 'General Dentistry', 'OPD-1').lastInsertRowid;
  const d2 = insDen.run(arjun, 'Orthodontics', 'OPD-2').lastInsertRowid;
  const insPat = db.prepare('INSERT INTO patients(name,dob,phone,gender,medical_notes) VALUES (?,?,?,?,?)');
  const ravi = insPat.run('Ravi Kumar', '1988-04-12', '+91-98100-11111', 'M', 'Allergic to penicillin').lastInsertRowid;
  const sara = insPat.run('Sara Khan', '1992-09-30', '+91-98100-22222', 'F', null).lastInsertRowid;
  const meena = insPat.run('Meena Iyer', '1975-01-20', '+91-98100-33333', 'F', 'Diabetic — watch healing').lastInsertRowid;
  const kavya = insPat.run('Kavya Reddy', '1983-11-15', '+91-98100-44444', 'F', null).lastInsertRowid;
  const insDp = db.prepare('INSERT INTO dentist_patients(dentist_id,patient_id) VALUES (?,?)');
  insDp.run(d1, ravi); insDp.run(d1, sara); insDp.run(d2, meena); insDp.run(d2, kavya);
  const insSch = db.prepare('INSERT INTO dentist_schedules(dentist_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)');
  for (const dow of [1, 2, 3, 4, 5]) insSch.run(d1, dow, '09:00', '17:00');   // Meera Mon–Fri 9–5
  for (const dow of [2, 3, 4, 5, 6]) insSch.run(d2, dow, '10:00', '18:00');  // Arjun Tue–Sat 10–6
  // treatments catalogue (12)
  const insTr = db.prepare('INSERT INTO treatments(name,default_cost,default_minutes,category) VALUES (?,?,?,?)');
  const tr = {};
  for (const [name, cost, min, cat] of [
    ['Consultation', 300, 15, 'preventive'], ['Scaling', 800, 30, 'periodontic'],
    ['Composite Filling', 1200, 30, 'restorative'], ['RCT (per visit)', 2500, 45, 'endodontic'],
    ['Crown (Metal-Ceramic)', 4500, 45, 'restorative'], ['Extraction (Simple)', 900, 20, 'surgical'],
    ['Surgical Extraction', 2200, 45, 'surgical'], ['Braces Consultation', 500, 20, 'orthodontic'],
    ['Teeth Whitening', 5000, 60, 'cosmetic'], ['Implant (fixture)', 25000, 60, 'surgical'],
    ['Fluoride Varnish', 700, 15, 'preventive'], ['Paediatric Filling', 900, 30, 'restorative']])
    tr[name] = insTr.run(name, cost, min, cat).lastInsertRowid;
  const insAp = db.prepare(`INSERT INTO appointments(dentist_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason,source)
    VALUES (?,?,?,?,?,?,?,?,'doctor')`);
  const tmr = localDay(1);
  insAp.run(d1, ravi, 'Ravi Kumar', tmr, '10:00', '10:30', 'scheduled', 'APPOINTMENT A — tooth pain (Ravi)');
  insAp.run(d1, sara, 'Sara Khan', tmr, '11:00', '11:30', 'scheduled', 'APPOINTMENT B — scaling follow-up (Sara)');
  insAp.run(d2, meena, 'Meena Iyer', tmr, '12:00', '12:45', 'scheduled', 'APPOINTMENT C — braces review (Meena)');
  insAp.run(d2, kavya, 'Kavya Reddy', localDay(2), '13:00', '13:30', 'scheduled', 'APPOINTMENT D — whitening consult (Kavya)');
  // chart demo: Ravi's teeth
  const insTooth = db.prepare(`INSERT INTO tooth_records(patient_id,dentist_id,tooth_fdi,tooth_status,condition,treatment_id,visit_date,cost,notes)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insTooth.run(ravi, d1, '16', 'decayed', 'Deep occlusal caries', tr['Composite Filling'], localDay(-14), null, 'Advised RCT evaluation');
  insTooth.run(ravi, d1, '36', 'root_canal', 'RCT visit 1 done', tr['RCT (per visit)'], localDay(-7), 2500, 'Working length determined');
  insTooth.run(ravi, d1, '46', 'filled', 'Old amalgam, intact', null, null, null, null);
  // plan + items + invoice for Sara
  const insPlan = db.prepare('INSERT INTO treatment_plans(patient_id,dentist_id,title,status,total_estimate) VALUES (?,?,?,?,?)');
  const plan = insPlan.run(sara, d1, 'Full mouth rehab', 'active', 7800).lastInsertRowid;
  const insItem = db.prepare('INSERT INTO plan_items(plan_id,tooth_fdi,treatment_id,visit_no,cost,status) VALUES (?,?,?,?,?,?)');
  insItem.run(plan, null, tr['Scaling'], 1, 800, 'done');
  insItem.run(plan, '36', tr['RCT (per visit)'], 2, 2500, 'planned');
  insItem.run(plan, '36', tr['Crown (Metal-Ceramic)'], 3, 4500, 'planned');
  db.prepare('INSERT INTO invoices(patient_id,plan_id,amount,discount,paid_amount,status) VALUES (?,?,?,?,?,?)')
    .run(sara, plan, 7800, 500, 0, 'unpaid');
  // second invoice for the unpaid pill
  db.prepare('INSERT INTO invoices(patient_id,plan_id,amount,discount,paid_amount,status) VALUES (?,?,?,?,?,?)')
    .run(meena, null, 500, 0, 0, 'unpaid');
  // dental knowledge base (15 rows) — every answer carries the safety line
  const SAFE = ' This is general guidance — please visit your dentist for real care.';
  const insQA = db.prepare('INSERT INTO ai_doctor(id,q,keywords,a) VALUES (?,?,?,?)');
  [
    ['toothache', ['toothache','tooth ache','dard','pain in tooth','tooth pain'], 'For a toothache: rinse with warm salt water, take a paracetamol as per the label, and avoid very hot or cold food. A toothache that wakes you at night usually needs treatment, not just medicine.'],
    ['sensitivity', ['sensitivity','sensitive teeth','cold water pain'], 'Sensitivity to cold is often early enamel wear or a small cavity. Try a sensitivity toothpaste for 2 weeks and avoid acidic drinks.'],
    ['bleeding gums', ['bleeding gums','gum bleeding','khoon'], 'Bleeding gums usually mean gingivitis from plaque. Brush gently twice a day and floss — bleeding should reduce in 1–2 weeks.'],
    ['bad breath', ['bad breath','smell','halitosis'], 'Bad breath is most often tongue coating or dry mouth. Clean your tongue daily and stay hydrated.'],
    ['cavity', ['cavity','caries','khotha','hole in tooth'], 'A cavity will not heal on its own; a small one needs a filling before it reaches the nerve and becomes a root canal.'],
    ['wisdom tooth', ['wisdom','aakhri daant','third molar'], 'Wisdom teeth trouble most people between 17–25. If it repeatedly swells or is impacted, removal is the usual advice.'],
    ['rct', ['rct','root canal','root canal fear','rct myth'], 'A modern root canal is done under anaesthesia and is about as comfortable as a filling. It SAVES the tooth — extraction is the last resort.'],
    ['braces', ['braces','aligner','orthodontic'], 'With braces: avoid hard/sticky food, brush after every meal with an orthodontic brush, and never miss a monthly adjustment.'],
    ['brushing', ['brush','brushing','twice a day'], 'Brush twice daily for 2 minutes with a pea-sized fluoride toothpaste, holding the brush at 45° to the gum line. Change your brush every 3 months.'],
    ['flossing', ['floss','flossing','thread'], 'Floss once a day before brushing — it cleans the 40% of tooth surface a brush cannot reach.'],
    ['baby teeth', ['baby teeth','milk teeth','bacchon ke daant'], 'Milk teeth matter — they hold space for permanent teeth. First dental visit is advised by age 1.'],
    ['whitening', ['whitening','white','staining','yellow'], 'Professional whitening is the safest option; home remedies like lemon or baking soda erode enamel and make things worse.'],
    ['dry mouth', ['dry mouth','mouth dry','xerostomia'], 'Dry mouth raises cavity risk. Sip water often, chew sugar-free gum, and review medicines with your doctor.'],
    ['grinding', ['grinding','bruxism','daant peesna'], 'Night grinding wears teeth down. A custom night guard from your dentist protects them; stress management helps the cause.'],
    ['knocked out tooth', ['knocked out','tooth fell','tooth injury','emergency'], 'If a tooth is knocked out: hold it by the crown, rinse briefly (do not scrub), store it in milk and reach a dentist within 30 minutes — it can often be re-implanted.']
  ].forEach((r, i) => insQA.run(i + 1, r[0], JSON.stringify(r[1]), r[2] + SAFE));
  redate();
}

// additive: every boot ensures the clinic-admin demo persona exists (older DBs get it too)
function ensureAdmin() {
  if (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) return;
  db.prepare('INSERT INTO users(name,role,email,password_hash) VALUES (?,?,?,?)')
    .run('Clinic Admin', 'admin', 'admin@dental.local', require('bcryptjs').hashSync('password123', 10));
}

// demo freshness: seeded demo appointments drift onto today/tomorrow at every boot (Era's trick)
function redate() {
  const t0 = localDay(0), t1 = localDay(1);
  db.prepare("SELECT id FROM appointments WHERE reason LIKE 'APPOINTMENT %' ORDER BY id").all()
    .forEach((r, i) => db.prepare("UPDATE appointments SET appointment_date=?, updated_at=datetime('now') WHERE id=?")
      .run(i < 2 ? t1 : (i === 2 ? t1 : localDay(2)), r.id));
}

seed();
ensureAdmin();

module.exports = { db, dbFile, localDay, localTime, friendlyDate, fmt12, pad2 };
