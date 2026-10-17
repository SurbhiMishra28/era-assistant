// lib/database.js — SQLite open + schema + migrations + demo seed (SPEC §DATABASE, §24).
// The DB file is the single owner of all persistent state; every query elsewhere goes through db here.
'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('fs'),path=require('path'),os=require('os');
const {DB_FILE}=require('./env');
const {hashPw}=require('./auth');
const EraDB=require('../db/db.js');

// Cloud hosts (Render free tier) ship no persistent disk: the ERA_DB directory may not exist or be
// read-only. Try candidates in order — ERA_DB path → repo-local db/era.db → /tmp — so the app boots
// anywhere instead of crash-looping. Each candidate is logged so the deploy log shows which is used.
let dbFile=DB_FILE,db=null;
for(const cand of [DB_FILE,path.join(__dirname,'..','db','era.db'),path.join(os.tmpdir(),'era.db')]){
 try{fs.mkdirSync(path.dirname(cand),{recursive:true});db=new DatabaseSync(cand);dbFile=cand;break}
 catch(e){console.warn(`[era] DB ${cand} unavailable (${e.code||e.errno||e.message})`)}
}
if(!db)throw new Error('No writable SQLite location found');
console.log(`[era] SQLite: ${dbFile}`);
// SPEC §4: enforce SQLite foreign keys on every connection; invalid doctor_id refs must fail
db.exec('PRAGMA foreign_keys = ON;');

// ============ 1. DATABASE: RMS entities (SPEC §DATABASE) ============
db.exec(`CREATE TABLE IF NOT EXISTS ai_doctor(id INTEGER PRIMARY KEY,q TEXT NOT NULL,keywords TEXT NOT NULL,a TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS schedule(id INTEGER PRIMARY KEY AUTOINCREMENT,time TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN('meeting','appointment')),title TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN('doctor','admin','reception')),email TEXT UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS doctors(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL
 UNIQUE REFERENCES users(id),specialty TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,
 dob TEXT,phone TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS doctor_patients(id INTEGER PRIMARY KEY AUTOINCREMENT,
 doctor_id INTEGER NOT NULL REFERENCES doctors(id),patient_id INTEGER NOT NULL REFERENCES patients(id),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(doctor_id,patient_id));
CREATE TABLE IF NOT EXISTS doctor_schedules(id INTEGER PRIMARY KEY AUTOINCREMENT,
 doctor_id INTEGER NOT NULL REFERENCES doctors(id),day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
 start_time TEXT NOT NULL,end_time TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY AUTOINCREMENT,
 doctor_id INTEGER NOT NULL REFERENCES doctors(id),patient_id INTEGER REFERENCES patients(id),
 appointment_date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','completed','cancelled')),
 reason TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS prescriptions(id INTEGER PRIMARY KEY AUTOINCREMENT,
 doctor_id INTEGER NOT NULL REFERENCES doctors(id),patient_id INTEGER REFERENCES patients(id),
 medication TEXT,dosage TEXT,instructions TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS assistant_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,doctor_id INTEGER,action TEXT NOT NULL,tool_name TEXT,request_id TEXT,
 success INTEGER NOT NULL DEFAULT 1,detail TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),day TEXT NOT NULL,title TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conversation_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,
 conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN('user','era')),text TEXT NOT NULL,tool TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appt_doctor_date ON appointments(doctor_id,appointment_date);
CREATE INDEX IF NOT EXISTS idx_sched_doctor ON doctor_schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dp_doctor ON doctor_patients(doctor_id);
CREATE INDEX IF NOT EXISTS idx_dp_patient ON doctor_patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_doctor ON prescriptions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_rx_doctor_patient ON prescriptions(doctor_id,patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_user_day ON conversations(user_id,day);
CREATE INDEX IF NOT EXISTS idx_cmsg_conv ON conversation_messages(conversation_id);`);

// ---- migrations for databases created before v3.1 (SPEC §28: additive only, never destroy)
for(const ddl of ["ALTER TABLE users ADD COLUMN password_hash TEXT","ALTER TABLE appointments ADD COLUMN patient_name TEXT",
 "ALTER TABLE assistant_audit ADD COLUMN resource TEXT","ALTER TABLE assistant_audit ADD COLUMN resource_id INTEGER"])
 try{db.exec(ddl)}catch(e){if(!/already exists|duplicate column/i.test(String(e)))throw e}

// ---- seed: knowledge + schedule (as before) + two demo doctors for isolation tests
const insQA=db.prepare('INSERT INTO ai_doctor(id,q,keywords,a) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET q=excluded.q,keywords=excluded.keywords,a=excluded.a');
for(const r of EraDB.doctorQA)insQA.run(r.id,r.q,JSON.stringify(r.keywords),r.a);
if(!db.prepare('SELECT COUNT(*) c FROM schedule').get().c)
 for(const e of EraDB.seedSchedule)db.prepare('INSERT INTO schedule(time,type,title) VALUES (?,?,?)').run(e.time,e.type,e.title);
if(!db.prepare('SELECT COUNT(*) c FROM users').get().c){
 // SPEC §24 test accounts: Dr. Amit (doctor_id 1), Dr. Rahul (2), Dr. Priya (3) — passwords hashed, never stored plain
 const iu=db.prepare('INSERT INTO users(name,role,email,password_hash) VALUES (?,?,?,?)'),
  idoc=db.prepare('INSERT INTO doctors(user_id,specialty) VALUES (?,?)'),
  ipa=db.prepare('INSERT INTO patients(name,dob,phone) VALUES (?,?,?)'),
  idp=db.prepare('INSERT INTO doctor_patients(doctor_id,patient_id) VALUES (?,?)'),
  iap=db.prepare('INSERT INTO appointments(doctor_id,patient_id,appointment_date,start_time,end_time,status,reason) VALUES (?,?,?,?,?,?,?)'),
  isch=db.prepare('INSERT INTO doctor_schedules(doctor_id,day_of_week,start_time,end_time) VALUES (?,?,?,?)'),
  irx=db.prepare('INSERT INTO prescriptions(doctor_id,patient_id,medication,dosage,instructions) VALUES (?,?,?,?,?)');
 const tomorrow=EraDB.localDay(1);
 const pw=hashPw('password123');
 const a=iu.run('Dr. Amit','doctor','amit@rms.local',pw).lastInsertRowid,
  b=iu.run('Dr. Rahul','doctor','rahul@rms.local',pw).lastInsertRowid,
  c3=iu.run('Dr. Priya','doctor','priya@rms.local',pw).lastInsertRowid,
  ad=idoc.run(a,'General Medicine').lastInsertRowid, bd=idoc.run(b,'Cardiology').lastInsertRowid, cd=idoc.run(c3,'Dermatology').lastInsertRowid;
 iu.run('Admin','admin','admin@rms.local',pw); iu.run('Front Desk','reception','desk@rms.local',pw);
 const p1=ipa.run('Ravi Kumar','1988-04-12','+91-98100-11111').lastInsertRowid,
  p2=ipa.run('Sara Khan','1992-09-30','+91-98100-22222').lastInsertRowid,
  p3=ipa.run('Meena Iyer','1975-01-20','+91-98100-33333').lastInsertRowid,
  p4=ipa.run('Arjun Nair','1990-06-05','+91-98100-44444').lastInsertRowid,
  p5=ipa.run('Kavya Reddy','1983-11-15','+91-98100-55555').lastInsertRowid;
 idp.run(ad,p1);idp.run(ad,p2);idp.run(bd,p3);idp.run(bd,p4);idp.run(cd,p5);
 isch.run(ad,1,'09:00','17:00');isch.run(ad,2,'09:00','13:00');isch.run(bd,1,'10:00','16:00');isch.run(cd,3,'11:00','15:00');
 iap.run(ad,p1,tomorrow,'10:00','10:30','scheduled','APPOINTMENT A — Amit: BP follow-up (Ravi)');
 iap.run(ad,p2,tomorrow,'11:00','11:30','scheduled','APPOINTMENT B — Amit: fatigue consult (Sara)');
 iap.run(bd,p3,tomorrow,'12:00','12:45','scheduled','APPOINTMENT C — Rahul: cardiology consult (Meena)');
 iap.run(cd,p5,tomorrow,'13:00','13:30','scheduled','APPOINTMENT D — Priya: skin rash review (Kavya)');
 irx.run(ad,p1,'Amlodipine','5 mg once daily','Take in the morning; monitor BP weekly');
 irx.run(bd,p3,'Atorvastatin','10 mg at night','After dinner; avoid grapefruit juice');
}

// v4.1 demo freshness: the seeded demo appointments (reason 'APPOINTMENT …') drift stale on an old
// database — shift them onto today/tomorrow at every start so "my appointments tomorrow" never answers empty.
{const t0=EraDB.localDay(0),t1=EraDB.localDay(1);
 db.prepare("SELECT id FROM appointments WHERE reason LIKE 'APPOINTMENT %' ORDER BY id").all()
  .forEach((r,i)=>db.prepare("UPDATE appointments SET appointment_date=?,updated_at=datetime('now') WHERE id=?").run(i?t1:t0,r.id))}

module.exports={db,EraDB};
