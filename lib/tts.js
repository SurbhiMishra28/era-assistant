// lib/tts.js — NVIDIA NVCF TTS client (v3.8, v3.9.1 dual transport) + WAV cache + key handling.
// The API key never leaves this module/server (Rules §3). NVCF/Triton is intermittently flaky:
// strategy is 3 HTTP attempts → 2 gRPC attempts (python tts-grpc.py bridge) → give up; every payload
// is validated as a real RIFF/WAVE before it is served or cached.
'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {ROOT,NVCF_BASE}=require('./env');
let nvcfKeyCache=null;
const nvidiaKey=()=>{if(process.env.NVIDIA_API_KEY)return process.env.NVIDIA_API_KEY.trim();
 if(nvcfKeyCache===null){try{nvcfKeyCache=fs.readFileSync(path.join(ROOT,'nvcf.key'),'utf8').trim()||''}catch{nvcfKeyCache=''}}
 return nvcfKeyCache};
const ttsCache=new Map(); // LRU cap 20: voice+text → WAV (greeting/repeats survive upstream flakiness)
const isWav=b=>b&&b.length>44&&b.slice(0,4).toString('ascii')==='RIFF';
// → {wav:Buffer|null, errs:[string]} — every failure attempt is recorded for the caller's log
async function synthesize({text,voice,lang}){
 const cacheKey=voice+'\n'+text;
 if(ttsCache.has(cacheKey)){const hit=ttsCache.get(cacheKey);ttsCache.delete(cacheKey);ttsCache.set(cacheKey,hit);return{wav:hit,errs:[]}}
 const k=nvidiaKey();if(!k)return{wav:null,errs:['no-key']};
 let wav=null;const errs=[];
 for(let attempt=1;attempt<=3&&!wav;attempt++){
  try{const fd=new FormData();fd.set('text',text);fd.set('language',lang);fd.set('voice',voice);fd.set('sample_rate_hz','22050');fd.set('encoding','LINEAR_PCM');
   const r=await fetch(NVCF_BASE+'/v1/audio/synthesize',{method:'POST',headers:{Authorization:'Bearer '+k},body:fd,signal:AbortSignal.timeout(60000)});
   const buf=Buffer.from(await r.arrayBuffer());
   if(r.ok&&isWav(buf)){wav=buf;break}
   errs.push('http '+(r.ok?'invalid-audio':r.status+' '+buf.toString('utf8').slice(0,100)))}
  catch(e){errs.push('http '+e.name+(e.cause?' ('+String(e.cause).slice(0,80)+')':''))}
  if(attempt<3)await new Promise(z=>setTimeout(z,[800,2000][attempt-1]));
 }
 for(let g=0;g<2&&!wav;g++){ // gRPC bridge: often healthy while the HTTP route is not
  try{wav=await new Promise(resolve=>{
   const p=spawn('python',['tts-grpc.py',text,voice],{cwd:ROOT,timeout:90000,windowsHide:true});
   const chunks=[];let err='';
   p.stdout.on('data',c=>chunks.push(c));p.stderr.on('data',c=>{err+=c});
   p.on('error',e=>{errs.push('grpc spawn '+e.code);resolve(null)});
   p.on('close',(code,signal)=>{const buf=Buffer.concat(chunks);
    if(code===0&&isWav(buf))resolve(buf);
    else{errs.push('grpc '+(signal?'timeout':code+' '+err.trim().slice(0,200)));resolve(null)}})});
  }catch(e){errs.push('grpc '+e.name)}
  if(!wav&&g<1)await new Promise(z=>setTimeout(z,1000));
 }
 if(wav){ttsCache.set(cacheKey,wav);if(ttsCache.size>20)ttsCache.delete(ttsCache.keys().next().value)} // LRU cap 20
 return{wav,errs};
}
module.exports={nvidiaKey,synthesize};
