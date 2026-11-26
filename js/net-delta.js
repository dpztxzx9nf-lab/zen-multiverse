// Delta-only move state for poses. A sender sends only the move-state fields that changed since its last pose
// (plus a full keyframe every KEY_MS and on every new socket); receivers merge each part onto what they had.
// Thresholds are below what the eye can see on a character: 1 degree of yaw, 5 cm/s of speed.
export const KEY_MS = 1000;
const TOL = { sp: 0.05, vy: 0.25, by: 0.017, ay: 0.017, ap: 0.017, tl: 0.02 };
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export function moveDelta(prev, cur) {
  if (!cur) return null;
  if (!prev) return { ...cur };
  const out = {};
  for (const k in cur) {
    const a = prev[k], b = cur[k];
    if (k in TOL) { if (typeof a !== 'number' || (k === 'by' || k === 'ay' ? angDiff(a, b) : Math.abs(a - b)) > TOL[k]) out[k] = b; }
    else if (Array.isArray(b)) { if (!Array.isArray(a) || a.join(',') !== b.join(',')) out[k] = b; }
    else if (a !== b) out[k] = b;
  }
  return Object.keys(out).length ? out : null;
}
// what a receiver (or the sender, to diff against) holds after a part arrives
export const mergeMove = (have, part) => (part ? { ...(have || {}), ...part } : have || null);
