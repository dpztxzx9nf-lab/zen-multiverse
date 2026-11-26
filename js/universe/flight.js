// Free flight physics (pure: no THREE, no DOM; node tests run it). One ship in a star system's inertial
// frame (system.js), float64 metres and m/s.
//   gravity    patched conics: the body whose sphere of influence holds the ship (or the star)
//   air        rho = rho0 exp(-h / H) up to the atmosphere top, drag 0.5 rho v^2 / beta (beta = m / CdA)
//   heating    Sutton-Graves heat flux 1.74e-4 sqrt(rho / rn) v^3 on the real-speed equivalent (v DV_SCALE),
//              hull heat relaxes toward flux / hull limit (time constant 3 s); > 1 glows, > 1.4 forces a brake
//   engines    main (along the nose), retro (against the velocity), lift (along local up, with a hover
//              assist that holds a climb rate), RCS strafe (cold gas, free, weak)
//   cruise     in space only: a drive that cancels gravity and takes the ship to a speed set by the
//              distance to the nearest surface (0.25 x that distance per second, up to 10,000 c), so a
//              crossing between planets takes a minute or two and slows itself near anything solid. It
//              burns propellant by distance (0.3 per AU inside 5 AU of the star, tapering as 5 AU / r further out: about 3 units from 5 AU to a 40 AU edge); with an empty tank it drifts at a tenth.
//   ground     the loaded body's real terrain (groundR callback); slow touchdowns land, fast ones bounce
//   starlight  no keep-out walls: the star heats the hull by its real radiant flux (1361 W/m^2 x luminosity at 1 AU,
//              falling as 1/r^2), the same hull limit as entry heating. Past 1.4 the hull takes damage (st.hull 1 -> 0);
//              at 0, or touching the star, the ship is destroyed. Giants crush a ship that sinks into them.
//   empty tank the cruise drive needs propellant to hold its speed: when the tank runs dry the field collapses and the
//              ship drops out at a coasting speed it can actually hold (just under escape from what it orbits), then
//              flies ballistic under gravity. No free 'drift' speed.
import { soiAt, nearestSurface, sub, len, AU, C_LIGHT, DV_SCALE } from './system.js';

const add = (a, b, k = 1) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; return a; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// radiant flux from the system's star at the ship (W/m^2)
export function starFlux(S, p) { const r = Math.max(S.R, len(p)); return 1361 * ((S.star && S.star.lum) || 1) * (AU / r) * (AU / r); }
// hull heat past 1.4 eats the hull; 0 destroys the ship
function hullDamage(st, dt, why) {
  if (st.destroyed) return;
  if (st.heat > 1.4) { st.hull = Math.max(0, (st.hull == null ? 1 : st.hull) - (st.heat - 1.4) * 0.12 * dt); if (!st.hurt) st.events.push('hull-damage'); st.hurt = true; } else if (st.heat < 1.2) st.hurt = false;
  if (st.hull <= 0) destroy(st, why);
}
function destroy(st, why) { if (st.destroyed) return; st.destroyed = true; st.hull = 0; st.v = [0, 0, 0]; st.mode = 'destroyed'; st.events.push('destroyed:' + why); }
export const CRUISE_K = 0.25, CRUISE_MAX = C_LIGHT * 1e4, CRUISE_MIN = 600;

export function createFlightState(p, v = [0, 0, 0], nose = [0, 1, 0]) {
  return { p: p.slice(), v: v.slice(), nose: norm(nose), mode: 'flight', heat: 0, hull: 1, destroyed: false, landed: false, dom: null, alt: 0, agl: 0, rho: 0, q: 0, vUp: 0, g: 0, cruiseV: 0, thrustA: 0, events: [], drift: false };
}
// env: { S, burn(throttle, dt, rhoK) -> { a, used }, fuel() -> units, hullHeat (W/m^2), mass() kg,
//        groundR(body, dirUnit) -> ground radius (terrain + sea) or null if terrain unknown,
//        spendCruise(units) }
export function stepFlight(st, ctl, dt, env) {
  const S = env.S;
  if (st.destroyed) return st;
  if (st.landed) {
    // resting on the ground: only enough upward thrust lifts her off
    const b = st.dom; if (!b) { st.landed = false; return st; }
    const r = sub(st.p, b.pos), up = norm(r), g = b.GM / dot(r, r);
    st.g = g; st.alt = len(r) - b.R; st.v = [0, 0, 0];
    const want = Math.max(ctl.lift ? 1 : 0, ctl.fwd > 0 && dot(st.nose, up) > 0.3 ? ctl.fwd : 0);
    if (want > 0) {
      const res = env.burn(want, dt, b.rho0 ? 1 : 0), aUp = res.a * (ctl.lift ? 1 : dot(st.nose, up));
      st.thrustA = res.a;
      if (aUp > g * 1.02) { st.landed = false; st.mode = 'flight'; st.v = scale(up, 1.5); st.events.push('liftoff'); }
    } else st.thrustA = 0;
    return st;
  }
  const dom = soiAt(S, st.p); st.dom = dom;
  const near = nearestSurface(S, st.p);
  // ---- cruise drive (space only)
  if (st.mode === 'cruise') {
    const atmo = dom && dom.atmTop ? len(sub(st.p, dom.pos)) - dom.R < dom.atmTop * 1.05 : false;
    const close = near.d < 200; // from the ground, or from the top of the air
    if (atmo || close) { st.mode = 'flight'; const sp = len(st.v), cap = dom && dom.GM ? Math.min(260, 0.6 * Math.sqrt(dom.GM / len(sub(st.p, dom.pos)))) : 260; if (sp > cap) st.v = scale(st.v, cap / sp); st.events.push('cruise-off'); } // the drive hands over at a manageable speed
    else {
      const fuel = env.fuel(); st.drift = false;
      if (fuel <= 0) {
        // the drive field collapses: keep the direction, at a speed the ship can hold on its own (just bound to what it orbits)
        const c = dom || null, cp = c ? c.pos : [0, 0, 0], GMc = c ? c.GM : S.GM, rc = Math.max(1, len(sub(st.p, cp)));
        const vb = 0.9 * Math.sqrt(2 * GMc / rc), sp = len(st.v); if (sp > vb) st.v = scale(st.v, vb / sp);
        st.mode = 'flight'; st.events.push('dropout'); st.cruiseV = len(st.v);
        finishAlt(st, env, dom); return st;
      }
      const vmax = Math.min(CRUISE_MAX, Math.max(Math.min(CRUISE_MIN, near.d * 0.55), near.d * CRUISE_K)); // near a surface it eases down to the 260 m/s it hands over at
      const target = Math.max(0, Math.min(1, ctl.throttle == null ? 1 : ctl.throttle)) * vmax;
      const want = scale(st.nose, target), k = 1 - Math.exp(-dt * 2.2);
      // the drive steers around a world in the way (not the one she set course for: that one it lets her reach)
      if (dom && dom.addr !== env.navAddr) {
        const r = sub(st.p, dom.pos), rl = len(r), u = scale(r, 1 / rl), alt = rl - dom.R - (dom.atmTop || 0), vin = dot(want, u);
        if (vin < 0) { const kk = Math.max(0, Math.min(1, 1 - (alt - 250) / Math.max(500, dom.R * 0.6))); add(want, u, -vin * kk); }
      }
      st.v = [st.v[0] + (want[0] - st.v[0]) * k, st.v[1] + (want[1] - st.v[1]) * k, st.v[2] + (want[2] - st.v[2]) * k];
      const step = len(st.v) * dt; add(st.p, st.v, dt);
      env.spendCruise(cruiseCost(step, len(st.p))); // out past 5 AU the star's pull is weak: the cruise coasts, so the outer system costs less per AU
      st.cruiseV = len(st.v); st.rho = 0; st.q = starFlux(S, st.p);
      st.heat += (st.q / env.hullHeat - st.heat) * Math.min(1, dt / 3); hullDamage(st, dt, 'star');
      if (len(st.p) < S.R) destroy(st, 'star');
      finishAlt(st, env, dom); return st;
    }
  }
  // ---- gravity
  const gp = dom ? dom.pos : [0, 0, 0], GM = dom ? dom.GM : S.GM;
  let r = sub(st.p, gp), rl = len(r), up = scale(r, 1 / rl);
  const g = GM / (rl * rl); st.g = g;
  const acc = scale(up, -g);
  // ---- air
  let rho = 0;
  if (dom && dom.rho0 > 0) { const h = rl - dom.R; if (h < dom.atmTop * 1.5) rho = dom.rho0 * Math.exp(-Math.max(0, h) / dom.H); }
  st.rho = rho;
  const sp = len(st.v);
  if (rho > 0 && sp > 0.01) {
    const beta = env.mass() / 30; // kg/m^2: a blunt ship ~30 m^2 of drag area
    add(acc, st.v, -0.5 * rho * sp / beta);
    const vReal = sp * DV_SCALE, flux = 1.74e-4 * Math.sqrt(rho) * vReal * vReal * vReal;
    st.q = flux + starFlux(S, st.p); st.heat += (st.q / env.hullHeat - st.heat) * Math.min(1, dt / 3);
  } else { st.q = starFlux(S, st.p); st.heat += (st.q / env.hullHeat - st.heat) * Math.min(1, dt / (st.q / env.hullHeat > st.heat ? 3 : 4)); }
  // ---- engines
  st.vUp = dot(st.v, up);
  let thr = [0, 0, 0], tl = 0;
  if (ctl.fwd > 0) { add(thr, st.nose, ctl.fwd); tl += ctl.fwd; }
  if (ctl.fwd < 0 && sp > 0.3) { add(thr, st.v, ctl.fwd / sp); tl += -ctl.fwd; }
  // lift: hold a climb of +10 m/s (thrust along local up); the landing assist holds a gentle descent
  const amax = Math.max(0.01, env.maxAccel ? env.maxAccel() : 20);
  if (ctl.lift) { const need = g + (10 - st.vUp) * 1.2; const k = Math.max(0, Math.min(1, need / amax)); add(thr, up, k); tl += k; }
  else if (ctl.assist && st.agl < 450 && st.agl > -5 && st.vUp < 0 && dom) {
    const limit = -Math.max(3, st.agl * 0.2);
    if (st.vUp < limit) { const need = g + (limit - st.vUp) * 1.5; const k = Math.max(0, Math.min(1, need / amax)); add(thr, up, k); tl += k; }
  }
  // the hull can't take more heat: the ship brakes on its own (spends propellant)
  if (st.heat > 1.4 && sp > 1 && rho > 0) { add(thr, st.v, -1 / sp); tl += 1; if (!st.hot) st.events.push('overheat'); st.hot = true; } else if (st.heat < 1) st.hot = false;
  st.thrustA = 0;
  if (tl > 0) {
    const tlen = len(thr), throttle = Math.min(1, tl);
    const res = env.burn(throttle, dt, dom && dom.rho0 ? rho / dom.rho0 : 0);
    if (res.a > 0 && tlen > 0) { add(acc, thr, res.a / tlen); st.thrustA = res.a; }
  }
  if (ctl.side) { const right = norm([st.nose[2] * up[1] - st.nose[1] * up[2], st.nose[0] * up[2] - st.nose[2] * up[0], st.nose[1] * up[0] - st.nose[0] * up[1]]); add(acc, right, -ctl.side * 2.5); }
  // ---- integrate (semi-implicit Euler)
  add(st.v, acc, dt); add(st.p, st.v, dt);
  // ---- the star and the giants are not landable: keep out
  // ---- no keep-out walls: the star burns, a giant crushes
  hullDamage(st, dt, 'star');
  if (len(st.p) < S.R) destroy(st, 'star');
  if (dom && dom.giant) {
    const d = len(sub(st.p, dom.pos)), top = dom.R + dom.atmTop * 0.3;
    if (d < top) { const k = (top - d) / Math.max(1, top - dom.R * 0.97); st.hull = Math.max(0, st.hull - k * 0.25 * dt); if (!st.crush) st.events.push('giant'); st.crush = true; if (st.hull <= 0 || d < dom.R * 0.97) destroy(st, 'giant'); } else st.crush = false;
  }
  if (st.destroyed) return st;
  finishAlt(st, env, dom);
  // ---- ground
  if (dom && !dom.giant && st.groundR != null) {
    r = sub(st.p, dom.pos); rl = len(r); up = scale(r, 1 / rl);
    const floor = st.groundR + (env.shipHalf || 1.6);
    if (rl < floor) {
      const vn = dot(st.v, up);
      st.p = add(dom.pos.slice(), up, floor);
      if (Math.abs(vn) < 9 && len(st.v) < 14) { st.v = [0, 0, 0]; st.landed = true; st.mode = 'landed'; st.events.push('landed'); }
      else { st.v = add(st.v.slice(), up, -1.6 * vn); st.v = scale(st.v, 0.5); st.events.push('bounce'); }
    }
  }
  return st;
}
function finishAlt(st, env, dom) {
  if (!dom) { st.alt = len(st.p); st.agl = Infinity; st.groundR = null; return; }
  const r = sub(st.p, dom.pos), rl = len(r);
  st.alt = rl - dom.R;
  const gr = !dom.giant && env.groundR ? env.groundR(dom, scale(r, 1 / rl)) : null;
  st.groundR = gr; st.agl = gr != null ? rl - gr : st.alt;
}

// propellant the cruise drive burns over `step` metres at distance r from the star
export function cruiseCost(step, r) { return step / AU * 0.3 / Math.max(1, r / (5 * AU)); }
// propellant to cruise in a straight line from a to b (sampled; the drive's real per-AU burn along the way)
export function cruiseCostLine(a, b, n = 48) {
  const d = len(sub(b, a)); let c = 0;
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; c += cruiseCost(d / n, len(p)); }
  return c;
}
