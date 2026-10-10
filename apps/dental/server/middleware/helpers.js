// server/middleware/helpers.js — small shared route helpers.
'use strict';
const crypto = require('crypto');
const rid = () => crypto.randomBytes(6).toString('hex');
const json = (res, code, obj, extra) => { res.status(code).json(obj); };
const readBodyJson = (req, res, cb) => { try { cb(req.body || {}); } catch (e) { next500(res, e, rid()); } };
const next500 = (res, e, reqId) => {
  const code = e.status && Number.isInteger(e.status) ? e.status : 500;
  if (code >= 500) console.error(reqId, e);
  res.status(code).json({ ok: false, error: e.err || 'SERVER_ERROR', request_id: reqId,
    message: code >= 500 ? 'Something went wrong on my side. Please try again in a moment.' : e.message });
};
// wrap an async/sync handler so thrown httpErrs become clean status codes
const h = fn => (req, res) => {
  const reqId = rid();
  try { const out = fn(req, res, reqId); if (out && typeof out.catch === 'function') out.catch(e => next500(res, e, reqId)); }
  catch (e) { next500(res, e, reqId); }
};

module.exports = { rid, json, readBodyJson, next500, h };
