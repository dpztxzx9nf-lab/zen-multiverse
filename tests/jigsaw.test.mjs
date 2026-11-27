// 0.2.34: jigsaw-grown POIs (Rattler camp, loot, terrain fit). No hand-placed globe coordinates.
import { readFileSync } from 'node:fs';
import {
  PIECES, TYPES, BIOME_TYPES, CELL, assemble, attachPose, obbOverlap, fitY,
  starterRattlerNear, clearJigsawCache, inFootprint, sitesNear,
} from '../js/game/jigsaw.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

ok(TYPES.includes('rattler') && PIECES.some((p) => p.id === 'rat-start'), 'Rattler pieces exist (start, rooms, tower)');
ok(PIECES.every((p) => p.connectors.every((c) => c.tag && Number.isFinite(c.x + c.z + c.yaw))), 'every piece has tagged connectors');
ok(BIOME_TYPES.forest.includes('rattler') && BIOME_TYPES.shore.includes('rattler'), 'Rustmesa and Shatter Coast can grow a Rattler camp');

const flat = () => 12;
const open = () => false;
const a = assemble('rattler', 7, 40, 80, 0.3, flat, open, {});
const b = assemble('rattler', 7, 40, 80, 0.3, flat, open, {});
ok(a && a.parts.length >= 2, `a Rattler camp assembles (${a && a.parts.length} pieces)`);
ok(a && b && a.parts.length === b.parts.length && a.parts.every((p, i) => p.piece.id === b.parts[i].piece.id && Math.abs(p.x - b.parts[i].x) < 1e-9), 'the same seed grows the same camp');
ok(a && a.loot && a.loot.length >= 1 && a.loot.every((L) => L.items['mat:scrap'] || L.items['mat:ore']), 'the camp has basic scrap/ore loot');
ok(a && a.parts.every((p, i) => a.parts.every((q, j) => i >= j || !obbOverlap(p, q))), 'assembled pieces do not overlap');

const drop = (x, z) => (Math.hypot(x - 40, z - 80) < 1 ? 12 : 0);
ok(fitY(drop, { type: 'rattler' }, PIECES.find((p) => p.id === 'rat-start'), 40, 80, 0) == null, 'a piece is rejected when it would float over a drop');

const start = PIECES.find((p) => p.id === 'rat-start');
const hall = PIECES.find((p) => p.id === 'rat-hall');
const pose = attachPose({ x: 0, z: 0, yaw: 0 }, start.connectors[0], hall, hall.connectors.find((c) => c.tag === start.connectors[0].tag));
ok(Number.isFinite(pose.x + pose.z + pose.yaw), 'connectors snap to a real pose');

clearJigsawCache();
const city = (x, z) => Math.abs(x) < 80 && Math.abs(z) < 80;
const starter = starterRattlerNear({ seed: 11, tile: '1:1:1', hubX: 0, hubZ: 0, ground: flat, blocked: city });
ok(starter && starter.type === 'rattler' && starter.starter && starter.parts.length >= 2, `a starter Rattler camp grows outside the city (at ${starter && starter.x.toFixed(0)},${starter && starter.z.toFixed(0)})`);
ok(starter && !city(starter.x, starter.z), 'the starter camp is not in the blocked city footprint');
ok(starter && starter.loot.length >= 1, 'the starter camp has loot');
ok(!inFootprint(starter, 0, 0), 'the city plaza is not inside the starter camp');

clearJigsawCache();
const near = sitesNear({ seed: 11, tile: '1:1:1' }, starter.x, starter.z, 80, { ground: flat, blocked: city, hubX: 0, hubZ: 0, biome: () => 'forest' });
ok(near.some((s) => s.starter && s.type === 'rattler'), 'sitesNear includes the starter Rattler camp');

const src = readFileSync(new URL('../js/game/jigsaw.js', import.meta.url), 'utf8');
ok(!/x:\s*-?\d{2,}/.test(src.split('export const PIECES')[0]) && !/HUB_SPAWN|GARDEN_ARRIVAL/.test(src), 'the assembler has no hand-placed globe coordinates');
ok(CELL >= 80, 'structures are chosen on a region grid, not a fixed list');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
