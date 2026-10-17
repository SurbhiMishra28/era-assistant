// lib/env.js — configuration + gitignored .env loader (v4.2 split).
// Required FIRST by every other module, so the loader runs exactly once. File WINS over shell env —
// this deployment box exports junk shell-wide (PORT=0), so .env is the single source of truth.
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
try{for(const line of fs.readFileSync(path.join(ROOT,'.env'),'utf8').split(/\r?\n/)){
 const m=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*?)\s*$/.exec(line);
 if(m&&m[2]!=='')process.env[m[1]]=m[2].replace(/["']/g,'')}}catch{}
module.exports={
 ROOT,
 PORT:process.env.PORT||8000,
 HTTPS_PORT:+(process.env.HTTPS_PORT||8443),
 // ERA_DB env override (full file path) exists for test isolation (test/security.test.js)
 DB_FILE:process.env.ERA_DB?path.resolve(ROOT,process.env.ERA_DB):path.join(ROOT,'db','era.db'),
 JWT_SECRET:process.env.JWT_SECRET||'dev-only-secret-change-me', // demo default; .env carries the real one
 TOKEN_TTL_S:8*60*60,
 // ---- NVIDIA NVCF TTS (v3.8): key from NVIDIA_API_KEY env or gitignored nvcf.key — never hardcode, never log.
 NVCF_BASE:process.env.NVIDIA_TTS_URL||'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com',
 NVCF_DEFAULT_VOICE:process.env.NVIDIA_TTS_VOICE||'Magpie-Multilingual.EN-US.Sofia',
 // v4.1: the ONLY voices the assistant may speak — single owner: the voice list AND the synthesize guard read this
 SOFIA_VOICES:['Magpie-Multilingual.EN-US.Sofia','Magpie-Multilingual.HI-IN.Sofia'],
 // v4.3: demo login on the start screen is a FEATURE (user request) — explicit switch, default ON.
 // Set DEMO_LOGIN=0 in .env (or env) to hide the endpoint for a real deployment.
 DEMO_LOGIN:String(process.env.DEMO_LOGIN??'1')!=='0',
 // v4.4: dashboard origin for CORS. It used to be hardcoded to http://localhost:5500 inside the
 // router, so embedding Era in a real dashboard meant editing source. Set CORS_ORIGIN to the
 // dashboard's exact origin (no trailing slash, no path).
 CORS_ORIGIN:process.env.CORS_ORIGIN||'http://localhost:5500',
 // v4.4: throttle for the sign-in door. LOGIN_MAX_ATTEMPTS failed tries per (IP + email) per window;
 // 0 turns it off. Per-process and in-memory — it blunts online guessing on a single box, it is not a
 // WAF and does not survive a restart.
 LOGIN_MAX_ATTEMPTS:+(process.env.LOGIN_MAX_ATTEMPTS??8),
 LOGIN_WINDOW_MS:+(process.env.LOGIN_WINDOW_MS||900000),
 // v4.4: separate, NEVER-reset ceiling for spraying MANY emails from one address. A successful
 // sign-in only clears that account's own counter, so a colleague behind the same NAT cannot re-arm
 // an attacker's budget.
 LOGIN_IP_MAX_ATTEMPTS:+(process.env.LOGIN_IP_MAX_ATTEMPTS??30),
};
