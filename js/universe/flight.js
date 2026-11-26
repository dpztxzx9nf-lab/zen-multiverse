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
//              burns propellant by distance (0.3 per AU); with an empty tank it drifts at a tenth.
//   ground     the loaded body's real terrain (groundR callback); slow touchdowns land, fast ones bounce
import { soiAt, nearestSurface, sub, len, AU, C_LIGHT, DV_SCALE } from './system.js';

const add = (a, b, k = 1) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; return a; };
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const CRUISE_K = 0.25, CRUISE_MAX = C_LIGHT * 1e4, CRUISE_MIN = 600;

export function createFlightState(p, v = [0, 0, 0], nose = [0, 1, 0]) {
  return { p: p.slice(), v: v.slice(), nose: norm(nose), mode: 'flight', heat: 0, landed: false, dom: null, alt: 0, agl: 0, rho: 0, q: 0, vUp: 0, g: 0, cruiseV: 0, thrustA: 0, events: [], drift: false };
}
// env: { S, burn(throttle, dt, rhoK) -> { a, used }, fuel() -> units, hullHeat (W/m^2), mass() kg,
//        groundR(body, dirUnit) -> ground radius (terrain + sea) or null if terrain unknown,
//        spendCruise(units) }
export function stepFlight(st, ctl, dt, env) {
  const S = env.S;
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
      const fuel = env.fuel(); st.drift = fuel <= 0;
      const vmax = Math.min(CRUISE_MAX, Math.max(Math.min(CRUISE_MIN, near.d * 0.55), near.d * CRUISE_K)) * (st.drift ? 0.1 : 1); // near a surface it eases down to the 260 m/s it hands over at
      const target = Math.max(0, Math.min(1, ctl.throttle == null ? 1 : ctl.throttle)) * vmax;
      const want = scale(st.nose, target), k = 1 - Math.exp(-dt * 2.2);
      // the drive steers around a world in the way (not the one she set course for: that one it lets her reach)
      if (dom && dom.addr !== env.navAddr) {
        const r = sub(st.p, dom.pos), rl = len(r), u = scale(r, 1 / rl), alt = rl - dom.R - (dom.atmTop || 0), vin = dot(want, u);
        if (vin < 0) { const kk = Math.max(0, Math.min(1, 1 - (alt - 250) / Math.max(500, dom.R * 0.6))); add(want, u, -vin * kk); }
      }
      st.v = [st.v[0] + (want[0] - st.v[0]) * k, st.v[1] + (want[1] - st.v[1]) * k, st.v[2] + (want[2] - st.v[2]) * k];
      const step = len(st.v) * dt; add(st.p, st.v, dt);
      if (!st.drift) env.spendCruise(step / AU * 0.3);
      st.cruiseV = len(st.v); st.heat = Math.max(0, st.heat - dt * 0.3); st.rho = 0; st.q = 0;
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
    st.q = flux; st.heat += (flux / env.hullHeat - st.heat) * Math.min(1, dt / 3);
  } else { st.q = 0; st.heat += (0 - st.heat) * Math.min(1, dt / 4); }
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
  if (st.heat > 1.4 && sp > 1) { add(thr, st.v, -1 / sp); tl += 1; if (!st.hot) st.events.push('overheat'); st.hot = true; } else if (st.heat < 1) st.hot = false;
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
  if (len(st.p) < S.R * 1.6) { const u = norm(st.p); st.p = scale(u, S.R * 1.6); st.v = scale(u, Math.max(50, len(st.v) * 0.2)); st.events.push('star'); }
  if (dom && dom.giant) { const rr = sub(st.p, dom.pos), d = len(rr); if (d < dom.R + dom.atmTop * 0.3) { const u = norm(rr); st.p = add(dom.pos.slice(), u, dom.R + dom.atmTop * 0.3); st.v = scale(u, 40); st.events.push('giant'); } }
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
