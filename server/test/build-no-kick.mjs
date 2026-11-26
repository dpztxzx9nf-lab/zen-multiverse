// Building must never disconnect (2026-11-26, 0.2.17: "Trying to build is causing me to disconnect"). Alone on the
// home planet the client sent no poses, so the server still had her at the garden spawn: every piece was 'out of
// reach', a strike each, and the 12th kicked her ('failed checks'). Bad or out-of-reach edits are now answered with
// {t:'e', k:'no'} and never strike; the socket stays open.
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function api(path, body, token) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function signIn(email, name) {
  const s = await api('/auth/start', { email, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
  const v = await api('/auth/verify', { email, code: s.devCode, name });
  return { ...v.account, token: v.token };
}
function connect(ticket) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`);
    const c = { ws, msgs: [], closed: null, on: (t) => c.msgs.filter((m) => m.t === t) };
    ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
    ws.onclose = (e) => { c.closed = { code: e.code, reason: e.reason }; };
    ws.onopen = () => res(c);
    ws.onerror = () => rej(new Error('ws error'));
  });
}
// like the real client: after a fix it keeps its own height (the ground sets it) and only x/z go back
const send = (c, m) => {
  c.seq = (c.seq || 0) + 1; m.s = c.seq;
  const f = c.msgs.filter((x) => x.t === 'fix').at(-1);
  if (f && f.id !== c.acked) { c.acked = f.id; c.x = f.x; c.z = f.z; }
  if (c.acked) m.r = c.acked;
  c.ws.send(JSON.stringify(m));
};

const tag = Date.now().toString(36);
const A = await signIn(`build+${tag}@example.com`, 'Builder');
ok(!!A.token, 'signed in');
const world = 'home:' + '0'.repeat(32); // the one shared world, where Brock builds
let c = await connect((await api('/ticket', { world }, A.token)).ticket); await sleep(300);
ok(c.on('hi').length === 1, 'joined the shared world');
const nos = () => c.on('e').filter((m) => m.k === 'no');
const placed = () => c.on('e').filter((m) => m.k === 'build' && m.op === 'place');
let n = 0; const piece = (x, z, typ = 'floor', tile = '3:2:2', y = -2.1) => ({ t: 'e', k: 'build', tile, op: 'place', id: 'bt' + tag + (++n), lid: 'bt' + tag + n, piece: [typ, 'wood', x, y, z, 0] });

// 1) Brock's case: on the planet, no pose sent yet (alone), 20 pieces in a row
for (let i = 0; i < 20; i++) { send(c, piece(634.7 + i * 2, -646.3)); await sleep(220); }
await sleep(400);
ok(!c.closed, `20 pieces on the planet before any pose there: still connected (closed=${JSON.stringify(c.closed)})`);
ok(placed().length === 20, `all 20 are placed and shared (${placed().length})`);

// 2) the server has seen her lately (Xenia: the home is one sphere, so she stays on the hub frame by the arrival
// stone rather than jumping onto a far tile); pieces far out of reach are answered, not punished
const hi0 = c.on('hi')[0], sx = hi0.resume ? hi0.resume.x : 3.5, sz = hi0.resume ? hi0.resume.z : 9.8;
send(c, { t: 'p', x: sx + 0.3, y: 0, z: sz, yaw: 0 }); await sleep(250);
for (let i = 0; i < 20; i++) { send(c, piece(900 + i, -900, 'floor', '', 0.1)); await sleep(220); }
await sleep(400);
ok(!c.closed, 'twenty out-of-reach pieces never kick');
ok(nos().filter((m) => m.why === 'build-reach').length === 20 && nos()[0].lid, `each gets a 'no' with its local id (${nos().length})`);
ok(placed().length === 20, 'and none of them is placed');
send(c, piece(7.7, 14.0, 'floor', '', 0.1)); await sleep(300); // open lawn a few metres from the stone
ok(placed().length === 21, 'a piece within reach is placed');

// 3) junk edits: answered, never a strike
const junk = [
  { t: 'e', k: 'build', tile: '3:2:2', op: 'place', piece: ['tower', 'wood', 636, -2, -646, 0] },
  { t: 'e', k: 'build', tile: '3:2:2', op: 'place', piece: ['floor', 'gold', 636, -2, -646, 0] },
  { t: 'e', k: 'build', tile: '3:2:2', op: 'place', piece: ['floor', 'wood', null, -2, -646, 0] },
  { t: 'e', k: 'build', tile: '3:2:2', op: 'place', piece: 'floor' },
  { t: 'e', k: 'build', tile: '3:2:2', op: 'remove', id: '!' },
  { t: 'e', k: 'build', tile: 'not-a-tile', op: 'place', piece: ['floor', 'wood', 636, -2, -646, 0] },
  { t: 'e', k: 'paint', tile: '3:2:2' },
  { t: 'e', k: 'vox', tile: '3:2:2', diffs: 'nope' },
  { t: 'e', k: 'vox', tile: '3:2:2', diffs: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${i},0,0`, 'AAAA'])) },
  { t: 'e', k: 'vox', tile: '3:2:2', diffs: { '1,0,0': 'x'.repeat(9000) } },
];
for (let r = 0; r < 3; r++) for (const j of junk) { send(c, j); await sleep(200); }
await sleep(400);
ok(!c.closed, `30 malformed edits never close the socket (closed=${JSON.stringify(c.closed)})`);
ok(nos().length >= 20 + 30, `each malformed edit is answered (${nos().length - 20} answers)`);
// a dig's worth of voxel edits split the way the client now sends them (~12 KB parts) goes through
const big = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${i},0,1`, 'A'.repeat(7000)]));
send(c, { t: 'e', k: 'vox', tile: '3:2:2', diffs: big }); await sleep(400);
ok(!c.closed, 'a 42 KB voxel edit (bigger than the old 16 KB limit) does not close the socket');

// 4) garden building with a bad piece: an answer, no strike
await sleep(4500); send(c, { t: 'p', x: 20, y: 0, z: -20, yaw: 0 }); await sleep(250); // back in the garden frame (a re-seat, at most one per 15 s)
for (let i = 0; i < 15; i++) { send(c, { t: 'g', k: 'bplace', type: 'tower', mat: 'wood', x: 21, y: 0.1, z: -21, yaw: 0, ref: 'r' + i }); await sleep(300); }
await sleep(300);
ok(!c.closed, 'fifteen bad garden pieces never kick');
ok(c.on('g').filter((m) => m.k === 'bno').length >= 10, 'they are answered with a calm note');

// 5) quiet spell: alone the client sends a pose every so often; a walk that fits the time is not a teleport
send(c, { t: 'p', x: 20.5, y: 0, z: -20, yaw: 0 }); await sleep(2600);
const fixesBefore = c.on('fix').length;
send(c, { t: 'p', x: 34, y: 0, z: -20, yaw: 0 }); await sleep(300);
ok(c.on('fix').length === fixesBefore, `a 13.5 m walk over 2.6 s between poses is accepted (fixes: ${c.on('fix').slice(fixesBefore).map((f) => f.why).join(',') || 'none'})`);
ok(!c.closed, 'still connected at the end');
c.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
