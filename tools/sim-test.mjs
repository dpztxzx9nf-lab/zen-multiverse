// headless checks for the living-ground field (node tools/sim-test.mjs)
import { createField, TC } from '../js/game/sim/field.js';
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function world(opts = {}) {
  return createField({ tiles: 5, seaLevel: 0, initTile(gx0, gz0, b, n, cell) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = (gx0 + i + 0.5) * cell, z = (gz0 + j + 0.5) * cell;
      let h = opts.flat ? 2 : 2 + x * 0.05; // gentle slope up to +x
      if (opts.channel && Math.abs(z) < 0.6 && x > -12 && x < 14) h = Math.min(h, (x + 12) * 0.03 - 0.3); // a dug channel sloping down to -x
      if (x < -12) h = -1;                        // the sea to the west
      b.H[k] = h; b.mat[k] = 1; b.Ta[k] = 20; b.M[k] = opts.wet ? 0.5 : 0.15; b.V[k] = 0.9; b.Vc[k] = 1; b.Fu[k] = 0.25; b.Nu[k] = 0.4;
      if (h < 0) { b.sea[k] = 1; b.W[k] = -h; b.V[k] = 0; b.Fu[k] = 0; }
    }
  } });
}
// 1) fire spreads downwind, not much upwind, leaves ash/char, eats grass
{
  const f = world({ flat: true }); f.recentre(0, 0); f.env.wind = [4, 0]; f.env.sun = 0.6;
  ok(f.ignite(0, 0, 0.4, 600), 'dry grass catches');
  const t0 = performance.now(); let maxB = 0;
  for (let i = 0; i < 300; i++) { f.step(); maxB = Math.max(maxB, f.events.burning); }
  const ms = (performance.now() - t0) / 300;
  const reach = (dx) => { let far = 0; for (let d = 0; d < 38; d += 0.5) { const k = f.idxAt(dx * d, 0); if (k >= 0 && f.f.Sc[k] > 0.3) far = d; } return far; };
  console.log('  downwind', reach(1), 'm  upwind', reach(-1), 'm  max burning cells', maxB, ' ms/tick', ms.toFixed(3));
  ok(reach(1) > reach(-1) * 1.5 && reach(1) > 6, 'fire runs with the wind');
  const k = f.idxAt(2, 0); ok(f.f.V[k] < 0.2 && f.f.Ash[k] > 0.1, 'burnt cell: grass gone, ash left (V=' + f.f.V[k].toFixed(2) + ' ash=' + f.f.Ash[k].toFixed(2) + ')');
}
// 2) wet ground doesn't burn; rain puts a fire out
{
  const f = world({ flat: true, wet: true }); f.recentre(0, 0);
  f.ignite(0, 0, 0.4, 600); for (let i = 0; i < 60; i++) f.step();
  let b = 0; for (let k = 0; k < f.N * f.N; k++) if (f.f.Sc[k] > 0.3) b++;
  ok(b < 12, 'wet grass smoulders out (' + b + ' scorched cells)');
  const g = world({ flat: true }); g.recentre(0, 0); g.ignite(0, 0, 0.6, 700); for (let i = 0; i < 40; i++) g.step();
  const before = g.events.burning; g.env.rain = 2.5e-4; for (let i = 0; i < 100; i++) g.step();
  ok(before > 0 && g.events.burning <= before * 0.3, 'rain knocks it down to embers (' + before + ' -> ' + g.events.burning + ' smouldering)');
}
// 3) water: from the sea into a dug channel, uphill it stops
{
  const f = world({ channel: true }); f.recentre(0, 0);
  f.groundChanged(0, 0, 0.1, () => null);
  for (let tz = 0; tz < 5; tz++) for (let tx = 0; tx < 5; tx++) f.awake[tz * 5 + tx] = 30;
  const t0 = performance.now(); for (let i = 0; i < 400; i++) f.step(); const ms = (performance.now() - t0) / 400;
  const d = (x, z) => f.f.W[f.idxAt(x, z)];
  console.log('  channel depth at x=-10', d(-10, 0).toFixed(3), ' x=-4', d(-4, 0).toFixed(3), ' x=2', d(2, 0).toFixed(3), ' bank x=-4 z=3', d(-4, 3).toFixed(3), ' ms/tick', ms.toFixed(3));
  ok(d(-4, 0) > 0.05 && d(-4, 3) < 0.001, 'sea water fills the channel, not the bank');
  const m = f.f.M[f.idxAt(-4, 0.8)]; ok(m > 0.16, 'soil beside the channel gets damp (' + m.toFixed(2) + ')');
}
// 4) rain -> puddles -> mud underfoot; footprints
{
  const f = world({ flat: true }); f.recentre(0, 0); f.env.rain = 2e-4;
  for (let i = 0; i < 1500; i++) f.step();
  const s = f.surface(1, 1); console.log('  after rain: M', f.f.M[f.idxAt(1, 1)].toFixed(2), 'W', f.f.W[f.idxAt(1, 1)].toFixed(4), 'step', s.step, 'speed', s.speed.toFixed(2), 'grip', s.friction.toFixed(2));
  ok(s.mud > 0.3 && s.speed < 0.95, 'soaked soil is mud: slower, less grip');
  f.stamp(1, 1, 1); ok(f.f.Pr[f.idxAt(1, 1)] > 0.4, 'mud keeps a deep footprint');
  f.env.rain = 0; f.env.sun = 1; const k = f.idxAt(1, 1); f.f.T[k] = 400; for (let i = 0; i < 6; i++) { f.heat(1, 1, 0.3, 500, 0.8); f.step(); }
  console.log('  baked', f.f.Bk[k].toFixed(2), 'mat', f.f.mat[k]);
}
// 5) regrowth after fire
{
  const f = world({ flat: true }); f.recentre(0, 0); f.env.wind = [2, 0]; f.ignite(0, 0, 0.4, 600);
  for (let i = 0; i < 600; i++) f.step();
  const k = f.idxAt(1.5, 0), v0 = f.f.V[k];
  f.env.rain = 1.5e-4; for (let i = 0; i < 600; i++) f.step(); f.env.rain = 0;
  for (let i = 0; i < 3000; i++) f.step();
  console.log('  veg after fire', v0.toFixed(2), '-> 1 min rain + 5 min later', f.f.V[k].toFixed(2), ' scorch', f.f.Sc[k].toFixed(2));
  ok(f.f.V[k] > v0 + 0.05, 'burnt ground greens again');
  const s = f.save(); const n = Object.keys(s).length, bytes = JSON.stringify(s).length; console.log('  save tiles', n, 'bytes', bytes);
}
// 6) a flood down a dug pit and slope: water is conserved, the ground erodes a little, never explodes
{
  const f = world({}); f.recentre(0, 0); f.env.sun = 0.6;
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const k = f.idxAt(10 + i * 0.5, j * 0.5); f.f.H[k] -= 1; }
  const h0 = f.f.H.reduce((a, v) => a + v, 0);
  for (let r = 0; r < 6; r++) { f.addWater(10, 0, 0.5, 0.9); for (let i = 0; i < 20; i++) f.step(); }
  for (let i = 0; i < 300; i++) f.step();
  let eMax = 0, sedT = 0, wT = 0; for (let k = 0; k < f.N * f.N; k++) { eMax = Math.max(eMax, Math.abs(f.f.E[k])); sedT += f.f.Sed[k]; if (!f.f.sea[k]) wT += f.f.W[k] * 0.25; }
  const dH = f.f.H.reduce((a, v) => a + v, 0) - h0;
  console.log('  flood: max erosion/deposit', eMax.toFixed(3), 'm  net ground change', (dH * 0.25).toFixed(3), 'm3  carried', (sedT * 0.25).toFixed(3), 'm3  water left on land', wT.toFixed(2), 'm3');
  ok(eMax <= 0.61 && Math.abs(dH * 0.25 + sedT * 0.25) < 0.05, 'sediment is conserved: what erodes is carried or laid down');
}
// trace
{
  const f = world({ flat: true }); f.recentre(0, 0); f.env.wind = [4, 0]; f.ignite(0, 0, 0.4, 600);
  for (let i = 0; i < 100; i++) { f.step(); if (i % 10 === 0) { const r = [0, 1, 2, 3].map((x) => { const k = f.idxAt(x, 0); return `x${x}:T${f.f.T[k].toFixed(0)} F${f.f.Fi[k].toFixed(2)} V${f.f.V[k].toFixed(2)} O${f.f.O[k].toFixed(2)}`; }); console.log('  t', (i / 10).toFixed(0), r.join(' | ')); } }
}
