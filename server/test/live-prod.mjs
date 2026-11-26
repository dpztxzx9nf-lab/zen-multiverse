// LIVE check against the real server (default https://play.thinkcore.io) with two signed-in test accounts.
// Sign-in on the real server needs a real human check and an emailed code, so this reads two existing sessions
// from a local JSON file (never committed): SESS=/path/sessions.json  {"A":{"token":..,"account":{..}},"B":{..}}
// Checks: both see each other as animated players, Ula's walk with partner credit, a camp paying for a fish,
// a shared build that both see and that topples, the hares and fox in sync, a place found and dug, checked by the server.
// It cleans up after itself (takes its pieces down). Usage: SESS=/tmp/s.json node server/test/live-prod.mjs
import fs from 'node:fs';
import { SHARED_HOME } from '../../js/spawn.js';
import { NODES, PLACES } from '../../js/places.js';
import { pos } from '../../js/factions/sim.js';
const BASE = process.env.MP || 'https://play.thinkcore.io';
const WS = BASE.replace(/^http/, 'ws');
const S = JSON.parse(fs.readFileSync(process.env.SESS, 'utf8')); const [KA, KB] = Object.keys(S);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}&b=1`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0 }; ws.onmessage = (e) => { if (e.data === 'pong') return; try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 100 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const gk = (c, k) => c.msgs.filter((m) => m.t === 'g' && m.k === k);
const poses = (c, id) => c.msgs.flatMap((m) => (m.t === 'P' ? m.ps : m.t === 'p' ? [m] : [])).filter((p) => p.id === id);
const step = (c) => { const o = gk(c, 'open').at(-1); return o ? o.step : (gk(c, 'npc').at(-1) || {}).open || 0; };
const LK = 'ZA1.AQRrV_bXwwKMYjlaOiIAAJo7KnpUNOzr5px7XG-KWi9KNuzr5shkPJqWjg';
let mv = { sp: 1.4, g: true, vy: 0, st: 'walk', a: [], by: 0.5, ay: 0, ap: 0, tl: 0 };
async function walk(c, tx, tz, y = 0) { // a legal pace: 0.4 m per 100 ms, with the walking move state like the real client
  let first = true;
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) { const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.4, d); c.x += (tx - c.x) / d * s; c.z += (tz - c.z) / d * s; c.seq++;
    const m = { t: 'p', x: c.x, y, z: c.z, yaw: Math.atan2(tx - c.x, tz - c.z), s: c.seq, ct: Date.now() % 1e9 };
    if (first) { m.m = mv; m.lk = LK; first = false; }
    c.ws.send(JSON.stringify(m)); await sleep(100); }
  await sleep(300);
}
const both = (fn) => Promise.all([fn(ca, 0), fn(cb, 1)]);
const A = { ...S[KA].account, token: S[KA].token }, B = { ...S[KB].account, token: S[KB].token };
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); const ha = await hi(ca);
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); const hb = await hi(cb);
ok(ha && hb, `both join the shared world (${SHARED_HOME.slice(0, 12)}…)`);
ca.x = ha.resume.x; ca.z = ha.resume.z; cb.x = hb.resume.x; cb.z = hb.resume.z;
const pingA = setInterval(() => { for (const c of [ca, cb]) if (c.ws.readyState === 1) c.ws.send('ping'); }, 4000);
await sleep(800);
// 1. each other as animated players
await walk(ca, ca.x + 1.2, ca.z); await walk(cb, cb.x - 1.2, cb.z); await sleep(600);
const aSeenByB = poses(cb, A.id), bSeenByA = poses(ca, B.id);
ok(aSeenByB.length > 0 && aSeenByB.some((p) => p.m && p.m.st === 'walk') && aSeenByB.some((p) => p.lk === LK), `B sees A walking as a character (${aSeenByB.length} poses, move state + look)`);
ok(bSeenByA.length > 0 && bSeenByA.some((p) => p.m && p.m.st === 'walk'), `A sees B walking too (${bSeenByA.length} poses)`);
// 2. Ula's opening walk, with B getting partner credit
const hello = gk(ca, 'hello')[0] || {};
const kp = hello.keeper || (gk(ca, 'keeper').at(-1) || {}).keeper;
ok(kp && hello.open === null, `Ula is in the garden at (${kp && kp.x.toFixed(1)}, ${kp && kp.z.toFixed(1)}) and the walk has not started`);
await both((c, i) => walk(c, kp.x + 1.5 + i * 2, kp.z));
g(ca, { k: 'talk' }); await sleep(900);
ok(step(ca) === 1 && step(cb) === 1, 'Ula starts the walk for A, and B standing by joins');
const d = NODES.find((n) => n.kind === 'drift');
await both((c, i) => walk(c, d.x + 1 + i * 2.5, d.z));
g(ca, { k: 'ntake', id: d.id }); await sleep(900);
ok(step(ca) === 2 && step(cb) === 2, `gather: A takes driftwood (${gk(ca, 'grant').length ? 'granted' : (gk(ca, 'say').at(-1) || {}).text}); both move on`);
g(ca, { k: 'made', id: 'spear' }); await sleep(800);
ok(step(ca) === 3 && step(cb) === 3, 'craft: A makes a spear; both move on');
await both((c, i) => walk(c, 3 + i * 2, -24));
g(ca, { k: 'catch' }); await sleep(900);
ok(gk(ca, 'fishok').length === 1 && step(ca) === 4 && step(cb) === 4, `fish: a fish from the shared cove stock (${(gk(ca, 'fishno').at(-1) || {}).text || 'ok'})`);
const bx = 4.5, bz = -21.5;
await walk(ca, bx + 1.2, bz);
g(ca, { k: 'bplace', type: 'floor', mat: 'wood', x: bx, y: 0.1, z: bz, yaw: 0, ref: 'o1' }); await sleep(900);
g(ca, { k: 'bplace', type: 'wall', mat: 'wood', x: bx, y: 1.2, z: bz + 0.9, yaw: 0, ref: 'o2' }); await sleep(900);
ok(gk(ca, 'bput').length >= 2 && step(ca) === 5 && step(cb) === 5, `build: two pieces by the water; A and B both on to deliver (${(gk(ca, 'bno').at(-1) || {}).text || 'no refusals'})`);
// 3. the shared build: B sees both pieces, cannot take them down; A takes the floor down and the wall topples for B
const mine = gk(ca, 'bput').filter((m) => m.by === A.id).map((m) => m.p[0]);
const bSees = gk(cb, 'bput').filter((m) => m.by === A.id);
ok(bSees.length >= 2 && bSees.some((m) => m.p[1] === 'floor') && bSees.some((m) => m.p[1] === 'wall'), 'B sees A\'s floor and wall appear');
// 4. deliver: hand the fish to Ivo; the camp pays from its stock
ca.ws.send(JSON.stringify({ t: 'fa', k: 'hello' })); await sleep(1000);
let view = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'view').at(-1);
for (let i = 0; i < 20 && !view; i++) { await sleep(300); ca.ws.send(JSON.stringify({ t: 'fa', k: 'hello' })); await sleep(300); view = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'view').at(-1); }
const ivo = view && view.view.npcs.find((n) => n.id === 'w-ivo');
ok(!!ivo, 'the faction camps are there');
let did = null;
for (let tries = 0; tries < 8 && !(did && did.ok); tries++) {
  const p = pos({ trails: {} }, ivo, Date.now() + 2500);
  await walk(ca, p.x + 1.2, p.z);
  ca.ws.send(JSON.stringify({ t: 'fa', k: 'act', act: 'gift-fish', id: 'w-ivo' })); await sleep(1100);
  did = ca.msgs.filter((m) => m.t === 'fa' && m.k === 'did').at(-1);
  if (did && !did.ok) { console.log('  gift:', did.why); await sleep(700); }
}
ok(did && did.ok, 'faction payout: A hands the fish to Ivo' + (did && did.give ? ` (paid ${JSON.stringify(did.give)})` : ''));
await sleep(700);
ok(step(ca) === 6, 'Ula\'s walk is done for A');
// back to the cove: B tries to take A's floor (refused), A takes it down, the wall falls for both
await both((c, i) => walk(c, bx + 1.4 + i * 1.2, bz - 1));
const floorId = (gk(ca, 'bput').find((m) => m.by === A.id && m.p[1] === 'floor') || {}).p?.[0];
g(cb, { k: 'bremove', id: floorId }); await sleep(800);
ok(/Someone else/.test((gk(cb, 'bno').at(-1) || {}).text || ''), 'B cannot take down A\'s floor');
g(ca, { k: 'bremove', id: floorId }); await sleep(1000);
const del = gk(cb, 'bdel').at(-1);
ok(del && del.ids.includes(floorId) && del.fall.length >= 1, `A takes the floor down and the wall topples for B too (fell: ${del ? del.fall.length : 0})`);
for (const id of mine) if (!gk(ca, 'bdel').some((m) => m.ids.includes(id) || m.fall.includes(id))) { g(ca, { k: 'bremove', id }); await sleep(700); }
// 5. the hares and the fox: both get the same animals, moving on their own
const fa = gk(ca, 'fauna'), fb = gk(cb, 'fauna');
const idsA = new Set((fa.at(-1) || { a: [] }).a.map((r) => r[0])), idsB = new Set((fb.at(-1) || { a: [] }).a.map((r) => r[0]));
ok(fa.length > 5 && fb.length > 5 && idsA.size >= 1 && [...idsA].every((id) => idsB.has(id)), `fauna sync: both see the same ${idsA.size} animals (${fa.length} / ${fb.length} updates)`);
const lastA = fa.at(-1).a, lastB = fb.at(-1).a; const same = lastA.filter((r) => { const o = lastB.find((q) => q[0] === r[0]); return o && Math.hypot(o[2] - r[2], o[3] - r[3]) < 2; }).length;
ok(same >= lastA.length - 1, `and in the same places (${same}/${lastA.length} within 2 m)`);
ok(fa[0].a.some((r, i) => { const l = fa.at(-1).a.find((q) => q[0] === r[0]); return l && Math.hypot(r[2] - l[2], r[3] - l[3]) > 0.3; }), 'they move about on their own');
// 6. a place: the server finds the ruins only when A is really there, refuses a dig from afar, and counts a real dig
const R = PLACES.find((p) => p.id === 'ruins');
const pl0 = gk(ca, 'pl')[0]; ok(pl0 && !pl0.seen.includes('ruins'), 'the ruins are not found yet');
await walk(ca, R.at[0] + 4, R.at[1] + 2);
g(ca, { k: 'pdig', id: 'ruins' }); await sleep(800);
ok(gk(ca, 'pdig').length === 0, 'a dig from 4 m away is refused');
ok(gk(ca, 'pfound').some((m) => m.ids.includes('ruins')), 'walking into the ruins finds them (server saw it)');
await walk(ca, R.at[0], R.at[1] + 1.2);
let grant = null, n0 = null;
for (let i = 0; i < 12 && !grant; i++) { g(ca, { k: 'pdig', id: 'ruins' }); await sleep(700); const pd = gk(ca, 'pdig').at(-1); if (pd && n0 === null) n0 = pd.n; grant = gk(ca, 'grant').find((m) => m.why === 'place') || (/Nothing more/.test((gk(ca, 'say').at(-1) || {}).text || '') ? { settled: true } : null); }
ok(gk(ca, 'pdig').length > 0 || (grant && grant.settled), `digging at the rubble counts (${gk(ca, 'pdig').length} swings counted)`);
ok(!!grant, grant && grant.give ? `loot from the server: ${JSON.stringify(grant.give)}` : 'the dig is settled: the server says nothing more until it refills');
clearInterval(pingA); ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
