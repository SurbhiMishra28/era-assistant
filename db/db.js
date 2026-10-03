// db/db.js — Era's database module (browser + Node dual-export).
// Browser: window.EraDB — bundled seed, ask() hits the server API, findAnswerFallback() keeps the app working offline.
// Node:    module.exports — used by server.js to seed/query the SQLite database.
// The seed below populates SQLite on first server start; see Architecture.md §3-5.
((root,factory)=>{const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.EraDB=m;})(this,()=>{

const VERSION='2.0.0';

// ---- schedule table (seed) — same schema the runtime uses: {time 'HH:MM', type, title}
const seedSchedule=[
 {time:'09:30',type:'appointment',title:'Patient check-up'},
 {time:'11:00',type:'meeting',title:'Team huddle'},
 {time:'14:00',type:'appointment',title:'Follow-up consultation'},
 {time:'16:30',type:'meeting',title:'Weekly review'}
];

// ---- ai_doctor table — 15 Q&A rows. `keywords` drive retrieval (scoreRows below).
const doctorQA=[
 {id:1,q:'What should I do for a fever?',keywords:['fever','temperature','high temp'],
  a:'For a fever, rest and drink plenty of fluids. You can take paracetamol as directed on the label. If your temperature stays above 103 degrees Fahrenheit for more than three days, or you have a stiff neck, rash, or confusion, see a doctor immediately.'},
 {id:2,q:'How do I treat a common cold and cough?',keywords:['cold','cough','sore throat','runny nose'],
  a:'A common cold usually clears in seven to ten days. Drink warm fluids, gargle with salt water, and use steam inhalation for congestion. See a doctor if you have trouble breathing, chest pain, or symptoms lasting more than two weeks.'},
 {id:3,q:'What can I do about headaches?',keywords:['headache','head ache','migraine'],
  a:'For most headaches, rest in a quiet dark room, stay hydrated, and consider a mild pain reliever. Frequent or sudden severe headaches, especially with vision changes or vomiting, need medical attention.'},
 {id:4,q:'How do I manage high blood pressure?',keywords:['blood pressure','bp','hypertension'],
  a:'Manage blood pressure with a low-salt diet, regular exercise, limited alcohol, and prescribed medication taken daily. Get it checked regularly. Readings consistently above 140 over 90 should be reviewed by your doctor.'},
 {id:5,q:'How can I control my blood sugar or diabetes?',keywords:['diabetes','blood sugar','sugar level','sugar'],
  a:'Control diabetes through balanced meals, daily activity, prescribed medication or insulin, and regular sugar monitoring. Watch for excessive thirst, frequent urination, or blurred vision, and have an HbA1c test every three to six months.'},
 {id:6,q:'How much water should I drink every day?',keywords:['water','hydration','dehydrated','drink'],
  a:'Most adults need about eight glasses, or two liters, of water a day, more in hot weather or when exercising. Pale yellow urine is a good sign you are drinking enough.'},
 {id:7,q:'How many hours of sleep do I need?',keywords:['sleep','insomnia','tired','sleepless'],
  a:'Adults need seven to nine hours of sleep. Keep a fixed bedtime, avoid screens and caffeine in the evening, and keep your room dark and cool. Ongoing insomnia is worth discussing with a doctor.'},
 {id:8,q:'How much exercise is recommended?',keywords:['exercise','workout','physical activity','gym','walk'],
  a:'Aim for at least thirty minutes of moderate activity, like brisk walking, on five days a week, plus strength training twice a week. Start slow if you are new, and check with your doctor if you have heart conditions.'},
 {id:9,q:'What does a healthy diet look like?',keywords:['diet','nutrition','healthy food','weight'],
  a:'Fill half your plate with vegetables and fruits, a quarter with whole grains, and a quarter with protein like lentils, fish, or chicken. Limit sugar, fried food, and processed snacks. Small consistent changes beat strict short-term diets.'},
 {id:10,q:'How do I handle stress and anxiety?',keywords:['stress','anxiety','anxious','panic','mental health','depression'],
  a:'For stress, try deep breathing, regular exercise, good sleep, and talking to friends or family. If anxiety or low mood lasts more than two weeks or affects your daily life, please speak to a doctor or counselor. Help works.'},
 {id:11,q:'Can I take antibiotics without a prescription?',keywords:['antibiotic','self medication','medicine without prescription','painkiller'],
  a:'No, antibiotics should only be taken when a doctor prescribes them. Self-medication causes resistance, hides symptoms, and can be harmful. Always finish the full course prescribed, and never share leftover medicines.'},
 {id:12,q:'Are vaccines safe and which do I need?',keywords:['vaccine','vaccination','immunization','flu shot'],
  a:'Vaccines are safe and rigorously tested. Adults should stay current on tetanus boosters every ten years, an annual flu shot, and COVID-19 boosters as recommended. Ask your clinic which ones apply to your age and health conditions.'},
 {id:13,q:'What should I do for back pain?',keywords:['back pain','backache','posture','neck pain'],
  a:'For back pain, keep gently active, apply warmth, and avoid long bed rest. Check your posture and lift with your legs. Numbness, tingling, weakness in the legs, or loss of bladder control needs urgent medical care.'},
 {id:14,q:'How do I deal with allergies?',keywords:['allergy','allergic','sneezing','rash','itching'],
  a:'For allergies, identify and avoid your triggers, use antihistamines for relief, and keep windows closed on high-pollen days. Facial swelling, difficulty breathing, or dizziness after an exposure is an emergency — call for help immediately.'},
 {id:15,q:'What warning signs mean I should see a doctor right away?',keywords:['emergency','urgent','chest pain','when to see a doctor','serious'],
  a:'Seek urgent care for chest pain, trouble breathing, sudden weakness or trouble speaking, severe bleeding, fainting, or thoughts of self-harm. When in doubt, it is always safer to get checked. I can help you book the next available appointment.'}
];

// ---- shared scoring: single words match on word boundaries (prefix when >=4 chars), phrases on substring
const norm=s=>s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').trim();
const scoreRows=(rows,input)=>{
 if(!input)return null;
 const t=norm(input),toks=t.split(/\s+/);let best=null,score=0;
 for(const e of rows){let s=0;
  let ks=[];try{ks=typeof e.keywords==='string'?JSON.parse(e.keywords):(e.keywords||[])}catch{ks=[]}
  for(const k of ks){const n=norm(k);
   if(n.includes(' ')){if(t.includes(n))s+=2}
   else if(toks.some(w=>w===n||(n.length>=4&&w.startsWith(n))))s+=1;
  }
  if(s>score){score=s;best=e}}
 return best?{...best,score}:null;
};
// offline fallback for the browser (same rows shape the API returns)
const findAnswerFallback=input=>{const m=scoreRows(doctorQA,input);return m?{answer:m.a,id:m.id,source:'local-fallback'}:null};
// primary lookup: server API (SQLite) → local fallback when the API is unreachable
const ask=async input=>{try{const r=await fetch('/api/qa?q='+encodeURIComponent(input));if(!r.ok)throw 0;
 const d=await r.json();if(d.found)return{answer:d.answer,id:d.id,source:'sqlite'}}catch(e){}
 return findAnswerFallback(input)};

return {VERSION,meta:{name:'era-sqlite-db',tables:['ai_doctor','schedule'],updatedAt:'2026-10-01'},
        seedSchedule,doctorQA,ask,findAnswerFallback,scoreRows};
});
