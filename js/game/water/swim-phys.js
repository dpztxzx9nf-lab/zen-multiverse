// Swimming as a body in a liquid (pure maths, node-testable). Nothing here is a 'swim mode' switch with
// made-up numbers: she floats because her body plus the air in her lungs is a little less dense than
// sea water, the air in her lungs squeezes with depth (Boyle) so past ~10 m she sinks, the water drags
// on her by the square of speed and the area she shows it, and each stroke is a push that surges her
// forward and then fades. Breath is a real store: holding it costs more the harder she works.
//
//   liquidOf(rules)             density / name / clarity of this world's sea (salt seas are denser)
//   createSwimmer(opts)         the body; .step(dt, ctl, env) integrates one frame
//
// Coordinates: y up. The swimmer is tracked by her chest point (she rotates about it from upright
// treading to lying flat). Feet are chest - 1.3 m when upright.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export const BODY = {
  mass: 72,             // kg
  tissueRho: 1062,      // kg/m^3, lean body average without the lungs' air
  lungBreathing: 0.0040,// m^3 of air while breathing at the surface (tidal + reserve)
  lungHeld: 0.0058,     // a full breath taken to dive
  addedMass: 0.25,      // water that moves with her (fraction of her mass)
  chest: 1.3,           // chest height above the feet, upright
  top: 0.45,            // head top above the chest, upright
  slab: 0.17,           // half-thickness of the body lying flat
  headShare: 0.07,      // of the body's volume, in the head
  // drag area Cd*A (m^2): head-first streamlined, and broadside (treading, sinking upright, flat-on falls)
  cdaAlong: 0.045, cdaBroad: 0.32,
  // strokes: mean push (N) and cycles per second; sprint is a hard crawl
  pushCruise: 74, pushSprint: 195, rateCruise: 0.85, rateSprint: 1.35,
  pushVertical: 70,     // a scissor kick straight up / a pull down
  tread: 38,            // treading water keeps the head out (N of extra lift, a reflex at the surface)
  breathSec: 70,        // seconds of held breath at rest (an average fit adult, calm)
};

// the liquid: water density from temperature and salt (UNESCO in spirit: fresh 1000 at 4 C, sea +0.8/psu)
export function liquidOf(rules) {
  const R = rules || {}, wtr = R.water || {}, T = R.temperature ? (R.temperature.meanC ?? 15) : 15;
  if (wtr.liquid === false) return null;
  const salty = (wtr.inventory ?? 0.7) > 0.45; // big old seas collect salt from the rocks; small ones stay near fresh
  const S = salty ? 35 : 3;
  const t = clamp(T, 0, 60);
  const rho = 1000 - 0.0068 * (t - 4) * (t - 4) + 0.8 * S;
  const life = R.biology ? (R.biology.animals || 0) + (R.biology.plants || 0) * 0.5 : 0.5;
  // clarity: plankton (life) clouds the water; e-folding attenuation per metre for red, green, blue
  const turb = 0.02 + 0.05 * clamp(life, 0, 1.5);
  const absorb = [0.36 + turb, 0.07 + turb, 0.035 + turb * 1.2];
  return { name: salty ? 'sea water' : 'fresh water', rho: +rho.toFixed(1), salinity: S, tempC: T, absorb, turbidity: +turb.toFixed(3),
    pressureKPa: R.atmosphere ? R.atmosphere.pressureKPa ?? 101.325 : 101.325, breathable: R.atmosphere ? R.atmosphere.breathable !== false : true };
}

export function createSwimmer(opts = {}) {
  const B = { ...BODY, ...(opts.body || {}) };
  const tissueV = B.mass / B.tissueRho;
  const S = {
    on: false, horiz: 0, pitch: 0, phase: 0, push: 0, lung: B.lungBreathing, held: false,
    breath: 1, stamina: 1, tired: false, health: 1, under: false, depth: 0, submerged: 0, headUnder: false,
    blackout: false, lastStroke: 0, strokes: 0, heave: 0, gasp: 0,
  };
  const v = { x: 0, y: 0, z: 0 };
  // fraction of the body's volume below the surface, for an upright and a flat profile, blended by horiz
  function submergedFrac(chestY, surf, horiz) {
    // upright: torso and legs (1 - headShare) from feet to neck, head on top
    const feet = chestY - B.chest, neck = chestY + B.top - 0.25, headTop = chestY + B.top;
    const up = (1 - B.headShare) * clamp((surf - feet) / (neck - feet), 0, 1) + B.headShare * clamp((surf - neck) / (headTop - neck), 0, 1);
    // flat: the body is a slab around the chest; the head is held up a little in front
    const lo = chestY - B.slab, hi = chestY + B.slab, h0 = chestY + 0.05, h1 = chestY + 0.3;
    const flat = (1 - B.headShare) * clamp((surf - lo) / (hi - lo), 0, 1) + B.headShare * clamp((surf - h0) / (h1 - h0), 0, 1);
    return up + (flat - up) * horiz;
  }
  // the lowest point of the body below the chest (for touching the bottom)
  const lowBelow = (horiz) => B.chest + (B.slab - B.chest) * horiz;
  const eyeAbove = (horiz) => 0.32 + (0.2 - 0.32) * horiz;
  /**
   * ctl: { wx, wy, wz (wish direction, world, |w| <= 1), sprint, up, down, surfaceMode }
   * env: { surf (surface height at her), still (still level), rho, g, flow [x,y,z] (water velocity), bottom (ground y),
   *        pAtmKPa, breathable }
   * pos: { x, y, z } chest point, moved in place
   */
  function step(dt, pos, ctl, env) {
    const g = env.g, rho = env.rho, surf = env.surf;
    const depthChest = surf - pos.y; S.depth = Math.max(0, (env.still ?? surf) - pos.y);
    const eyeY = pos.y + eyeAbove(S.horiz);
    // a crawl at the surface turns the face to breathe every stroke: only a head well under is holding breath
    { const lim = surf - 0.2 * S.horiz * (depthChest < 0.45 ? 1 : 0); S.headUnder = S.headUnder ? eyeY < lim + 0.01 : eyeY < lim - 0.08; } // a little hysteresis: a passing wave crest doesn't count
    // lungs: a breath is taken as the head goes under; Boyle squeezes it with the water above
    if (S.headUnder && !S.held) { S.held = true; S.lung = B.lungHeld * clamp(0.55 + 0.45 * S.breath, 0.55, 1); }
    if (!S.headUnder) { S.held = false; S.lung = B.lungBreathing; }
    const P0 = Math.max(1, env.pAtmKPa ?? 101.325) * 1000, Pw = P0 + rho * g * Math.max(0, depthChest);
    const lungV = S.lung * P0 / Pw;
    const V = tissueV + lungV;
    const f = submergedFrac(pos.y, surf, S.horiz);
    S.submerged = f;
    const mEff = B.mass * (1 + B.addedMass * f);
    // forces (N)
    let fx = 0, fy = rho * g * V * f - B.mass * g, fz = 0;
    // wish: strokes push in pulses; a tired body pushes less; drowning is weak
    const cwx = ctl.wx || 0, cwy = ctl.wy || 0, cwz = ctl.wz || 0, wl = Math.min(1, Math.hypot(cwx, cwy, cwz));
    const sprint = !!ctl.sprint && !S.tired && wl > 0.3;
    const strength = clamp(S.health * 1.2, 0.15, 1) * (S.blackout ? 0 : 1);
    let effort = 0;
    if (wl > 0.05 && f > 0.25) {
      const rate = sprint ? B.rateSprint : B.rateCruise, mean = (sprint ? B.pushSprint : B.pushCruise) * wl * strength;
      const prev = S.phase; S.phase = (S.phase + rate * dt) % 1;
      if (S.phase < prev) { S.strokes++; S.lastStroke = 0; }
      // a stroke is a pull then a recovery: the push is 2 sin^2 shaped (mean 1)
      const s = Math.sin(Math.PI * S.phase); S.push = 2 * s * s;
      const F = mean * S.push * f;
      const wn = Math.hypot(cwx, cwy, cwz) || 1; fx += (cwx / wn) * F; fy += (cwy / wn) * F; fz += (cwz / wn) * F;
      effort = sprint ? 1 : 0.45 * wl;
    } else { S.push = 0; S.phase = damp(S.phase, 0, 2, dt); }
    S.lastStroke += dt;
    // up / down: kick to the surface or pull down
    if (ctl.up && f > 0.2) { fy += B.pushVertical * strength * f; effort = Math.max(effort, 0.5); }
    if (ctl.down && f > 0.2) { fy -= B.pushVertical * strength * f; effort = Math.max(effort, 0.5); }
    // treading: at the surface, not diving, the legs keep the head out
    // (and a crawl's kick keeps her up the same way): the lower her head sits, the harder the legs work
    if (!ctl.down && !S.blackout && f > 0.6 && depthChest < 1.1 && ctl.surfaceMode !== false) fy += B.tread * strength * clamp(0.4 + (depthChest + 0.05) * 2.2, 0, 1.8);
    // drag against the water (relative to the water's own motion)
    const fl = env.flow || [0, 0, 0];
    const rx = v.x - fl[0], ry = v.y - fl[1], rz = v.z - fl[2], rs = Math.hypot(rx, ry, rz);
    if (rs > 1e-5) {
      // how end-on she meets the flow: lying flat along her motion is streamlined, upright or crossways is broad
      const hx = Math.hypot(rx, rz), along = S.horiz * (hx / rs) * Math.cos(S.pitch) + S.horiz * Math.abs(ry / rs) * Math.abs(Math.sin(S.pitch)) * 0.9;
      const cda = B.cdaBroad + (B.cdaAlong - B.cdaBroad) * clamp(along, 0, 1);
      const D = 0.5 * rho * cda * rs * f + 0.5 * 1.2 * 0.5 * rs * (1 - f) * 0.0; // air drag on the rest is tiny
      fx -= D * rx; fy -= D * ry; fz -= D * rz;
      // at the surface a body also makes waves: wave-making drag (Froude), roughly doubles drag near hull speed
      if (depthChest < 0.6 && hx > 0.3) { const Wd = 0.5 * rho * 0.03 * hx * clamp(hx / 2.2, 0, 1.5); fx -= Wd * rx; fz -= Wd * rz; }
    }
    v.x += (fx / mEff) * dt; v.y += (fy / mEff) * dt; v.z += (fz / mEff) * dt;
    pos.x += v.x * dt; pos.y += v.y * dt; pos.z += v.z * dt;
    // the bottom: she cannot go into the ground
    const low = pos.y - lowBelow(S.horiz);
    if (env.bottom != null && low < env.bottom) { pos.y += env.bottom - low; if (v.y < 0) v.y = 0; }
    // pose: flat when moving or under, upright when treading still at the surface; pitch follows her motion
    const hsp = Math.hypot(v.x, v.z), sp = Math.hypot(hsp, v.y);
    const wantH = (wl > 0.1 || S.headUnder || sp > 0.6) && !S.blackout ? 1 : 0;
    S.horiz = damp(S.horiz, wantH, wantH ? 3.2 : 2.0, dt);
    const wantP = sp > 0.25 && S.headUnder ? Math.atan2(v.y, Math.max(0.05, hsp)) : 0;
    S.pitch = damp(S.pitch, clamp(wantP, -1.35, 1.35), 3, dt);
    // breath: a store of seconds of held breath; costs more with effort; surfacing refills in a few breaths
    const breathable = env.breathable !== false;
    if (S.headUnder || !breathable) S.breath = Math.max(0, S.breath - (dt / B.breathSec) * (1 + 1.4 * effort + (S.breath < 0.25 ? 0.4 : 0)));
    else { if (S.breath < 0.6) S.gasp = 1; S.breath = Math.min(1, S.breath + dt * 0.28); }
    S.gasp = Math.max(0, S.gasp - dt * 0.6);
    // stamina: a sprint burns it; easy strokes and floating give it back
    if (sprint) { S.stamina = Math.max(0, S.stamina - dt / 9); if (S.stamina <= 0) S.tired = true; }
    else S.stamina = Math.min(1, S.stamina + dt * (effort > 0.3 ? 0.06 : 0.14));
    if (S.tired && S.stamina > 0.35) S.tired = false;
    // out of breath: the body is hurt (hypoxia), not killed outright; air heals it slowly
    if (S.breath <= 0) S.health = Math.max(0, S.health - dt / 12);
    else if (!S.headUnder) S.health = Math.min(1, S.health + dt / 40);
    if (S.health <= 0 && !S.blackout) S.blackout = true;
    return S;
  }
  return {
    state: S, vel: v, body: B, tissueV, submergedFrac, lowBelow, eyeAbove, step,
    // net buoyancy in N at a depth (tests, HUD): positive floats
    netBuoyancy(depth, rho = 1025, g = 9.81, pKPa = 101.325, held = true) { const P0 = pKPa * 1000, l = (held ? B.lungHeld : B.lungBreathing) * P0 / (P0 + rho * g * depth); return rho * g * (tissueV + l) - B.mass * g; },
    enter(vx, vy, vz) { S.on = true; v.x = vx; v.y = vy; v.z = vz; S.blackout = false; },
    leave() { S.on = false; S.horiz = 0; S.pitch = 0; S.push = 0; },
    revive() { S.blackout = false; S.health = 0.35; S.breath = 1; S.held = false; v.x = v.y = v.z = 0; },
  };
}
