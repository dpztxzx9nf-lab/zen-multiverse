// End-to-end check (local `wrangler dev`, MAIL_MODE=dev) for other players drawn as real characters:
// a pose's optional move state (m) and look code (lk) are checked, rebuilt and relayed; an older client's pose
// (no extras) still goes through unchanged; a late joiner is told everyone's look on arrival.
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
function connect(ticket, batched) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}${batched ? '&b=1' : ''}`);
    const c = { ws, msgs: [], on: (t) => c.msgs.filter((m) => m.t === t) };
    ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
    ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws error'));
  });
}
const send = (c, m) => { c.seq = (c.seq || 0) + 1; c.ws.send(JSON.stringify({ t: 'p', s: c.seq, ...m })); };
const tag = Date.now().toString(36);
const A = await signIn(`ra+${tag}@example.com`, 'Avatar A');
const B = await signIn(`rb+${tag}@example.com`, 'Avatar B');
const D = await signIn(`rd+${tag}@example.com`, 'Late D');
const E = await signIn(`re+${tag}@example.com`, 'Far E');
const world = `home:${A.id}`;
for (const U of [B, D, E]) { const inv = await api('/invite', {}, A.token); await api('/invite/redeem', { code: inv.code }, U.token); }
const ca = await connect((await api('/ticket', { world }, A.token)).ticket);
const cb = await connect((await api('/ticket', { world }, B.token)).ticket);
await sleep(300);
const LK = 'ZA1.AQRrV_bXwwKMYjlaOiIAAJo7KnpUNOzr5px7XG-KWi9KNuzr5shkPJqWjg';
send(ca, { x: 0, y: 0, z: 5, yaw: 0, ct: 1000, m: { sp: 1.4, g: true, vy: 0, st: 'walk', a: ['carry'], by: 0.5, ay: 0.5, ap: -0.1, tl: 0 }, lk: LK });
await sleep(150);
send(ca, { x: 0.15, y: 0, z: 5, yaw: 0, ct: 1100, m: { sp: 99, g: false, vy: -500, st: 'Evil<script>', a: ['wave', 'x y', 7, 'dig', 'more'], by: 99, extra: 'nope', tl: 1.4 }, lk: 'not-a-look' });
await sleep(150);
send(cb, { x: 2, y: 0, z: 5, yaw: 1 }); // an older client: no extras at all
await sleep(300);
const pa = cb.on('p').filter((m) => m.id === A.id);
ok(pa.length === 2, `B got both of A's poses (${pa.length})`);
ok(pa[0]?.m?.st === 'walk' && pa[0].m.sp === 1.4 && pa[0].m.a[0] === 'carry' && pa[0].m.by === 0.5 && pa[0].lk === LK && pa[0].ct === 1000, 'move state + look + sender clock are relayed with the pose');
const m2 = pa[1]?.m || {};
ok(m2.sp === 20 && m2.vy === -80 && m2.st === 'idle' && m2.by === 7 && m2.tl === 1.4 && !('extra' in m2) && JSON.stringify(m2.a) === '["wave","dig"]', `bad move state is clamped and rebuilt (${JSON.stringify(m2)})`);
ok(pa[1] && !('lk' in pa[1]), 'a malformed look code is dropped');
const pb = ca.on('p').find((m) => m.id === B.id);
ok(pb && !('m' in pb) && !('lk' in pb) && pb.x === 2, 'an older client\'s pose still relays, with no extras');
ok(!ca.on('kick').length && !cb.on('kick').length && ca.ws.readyState === 1 && cb.ws.readyState === 1, 'no strikes or kicks for the extras');
const cd = await connect((await api('/ticket', { world }, D.token)).ticket);
await sleep(300);
ok(cd.on('lk').some((m) => m.id === A.id && m.lk === LK), 'a late joiner is told A\'s look on arrival');
ok(!cd.on('lk').some((m) => m.id === B.id), 'no look message for a player who never sent one');

// batching + interest: D and E ask for batched poses; A walks about 50 m from D (near),
// E is 400 m away (far). Over 2 s at 10 Hz: D gets A every flush but E about once a second; B (older client) gets every pose.
cd.ws.close();
const cd2 = await connect((await api('/ticket', { world }, D.token)).ticket, true);
const ce = await connect((await api('/ticket', { world }, E.token)).ticket, true);
await sleep(300);
send(cd2, { x: 50, y: 0, z: 5, yaw: 0 }); send(ce, { x: 400, y: 0, z: 5, yaw: 0 });
await sleep(300);
for (const c of [cb, cd2, ce]) c.msgs.length = 0;
let ax = 0.15, ex = 400;
for (let i = 0; i < 20; i++) { ax += 0.3; ex += 0.3; send(ca, { x: ax, y: 0, z: 5, yaw: 0, ct: 2000 + i * 100 }); send(ce, { x: ex, y: 0, z: 5, yaw: 0, ct: 2000 + i * 100 }); await sleep(100); }
await sleep(300);
const flat = (c) => c.msgs.flatMap((m) => (m.t === 'P' ? m.ps : m.t === 'p' ? [m] : []));
const dA = flat(cd2).filter((m) => m.id === A.id).length, dE = flat(cd2).filter((m) => m.id === E.id).length;
const dMsgs = cd2.msgs.filter((m) => m.t === 'P' || m.t === 'p').length;
const bA = cb.on('p').filter((m) => m.id === A.id).length, bE = cb.on('p').filter((m) => m.id === E.id).length;
console.log(`  batched D: ${dMsgs} pose messages carrying A x${dA}, E x${dE}; older B: A x${bA}, E x${bE}`);
ok(dA >= 16, `a near player reaches the batched client at full rate (${dA}/20)`);
ok(dE >= 1 && dE <= 4, `a far player (350 m) reaches it about once a second (${dE})`);
ok(cd2.msgs.some((m) => m.t === 'P' && m.ps.length >= 2), 'poses of several players arrive in one batch message');
ok(dMsgs <= 34, `batched client gets at most ~15 pose messages/s (${dMsgs} in 2 s)`);
ok(bA >= 19 && bE >= 19, 'the older client still gets every pose as before');
ok(!ce.msgs.some((m) => (m.t === 'P' ? m.ps : [m]).some((q) => q.id === E.id)), 'no one is sent their own pose');
for (const c of [ca, cb, cd2, ce]) c.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
