// token.js — mint demo JWTs for testing the Era assistant (zero deps, no server start).
// Usage:  node token.js doctorA | doctorB | admin | reception  [overrideDoctorId]
// Then:   curl -H "Authorization: Bearer <token>" http://localhost:8000/api/assistant/me
'use strict';
const {__test}=require('./server.js');
const {mintToken,db}=__test;
const personas={doctorA:'Dr. Sharma',doctorB:'Dr. Verma',admin:'Admin',reception:'Front Desk'};
const who=process.argv[2]||'doctorA';
const name=personas[who];
if(!name){console.error('Unknown persona. Use: '+Object.keys(personas).join(' | '));process.exit(1)}
const u=db.prepare('SELECT u.id,u.name,u.role,d.id did FROM users u LEFT JOIN doctors d ON d.user_id=u.id WHERE u.name=?').get(name);
if(!u){console.error('User not seeded — start the server once first.');process.exit(1)}
const override=process.argv[3]; // e.g. node token.js doctorB 25 — simulate a forged doctorId claim
const t=mintToken(u,override!==undefined?+override:(u.did??null));
console.log(t);
