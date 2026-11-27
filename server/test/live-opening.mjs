// Live (wrangler dev, LOCAL_DEV=1, fresh state): Ula's opening walk is retired.
// Talking to her must not start a site/quest or send {k:'open'}.
// Usage: MP=http://127.0.0.1:8797 node server/test/live-opening.mjs
import { SHARED_HOME, GARDEN_ARRIVAL } from '../../js/spawn.js';
import { walkTo, walkPlanet, fromHello } from './garden-walk.mjs';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0 }; ws.onmessage = (e) => { try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 80 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const gk = (c, k) => c.msgs.filter((m) => m.t === 'g' && m.k === k);

const A = await signIn('opena', 'Brock'), B = await signIn('openb', 'Cousin');
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); fromHello(ca, await hi(ca));
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); fromHello(cb, await hi(cb));
await walkTo(ca, GARDEN_ARRIVAL.x, GARDEN_ARRIVAL.z, sleep);
await walkTo(cb, GARDEN_ARRIVAL.x + 1.6, GARDEN_ARRIVAL.z, sleep);
await sleep(400);
const hello = gk(ca, 'hello')[0];
ok(hello && hello.open == null, 'hello does not carry an opening step');
const kp = hello.keeper || (gk(ca, 'keeper').at(-1) || {}).keeper;
if (kp) {
  await Promise.all([walkPlanet(ca, kp.x + 1.5, kp.z, sleep), walkPlanet(cb, kp.x + 3.5, kp.z, sleep)]);
  g(ca, { k: 'talk' }); await sleep(600);
}
ok(gk(ca, 'open').length === 0 && gk(cb, 'open').length === 0, 'talking to Ula does not start the old opening walk');
ok(!(gk(ca, 'npc').at(-1) || { text: '' }).text.includes('driftwood'), 'she does not ask newcomers to gather driftwood');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
