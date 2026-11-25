// Small shared helpers: crypto, responses, D1 rate counters.
const enc = new TextEncoder();
export const now = () => Date.now();

export function randomHex(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return b64url(b);
}
export function b64url(buf) {
  let s = ''; const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export async function sha256(s) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// compact signed ticket: b64url(json).b64url(hmac)
export async function signTicket(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64url(sig);
}
export async function verifyTicket(secret, ticket) {
  if (typeof ticket !== 'string' || ticket.length > 1024) return null;
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!p.exp || p.exp < now()) return null;
    return p;
  } catch { return null; }
}
// constant-time-ish compare for short strings
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function cors(req, env) {
  const o = req.headers.get('Origin');
  const allowed = originAllowed(o, env);
  return allowed ? {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  } : {};
}
export function originAllowed(o, env) {
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !!o && list.includes(o);
}
const SEC = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SEC, ...extra } });
}
export const err = (code, status = 400, extra = {}) => json({ error: code }, status, extra);

// fixed-window counter in D1: returns true while under `limit` per `windowMs`
export async function rateOk(db, key, limit, windowMs) {
  const t = now();
  const row = await db.prepare(
    `INSERT INTO rate (k, n, reset) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN rate.reset < ?3 THEN 1 ELSE rate.n + 1 END,
       reset = CASE WHEN rate.reset < ?3 THEN ?2 ELSE rate.reset END
     RETURNING n`
  ).bind(key, t + windowMs, t).first();
  return (row?.n ?? 1) <= limit;
}

export async function readJson(req, max = 2048) {
  const len = +(req.headers.get('Content-Length') || 0);
  if (len > max) return null;
  const txt = await req.text();
  if (txt.length > max) return null;
  try { const v = JSON.parse(txt); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
