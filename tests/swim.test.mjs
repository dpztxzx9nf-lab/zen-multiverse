// node tests/swim.test.mjs : the swimming body (buoyancy, Boyle lungs, drag, strokes, breath) and the waves
import { createSwimmer, liquidOf } from '../js/game/water/swim-phys.js';
import { createWaves } from '../js/game/water/waves.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sea = { rho: 1025, g: 9.81, surf: 0, still: 0, bottom: -200, pAtmKPa: 101.325, breathable: true, flow: [0, 0, 0] };
const run = (sw, pos, ctl, secs, env = sea, dt = 1 / 60) => { let vmax = 0, vs = []; for (let t = 0; t < secs; t += dt) { sw.step(dt, pos, ctl, env); const s = Math.hypot(sw.vel.x, sw.vel.z); vmax = Math.max(vmax, s); vs.push(s); } return { vmax, vs }; };
{ // floats and treads with the eyes out
  const sw = createSwimmer(), p = { x: 0, y: -0.6, z: 0 }; run(sw, p, {}, 20);
  const eye = p.y + sw.eyeAbove(sw.state.horiz);
  ok(eye > 0.02 && eye < 0.5, `treading: eye ${eye.toFixed(2)} m above the sea (horiz ${sw.state.horiz.toFixed(2)})`);
}
{ // without treading (blacked out) she still floats near the surface in sea water
  const sw = createSwimmer(), p = { x: 0, y: -0.6, z: 0 }; sw.state.blackout = true; run(sw, p, {}, 20);
  ok(p.y > -0.9, `limp in sea water stays up: chest ${p.y.toFixed(2)}`);
}
{ // cruise and sprint speeds, strokes surge
  const sw = createSwimmer(), p = { x: 0, y: -0.15, z: 0 }; const r = run(sw, p, { wz: 1 }, 15);
  const tail = r.vs.slice(-240), lo = Math.min(...tail), hi = Math.max(...tail);
  ok(hi > 1.3 && hi < 2.4, `cruise top ${hi.toFixed(2)} m/s`); ok(hi - lo > 0.12, `each stroke surges (${lo.toFixed(2)}..${hi.toFixed(2)})`);
  const s2 = createSwimmer(), p2 = { x: 0, y: -0.15, z: 0 }; const r2 = run(s2, p2, { wz: 1, sprint: true }, 8);
  ok(r2.vmax > hi + 0.4 && r2.vmax < 3.6, `sprint top ${r2.vmax.toFixed(2)} m/s`);
  ok(s2.state.stamina < 0.3, `sprint costs stamina (${s2.state.stamina.toFixed(2)})`);
}
{ // Boyle: shallow under she drifts up, deep she sinks
  const sw = createSwimmer();
  ok(sw.netBuoyancy(3) > 0, `3 m: +${sw.netBuoyancy(3).toFixed(1)} N (rises)`);
  ok(sw.netBuoyancy(25) < 0, `25 m: ${sw.netBuoyancy(25).toFixed(1)} N (sinks)`);
  let d = 0; for (; d < 60 && sw.netBuoyancy(d) > 0; d += 0.5); ok(d > 8 && d < 20, `neutral at ~${d} m`);
  ok(sw.netBuoyancy(3, 1025, 3.7) > 0, 'low gravity still floats');
}
{ // breath: holding it runs out, sprinting faster; out of breath hurts, not instant death
  const sw = createSwimmer(), p = { x: 0, y: -25, z: 0 }; const deep = { ...sea, bottom: -25.3 - 1.3 };
  run(sw, p, {}, 30, deep); const calm = sw.state.breath;
  const s2 = createSwimmer(), p2 = { x: 0, y: -25, z: 0 }; run(s2, p2, { wx: 1, sprint: true }, 30, deep);
  ok(calm < 1 && s2.state.breath < calm, `30 s under: calm ${calm.toFixed(2)}, swimming ${s2.state.breath.toFixed(2)}`);
  run(sw, p, {}, 40, deep); ok(sw.state.breath === 0 && sw.state.health > 0 && sw.state.health < 1, `out of breath: health ${sw.state.health.toFixed(2)}, not dead`);
  run(sw, p, {}, 20, deep); ok(sw.state.blackout, 'long enough without air: she blacks out');
}
{ // liquids from rules
  const e = liquidOf({ water: { liquid: true, inventory: 0.8 }, temperature: { meanC: 15 } }); ok(e.rho > 1020 && e.rho < 1030, `salt sea ${e.rho}`);
  const f = liquidOf({ water: { liquid: true, inventory: 0.2 }, temperature: { meanC: 15 } }); ok(f.rho > 999 && f.rho < 1004, `fresh lake ${f.rho}`);
  ok(liquidOf({ water: { liquid: false } }) === null, 'no liquid, no sea');
}
{ // waves: dispersion and sea state from the world
  const E = createWaves({ gravity: 9.81 }); E.setWind(6, 0); const M = createWaves({ gravity: 3.7 }); M.setWind(6, 0);
  ok(M.hs > E.hs && M.period > E.period, `light world: taller (${M.hs.toFixed(2)} vs ${E.hs.toFixed(2)} m) and slower (${M.period.toFixed(1)} vs ${E.period.toFixed(1)} s)`);
  E.tick(1000); const h = E.height(3, 4); let o = 0, od = 0; for (let i = 0; i < 50; i++) { o += Math.hypot(...E.orbital(i * 1.7, i * 0.9, 0)); od += Math.hypot(...E.orbital(i * 1.7, i * 0.9, 15)); }
  ok(Math.abs(h) < E.hs, `height ${h.toFixed(2)}`); ok(od < o * 0.5, `orbital motion fades with depth (${(o / 50).toFixed(2)} -> ${(od / 50).toFixed(2)} m/s at 15 m)`);
  const A = createWaves({ gravity: 9.81, seed: 3 }), Bw = createWaves({ gravity: 9.81, seed: 3 }); A.setWind(5, 1); Bw.setWind(5, 1); A.tick(1234.5); Bw.tick(1234.5); ok(A.height(10, 10) === Bw.height(10, 10), 'two players see the same wave');
}
{ // the garden cove (salt, 14 C, bed 4.3 m down): she does not stick to the bottom. Letting go, a full breath
  // floats her up in a few seconds; kicking up is quicker. (Headless shots run the sim slower than the wall clock.)
  const cove = { ...sea, rho: liquidOf({ temperature: { meanC: 14 } }).rho, surf: -0.33, still: -0.33, bottom: -4.67 };
  const rise = (ctl) => { const sw = createSwimmer(), p = { x: 0, y: -4.67 + 1.3, z: 0 }; sw.state.headUnder = true; let t = 0; for (; t < 30 && p.y < cove.surf - 0.6; t += 1 / 60) sw.step(1 / 60, p, ctl, cove); return t; };
  const tFree = rise({}), tKick = rise({ up: true });
  ok(tFree < 9, `cove bottom, letting go: chest near the surface in ${tFree.toFixed(1)} s`);
  ok(tKick < tFree * 0.75, `kicking up: ${tKick.toFixed(1)} s`);
}
console.log(fails ? `${fails} FAILED` : 'all ok'); process.exit(fails ? 1 : 0);
