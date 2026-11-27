// Climbing out of the pond must not trip the anti-cheat ("failed checks" kick, 2026-11-26), and Reconnect after a
// kick must get her back in. Moves mirror the client: a dive, a swim up from the bottom, treading at the surface
// with the waves, then the climb-out mantle (js/game/player-game.js: up to surf+1.1 from chest depth, easeOut over
// ~0.46 s), sometimes squeezed into two poses by a Wi-Fi hiccup, repeated many times.
import { gardenLocal } from '../../js/hub.js';
const gpos = (p) => p && gardenLocal({ x: p.x, y: p.y, z: p.z, tile: p.tile }) || p;
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
const easeOut = (k) => 1 - (1 - k) ** 3;
const SURF = -0.2, CHEST = 1.3, SHORE = 0.55;
async function swimAndClimb(c, x0, z, { squeeze = false } = {}) {
  let x = x0, y = SHORE;
  const p = (yy, dx = 0) => { x += dx; y = yy; send(c, { t: 'p', x, y: +y.toFixed(2), z, yaw: 0, m: { st: yy < SURF - 1 ? 'swim' : 'idle' } }); };
  for (let i = 0; i < 8; i++) { p(SHORE - (SHORE - (SURF - 2.6)) * (i + 1) / 8, -0.25); await sleep(100); }   // a dive to the bottom
  for (let i = 0; i < 12; i++) { p(Math.min(SURF - CHEST, y + 0.16), 0.05); await sleep(100); }                // swim up (~1.6 m/s)
  for (let i = 0; i < 10; i++) { p(SURF - CHEST + 0.12 * Math.sin(i * 1.3), 0.02); await sleep(100); }          // tread with the waves
  const y0 = y, y1 = SURF + 1.05, n = squeeze ? 2 : 5;                                                          // climb out
  for (let i = 1; i <= n; i++) { p(y0 + (y1 - y0) * easeOut(Math.min(1, (i / n) * 1.25)), 0.14); await sleep(squeeze ? 230 : 95); }
  for (let i = 0; i < 6; i++) { p(y1, 0.3); await sleep(100); }                                                // walk up the bank
  return { x, y: y1 };
}

const tag = Date.now().toString(36);
const A = await signIn(`swim+${tag}@example.com`, 'Swimmer');
ok(!!A.token, 'signed in');
const world = `home:${A.id}`;
let c = await connect((await api('/ticket', { world }, A.token)).ticket); await sleep(250);
send(c, { t: 'p', x: 6, y: SHORE, z: 1, yaw: 0 }); await sleep(150);
let at = { x: 6 };
for (let r = 0; r < 6; r++) at = await swimAndClimb(c, at.x, 1, { squeeze: r % 2 === 1 });
await sleep(700);
send(c, { t: 'p', x: at.x, y: at.y, z: 1, yaw: 0 }); await sleep(300);
ok(!c.closed, `six dives and climb-outs (half squeezed by lag) never kick (closed=${JSON.stringify(c.closed)})`);
ok(c.on('fix').length === 0, `climbing out is not rubber-banded (fixes: ${c.on('fix').map((f) => f.why).join(',') || 'none'})`);
const ack = c.on('a').at(-1);
ok(ack && Math.abs(gpos(ack).y - at.y) < 0.05, `the server has her on the bank (server y=${ack && gpos(ack).y}, hers ${at.y.toFixed(2)})`);

// a rejected step out of the water (server thinks she's still in it) must converge, not loop into a kick
let y = SURF - CHEST;
send(c, { t: 'p', x: at.x, y, z: 1, yaw: 0 }); await sleep(800);
for (let i = 0; i < 60; i++) { send(c, { t: 'p', x: at.x + i * 0.02, y: y + 2.6, z: 1, yaw: 0 }); await sleep(66); }
send(c, { t: 'p', x: at.x + 1.2, y: y + 2.6, z: 1, yaw: 0 }); await sleep(600);
send(c, { t: 'p', x: at.x + 1.25, y: y + 2.6, z: 1, yaw: 0 }); await sleep(300);
ok(!c.closed, 'a 2.6 m climb sent at 15 Hz is not kicked');
ok(Math.abs(((c.on('a').at(-1) && gpos(c.on('a').at(-1)).y) ?? -9) - (y + 2.6)) < 0.05, `server height catches up with hers (server y=${c.on('a').at(-1) && gpos(c.on('a').at(-1)).y})`);

// kick (repeated teleports), then Reconnect (resume ticket) gets her straight back in and she can play
const cx = at.x + 1.25;
for (let i = 0; i < 6 && !c.closed; i++) { send(c, { t: 'p', x: cx, y: 0, z: 1, yaw: 0 }); await sleep(120); send(c, { t: 'p', x: cx + 60, y: 0, z: 60, yaw: 0 }); await sleep(150); }
await sleep(300);
ok(c.closed?.code === 4003, `sustained teleporting still kicks (${c.closed?.code} ${c.closed?.reason})`);
const tk = await api('/ticket', { world, resume: true }, A.token);
ok(!!tk.ticket, `Reconnect gets a fresh ticket after a kick (status ${tk.status || 200})`);
c = await connect(tk.ticket); await sleep(300);
const hi = c.on('hi')[0];
ok(hi && hi.resume, `reconnect re-seats her at the last spot the server accepted (${JSON.stringify(hi?.resume)})`);
// her app stands her on the ground there, which can be well above a stale in-water height
const rx = hi?.resume?.x ?? cx, rz = hi?.resume?.z ?? 1, ry = (hi?.resume?.y ?? 0) + 2.2, rtile = hi?.resume?.tile || null;
for (let i = 0; i < 30; i++) { send(c, { t: 'p', x: rx + i * 0.3, y: ry, z: rz, yaw: 0, tile: rtile }); await sleep(100); }
await sleep(300);
ok(!c.closed, `after Reconnect she plays on (closed=${JSON.stringify(c.closed)})`);
ok(c.on('fix').length === 0, `no snap-backs after Reconnect (${c.on('fix').map((f) => f.why).join(',') || 'none'})`);
c.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
