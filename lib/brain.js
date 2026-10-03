// lib/brain.js — intent router, "the AI" of this zero-dep assistant (SPEC §CHAT 5-10).
// Swap this single function for an LLM with function-calling; tools + auth stay identical.
'use strict';
const {db,EraDB}=require('./database');
const {asInt}=require('./auth');
const {fmt12}=require('./tools');
function routeIntent(msg,u){const q=msg.toLowerCase();
 const dateOf=k=>{const n=new Date();if(k==='tomorrow')n.setDate(n.getDate()+1);return n.toISOString().slice(0,10)};
 const D=u.doctorId;
 // day-planning answers come from the SQLite `schedule` table (shared clinic schedule — safe for every role)
 const clinicDay=()=>{const r=db.prepare('SELECT time,type,title FROM schedule ORDER BY time').all(),
  a=r.filter(e=>e.type==='appointment'),mt=r.filter(e=>e.type==='meeting');
  return r.length?'Today\'s schedule (from the database):\n'+r.map(e=>`• ${fmt12(e.time)} — ${e.title} (${e.type})`).join('\n')
   +`\n\n${a.length} appointment(s) and ${mt.length} meeting(s).`:'The schedule is empty today.'};
 const nextClinic=()=>{const n=new Date(),t=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`,
  e=db.prepare('SELECT time,title FROM schedule WHERE time>=? ORDER BY time LIMIT 1').get(t);
  return e?`Next on the schedule is ${e.title} at ${fmt12(e.time)}.`:'Nothing else is scheduled today.'};
 if(!D&&/appointment|meeting|schedule|agenda|plan|calendar|\bnext\b|today/.test(q)) // admin/reception: no doctor-owned data — answer from the shared schedule
  return{tool:null,text:/\bnext\b|upcoming/.test(q)?nextClinic():clinicDay()};
 let m=q.match(/next appointment/);
 if(m){const r=db.prepare("SELECT appointment_date,start_time,end_time,reason,patient_id FROM appointments WHERE doctor_id=? AND status='scheduled' AND (appointment_date>date('now') OR (appointment_date=date('now') AND start_time>=time('now','localtime'))) ORDER BY appointment_date,start_time LIMIT 1").get(D);
  return{tool:'getMyAppointments',text:r?`Your next appointment is on ${r.appointment_date} at ${r.start_time}${r.reason?' — '+r.reason:''}.`:'You have no upcoming appointments.'}}
 if(/cancel/.test(q)){const id=asInt((q.match(/\b(\d{1,6})\b/)||[])[1]);
  if(id)return{tool:'cancelAppointment',args:{appointment_id:id},write:true,text:'Let me cancel that appointment for you.'}}
 if(/(book|schedule|create|add)\b.*\b(appointment|patient|slot)/.test(q))return{tool:'createAppointment',write:true,text:'Let me book that for you — tell me the patient and time.'};
 if(/meeting|meetings/.test(q)){const rows=db.prepare("SELECT time,title FROM schedule WHERE type='meeting' ORDER BY time").all();
  return{tool:null,text:rows.length?`You have ${rows.length} meeting${rows.length>1?'s':''} today:\n`+rows.map(e=>`• ${e.time} — ${e.title}`).join('\n'):'No meetings today. Your calendar is clear.'}}
 if(/appointments?/.test(q))return{tool:'getMyAppointments',args:{date:/tomorrow/.test(q)?dateOf('tomorrow'):/today/.test(q)?dateOf('today'):null},text:'Here are your appointments.'};
 if(/working hours|availability|available slots?|free/.test(q))return{tool:/slot|free|available/.test(q)?'getAvailableSlots':'getMySchedule',args:/tomorrow/.test(q)?{date:dateOf('tomorrow')}:{},text:'Here is your schedule.'};
 if(/schedule|agenda|plan|calendar|my day|today'?s/.test(q))return{tool:null,text:clinicDay()};
 if(/what is next|what'?s next|upcoming/.test(q))return{tool:null,text:nextClinic()};
 if(/patients?/.test(q))return{tool:'getMyPatients',text:'Here are your patients.'};
 if(/prescriptions?|medications?/.test(q))return{tool:'getMyPrescriptions',text:'Here are your prescriptions.'};
 if(/my profile|my details|about me/.test(q))return{tool:'getMyProfile',text:'Here is your profile.'};
 const health=EraDB.scoreRows(db.prepare('SELECT id,q,keywords,a FROM ai_doctor').all(),msg);
 if(health)return{tool:null,text:health.a};
 if(/^(hi|hello|hey)|good (morning|afternoon|evening)/.test(q))return{tool:null,text:`Hello${u.name?', '+u.name:''}! You can ask me about your appointments, patients, prescriptions or schedule — or health questions like "what should I do for a fever".`};
 return{tool:null,text:'I can help with appointments, patients, prescriptions, and your schedule — or health questions like "what should I do for a fever". What would you like to know?'}}
module.exports={routeIntent};
