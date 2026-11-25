// Seeds -> numbers and gentle names (shared by the star map, the planets and the journal).
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(...n) { let h = 2166136261; for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; } return h >>> 0; }
const A = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'ei', 'ia', 'ou'];
const C = ['l', 'm', 'n', 'r', 's', 'th', 'v', 'b', 'd', 'k', 'sh', 'f', 'l', 'n', 'z', 'c', 'p', 't'];
const END = ['a', 'ia', 'on', 'is', 'el', 'ara', 'en', 'ine', 'um', 'o', 'ea', 'ys'];
export function makeName(seed, syl = 0) {
  const r = rng(seed ^ 0x51ed);
  const n = syl || (r() < 0.55 ? 2 : 3);
  let s = '';
  for (let i = 0; i < n - 1; i++) s += C[Math.floor(r() * C.length)] + A[Math.floor(r() * A.length)];
  s += C[Math.floor(r() * C.length)] + END[Math.floor(r() * END.length)];
  return s[0].toUpperCase() + s.slice(1);
}
// dimension shifts: palette, physics and creature style
export const DIMENSIONS = {
  prime: { name: 'Prime', hint: 'familiar light, familiar weight', gravity: 1, hueShift: 0, sat: 1, sky: null, creature: 'soft' },
  amber: { name: 'Amber', hint: 'honeyed light, slow and floaty', gravity: 0.55, hueShift: 0.08, sat: 1.15, sky: '#f3b06a', creature: 'tall' },
  tidal: { name: 'Tidal', hint: 'blue-green and buoyant', gravity: 0.75, hueShift: -0.25, sat: 1.1, sky: '#6fd6c9', creature: 'round' },
  velvet: { name: 'Velvet', hint: 'violet dusk, heavy and calm', gravity: 1.25, hueShift: 0.45, sat: 0.95, sky: '#8a6bd6', creature: 'many' },
};
