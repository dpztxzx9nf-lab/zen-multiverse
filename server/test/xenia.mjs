// Live (wrangler dev, fresh state): Xenia on the server. The hub frame (no tile) is a frame on the sphere: walking
// out of it onto a tile is a short step, not a teleport (there is no garden<->planet re-seat any more), and a jump is
// still corrected. Poses get a region tag. Building on the hub: world builds, not on the pond, only the builder takes
// a piece down, and bad or oversize build messages are refused without ever closing the socket.
// Usage: MP=http://127.0.0.1:8797 node server/test/xenia.mjs
import { SHARED_HOME } from '../../js/spawn.js';
import { XENIA, hubFrame, HUB_OUT } from '../../js/xenia/xenia.js';
import { tileOf, makeFrame } from '../../js/universe/sphere.js';
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
const sys = (c) => c.msgs.filter((m) => m.t === 'sys').map((m) => m.text);
const builds = (c) => c.msgs.filter((m) => m.t === 'e' && m.k === 'build');
const R = XENIA.R, H = hubFrame(R);
const A = await signIn('xen', 'Brock'), B = await signIn('xen2', 'Mom'), C = await signIn('xen3', 'Kai');
// first time in the world: the server seats her at the spawn; to start the walk out near the hub frame's edge
// she leaves and comes back after the 10 s rejoin window (then her first pose is taken as where she is)
{ const c0 = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); await sleep(300); c0.ws.close(); await sleep(10500); }
const c = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket);
const d = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket);
await sleep(400);
// a walk out of the hub frame onto a tile: hub poses up to the hand-over, then the same ground in tile metres
let x = HUB_OUT - 4;
for (let i = 0; i < 4; i++) { send(c, { x, y: 0, z: 10 }); x += 1.1; await sleep(260); }
const dir = H.toDir(x, 10), tile = tileOf(R, dir), [tx, tz] = makeFrame(R, tile).fromDir(dir);
for (let i = 0; i < 6; i++) { send(c, { x: tx + i * 0.8, y: 0, z: tz, tile }); await sleep(260); }
await sleep(600);
ok(!c.closed, `connected after walking out of the hub frame (${c.closed || 'open'})`);
ok(fixes(c).length === 0, `no corrections at the hand-over (${fixes(c).map((f) => f.why).join(',')})`);
ok(acks(c).some((m) => m.tile === tile), 'the server follows her onto the tile');
ok(acks(c).some((m) => typeof m.rg === 'string'), `poses carry a region tag (${[...new Set(acks(c).map((m) => m.rg))].join(',')})`);
// straight back to the spawn in the hub frame: that is a jump of ~1.5 km, corrected
send(c, { x: 3.5, y: 0, z: 9.8 }); await sleep(600);
ok(fixes(c).some((f) => f.why === 'teleport'), 'a jump back to the spawn is corrected');
// building on the lawn (a third player, fresh at the spawn)
c.ws.close(); await sleep(200);
const e = await connect((await api('/ticket', { world: SHARED_HOME }, C.token)).ticket); await sleep(300);
for (let i = 0; i < 3; i++) { send(e, { x: 4.5 + i * 0.3, y: 0, z: 10.5 }); send(d, { x: 3.8 + i * 0.3, y: 0, z: 11.5 }); await sleep(260); }
ok(acks(e).some((m) => m.rg === 'home'), 'at the spawn the tag is Home Valley');
const put = (cl, piece, lid) => cl.ws.send(JSON.stringify({ t: 'e', k: 'build', tile: '', op: 'place', piece, lid, id: lid }));
put(e, ['floor', 'wood', 6.8, 0.1, 13, 0], 'xenfloor01'); await sleep(500);
ok(builds(d).some((m) => m.op === 'place' && m.id === 'xenfloor01'), 'a floor on the lawn: the other player sees it');
put(e, ['floor', 'wood', 10.2, 0.1, 1.2, 0], 'xenpond0001'); await sleep(400);
ok(!builds(d).some((m) => m.id === 'xenpond0001') && sys(e).some((t) => /pond/.test(t)), 'not on the pond (refused with a word)');
d.ws.send(JSON.stringify({ t: 'e', k: 'build', tile: '', op: 'remove', id: 'xenfloor01' })); await sleep(400);
ok(!builds(e).some((m) => m.op === 'remove' && m.id === 'xenfloor01') && sys(d).some((t) => /Someone else/.test(t)), 'someone else cannot take it down');
put(d, ['wall', 'wood', 6.8, 0.1, 13, 0], 'xenfloor01'); await sleep(400);
ok(!builds(e).some((m) => m.op === 'place' && m.id === 'xenfloor01' && m.piece[0] === 'wall'), 'nor overwrite it by reusing its id');
// junk build messages and an oversize edit: refused, the socket stays open
for (const junk of [['tower', 'gold', 1, 2, 3, 0], ['floor', 'wood', 'x', 0, 0, 0], 'nope', ['floor', 'wood', 900, 0, 900, 0]]) { put(e, junk, 'junk' + Math.random().toString(36).slice(2, 8)); await sleep(200); }
e.ws.send(JSON.stringify({ t: 'e', k: 'vox', tile: '', diffs: { '9,0,9': 'A'.repeat(7000), '9,0,10': 'A'.repeat(7000), '9,0,11': 'A'.repeat(7000) } })); await sleep(500);
ok(!e.closed, `bad and oversize build messages never close the socket (${e.closed || 'open'})`);
ok(sys(e).some((t) => /too big/.test(t)), 'the oversize edit gets a word back');
// a client from before Xenia asking the old garden building: told to update
e.ws.send(JSON.stringify({ t: 'g', k: 'bplace', type: 'floor', mat: 'wood', x: 6.8, y: 0.1, z: 15, yaw: 0 })); await sleep(400);
ok(e.msgs.some((m) => m.t === 'g' && m.k === 'bno' && /update/.test(m.text)), 'the old garden building request is answered: update');
e.ws.send(JSON.stringify({ t: 'e', k: 'build', tile: '', op: 'remove', id: 'xenfloor01' })); await sleep(400);
ok(builds(d).some((m) => m.op === 'remove' && m.id === 'xenfloor01'), 'the builder takes it down');
ok(!e.closed && !d.closed, 'everyone still connected');
e.ws.close(); d.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
