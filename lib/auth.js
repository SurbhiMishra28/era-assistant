// lib/auth.js — passwords + JWT (HS256) + authorization middleware (SPEC §AUTH/§AUTHORIZATION).
// verifyJWT is the ONLY trusted identity source (SPEC: never from body/query/AI args).
'use strict';
const crypto=require('crypto');
const {JWT_SECRET,TOKEN_TTL_S}=require('./env');
const httpErr=(code,err,msg)=>Object.assign(new Error(msg||err),{code,err});
const asInt=v=>{const n=+v;return Number.isSafeInteger(n)&&n>0?n:null};
const hashPw=pw=>crypto.scryptSync(String(pw),'era-salt-v1',32).toString('hex'); // demo-grade; swap for bcrypt/argon2 in production
const verifyPw=(pw,h)=>{try{return crypto.timingSafeEqual(Buffer.from(hashPw(pw),'hex'),Buffer.from(String(h),'hex'))}catch{return false}};
const b64u=b=>Buffer.from(b).toString('base64url'),b64s=s=>Buffer.from(s,'base64url').toString('utf8');
const hmac=d=>crypto.createHmac('sha256',JWT_SECRET).update(d).digest('base64url');
function mintToken(u,d){const now=Math.floor(Date.now()/1e3),
 h=b64u(JSON.stringify({alg:'HS256',typ:'JWT'})),
 p=b64u(JSON.stringify({sub:String(u.id),role:u.role,doctorId:d||null,name:u.name,iat:now,exp:now+TOKEN_TTL_S})),
 sig=hmac(h+'.'+p);return`${h}.${p}.${sig}`}
function verifyJWT(req){
 const m=/(?:^|;\s*)era_token=([A-Za-z0-9\-_=.]+)|Bearer\s+([A-Za-z0-9\-_=.]+)/.exec(req.headers.cookie||'')||[];
 const t=m[1]||m[2]||((req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7):null);
 if(!t)return null;
 try{const[h,p,s]=t.split('.');if(hmac(h+'.'+p)!==s)return null;
  const c=JSON.parse(b64s(p));if(c.exp<=Math.floor(Date.now()/1e3))return null;
  return{id:+c.sub,role:c.role,doctorId:c.doctorId??null,name:c.name||''}}catch{return null}}
const requireAuth=req=>{const u=verifyJWT(req);if(!u)throw httpErr(401,'AUTH_REQUIRED','Authentication required.');return u};
const requireRole=(u,roles)=>{if(!roles.includes(u.role))throw httpErr(403,'FORBIDDEN','I can only access information available to your RMS account.');return u};
const requireDoctor=u=>{requireRole(u,['doctor','admin']);if(u.doctorId==null)throw httpErr(403,'NO_DOCTOR_PROFILE','I can only access information available to your RMS account.');return u.doctorId};
module.exports={hashPw,verifyPw,mintToken,verifyJWT,requireAuth,requireRole,requireDoctor,httpErr,asInt};
