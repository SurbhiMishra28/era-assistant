// server/services/tts.js — NVIDIA NVCF Sofia voice. Aligned (v1.2) with the root Era app's
// WORKING pipeline (lib/tts.js v3.8): NVCF invocation endpoint + multipart FormData +
// LINEAR_PCM. JSON shapes to other hosts fail upstream — this shape is the proven one.
// The key NEVER leaves the server. 3 HTTP attempts → 2 gRPC attempts (tts-grpc.py) → give up;
// every payload is validated as real RIFF/WAVE before serving or caching.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NVCF_BASE = process.env.NVCF_BASE || 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com';
const SOFIA_VOICES = ['Magpie-Multilingual.EN-US.Sofia', 'Magpie-Multilingual.HI-IN.Sofia'];
const DEFAULT_VOICE = SOFIA_VOICES[0];

let nvcfKeyCache = null;
function nvidiaKey() {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY.trim();
  if (nvcfKeyCache === null) {
    try { nvcfKeyCache = fs.readFileSync(path.join(__dirname, '..', '..', 'nvcf.key'), 'utf8').trim() || ''; }
    catch { nvcfKeyCache = ''; }
  }
  return nvcfKeyCache;
}

const isWav = b => b && b.length > 44 && b.slice(0, 4).toString('ascii') === 'RIFF';

// tiny LRU (20 entries) so greetings/repeats don't re-hit NVIDIA
const cache = new Map();
const CACHE_MAX = 20;
const cacheKey = (text, voice) => voice + '\n' + text;

function grpcAttempt({ text, voice, lang }) {
  return new Promise((resolve, reject) => {
    const py = path.join(__dirname, '..', '..', 'tts-grpc.py');
    if (!fs.existsSync(py)) return reject(new Error('no grpc bridge'));
    const p = spawn('python', [py], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = [], err = '';
    p.stdout.on('data', c => out.push(c));
    p.stderr.on('data', c => { err += c; });
    p.on('error', e => reject(e));
    p.on('close', code => {
      const wav = Buffer.concat(out);
      if (code === 0 && isWav(wav)) resolve(wav);
      else reject(new Error('grpc failed ' + code + (err ? ': ' + err.slice(0, 120) : '')));
    });
    p.stdin.end(JSON.stringify({ text, voice, language: lang }));
    setTimeout(() => { try { p.kill(); } catch {} reject(new Error('grpc timeout')); }, 30000).unref();
  });
}

async function synthesize({ text, voice }) {
  const key = nvidiaKey();
  if (!key) return { wav: null, errs: ['TTS_NOT_CONFIGURED'] };
  const hit = cache.get(cacheKey(text, voice));
  if (hit) { cache.delete(cacheKey(text, voice)); cache.set(cacheKey(text, voice), hit); return { wav: hit, errs: [] }; }
  const lang = voice.endsWith('HI-IN.Sofia') ? 'hi-IN' : 'en-US';
  const errs = [];
  let wav = null;
  for (let attempt = 1; attempt <= 3 && !wav; attempt++) {
    try {
      const fd = new FormData();
      fd.set('text', text); fd.set('language', lang); fd.set('voice', voice);
      fd.set('sample_rate_hz', '22050'); fd.set('encoding', 'LINEAR_PCM');
      const r = await fetch(NVCF_BASE + '/v1/audio/synthesize', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key },
        body: fd,
        signal: AbortSignal.timeout(60000)
      });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && isWav(buf)) { wav = buf; break; }
      errs.push('http ' + (r.ok ? 'invalid-audio' : r.status + ' ' + buf.toString('utf8').slice(0, 100)));
    } catch (e) { errs.push('http ' + e.name + (e.cause ? ' (' + String(e.cause).slice(0, 80) + ')' : '')); }
    if (attempt < 3) await new Promise(z => setTimeout(z, [800, 2000][attempt - 1]));
  }
  for (let g = 0; g < 2 && !wav; g++) {
    try { wav = await grpcAttempt({ text, voice, lang }); }
    catch (e) { errs.push('grpc ' + e.message); }
    if (!wav && g < 1) await new Promise(z => setTimeout(z, 1000));
  }
  if (wav) { cache.set(cacheKey(text, voice), wav); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
  return { wav, errs };
}

module.exports = { nvidiaKey, synthesize, SOFIA_VOICES, DEFAULT_VOICE };
