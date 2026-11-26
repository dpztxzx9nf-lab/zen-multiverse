// The physics under fishing.js, kept free of three.js so node tests run it: a slender projectile in air or
// water, and a hooked fish on a line. Vectors are anything with x, y, z (THREE.Vector3 works).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RHO_AIR = 1.2;
// wooden shaft with a stone point: floats (820 kg/m3); nose-first it is slender, tumbling it is broad
export const SPEAR = { mass: 0.85, len: 1.6, rho: 820, cdaAxial: 0.0012, cdaSide: 0.032, thrust: 1.7 };
// twisted plant-fibre line: ~32 N before it parts; the springy pole bends ~1 m under 25 N, which is most of the
// give (k); held in the fingers the line slips at ~3.5 N; hauled in hand over hand at ~0.6 m/s
export const LINE = { breakN: 32, k: 25, slipN: 3.5, reelV: 0.6, maxLen: 50 };

export function stepProjectile(p, v, dt, { g, rhoFluid, inFluid, mass, vol, cda }) {
  const sp = Math.hypot(v.x, v.y, v.z);
  const rho = inFluid ? rhoFluid : RHO_AIR;
  const a = sp > 1e-6 ? (0.5 * rho * cda * sp * sp) / mass : 0; // drag deceleration
  const k = sp > 1e-6 ? (sp - Math.min(sp, a * dt)) / sp : 1;     // drag can at most stop it
  v.x *= k; v.y *= k; v.z *= k;
  v.y += ((inFluid ? (rhoFluid * vol * g) / mass : 0) - g) * dt;  // buoyancy up, weight down
  if (inFluid) { const e = Math.exp(-dt * 0.6); v.x *= e; v.y *= e; v.z *= e; } // added mass / eddies
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  return v;
}

// one step of a hooked fish f = { p, v, len, mass, stamina } on line { len } held at tip. Returns tension (N).
export function stepHooked(f, line, tip, dt, { rho = 1025, reeling = false, surf = 0, bottom = -1e9, rng = Math.random } = {}) {
  let tx = tip.x - f.p.x, ty = tip.y - f.p.y, tz = tip.z - f.p.z; const d = Math.hypot(tx, ty, tz) || 1; tx /= d; ty /= d; tz /= d;
  if (reeling) line.len = Math.max(0.8, line.len - LINE.reelV * dt);
  let T = d > line.len ? LINE.k * (d - line.len) : 0;           // taut: a stiff spring; slack: nothing
  if (!reeling && T > LINE.slipN) { line.len = Math.min(LINE.maxLen, d - LINE.slipN / LINE.k); T = LINE.slipN; } // runs out through the fingers
  // the fish swims away from the pull, wavering, with the strength it has left
  f.turnT = (f.turnT || 0) - dt; if (f.turnT <= 0) { f.turnT = 0.8 + rng() * 1.6; f.wob = (rng() - 0.5) * 2.2; }
  let ax = -tx, az = -tz; const al = Math.hypot(ax, az); if (al < 1e-6) { ax = 1; az = 0; } else { ax /= al; az /= al; }
  const c = Math.cos(f.wob || 0), s = Math.sin(f.wob || 0); const bx = ax * c - az * s, bz = ax * s + az * c;
  const maxPull = f.mass * 9.81 * 2.4 + 1.5;                    // a burst of a couple of times its weight
  const pull = maxPull * (0.2 + 0.8 * f.stamina);
  const dive = f.p.y > surf - 0.6 ? -0.6 : f.p.y < bottom + 0.4 ? 0.5 : (rng() - 0.5) * 0.2;
  const cda = 0.25 * f.len * f.len + 0.002, m = f.mass * 1.6;   // + the water it drags along
  const Fx = bx * pull + tx * T, Fy = dive * pull + ty * T, Fz = bz * pull + tz * T;
  f.v.x += (Fx / m) * dt; f.v.y += (Fy / m) * dt; f.v.z += (Fz / m) * dt;
  // quadratic drag, integrated implicitly: a small fish in a hard pull would overshoot (and blow up) explicitly
  { const sp = Math.hypot(f.v.x, f.v.y, f.v.z), k = 1 / (1 + ((0.5 * rho * cda * sp) / m) * dt); f.v.x *= k; f.v.y *= k; f.v.z *= k; }
  f.p.x += f.v.x * dt; f.p.y += f.v.y * dt; f.p.z += f.v.z * dt;
  if (f.p.y > surf - 0.15) { f.p.y = surf - 0.15; if (f.v.y > 0) f.v.y *= -0.3; }
  if (f.p.y < bottom + 0.2) { f.p.y = bottom + 0.2; if (f.v.y < 0) f.v.y = 0; }
  // effort tires it: hard runs against a tight line drain it fastest; with slack it recovers a little
  const work = (pull * Math.max(0, f.v.x * bx + f.v.z * bz)) / (maxPull * 1.2) + T / (maxPull * 3);
  f.stamina = clamp(f.stamina - dt * (0.012 + 0.09 * work) + (T < 0.5 ? dt * 0.01 : 0), 0, 1);
  return T;
}
