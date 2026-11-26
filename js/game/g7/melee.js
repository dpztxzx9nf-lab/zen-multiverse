// Handheld melee, the first weapons on Xenia (modern-day: no swords, no spears of war). Each is a real object:
// its mass and swing speed give the energy of a hit (½ m v²), and what it is made of decides how that energy
// lands (an edge cuts soft things, a blunt head cracks hard ones). The target's material (js/xenia/materials.js)
// says how much it takes before it breaks. No three.js here: tests and later the server can use it.
import { MATERIALS } from '../../xenia/materials.js';
export const MELEE = {
  knife:   { label: 'knife', glyph: '🔪', mass: 0.2, v: 9, kind: 'edge', every: 0.35, reach: 1.4 },
  bat:     { label: 'bat', glyph: '🏏', mass: 0.9, v: 15, kind: 'blunt', every: 0.7, reach: 1.9 },
  crowbar: { label: 'crowbar', glyph: '🔧', mass: 1.4, v: 10, kind: 'pry', every: 0.75, reach: 1.7 },
  machete: { label: 'machete', glyph: '🗡', mass: 0.55, v: 13, kind: 'edge', every: 0.55, reach: 1.8 },
};
// soft, fibrous things part under an edge; hard, brittle things crack under a blunt head; a pry bar splits joints
const SOFT = new Set(['wood', 'plank', 'fibre', 'cloth', 'leather', 'plant', 'flesh', 'rubber', 'plastic']);
const BRITTLE = new Set(['glass', 'stone', 'concrete', 'crystal', 'ice', 'ore']);
// the names props and build pieces use, as real materials
export const MAT_ALIAS = { metal: 'steel', rock: 'stone', log: 'wood', crate: 'wood', ice: 'ice', crystal: 'crystal', stone: 'stone', wood: 'wood', glass: 'glass' };
export const realMat = (m) => (MATERIALS[m] ? m : MAT_ALIAS[m] || 'stone');
export function hitEnergy(id, mat) {
  const w = MELEE[id]; if (!w) return 0;
  const m = realMat(mat), J = 0.5 * w.mass * w.v * w.v;
  const k = w.kind === 'edge' ? (SOFT.has(m) ? 2.5 : 0.3) : w.kind === 'blunt' ? (BRITTLE.has(m) ? 1.5 : 0.8) : (m === 'plank' || m === 'wood' ? 1.6 : 1.0);
  return J * k;
}
// what a thing of this material and size (m, roughly its width) takes before it gives way, in J
export const breakJ = (mat, size = 1) => MATERIALS[realMat(mat)].tough * Math.max(0.15, size) * 0.1;
// a hit lands: adds to the damage the thing has taken; true when it breaks
export function strike(target, id, mat, size = 1) {
  target.dmg = (target.dmg || 0) + hitEnergy(id, mat);
  return target.dmg >= breakJ(mat, size);
}
