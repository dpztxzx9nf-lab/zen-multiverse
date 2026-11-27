// A planet's saved pieces and digs must reach a player who joined in the garden and travelled there later
// (2026-11-26, live 0.2.18 test: 63 pieces built alone on home Earth were on the server but invisible after a reload).
// The client now asks {t:'e', k:'sync', tile} when it arrives on a tile; the server answers with that tile's snapshot.
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
const A = await signIn(`snapa+${tag}@example.com`, 'Builder');
const B = await signIn(`snapb+${tag}@example.com`, 'Visitor');
ok(!!A.token && !!B.token, 'signed in');
const world = 'home:' + '0'.repeat(32);
const TILE = '3:2:2';
const a = await connect((await api('/ticket', { world }, A.token)).ticket); await sleep(300);
let n = 0; const ids = [];
for (let i = 0; i < 5; i++) { const id = 'bs' + tag + (++n); ids.push(id); send(a, { t: 'e', k: 'build', tile: TILE, op: 'place', id, lid: id, piece: ['floor', 'wood', 634.7 + i * 2, -2.1, -646.3, 0] }); await sleep(250); }
await sleep(500);
ok(a.on('e').filter((m) => m.k === 'no').length === 0, 'the planet pieces are taken');
a.ws.close(); await sleep(300);

// B joins in the garden, then arrives on the planet and asks for the tile
const b = await connect((await api('/ticket', { world }, B.token)).ticket); await sleep(400);
send(b, { t: 'e', k: 'sync', tile: TILE }); await sleep(600);
const snaps = b.on('e').filter((m) => m.k === 'snap');
const last = snaps.at(-1) || {};
const got = (last.builds || []).filter((x) => ids.includes(x.id));
ok(got.length === 5 && got.every((x) => x.tile === TILE), `a sync on arrival returns the tile's pieces (${got.length}/5)`);
const before = b.on('e').filter((m) => m.k === 'snap').length;
send(b, { t: 'e', k: 'sync', tile: '' }); await sleep(600);
const g = b.on('e').filter((m) => m.k === 'snap').slice(before).flatMap((m) => m.builds || []); // nothing new is fine (an empty garden sends none)
ok(!g.some((x) => ids.includes(x.id)), 'a garden sync does not return the planet pieces');
ok(!b.closed, 'syncs never close the socket');
b.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
