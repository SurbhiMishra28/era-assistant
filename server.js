// server.js — Era assistant ENTRY POINT (zero npm deps; Node >= 22.5).
// RMS-DASHBOARD READY: the assistant endpoints are multi-user, role-aware and enforce
// strict doctor-level data isolation at the backend layer — never via the AI or the frontend.
//
//   RMS Login → JWT → requireAuth/requireRole → /api/assistant/chat → tool layer
//   → parameterized SQL scoped to req.user.doctorId → response → dashboard
//
// Structure (v4.2 split — same behavior as the former single file):
//   lib/env.js       config + gitignored .env loader (required first, file wins over shell env)
//   lib/auth.js      passwords + JWT + authorization middleware
//   lib/database.js  SQLite open + schema + migrations + demo seed (+ today/tomorrow re-fresh)
//   lib/tools.js     doctor-scoped tool layer (the only place that touches RMS tables)
//   lib/brain.js     intent router (swap for an LLM; tools + auth stay identical)
//   lib/tts.js       NVIDIA NVCF client: Sofia-only voices, cache, HTTP→gRPC retry pipeline
//   lib/router.js    HTTP layer: endpoints, CORS, audit, static files, chat endpoint
// Swap-in for a real RMS: replace verifyJWT() in lib/auth.js with your existing auth,
// and drop lib/database.js's demo seed (SPEC §AUTH).
'use strict';
const env=require('./lib/env'); // MUST be first: loads gitignored .env before anything reads config
const {handler}=require('./lib/router');
const http=require('http'),fs=require('fs'),path=require('path');

const app=http.createServer(handler);
// listen only when run directly, so tests/token.js can import without port clashes
if(require.main===module){
 app.listen(env.PORT,()=>console.log(`Era RMS-ready: http://localhost:${env.PORT}  (SQLite: ${env.DB_FILE})`));
 // v4.1 optional HTTPS mirror: when gitignored certs/key.pem + cert.pem exist, serve TLS on HTTPS_PORT (8443)
 try{const K=path.join(env.ROOT,'certs','key.pem'),C=path.join(env.ROOT,'certs','cert.pem');
  if(fs.existsSync(K)&&fs.existsSync(C)){
   const https=require('https');
   https.createServer({key:fs.readFileSync(K),cert:fs.readFileSync(C)},handler).listen(env.HTTPS_PORT,
    ()=>console.log(`Era HTTPS ready: https://localhost:${env.HTTPS_PORT}  (self-signed cert — accept the browser warning)`))}}
 catch(e){console.error('HTTPS listener skipped:',e.message)}}

// test/token entry: keep the original export surface — test/security.test.js depends on it
const auth=require('./lib/auth'),database=require('./lib/database'),
 tools=require('./lib/tools'),brain=require('./lib/brain'),router=require('./lib/router');
module.exports={__test:{
 verifyJWT:auth.verifyJWT,mintToken:auth.mintToken,hashPw:auth.hashPw,verifyPw:auth.verifyPw,
 requireAuth:auth.requireAuth,requireRole:auth.requireRole,requireDoctor:auth.requireDoctor,
 tools:tools.tools,runTool:tools.runTool,scopeDoctor:tools.scopeDoctor,
 routeIntent:brain.routeIntent,db:database.db,EraDB:database.EraDB,
 audit:router.audit,sanitize:router.sanitize,toolReply:router.toolReply}};
