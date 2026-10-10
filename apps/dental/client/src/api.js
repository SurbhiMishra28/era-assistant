// api.js — one fetch wrapper: cookies ride along, JSON always, 401 → login redirect.
const base = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8100` : '';
async function call(path, opts = {}) {
  const res = await fetch(base + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/auth/me' &&
      !location.hash.startsWith('#/login') && !path.startsWith('/api/auth/login')) {
    location.hash = '#/login';
  }
  return { status: res.status, data };
}
export const api = {
  get: p => call(p),
  post: (p, body) => call(p, { method: 'POST', body: JSON.stringify(body || {}) }),
  patch: (p, body) => call(p, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  del: p => call(p, { method: 'DELETE' })
};
