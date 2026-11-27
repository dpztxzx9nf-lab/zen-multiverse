// 0.2.38: starter pistol, anti-dupe loot, and Rattler camp combat against a local wrangler dev.
const BASE = process.env.MP || 'http://127.0.0.1:8797';
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

const tag = Date.now().toString(36);
const A = await signIn(`combat-a+${tag}@example.com`, 'Colt');
const B = await signIn(`combat-b+${tag}@example.com`, 'Nia');
ok(A.token && B.token && A.id !== B.id, 'two accounts signed in');
const world = 'planet:prime:8';
const tA = await api('/ticket', { world }, A.token);
const tB = await api('/ticket', { world }, B.token);
const ca = await connect(tA.ticket);
const cb = await connect(tB.ticket);
await sleep(300);
const inv = [...ca.on('rt'), ...(ca.on('hi')[0]?.guns ? [{ k: 'inv', guns: ca.on('hi')[0].guns }] : [])];
const guns = (inv.find((m) => m.k === 'inv' && m.guns && m.guns.length) || {}).guns || [];
const starter = guns.find((g) => g.starter) || guns[0];
ok(!!starter && starter.type === 'pistol' && starter.id, `hello grants a starter pistol (${starter && starter.name})`);

for (let i = 0; i < 4; i++) { await sleep(80); send(ca, { t: 'p', x: 2, y: 0, z: 4, yaw: 0 }); send(cb, { t: 'p', x: 2, y: 0, z: 6, yaw: 0 }); }
await sleep(200);
const f0 = cb.on('f').length + ca.on('f').length;
ca.ws.send(JSON.stringify({ t: 'f', dx: 0, dy: 0, dz: 1, ago: 0 }));
await sleep(200);
ok(cb.on('f').length + ca.on('f').length === f0, 'fire without a gun id is ignored, even after the starter is granted');
ca.ws.send(JSON.stringify({ t: 'f', dx: 0, dy: 0, dz: 1, ago: 0, gun: 'not-a-real-gun-id' }));
await sleep(200);
ok(cb.on('f').length + ca.on('f').length === f0, 'fire with a forged gun id is ignored');

ca.ws.send(JSON.stringify({ t: 'f', dx: 0, dy: 0, dz: 1, ago: 0, gun: starter.id }));
await sleep(300);
ok([...ca.on('f'), ...cb.on('f')].length > f0 || [...ca.on('hit'), ...cb.on('hit')].length > 0, 'a shot with the starter pistol is accepted');
ok([...ca.on('hit'), ...cb.on('hit')].some((h) => h.id === B.id && h.by === A.id), 'the starter pistol can hit another player');

// camp: spawn 3-5 rattlers in front of A
send(ca, { t: 'rt', k: 'camp', cx: 0, cz: 0, x: 2, y: 0, z: 8, starter: true, type: 'rattler' });
let camp = null;
for (let i = 0; i < 20 && !camp; i++) {
  await sleep(100);
  camp = ca.on('rt').find((m) => (m.k === 'st' || m.k === 'p') && (m.rats || []).length);
}
ok(!!camp && camp.rats.length >= 3 && camp.rats.length <= 5, `a camp spawns 3 to 5 Rattlers (${camp && camp.rats.length})`);
const live = (camp && camp.rats.filter((r) => r.st !== 'dead')) || [];
ok(live.length >= 3, 'the Rattlers are alive when the camp is announced');

// walk close, shoot the first rattler until it dies or we see a drop
const rat = live[0];
for (let i = 0; i < 12; i++) {
  send(ca, { t: 'p', x: 2, y: 0, z: 7, yaw: 0 });
  await sleep(100);
  ca.ws.send(JSON.stringify({ t: 'f', dx: 0, dy: 0, dz: 1, ago: 0, gun: starter.id }));
  await sleep(80);
  if (ca.on('hit').some((h) => h.kind === 'rattler' && h.killed)) break;
}
const rHits = ca.on('hit').filter((h) => h.kind === 'rattler');
ok(rHits.length > 0, 'a starter-pistol shot can hit a Rattler');
const drops = ca.on('rt').filter((m) => m.k === 'drops').flatMap((m) => m.drops || []).filter((d) => !d.claimed);
ok(drops.length >= 1, `the camp has gun drops (${drops.length})`);
const drop = drops[0];
send(ca, { t: 'p', x: drop.x, y: drop.y || 0, z: drop.z, yaw: 0 });
await sleep(150);
send(ca, { t: 'rt', k: 'loot', id: drop.id });
await sleep(250);
const lootOk = ca.on('rt').some((m) => m.k === 'loot' && m.ok && m.id === drop.id);
ok(lootOk, 'picking up a drop adds the gun to the inventory');
send(ca, { t: 'rt', k: 'loot', id: drop.id });
await sleep(200);
ok(ca.on('rt').some((m) => m.k === 'loot' && m.ok === false && (m.why === 'taken' || m.why === 'dupe' || m.why === 'gone')), 'the same drop cannot be claimed twice');
send(ca, { t: 'rt', k: 'loot', id: 'ffffffffffffffff' });
await sleep(150);
ok(ca.on('rt').some((m) => m.k === 'loot' && m.ok === false && m.why === 'gone'), 'a made-up drop id is refused');

for (const c of [ca, cb]) try { c.ws.close(); } catch { /* */ }
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL PASSED');
