-- DentEra schema — 15 tables, idempotent (CREATE IF NOT EXISTS), additive-only policy
-- clinic: 13 tables · chat history: 2 tables

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('dentist','admin','reception')),
  email TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dentists(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  specialty TEXT,
  room_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dob TEXT,
  phone TEXT,
  gender TEXT,
  medical_notes TEXT,          -- allergies / conditions (shown with a warning in the UI)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dentist_patients(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(dentist_id, patient_id)
);

CREATE TABLE IF NOT EXISTS dentist_schedules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  patient_id INTEGER REFERENCES patients(id),
  patient_name TEXT,           -- walk-in / public bookings may have no patient record yet
  appointment_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','completed','cancelled','no_show')),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'doctor' CHECK(source IN('doctor','public')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS treatments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  default_cost INTEGER NOT NULL,          -- integer rupees, no floats
  default_minutes INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN('preventive','restorative','endodontic','periodontic','orthodontic','surgical','cosmetic','other'))
);

CREATE TABLE IF NOT EXISTS tooth_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  tooth_fdi TEXT NOT NULL,                -- validated in services/fdi.js before insert
  tooth_status TEXT NOT NULL CHECK(tooth_status IN('healthy','decayed','filled','root_canal','crowned','missing','implant')),
  condition TEXT,
  treatment_id INTEGER REFERENCES treatments(id),
  visit_date TEXT,
  cost INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS treatment_plans(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  dentist_id INTEGER NOT NULL REFERENCES dentists(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('draft','active','completed','cancelled')),
  total_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES treatment_plans(id),
  tooth_fdi TEXT,
  treatment_id INTEGER REFERENCES treatments(id),
  visit_no INTEGER NOT NULL DEFAULT 1,
  cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN('planned','done','cancelled'))
);

CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  plan_id INTEGER REFERENCES treatment_plans(id),
  amount INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN('unpaid','partial','paid')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_doctor(
  id INTEGER PRIMARY KEY,
  q TEXT NOT NULL,
  keywords TEXT NOT NULL,      -- JSON array
  a TEXT NOT NULL              -- always ends with the safety line
);

CREATE TABLE IF NOT EXISTS assistant_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  dentist_id INTEGER,
  action TEXT NOT NULL,
  tool_name TEXT,
  request_id TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  resource TEXT,
  resource_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- chat history (same design as Era v4.5's panel)
CREATE TABLE IF NOT EXISTS conversations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversation_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN('user','era')),
  text TEXT NOT NULL,
  tool TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appt_dentist_date ON appointments(dentist_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_dp_dentist ON dentist_patients(dentist_id);
CREATE INDEX IF NOT EXISTS idx_dp_patient ON dentist_patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_tooth_patient ON tooth_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_plan_patient ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_pitem_plan ON plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_user_day ON conversations(user_id, day);
CREATE INDEX IF NOT EXISTS idx_cmsg_conv ON conversation_messages(conversation_id);
