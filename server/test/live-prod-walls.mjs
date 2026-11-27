// LIVE check of server walls and bodies on the real server (default https://play.thinkcore.io), two signed-in test
// accounts from SESS (same file as live-prod.mjs, never committed). Both walk to the garden wall's lawn with no shapes
// version (not checked), then A sends this build's SOLIDS_V and: walks into the garden wall (snap back 'wall'),
// walks into B (snap back 'body', then gives way), B never corrected. No socket closes, no other fixes.
//   SESS=/path/sessions.json node server/test/live-prod-walls.mjs
import fs from 'node:fs';
import { SHARED_HOME } from '../../js/spawn.js';
import { SOLIDS_V } from '../../js/solids-v.js';
const BASE = process.env.MP || 'https://play.thinkcore.io';
const WS = BASE.replace(/^http/, 'ws');
const S = JSON.parse(fs.readFileSync(process.env.SESS, 'utf8')); const [KA, KB] = Object.keys(S);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}&b=1`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0, closed: null };
  ws.onmessage = (e) => { if (e.data === 'pong') return; try { const m = JSON.parse(e.data); c.msgs.push(m); if (m.t === 'fix') { c.x = m.x; c.z = m.z; c.fix = m.id; } } catch { /* */ } };
  ws.onclose = (e) => { c.closed = e.code; }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 100 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const fixes = (c, why) => c.msgs.filter((m) => m.t === 'fix' && (!why || m.why === why));
const pose = (c, x, z) => { c.seq++; const m = { t: 'p', x: +x.toFixed(3), y: 0, z: +z.toFixed(3), yaw: 0, s: c.seq, ct: Date.now() % 1e9 }; if (c.fix) m.r = c.fix; c.x = m.x; c.z = m.z; c.ws.send(JSON.stringify(m)); };
// a legal pace (0.4 m per 100 ms); stops at the first correction like a player would
async function walk(c, tx, tz) { const f0 = fixes(c).length;
  while (Math.hypot(tx - c.x, tz - c.z) > 0.05) { if (fixes(c).length > f0) return false; const d = Math.hypot(tx - c.x, tz - c.z), s = Math.min(0.4, d); pose(c, c.x + (tx - c.x) / d * s, c.z + (tz - c.z) / d * s); await sleep(100); }
  await sleep(300); return fixes(c).length === f0; }
const A = { ...S[KA].account, token: S[KA].token }, B = { ...S[KB].account, token: S[KB].token };
const t0 = Date.now();
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); const ha = await hi(ca);
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); const hb = await hi(cb);
ok(ha && hb, 'both join the shared world');
ca.x = ha.resume.x; ca.z = ha.resume.z; cb.x = hb.resume.x; cb.z = hb.resume.z;
const ping = setInterval(() => { for (const c of [ca, cb]) if (c.ws.readyState === 1) c.ws.send('ping'); }, 4000);
g(ca, { k: 'v' }); g(cb, { k: 'v' }); await sleep(500);
// out to the lawn inside the south garden wall (east of the bonsai, round the far side of everything)
const route = async (c, pts) => { for (const [x, z] of pts) await walk(c, x, z); };
await Promise.all([route(ca, [[ca.x, 9.2], [-4, 9.2], [-4, -10.5], [0, -10.5]]), route(cb, [[cb.x, 9.4], [-5, 9.4], [-5, -9.6], [0, -9.6]])]);
ok(!fixes(ca).length && !fixes(cb).length, `both on the lawn, no corrections on the way (A ${ca.x.toFixed(1)},${ca.z.toFixed(1)}; B ${cb.x.toFixed(1)},${cb.z.toFixed(1)})`);
g(ca, { k: 'v', sol: SOLIDS_V }); await sleep(500); // A now runs this build: held to its walls
ok(!(await walk(ca, 0, -14)) && fixes(ca, 'wall').length === 1 && ca.z > -12.6, `A walks into the garden wall: snapped back (z ${ca.z})`);
const fb = fixes(ca, 'body').length; let passed = false;
for (let i = 0; i < 60 && !passed; i++) { pose(ca, ca.x, ca.z + 0.25); await sleep(100); passed = ca.z > -8.8; }
ok(fixes(ca, 'body').length > fb, `A walks into B: refused (${fixes(ca, 'body').length - fb} snaps)`);
ok(passed, 'and after pressing on, A gives way past B');
ok(!fixes(cb).length, 'B was never corrected or moved');
const odd = [...fixes(ca), ...fixes(cb)].filter((m) => m.why !== 'wall' && m.why !== 'body');
ok(!odd.length && ca.closed == null && cb.closed == null, `no other corrections, both sockets open (${odd.map((m) => m.why).join(',') || 'none'})`);
await walk(ca, 0, -8); clearInterval(ping); ca.ws.close(); cb.ws.close();
console.log(`window ${new Date(t0).toISOString()} .. ${new Date().toISOString()}`);
console.log(fails ? `live-prod-walls: ${fails} FAILED` : 'live-prod-walls: all passed'); process.exit(fails ? 1 : 0);
