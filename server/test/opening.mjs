// node server/test/opening.mjs: Ula's opening walk (server/src/opening.js) driven through the real Places and
// Builds code with an in-memory SQLite: gather, craft, fish, build, deliver, and two people sharing it.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Opening } from '../src/opening.js';
import { Places } from '../src/places.js';
import { Builds } from '../src/builds.js';
import { SHARED_HOME } from '../src/worlds.js';
import { NODES, atCove } from '../../js/places.js';
import { COVE } from '../../js/cove.js';
import { WORKSHOP, OPEN_STEPS } from '../../js/opening.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
const socks = new Map(), sent = new Map(), strikes = [], bumps = [];
const mk = (aid, x, z) => { const a = { aid, name: aid.slice(0, 3), world: SHARED_HOME, tile: null, x, y: 0, z }; socks.set(aid, { a }); sent.set(aid, []); return a; };
const w = { sql, send: (ws, m) => sent.get(ws.a.aid).push(m), strike: (ws, a, n, why) => strikes.push(why), broadcast: () => {}, env: {} };
const items = [];
const games = { sock: (aid) => socks.get(aid) || null, present: () => [...socks.values()].map((s) => s.a), sys: (ws, text) => w.send(ws, { t: 'g', k: 'say', text }),
  held: (aid) => items.filter((i) => i.by === aid), addItem: (k, at, by) => items.push({ k, by }), pushItems: () => {}, bump: (aid, name, f) => bumps.push([aid, f]), board: () => [] };
games.bd = new Builds(w, games); games.pl = new Places(w, games); games.op = new Opening(w, games);
const O = games.op;
const A = mk('a'.repeat(32), 0, 0), B = mk('b'.repeat(32), 2, 0), C = mk('c'.repeat(32), 60, 60);
const got = (a, k) => sent.get(a.aid).filter((m) => m.k === k);
let T = 1e7;
// the shed bench in js/opening.js is the one in the game
t(/SHED = \{ x: 20\.2, z: 2\.6/.test(readFileSync(new URL('../../js/game/earth-rocket.js', import.meta.url), 'utf8')) && WORKSHOP.x === 20.2 && WORKSHOP.z === 2.6, 'workbench spot matches the shed');
// Ula speaks to A; B is close enough to hear, C is across the garden
const r = O.talk(A, (T += 1000), [A, B]);
t(r.step === 1 && O.of(A.aid).step === 1 && O.of(B.aid).step === 1 && got(B, 'open')[0].step === 1, 'Ula starts the walk for A and for B who heard her');
t(O.of(C.aid).step === 0, 'C, out of earshot, has not started');
// gather: a real driftwood node, from within reach; B stands close by
const d = NODES.find((n) => n.kind === 'drift');
A.x = d.x; A.z = d.z; B.x = d.x + 3; B.z = d.z; C.x = d.x + 40;
O.made(socks.get(A.aid), A, { id: 'spear' }, (T += 2000)); t(O.of(A.aid).step === 1, 'making something before gathering does not skip ahead');
games.pl.ntake(socks.get(A.aid), A, { id: d.id }, (T += 1000));
t(O.of(A.aid).step === 2 && O.of(B.aid).step === 2 && got(B, 'open').at(-1).by === A.name, 'gathering moves A, and B working beside them');
// craft: the spear can be made in the hands; glass needs the bench
O.made(socks.get(A.aid), A, { id: 'glass' }, (T += 2000)); t(O.of(A.aid).step === 2, 'a bench recipe away from any bench does not count');
O.made(socks.get(A.aid), A, { id: 'nonsense' }, (T += 2000)); t(strikes.includes('made-id'), 'an unknown recipe is a strike');
B.x = 80; O.made(socks.get(A.aid), A, { id: 'spear' }, (T += 2000));
t(O.of(A.aid).step === 3 && O.of(B.aid).step === 2, 'A makes a spear; B, far away now, does not get it');
B.x = WORKSHOP.x + 1; B.z = WORKSHOP.z; O.made(socks.get(B.aid), B, { id: 'glass' }, (T += 2000)); t(O.of(B.aid).step === 3, 'B makes glass at the shed bench');
O.made(socks.get(B.aid), B, { id: 'spear' }, (T += 100)); t(O.of(B.aid).step === 3, 'and not faster than hands work');
// fish: only at the cove, from the shared stock
A.x = 60; A.z = 60; games.pl.catch(socks.get(A.aid), A, (T += 7000)); t(O.of(A.aid).step === 3, 'a "catch" away from the cove does nothing');
A.x = COVE.x; A.z = COVE.z; B.x = COVE.x + 4; B.z = COVE.z;
games.pl.catch(socks.get(A.aid), A, (T += 7000));
t(O.of(A.aid).step === 4 && O.of(B.aid).step === 4 && items.length === 1, 'a fish from the cove: both move on, and the fish is a real thing in A\u2019s hands');
// build: two standing pieces by the water (searched for a spot builds.js accepts)
let spot = null;
for (let th = 0; th < 6.28 && !spot; th += 0.2) for (const rr of [13, 15, 17, 19]) {
  const x = COVE.x + Math.sin(th) * rr, z = COVE.z + Math.cos(th) * rr; if (!atCove(x, z, 16)) continue;
  A.x = x + 1; A.z = z; const n = got(A, 'bput').length; games.bd.place(socks.get(A.aid), A, { type: 'floor', mat: 'wood', x, y: 0.1, z, yaw: 0 }, (T += 400));
  if (got(A, 'bput').length > n) { spot = { x, z }; break; }
}
t(!!spot && O.of(A.aid).step === 4 && O.of(A.aid).n === 1, 'one piece by the cove: one of two');
B.x = spot.x + 2; B.z = spot.z;
games.bd.place(socks.get(A.aid), A, { type: 'wall', mat: 'wood', x: spot.x, y: 1.2, z: spot.z + 0.9, yaw: 0 }, (T += 400));
t(O.of(A.aid).step === 5, 'a second piece standing on it: the build step is done');
t(O.of(B.aid).step === 4 && O.of(B.aid).n === 2 || O.of(B.aid).step === 5, 'B, beside them, shared both pieces');
// deliver: factions.js calls this when a camp takes a fish (that path is covered by server/test/factions.mjs)
t(/G\.op\.did\(a, 'deliver', t\)/.test(readFileSync(new URL('../src/factions.js', import.meta.url), 'utf8')), 'factions.js reports a fish handed to a camp');
O.did(A, 'deliver', (T += 1000));
t(O.of(A.aid).step === OPEN_STEPS.length + 1 && bumps.some(([aid, f]) => aid === A.aid && f.quests === 1), 'delivered: the walk is done and it counts on the board');
t(O.talk(A, T, [A]) === null, 'after the walk, Ula goes back to her own talk');
t(O.wire(C.aid) === null && O.wire(A.aid).step === 6, 'hello carries where you are on the walk');
const C2 = mk('d'.repeat(32), 0, 0); C2.world = 'home:someone'; O.did(C2, 'gather', T); t(O.of(C2.aid).step === 0, 'other worlds are left alone');
console.log(`opening-server: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
