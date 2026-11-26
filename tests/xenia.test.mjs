// node tests/xenia.test.mjs: Xenia's geometry and regions (js/xenia/xenia.js) and the server's view of them
// (server/src/sphere.js): the hub frame sits on the sphere, so walking from it onto a tile is a short step,
// not a teleport; the regions tag positions safe / guarded / contested / wild; the relief is real.
import { XENIA, hubFrame, regionAt, REGIONS, PEAK, hubHeight, xeniaHeight, HUB_OUT, HUB_IN } from '../js/xenia/xenia.js';
import { makeFrame as cMake, tileOf, shouldRebase } from '../js/universe/sphere.js';
import { surfaceDist, frameOf, tileOk } from '../server/src/sphere.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const R = XENIA.R, H = hubFrame(R);
// evenly spread directions over the globe (Fibonacci sphere)
const globe = (n) => Array.from({ length: n }, (_, i) => { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), v = i * 2.399963; return [r * Math.cos(v), y, r * Math.sin(v)]; });
// the hub frame: origin at 25 N, a round trip through a direction is exact
{ const d = H.toDir(0, 0); t(Math.abs(Math.asin(d[1]) * 180 / Math.PI - XENIA.lat) < 0.01, 'the hub frame is centred at 25 N');
  const [x, z] = H.fromDir(H.toDir(812.5, -403.25)); t(Math.hypot(x - 812.5, z + 403.25) < 1e-6, 'hub frame round trip'); }
// hand-over at HUB_OUT: the same point in the hub frame and its tile frame is 0 m apart on the server
{ const p = [HUB_OUT + 5, 40], d = H.toDir(p[0], p[1]), tile = tileOf(R, d), F = cMake(R, tile), [tx, tz] = F.fromDir(d);
  t(tileOk(tile, R), 'the hand-over tile is a valid tile id');
  t(surfaceDist({ x: p[0], z: p[1], tile: null }, { x: tx, z: tz, tile }, R, true) < 0.05, 'hub -> tile at the same spot: no distance (not a teleport)');
  t(surfaceDist({ x: 0, z: 0, tile: null }, { x: tx, z: tz, tile }, R, true) > HUB_OUT, 'hub origin -> that tile point: the real distance');
  t(surfaceDist({ x: 0, z: 0, tile: null }, { x: tx, z: tz, tile }, R, false) !== surfaceDist({ x: 0, z: 0, tile: null }, { x: tx, z: tz, tile }, R, true), 'off Xenia a flat frame is not on the sphere');
  t(frameOf(R, null, true).id === 'hub' && frameOf(R, null, false) === null, 'frameOf: hub only on Xenia');
  t(shouldRebase(H, HUB_OUT + 1, 0, 150, true) && !shouldRebase(H, HUB_OUT - 1, 0, 150, true), 'the client leaves the hub frame past HUB_OUT');
  t(HUB_IN < HUB_OUT, 'hysteresis: back into the hub frame only well inside'); }
// regions: 8, spawn is safe Home Valley, risk rises with distance, the far side is wild
{ t(REGIONS.length === 8, 'eight regions');
  t(regionAt(H.toDir(3.5, 9.8), R).id === 'home' && regionAt(H.toDir(3.5, 9.8), R).risk === 'safe', 'the spawn is in Home Valley, safe');
  const anti = H.toDir(Math.PI * R * 0.98, 0); t(['wild', 'contested'].includes(regionAt(anti, R).risk), 'the far side of the globe is not safe');
  const seen = new Set(); for (const d of globe(4000)) seen.add(regionAt(d, R).id);
  t(seen.size === 8, `every region is somewhere on the globe (${seen.size})`); }
// relief: the garden is level, Grey Peak stands about 900 m, there is sea
{ t(Math.abs(hubHeight(1.5, -0.5)) < 0.01 && Math.abs(hubHeight(3.5, 9.8)) < 0.01, 'the garden and spawn are level ground');
  const pk = xeniaHeight(H.toDir(PEAK.x, PEAK.z), R); t(pk > 750 && pk < 1100, `Grey Peak about 900 m (${pk.toFixed(0)})`);
  let sea = 0; for (const d of globe(2000)) if (xeniaHeight(d, R) < XENIA.sea) sea++;
  t(sea > 200 && sea < 1400, `oceans and land (${(sea / 20).toFixed(0)}% sea)`); }
console.log(`xenia: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
