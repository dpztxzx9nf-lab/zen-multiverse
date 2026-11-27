// Pure Rattler camp helpers (no I/O). The server ticks these; the client only needs
// the roster so a camp always has the same 3–5 people from the seed.
import { hash, rng } from './guns.js';

export const RATTLER_HP = 70;
export const SIGHT_RANGE = 32;
export const SIGHT_DOT = 0.45; // ~63° cone
export const NOISE_RANGE = 48;
export const STEP_RANGE = 16;
export const CALL_RANGE = 40;
export const SHOT_RANGE = 38;
export const SHOT_MS = 1100;
export const WALK = 3.2;
export const COVER_R = 4.6;

export function campRoster(seed, cx, cz) {
  const r = rng(hash(seed || 0, 'rat', cx, cz));
  const n = 3 + Math.floor(r() * 3); // 3, 4 or 5
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + r() * 0.35;
    const rad = 3.2 + r() * 3.5;
    out.push({ i, dx: Math.cos(ang) * rad, dz: Math.sin(ang) * rad, yaw: ang + Math.PI });
  }
  return out;
}

export function coverPoints(cx, cz, parts) {
  const pts = [
    { x: cx + COVER_R, z: cz + COVER_R },
    { x: cx + COVER_R, z: cz - COVER_R },
    { x: cx - COVER_R, z: cz + COVER_R },
    { x: cx - COVER_R, z: cz - COVER_R },
    { x: cx + COVER_R * 1.4, z: cz },
    { x: cx - COVER_R * 1.4, z: cz },
  ];
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) pts.push({ x: p.x, z: p.z });
    }
  }
  return pts;
}

export function canSee(from, target, facingYaw) {
  if (!from || !target) return false;
  const dx = target.x - from.x, dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d > SIGHT_RANGE || d < 0.2) return d < 0.2;
  const fx = Math.sin(facingYaw || 0), fz = Math.cos(facingYaw || 0);
  const dot = (fx * dx + fz * dz) / d;
  return dot >= SIGHT_DOT;
}

export function canHear(from, noise, range = NOISE_RANGE) {
  if (!from || !noise) return false;
  return Math.hypot((noise.x - from.x), (noise.z - from.z)) <= range;
}

// Walk to a cover point that has the camp between us and the target, or the closest if none.
export function pickCover(self, target, pts) {
  if (!pts || !pts.length) return { x: self.x, z: self.z };
  let best = pts[0], bestS = Infinity;
  for (const p of pts) {
    const toT = Math.hypot(p.x - target.x, p.z - target.z);
    const toS = Math.hypot(p.x - self.x, p.z - self.z);
    // prefer a point that is not the same side as we already stand, and still near the fight
    const score = toT * 0.6 + toS * 0.4;
    if (score < bestS) { bestS = score; best = p; }
  }
  return best;
}

// A flank point is a cover point on the opposite side of the target-to-self axis.
export function flankPoint(self, target, pts) {
  if (!pts || !pts.length) return pickCover(self, target, pts);
  const ax = self.x - target.x, az = self.z - target.z;
  let best = pts[0], bestS = -Infinity;
  for (const p of pts) {
    const bx = p.x - target.x, bz = p.z - target.z;
    // cross product magnitude: off to the side, not behind the same shoulder
    const cross = ax * bz - az * bx;
    const side = Math.abs(cross);
    const away = -(bx * ax + bz * az) * 0.05;
    const s = side + away - Math.hypot(p.x - self.x, p.z - self.z) * 0.3;
    if (s > bestS) { bestS = s; best = p; }
  }
  return best;
}

export function stepToward(self, dest, dt, speed = WALK) {
  const dx = dest.x - self.x, dz = dest.z - self.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) return { x: dest.x, z: dest.z, yaw: self.yaw, arrived: true };
  const step = Math.min(d, speed * dt);
  const yaw = Math.atan2(dx, dz);
  return { x: self.x + (dx / d) * step, z: self.z + (dz / d) * step, yaw, arrived: d - step < 0.25 };
}

export function aimYaw(from, target) {
  return Math.atan2(target.x - from.x, target.z - from.z);
}
