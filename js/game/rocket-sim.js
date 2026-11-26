// Rocket flight from how the rocket is built. Pure module (no THREE, no DOM): the workshop readout,
// the launch and the tests all use it.
//
// The design is a stack, bottom first: booster stages the player adds under the classic rocket, then
// the classic rocket itself (hull + engine + fins + capsule + nose) as the upper stage. Each stage has
// tank sections, engines (type and count) and optional fins; a decoupler sits on top of every booster.
//
// Physics (2D in the launch plane, plus a small out-of-plane wobble channel):
//   mass from parts + loaded propellant; centre of mass along the stack; moment of inertia
//   thrust varies with ambient pressure (sea level -> vacuum), mass flow = Tvac / (Isp_vac g0)
//   gravity GM/r^2 from the world; drag 0.5 rho v^2 Cd A, rho = rho0 exp(-h/H), transonic Cd rise
//   aerodynamic normal force from the nose/body and the fins acting at the centre of pressure:
//     CP behind COM -> the rocket weathervanes into the airflow (stable); CP ahead -> it tips
//   wind and gusts give an angle of attack; engines gimbal to hold the pitch program, but only so far,
//   and each engine mount has a small alignment error (crafting quality) that pushes it off line
//   staging when a stage runs dry; orbit when periapsis clears the atmosphere
// World: core.worldRules if present ({ g, radius, rho0, scaleHeight, atmTop, wind }), else Earth.
export const G0 = 9.80665;
export const EARTH_RULES = { name: 'Earth', g: 9.81, radius: 6.371e6, rho0: 1.225, scaleHeight: 7200, atmTop: 100e3, wind: 12 };
export const MOON_RULES = { name: 'Moon', g: 1.62, radius: 1.7374e6, rho0: 0, scaleHeight: 1, atmTop: 15e3, wind: 0 };
export function worldRules(core) {
  const w = core && core.worldRules;
  if (!w) return { ...EARTH_RULES };
  const r = { ...EARTH_RULES, ...w };
  if (w.rho0 === undefined && w.atmosphere === false) r.rho0 = 0;
  return r;
}
// one propellant load (kerosene + liquid oxygen) is 7 t: a 2 m tank section holds one, the classic hull three
export const LOAD_KG = 7000;
export const ENGINES = {
  copper: { name: 'Copper engine', tSL: 380e3, tVac: 430e3, ispSL: 270, ispVac: 305, mass: 950, gimbal: 4, len: 1.6, desc: 'The classic pressure-fed bell. Sturdy, not light.' },
  pump: { name: 'Pump engine', tSL: 720e3, tVac: 800e3, ispSL: 280, ispVac: 310, mass: 700, gimbal: 5, len: 1.7, desc: 'A turbopump engine: lots of thrust for its weight. Made for the bottom stage.' },
  vac: { name: 'Vacuum engine', tSL: 90e3, tVac: 300e3, ispSL: 150, ispVac: 345, mass: 600, gimbal: 3, len: 2.2, desc: 'A long bell that only works well above the air. Made for upper stages.' },
};
export const PART = {
  tank: { mass: 600, len: 2.0, loads: 1 },
  hull: { mass: 1600, len: 5.8, loads: 3 },
  decoupler: { mass: 200, len: 0.4 },
  fin: { mass: 60, area: 2.0 },
  classicFin: { mass: 60, area: 2.5 },
  capsule: { mass: 2400, len: 2.5 },
  nose: { mass: 150, len: 3.2 },
};
const RCS = 12e3; // N·m of attitude control from the capsule thrusters
const RADIUS = 1.1, AREF = Math.PI * RADIUS * RADIUS;

// the design as stored in the save, filled with defaults. G.rocket = { parts: [...classic], stages: [...], engine, fuel: [...] }
export function designFrom(R) {
  R = R || {};
  const parts = new Set(R.parts || []);
  const boosters = (R.stages || []).map((s) => ({ tanks: Math.max(0, s.tanks | 0), engines: Math.max(0, s.engines | 0), engine: ENGINES[s.engine] ? s.engine : 'pump', fins: s.fins | 0, err: s.err || [] }));
  const upper = { classic: true, tanks: 0, hull: parts.has('body'), engines: parts.has('engine') ? 1 : 0, engine: ENGINES[R.engine] ? R.engine : 'copper', fins: parts.has('fins') ? 3 : 0, capsule: parts.has('capsule'), nose: parts.has('nose'), err: R.err || [] };
  const stages = [...boosters, upper];
  const fuel = R.fuel || [];
  stages.forEach((s, i) => { s.loads = capacity(s); s.fuel = Math.min(s.loads, Math.max(0, +fuel[i] || 0)); });
  return { stages };
}
export function capacity(s) { return s.tanks * PART.tank.loads + (s.hull ? PART.hull.loads : 0); }

// the stack as segments along the axis (y up from the bottom of the whole rocket)
export function stack(design, fuelOverride) {
  const segs = [];
  let y = 0;
  design.stages.forEach((s, si) => {
    const E = ENGINES[s.engine];
    const fuelLoads = fuelOverride ? fuelOverride[si] : s.fuel;
    const engLen = s.engines ? E.len : 0;
    if (s.engines) segs.push({ stage: si, kind: 'engine', y0: y, len: engLen, mass: E.mass * s.engines });
    y += s.engines ? engLen * 0.6 : 0; // bells tuck under the tanks
    const tankLen = s.tanks * PART.tank.len + (s.hull ? PART.hull.len : 0);
    const dry = s.tanks * PART.tank.mass + (s.hull ? PART.hull.mass : 0);
    if (tankLen > 0) segs.push({ stage: si, kind: 'tanks', y0: y, len: tankLen, mass: dry, prop: fuelLoads * LOAD_KG });
    // fins sit at the foot of their stage, swept back (most of the area low)
    if (s.fins) { const F = s.classic ? PART.classicFin : PART.fin; segs.push({ stage: si, kind: 'fins', y0: y - (s.engines ? engLen * 0.6 : 0) + 0.2, len: 2.2, mass: F.mass * s.fins, area: F.area * s.fins }); }
    y += tankLen;
    if (!s.classic) { segs.push({ stage: si, kind: 'decoupler', y0: y, len: PART.decoupler.len, mass: PART.decoupler.mass }); y += PART.decoupler.len; }
    if (s.capsule) { segs.push({ stage: si, kind: 'capsule', y0: y, len: PART.capsule.len, mass: PART.capsule.mass }); y += PART.capsule.len; }
    if (s.nose) { segs.push({ stage: si, kind: 'nose', y0: y, len: PART.nose.len, mass: PART.nose.mass }); y += PART.nose.len; }
  });
  return { segs, length: y };
}

// mass properties and aerodynamics of whatever is still attached (stages >= from)
export function props(design, from = 0, fuelLoads) {
  const fl = fuelLoads || design.stages.map((s) => s.fuel);
  const { segs } = stack(design, fl);
  const live = segs.filter((s) => s.stage >= from);
  const base = live.length ? live[0].y0 : 0;
  let m = 0, my = 0;
  for (const s of live) { const mm = s.mass + (s.prop || 0); m += mm; my += mm * (s.y0 + s.len / 2); }
  const com = m ? my / m : 0;
  let I = 0;
  for (const s of live) { const mm = s.mass + (s.prop || 0), c = s.y0 + s.len / 2; I += mm * ((c - com) ** 2 + s.len * s.len / 12 + RADIUS * RADIUS / 4); }
  // normal-force slopes (per radian, on AREF) and where they act (Barrowman, simplified)
  const top = live.length ? Math.max(...live.map((s) => s.y0 + s.len)) : 0;
  const nose = live.find((s) => s.kind === 'nose'), cap = live.find((s) => s.kind === 'capsule');
  const tip = nose || cap || live[live.length - 1];
  const tipLen = nose ? nose.len : cap ? cap.len : 1;
  let cn = 2, cnY = top - tipLen * 0.47; // the nose / blunt top
  const bodyLen = top - base;
  // long bodies add some lift spread along their length (keeps very tall stacks honest)
  const cnBody = 0.5 * bodyLen / (2 * RADIUS) * 0.1; const cnBodyY = base + bodyLen * 0.5;
  let sum = cn * cnY + cnBody * cnBodyY; cn += cnBody;
  for (const s of live) if (s.kind === 'fins') { const k = Math.PI * s.area / AREF * 1.25; sum += k * (s.y0 + s.len * 0.6); cn += k; } // fins: Barrowman-ish, with body interference
  const cp = sum / cn;
  // drag coefficient: pointy nose vs blunt capsule, fins add a little
  const finArea = live.filter((s) => s.kind === 'fins').reduce((a, s) => a + s.area, 0);
  const cd0 = (nose ? 0.32 : cap ? 0.55 : 0.85) + finArea * 0.004 + (tip ? 0 : 0.2);
  const engines = from < design.stages.length ? design.stages[from] : null;
  const engY = live.length ? live[0].y0 : 0;
  return { mass: m, com, I, cp, cn, cd0, length: bodyLen, base, engY, stage: engines, margin: (com - cp) / (2 * RADIUS) };
}

function thrustOf(s, rhoK) { if (!s || !s.engines) return 0; const E = ENGINES[s.engine]; return s.engines * (E.tVac - (E.tVac - E.tSL) * rhoK); }
function flowOf(s) { if (!s || !s.engines) return 0; const E = ENGINES[s.engine]; return s.engines * E.tVac / (E.ispVac * G0); }

// the simple readout before launch: thrust-to-weight on the pad, delta-v per stage, stability
export function readout(design, rules = EARTH_RULES) {
  const st = design.stages, out = { stages: [], dv: 0 };
  const fl = st.map((s) => s.fuel);
  for (let i = 0; i < st.length; i++) {
    const s = st[i], E = ENGINES[s.engine];
    const p = props(design, i, fl), m0 = p.mass, m1 = m0 - s.fuel * LOAD_KG;
    const air = i === 0 && rules.rho0 > 0;
    const isp = s.engines ? (air ? (E.ispSL + E.ispVac) / 2 : E.ispVac) : 0;
    const dv = s.engines && m1 > 0 ? isp * G0 * Math.log(m0 / m1) : 0;
    const twr = s.engines ? thrustOf(s, air ? 1 : 0) / (m0 * rules.g) : 0;
    const burn = s.engines ? s.fuel * LOAD_KG / flowOf(s) : 0;
    out.stages.push({ dv, twr, mass: m0, burn, fuel: s.fuel, loads: s.loads });
    out.dv += dv;
  }
  const p0 = props(design, 0, fl);
  out.mass = p0.mass; out.twr = out.stages.length ? out.stages[0].twr : 0; out.margin = p0.margin; out.length = p0.length;
  // what orbit costs here: orbital speed plus typical gravity and drag losses
  const vOrb = Math.sqrt(rules.g * rules.radius * rules.radius / (rules.radius + rules.atmTop * 1.2));
  out.need = vOrb + (rules.rho0 > 0 ? 1600 : 0) + Math.sqrt(2 * rules.g * rules.atmTop * 1.2) * 0.35;
  return out;
}

// a small deterministic random (wind gusts, per-flight)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// A flight. step(dt) advances it; state is read off the object. Outcomes:
//   'pad'      thrust-to-weight below 1, she never leaves the pad (engines shut down)
//   'tumble'   she lost attitude in the air (wobbles grew, aerodynamic forces broke her up)
//   'crash'    came back down
//   'suborbit' ran out of propellant above the air without a stable orbit (falls back)
//   'orbit'    periapsis above the atmosphere
export function createFlight(design, rules = EARTH_RULES, { seed = 1, targetAlt } = {}) {
  const R = rules.radius, GM = rules.g * R * R, rnd = rng(seed);
  const target = targetAlt || rules.atmTop * 1.25;
  const fuel = design.stages.map((s) => s.fuel * LOAD_KG); // kg left per stage
  const st = design.stages;
  const F = {
    t: 0, x: 0, y: R, vx: 0, vy: 0, th: Math.PI / 2, w: 0, // th: body axis angle (inertial), w: rate
    psi: 0, wpsi: 0, // out-of-plane lean (rad) and rate
    stage: 0, phase: 'ignite', outcome: null, events: [], alt: 0, speed: 0, q: 0, maxQ: 0, aoa: 0, gimbal: 0, thrust: 0, mass: 0, apo: 0, peri: -R, throttle: 1,
    fuel, design, rules, downrange: 0, kick: 0, wobble: 0, maxWobble: 0, lift: false,
  };
  // per-engine mount errors (rad): crafted quality; stored in the design (err) so a rebuild changes them
  const misalign = st.map((s) => { const e = s.err && s.err.length ? s.err : [0.004]; const pitch = e.reduce((a, v, i) => a + v * Math.cos(i * 2.1), 0) / Math.max(1, e.length); const yaw = e.reduce((a, v, i) => a + v * Math.sin(i * 2.1 + 0.6), 0) / Math.max(1, e.length); return { pitch, yaw }; });
  const gust = { t: 0, v: 0, target: 0 };
  { const p0 = props(design, 0); const twr = thrustOf(st[0], rules.rho0 > 0 ? 1 : 0) / (p0.mass * rules.g); F.kick = Math.max(0.03, Math.min(0.4, 0.05 + 0.25 * (twr - 1.2))); }
  function liveFuel() { return st.map((s, i) => fuel[i] / LOAD_KG); }
  function event(kind, text) { F.events.push({ t: F.t, kind, text }); }
  function orbit() {
    const r = Math.hypot(F.x, F.y), v2 = F.vx * F.vx + F.vy * F.vy, E = v2 / 2 - GM / r, h = F.x * F.vy - F.y * F.vx;
    if (E >= 0) { F.apo = Infinity; F.peri = (h * h / GM) / 2 - R; return; }
    const a = -GM / (2 * E), e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (GM * GM)));
    F.apo = a * (1 + e) - R; F.peri = a * (1 - e) - R;
  }
  function step(dt) {
    if (F.outcome) return F;
    F.t += dt;
    const r = Math.hypot(F.x, F.y), ux = F.x / r, uy = F.y / r; // up
    const ex = uy, ey = -ux; // downrange (east-ish) in the launch plane
    F.alt = r - R;
    const rho = rules.rho0 > 0 ? rules.rho0 * Math.exp(-F.alt / rules.scaleHeight) : 0, rhoK = rules.rho0 > 0 ? rho / rules.rho0 : 0;
    // staging: a dry stage with something above it falls away
    while (F.stage < st.length - 1 && fuel[F.stage] <= 0 && F.lift) { event('stage', `Stage ${F.stage + 1} away`); F.stage++; }
    const s = st[F.stage];
    const P = props(design, F.stage, liveFuel());
    F.mass = P.mass;
    // thrust and burn
    let T = 0;
    const burning = F.phase !== 'coast' && fuel[F.stage] > 0 && s.engines > 0;
    if (burning) { T = thrustOf(s, rhoK) * F.throttle; const md = flowOf(s) * F.throttle; fuel[F.stage] = Math.max(0, fuel[F.stage] - md * dt); }
    F.thrust = T;
    // still on the pad: thrust has to beat weight
    if (!F.lift) {
      if (T > F.mass * rules.g * 1.001) { F.lift = true; F.phase = 'ascent'; event('lift', 'Lift-off'); }
      else { if (F.t > 6 || fuel[F.stage] <= 0) { F.outcome = 'pad'; event('pad', T > 0 ? 'Not enough thrust to lift her weight' : 'No engine to light'); } return F; }
    }
    // air-relative velocity (wind blows along the downrange line, gusty, strongest a few km up)
    gust.t -= dt; if (gust.t <= 0) { gust.t = 1 + rnd() * 3; gust.target = (rnd() * 2 - 1) * (rules.wind || 0) * 0.6; }
    gust.v += (gust.target - gust.v) * Math.min(1, dt * 0.8);
    const windK = rules.rho0 > 0 ? Math.min(1, F.alt / 4000 + 0.3) * Math.exp(-F.alt / 20000) : 0;
    const wind = ((rules.wind || 0) + gust.v) * windK;
    const ax0 = F.vx - ex * wind, ay0 = F.vy - ey * wind;
    const vrel = Math.hypot(ax0, ay0);
    const q = 0.5 * rho * vrel * vrel; F.q = q; F.maxQ = Math.max(F.maxQ, q);
    const sound = 340 - 45 * Math.min(1, F.alt / 11000), M = vrel / sound;
    const cd = P.cd0 * (1 + 1.3 * Math.exp(-(((M - 1.05) / 0.3) ** 2)));
    // body direction and angle of attack
    const bx = Math.cos(F.th), by = Math.sin(F.th);
    const velAng = vrel > 1 ? Math.atan2(ay0, ax0) : F.th;
    const aoa = vrel > 5 ? wrap(F.th - velAng) : 0; F.aoa = aoa;
    const aoaY = vrel > 5 ? F.psi - Math.atan2((rules.wind ? gust.v * 0.4 * windK : 0), vrel) : 0;
    // forces
    let fx = 0, fy = 0;
    const g = GM / (r * r); fx -= ux * g * F.mass; fy -= uy * g * F.mass;
    if (vrel > 0.1) { const D = q * cd * AREF; fx -= ax0 / vrel * D; fy -= ay0 / vrel * D; }
    // normal force (pushes the body sideways, toward the airflow); capped like a stall
    const aoaC = Math.max(-0.35, Math.min(0.35, aoa));
    const N = q * AREF * P.cn * Math.sin(aoaC);
    const nx = -by, ny = bx; // body normal (left of axis)
    fx += nx * N; fy += ny * N;
    // guidance: the pitch program (angle from local vertical toward downrange)
    const upAng = Math.atan2(uy, ux);
    const progradeFromVert = vrel > 1 ? wrap(upAng - Math.atan2(F.vy, F.vx)) : 0;
    const vUp = F.vx * ux + F.vy * uy;
    let cmdFromVert;
    const lim = Math.max(0.04, Math.min(0.8, 400 / Math.max(1, q))); // never far from the airflow while the air is thick
    if (F.phase === 'circ') { const vWant = Math.max(-60, Math.min(60, (target - F.alt) / 40)); cmdFromVert = Math.PI / 2 - Math.max(-0.35, Math.min(0.6, (vWant - vUp) / 150)); cmdFromVert = Math.max(progradeFromVert - lim, Math.min(progradeFromVert + lim, cmdFromVert)); } // along the horizon, holding the height
    else if (F.alt < 120 || F.speed < 30) cmdFromVert = 0; // clear the tower first
    else {
      // a gravity turn: tip over with height, never far from the airflow while the air is thick
      cmdFromVert = Math.PI / 2 * Math.sqrt(Math.max(0, Math.min(1, (F.alt - 120) / (rules.rho0 > 0 ? rules.atmTop * 0.6 : target * 0.4))));
      if (F.alt < 4000) cmdFromVert = Math.max(cmdFromVert, Math.min(1, (F.alt - 120) / 500) * F.kick); // the pitch-over kick, bigger for a punchier rocket
      if (F.alt > rules.atmTop * 0.6 && F.apo < target && vUp < 120) cmdFromVert -= Math.min(0.6, (120 - vUp) / 300); // weak upper stage: hold the climb
      cmdFromVert = Math.max(progradeFromVert - lim, Math.min(progradeFromVert + lim, cmdFromVert));
    }
    // the autopilot turns smoothly (a few degrees a second at most)
    if (F.cmd == null) F.cmd = cmdFromVert; F.cmd += Math.max(-0.05 * dt, Math.min(0.05 * dt, cmdFromVert - F.cmd));
    const thCmd = upAng - F.cmd;
    // attitude dynamics: aerodynamic moment about the COM, thrust misalignment, gimbal control
    const armAero = P.cp - P.com; // + : CP above COM (unstable)
    const Maero = N * armAero - q * AREF * P.length * P.length * 0.6 * F.w / Math.max(30, vrel); // + damping
    const armT = P.com - P.engY;
    const mis = misalign[F.stage];
    const Mmis = -T * armT * Math.sin(mis.pitch); // thrust through the engine, below the COM
    const E = ENGINES[s.engine], gmax = E ? E.gimbal * Math.PI / 180 : 0;
    const err = wrap(thCmd - F.th);
    // PID on attitude: it doesn't know the disturbances, it only feels the error (so they show as wobble)
    F.ie = Math.max(-0.2, Math.min(0.2, (F.ie || 0) + err * dt));
    // gains scheduled on dynamic pressure, like a real autopilot (an unstable rocket needs a stiffer loop)
    const Ka = Math.max(0, q * AREF * P.cn * armAero) / P.I;
    const wn = 1.0 + 1.5 * Math.sqrt(Ka), Mcmd = P.I * (wn * wn * err - 2 * 0.8 * wn * F.w + 0.4 * F.ie);
    let gim = 0; if (T > 0 && armT > 0) gim = Math.max(-gmax, Math.min(gmax, Math.asin(Math.max(-1, Math.min(1, -Mcmd / (T * armT))))));
    F.gimbal = gim;
    const Mg = -T * armT * Math.sin(gim);
    // the capsule's little attitude thrusters (all the control there is while the engines are off)
    const rcs = st[st.length - 1].capsule ? RCS : 0;
    const Mr = Math.max(-rcs, Math.min(rcs, Mcmd - Mg));
    const alpha = (Maero + Mmis + Mg + Mr) / P.I;
    F.w += alpha * dt; F.th += F.w * dt;
    // thrust along the body axis (tipped by the gimbal)
    const tdx = Math.cos(F.th + gim + mis.pitch), tdy = Math.sin(F.th + gim + mis.pitch);
    fx += tdx * T; fy += tdy * T;
    // out-of-plane wobble channel (same physics, small angles)
    const Ny = q * AREF * P.cn * Math.max(-0.35, Math.min(0.35, aoaY));
    const MmisY = -T * armT * Math.sin(mis.yaw);
    const MaeroY = Ny * armAero - q * AREF * P.length * P.length * 0.6 * F.wpsi / Math.max(30, vrel);
    F.iy = Math.max(-0.2, Math.min(0.2, (F.iy || 0) - F.psi * dt));
    const McY = P.I * (-wn * wn * F.psi - 2 * 0.8 * wn * F.wpsi + 0.4 * F.iy);
    let gy = 0; if (T > 0 && armT > 0) gy = Math.max(-gmax, Math.min(gmax, Math.asin(Math.max(-1, Math.min(1, -McY / (T * armT))))));
    const MrY = Math.max(-rcs, Math.min(rcs, McY + T * armT * Math.sin(gy)));
    F.wpsi += (MaeroY + MmisY - T * armT * Math.sin(gy) + MrY) / P.I * dt; F.psi += F.wpsi * dt;
    // integrate
    F.vx += fx / F.mass * dt; F.vy += fy / F.mass * dt;
    F.x += F.vx * dt; F.y += F.vy * dt;
    F.speed = Math.hypot(F.vx, F.vy);
    F.downrange = R * Math.atan2(F.x, F.y);
    F.wobble = Math.hypot(Math.abs(err) < 0.3 ? err : 0, F.psi, F.w * 0.5); F.maxWobble = Math.max(F.maxWobble, F.wobble);
    orbit();
    // break-up: sideways at speed in the air
    if (q * Math.abs(aoa) > 7000 || (q > 3000 && Math.abs(aoa) > 0.5)) { F.outcome = 'tumble'; event('tumble', 'She tipped over in the airflow and broke apart'); return F; }
    if (Math.abs(F.psi) > 0.6 || Math.abs(F.w) > 0.8 || Math.abs(F.wpsi) > 0.8) { F.outcome = 'tumble'; event('tumble', 'She wobbled out of control'); return F; }
    if (F.alt < -0.5) { F.outcome = 'crash'; event('crash', 'Back on the ground, hard'); return F; }
    // engine cut-off and orbit
    if (F.phase === 'ascent' && F.apo >= target && (F.alt > rules.atmTop * 0.7 || rules.rho0 <= 0)) { F.phase = 'coast'; event('meco', 'Engines off, coasting up'); }
    if (F.phase === 'coast') {
      const vUp = F.vx * ux + F.vy * uy;
      // light again near apoapsis to round the orbit off
      const tToApo = vUp / g;
      const left = fuel.slice(F.stage).reduce((a, b) => a + b, 0);
      if (F.peri > rules.atmTop) { F.outcome = 'orbit'; event('orbit', 'In orbit'); return F; }
      // the circularising burn is centred on apoapsis: start half its length early
      const ra = R + F.apo, hh = Math.abs(F.x * F.vy - F.y * F.vx), need = Math.sqrt(GM / ra) - hh / ra;
      let si = F.stage; while (si < st.length - 1 && (fuel[si] <= 0 || !st[si].engines)) si++;
      const Tn = thrustOf(st[si], 0), tb = Tn > 0 ? need * F.mass / Tn : Infinity;
      if (F.apo < rules.atmTop * 0.9 && vUp < 0) F.phase = 'ascent';
      else if (left > 0 && F.alt > rules.atmTop * 0.7 && tToApo < tb / 2 + 2) { F.phase = 'circ'; event('circ', 'Rounding off the orbit'); }
    }
    if (F.phase === 'circ' && F.peri > rules.atmTop) { F.outcome = 'orbit'; event('orbit', 'In orbit'); return F; }
    // out of propellant everywhere
    if (F.lift && fuel.slice(F.stage).every((f) => f <= 0) && F.outcome == null) {
      if (F.peri > rules.atmTop) { F.outcome = 'orbit'; event('orbit', 'In orbit'); }
      else if (!F.dry) { F.dry = true; event('dry', F.alt > rules.atmTop ? 'Out of propellant before orbit' : 'Out of propellant, still in the air'); }
      if (F.dry && (F.vx * ux + F.vy * uy) < 0 && F.alt > 0) F.falling = true;
      if (F.dry && F.alt > rules.atmTop && F.falling) { F.outcome = 'suborbit'; }
    }
    return F;
  }
  // run to the end (tests, and the fast-forward during the long part of the climb)
  function run(maxT = 2400) {
    while (!F.outcome && F.t < maxT) step(F.phase === 'coast' && F.alt > rules.atmTop ? 0.25 : 0.02);
    if (!F.outcome) F.outcome = F.peri > rules.atmTop ? 'orbit' : 'suborbit';
    return F;
  }
  F.step = step; F.run = run;
  return F;
}
