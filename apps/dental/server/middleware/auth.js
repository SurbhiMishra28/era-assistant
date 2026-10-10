// server/middleware/auth.js — identity comes ONLY from the JWT (cookie or Bearer).
// bcrypt hashing + HS256 JWT (8h) + role guards. Ported from Era's lib/auth.js.
'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'dentera-dev-secret-change-me';
const TOKEN_TTL_S = 8 * 3600;

const mintToken = (user, dentistId) => jwt.sign(
  { sub: user.id, role: user.role, dentistId: dentistId ?? null, name: user.name },
  JWT_SECRET, { expiresIn: TOKEN_TTL_S });

function verifyJWT(req) {
  try {
    const h = req.headers.cookie || '';
    const m = /(?:^|;\s*)dent_token=([^;]*)/.exec(h);
    const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (m && m[1]) || '';
    if (!raw) return null;
    return jwt.verify(raw, JWT_SECRET); // {sub, role, dentistId, name}
  } catch { return null; }
}

const requireAuth = req => {
  const u = verifyJWT(req);
  if (!u) { const e = new Error('Please sign in to use the assistant.'); e.status = 401; e.err = 'AUTH_REQUIRED'; throw e; }
  return u;
};
const requireRole = (...roles) => u => {
  if (!roles.includes(u.role)) { const e = new Error('You are not authorized to access this resource.'); e.status = 403; e.err = 'FORBIDDEN'; throw e; }
  return u;
};
const requireDentist = u => {
  if (u.role !== 'dentist' || u.dentistId == null) { const e = new Error('You are not authorized to access this resource.'); e.status = 403; e.err = 'FORBIDDEN'; throw e; }
  return u.dentistId;
};
const httpErr = (status, err, message) => { const e = new Error(message); e.status = status; e.err = err; return e; };

module.exports = { JWT_SECRET, TOKEN_TTL_S, mintToken, verifyJWT, requireAuth, requireRole, requireDentist, httpErr, bcrypt };
