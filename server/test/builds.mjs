// node server/test/builds.mjs: shared building checks (server/src/builds.js) with an in-memory SQLite.
import { DatabaseSync } from 'node:sqlite';
import { Builds, grounded, standing } from '../src/builds.js';
import { SHARED_HOME } from '../src/worlds.js';
import { Bag } from '../src/bag.js';
import { Games } from '../src/games.js';
import { d1 } from './lib/d1mock.mjs';
import { PIECES } from '../../js/game/g7/pieces.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
const socks = new Map(), sent = new Map(), strikes = [];
const mk = (aid, x, z, y = 0) => { const a = { aid, world: SHARED_HOME, tile: null, x, y, z }; socks.set(aid, { a }); sent.set(aid, []); return a; };
const w = { sql, send: (ws, m) => sent.get(ws.a.aid).push(m), strike: (ws, a, n, why) => strikes.push(why) };
const games = { sock: (aid) => socks.get(aid) || null, present: () => [...socks.values()].map((s) => s.a), grant: (ws, a, m) => Games.prototype.grant.call({ w }, ws, a, m) }; // the real hand-over (server/src/games.js)
const B = new Builds(w, games);
const A = mk('a'.repeat(32), 20, -20), C = mk('c'.repeat(32), 22, -20);
const got = (a, k) => sent.get(a.aid).filter((m) => m.k === k);
let T = 1e6; const put = (a, m) => B.place(socks.get(a.aid), a, m, (T += 300));
// a floor on the lawn (dims 2 x 0.2 x 2: centre 0.1 above the ground)
await put(A, { type: 'floor', mat: 'wood', x: 21, y: 0.1, z: -21, yaw: 0 });
t(got(A, 'bput').length === 1 && got(C, 'bput').length === 1, 'a floor on the ground: placed, and both players see it');
const fid = got(A, 'bput')[0].p[0];
await put(A, { type: 'wall', mat: 'stone', x: 21, y: 1.2, z: -20.1, yaw: 0 }); t(got(A, 'bput').length === 2, 'a wall standing on the floor');
await put(A, { type: 'beam', mat: 'wood', x: 21, y: 2.32, z: -20.1, yaw: 0 }); t(got(A, 'bput').length === 3, 'a beam on top of the wall');
await put(A, { type: 'beam', mat: 'wood', x: 25, y: 4, z: -24, yaw: 0 }); t(got(A, 'bput').length === 3 && /rest on the ground/.test(got(A, 'bno').at(-1).text), 'a beam floating in the air is refused');
await put(A, { type: 'floor', mat: 'wood', x: 40, y: 0.1, z: -20, yaw: 0 }); t(/Too far/.test(got(A, 'bno').at(-1).text), 'out of reach is refused');
A.x = 10; A.z = 1; await put(A, { type: 'floor', mat: 'wood', x: 10.2, y: 0.1, z: 1.2, yaw: 0 }); t(/pond/.test(got(A, 'bno').at(-1).text), 'not in the pond');
A.x = 3.5; A.z = 8; await put(A, { type: 'floor', mat: 'wood', x: 3.5, y: 0.1, z: 9.8, yaw: 0 }); t(/arrival stone/.test(got(A, 'bno').at(-1).text), 'not on the spawn');
A.x = 20; A.z = -20;
await put(A, { type: 'tower', mat: 'wood', x: 21, y: 0.1, z: -19, yaw: 0 }); t(!strikes.length && /can't be built/.test(got(A, 'bno').at(-1).text), 'an unknown piece is answered, not a strike');
await put(A, { type: 'floor', mat: 'gold', x: 21, y: 0.1, z: -19, yaw: 0 }); t(!strikes.length && /can't be built/.test(got(A, 'bno').at(-1).text), 'a material the piece has no recipe for is answered, not a strike');
await put(A, { type: 'floor', mat: 'wood', x: 21, y: 0.1, z: -21, yaw: 0 }); t(/already/.test(got(A, 'bno').at(-1).text), 'not two floors in one place');
await B.place(socks.get(A.aid), A, { type: 'post', mat: 'wood', x: 19, y: 1, z: -19, yaw: 0 }, T + 50); t(got(A, 'bput').length === 3, 'faster than a person can build does not count');
// taking down: only the builder; what it held up falls for everyone
await B.remove(socks.get(C.aid), C, { id: fid }, (T += 300)); t(/Someone else/.test(got(C, 'bno').at(-1).text), 'someone else cannot take your floor');
await B.remove(socks.get(A.aid), A, { id: fid }, (T += 300));
const del = got(C, 'bdel').at(-1); t(del && del.ids[0] === fid && del.fall.length === 2, 'the floor comes down and the wall and beam on it fall');
t(got(A, 'grant').at(-1).give['mat:wood'] === 2, 'the builder gets the floor\'s wood back');
t(B.all().length === 0, 'nothing left standing');
// the cove bank is lower than the lawn: a post resting on the bed counts as grounded
t(grounded({ type: 'post', x: 2, y: -4.67 + 1 - 0.06, z: -33, yaw: 0 }), 'a post on the cove bed stands');
t(!grounded({ type: 'post', x: 2, y: 3, z: -33, yaw: 0 }), 'a post hanging over the cove does not');
t(standing([{ id: 'a', type: 'floor', x: 0, y: 0.1, z: 30, yaw: 0 }, { id: 'b', type: 'floor', x: 2, y: 0.1, z: 30, yaw: 0 }]).size === 2, 'standing: two floors side by side');
// a client that keeps its bag on the server: the piece is paid from that bag before it stands
w.env = { DB: d1() }; w.flag = async () => {}; w.att = (ws) => ws.a; w.bag = new Bag(w);
const D = mk('d'.repeat(32), 24, -14); D.bag = true; D.dev = 'devD0001';
const cost = PIECES.floor.mats.wood;
await w.bag.give(D, { ...cost });
await put(D, { type: 'floor', mat: 'wood', x: 25, y: 0.1, z: -15, yaw: 0, ref: 'r1' });
const bp = got(D, 'bput').at(-1);
t(bp && bp.led === 1 && !Object.keys(await w.bag.inv(D)).length, `a bag client's floor: paid from the server bag (${JSON.stringify(cost)}), and it says so (led)`);
await put(D, { type: 'floor', mat: 'wood', x: 27.5, y: 0.1, z: -15, yaw: 0 });
t(got(D, 'bput').length === 1 && /Not enough/.test(got(D, 'bno').at(-1).text), 'with nothing left in the bag: refused, nothing built');
await B.remove(socks.get(D.aid), D, { id: bp.p[0] }, (T += 300));
t(JSON.stringify(await w.bag.inv(D)) === JSON.stringify(cost), 'taken down: the wood is back in the server bag');
console.log(`builds: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
