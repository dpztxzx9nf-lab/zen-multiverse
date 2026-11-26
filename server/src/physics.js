// Movement budget and world laws the World DO uses to check poses.
// Gravity and sphere radius follow js/universe/rules.js (same seed -> same numbers).
// Abilities (climbing claws, jet boots) raise the budget; there is no free double jump.
const G0 = 9.81;
export const JUMP_H = 0.5;                          // standing jump height on Earth, metres
export const JUMP_V = Math.sqrt(2 * G0 * JUMP_H);   // the impulse is the same everywhere
export const SPRINT = 7.4;                          // js/game/move-config.js MOVE.sprint
export const SLIDE_CAP = 10.8;
export const CLIMB_SPEED = 3.6;
export const JET_ACCEL = 900 / 85;                  // ~10.59 m/s² while the boots burn
export const DIM_G = { prime: 1, amber: 0.55, tidal: 0.75, velvet: 1.25 };
const rng = (seed) => {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Invented body from a planet seed (same formula as makeWorldRules).
export function physicsOf(seed, dim = 'prime') {
  const r = rng((seed >>> 0) ^ 0x7f4a7c15);
  const mass = Math.min(Math.exp(Math.log(0.08) + r() * Math.log(60)), 20);
  const radius = Math.pow(mass, 0.27);
  const dimG = DIM_G[dim] || 1;
  const gravity = G0 * mass / (radius * radius) * dimG;
  const sphereR = Math.round(Math.min(16000, Math.max(1800, radius * 6400)));
  return { gravity, g: gravity / G0, sphereR };
}

// Home worlds: measured from makeWorldRules(homeBody(...)) on 2026-11-25, keep in sync with the client.
export const HOME_PHYS = {
  home: { gravity: 9.81, g: 1, sphereR: 6400 },
  moon: { gravity: 1.655, g: 0.169, sphereR: 1800 },
};

export function physFor(kind, seed, dim) {
  if (kind === 'planet') return physicsOf(seed, dim);
  return HOME_PHYS[kind] || HOME_PHYS.home;
}

// Horizontal budget: sustained sprint, plus a short burst so a slide and laggy bunches still pass.
export function moveRules(kind, seed, dim) {
  const p = physFor(kind, seed, dim);
  return { ...p, maxH: SPRINT + 0.2, burst: SLIDE_CAP - SPRINT + 1, cap: kind === 'planet' ? 32 : 12 };
}

export const AB = { climb: 1, jet: 2 };
export function parseAb(v) { const n = +v || 0; return { climb: !!(n & AB.climb), jet: !!(n & AB.jet), bits: n & 3 }; }

// Max upward metres allowed in dt seconds. No free second jump: an already-airborne player
// without jet/climb cannot add another upward impulse (vy may only fall under gravity).
export function maxRise(dt, g, ab, air) {
  const climb = ab.climb ? CLIMB_SPEED * dt : 0;
  const jet = ab.jet ? Math.max(0, JET_ACCEL - g) * dt : 0;
  if (air && !ab.jet && !ab.climb) return 0.35; // leftover of the first jump, not a second one
  return JUMP_V * dt + climb + jet + 0.4;
}
