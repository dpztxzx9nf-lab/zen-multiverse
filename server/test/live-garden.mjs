// Live (wrangler dev): two players in Xenia's Home Valley (the old shared garden, now the hub frame). A's catch at
// the cove is a real fish in A's hands; both see the hares and the fox. (Building there: server/test/xenia.mjs.) Needs `wrangler dev` with a fresh local state (auth rate limits).
import { SHARED_HOME } from '../../js/spawn.js';
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
// the cove and the animals are out in the valley: each player comes in once (seated at the spawn), leaves, and after
// the 10 s rejoin window comes back where the test needs them (the first pose of a rejoin is taken as given)
for (const P of [A, B]) { const c0 = await connect((await api('/ticket', { world: SHARED_HOME }, P.token)).ticket); await hi(c0); c0.ws.close(); }
await sleep(10500);
const { COVE } = await import('../../js/cove.js'); const { HOMES } = await import('../../js/fauna.js');
const hare = HOMES.find((h) => h.sp === 'hare');
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); await hi(ca); ca.x = COVE.x + 1; ca.z = COVE.z - COVE.b - 3;
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); await hi(cb); cb.x = hare.x + 6; cb.z = hare.z + 4;
for (const c of [ca, cb]) { c.seq++; c.ws.send(JSON.stringify({ t: 'p', x: c.x, y: 0, z: c.z, yaw: 0, s: c.seq })); }
await sleep(500);
ok(!gk(ca, 'builds').length, 'hello: no old garden builds list any more (world builds instead)');
// fishing at the cove
await walk(ca, COVE.x, COVE.z - COVE.b - 1.5);
g(ca, { k: 'catch' }); await sleep(700);
ok(gk(ca, 'fishok').length === 1, 'a catch at the cove is accepted');
const items = ca.msgs.filter((m) => m.t === 'g' && m.k === 'items').at(-1);
ok(items && JSON.stringify(items).includes('fish'), 'and the fish is a real object the server shows');
await walk(cb, hare.x + 3, hare.z + 6); await walk(ca, COVE.x + 2, COVE.z - COVE.b - 2);
// the garden animals (server/src/fauna.js): sent to both while people move, and a spear thrust from afar does nothing
const fa = gk(ca, 'fauna'), fb = gk(cb, 'fauna');
ok(fa.length > 1 && fb.length > 5 && fb[0].a.length === 6, `both players see the hares and the fox (${fa.length} / ${fb.length} updates)`);
const moved = fb[0].a.some((r, i) => { const l = fb.at(-1).a[i]; return Math.hypot(r[2] - l[2], r[3] - l[3]) > 0.3; });
ok(moved, 'and they move about on their own');
const far = fa.at(-1).a.find((r) => r[5] !== 'dead' && Math.hypot(r[2] - ca.x, r[3] - ca.z) > 5);
g(ca, { k: 'fhit', id: far[0] }); await sleep(500);
ok((gk(ca, 'fres').at(-1) || {}).why === 'far', 'a thrust from ' + Math.hypot(far[2] - ca.x, far[3] - ca.z).toFixed(0) + ' m away is refused');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
