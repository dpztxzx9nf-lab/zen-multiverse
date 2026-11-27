// Live (wrangler dev): two players in the shared garden. A builds, B sees it; B cannot take it down; A's catch
// at the cove is a real fish in A's hands. Needs `wrangler dev` with a fresh local state (auth rate limits).
import { SHARED_HOME, GARDEN_ARRIVAL } from '../../js/spawn.js';
import { at, fromHello, walkTo } from './garden-walk.mjs';
import { gardenLocal } from '../../js/hub.js';
const BASE = process.env.MP || 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
const api = async (p, b, t) => { const r = await fetch(BASE + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const tag = Date.now().toString(36);
async function signIn(who, name) { const s = await api('/auth/start', { email: `${who}+${tag}@example.com`, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email: `${who}+${tag}@example.com`, code: s.devCode, name }); return { ...v.account, token: v.token }; }
function connect(ticket) { return new Promise((res, rej) => { const ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`); const c = { ws, msgs: [], seq: 0, x: 0, z: 0 }; ws.onmessage = (e) => { try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } }; ws.onopen = () => res(c); ws.onerror = () => rej(new Error('ws')); }); }
const hi = async (c) => { for (let i = 0; i < 80 && !c.msgs.find((m) => m.t === 'hi'); i++) await sleep(50); return c.msgs.find((m) => m.t === 'hi'); };
const g = (c, m) => c.ws.send(JSON.stringify({ t: 'g', ...m }));
const gk = (c, k) => c.msgs.filter((m) => m.t === 'g' && m.k === k);
const walk = (c, tx, tz, y = 0) => walkTo(c, tx, tz, sleep, y);
const A = await signIn('builder', 'Brock'), B = await signIn('cousin', 'Cousin');
const ca = await connect((await api('/ticket', { world: SHARED_HOME }, A.token)).ticket); fromHello(ca, await hi(ca));
const cb = await connect((await api('/ticket', { world: SHARED_HOME }, B.token)).ticket); fromHello(cb, await hi(cb));
await walkTo(ca, GARDEN_ARRIVAL.x, GARDEN_ARRIVAL.z, sleep);
await walkTo(cb, GARDEN_ARRIVAL.x + 1.6, GARDEN_ARRIVAL.z, sleep);
for (let i = 0; i < 40 && !gk(ca, 'builds').length; i++) await sleep(50);
ok(gk(ca, 'builds').length >= 1 && Array.isArray(gk(ca, 'builds')[0].list), 'hello: the shared builds list');
await walk(ca, 14, 9.8); // open lawn (12,12) is the azalea hedge
g(ca, { k: 'bplace', type: 'floor', mat: 'wood', ...at(14, 12, 0.04), yaw: 0, ref: 'r1' }); await sleep(600);
const put = gk(cb, 'bput').at(-1);
ok(put && put.p[1] === 'floor' && put.by === A.id && gk(ca, 'bput').at(-1).ref === 'r1', 'A builds a floor and B sees it');
g(ca, { k: 'bplace', type: 'wall', mat: 'wood', ...at(14, 11.1, 1.2), yaw: 0, ref: 'r2' }); await sleep(600);
ok(gk(cb, 'bput').length === 2, 'a wall on the floor');
g(ca, { k: 'bplace', type: 'beam', mat: 'wood', ...at(15, 13, 4), yaw: 0, ref: 'r3' }); await sleep(600);
ok(gk(ca, 'bno').length === 1 && gk(cb, 'bput').length === 2, 'a beam in mid-air is refused');
await walk(cb, 15, 10.5);
g(cb, { k: 'bremove', id: put.p[0] }); await sleep(500);
ok(/Someone else/.test((gk(cb, 'bno').at(-1) || {}).text || ''), 'B cannot take down A\'s floor');
g(ca, { k: 'bremove', id: put.p[0] }); await sleep(600);
const del = gk(cb, 'bdel').at(-1);
ok(del && del.ids[0] === put.p[0] && del.fall.length === 1, 'A takes the floor down and the wall falls for B too');
// fishing at the cove
await walk(ca, 3, -24);
g(ca, { k: 'catch' }); await sleep(700);
ok(gk(ca, 'fishok').length === 1, 'a catch at the cove is accepted');
const items = ca.msgs.filter((m) => m.t === 'g' && m.k === 'items').at(-1);
ok(items && JSON.stringify(items).includes('fish'), 'and the fish is a real object the server shows');
// the garden animals (server/src/fauna.js): sent to both while people move, and a spear thrust from afar does nothing
const fa = gk(ca, 'fauna'), fb = gk(cb, 'fauna');
ok(fa.length > 5 && fb.length > 1 && fa[0].a.length === 6, `both players see the hares and the fox (${fa.length} / ${fb.length} updates)`);
const moved = fa[0].a.some((r, i) => { const l = fa.at(-1).a[i]; return Math.hypot(r[2] - l[2], r[3] - l[3]) > 0.3; });
ok(moved, 'and they move about on their own');
const me = gardenLocal(ca) || ca; const far = fa.at(-1).a.find((r) => r[5] !== 'dead' && Math.hypot(r[2] - me.x, r[3] - me.z) > 5);
g(ca, { k: 'fhit', id: far[0] }); await sleep(500);
ok((gk(ca, 'fres').at(-1) || {}).why === 'far', 'a thrust from ' + Math.hypot(far[2] - me.x, far[3] - me.z).toFixed(0) + ' m away is refused');
ca.ws.close(); cb.ws.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
