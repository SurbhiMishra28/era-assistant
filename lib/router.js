// lib/router.js — HTTP layer: routing, CORS, audit, static files, chat endpoint, reply wording.
// Composition layer: it imports every concern (auth/db/tools/brain/tts) and owns NOTHING but HTTP.
'use strict';
const fs=require('fs'),path=require('path'),url=require('url'),crypto=require('crypto');
const {JWT_SECRET,NVCF_BASE,NVCF_DEFAULT_VOICE,SOFIA_VOICES,DEMO_LOGIN,ROOT}=require('./env');
const {hashPw,verifyPw,mintToken,verifyJWT,requireAuth,requireDoctor,httpErr,asInt}=require('./auth');
const {db,EraDB}=require('./database');
const {tools,runTool,addMin,fmt12,friendlyDate}=require('./tools');
const {routeIntent}=require('./brain');
const {nvidiaKey,synthesize}=require('./tts');

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const STATIC={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/db/db.js':'db/db.js','/assets/era.png':'assets/era.png','/assets/era3d.png':'assets/era3d.png'};
const CORS={'Access-Control-Allow-Origin':'http://localhost:5500','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const rid=()=>crypto.randomBytes(6).toString('hex');
function json(res,code,obj,extra){res.writeHead(code,{...CORS,...(extra||{})});res.end(JSON.stringify(obj))}
function audit(userId,doctorId,action,tool,reqId,ok,detail,resource,resourceId){try{
 db.prepare('INSERT INTO assistant_audit(user_id,doctor_id,action,tool_name,request_id,success,detail,resource,resource_id) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(userId??null,doctorId??null,String(action).slice(0,80),tool||null,reqId,ok?1:0,detail?String(detail).slice(0,300):null,resource||null,resourceId??null)}catch{}}
function readBody(req,cb){let b='';req.on('data',c=>{b+=c;if(b.length>1e5){req.destroy();return}});req.on('end',()=>{try{cb(b?JSON.parse(b):{})}catch{cb({})}})}
function restErr(res,e,reqId,u){const code=e.code&&typeof e.code==='number'?e.code:500;
 if(code>=500)console.error(reqId,e);
 return json(res,code,{ok:false,error:e.err||'SERVER_ERROR',request_id:reqId,
  message:code>=500?'Something went wrong.':(e.code&&typeof e.code==='number'?e.message:'You are not authorized to access this resource.')})}
function dynErr(code,err,msg){throw httpErr(code,err,msg)}

const handler=(req,res)=>{ // shared by the HTTP listener and the optional HTTPS mirror (v4.1)
 const {pathname:p,search}=url.parse(req.url,true),reqId=rid();
 if(req.method==='OPTIONS')return json(res,204,{});
 try{
  if(req.method==='GET'&&p==='/api/health'){const n=db.prepare('SELECT COUNT(*) c FROM ai_doctor').get().c;return json(res,200,{ok:true,db:'sqlite',file:'db/era.db',ai_doctor:n,schedule:db.prepare('SELECT COUNT(*) c FROM schedule').get().c,version:'3.0.0'})}
  if(req.method==='GET'&&p==='/api/qa'){const m=EraDB.scoreRows(db.prepare('SELECT id,q,keywords,a FROM ai_doctor').all(),new URLSearchParams(search).get('q')||'');
   return json(res,200,m?{found:true,id:m.id,question:m.q,answer:m.a,score:m.score,source:'sqlite'}:{found:false,source:'sqlite'})}
  // ---- TTS proxy (v3.8): browser asks our server, our server asks NVIDIA — key never reaches the client
  if(req.method==='GET'&&p==='/api/tts/voices'){const u=requireAuth(req),k=nvidiaKey();
   audit(u.id,u.doctorId,'tts_voices',null,reqId,true);
   if(!k)return json(res,503,{ok:false,error:'TTS_NOT_CONFIGURED',message:'No NVIDIA API key configured (NVIDIA_API_KEY env or nvcf.key).'});
   (async()=>{try{const r=await fetch(NVCF_BASE+'/v1/audio/list_voices',{headers:{Authorization:'Bearer '+k},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error('upstream '+r.status);
    const j=await r.json(),all=(Object.values(j)[0]&&Object.values(j)[0].voices)||[];
    // v4.0: ONE voice only — Sofia (EN-US default + HI-IN); every other persona is filtered out
    const voices=all.filter(v=>SOFIA_VOICES.includes(v));
    return json(res,200,{ok:true,voices,default:NVCF_DEFAULT_VOICE})}catch(e){return json(res,502,{ok:false,error:'TTS_UPSTREAM',message:'Voice list unavailable.'})}})();
   return}
  if(req.method==='POST'&&p==='/api/tts'){const u=requireAuth(req);return readBody(req,async body=>{try{
   if(!nvidiaKey())return json(res,503,{ok:false,error:'TTS_NOT_CONFIGURED',message:'No NVIDIA API key configured (NVIDIA_API_KEY env or nvcf.key).'});
   const text=String((body||{}).text||'').slice(0,2000).trim();
   if(!text)return json(res,400,{ok:false,error:'BAD_REQUEST',message:'text is required.'});
   const voice=String((body||{}).voice||'').slice(0,120)||NVCF_DEFAULT_VOICE;
   // v4.1: Sofia-only is enforced HERE, not just in the voice list — any other persona is a 400
   if(!SOFIA_VOICES.includes(voice))return json(res,400,{ok:false,error:'BAD_VOICE',message:'Only Sofia voices are available (English / हिन्दी).'});
   // NVCF requires proper-case language tags (en-US, hi-IN); the voice name embeds EN-US/HI-IN (uppercase)
   const lm=voice.match(/\.([A-Za-z]{2})-([A-Za-z]{2})\./),lang=lm?lm[1].toLowerCase()+'-'+lm[2].toUpperCase():'en-US';
   const {wav,errs}=await synthesize({text,voice,lang}); // cache + retries live in lib/tts.js
   audit(u.id,u.doctorId,'tts',voice,reqId,!!wav);
   if(!wav){console.error(reqId,'tts_failed',errs.join(' | '),'| lang='+lang,'voice='+voice,'len='+text.length);return json(res,502,{ok:false,error:'TTS_FAILED',message:'Voice service unavailable. Please try again shortly.'})}
   res.writeHead(200,{...CORS,'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(wav)
  }catch(e){console.error(reqId,'tts_failed',e.name||'');return json(res,502,{ok:false,error:'TTS_FAILED',message:'Voice service unavailable. Please try again shortly.'})}})}
  // ---- RMS REST resources: doctor_id ALWAYS from req.user; ?doctor_id is ignored (SPEC §9/§15)
  if(req.method==='GET'&&p==='/api/appointments'){const u=requireAuth(req),d=requireDoctor(u);
   const {query:qp}=url.parse(req.url,true),date=/^\d{4}-\d{2}-\d{2}$/.test(qp.date||'')?qp.date:null,
    from=/^\d{4}-\d{2}-\d{2}$/.test(qp.from||'')?qp.from:null,to=/^\d{4}-\d{2}-\d{2}$/.test(qp.to||'')?qp.to:null,
    status=/^(scheduled|completed|cancelled)$/.test(qp.status||'')?qp.status:null,upcoming=qp.upcoming==='1'||qp.upcoming==='true';
   let sql="SELECT id,appointment_date,start_time,end_time,status,reason,patient_id FROM appointments WHERE doctor_id=?",params=[d];
   if(date){sql+=' AND appointment_date=?';params.push(date)}
   if(from){sql+=' AND appointment_date>=?';params.push(from)}
   if(to){sql+=' AND appointment_date<=?';params.push(to)}
   if(status){sql+=' AND status=?';params.push(status)}
   if(upcoming){sql+=" AND status!='cancelled' AND (appointment_date>date('now') OR (appointment_date=date('now') AND start_time>=time('now','localtime')))"}
   sql+=' ORDER BY appointment_date,start_time LIMIT 100';
   audit(u.id,d,'list','appointments',reqId,true,null,'appointments',null);
   return json(res,200,{ok:true,data:db.prepare(sql).all(...params)})}
  if(req.method==='POST'&&p==='/api/appointments'){const u=requireAuth(req),d=requireDoctor(u);return readBody(req,body=>{try{
   const b=body||{};const date=/^\d{4}-\d{2}-\d{2}$/.test(b.appointment_date||'')?b.appointment_date:null,
    st=/^\d{2}:\d{2}$/.test(b.appointment_time||b.start_time||'')?(b.appointment_time||b.start_time):null,
    pid=asInt(b.patient_id),pname=String(b.patient_name||'').slice(0,120);
   if(!date||!st)throw httpErr(400,'BAD_REQUEST','appointment_date (YYYY-MM-DD) and appointment_time (HH:MM) are required.');
   if(!pid&&!pname)throw httpErr(400,'BAD_REQUEST','A patient_id or patient_name is required.');
   if(pid&&!db.prepare('SELECT 1 x FROM doctor_patients WHERE doctor_id=? AND patient_id=?').get(d,pid))
    throw httpErr(403,'FORBIDDEN','You are not authorized to access this resource.');
   const clash=db.prepare("SELECT 1 x FROM appointments WHERE doctor_id=? AND appointment_date=? AND start_time=? AND status!='cancelled'").get(d,date,st);
   if(clash)throw httpErr(409,'SLOT_TAKEN','That time slot is already booked.');
   const id=db.prepare("INSERT INTO appointments(doctor_id,patient_id,patient_name,appointment_date,start_time,end_time,status,reason) VALUES (?,?,?,?,?,?,'scheduled',?)")
    .run(d,pid,pname||null,date,st,addMin(st,30),String(b.notes||b.reason||'Consultation').slice(0,200)).lastInsertRowid;
   audit(u.id,d,'create','appointments',reqId,true,null,'appointments',id);
   json(res,201,{ok:true,data:{id}})}catch(e){restErr(res,e,reqId,u)}})}
  // GET /api/appointments/:id — SPEC §7: ownership in the WHERE clause, never WHERE id alone
  if(req.method==='GET'&&/^\/api\/appointments\/\d+$/.test(p)){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   const r=db.prepare('SELECT id,appointment_date,start_time,end_time,status,reason,patient_id,patient_name FROM appointments WHERE id=? AND doctor_id=?').get(id,d);
   if(!r)return json(res,404,{ok:false,error:'NOT_FOUND',message:'You are not authorized to access this resource.'});
   audit(u.id,d,'get','appointments',reqId,true,null,'appointments',id);
   return json(res,200,{ok:true,data:r})}
  if(req.method==='PATCH'&&p.startsWith('/api/appointments/')){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   return readBody(req,body=>{try{
    if(!id)throw httpErr(400,'BAD_REQUEST','Invalid appointment id.');const b=body||{};
    const sets=[],params=[];if(b.appointment_time||b.start_time){if(!/^\d{2}:\d{2}$/.test(b.appointment_time||b.start_time))throw httpErr(400,'BAD_REQUEST','Invalid time.');sets.push('start_time=?');params.push(b.appointment_time||b.start_time)}
    if(b.appointment_date){if(!/^\d{4}-\d{2}-\d{2}$/.test(b.appointment_date))throw httpErr(400,'BAD_REQUEST','Invalid date.');sets.push('appointment_date=?');params.push(b.appointment_date)}
    if(b.status){if(!/^(scheduled|completed|cancelled)$/.test(b.status))throw dynErr(400,'BAD_REQUEST','Invalid status.');sets.push('status=?');params.push(b.status)}
    if(!sets.length)throw httpErr(400,'BAD_REQUEST','Nothing to update.');sets.push("updated_at=datetime('now')");
    const r=db.prepare(`UPDATE appointments SET ${sets.join(',')} WHERE id=? AND doctor_id=?`).run(...params,id,d);
    if(!r.changes)throw httpErr(404,'NOT_FOUND','You are not authorized to access this resource.');
    audit(u.id,d,'update','appointments',reqId,true,null,'appointments',id);
    json(res,200,{ok:true})}catch(e){restErr(res,e,reqId,u)}})}
  if(req.method==='DELETE'&&p.startsWith('/api/appointments/')){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   if(!id)return json(res,400,{ok:false,error:'BAD_REQUEST'});
   const r=db.prepare('DELETE FROM appointments WHERE id=? AND doctor_id=?').run(id,d);
   audit(u.id,d,'delete','appointments',reqId,!!r.changes,null,'appointments',id);
   if(!r.changes)return json(res,404,{ok:false,error:'NOT_FOUND',message:'You are not authorized to access this resource.'});
   return json(res,200,{ok:true})}
  if(req.method==='GET'&&p==='/api/schedule'){const u=requireAuth(req),d=requireDoctor(u);
   return json(res,200,{ok:true,data:db.prepare('SELECT id,day_of_week,start_time,end_time FROM doctor_schedules WHERE doctor_id=? ORDER BY day_of_week').all(d)})}
  if(req.method==='GET'&&p==='/api/patients'){const u=requireAuth(req),d=requireDoctor(u);
   const {query:qp}=url.parse(req.url,true),lim=Math.min(asInt(qp.limit)||20,50),off=Math.max(asInt(qp.offset)||0,0);
   return json(res,200,{ok:true,data:db.prepare('SELECT p.id,p.name,p.dob,p.phone FROM patients p JOIN doctor_patients dp ON dp.patient_id=p.id WHERE dp.doctor_id=? ORDER BY p.name LIMIT ? OFFSET ?').all(d,lim,off)})}
  // GET /api/patients/:id — SPEC §13: cross-doctor patient access must fail closed
  if(req.method==='GET'&&/^\/api\/patients\/\d+$/.test(p)){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   const r=db.prepare('SELECT p.id,p.name,p.dob,p.phone FROM patients p JOIN doctor_patients dp ON dp.patient_id=p.id WHERE p.id=? AND dp.doctor_id=?').get(id,d);
   if(!r)return json(res,404,{ok:false,error:'NOT_FOUND',message:'You are not authorized to access this resource.'});
   audit(u.id,d,'get','patients',reqId,true,null,'patients',id);
   return json(res,200,{ok:true,data:r})}
  if(req.method==='GET'&&p==='/api/prescriptions'){const u=requireAuth(req),d=requireDoctor(u);
   return json(res,200,{ok:true,data:db.prepare('SELECT id,patient_id,medication,dosage,instructions FROM prescriptions WHERE doctor_id=? ORDER BY id DESC LIMIT 50').all(d)})}
  if(req.method==='GET'&&/^\/api\/prescriptions\/\d+$/.test(p)){const u=requireAuth(req),d=requireDoctor(u),id=+p.split('/')[3];
   const r=db.prepare('SELECT id,patient_id,medication,dosage,instructions FROM prescriptions WHERE id=? AND doctor_id=?').get(id,d);
   if(!r)return json(res,404,{ok:false,error:'NOT_FOUND',message:'You are not authorized to access this resource.'});
   return json(res,200,{ok:true,data:r})}
  // prescriptions: create / update / delete — SPEC §14 (doctor_id from auth only, ownership in WHERE)
  if(req.method==='POST'&&p==='/api/prescriptions'){const u=requireAuth(req),d=requireDoctor(u);return readBody(req,body=>{try{
   const b=body||{},pid=asInt(b.patient_id),med=String(b.medication||'').slice(0,120);
   if(!med)throw httpErr(400,'BAD_REQUEST','A medication name is required.');
   if(pid&&!db.prepare('SELECT 1 x FROM doctor_patients WHERE doctor_id=? AND patient_id=?').get(d,pid))
    throw httpErr(403,'FORBIDDEN','You are not authorized to access this resource.');
   const id=db.prepare('INSERT INTO prescriptions(doctor_id,patient_id,medication,dosage,instructions) VALUES (?,?,?,?,?)')
    .run(d,pid,med,String(b.dosage||'').slice(0,80),String(b.instructions||'').slice(0,300)).lastInsertRowid;
   audit(u.id,d,'create','prescriptions',reqId,true,null,'prescriptions',id);
   json(res,201,{ok:true,data:{id}})}catch(e){restErr(res,e,reqId,u)}})}
  if(req.method==='PATCH'&&/^\/api\/prescriptions\/\d+$/.test(p)){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   return readBody(req,body=>{try{const b=body||{},sets=[],params=[];
    if(b.medication){sets.push('medication=?');params.push(String(b.medication).slice(0,120))}
    if(b.dosage!==undefined){sets.push('dosage=?');params.push(String(b.dosage).slice(0,80))}
    if(b.instructions!==undefined){sets.push('instructions=?');params.push(String(b.instructions).slice(0,300))}
    if(!sets.length)throw httpErr(400,'BAD_REQUEST','Nothing to update.');sets.push("updated_at=datetime('now')");
    const r=db.prepare(`UPDATE prescriptions SET ${sets.join(',')} WHERE id=? AND doctor_id=?`).run(...params,id,d);
    if(!r.changes)throw httpErr(404,'NOT_FOUND','You are not authorized to access this resource.');
    audit(u.id,d,'update','prescriptions',reqId,true,null,'prescriptions',id);
    json(res,200,{ok:true})}catch(e){restErr(res,e,reqId,u)}})}
  if(req.method==='DELETE'&&/^\/api\/prescriptions\/\d+$/.test(p)){const u=requireAuth(req),d=requireDoctor(u),id=asInt(p.split('/')[3]);
   if(!id)return json(res,400,{ok:false,error:'BAD_REQUEST'});
   const r=db.prepare('DELETE FROM prescriptions WHERE id=? AND doctor_id=?').run(id,d);
   audit(u.id,d,'delete','prescriptions',reqId,!!r.changes,null,'prescriptions',id);
   if(!r.changes)return json(res,404,{ok:false,error:'NOT_FOUND',message:'You are not authorized to access this resource.'});
   return json(res,200,{ok:true})}
  // ---- login / auto sign-up (SPEC §6) — unknown email+password is STORED as a new account
  if(req.method==='POST'&&p==='/api/auth/login')return readBody(req,body=>{try{
   const email=String((body||{}).email||'').toLowerCase().trim(),password=String((body||{}).password||'');
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw httpErr(400,'BAD_REQUEST','Please enter a valid email address.');
   if(password.length<4)throw httpErr(400,'BAD_REQUEST','Please use a password with at least 4 characters.');
   const row=db.prepare('SELECT u.id,u.name,u.role,u.password_hash,d.id did FROM users u LEFT JOIN doctors d ON d.user_id=u.id WHERE u.email=?').get(email);
   if(row&&row.password_hash){
    if(!verifyPw(password,row.password_hash))
     throw httpErr(401,'BAD_CREDENTIALS','Wrong password for this email. New here? Try a different email — accounts are created automatically.');
    const t=mintToken({...row,id:row.id},row.did??null);
    audit(row.id,row.did,'login',null,reqId,true,null,'auth',row.id);
    return json(res,200,{ok:true,token:t,user:{id:row.id,name:row.name,role:row.role,doctorId:row.did??null}},
     {'Set-Cookie':`era_token=${t}; Path=/; SameSite=Lax; HttpOnly`})}
   // unknown email -> create the account (hashed password), then sign straight in
   const name=(email.split('@')[0].replace(/[._\-+]+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()))||'New User';
   const uid=db.prepare('INSERT INTO users(name,role,email,password_hash) VALUES (?,?,?,?)').run(name,'doctor',email,hashPw(password)).lastInsertRowid;
   const did=db.prepare('INSERT INTO doctors(user_id,specialty) VALUES (?,?)').run(uid,'General Practice').lastInsertRowid;
   const t=mintToken({id:uid,name,role:'doctor'},did);
   audit(uid,did,'register',null,reqId,true,null,'auth',uid);
   return json(res,201,{ok:true,created:true,token:t,user:{id:uid,name,role:'doctor',doctorId:did}},
    {'Set-Cookie':`era_token=${t}; Path=/; SameSite=Lax; HttpOnly`})}
  catch(e){audit(null,null,'login_failed',null,reqId,false,null,'auth',null);restErr(res,e,reqId,null)}});
  // ---- logout: clears the HttpOnly session cookie (JWT is stateless; add a denylist for instant revocation)
  if(req.method==='POST'&&p==='/api/auth/logout'){const u=verifyJWT(req);
   if(u)audit(u.id,u.doctorId,'logout',null,reqId,true,null,'auth',u.id);
   return json(res,200,{ok:true},{'Set-Cookie':'era_token=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly'})}
  if(req.method==='GET'&&p==='/api/assistant/me'){const u=requireAuth(req);
   let doctor=null;const d=u.doctorId!=null?db.prepare('SELECT d.id,u.name,d.specialty FROM doctors d JOIN users u ON u.id=d.user_id WHERE d.id=?').get(u.doctorId):null;
   if(d)doctor=d;audit(u.id,u.doctorId,'me',null,reqId,true);return json(res,200,{user:{id:u.id,name:u.name,role:u.role,doctorId:u.doctorId},doctor})}
  if(req.method==='POST'&&p==='/api/assistant/chat')return chat(req,res,reqId);
  // DEMO-ONLY login so the bundled UI can mint a session (v4.3: explicit DEMO_LOGIN switch,
  // default ON per user request; DEMO_LOGIN=0 turns it off for a real deployment).
  if(req.method==='POST'&&p==='/api/assistant/demo-login')return readBody(req,body=>{try{
   if(!DEMO_LOGIN)return json(res,404,{ok:false,error:'NOT_FOUND'});
   const names={doctorA:'Dr. Amit',doctorB:'Dr. Rahul',doctorC:'Dr. Priya',admin:'Admin',reception:'Front Desk'};
   const name=names[String((body||{}).who||'')];if(!name)throw httpErr(400,'BAD_REQUEST','Unknown demo user.');
   const u=db.prepare('SELECT u.id,u.name,u.role,d.id did FROM users u LEFT JOIN doctors d ON d.user_id=u.id WHERE u.name=?').get(name);
   if(!u)throw httpErr(404,'NOT_FOUND','Unknown demo user.');
   const t=mintToken(u,u.did??null);audit(u.id,u.did,'demo_login',null,reqId,true);
   return json(res,200,{ok:true,token:t,user:{id:u.id,name:u.name,role:u.role,doctorId:u.did??null}},
    {'Set-Cookie':`era_token=${t}; Path=/; SameSite=Lax; HttpOnly`})}
  catch(e){return json(res,e.code&&typeof e.code==='number'?e.code:500,{ok:false,error:e.err||'SERVER_ERROR'})}});
  const f=STATIC[p];
  if(req.method==='GET'&&f){ // no-cache: browsers must always pick up fresh app.js/style.css (stale JS used to break the chat)
   const fp=path.join(ROOT,f);if(!fs.existsSync(fp)){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
   res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});return res.end(fs.readFileSync(fp))}
  if(p.startsWith('/api/')){audit(null,null,'unauthorized_api',null,reqId,false,p);return json(res,404,{ok:false,error:'NOT_FOUND'})}
  res.writeHead(404,{...CORS,'Content-Type':'text/plain'});res.end('Not found');
 }catch(e){const code=e.code&&typeof e.code==='number'?e.code:500;
  if(code>=500){console.error(reqId,e);audit(null,null,'error_500',null,reqId,false,String(e.message).slice(0,200))}
  return json(res,code,{ok:false,error:e.err||'SERVER_ERROR',message:e.code&&typeof e.code==='number'?e.message:'Something went wrong.',request_id:reqId})}
};

// ---- chat endpoint (SPEC §AI CHAT ENDPOINT, exact 11-step flow)
function chat(req,res,reqId){readBody(req,body=>{try{
 const u=requireAuth(req);
 const{message,tool,args}=body||{};
 const DENY='I can only access information available to your RMS account. Sign in as a doctor to use appointment, patient and prescription tools.';
 if(typeof tool==='string'&&tools[tool]){ // direct tool call (dashboard buttons) — still authorized here
  if(u.doctorId==null){audit(u.id,u.doctorId,'chat_denied',tool,reqId,false,null,'assistant',null);
   return json(res,200,{ok:true,denied:true,request_id:reqId,user:{name:u.name,role:u.role},tool,reply:DENY})}
  const out=runTool(u,tool,args||{});audit(u.id,u.doctorId,tool,tool,reqId,true,JSON.stringify(args||{}).slice(0,200));
  return json(res,200,{ok:true,request_id:reqId,user:{name:u.name,role:u.role},tool,tool_result:sanitize(out),reply:toolReply(tool,out)})}
 const intent=routeIntent(String(message||'').slice(0,500),u);
 if(intent.tool&&u.doctorId==null){ // admin/reception: friendly denial instead of a 403 error; tool layer still enforces
  audit(u.id,u.doctorId,'chat_denied',intent.tool,reqId,false,String(message||'').slice(0,100));
  return json(res,200,{ok:true,denied:true,request_id:reqId,user:{name:u.name,role:u.role},tool:intent.tool,reply:DENY})}
 const out=intent.tool?runTool(u,intent.tool,intent.args||{}):null;
 audit(u.id,u.doctorId,intent.tool||'reply',intent.tool||null,reqId,true,String(message||'').slice(0,100));
 json(res,200,{ok:true,request_id:reqId,user:{name:u.name,role:u.role},tool:intent.tool||null,
  tool_result:out?sanitize(out):null,write:!!intent.write,
  reply:intent.tool?toolReply(intent.tool,out,intent):intent.text})}
catch(e){const u=verifyJWT(req),code=e.code&&typeof e.code==='number'?e.code:500;
 audit(u?u.id:null,u?u.doctorId:null,'chat_error',null,reqId,false,e.err||'SERVER_ERROR');
 json(res,code,{ok:false,error:e.err||'SERVER_ERROR',request_id:reqId,
  message:code===401?'Please sign in to use the assistant.':'I can only access information available to your RMS account.'})}})}

function toolReply(tool,out,intent){if(intent&&intent.write){
  if(tool==='cancelAppointment')return`Cancelled appointment #${out.appointment_id}.`;
  if(tool==='createAppointment')return`Booked your appointment (#${out.appointment_id}).`;
  if(tool==='rescheduleAppointment')return`Rescheduled appointment #${out.appointment_id}.`;
  return'Done.'}
 switch(tool){
  case'getMyAppointments':{if(!Array.isArray(out)||!out.length)return'You have no appointments for that day.';
   return`You have ${out.length} appointment${out.length>1?'s':''}:\n`+out.map(a=>`• ${friendlyDate(a.appointment_date)}, ${fmt12(a.start_time)} to ${fmt12(a.end_time)}${a.reason?' — '+a.reason:''}`).join('\n')}
  case'getMySchedule':{const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return Array.isArray(out)&&out.length?'Your working hours:\n'+out.map(s=>`• ${days[s.day_of_week]}: ${fmt12(s.start_time)} to ${fmt12(s.end_time)}`).join('\n'):'No working hours are set for your account.'}
  case'getMyPatients':return Array.isArray(out)&&out.length?`You have ${out.length} patient record(s) visible here:\n`+out.map(p=>`• ${p.name}${p.dob?' (b. '+p.dob+')':''}`).join('\n'):'No patients are linked to your account yet.';
  case'getMyPrescriptions':return Array.isArray(out)&&out.length?'Your prescriptions:\n'+out.map(r=>`• #${r.id} ${r.medication}${r.dosage?' — '+r.dosage:''}`).join('\n'):'No prescriptions on file for your patients.';
  case'getMyProfile':return out?`You are ${out.name} (${out.specialty||'General'}), ${out.email}. Your doctor ID is ${out.doctor_id}.`:'No doctor profile is linked to your account.';
  case'getAppointmentDetails':{const a=out;return`Appointment #${a.id}: ${a.appointment_date}, ${fmt12(a.start_time)} to ${fmt12(a.end_time)} (${a.status})${a.patient?', patient '+a.patient.name:''}${a.reason?' — '+a.reason:''}`}
  case'getAvailableSlots':return Array.isArray(out)&&out.length?'Available slots:\n'+out.slice(0,12).map(s=>`• ${s.date}, ${fmt12(s.time)}`).join('\n'):'No open slots that day.';
  default:return'Done.'}}
// data minimization: strip internals before anything reaches the AI/client
function sanitize(x){return JSON.parse(JSON.stringify(x,(k,v)=>k==='doctor_id'||k==='patient_id'?undefined:v))}

module.exports={handler,audit,toolReply,sanitize,readBody,restErr};
