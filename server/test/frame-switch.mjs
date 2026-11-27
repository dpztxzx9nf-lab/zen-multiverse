// Live (wrangler dev, fresh state): the garden and home Earth seen as a planet are two maps of the shared world.
// At start-up the app loads the garden, then restores a planet save: the jump into the planet's tile frame is a
// re-seat, not a teleport (it used to strike three times and kick: "failed checks"). Switching back and forth
// faster than once per 15 s is still checked. Usage: MP=http://127.0.0.1:8797 node server/test/frame-switch.mjs
import { SHARED_HOME } from '../../js/spawn.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}&b=1`); const c = { ws, msgs: [], seq: 0, closed: null }; ws.onmessage = (e) => { if (e.data === 'pong') return; try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onclose = (e) => { c.closed = e.code + ' ' + e.reason; }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const send = (c, m) => { c.seq++; c.ws.send(JSON.stringify({ t: 'p', s: c.seq, yaw: 0, ...m })); };
const acks = (c) => c.msgs.filter((m) => m.t === 'a');
const fixes = (c) => c.msgs.filter((m) => m.t === 'fix');
const A = await signIn('frame', 'Brock');
const c = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket);
await sleep(400);
// the garden loads first: a few steps at the lawn (new players start at the city hub, so this is the
// one allowed frame-switch; wait it out before the planet save restores)
for (let i = 0; i < 4; i++) { send(c, { x: 3.5 + i * 0.3, y: 0, z: 9.8 }); await sleep(250); }
await sleep(15e3);
// then the save restores home Earth as a planet, 157 m away in the tile frame, and she walks on there
for (let i = 0; i < 12; i++) { send(c, { x: 160.66 + i * 0.3, y: 2, z: 3.35, tile: '4:0:1' }); await sleep(250); }
await sleep(700);
ok(!c.closed, `still connected after the garden -> planet switch (${c.closed || 'open'})`);
ok(fixes(c).length === 0, `no corrections (${fixes(c).length})`);
ok(acks(c).some((m) => m.tile === '4:0:1' && m.x > 160), 'the server follows her on the planet');
// straight back to the garden within 15 s, far from where she left it: that is still a teleport and is corrected
send(c, { x: 40, y: 0, z: -30 }); await sleep(600);
ok(fixes(c).length >= 1, 'a second switch inside 15 s is corrected');
c.ws.close(); await sleep(300);
// a quick rejoin (under 10 s) that starts in the other map: left on the planet, the reloaded page starts in the
// garden. Live 0.2.18 test: 'rejoin-teleport 915 m' and a correction into planet coordinates while in the garden.
const c2 = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); await sleep(400);
for (let i = 0; i < 4; i++) { send(c2, { x: 3.5 + i * 0.3, y: 0, z: 9.8 }); await sleep(250); }
await sleep(500);
ok(fixes(c2).length === 0 && !c2.closed, `a quick rejoin into the garden after the planet is not corrected (${fixes(c2).map((f) => f.why).join(',') || 'none'})`);
// then the save restores the planet a few seconds later (what a reload or an auto-restart on a planet does):
// that switch is re-seated, not a teleport, and she walks on with no corrections and no kick
for (let i = 0; i < 12; i++) { send(c2, { x: 160.66 + i * 0.3, y: 2, z: 3.35, tile: '4:0:1' }); await sleep(250); }
await sleep(500);
ok(fixes(c2).length === 0 && !c2.closed, `the planet restore right after that rejoin is re-seated (${fixes(c2).map((f) => f.why).join(',') || 'none'}, ${c2.closed ? 'closed ' + c2.closed.code : 'open'})`);
// switching straight back to the garden far away inside 15 s is still checked
send(c2, { x: 40, y: 0, z: -30 }); await sleep(600);
ok(fixes(c2).length >= 1, 'a second switch inside 15 s after that is still corrected');
c2.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
