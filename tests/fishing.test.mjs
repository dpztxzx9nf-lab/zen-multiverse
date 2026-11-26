// node tests/fishing.test.mjs : spear flight in air and water, and a hooked fish fighting a fibre line
import { SPEAR, LINE, stepProjectile, stepHooked } from '../js/game/water/fishing-phys.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const spear = (v0, inFluid, secs = 3) => { const p = V(), v = V(v0, 0, 0); let t = 0, at05 = null; const dt = 1 / 240;
  for (; t < secs; t += dt) { stepProjectile(p, v, dt, { g: 9.81, rhoFluid: 1025, inFluid, mass: SPEAR.mass, vol: SPEAR.mass / SPEAR.rho, cda: Math.hypot(v.x, v.y, v.z) > 1.2 ? SPEAR.cdaAxial : SPEAR.cdaSide }); if (at05 == null && t >= 0.5) at05 = p.x; }
  return { x: p.x, y: p.y, at05, v };
};
{ const a = spear(14, false, 0.5); ok(a.x > 6.5 && a.y < -1, `air throw at 14 m/s: ${a.x.toFixed(1)} m in 0.5 s, dropped ${(-a.y).toFixed(2)} m (needs lead and arc)`); }
{ const w = spear(5, true, 3); ok(w.at05 > 1.2 && w.at05 < 2.4 && w.x < 4.5, `underwater throw at 5 m/s: ${w.at05.toFixed(2)} m after 0.5 s, ${w.x.toFixed(2)} m total: the water eats it`); ok(w.y > 0, `the wooden spear floats up (${w.y.toFixed(2)} m)`); }
const fight = (len, plan, secs = 240, seed = 1) => {
  let s = seed; const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const f = { p: V(8, -2, 0), v: V(), len, mass: 12 * len ** 3, stamina: 1 }, tip = V(0, 1.2, 0), line = { len: Math.hypot(8, 3.2) + 0.2 };
  let T = 0, maxT = 0, t = 0; const dt = 1 / 60;
  for (; t < secs; t += dt) { const n = Math.min(40, Math.ceil((dt * Math.sqrt(LINE.k / (f.mass * 1.6))) / 0.4));
    for (let i = 0; i < n; i++) T = stepHooked(f, line, tip, dt / n, { reeling: plan(T, f, t), surf: 0, bottom: -12, rng });
    maxT = Math.max(maxT, T); if (T > LINE.breakN) return { snapped: true, t, maxT, f };
    if (Math.hypot(f.p.x - tip.x, f.p.y - tip.y, f.p.z - tip.z) < 1.6) return { landed: true, t, maxT, f };
    if (line.len >= LINE.maxLen - 0.01) return { ranOut: true, t, f }; }
  return { t, f, maxT };
};
{ const r = fight(0.5, () => true); ok(r.snapped, `hauling a fresh 50 cm fish non-stop snaps the line (${r.snapped ? 'at ' + r.t.toFixed(1) + ' s' : JSON.stringify(r)})`); }
{ const r = fight(0.5, (T, f) => T < LINE.breakN * 0.7); ok(r.landed, `giving line when it pulls hard lands it (${r.landed ? r.t.toFixed(0) + ' s, fish at ' + (r.f.stamina * 100).toFixed(0) + '%' : JSON.stringify({ ...r, f: undefined })})`); }
{ const r = fight(0.2, () => true); ok(r.landed && r.maxT < LINE.breakN, `a 20 cm fish just comes in (${r.t.toFixed(1)} s, peak ${r.maxT.toFixed(1)} N)`); }
{ const r = fight(0.5, () => false, 60); ok(r.f.stamina < 0.6, `a fish running against the line tires (${(r.f.stamina * 100).toFixed(0)}% after ${r.t.toFixed(0)} s)`); }
console.log(fails ? fails + ' failed' : 'all ok'); process.exit(fails ? 1 : 0);
