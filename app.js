const $=s=>document.querySelector(s), KEY={set:'era_settings'};
console.log('[Era] app.js v4.5.0 loaded — if you see this twice or an older version, clear the browser cache (Ctrl+F5).');
const load=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
// ---- rms session: identity comes from the server (JWT cookie), never from this page (spec §AUTH)
const api=async(p,o={})=>{const r=await fetch(p,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...o});return{status:r.status,data:await r.json().catch(()=>({}))}};
let ME=null;
const loadMe=async()=>{try{const{status,data}=await api('/api/assistant/me');if(status===200){ME=data.user;showWho();return true}return false}catch{return false}};
const demoLogin=async who=>{try{const{status,data}=await api('/api/assistant/demo-login',{method:'POST',body:JSON.stringify({who})});if(status===200){ME=data.user;showWho();return true}}catch{}
 return false};
// two views only: auth → workspace (Era herself is the interface; no intro card — chat history lives in the v4.5 drawer)
const show=v=>{$('#auth').classList.toggle('hidden',v!=='auth');document.querySelector('main').classList.toggle('hidden',v!=='app')};
const showApp=async()=>{show('app');setState('idle','Ready');startLife();refreshChats();
 // pop-up greeting: personalized from the authenticated identity, once per login session.
 // sessionStorage survives reloads (refresh = quiet restore) and is cleared on sign-out.
 let greeted=false;try{greeted=sessionStorage.getItem('era_greeted')==='1'}catch{}
 if(greeted||!S.greet){setState('idle','Ready');return}
 try{sessionStorage.setItem('era_greeted','1')}catch{}
 const h=new Date().getHours(),g=h<12?'Good morning':h<17?'Good afternoon':'Good evening',
  name=(ME&&ME.name)||S.name||'',
  t=`${g}${name?', '+name:''}! I'm Era, your assistant. How can I assist you today?`;
 setTimeout(()=>{try{speak(t)}catch(e){console.error('greeting error',e)}},400)};
$('#loginF').onsubmit=async e=>{e.preventDefault();const m=$('#authMsg');
 m.className='authmsg';m.textContent='Signing you in…';
 const{status,data}=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('#liEmail').value.trim(),password:$('#liPass').value})});
 if(status===200||status===201){ME=data.user;showWho();
  m.className='authmsg ok';m.textContent=data.created?`Account created — welcome, ${ME.name}!`:`Welcome back, ${ME.name}!`;
  setTimeout(showApp,450)}
 else{m.className='authmsg err';m.textContent=data.message||'Could not sign you in. Please try again.'}};
const showWho=()=>{const w=$('#who');if(w)w.textContent=ME?`${ME.name} · ${ME.role}${ME.doctorId?' · doctor #'+ME.doctorId:''}`:''};
let S=Object.assign({name:'',voice:true,greet:true,ttsVoice:'Magpie-Multilingual.EN-US.Sofia'},load(KEY.set,{})); // v3.9: NVIDIA voices ONLY
const face=$('#face'),setState=(s,t)=>{face.dataset.state=s;$('#status').textContent=t};
// ---- character photo (v3.7.2): assets/era3d.png IS the character — plain <img>, no JS needed.
// (The old SVG rig was removed from index.html; the rig helpers below no-op safely without it.)
// ---- character rig (SVG parts) — lip sync, blinks, brows
const mouth=$('#mouthClipPath'),eyes=[...document.querySelectorAll('.eye')],brows=[...document.querySelectorAll('.brow')]; // empty in photo-only mode (v3.7.2) — helpers no-op
const MOUTH={ // viseme shapes (v3.6 geometry, mouth center ~y166): rest/closed/wide/round/open/ooh
 rest:'M 134 166 Q 150 160 166 166 Q 150 170 134 166 Z',
 closed:'M 137 165 Q 150 163 163 165 Q 150 169 137 165 Z',
 wide:'M 130 166 Q 150 161 170 166 Q 150 176 130 166 Z',
 round:'M 142 164 Q 150 162 158 164 Q 159 176 150 178 Q 141 176 142 164 Z',
 open:'M 137 164 Q 150 161 163 164 Q 162 180 150 181 Q 138 180 137 164 Z',
 ooh:'M 144 165 Q 150 163 156 165 Q 156 174 150 175 Q 144 174 144 165 Z'};
const setMouth=k=>{if(mouth&&MOUTH[k])mouth.setAttribute('d',MOUTH[k])};
setMouth('rest');
// viseme choice per word: vowels in the word drive the shape; consonant-only words flutter
const visemeFor=w=>{w=w.toLowerCase();
 if(/[aeiou]/.test(w)){if(/[uo]/.test(w)&&!/[aei]/.test(w))return['round','ooh'];if(/[aa]/.test(w))return['open','wide'];return['wide','open']}
 return['closed','rest']};
const mouthStop=()=>setMouth('rest'); // photo mode: rig dormant (v3.7.2) — helpers stay no-op
// idle life: randomized blinks + occasional brow raises (only while not mid-blink)
let blinkTimer=0;
function scheduleBlink(){clearTimeout(blinkTimer);blinkTimer=setTimeout(()=>{if(!eyes.length)return scheduleBlink();
 eyes.forEach(e=>e.style.transform='scaleY(0.08)');
 setTimeout(()=>{eyes.forEach(e=>e.style.transform='');scheduleBlink()},130)},2200+Math.random()*2800)}
function browFlick(){if(!brows.length)return;const b=brows[Math.random()<.5?0:1],old=b.getAttribute('d'),m=old.match(/Q (\d+) (\d+)/);
 if(!m)return; // generic: raise the Q control point ~8px, whatever the brow geometry is
 b.setAttribute('d',old.replace(/Q \d+ \d+/,`Q ${m[1]} ${Math.max(60,m[2]-8)}`));setTimeout(()=>b.setAttribute('d',old),700)}
let lifeTimer=0;
function startLife(){if(lifeTimer||(!eyes.length&&!brows.length))return;scheduleBlink();
 lifeTimer=setInterval(()=>{if(Math.random()<.35)browFlick()},4000)}
function stopLife(){clearTimeout(blinkTimer);clearInterval(lifeTimer);lifeTimer=0}
// ---- voice out (v4.0): ONE voice only — NVIDIA Sofia (user request). English, हिन्दी, Hinglish.
// via the /api/tts server proxy. Browser speechSynthesis is fully removed — no fallback voices.
const SOFIA={en:'Magpie-Multilingual.EN-US.Sofia',hi:'Magpie-Multilingual.HI-IN.Sofia'};
const DEFAULT_VOICES=[SOFIA.en,SOFIA.hi]; // if the voice-list API is down
const SOFIA_LABEL={[SOFIA.en]:'Sofia · English',[SOFIA.hi]:'Sofia · हिन्दी'};
const voiceLabel=v=>SOFIA_LABEL[v]||v;
let nvcfVoices=null;
const loadVoices=async()=>{const sel=$('#sVoiceSel');if(!sel)return;
 if(!nvcfVoices){try{const{status,data}=await api('/api/tts/voices');
  if(status===200&&data.ok&&Array.isArray(data.voices)&&data.voices.length)nvcfVoices=data.voices.filter(v=>v===SOFIA.en||v===SOFIA.hi)}catch(e){}}
 const list=(nvcfVoices&&nvcfVoices.length)?nvcfVoices:DEFAULT_VOICES;
 sel.innerHTML=list.map(v=>`<option value="${v}" ${v===S.ttsVoice?'selected':''}>${voiceLabel(v)}</option>`).join('')};
// auto-language (v4.0): one Sofia, three languages — हिन्दी/Hinglish text speaks with हिन्दी Sofia,
// everything else with the selected Sofia (default English). Hinglish = romanised Hindi.
const isDevanagari=t=>/[\u0900-\u097F]/.test(t);
const isHinglish=t=>/\b(namaste|namaskar|kaise|kaisi|kya|hai|hain|nahi|aap|aapka|aapki|aapke|aapko|mera|meri|mere|dawai|dawa|bukhar|sehat|kripya|karein|mein|din|raat|subah|shaam|khana|pani|paani|bimari|ilaj|shukriya|dhanyavad|theek|thik)\b/i.test(t);
const pickVoice=text=>{const lang=(isDevanagari(text)||isHinglish(text))?'hi':((S.ttsVoice||'').endsWith('HI-IN.Sofia')?'hi':'en');return SOFIA[lang]||SOFIA.en};
let speakSeq=0; // generation token: stop/new reply/logout invalidates playback mid-flight
let ttsAudio=null; // current Audio element for NVCF playback
const stopSpeak=()=>{speakSeq++;if(ttsAudio){ttsAudio.pause();URL.revokeObjectURL(ttsAudio.src);ttsAudio=null}mouthStop()};
async function speak(text,restState){$('#live').textContent=text; // a11y: replies remain readable when TTS is off/quiet
 if(!S.voice){setState(restState||'idle','Ready');return}
 const gen=++speakSeq;
 setState('speaking','Speaking…');
 // NVIDIA NVCF TTS via the server proxy — the API key never reaches the browser (v4.0: Sofia only, auto EN/हिन्दी/Hinglish)
 try{const r=await fetch('/api/tts',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:pickVoice(text)}),signal:AbortSignal.timeout(65000)});
  if(gen!==speakSeq)return;
  if(!r.ok)throw new Error('tts '+r.status);
  const blob=await r.blob();
  if(gen!==speakSeq)return;
  if(ttsAudio){ttsAudio.pause();URL.revokeObjectURL(ttsAudio.src)}
  ttsAudio=new Audio(URL.createObjectURL(blob));
  ttsAudio.onended=ttsAudio.onerror=()=>{if(gen===speakSeq){stopSpeak();setState(restState||'idle','Ready')}};
  await ttsAudio.play();return}
 catch(e){console.warn('NVIDIA voice unavailable',e);
  if(gen===speakSeq)setState('idle','Voice service unavailable — please try again shortly')}}
// ---- brain: answers come ONLY from the doctor-scoped server tools (/api/assistant/chat);
// the character speaks the reply — voice-only, no chat panel.
async function ask(text){text=String(text||'').trim();if(!text)return;
 if(!isViewingToday())chatLog.innerHTML=''; // sending always continues TODAY's conversation
 activeConv='today';bubble('user',text);
 setState('idle','Thinking…');let r=null;
 try{const{status,data}=await api('/api/assistant/chat',{method:'POST',body:JSON.stringify({message:text})});
  if(status===200&&data.ok)r=data.reply;
  else if(status===401){r='Your session expired — please sign in again.';doLogout();return}
  else if(data.denied||status===403||data.error==='FORBIDDEN'||data.error==='NOT_YOUR_PATIENT'){r=data.message||data.reply||'I can only access information available to your RMS account.';bubble('era',r);speak(r,'denied');return}
  else if(status>=400)r=data.message||'Something went wrong. Please try again.';
 }catch(e){console.warn('chat API unreachable',e);r='I cannot reach the clinic server right now. Please check the connection and try again.'}
 const reply=r||'I did not catch that. Could you ask again?';bubble('era',reply);speak(reply);loadConvos()}
// ---- voice only (mic): the stage takes spoken input; the text box was removed in v4.5.1
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec;
$('#mic').onclick=()=>{if(!SR)return speak('Voice input needs Chrome or Edge.');
 stopSpeak();rec=new SR();rec.lang='en-IN';rec.onstart=()=>setState('listening','Listening…');
 rec.onresult=e=>ask(e.results[0][0].transcript);
 rec.onerror=()=>setState('idle','Could not hear you. Try again.');
 rec.onend=()=>{if(face.dataset.state==='listening')setState('idle','Ready')};rec.start()};
$('#stop').onclick=()=>{stopSpeak();rec&&rec.abort();setState('idle','Ready')};
// ---- chat panel (v4.5): every exchange is saved per day on the server; this drawer shows the
// doctor↔Era history with past days as tag chips. A read-only mirror — the stage stays voice-first.
const panel=$('#chatPanel'),chatLog=$('#chatLog'),convTags=$('#convTags');
let convList=[],activeConv='today';
const todayStr=()=>{const n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0')};
const isViewingToday=()=>activeConv==='today'||((convList.find(c=>String(c.id)===activeConv)||{}).day===todayStr());
const bubble=(role,text)=>{const d=document.createElement('div');d.className='bub '+role;
 const p=document.createElement('p');p.textContent=String(text??'');d.appendChild(p);chatLog.appendChild(d);chatLog.scrollTop=chatLog.scrollHeight};
const emptyLog=()=>{chatLog.innerHTML='';const d=document.createElement('div');d.className='bub sys';
 d.textContent='No messages yet — talk to Era and the conversation will appear here.';chatLog.appendChild(d)};
const dayLabel=d=>{if(d===todayStr())return'Today';
 const y=new Date();y.setDate(y.getDate()-1);
 const ys=y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0');
 if(d===ys)return'Yesterday';
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString(undefined,{day:'numeric',month:'short'}):d};
async function loadConvos(){try{const{status,data}=await api('/api/assistant/conversations');
 if(status===200&&Array.isArray(data.data)){convList=data.data;renderTags()}}catch(e){}}
function renderTags(){convTags.innerHTML='';
 const list=convList.slice();
 if(!list.some(c=>c.day===todayStr()))list.unshift({id:0,day:todayStr(),messages:0});
 list.forEach(c=>{const b=document.createElement('button');b.type='button';
  b.className='chip'+((activeConv===String(c.id)||(activeConv==='today'&&c.day===todayStr()))?' on':'');
  b.textContent=dayLabel(c.day)+(c.messages?' · '+c.messages:'');
  b.onclick=()=>{if(c.id)loadConv(c.id);else{activeConv='today';renderTags();emptyLog()}};
  convTags.appendChild(b)})}
async function loadConv(id){try{const{status,data}=await api('/api/assistant/conversations/'+id);
 if(status!==200)return;activeConv=String(id);renderTags();chatLog.innerHTML='';
 (data.data.messages||[]).forEach(m=>bubble(m.role,m.text));if(!chatLog.children.length)emptyLog()}catch(e){}}
async function refreshChats(){await loadConvos();
 if(!isViewingToday())return; // never clobber a past day the user is reading
 chatLog.innerHTML='';
 const today=convList.find(c=>c.day===todayStr());
 if(today){try{const{status,data}=await api('/api/assistant/conversations/'+today.id);
  if(status===200)(data.data.messages||[]).forEach(m=>bubble(m.role,m.text))}catch(e){}}
 if(!chatLog.children.length)emptyLog()}
$('#openChat').onclick=()=>{panel.classList.remove('hidden');refreshChats()};
$('#closeChat').onclick=()=>panel.classList.add('hidden');
// ---- logout: server clears the HttpOnly cookie; client resets identity + greeting flag
async function doLogout(){try{await api('/api/auth/logout',{method:'POST'})}catch(e){}
 try{sessionStorage.removeItem('era_greeted')}catch{}
 stopSpeak();
 ME=null;stopLife();showWho();show('auth');
 chatLog.innerHTML='';convTags.innerHTML='';convList=[];activeConv='today';panel.classList.add('hidden')}
$('#logout').onclick=doLogout;
$('#demoBtn').onclick=async()=>{const m=$('#authMsg');m.className='authmsg';m.textContent='Signing in with demo account…';
 if(await loadMe()||await demoLogin(($('#persona')||{}).value||'doctorA'))showApp();
 else{m.className='authmsg err';m.textContent='Demo login unavailable — please use the email form.'}};
// ---- startup: valid session → straight into the workspace (greeting fires once per session)
(async()=>{if(await loadMe())showApp();else show('auth')})();
// ---- settings
const sd=$('#set');$('#openSet').onclick=()=>{$('#sName').value=S.name;$('#sVoice').checked=S.voice;$('#sGreet').checked=S.greet;loadVoices();sd.showModal()};
$('#save').onclick=()=>{S={name:$('#sName').value.trim(),voice:$('#sVoice').checked,greet:$('#sGreet').checked,ttsVoice:$('#sVoiceSel')?$('#sVoiceSel').value:S.ttsVoice};save(KEY.set,S)};
