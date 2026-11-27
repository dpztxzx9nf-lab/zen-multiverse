// Two clients against a local `wrangler dev`: walls and people are real on the server (server/src/solids.js via world.js
// pose): a refused step is a snap back ('fix' why wall / body), never a strike; nobody is ever moved by someone else.
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
import { SOLIDS_V } from '../../js/solids-v.js';
import { gardenLocal, EARTH_SITE } from '../../js/hub.js';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; return c; };
async function api(path, body, token) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function signIn(email, name) {
  const s = await api('/auth/start', { email, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
  const v = await api('/auth/verify', { email, code: s.devCode, name });
  return { ...v.account, token: v.token };
}
function connect(ticket, name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`);
    const c = { name, ws, msgs: [], seq: 0, pos: null, g: null, on: (t, k) => c.msgs.filter((m) => m.t === t && (!k || m.k === k)) };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data); c.msgs.push(m);
      if (m.t === 'g' && (m.k === 'state' || m.k === 'hello')) c.g = m.game;
      if (m.t === 'fix') { const g = gardenLocal({ x: m.x, y: m.y, z: m.z, tile: m.tile }); c.pos = { ...c.pos, ...(g || { x: m.x, y: m.y, z: m.z }) }; c.acked = m.id; }
    };
    ws.onopen = () => res(c);
    ws.onerror = () => rej(new Error('ws error'));
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
function pose(c, x, z, yaw = 0) {
  c.seq++; const m = { t: 'p', x, y: 0, z, yaw, s: c.seq }; if (c.acked) m.r = c.acked;
  send(c, m); c.pos = { x, y: 0, z, yaw };
}
// walk at a legal pace (5 m/s, a pose every 100 ms) like the real client
async function walk(c, x, z, speed = 5) {
  const f0 = c.msgs.filter((m) => m.t === 'fix').length;
  for (let i = 0; i < 800; i++) {
    const p = c.pos, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    if (c.msgs.filter((m) => m.t === 'fix').length > f0) return false; // refused (a wall): stop like a player would
    const s = Math.min(d, speed * 0.1);
    pose(c, +(p.x + dx / d * s).toFixed(3), +(p.z + dz / d * s).toFixed(3), p.yaw);
    await sleep(100);
  }
}
const g = (c, m) => send(c, { t: 'g', ...m });
const fixes = (c, why) => c.msgs.filter((m) => m.t === 'fix' && (!why || m.why === why));
const bad = (c) => c.msgs.filter((m) => m.t === 'kick' || m.t === 'strike' || (m.t === 'fix' && m.why !== 'wall' && m.why !== 'body' && m.why !== 'rejoin'));

const tag = Date.now().toString(36);
const A = await signIn(`brock+w${tag}@example.com`, 'Brock');
const B = await signIn(`cousin+w${tag}@example.com`, 'Cousin');
const inv = await api('/invite', {}, A.token);
await api('/invite/redeem', { code: inv.code }, B.token);
const ca = await connect((await api('/ticket', { world: `home:${A.id}` }, A.token)).ticket, 'A');
await sleep(200);
const cb = await connect((await api('/ticket', { world: `home:${A.id}` }, B.token)).ticket, 'B');
await sleep(300);
g(ca, { k: 'v', sol: SOLIDS_V }); g(cb, { k: 'v' }); // A runs this build; B an older one (no shapes version)
pose(ca, 0, -10.5); pose(cb, 2, -10.5); await sleep(300);
// (1) walls are real: the garden wall (from its own mesh) stops A with a snap back, never a strike
ok(!(await walk(ca, 0, -14)) && fixes(ca, 'wall').length >= 1 && ca.pos.z > -12.6, `walking into the garden wall: snapped back to z ${ca.pos.z}`);
ok(!bad(ca).length && ca.ws.readyState === 1, 'and no strike or kick for it');
// an older client is not held to shapes it may not have (no false snaps on a stale build)
ok(await walk(cb, 2, -14) && !fixes(cb).length, 'a client without the shapes version is not checked against them');
await walk(cb, 2, -10.5); await walk(cb, 0, -9.6);
// (3) bodies: A walks into B, is refused, B never moves; after a couple of seconds pressing, A slips past
const f0 = fixes(ca, 'body').length; let passed = false;
for (let i = 0; i < 60 && !passed; i++) { pose(ca, ca.pos.x, +(ca.pos.z + 0.25).toFixed(3)); await sleep(100); passed = ca.pos.z > -8.8; }
ok(fixes(ca, 'body').length > f0, `walking into another player is refused (${fixes(ca, 'body').length - f0} snaps)`);
ok(passed, 'and after pressing for a while she gives way (nobody can wall you in)');
const bpos = cb.pos; ok(!fixes(cb).length && bpos.x === 0 && bpos.z === -9.6, 'the other player was never moved or corrected');
ok(!bad(ca).length && !bad(cb).length, 'no strikes, no kicks');
ca.ws.close(); cb.ws.close();
console.log(fails ? `walls-live: ${fails} FAILED` : 'walls-live: all passed'); process.exit(fails ? 1 : 0);
