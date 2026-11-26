// One shared world: invites put you on the server, next to the inviter if they're playing, else at the
// world spawn; brand-new players land at the spawn. Needs `wrangler dev` (local D1 rate table cleared).
import { SHARED_HOME, WORLD_SPAWN } from '../../js/spawn.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`); const c = { ws, msgs: [], seq: 0 };
    ws.onmessage = (e) => { try { c.msgs.push(JSON.parse(e.data)); } catch { /* pong */ } };
    ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws'));
  });
}
const hi = async (c) => { for (let i = 0; i < 60 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const A = await signIn('host', 'Brock'), B = await signIn('cousin', 'Cousin'), C = await signIn('late', 'Late');
const inv = await api('/invite', {}, A.token);
ok(inv.world === SHARED_HOME, 'an invite is to the shared server, not a personal garden');
const page = await (await fetch(`${BASE}/j/${inv.code}`)).text();
ok(page.includes('join the server') && !/garden's|'s world/.test(page), 'the invite page talks about the server, not someone\'s garden');
// A is new: lands at the world spawn
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); const ha = await hi(ca);
ok(ha && ha.spawn === 'spawn' && Math.abs(ha.resume.x - WORLD_SPAWN.x) < 0.01 && Math.abs(ha.resume.z - WORLD_SPAWN.z) < 0.01, 'a brand-new player arrives at the world spawn');
// A walks a few metres off the spawn at a legal pace
let x = WORLD_SPAWN.x, z = WORLD_SPAWN.z;
for (let i = 0; i < 20; i++) { x += 0.4; ca.seq++; ca.ws.send(JSON.stringify({ t: 'p', x, y: 0, z, yaw: 0, s: ca.seq })); await sleep(100); }
await sleep(300);
// B redeems: gets near = A, and spawns next to A
const red = await api('/invite/redeem', { code: inv.code }, B.token);
ok(red.world === SHARED_HOME && red.near === A.id, 'redeeming says: the server, next to the inviter');
const cb = await connect((await api('/ticket', { world: SHARED_HOME, near: red.near }, B.token)).ticket); const hb = await hi(cb);
ok(hb && hb.spawn === 'near' && Math.hypot(hb.resume.x - x, hb.resume.z - z) < 2.2, `the joiner spawns next to the inviter (${hb && hb.resume && hb.resume.x},${hb && hb.resume && hb.resume.z} vs ${x.toFixed(2)},${z})`);
ok(hb.peers.some((p) => p.id === A.id), 'and sees them right away');
// the server accepts B's first step from there (no snap-back)
cb.seq++; cb.ws.send(JSON.stringify({ t: 'p', x: hb.resume.x + 0.3, y: 0, z: hb.resume.z, yaw: 0, s: cb.seq })); await sleep(400);
ok(!cb.msgs.some((m) => m.t === 'fix'), 'the first step from the spawn point is accepted');
// A leaves; C redeems the same invite: inviter offline -> world spawn
ca.ws.close(); await sleep(500);
const red2 = await api('/invite/redeem', { code: inv.code }, C.token);
const cc = await connect((await api('/ticket', { world: SHARED_HOME, near: red2.near }, C.token)).ticket); const hc = await hi(cc);
ok(hc && hc.spawn === 'spawn' && Math.abs(hc.resume.x - WORLD_SPAWN.x) < 0.01, 'inviter offline: the joiner lands at the world spawn');
// a friend's Join also says "next to them"
cb.ws.close(); cc.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
