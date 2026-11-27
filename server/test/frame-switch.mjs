// Live (wrangler dev, fresh state): the garden is a place on the home Earth globe, same tile as the city.
// Leftover garden-frame poses (no tile) are lifted onto that globe and walking to the city is continuous,
// not a frame switch. Usage: MP=http://127.0.0.1:8797 node server/test/frame-switch.mjs
import { SHARED_HOME } from '../../js/spawn.js';
import { EARTH_SITE, GARDEN_ARRIVAL, GARDEN_ARRIVAL_PLANET, HUB_SPAWN, liftGardenPose } from '../../js/hub.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}&b=1`); const c = { ws, msgs: [], seq: 0, closed: null }; ws.onmessage = (e) => { if (e.data === 'pong') return; try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onclose = (e) => { c.closed = e.code + ' ' + e.reason; }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const send = (c, m) => { c.seq++; c.ws.send(JSON.stringify({ t: 'p', s: c.seq, yaw: 0, ...m })); };
const acks = (c) => c.msgs.filter((m) => m.t === 'a' || (m.t === 'P' && m.ps));
const fixes = (c) => c.msgs.filter((m) => m.t === 'fix');
const A = await signIn('frame', 'Brock');
const c = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket);
await sleep(400);
// leftover garden-frame steps (no tile) at the arrival stone: the server lifts them onto the globe
for (let i = 0; i < 6; i++) { send(c, { x: GARDEN_ARRIVAL.x + i * 0.3, y: 0, z: GARDEN_ARRIVAL.z }); await sleep(250); }
await sleep(700);
ok(!c.closed, `still connected after a leftover garden pose (${c.closed || 'open'})`);
ok(fixes(c).length === 0, `no corrections lifting the garden pose (${fixes(c).map((f) => f.why).join(',') || 'none'})`);
const lifted = liftGardenPose({ x: GARDEN_ARRIVAL.x + 1.5, y: 0, z: GARDEN_ARRIVAL.z, tile: null });
ok(acks(c).length >= 0, 'server accepted the lifted poses'); // acks may be batched
// walk toward the city on the same tile (a short stretch, same heading as the main street)
const start = GARDEN_ARRIVAL_PLANET;
const along = 8; // metres toward the plaza, well under a teleport
for (let i = 1; i <= 10; i++) {
  const x = start.x + (HUB_SPAWN.x - start.x) * ((along * i / 10) / Math.hypot(HUB_SPAWN.x - start.x, HUB_SPAWN.z - start.z));
  const z = start.z + (HUB_SPAWN.z - start.z) * ((along * i / 10) / Math.hypot(HUB_SPAWN.x - start.x, HUB_SPAWN.z - start.z));
  send(c, { x, y: start.y, z, tile: EARTH_SITE.tile });
  await sleep(250);
}
await sleep(500);
ok(!c.closed, `still connected walking garden to city (${c.closed || 'open'})`);
ok(fixes(c).length === 0, `no corrections walking from the garden toward the city (${fixes(c).map((f) => f.why).join(',') || 'none'})`);
c.ws.close(); await sleep(300);
// a quick rejoin: lastpos is on the globe; starting again at the arrival stone (legacy or lifted) is not a kick
const c2 = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); await sleep(400);
const at = lifted;
for (let i = 0; i < 4; i++) { send(c2, { x: at.x + i * 0.3, y: at.y, z: at.z, tile: EARTH_SITE.tile }); await sleep(250); }
await sleep(500);
ok(fixes(c2).length === 0 && !c2.closed, `a quick rejoin on the globe is not corrected (${fixes(c2).map((f) => f.why).join(',') || 'none'})`);
c2.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
