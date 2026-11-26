// Dimensions: the same coordinates under different physical constants. A dimension never changes where
// things are (same seeds, same star map); it changes the laws WorldRules derives from them.
// Design (see universe.md): each dimension is a set of multipliers on constants plus feature switches.
// Only the multipliers below are wired today (gravity, air, water, life); the rest are stub hooks that
// physics / chemistry / the sim can read from rules.dimLaws once they are ready for them.
import { DIMENSIONS } from '../game/names.js';
export const DIM_LAWS = {
  prime: { gravityK: 1, airK: 1, waterK: 0, life: true, constants: { c: 1, G: 1, alpha: 1 }, notes: 'our universe' },
  amber: { gravityK: 0.55, airK: 1.4, waterK: 0, life: true, constants: { c: 0.6, G: 0.55, alpha: 1 }, notes: 'weak gravity, thick honeyed air, slow light (stub: light-speed effects)' },
  tidal: { gravityK: 0.75, airK: 1, waterK: 0.4, life: true, constants: { c: 1, G: 0.75, alpha: 1.02 }, notes: 'water everywhere, buoyant (stub: stronger surface tension)' },
  velvet: { gravityK: 1.25, airK: 2, waterK: -0.1, life: true, constants: { c: 1, G: 1.25, alpha: 0.97 }, notes: 'heavy and dense, violet dusk (stub: shifted chemistry, alpha < 1 means weaker bonds)' },
};
// what makeWorldRules wants as `dim`
export function dimLaws(key = 'prime') {
  const D = DIMENSIONS[key] || DIMENSIONS.prime, L = DIM_LAWS[key] || DIM_LAWS.prime;
  return { ...L, key, name: D.name, gravity: L.gravityK, hint: D.hint };
}
// hooks: systems can register to be told about the dimension's constants (stub: nothing calls these yet)
const hooks = new Set();
export function onDimensionLaws(fn) { hooks.add(fn); return () => hooks.delete(fn); }
export function announceDimension(key) { const L = dimLaws(key); for (const f of hooks) try { f(L); } catch (e) { /* */ } return L; }
