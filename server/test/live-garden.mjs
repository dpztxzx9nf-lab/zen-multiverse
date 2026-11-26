// Live (wrangler dev): two players in the shared garden. A builds, B sees it; B cannot take it down; A's catch
// at the cove is a real fish in A's hands. Needs `wrangler dev` with a fresh local state (auth rate limits).
import { SHARED_HOME, WORLD_SPAWN } from '../../js/spawn.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0 }; ws.onmessage = (e) => { try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 80 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const gk = (c, k) => c.msgs.filter((m) => m.t === 'g' && m.k === k);
async function walk(c, tx, tz, y = 0) { // a legal pace: 0.4 m per 100 ms
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) { const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.4, d); c.x += (tx - c.x) / d * s; c.z += (tz - c.z) / d * s; c.seq++; c.ws.send(JSON.stringify({ t: 'p', x: c.x, y, z: c.z, yaw: 0, s: c.seq })); await sleep(100); }
  await sleep(300);
}
const A = await signIn('builder', 'Brock'), B = await signIn('cousin', 'Cousin');
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); const ha = await hi(ca); ca.x = ha.resume.x; ca.z = ha.resume.z;
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); const hb = await hi(cb); cb.x = hb.resume.x; cb.z = hb.resume.z;
await sleep(500);
ok(gk(ca, 'builds').length === 1 && Array.isArray(gk(ca, 'builds')[0].list), 'hello: the shared builds list');
await walk(ca, 12, 9.8);
g(ca, { k: 'bplace', type: 'floor', mat: 'wood', x: 12, y: 0.04, z: 12, yaw: 0, ref: 'r1' }); await sleep(600);
const put = gk(cb, 'bput').at(-1);
ok(put && put.p[1] === 'floor' && put.by === A.id && gk(ca, 'bput').at(-1).ref === 'r1', 'A builds a floor and B sees it');
g(ca, { k: 'bplace', type: 'wall', mat: 'wood', x: 12, y: 1.2, z: 11.1, yaw: 0, ref: 'r2' }); await sleep(600);
ok(gk(cb, 'bput').length === 2, 'a wall on the floor');
g(ca, { k: 'bplace', type: 'beam', mat: 'wood', x: 15, y: 4, z: 13, yaw: 0, ref: 'r3' }); await sleep(600);
ok(gk(ca, 'bno').length === 1 && gk(cb, 'bput').length === 2, 'a beam in mid-air is refused');
await walk(cb, 13, 10.5);
g(cb, { k: 'bremove', id: put.p[0] }); await sleep(500);
ok(/Someone else/.test((gk(cb, 'bno').at(-1) || {}).text || ''), 'B cannot take down A\'s floor');
g(ca, { k: 'bremove', id: put.p[0] }); await sleep(600);
const del = gk(cb, 'bdel').at(-1);
ok(del && del.ids[0] === put.p[0] && del.fall.length === 1, 'A takes the floor down and the wall falls for B too');
// fishing at the cove
await walk(ca, 3, -24);
g(ca, { k: 'catch' }); await sleep(700);
ok(gk(ca, 'fishok').length === 1, 'a catch at the cove is accepted');
const items = ca.msgs.filter((m) => m.t === 'g' && m.k === 'items').at(-1);
ok(items && JSON.stringify(items).includes('fish'), 'and the fish is a real object the server shows');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
