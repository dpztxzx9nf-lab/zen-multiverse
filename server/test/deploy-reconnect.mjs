// A server deploy must not lose progress or leave a player needing a Reconnect click.
// Sequence: walk to a known spot, POST /deploy-soon (flushes lastpos, sends 'upd', closes 1012),
// then a resume ticket puts her back on that exact spot and she can play on.
import { liftGardenPose, EARTH_SITE } from '../../js/hub.js';
import { SHARED_HOME } from '../../js/spawn.js';
import { PROTOCOL } from '../../js/protocol.js';
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
const send = (c, m) => {
  if (m.t === 'p') { c.seq = (c.seq || 0) + 1; m.s = c.seq; const f = c.msgs.filter((x) => x.t === 'fix').at(-1); if (f && f.id !== c.acked) { c.acked = f.id; m.x = f.x ?? m.x; m.y = f.y ?? m.y; m.z = f.z ?? m.z; } if (c.acked) m.r = c.acked; }
  c.ws.send(JSON.stringify(m));
};
async function waitFor(c, pred, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(c)) return true;
    await sleep(50);
  }
  return pred(c);
}

const health = await api('/health');
ok(health.ok && health.proto === PROTOCOL, `/health reports proto ${health.proto} (want ${PROTOCOL})`);

const tag = Date.now().toString(36);
const A = await signIn(`deploy+${tag}@example.com`, 'DeployPilot');
ok(!!A.token, 'signed in');

const t1 = await api('/ticket', { world: SHARED_HOME }, A.token);
ok(!!t1.ticket, 'got a ticket to the shared world');
const c1 = await connect(t1.ticket);
ok(await waitFor(c1, (c) => c.on('hi').length), 'welcome arrived');
const hi1 = c1.on('hi')[0];
ok(hi1.proto === PROTOCOL, `welcome proto is ${hi1.proto}`);

// start on the world spawn (the welcome may have seated her there), then walk a few metres east
let x = 3.5, z = 9.8;
send(c1, { t: 'p', x, y: 0, z, yaw: 0 });
for (let i = 0; i < 16; i++) { await sleep(100); x += 0.3; send(c1, { t: 'p', x, y: 0, z, yaw: 0 }); }
await sleep(200);
ok(!c1.closed, 'still connected after a short walk');
ok(c1.on('fix').length === 0, 'the walk was accepted');
const lastX = x, lastZ = z;
const lastAt = liftGardenPose({ x: lastX, y: 0, z: lastZ, tile: null });

const dep = await api('/deploy-soon', {});
ok(dep.status !== 401 && dep.ok, `deploy-soon accepted (status ${dep.status})`);
ok(await waitFor(c1, (c) => c.on('upd').length || (c.closed && c.closed.code === 1012), 6000), 'client got upd or a 1012 close');
ok(c1.on('upd').length === 0 || c1.on('upd')[0].why === 'deploy', 'upd says the server is deploying');
ok(await waitFor(c1, (c) => !!c.closed, 4000), `socket closed after deploy (code ${c1.closed && c1.closed.code})`);
ok(c1.closed && c1.closed.code === 1012, `close code is 1012 updating (got ${c1.closed && c1.closed.code} ${c1.closed && c1.closed.reason})`);

// resume: no Reconnect click — a fresh ticket with resume:true is what the client sends on auto-retry
const t2 = await api('/ticket', { world: SHARED_HOME, resume: true }, A.token);
ok(!!t2.ticket, 'resume ticket after deploy');
const c2 = await connect(t2.ticket);
ok(await waitFor(c2, (c) => c.on('hi').length), 'reconnected after deploy');
ok(!c2.closed, 'the new socket stays open');
const hi2 = c2.on('hi')[0];
ok(hi2.resume && typeof hi2.resume.x === 'number', 'welcome includes a resume position');
const dx = hi2.resume ? Math.hypot(hi2.resume.x - lastAt.x, (hi2.resume.z ?? 0) - lastAt.z) : 99;
ok(dx < 0.3, `resume is the last accepted spot (d=${dx.toFixed(3)} m, at ${hi2.resume && hi2.resume.x},${hi2.resume && hi2.resume.z}; walked to ${lastAt.x},${lastAt.z})`);

send(c2, { t: 'p', x: lastAt.x, y: lastAt.y, z: lastAt.z, yaw: 1.2, tile: EARTH_SITE.tile });
await sleep(200);
ok(!c2.closed && c2.on('fix').length === 0, 'she can play on after the resume (no kick, no snap-back)');

c2.ws.close();
console.log(fails ? `deploy-reconnect: ${fails} failed` : 'deploy-reconnect: all passed');
process.exit(fails ? 1 : 0);
