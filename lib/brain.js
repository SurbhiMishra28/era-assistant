// lib/brain.js — intent router, "the AI" of this zero-dep assistant (SPEC §CHAT 5-10).
// Swap this single function for an LLM with function-calling; tools + auth stay identical.
'use strict';
const {db,EraDB}=require('./database');
const {asInt}=require('./auth');
const {fmt12}=require('./tools');
const {localDay}=EraDB;
function routeIntent(msg,u){const q=msg.toLowerCase();
 const dateOf=k=>localDay(k==='tomorrow'?1:0);
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
 if(m){const t=EraDB.localTime(),d0=localDay(0),d1=localDay(1);
  const r=db.prepare("SELECT appointment_date,start_time,end_time,reason,patient_id FROM appointments WHERE doctor_id=? AND status='scheduled' AND (appointment_date>? OR (appointment_date=? AND start_time>=?)) ORDER BY appointment_date,start_time LIMIT 1").get(D,d0,d0,t)
   ||db.prepare("SELECT appointment_date,start_time,end_time,reason,patient_id FROM appointments WHERE doctor_id=? AND status='scheduled' AND appointment_date=? ORDER BY start_time LIMIT 1").get(D,d1);
  return{tool:'getMyAppointments',text:r?`Your next appointment is on ${r.appointment_date} at ${r.start_time}${r.reason?' — '+r.reason:''}.`:'You have no upcoming appointments.'}}
 // ---- reschedule / move: must be tested BEFORE createAppointment and cancel, both of which also
 // match these sentences. "move appointment 3 to tomorrow at 3pm" is a reschedule, not a booking.
 const rs=q.match(/\b(reschedul|move|shift|postpon|change)\w*\b/);
 if(rs&&/\b(appointment|booking|slot|session|it)\b/.test(q)){
  const id=asInt((q.match(/\b(\d{1,6})\b/)||[])[1]);
  if(id){const a=pickDateTime(q);
   return{tool:'rescheduleAppointment',args:Object.assign({appointment_id:id},a),write:true,
    text:`Let me move appointment ${id}${a.date?' to '+a.date:''}${a.start_time?' at '+a.start_time:''}.`}}}
 if(/cancel/.test(q)){const id=asInt((q.match(/\b(\d{1,6})\b/)||[])[1]);
  if(id)return{tool:'cancelAppointment',args:{appointment_id:id},write:true,text:'Let me cancel that appointment for you.'}}
 // "appointment 3 details" / "details of appointment 3" / "tell me about appointment 3"
 if(/\b(details?|about|info|information|status of)\b/.test(q)&&/\bappointment\b/.test(q)){
  const id=asInt((q.match(/\b(\d{1,6})\b/)||[])[1]);
  if(id)return{tool:'getAppointmentDetails',args:{appointment_id:id},text:'Here are the details for that appointment.'}}
 if(/(book|schedule|create|add)\b.*\b(appointment|patient|slot)/.test(q)){
  const a=pickDateTime(q);
  return{tool:'createAppointment',args:a,write:true,
   text:a.date&&a.start_time?`Let me book that for you${a.patient_name?' for '+a.patient_name:''} on ${a.date} at ${a.start_time}.`
    :'Let me book that for you — tell me the patient and the time.'}}
 // ---- add a meeting to the shared clinic schedule (U3). Must sit BEFORE the meetings-read branch,
 // otherwise "add a meeting called Review at 3 pm" would just list today's meetings.
 if(/(add|create|schedule|book|put)\b[^?]*\b(meeting|call|event)\b/.test(q)&&!/\b(cancel|remove|delete|what|show|list|my)\b/.test(q)){
  const a=pickDateTime(q);
  const named=q.match(/\b(?:called|named|titled)\s+["']?([^"']{2,60}?)["']?(?:\s+(?:at|on|today|tomorrow|for|with|\d)|\s*$)/);
  const bare=q.match(/\b(?:meeting|call|event)\s+(?!called|named|titled)([^"']{2,60}?)(?:\s+(?:at|on|today|tomorrow|\d)|\s*$)/);
  let title=(named&&named[1])||(bare&&bare[1])||'Meeting';
  title=title.replace(/\b(a|an|the|meeting|call|event|for|with|at|on|today|tomorrow|please|and|to|next|week|morning|afternoon|evening|add|create|schedule|book|put)\b/gi,' ').replace(/\s+/g,' ').trim();
  if(!title)title='Meeting';
  return{tool:'createMeeting',args:{time:a.start_time||null,title,type:'meeting'},write:true,
   text:`Let me add ${title} to the clinic schedule${a.start_time?' at '+a.start_time:''}.`}}
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
// ---- pull a date / time / patient name out of a spoken sentence, so a booking or reschedule
// sentence can actually be executed instead of asking the doctor to repeat themselves.
const MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
 jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const ORD={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,eleventh:11,twelfth:12};
function pickDateTime(q){const a={};
 // explicit ISO date wins over everything else
 const iso=q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
 if(iso)a.date=iso[1];
 else if(/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(q))a.date=localDay(0);
 else if(/\btomorrow\b|\btmr\b/.test(q))a.date=localDay(1);
 else if(/\bday after tomorrow\b/.test(q))a.date=localDay(2);
 else{
  // "on the 12th" / "on 12 march" / "march 12" — a day number with no month means the next such day
  const mn=q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/);
  const md=q.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const mon=q.match(/\b([a-z]{3,9})\b/);
  const name=(mn&&mn[2])||(md&&md[1])||(mon&&mon[1]);
  const mnum=name?MONTHS[name]:null;
  const day=mn?+mn[1]:(md?+md[2]:null);
  if(mnum){
   if(day){const y=new Date().getFullYear(),d=new Date(y,mnum-1,day);
    // a date already past this year means next year (e.g. "12 january" in December)
    if(d.getTime()<Date.now()-864e5)d.setFullYear(y+1);
    a.date=d.getFullYear()+'-'+EraDB.pad2(d.getMonth()+1)+'-'+EraDB.pad2(d.getDate());}
   else{const n=new Date();a.date=EraDB.localDay((new Date(n.getFullYear(),mnum,1)-n)/(864e5));}
  }else if(day&&day>=1&&day<=31){const n=new Date();let d=new Date(n.getFullYear(),n.getMonth(),day);
   if(d.getTime()<n.getTime()-864e5)d.setMonth(d.getMonth()+1);
   a.date=d.getFullYear()+'-'+EraDB.pad2(d.getMonth()+1)+'-'+EraDB.pad2(d.getDate());}
 }
 // "the 5th of march" → ordinal day number
 const ord=q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/);
 if(ord&&!a.date&&MONTHS[ord[2]]){const y=new Date().getFullYear(),d=new Date(y,MONTHS[ord[2]]-1,+ord[1]);
  a.date=d.getFullYear()+'-'+EraDB.pad2(d.getMonth()+1)+'-'+EraDB.pad2(d.getDate());}
 // A meridiem word anywhere means this is a 12-hour clock — otherwise "3:30 pm" would be read as
 // 03:30 by the 24-hour branch. So check for am/pm FIRST, then choose the branch.
 // The number and its meridiem are matched TOGETHER, so "3pm" (no space, no colon) is not missed.
 const m12=q.match(/\b(1[0-2]|0?[1-9])(?:\s*:?\s*([0-5]\d))?\s*([ap])\.?\s*m\.?\b/);
 const merA=q.match(/\b([ap])\.?\s*m\.?\b/);          // a bare "pm" elsewhere in the sentence
 const mer=(m12&&m12[3])||(merA&&merA[1])||null;
 // 24h form "15:30" / "at 16:45" — only when no meridiem appears anywhere, else "3:30 pm" → 03:30
 const t24=mer?null:q.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
 const oc=q.match(/\b(1[0-2]|0?[1-9])\s*o\s*'?clock/);
 const half=q.match(/\bhalf\s+(?:past|after)\s+(1[0-2]|0?[1-9])\b/);
 const quarter=q.match(/\bquarter\s+(?:past|after)\s+(1[0-2]|0?[1-9])\b/);
 if(t24)a.start_time=EraDB.pad2(+t24[1])+':'+t24[2];
 else{
  let h=null,mm='00';
  if(half){h=+half[1];mm='30';if(mer==='p'&&h<12)h+=12;}
  else if(quarter){h=+quarter[1];mm='15';if(mer==='p'&&h<12)h+=12;}
  else if(m12){h=+m12[1];if(m12[2])mm=m12[2];if(mer==='p'&&h<12)h+=12;if(mer==='a'&&h===12)h=0;}
  else if(oc){h=+oc[1];if(mer==='p'&&h<12)h+=12;}
  // "tomorrow morning" with no clock time: a plain default, never a guess at 12-hour ambiguity
  else if(!mer){const w={morning:'09:00',afternoon:'14:00',evening:'18:00',night:'20:00'};
   for(const k of Object.keys(w))if(new RegExp('\\b'+k+'\\b').test(q)){a.start_time=w[k];break}}
  if(h!==null)a.start_time=EraDB.pad2(h)+':'+mm;
 }
 // patient name: "for Ravi", "with Sara Khan", "for patient Meena Iyer"
 const pn=q.match(/\b(?:for|with)\s+(?:patient\s+)?([A-Za-z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*)/);
 if(pn){let n=pn[1].replace(/\b(an?|the|appointment|slot|at|on|today|tomorrow|please|and|to|for|next|week|morning|afternoon|evening|book|schedule|create|add|reschedule|move|cancel)\b/gi,'').trim();
  if(n.length>=2)a.patient_name=n;}
 return a}

module.exports={routeIntent,pickDateTime};
