// Live (wrangler dev locally, or the real server with SESS=sessions.json): two players and the things they set down.
// A sets down a chest and a safe, fills them; B opens the chest and takes from it, is locked out of the safe, is let in
// by A, both reach for the same stack at once (no dupes), A reconnects and everything is still there, a spear is made
// only at a workbench, and A takes both down again (so a live run leaves the garden as it was).
// The bag lives on the server (server/src/bag.js): each player says hi to it, deposits come out of the server's bag
// (more than you have is refused, a spoofed safe is not counted) and withdrawals go into it.
// Usage: MP=http://127.0.0.1:8797 node server/test/live-storage.mjs   |   SESS=/path/s.json MP=https://play.thinkcore.io node ...
import fs from 'node:fs';
import { SHARED_HOME } from '../../js/spawn.js';
import { GARDEN_FIXTURES } from '../src/storage.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, cA = null, cB = null; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) { fails++; for (const [n, x] of [['A', cA], ['B', cB]]) if (x) console.log(`  debug ${n}: ` + JSON.stringify(x.msgs.filter((q) => q.t === 'g' && /^s/.test(q.k) || q.t === 'kick' || q.t === 'err').slice(-4)).slice(0, 600)); } return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}&b=1`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0 }; ws.onmessage = (e) => { if (e.data === 'pong') return; try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 100 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const gk = (c, k) => c.msgs.filter((m) => m.t === 'g' && m.k === k);
const wait = async (c, k, n0, ms = 3000) => { for (let i = 0; i < ms / 50 && gk(c, k).length <= n0; i++) await sleep(50); return gk(c, k).at(-1); };
async function walk(c, tx, tz, y = 0) { // a legal pace: 0.4 m per 100 ms
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) { const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.4, d); c.x += (tx - c.x) / d * s; c.z += (tz - c.z) / d * s; c.seq++; c.ws.send(JSON.stringify({ t: 'p', x: c.x, y, z: c.z, yaw: Math.atan2(tx - c.x, tz - c.z), s: c.seq })); await sleep(100); }
  await sleep(300);
}
async function route(c, pts) { for (const [x, z] of pts) await walk(c, x, z); }
// the server's bag: hi (and the one-time import on a first run), numbered asks, the bag as the server has it
const bk = (c) => c.msgs.filter((m) => m.t === 'b' && m.k === 'bag');
const waitB = async (c, n0, ms = 4000) => { for (let i = 0; i < ms / 50 && bk(c).length <= n0; i++) await sleep(50); return bk(c).at(-1); };
const bsend = (c, m) => c.ws.send(JSON.stringify({ t: 'b', ...m }));
async function bagHi(c, acc) {
  c.dev = 'live' + acc.id.slice(0, 12); let n = bk(c).length; bsend(c, { k: 'hi', dev: c.dev }); let r = await waitB(c, n);
  if (r && !r.imp) { n = bk(c).length; bsend(c, { k: 'imp', inv: {} }); r = await waitB(c, n); }
  c.bseq = (r && r.seq) || 0; return r;
}
async function ops(c, list) { const n = bk(c).length; bsend(c, { k: 'ops', ops: list.map((o) => [++c.bseq, ...o]) }); return waitB(c, n); }
const binv = (c) => (bk(c).at(-1) || {}).inv || {};
let A, B;
if (process.env.SESS) { const S = JSON.parse(fs.readFileSync(process.env.SESS, 'utf8')); const [ka, kb] = Object.keys(S); A = { ...S[ka].account, token: S[ka].token }; B = { ...S[kb].account, token: S[kb].token }; }
else { A = await signIn('sta', 'Brock'); B = await signIn('stb', 'Cousin'); }
async function join(acc, prev) { const c = await connect((await api('/ticket', prev ? { world: SHARED_HOME, resume: true } : { world: SHARED_HOME }, acc.token)).ticket); const h = await hi(c); const r = h.resume || prev || { x: 0, z: 0, y: 0 }; c.x = r.x; c.z = r.z; c.y0 = r.y || 0; g(c, { k: 'v' }); return c; }
let ca = await join(A); const cb = await join(B); cA = ca; cB = cb;
await sleep(800);
const ba = await bagHi(ca, A), bb = await bagHi(cb, B);
ok(ba && ba.imp && bb && bb.imp, 'both bags are on the server (hi, and the import on a first run)');
// what A needs: wood and metal from the world (within its pace), and a crate and a safe made by hand if A has none
const need = [['+', 'mat:wood', 14], ['+', 'mat:metal', 3], ['+', 'mat:stone', 1], ['+', 'fibre', 1]]; // and a spear's worth for the end
if (!binv(ca)['fx:chest']) need.push(['+', 'mat:wood', 6], ['+', 'fibre', 2], ['c', 'fx_chest']);
if (!binv(ca)['fx:safe']) need.push(['+', 'mat:metal', 4], ['+', 'mat:stone', 4], ['c', 'fx_safe']);
await ops(ca, need); const inv0 = binv(ca);
ok(inv0['fx:chest'] >= 1 && inv0['fx:safe'] >= 1 && inv0['mat:wood'] >= 12 && inv0['mat:metal'] >= 3, 'A has a crate, a safe, wood and metal in the server bag');
const sp = await ops(ca, [['+', 'fx:safe', 5], ['+', 'gold', 9]]);
ok(sp && (sp.inv['fx:safe'] || 0) === inv0['fx:safe'] && !sp.inv.gold && sp.rej && sp.rej.length === 2, 'spoofed: 5 safes from nowhere and an unknown item are refused with a reason, not counted');
const fx = gk(ca, 'sfix').at(-1);
ok(fx && GARDEN_FIXTURES.every((f) => fx.list.some((w) => w[0] === f.id)), 'hello: the garden\'s bench, fire and forge are there');
// both walk to open lawn east of the pond (around it, not through it)
const spot = { x: 14, z: -9 };
const path = (i) => [[ca.x, 9.2], [16 + i, 9.2], [16 + i, -7.5], [spot.x + 1 + i * 0.8, spot.z + 1.6]];
await Promise.all([route(ca, path(0).slice(1).map((p, k) => (k === 0 ? [16, 9.2] : p))), route(cb, [[cb.x, 9.2], [17, 9.2], [17, -7.5], [spot.x + 2, spot.z + 1.8]])]);
const leftover = gk(ca, 'sfix').at(-1).list.filter((w) => w[7] === A.id); // an earlier run that stopped half way
for (const w of leftover) { g(ca, { k: 'sopen', id: w[0] }); await sleep(400); }
let n = gk(ca, 'sone').length;
g(ca, { k: 'splace', kind: 'chest', x: spot.x, y: 0, z: spot.z, yaw: 0, tile: '', ref: 'c' });
const put1 = await wait(ca, 'sone', n); const chest = put1 && put1.f[0];
ok(chest && put1.f[1] === 'chest' && put1.f[7] === A.id, 'A sets down a chest');
ok(gk(cb, 'sone').some((m) => m.f[0] === chest), 'B sees it appear');
await sleep(500); n = gk(ca, 'sone').length;
g(ca, { k: 'splace', kind: 'safe', x: spot.x + 1.6, y: 0, z: spot.z - 0.6, yaw: 0, tile: '', ref: 's' });
const put2 = await wait(ca, 'sone', n); const safe = put2 && put2.f[0];
ok(safe && put2.f[1] === 'safe', 'and a safe beside it');
// fill
n = gk(ca, 'sbox').length; g(ca, { k: 'sopen', id: chest }); let bx = await wait(ca, 'sbox', n);
ok(bx && bx.slots === 20, 'A opens the chest: 20 slots');
await sleep(250); n = gk(ca, 'sbox').length; g(ca, { k: 'sput', id: chest, item: 'mat:wood', n: 12 }); bx = await wait(ca, 'sbox', n);
ok(bx && bx.inv['mat:wood'] === 12, 'A puts 12 wood in');
await sleep(300); ok((binv(ca)['mat:wood'] || 0) === inv0['mat:wood'] - 12, `and the 12 came out of A's server bag (${inv0['mat:wood']} -> ${binv(ca)['mat:wood'] || 0})`);
n = gk(ca, 'sno').length; g(ca, { k: 'sput', id: chest, item: 'mat:wood', n: 9000 }); const dn = await wait(ca, 'sno', n); await sleep(300);
n = gk(ca, 'sbox').length; g(ca, { k: 'sopen', id: chest }); bx = await wait(ca, 'sbox', n);
ok(dn && /don't have/.test(dn.text) && bx && bx.inv['mat:wood'] === 12, 'the dupe hole: depositing 9000 wood A does not have is refused; the chest still has 12');
g(ca, { k: 'sopen', id: safe }); await sleep(300); n = gk(ca, 'sbox').length; g(ca, { k: 'sput', id: safe, item: 'mat:metal', n: 3 }); bx = await wait(ca, 'sbox', n);
ok(bx && bx.id === safe && bx.inv['mat:metal'] === 3, 'A locks 3 metal in the safe');
// B: the chest is open to anyone, the safe is not
n = gk(cb, 'sbox').length; g(cb, { k: 'sopen', id: chest }); bx = await wait(cb, 'sbox', n);
ok(bx && bx.inv['mat:wood'] === 12, 'B opens A\'s chest and sees the wood');
n = gk(cb, 'sgot').length; g(cb, { k: 'stake', id: chest, item: 'mat:wood', n: 2 }); const tk = await wait(cb, 'sgot', n);
ok(tk && tk.give['mat:wood'] === 2, 'B takes 2');
await sleep(400); const wb0 = binv(cb)['mat:wood'] || 0;
n = gk(cb, 'sno').length; g(cb, { k: 'sopen', id: safe }); const lk = await wait(cb, 'sno', n);
ok(lk && /Locked/.test(lk.text), 'B is locked out of the safe');
// no dupes: both take the last 10 at the same moment
const sum = () => [...gk(ca, 'sgot'), ...gk(cb, 'sgot')].reduce((s, m) => s + ((m.from === chest && m.give['mat:wood']) || 0), 0);
const s0 = sum();
g(ca, { k: 'stake', id: chest, item: 'mat:wood', n: 10 }); g(cb, { k: 'stake', id: chest, item: 'mat:wood', n: 10 });
await sleep(1500);
ok(sum() - s0 === 10, `both grab the last 10 at once: 10 come out in total, not 20 (${sum() - s0})`);
ok((binv(ca)['mat:wood'] || 0) - (inv0['mat:wood'] - 12) + (binv(cb)['mat:wood'] || 0) - wb0 + 2 === 12, 'and the server bags hold exactly the 12 that went in (A + B)');
// A lets B into the safe
n = gk(ca, 'sbox').length; g(ca, { k: 'sallow', id: safe, to: B.id, on: 1 }); bx = await wait(ca, 'sbox', n);
ok(bx && bx.allow && bx.allow.some((x) => x.id === B.id), 'A adds B to the safe');
await sleep(300); n = gk(cb, 'sbox').length; g(cb, { k: 'sopen', id: safe }); bx = await wait(cb, 'sbox', n);
ok(bx && bx.id === safe && bx.inv['mat:metal'] === 3, 'now B can open it');
// crafting: a spear needs a workbench
n = gk(ca, 'scraft').length; g(ca, { k: 'scraft', r: 'spear', ref: 'x1' }); let cr = await wait(ca, 'scraft', n);
ok(cr && cr.ok === false, 'a spear on the open lawn: the server says no');
// bad messages never close the socket: an oversized one, garbage fields, an unknown kind (10 of each)
for (let i = 0; i < 10; i++) { g(ca, { k: 'sallow', id: 'x'.repeat(400) }); g(ca, { k: 'splace', kind: 'tower', x: 'a', y: 0, z: 0, yaw: 0, tile: '' }); g(ca, { k: 'stake', id: 1, item: '..', n: -4 }); await sleep(120); }
await sleep(800); ok(ca.ws.readyState === 1 && gk(ca, 'sno').some((q) => /too much/.test(q.text)), '30 bad storage messages: polite refusals, still connected');
// reconnect: A drops and comes back; the chest, the safe and what is in them are still there
const prevA = { x: ca.x, z: ca.z, y: ca.y0 }; ca.ws.close(); await sleep(800);
ca = await join(A, prevA); cA = ca; await sleep(800); await bagHi(ca, A);
const fx2 = gk(ca, 'sfix').at(-1);
ok(fx2 && fx2.list.some((w) => w[0] === chest) && fx2.list.some((w) => w[0] === safe), 'A reconnects: both are still there');
await walk(ca, spot.x + 1, spot.z + 1.6);
n = gk(ca, 'sbox').length; g(ca, { k: 'sopen', id: safe }); bx = await wait(ca, 'sbox', n);
ok(bx && bx.inv['mat:metal'] === 3, 'and the metal is still in the safe');
// clean up: empty both, take them down (they go back in A's bag)
await sleep(250); g(ca, { k: 'stake', id: safe, item: 'mat:metal', n: 3 }); await sleep(400);
n = gk(ca, 'sgone').length; g(ca, { k: 'sdown', id: safe }); await wait(ca, 'sgone', n);
await sleep(450); n = gk(ca, 'sgone').length; g(ca, { k: 'sdown', id: chest }); await wait(ca, 'sgone', n);
ok(gk(ca, 'sgone').some((m) => m.id === safe) && gk(ca, 'sgone').some((m) => m.id === chest), 'A empties them and takes both down');
// the cove bench: the spear can be made there
const bench = GARDEN_FIXTURES.find((f) => f.kind === 'bench');
await route(ca, [[16, -9], [16, -18], [bench.x + 1.4, bench.z + 1.2]]);
n = gk(ca, 'scraft').length; g(ca, { k: 'scraft', r: 'spear', ref: 'x2' }); cr = await wait(ca, 'scraft', n);
ok(cr && cr.ok === true, 'at the cove workbench: yes');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
