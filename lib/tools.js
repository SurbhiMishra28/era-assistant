// lib/tools.js — AI TOOL LAYER: every tool re-validates ownership (SPEC §AI TOOLS).
// All queries are parameterized and scoped by the AUTHENTICATED doctorId. doctorId/patientId
// from request bodies or AI arguments NEVER scope a query — they are only validated against it.
'use strict';
const {db,EraDB}=require('./database');
const {httpErr,asInt,requireDoctor}=require('./auth');
const {localDay}=EraDB;
const scopeDoctor=(u,a={})=>{ // never trusts AI- or frontend-supplied doctor_id: admins may pass one, doctors always scope to their own
 if(u.role==='admin'){const d=asInt(a.doctor_id);if(d)return d}
 return requireDoctor(u)};
const addMin=(t,n)=>{let[h,m]=t.split(':').map(Number);m+=n;h+=Math.floor(m/60);m%=60;return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`};
const fmt12=t=>{let[h,m]=t.split(':').map(Number);return`${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`}; // TTS-friendly times
const today=()=>localDay(0);
// 'HH:MM' → minutes since midnight. Times are zero-padded 24h strings, so plain string
// comparison is already chronological — but minutes make the overlap maths readable.
const mins=t=>{const[h,m]=t.split(':').map(Number);return h*60+m};
// True when [st,et] overlaps any non-cancelled appointment that day. Interval overlap, NOT
// start-time equality: booking 09:00-10:30 must block 09:30, which a `start_time=?` test misses.
// `exceptId` lets a reschedule ignore the row it is moving.
const slotClash=(d,date,st,et,exceptId)=>!!db.prepare("SELECT 1 x FROM appointments WHERE doctor_id=? AND appointment_date=?"
 +" AND status!='cancelled' AND start_time<? AND end_time>?"+(exceptId?' AND id!=?':'')).get(...[d,date,et,st].concat(exceptId?[exceptId]:[]));
const friendlyDate=d=>{const t=today(),tm=new Date(Date.now()+864e5).toISOString().slice(0,10);
 if(d===t)return'today';if(d===tm)return'tomorrow';
 const dt=new Date(d+'T00:00:00');return dt.toLocaleDateString('en',{weekday:'long',day:'numeric',month:'short'})};
const tools={
 getMyAppointments:(u,a={})=>{const d=scopeDoctor(u,a),date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||'')?a.date:null;
  return db.prepare(`SELECT id,appointment_date,start_time,end_time,status,reason,patient_id
   FROM appointments WHERE doctor_id=?${date?' AND appointment_date=?':''}
   ORDER BY appointment_date,start_time LIMIT ?`).all(...(date?[d,date,50]:[d,50]))},
 getMySchedule:(u,a={})=>db.prepare('SELECT id,day_of_week,start_time,end_time FROM doctor_schedules WHERE doctor_id=? ORDER BY day_of_week,start_time').all(scopeDoctor(u,a)),
 getMyPatients:(u,a={})=>{const d=scopeDoctor(u,a),lim=Math.min(asInt(a.limit)||20,50),off=Math.max(asInt(a.offset)||0,0);
  return db.prepare(`SELECT p.id,p.name,p.dob,p.phone FROM patients p
   JOIN doctor_patients dp ON dp.patient_id=p.id WHERE dp.doctor_id=? ORDER BY p.name LIMIT ? OFFSET ?`).all(d,lim,off)},
 getAppointmentDetails:(u,a={})=>{const id=asInt(a.appointment_id||a.id),d=scopeDoctor(u,a);
  const r=db.prepare('SELECT id,doctor_id,patient_id,appointment_date,start_time,end_time,status,reason FROM appointments WHERE id=? AND doctor_id=?').get(id,d);
  if(!r)throw httpErr(404,'NOT_FOUND','I can only access information available to your RMS account.');
  r.patient=r.patient_id?db.prepare('SELECT id,name,dob,phone FROM patients WHERE id=?').get(r.patient_id):null;return r},
 getAvailableSlots:(u,a={})=>{const d=scopeDoctor(u,a),date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||'')?a.date:today();
  // keep the whole booked INTERVAL, not just its start time, so a long appointment hides the
  // slots inside it instead of offering them as free
  const taken=db.prepare("SELECT start_time,end_time FROM appointments WHERE doctor_id=? AND appointment_date=? AND status!='cancelled'").all(d,date)
   .map(r=>({s:mins(r.start_time),e:mins(r.end_time||addMin(r.start_time,30))}));
  const free=(st,et)=>!taken.some(b=>mins(st)<b.e&&et>b.s);
  const dow=new Date(date+'T00:00:00').getDay();
  return db.prepare('SELECT start_time,end_time FROM doctor_schedules WHERE doctor_id=? AND day_of_week=? ORDER BY start_time').all(d,dow)
   .flatMap(w=>{const out=[];let[h,m]=w.start_time.split(':').map(Number);const[eh,em]=w.end_time.split(':').map(Number);
    while(h*60+m<eh*60+em){const t=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
     if(free(t,mins(t)+30))out.push({date,time:t});m+=30;if(m>=60){m-=30;h+=1}}return out})},
 createAppointment:(u,a={})=>{const d=scopeDoctor(u,a),pid=asInt(a.patient_id),date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||a.appointment_date||'')?(a.date||a.appointment_date):null,
  st=/^\d{2}:\d{2}$/.test(a.start_time||a.appointment_time||'')?(a.start_time||a.appointment_time):null;
  if(!date||!st||(!pid&&!String(a.patient_name||'').trim()))throw httpErr(400,'BAD_REQUEST','I need a patient (id or name), date (YYYY-MM-DD) and time (HH:MM) to book that.');
  if(pid&&!db.prepare('SELECT 1 x FROM doctor_patients WHERE doctor_id=? AND patient_id=?').get(d,pid))
   throw httpErr(403,'NOT_YOUR_PATIENT','I can only access information available to your RMS account.');
  const end=/^\d{2}:\d{2}$/.test(a.end_time||'')?a.end_time:addMin(st,30);
  if(slotClash(d,date,st,end))throw httpErr(409,'SLOT_TAKEN','That time overlaps an appointment you already have at that time.');
  const id=db.prepare("INSERT INTO appointments(doctor_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason) VALUES (?,?,?,?,?,?,'scheduled',?)").run(d,pid,String(a.patient_name||'').slice(0,120)||null,date,st,end,String(a.reason||'Consultation').slice(0,200)).lastInsertRowid;
  return{created:true,appointment_id:id}},
 rescheduleAppointment:(u,a={})=>{const d=scopeDoctor(u,a),id=asInt(a.appointment_id||a.id),date=/^\d{4}-\d{2}-\d{2}$/.test(a.date||a.appointment_date||'')?(a.date||a.appointment_date):null,
  st=/^\d{2}:\d{2}$/.test(a.start_time||a.appointment_time||'')?(a.start_time||a.appointment_time):null;
  if(!id||!date||!st)throw httpErr(400,'BAD_REQUEST','I need a valid appointment, date and time to reschedule.');
  if(!db.prepare('SELECT 1 x FROM appointments WHERE id=? AND doctor_id=?').get(id,d))
   throw httpErr(404,'NOT_FOUND','I can only access information available to your RMS account.');
  if(slotClash(d,date,st,addMin(st,30),id))throw httpErr(409,'SLOT_TAKEN','That time overlaps another appointment already booked.');
  db.prepare("UPDATE appointments SET appointment_date=?,start_time=?,end_time=?,status='scheduled',updated_at=datetime('now') WHERE id=? AND doctor_id=?").run(date,st,addMin(st,30),id,d);
  return{updated:true,appointment_id:id}},
 cancelAppointment:(u,a={})=>{const d=scopeDoctor(u,a),id=asInt(a.appointment_id||a.id);
  if(!id)throw httpErr(400,'BAD_REQUEST','I need a valid appointment id to cancel.');
  const r=db.prepare("UPDATE appointments SET status='cancelled',updated_at=datetime('now') WHERE id=? AND doctor_id=? AND status!='cancelled'").run(id,d);
  if(!r.changes)throw httpErr(404,'NOT_FOUND','I can only access information available to your RMS account.');
  return{cancelled:true,appointment_id:id}},
 getMyProfile:u=>{const d=scopeDoctor(u,{});
  return db.prepare('SELECT d.id AS doctor_id,u.name,u.email,d.specialty FROM doctors d JOIN users u ON u.id=d.user_id WHERE d.id=?').get(d)},
 getMyPrescriptions:(u,a={})=>{const d=scopeDoctor(u,a);
  return db.prepare('SELECT id,patient_id,medication,dosage,instructions FROM prescriptions WHERE doctor_id=? ORDER BY id DESC LIMIT 50').all(d)},
 // ---- shared clinic schedule (U3: "add a meeting called Review at 3 pm").
 // The `schedule` table has NO doctor_id — it is a clinic-wide notice board, not doctor-owned data,
 // so it is readable AND writable by any signed-in user (including reception). No patient data here.
 createMeeting:(u,a={})=>{const time=/^\d{2}:\d{2}$/.test(a.time||'')?a.time:null,
   type=a.type==='appointment'?'appointment':'meeting',
   title=String(a.title||'').replace(/\s+/g,' ').trim().slice(0,80);
  if(!time)throw httpErr(400,'BAD_REQUEST','I need a time for that, like "at 3 pm".');
  if(!title)throw httpErr(400,'BAD_REQUEST','I need a name for it, like "a meeting called Review".');
  if(db.prepare("SELECT 1 x FROM schedule WHERE time=? AND type=? AND title=?").get(time,type,title))
   throw httpErr(409,'DUPLICATE','That is already on the clinic schedule.');
  const id=db.prepare('INSERT INTO schedule(time,type,title) VALUES (?,?,?)').run(time,type,title).lastInsertRowid;
  return{created:true,schedule_id:id,time,title,type}},
 deleteMeeting:(u,a={})=>{const id=asInt(a.schedule_id||a.id);
  if(!id)throw httpErr(400,'BAD_REQUEST','I need a schedule entry id to remove.');
  const r=db.prepare('DELETE FROM schedule WHERE id=?').run(id);
  if(!r.changes)throw httpErr(404,'NOT_FOUND','That entry is not on the clinic schedule.');
  return{removed:true,schedule_id:id}}
};
function runTool(u,tool,args){const fn=tools[tool];if(!fn)throw httpErr(400,'BAD_TOOL','That action is not available.');
 return fn(u,args||{})}
module.exports={tools,runTool,scopeDoctor,addMin,fmt12,today,friendlyDate,mins,slotClash};
