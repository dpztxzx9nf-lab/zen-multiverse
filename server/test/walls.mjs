// node server/test/walls.mjs: walls are real for everyone (server/src/solids.js), in memory.
// Each check walks a step the way the pose handler does (world.js: wall() then body()) and expects the step refused
// exactly where the client's own colliders would stop her: the garden's baked scenery, a camp tent, the camp gate
// (closed / let in), a chest set down, an upright build piece, people, camp folk and animals (capsules, with the
// give-way after BODY_YIELD_MS so nobody can be walled in), and never anything the client would let her through.
import { Solids, SOLIDS_V } from '../src/solids.js';
import { SOLIDS } from '../../js/solids-data.js';
import { SOLIDS_V as CLIENT_V } from '../../js/solids-v.js';
import { cellBits, BODY_YIELD_MS } from '../../js/solids.js';
import { SHARED_HOME } from '../src/worlds.js';
import { HUB_SPAWN, EARTH_SITE, HUB_PAD_Y, HUB_BOXES } from '../../js/hub.js';
import { parseWorld } from '../src/worlds.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };

const people = [], fixtures = [], pieces = [], animals = [];
const sim = { st: null, pos: (n) => ({ x: n.x, z: n.z }) };
const w = { fa: { sim }, parsed: (n) => parseWorld((n || '').split('#')[0]) };
const games = { present: () => people, st: { all: () => fixtures }, bd: { here: (a) => (a.tile || null) === null, all: () => pieces },
  fa: { here: (a) => (a.tile || null) === null, st: { animals } } };
const S = new Solids(w, games);
const me = (x, z, y = 0) => ({ aid: 'a'.repeat(32), world: SHARED_HOME, tile: null, x, y, z });
// walk from (x0,z0) toward (x1,z1) in 0.5 m steps (a pose every 100 ms at 5 m/s), stop at the first refused step
function walk(x0, z0, x1, z1, y = 0) {
  const a = me(x0, z0, y), L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.5);
  for (let i = 1; i <= n; i++) { const next = { x: x0 + (x1 - x0) * i / n, y, z: z0 + (z1 - z0) * i / n, tile: null }; if (S.wall(a, next)) return { stop: a, why: 'wall' }; a.x = next.x; a.z = next.z; }
  return { stop: a, why: null };
}
const cellOf = (name) => { const c = SOLIDS.garden.find((g) => g.name === name); const b = cellBits({ ...c }); const k = b.indexOf(1); return [c.x0 + (k % c.nx + 0.5) * c.cs, c.z0 + (Math.floor(k / c.nx) + 0.5) * c.cs, c]; };

t(SOLIDS_V === CLIENT_V, 'the client build and the server collide with the same generated shapes (js/solids-v.js = js/solids-data.js)');
// ---- fixed scenery: the garden wall and the shed, from their own meshes
{ const r = walk(0, -10, 0, -15); t(r.why === 'wall' && r.stop.z > -12.6, `walking south into the garden wall stops at it (stopped at z ${r.stop.z.toFixed(2)})`); }
{ const [x, z] = cellOf('shed'); const r = walk(x - 3, z, x + 0.3, z); t(r.why === 'wall', 'walking into the shed wall stops'); }
{ const r = walk(18.6, 2.6, 20.2, 2.6); t(r.why === null, 'walking into the open front of the shed is fine'); }
{ const r = walk(0, -10, 0, -15, 3); t(r.why === null, 'high above the wall (a jump / jet boots): not blocked'); }
// ---- a camp tent and the camp gate, from the camp prefabs where the camp stands
sim.st = { kind: 'camp', anchor: { x: 40, z: 40, tile: null }, props: [{ k: 'tent', x: 40, z: 40 }, { k: 'none', x: 46, z: 40, gate: { x: 46, z: 40 } } /* just the leaf (a tent's walls are checked above) */], caches: {}, npcs: {} };
{ const r = walk(40, 35, 40, 41); t(r.why === 'wall', 'walking into a camp tent stops at its canvas'); }
{ const G = SOLIDS.gate, hx = 46 + G.hinge.dx, hz = 40 + G.hinge.dz, mx = hx + Math.cos(G.hinge.closed) * 0.65, mz = hz - Math.sin(G.hinge.closed) * 0.65;
  const dx = Math.sin(G.hinge.closed), dz = Math.cos(G.hinge.closed);
  const r = walk(mx - dx * 2, mz - dz * 2, mx + dx * 2, mz + dz * 2); t(r.why === 'wall', 'the closed camp gate stops you');
  S.gateOk.add('a'.repeat(32)); S.camp = null;
  const r2 = walk(mx - dx * 2, mz - dz * 2, mx + dx * 2, mz + dz * 2); t(r2.why === null, 'once the camp opens it to you, you walk through');
  S.gateOk.clear(); }
sim.st = null; S.camp = null;
// ---- a chest set down and an upright wall piece (rigid bodies at their own pose, not baked scenery)
fixtures.push({ id: 'f1', kind: 'chest', x: 25, z: -20, y: 0, yaw: 0.4, tile: null }); S.forget();
{ const r = walk(25, -23, 25, -19); t(r.why === 'wall', 'walking into a chest someone set down stops'); }
fixtures.length = 0; S.forget();
{ const r = walk(25, -23, 25, -19); t(r.why === null, 'picked up again: the spot is open'); }
pieces.push({ id: 'p1', type: 'wall', x: 30, y: 1.2, z: -20, yaw: 0 }); S.forget();
{ const r = walk(30, -23, 30, -17); t(r.why === 'wall', 'a built wall stops you'); }
pieces.length = 0; S.forget();
// ---- bodies: people, camp folk and animals are capsules; nobody moves anyone; after a while you slip past
const B = { aid: 'b'.repeat(32), world: SHARED_HOME, tile: null, x: 25, y: 0, z: -20 }; people.push(B);
{ const a = me(25, -21.2); let T = 1e6, blocked = 0, passed = false;
  for (let i = 0; i < 40 && !passed; i++, T += 100) { const next = { x: 25, y: 0, z: a.z + 0.2, tile: null }; if (S.body(a, next, T)) blocked++; else { a.z = next.z; if (a.z > -19.6) passed = true; } }
  t(blocked > 0 && blocked * 100 < BODY_YIELD_MS, `walking into another player is refused (${blocked} steps), then she gives way so nobody is walled in`);
  t(B.x === 25 && B.z === -20, 'and the other player is never moved (no shoving)'); }
{ const a = me(25, -21.2), T = 2e6; t(!S.body(a, { x: 25.8, y: 0, z: -21.2, tile: null }, T), 'stepping sideways, away from her: fine'); a.x = 25; a.z = -20.2; a.bpT = 0;
  t(!S.body(a, { x: 25, y: 0, z: -20.8, tile: null }, T), 'already overlapping (she walked onto you): stepping out is always fine'); }
people.length = 0;
animals.push({ id: 'h1', sp: 'hare', x: 25, z: -20 }); { const a = me(25, -21); t(!S.body(a, { x: 25, y: 0, z: -20.1, tile: null }, 3e6), 'a hare is too low to stop you'); }
animals[0] = { id: 'f1', sp: 'fox', x: 25, z: -20 }; { const a = me(25, -21); t(S.body(a, { x: 25, y: 0, z: -20.2, tile: null }, 4e6), 'a fox stops you'); }
animals.length = 0;
sim.st = { kind: 'camp', anchor: { x: 60, z: 60, tile: null }, props: [], caches: {}, npcs: { n1: { id: 'n1', st: 'ok', x: 25, z: -20 } } };
{ const a = me(25, -21); t(S.body(a, { x: 25, y: 0, z: -20.2, tile: null }, 5e6), 'a camp guard on his feet stops you'); }
sim.st.npcs.n1.st = 'downed'; { const a = me(25, -21); t(!S.body(a, { x: 25, y: 0, z: -20.2, tile: null }, 6e6), 'a guard lying down does not'); }
// ---- Xenia city hub on the home Earth spawn tile
function walkHub(x0, z0, x1, z1, y = HUB_PAD_Y) {
  const a = { ...me(x0, z0, y), tile: EARTH_SITE.tile };
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.5);
  for (let i = 1; i <= n; i++) {
    const next = { x: x0 + (x1 - x0) * i / n, y, z: z0 + (z1 - z0) * i / n, tile: EARTH_SITE.tile };
    if (S.wall(a, next)) return { stop: a, why: 'wall' };
    a.x = next.x; a.z = next.z;
  }
  return { stop: a, why: null };
}
{ const r = walkHub(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN.x + 2, HUB_SPAWN.z); t(r.why === null, 'walking around the plaza spawn is open'); }
{ const bank = HUB_BOXES.find((b) => b.name === 'bank-tower');
  const d = bank.hd + 4, cs = Math.cos(bank.ry || 0), sn = Math.sin(bank.ry || 0);
  const r = walkHub(bank.x - d * sn, bank.z - d * cs, bank.x, bank.z);
  t(r.why === 'wall', 'walking into the bank tower stops at it'); }
{ const r = walk(HUB_SPAWN.x, HUB_SPAWN.z, HUB_SPAWN.x + 1, HUB_SPAWN.z); t(r.why === null, 'hub boxes do not apply in the garden frame (tile null)'); }
console.log(`walls: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
