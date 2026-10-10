// server/index.js — DentEra Express entry (BE1).
// env first → middleware → routes → SPA static → listen :8100.
'use strict';
require('dotenv').config(); // .env beats shell defaults; missing .env is fine (sensible defaults below)
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const expressWantsJson = (req) => (req.headers.accept || '').includes('json') || (req.headers['content-type'] || '').includes('json');

const app = express();
// guard against a junk PORT=0 in the shell env (Era's quirk — .env wins, but a shell-wide PORT=0
// would otherwise bind to a random port); 0/empty both fall back to 8100.
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8100;
const ORIGINS = String(process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8100')
  .split(',').map(s => s.trim());

app.use(cors({ origin: (origin, cb) => cb(null, !origin || ORIGINS.includes(origin)), credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// tiny request id for audit + error echoes
app.use((req, res, next) => { req.requestId = require('crypto').randomBytes(6).toString('hex'); next(); });

app.get('/api/health', (req, res) => {
  const { db } = require('./db/connection');
  res.json({ ok: true, db: 'sqlite', version: require('../package.json').version,
    ai_doctor: db.prepare('SELECT COUNT(*) c FROM ai_doctor').get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c });
});

// ORDER MATTERS: public + assistant + admin routers are mounted BEFORE resources, because resources.js
// has a router-level requireAuth guard that would otherwise 401 every public/assistant call.
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/publicBooking'));
app.use('/api', require('./routes/assistant'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/resources'));

// unknown API path → JSON 404 (never the SPA)
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

// production: serve the built React app (client/dist) with no-cache on html
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { setHeaders: (res, p) => { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// central error handler → uniform JSON
app.use((e, req, res, next) => {
  const code = e.status && Number.isInteger(e.status) ? e.status : 500;
  if (code >= 500) console.error(req.requestId, e);
  if (!expressWantsJson(req) && code >= 500 && !req.path.startsWith('/api')) return res.status(code).send('Server error');
  res.status(code).json({ ok: false, error: e.err || 'SERVER_ERROR', request_id: req.requestId,
    message: code >= 500 ? 'Something went wrong on my side. Please try again in a moment.' : e.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[dentera] listening on http://localhost:${PORT}`));
}

module.exports = { app }; // tests import this
