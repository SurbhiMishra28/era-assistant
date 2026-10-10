// server/services/audit.js — every security-relevant touch leaves a row (best-effort).
'use strict';
const { db } = require('../db/connection');

function audit(userId, dentistId, action, tool, reqId, ok, detail, resource, resourceId) {
  try {
    db.prepare(`INSERT INTO assistant_audit(user_id,dentist_id,action,tool_name,request_id,success,detail,resource,resource_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(userId ?? null, dentistId ?? null, String(action).slice(0, 80), tool || null, reqId || null,
        ok ? 1 : 0, detail ? String(detail).slice(0, 300) : null, resource || null, resourceId ?? null);
  } catch {} // audit must never break the request
}

module.exports = { audit };
