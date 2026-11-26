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
db.exec("CREATE TABLE builds (id TEXT PRIMARY KEY, tile TEXT NOT NULL, typ TEXT NOT NULL, mat TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, aid TEXT, ts INTEGER, rg TEXT)");
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
// craft: a spear or a rod, made at a workbench (the shed's here; storage.js also counts the cove's and ones set down)
O.made(socks.get(A.aid), A, { id: 'glass' }, (T += 2000)); t(O.of(A.aid).step === 2, 'a bench recipe away from any bench does not count');
O.made(socks.get(A.aid), A, { id: 'nonsense' }, (T += 2000)); t(strikes.includes('made-id'), 'an unknown recipe is a strike');
O.made(socks.get(A.aid), A, { id: 'cloth' }, (T += 2000)); t(O.of(A.aid).step === 2, 'cloth woven in the hands is not the tool Ula asked for');
O.made(socks.get(A.aid), A, { id: 'spear' }, (T += 2000)); t(O.of(A.aid).step === 2, 'a spear claimed away from any workbench does not count');
B.x = 80; A.x = WORKSHOP.x - 1; A.z = WORKSHOP.z; O.made(socks.get(A.aid), A, { id: 'spear' }, (T += 2000));
t(O.of(A.aid).step === 3 && O.of(B.aid).step === 2, 'A makes a spear at the shed bench; B, far away now, does not get it');
B.x = WORKSHOP.x + 1; B.z = WORKSHOP.z; O.made(socks.get(B.aid), B, { id: 'glass' }, (T += 2000)); t(O.of(B.aid).step === 3, 'B makes glass at the shed bench');
O.made(socks.get(B.aid), B, { id: 'spear' }, (T += 100)); t(O.of(B.aid).step === 3, 'and not faster than hands work');
// fish: only at the cove, from the shared stock
A.x = 60; A.z = 60; games.pl.catch(socks.get(A.aid), A, (T += 7000)); t(O.of(A.aid).step === 3, 'a "catch" away from the cove does nothing');
A.x = COVE.x; A.z = COVE.z; B.x = COVE.x + 4; B.z = COVE.z;
games.pl.catch(socks.get(A.aid), A, (T += 7000));
t(O.of(A.aid).step === 4 && O.of(B.aid).step === 4 && items.length === 1, 'a fish from the cove: both move on, and the fish is a real thing in A\u2019s hands');
// build: two pieces by the water. On Xenia building is the world's (World.editBuild checks the spot and calls
// op.built for every piece placed on the hub frame); here the call is made directly
const spot = { x: COVE.x + 14, z: COVE.z - 6 }; t(atCove(spot.x, spot.z, 16), 'the test spot is by the cove');
O.built({ ...A, x: 60, z: 60 }, { type: 'floor', x: 60, y: 0.1, z: 60 }, (T += 400)); t(O.of(A.aid).step === 4 && !O.of(A.aid).n, 'a piece far from the water does not count');
A.x = spot.x + 1; A.z = spot.z; B.x = spot.x + 2; B.z = spot.z;
O.built(A, { type: 'floor', x: spot.x, y: 0.1, z: spot.z }, (T += 400));
t(O.of(A.aid).step === 4 && O.of(A.aid).n === 1, 'one piece by the cove: one of two');
O.built(A, { type: 'wall', x: spot.x, y: 1.2, z: spot.z + 0.9 }, (T += 400));
t(O.of(A.aid).step === 5, 'a second piece: the build step is done');
t(O.of(B.aid).step === 4 && O.of(B.aid).n === 2 || O.of(B.aid).step === 5, 'B, beside them, shared both pieces');
// a workbench built on the hub frame counts as a bench (world builds, tile '')
db.prepare("INSERT INTO builds (id, tile, typ, mat, x, y, z, yaw, aid, ts) VALUES ('bench1', '', 'bench', 'wood', 100, 0.45, 100, 0, ?, 1)").run(A.aid);
t(O.atBench({ x: 101, z: 100 }) && !O.atBench({ x: 140, z: 100 }), 'a workbench someone built in Home Valley is a bench');
// deliver: factions.js calls this when a camp takes a fish (that path is covered by server/test/factions.mjs)
t(/G\.op\.did\(a, 'deliver', t\)/.test(readFileSync(new URL('../src/factions.js', import.meta.url), 'utf8')), 'factions.js reports a fish handed to a camp');
O.did(A, 'deliver', (T += 1000));
t(O.of(A.aid).step === OPEN_STEPS.length + 1 && bumps.some(([aid, f]) => aid === A.aid && f.quests === 1), 'delivered: the walk is done and it counts on the board');
t(O.talk(A, T, [A]) === null, 'after the walk, Ula goes back to her own talk');
t(O.wire(C.aid) === null && O.wire(A.aid).step === 6, 'hello carries where you are on the walk');
const C2 = mk('d'.repeat(32), 0, 0); C2.world = 'home:someone'; O.did(C2, 'gather', T); t(O.of(C2.aid).step === 0, 'other worlds are left alone');
console.log(`opening-server: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
