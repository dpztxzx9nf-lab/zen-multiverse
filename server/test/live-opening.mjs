// Live (wrangler dev, LOCAL_DEV=1, fresh state): two new players walk Ula's opening together through the real
// server systems: she starts it for both, they take driftwood, make a spear, catch a fish at the cove, stand two
// pieces up by the water and hand the fish to Ivo's camp. Usage: MP=http://127.0.0.1:8797 node server/test/live-opening.mjs
import { SHARED_HOME, GARDEN_ARRIVAL } from '../../js/spawn.js';
import { NODES } from '../../js/places.js';
import { COVE } from '../../js/cove.js';
import { pos } from '../../js/factions/sim.js';
import { GARDEN_FIXTURES } from '../src/storage.js';
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
const step = (c) => { const o = gk(c, 'open').at(-1); return o ? o.step : (gk(c, 'npc').at(-1) || {}).open || 0; };
async function walk(c, tx, tz, y = 0) { // a legal pace: 0.4 m per 100 ms
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) { const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.4, d); c.x += (tx - c.x) / d * s; c.z += (tz - c.z) / d * s; c.seq++; c.ws.send(JSON.stringify({ t: 'p', x: c.x, y, z: c.z, yaw: 0, s: c.seq })); await sleep(100); }
  await sleep(300);
}
const both = (fn) => Promise.all([fn(ca, 0), fn(cb, 1)]);
const A = await signIn('opena', 'Brock'), B = await signIn('openb', 'Cousin');
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); await hi(ca);
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); await hi(cb);
// new players arrive at the city hub; Ula's walk is in the garden
for (const [c, x] of [[ca, GARDEN_ARRIVAL.x], [cb, GARDEN_ARRIVAL.x + 1.6]]) {
  c.x = x; c.z = GARDEN_ARRIVAL.z; c.seq++; c.ws.send(JSON.stringify({ t: 'p', x: c.x, y: 0, z: c.z, yaw: 0, s: c.seq }));
}
await sleep(500);
await sleep(600);
await walk(ca, ca.x + 0.4, ca.z); await sleep(400); // Ula is placed near the first person who moves in a new world
const kp = gk(ca, 'hello')[0].keeper || (gk(ca, 'keeper').at(-1) || {}).keeper;
ok(kp && gk(ca, 'hello')[0].open === null, 'hello: Ula is in the garden and the walk has not started');
await both((c, i) => walk(c, kp.x + 1.5 + i * 2, kp.z));
g(ca, { k: 'talk' }); await sleep(600);
ok(step(ca) === 1 && step(cb) === 1 && /driftwood/.test(gk(ca, 'npc').at(-1).text), 'Ula asks A to gather, and B standing by hears it too');
const d = NODES.find((n) => n.kind === 'drift');
await both((c, i) => walk(c, d.x + 1 + i * 2.5, d.z));
g(ca, { k: 'ntake', id: d.id }); await sleep(600);
ok(gk(ca, 'grant').length >= 1 && step(ca) === 2 && step(cb) === 2, 'A breaks off driftwood: both are asked to make something');
await walk(ca, d.x + 7, d.z + 2); g(ca, { k: 'scraft', r: 'spear', ref: 'away' }); await sleep(500);
ok((gk(ca, 'scraft').at(-1) || {}).ok === false && step(ca) === 2, 'a spear away from a workbench: the server says no');
const bench = GARDEN_FIXTURES.find((f) => f.kind === 'bench');
await both((c, i) => walk(c, bench.x - 1.2 + i * 0.4, bench.z + 1.4 + i * 1.2));
g(ca, { k: 'scraft', r: 'spear', ref: 'bench' }); await sleep(600);
ok((gk(ca, 'scraft').at(-1) || {}).ok === true && step(ca) === 3 && step(cb) === 3, 'A makes a spear at the cove workbench: both move on to fishing');
await both((c, i) => walk(c, 3 + i * 2, -24));
g(ca, { k: 'catch' }); await sleep(700);
ok(gk(ca, 'fishok').length === 1 && step(ca) === 4 && step(cb) === 4, 'a fish from the cove: both are asked to build');
const bx = 3, bz = -22.5;
await walk(ca, bx + 1.2, bz);
g(ca, { k: 'bplace', type: 'floor', mat: 'wood', x: bx, y: 0.1, z: bz, yaw: 0, ref: 'o1' }); await sleep(600);
g(ca, { k: 'bplace', type: 'wall', mat: 'wood', x: bx, y: 1.2, z: bz + 0.9, yaw: 0, ref: 'o2' }); await sleep(600);
ok(gk(ca, 'bput').length >= 2 && step(ca) === 5, `two pieces by the water: A is asked to deliver (${(gk(ca, 'bno').at(-1) || {}).text || 'no refusals'})`);
ok(step(cb) === 5, 'and B, working alongside, too');
// deliver: hand the fish to Ivo (factions.js checks it is in A's hands and the camp asked for it)
ca.ws.send(JSON.stringify({ t: 'fa', k: 'hello' })); await sleep(800);
let view = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'view').at(-1);
for (let i = 0; i < 20 && !view; i++) { await sleep(300); ca.ws.send(JSON.stringify({ t: 'fa', k: 'hello' })); await sleep(300); view = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'view').at(-1); }
const ivo = view && view.view.npcs.find((n) => n.id === 'w-ivo');
ok(!!ivo, 'the camps are there');
let did = null;
for (let tries = 0; tries < 6 && !(did && did.ok); tries++) {
  const p = pos({ trails: {} }, ivo, Date.now() + 2500);
  await walk(ca, p.x + 1.2, p.z);
  ca.ws.send(JSON.stringify({ t: 'fa', k: 'act', act: 'gift-fish', id: 'w-ivo' })); await sleep(900);
  did = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'did').at(-1);
  if (did && !did.ok) { console.log('  gift:', did.why); await sleep(700); }
}
ok(did && did.ok, 'A hands the fish to Ivo' + (did && did.give ? ` (paid ${JSON.stringify(did.give)})` : ''));
await sleep(500);
ok(step(ca) === 6 && /Gather, make, catch/.test(gk(ca, 'open').at(-1).text), 'the walk is done for A');
const board = gk(ca, 'board').at(-1); ok(board && board.board.some((r) => r.aid === A.id && r.quests >= 1), 'and it counts on the board');
g(ca, { k: 'talk' }); await sleep(400);
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
