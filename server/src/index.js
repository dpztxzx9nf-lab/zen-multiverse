// Zen Multiverse multiplayer Worker: accounts (email code), sessions, friends, invites, block/report,
// signed one-minute world tickets, and the WebSocket gateway into one World Durable Object per world/shard.
import { json, err, cors, originAllowed, readJson, rateOk, randomHex, randomToken, sha256, signTicket, verifyTicket, safeEqual, now } from './util.js';
import { cleanName } from './filter.js';
import { parseWorld, SHARDS, WORLD_OWNER, SHARED_HOME, SHARED_MOON } from './worlds.js';
import { PROTOCOL } from './protocol.js';
export { World } from './world.js';

const DAY = 864e5;
const SESSION_TTL = 180 * DAY; // sign in once: sliding, renewed on use (logout or a new device code ends it)
const isLocal = (url) => { const h = (url.hostname || '').replace(/^\[|\]$/g, ''); return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h.startsWith('127.') || h.endsWith('.localhost') || h.endsWith('.local'); };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const ch = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: originAllowed(req.headers.get('Origin'), env) ? 204 : 403, headers: ch });
    try {
      const r = await route(req, env, url, ctx);
      if (r.webSocket) return r; // upgrade responses keep their own headers
      const h = new Headers(r.headers); for (const [k, v] of Object.entries(ch)) h.set(k, v);
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) {
      console.error('[mp] ' + (e && e.stack || e));
      return err('server', 500, ch);
    }
  },
};

async function route(req, env, url, ctx) {
  const p = url.pathname, M = req.method;
  const ip = req.headers.get('CF-Connecting-IP') || '127.0.0.1';
  if (p === '/health') return json({ ok: true, t: now(), proto: PROTOCOL });
  if (p === '/deploy-soon' && M === 'POST') return deploySoon(req, env);
  if (p === '/config' && M === 'GET') return json({ turnstileSitekey: env.TURNSTILE_SITEKEY });
  if (p === '/ws') return gateway(req, env, url);
  // everything else is JSON POST/GET from an allowed origin (browsers) or a native client
  const origin = req.headers.get('Origin');
  if (origin && !originAllowed(origin, env)) return err('origin', 403);
  if (!(await rateOk(env.DB, 'ip:' + ip, 300, 60e3))) return err('slow_down', 429);

  const jm = /^\/j\/([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\/?$/.exec(p);
  if (jm && M === 'GET') return (await rateOk(env.DB, 'jpage:' + ip, 60, 36e5)) ? joinPage(env, jm[1].replace('-', '').toUpperCase()) : err('slow_down', 429);

  if (p === '/auth/start' && M === 'POST') return authStart(req, env, url, ip);
  if (p === '/auth/verify' && M === 'POST') return authVerify(req, env, ip);

  const me = await session(req, env);
  if (!me) return err('signin', 401);
  if (me.banned_until > now()) return err('banned', 403);
  const body = M === 'POST' ? (await readJson(req)) || {} : {};

  switch (p) {
    case '/me': return M === 'POST' ? updateMe(env, me, body) : json(pub(me, true));
    case '/auth/logout': await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me._th).run(); return json({ ok: true });
    case '/friends': return listFriends(env, me);
    case '/friends/request': return friendRequest(env, me, body);
    case '/friends/respond': return friendRespond(env, me, body);
    case '/friends/remove': return friendRemove(env, me, body);
    case '/block': return block(env, me, body, true);
    case '/unblock': return block(env, me, body, false);
    case '/report': return report(env, me, body);
    case '/invite': return makeInvite(env, me, body);
    case '/invite/redeem': return redeemInvite(env, me, body);
    case '/join-friend': return joinFriend(env, me, body);
    case '/visit': return visitHome(env, me, body);
    case '/search': return searchPlayers(env, me, body);
    case '/ticket': return ticket(env, me, body);
  }
  return err('not_found', 404);
}

const pub = (a, self = false) => ({ id: a.id, name: a.name, tag: a.tag, ...(self ? { allowJoin: a.allow_join } : {}) });
const normEmail = (e) => String(e || '').trim().toLowerCase();
const emailOk = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const emailHash = (env, e) => sha256((env.EMAIL_PEPPER || '') + '|' + e);

async function turnstileOk(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const fd = new FormData();
  fd.append('secret', env.TURNSTILE_SECRET || ''); fd.append('response', token); fd.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}

async function sendCode(env, url, email, code) {
  if (env.LOCAL_DEV === '1' || env.MAIL_MODE === 'dev') { console.log(`[mp dev mail] code for ${email.replace(/(.).*@/, '$1***@')}: ${code}`); return { dev: true }; }
  // Production: Cloudflare Email Service binding (send_email) on the game's domain.
  if (env.EMAIL && env.EMAIL.send) {
    const from = env.MAIL_FROM || 'Zen Multiverse <noreply@thinkcore.io>';
    const named = /^(.*) <([^>]+)>$/.exec(from);
    await env.EMAIL.send({
      to: email,
      from: named ? { name: named[1].trim(), email: named[2].trim() } : from,
      subject: `Your Zen Multiverse code: ${code}`,
      text: `Your sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
    });
    return {};
  }
  throw new Error('mail not configured');
}

async function authStart(req, env, url, ip) {
  const b = await readJson(req);
  if (!b) return err('bad_request');
  const email = normEmail(b.email);
  if (!emailOk(email)) return err('email');
  const eh = await emailHash(env, email);
  if (!(await rateOk(env.DB, 'start-ip:' + ip, 10, 36e5)) || !(await rateOk(env.DB, 'start-em:' + eh, 5, 36e5))) return err('slow_down', 429);
  if (!(await turnstileOk(env, b.turnstile, ip))) return err('turnstile', 403);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
  const ch = await sha256(eh + '|' + code);
  await env.DB.prepare(`INSERT INTO login_codes (email_hash, code_hash, expires, attempts) VALUES (?1, ?2, ?3, 0)
    ON CONFLICT(email_hash) DO UPDATE SET code_hash = ?2, expires = ?3, attempts = 0`).bind(eh, ch, now() + 10 * 60e3).run();
  const sent = await sendCode(env, url, email, code);
  const exists = !!(await env.DB.prepare('SELECT 1 FROM accounts WHERE email_hash = ?').bind(eh).first());
  // the dev code only ever comes back on a localhost dev server (MAIL_MODE=dev); never in production
  return json({ ok: true, newAccount: !exists, ...(sent.dev ? { devCode: code } : {}) });
}

async function authVerify(req, env, ip) {
  const b = await readJson(req);
  if (!b) return err('bad_request');
  const email = normEmail(b.email);
  if (!emailOk(email) || !/^\d{6}$/.test(String(b.code || ''))) return err('code');
  const eh = await emailHash(env, email);
  if (!(await rateOk(env.DB, 'verify-ip:' + ip, 30, 36e5))) return err('slow_down', 429);
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email_hash = ?').bind(eh).first();
  if (!row || row.expires < now() || row.attempts >= 5) return err('code_expired', 401);
  await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email_hash = ?').bind(eh).run();
  if (!safeEqual(row.code_hash, await sha256(eh + '|' + b.code))) return err('code', 401);
  await env.DB.prepare('DELETE FROM login_codes WHERE email_hash = ?').bind(eh).run();
  let acct = await env.DB.prepare('SELECT * FROM accounts WHERE email_hash = ?').bind(eh).first();
  if (!acct) {
    const name = cleanName(b.name);
    if (!name) return err('name');
    const id = randomHex(16);
    let tag;
    for (let i = 0; i < 8; i++) {
      tag = String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
      const r = await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, email_hash, name, tag, created) VALUES (?, ?, ?, ?, ?)').bind(id, eh, name, tag, now()).run();
      if (r.meta.changes) break;
    }
    acct = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
    if (!acct) return err('name_taken', 409);
  }
  if (acct.banned_until > now()) return err('banned', 403);
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, created, expires, ua) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), acct.id, now(), now() + SESSION_TTL, String(req.headers.get('User-Agent') || '').slice(0, 120)).run();
  return json({ token, account: pub(acct, true) });
}

async function session(req, env) {
  const h = req.headers.get('Authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(h);
  if (!m) return null;
  const th = await sha256(m[1]);
  const row = await env.DB.prepare('SELECT a.*, s.expires AS s_exp FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?').bind(th).first();
  if (!row || row.s_exp < now()) return null;
  // sliding expiry, refreshed at most once a day
  if (row.s_exp - now() < SESSION_TTL - DAY) await env.DB.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?').bind(now() + SESSION_TTL, th).run();
  row._th = th;
  return row;
}

async function updateMe(env, me, b) {
  if (b.name != null) {
    const n = cleanName(b.name); if (!n) return err('name');
    await env.DB.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(n, me.id).run(); me.name = n;
  }
  if (b.allowJoin != null) {
    if (!['friends', 'invite', 'nobody'].includes(b.allowJoin)) return err('allow_join');
    await env.DB.prepare('UPDATE accounts SET allow_join = ? WHERE id = ?').bind(b.allowJoin, me.id).run(); me.allow_join = b.allowJoin;
  }
  return json(pub(me, true));
}

const ONLINE_MS = 120e3;
async function listFriends(env, me) {
  const rows = (await env.DB.prepare(`SELECT f.b AS id, f.status, a.name, a.tag, p.world, p.updated FROM friends f JOIN accounts a ON a.id = f.b
    LEFT JOIN presence p ON p.account_id = f.b WHERE f.a = ?`).bind(me.id).all()).results;
  const incoming = (await env.DB.prepare(`SELECT f.a AS id, a.name, a.tag FROM friends f JOIN accounts a ON a.id = f.a WHERE f.b = ? AND f.status = 'pending'`).bind(me.id).all()).results;
  const t = now();
  return json({
    friends: rows.filter((r) => r.status === 'accepted').map((r) => ({ id: r.id, name: r.name, tag: r.tag, online: !!(r.world && t - r.updated < ONLINE_MS), where: r.world ? r.world.split(':')[0] : null })),
    outgoing: rows.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, name: r.name, tag: r.tag })),
    incoming,
  });
}
async function isBlocked(env, a, b) {
  return !!(await env.DB.prepare('SELECT 1 FROM blocks WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(a, b).first());
}
async function friendRequest(env, me, b) {
  if (!(await rateOk(env.DB, 'freq:' + me.id, 30, 36e5))) return err('slow_down', 429);
  const name = cleanName(b.name), tag = String(b.tag || '');
  if (!name || !/^\d{4}$/.test(tag)) return err('who');
  const t = await env.DB.prepare('SELECT * FROM accounts WHERE name = ? AND tag = ?').bind(name, tag).first();
  // same answer whether or not the account exists or has blocked you (no probing)
  if (!t || t.id === me.id || (await isBlocked(env, me.id, t.id))) return json({ ok: true });
  const back = await env.DB.prepare('SELECT status FROM friends WHERE a = ? AND b = ?').bind(t.id, me.id).first();
  if (back && back.status === 'pending') return acceptPair(env, me.id, t.id);
  await env.DB.prepare(`INSERT OR IGNORE INTO friends (a, b, status, created) VALUES (?, ?, 'pending', ?)`).bind(me.id, t.id, now()).run();
  return json({ ok: true });
}
async function acceptPair(env, a, b) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO friends (a, b, status, created) VALUES (?1, ?2, 'accepted', ?3) ON CONFLICT(a, b) DO UPDATE SET status = 'accepted'`).bind(a, b, now()),
    env.DB.prepare(`INSERT INTO friends (a, b, status, created) VALUES (?2, ?1, 'accepted', ?3) ON CONFLICT(a, b) DO UPDATE SET status = 'accepted'`).bind(a, b, now()),
  ]);
  return json({ ok: true, friends: true });
}
async function friendRespond(env, me, b) {
  const id = String(b.id || '');
  const req = await env.DB.prepare(`SELECT 1 FROM friends WHERE a = ? AND b = ? AND status = 'pending'`).bind(id, me.id).first();
  if (!req) return err('no_request', 404);
  if (b.accept) return acceptPair(env, me.id, id);
  await env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(id, me.id).run();
  return json({ ok: true });
}
async function friendRemove(env, me, b) {
  const id = String(b.id || '');
  await env.DB.prepare('DELETE FROM friends WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(me.id, id).run();
  return json({ ok: true });
}
async function block(env, me, b, on) {
  const id = String(b.id || '');
  if (!/^[0-9a-f]{32}$/.test(id) || id === me.id) return err('who');
  if (on) {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO blocks (a, b, created) VALUES (?, ?, ?)').bind(me.id, id, now()),
      env.DB.prepare('DELETE FROM friends WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(me.id, id),
    ]);
  } else await env.DB.prepare('DELETE FROM blocks WHERE a = ? AND b = ?').bind(me.id, id).run();
  // tell the world I'm in right now, so it applies at once
  // apply it at once in whichever worlds either of them is in right now
  const prs = (await env.DB.prepare('SELECT DISTINCT world FROM presence WHERE account_id IN (?, ?) AND world IS NOT NULL').bind(me.id, id).all()).results;
  await Promise.all(prs.map((r) => env.WORLD.getByName(r.world).setBlock(me.id, id, on).catch(() => {})));
  return json({ ok: true });
}
async function report(env, me, b) {
  if (!(await rateOk(env.DB, 'report:' + me.id, 20, DAY))) return err('slow_down', 429);
  const id = String(b.id || ''), reason = String(b.reason || '').slice(0, 40);
  if (!/^[0-9a-f]{32}$/.test(id) || !['chat', 'name', 'cheating', 'harassment', 'other'].includes(reason)) return err('report');
  let context = null;
  const pr = await env.DB.prepare('SELECT world FROM presence WHERE account_id = ?').bind(me.id).first();
  if (pr && pr.world) context = await env.WORLD.getByName(pr.world).chatContext(id).catch(() => null);
  await env.DB.prepare('INSERT INTO reports (reporter, target, reason, world, context, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(me.id, id, reason, pr ? pr.world : null, context ? JSON.stringify(context).slice(0, 8000) : null, now()).run();
  return json({ ok: true });
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function inviteCode() { const b = crypto.getRandomValues(new Uint8Array(8)); return [...b].map((x) => B32[x & 31]).join(''); }
async function makeInvite(env, me, b) {
  if (!(await rateOk(env.DB, 'inv:' + me.id, 20, DAY))) return err('slow_down', 429);
  // an invite is to the shared server; the joiner spawns next to whoever sent it (or at the world spawn)
  const world = b.kind === 'moon' ? SHARED_MOON : SHARED_HOME;
  const code = inviteCode();
  await env.DB.prepare('INSERT INTO invites (code, owner, world, expires, uses_left) VALUES (?, ?, ?, ?, 10)').bind(code, me.id, world, now() + DAY).run();
  return json({ code, expires: now() + DAY, world });
}
async function redeemInvite(env, me, b) {
  if (!(await rateOk(env.DB, 'redeem:' + me.id, 20, 36e5))) return err('slow_down', 429);
  const code = String(b.code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== 8) return err('invite');
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first();
  if (!inv || inv.expires < now() || inv.uses_left <= 0) return err('invite', 404);
  const world = inv.world.startsWith('moon:') ? SHARED_MOON : SHARED_HOME; // old per-player invites land on the server too
  if (inv.owner === me.id) return json({ world, host: pub(me) });
  if (await isBlocked(env, me.id, inv.owner)) return err('invite', 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?').bind(code),
    env.DB.prepare('INSERT INTO invite_grants (account_id, owner, expires) VALUES (?1, ?2, ?3) ON CONFLICT(account_id, owner) DO UPDATE SET expires = ?3').bind(me.id, inv.owner, now() + DAY),
  ]);
  const host = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(inv.owner).first();
  return json({ world, host: pub(host), near: inv.owner });
}
async function joinFriend(env, me, b) {
  const id = String(b.id || '');
  const f = await env.DB.prepare(`SELECT 1 FROM friends WHERE a = ? AND b = ? AND status = 'accepted'`).bind(me.id, id).first();
  if (!f) return err('not_friends', 403);
  const pr = await env.DB.prepare('SELECT world, updated FROM presence WHERE account_id = ?').bind(id).first();
  if (!pr || !pr.world || now() - pr.updated > ONLINE_MS) return err('offline', 404);
  const world = pr.world.split('#')[0];
  if (!(await mayEnter(env, me, parseWorld(world)))) return err('closed', 403);
  const host = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  return json({ world, host: pub(host), near: id, shard: pr.world.includes('#') ? +pr.world.split('#')[1] : 0 });
}

// visit a friend's home any time (their garden is an always-on world; they don't have to be online)
async function visitHome(env, me, b) {
  const id = String(b.id || ''); const kind = b.kind === 'moon' ? 'moon' : 'home';
  if (!/^[0-9a-f]{32}$/.test(id)) return err('who');
  const w = parseWorld(kind === 'moon' ? SHARED_MOON : SHARED_HOME); // one shared world: "visit" is just joining it
  const host = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  return json({ world: w.key, host: pub(host) });
}
// find players by name (prefix, 3+ chars) to send a friend request; blocked pairs never show up
async function searchPlayers(env, me, b) {
  if (!(await rateOk(env.DB, 'search:' + me.id, 30, 60e3))) return err('slow_down', 429);
  const q = cleanName(b.q);
  if (!q || q.length < 3) return json({ players: [] });
  const rows = (await env.DB.prepare(`SELECT a.id, a.name, a.tag, p.world, p.updated FROM accounts a LEFT JOIN presence p ON p.account_id = a.id
    WHERE a.name LIKE ?1 ESCAPE '\\' AND a.id != ?2 AND a.banned_until < ?3
      AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.a = ?2 AND k.b = a.id) OR (k.a = a.id AND k.b = ?2))
    ORDER BY a.name LIMIT 10`).bind(q.replace(/[%_\\]/g, '\\$&') + '%', me.id, now()).all()).results;
  const t = now();
  return json({ players: rows.map((r) => ({ id: r.id, name: r.name, tag: r.tag, online: !!(r.world && t - r.updated < ONLINE_MS) })) });
}

async function mayEnter(env, me, w) {
  if (!w) return false;
  if (w.kind === 'planet' || w.owner === me.id || w.owner === WORLD_OWNER) return true;
  if (await isBlocked(env, me.id, w.owner)) return false;
  const owner = await env.DB.prepare('SELECT allow_join FROM accounts WHERE id = ?').bind(w.owner).first();
  if (!owner || owner.allow_join === 'nobody') return false;
  const grant = await env.DB.prepare('SELECT 1 FROM invite_grants WHERE account_id = ? AND owner = ? AND expires > ?').bind(me.id, w.owner, now()).first();
  if (grant) return true;
  if (owner.allow_join !== 'friends') return false;
  return !!(await env.DB.prepare(`SELECT 1 FROM friends WHERE a = ? AND b = ? AND status = 'accepted'`).bind(me.id, w.owner).first());
}

async function ticket(env, me, b) {
  if (!(await rateOk(env.DB, 'ticket:' + me.id, 30, 60e3))) return err('slow_down', 429);
  const w = parseWorld(b.world);
  if (!w) return err('world');
  if (!(await mayEnter(env, me, w))) return err('closed', 403);
  const pref = Number.isInteger(b.shard) && b.shard >= 0 && b.shard < SHARDS ? b.shard : 0;
  const muted = me.chat_muted_until > now();
  const near = typeof b.near === 'string' && /^[0-9a-f]{32}$/.test(b.near) && b.near !== me.id ? b.near : null; // spawn next to them if they're here
  const t = await signTicket(env.TICKET_KEY, { aid: me.id, name: me.name, tag: me.tag, world: w.key, shard: pref, muted, resume: b.resume === true, near, jti: randomHex(12), exp: now() + 60e3 });
  return json({ ticket: t });
}

// WebSocket gateway: Origin allow-list (stops cross-site socket hijacking), signed ticket, then the World DO.
function deployAllowed(req, env) {
  if (env.LOCAL_DEV === '1' || env.MAIL_MODE === 'dev') return true;
  const h = req.headers.get('Authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!(env.TICKET_KEY && tok && safeEqual(tok, env.TICKET_KEY));
}

// Tell every recently occupied world that an update is coming, flush lastpos, and close sockets
// with 1012 so clients auto-reconnect (no Reconnect click, no lost progress).
async function deploySoon(req, env) {
  if (!deployAllowed(req, env)) return err('signin', 401);
  const rows = (await env.DB.prepare('SELECT DISTINCT world FROM presence WHERE world IS NOT NULL AND updated > ?').bind(now() - 15 * 60e3).all()).results || [];
  const keys = new Set([SHARED_HOME, SHARED_MOON, ...rows.map((r) => r.world).filter(Boolean)]);
  const worlds = [];
  for (const k of keys) {
    try { worlds.push({ world: k, ...(await env.WORLD.getByName(k).warnUpdate()) }); }
    catch (e) { worlds.push({ world: k, error: String(e && e.message || e) }); }
  }
  return json({ ok: true, proto: PROTOCOL, worlds });
}

async function gateway(req, env, url) {
  if (req.headers.get('Upgrade') !== 'websocket') return err('upgrade', 426);
  const origin = req.headers.get('Origin');
  if (origin && !originAllowed(origin, env)) return err('origin', 403);
  const tk = await verifyTicket(env.TICKET_KEY, url.searchParams.get('ticket'));
  if (!tk) return err('ticket', 401);
  const w = parseWorld(tk.world);
  if (!w) return err('world', 400);
  const shards = w.kind === 'planet' ? SHARDS : 1;
  const blocks = (await env.DB.prepare('SELECT b AS id FROM blocks WHERE a = ?1 UNION SELECT a AS id FROM blocks WHERE b = ?1').bind(tk.aid).all()).results.map((r) => r.id).slice(0, 300);
  const fwd = new Headers(req.headers);
  fwd.set('X-Zen-Ticket', JSON.stringify({ ...tk, blocks }));
  for (let i = 0; i < shards; i++) {
    const s = (tk.shard + i) % shards;
    const name = shards > 1 ? `${w.key}#${s}` : w.key;
    fwd.set('X-Zen-World', name);
    const res = await env.WORLD.getByName(name).fetch(new Request(req.url, { headers: fwd }));
    if (res.status !== 409) return res; // 409 = shard full, try the next one
  }
  return err('full', 503);
}

// ---- one-click invite page: play.thinkcore.io/j/CODE
// Opens the desktop app through zenmultiverse://join/CODE; if the app isn't installed, offers the
// download. Read-only: the invite is only used when the signed-in app redeems it (same checks as before).
const DOWNLOAD = 'https://github.com/dpztxzx9nf-lab/zen-multiverse/releases/latest';
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function joinPage(env, code) {
  const inv = await env.DB.prepare('SELECT i.expires, i.uses_left, a.name FROM invites i JOIN accounts a ON a.id = i.owner WHERE i.code = ?').bind(code).first();
  const live = inv && inv.expires > now() && inv.uses_left > 0;
  const who = live ? esc(inv.name) : null;
  const app = `zenmultiverse://join/${code}`;
  const pretty = code.slice(0, 4) + '-' + code.slice(4);
  const body = live ? `
<h1>${who} invited you to Zen Multiverse</h1>
<p class="lead">Opening the game&hellip; you'll join the server and spawn next to ${who} if they're playing (otherwise at the spawn in the garden).</p>
<a class="btn" href="${app}">Open Zen Multiverse</a>
<div class="box">
  <b>Don't have it yet?</b>
  <ol><li><a href="${DOWNLOAD}">Download Zen Multiverse</a> (free; Windows, Mac or Linux) and install it.</li>
  <li>Come back to this page and press <b>Open Zen Multiverse</b>.</li>
  <li>First time only: type your email, then the 6-digit code we send you. After that you stay signed in.</li></ol>
  <p class="muted">Or in the game: Play together &rarr; "Have a code?" &rarr; <b>${pretty}</b></p>
</div>
<p class="muted">This link works for 24 hours.</p>` : `
<h1>This invite has expired</h1>
<p class="lead">Invite links last 24 hours. Ask your friend to send a fresh one from Play together &rarr; Invite.</p>
<a class="btn" href="${DOWNLOAD}">Get Zen Multiverse</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Join on Zen Multiverse</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121820;color:#f3eee4;font:16px/1.5 system-ui,sans-serif}
main{max-width:480px;padding:28px}h1{font-size:26px;margin:0 0 8px}.lead{color:#c9d6c4}.muted{color:#9aa7a0;font-size:14px}
.btn{display:inline-block;background:#6f9a78;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;margin:12px 0}
.box{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;margin-top:14px}ol{padding-left:20px;margin:8px 0}a{color:#a8d8b0}</style></head>
<body><main>${body}</main>${live ? `<script>setTimeout(function(){location.href=${JSON.stringify(app)}},300)</script>` : ''}</body></html>`;
  return new Response(html, { status: live ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' } });
}
