// The game's slice of the single save ('garden-save' -> slices.game):
//   inv: { itemId: count }, mode: 'walk' | 'ambient', beds: [...], rocket: { parts: [] }, unlocks: {...},
//   moon: { modules: {...}, bonsai: {...} }, journal: { species: {}, planets: {} }, gather: { dayKey: [...ids] }
// ?unlock=all fills everything in for testing (in memory only: never written back).
import { slice, persist } from '../save.js';

export const SPECIES = {
  snapdragon: { name: 'Snapdragon', plural: 'Snapdragons', color: '#d9558f' },
  columbine: { name: 'Columbine', plural: 'Columbines', color: '#7f9be0' },
  cosmos: { name: 'Cosmos', plural: 'Cosmos', color: '#f19ab8' },
  poppy: { name: 'Poppy', plural: 'Poppies', color: '#e8613a' },
  lavender: { name: 'Lavender', plural: 'Lavender sprigs', color: '#9a7fd0' },
  sunflower: { name: 'Sunflower', plural: 'Sunflowers', color: '#f2c230' },
};
const F = (name, icon, color, group) => ({ name, icon, color, group });
export const ITEMS = {
  ...Object.fromEntries(Object.entries(SPECIES).map(([k, s]) => [`seed:${k}`, F(`${s.name} seeds`, 'seed', '#b89a6a', 'Seeds')])),
  ...Object.fromEntries(Object.entries(SPECIES).map(([k, s]) => [`flower:${k}`, F(s.plural, 'flower', s.color, 'Flowers')])),
  'find:pebble': F('Pebbles', 'stone', '#b8ab98', 'Finds'),
  'find:agate': F('Agates', 'stone', '#c9774f', 'Finds'),
  'find:crystal': F('Crystals', 'crystal', '#c9c3ff', 'Finds'),
  'find:shell': F('Shells', 'shell', '#f0d9c2', 'Finds'),
  'find:arrowhead': F('Arrowheads', 'arrowhead', '#5d4a44', 'Finds'),
  clipping: F('Clippings', 'leaf', '#7fa36a', 'Garden'),
  fibre: F('Plant fibre', 'leaf', '#b9a56a', 'Garden'),
  salt: F('Salt crystals', 'salt', '#f1ede6', 'Gathered'),
  pinecone: F('Pine cones', 'pine', '#8a5f3a', 'Gathered'),
  driftwood: F('Driftwood', 'leaf', '#a8916f', 'Gathered'),
  regolith: F('Moon dust', 'stone', '#a3a3a6', 'Moon'),
  ice: F('Moon ice', 'ice', '#bfe3ff', 'Moon'),
  moonglass: F('Moon glass', 'crystal', '#9fd6c8', 'Moon'),
  sample: F('World samples', 'crystal', '#b6e0ff', 'Worlds'),
};
export function itemInfo(id) {
  if (ITEMS[id]) return ITEMS[id];
  if (id.startsWith('sample:')) return { ...ITEMS.sample, name: id.slice(7) };
  return F(id, 'leaf', '#ccc', 'Other');
}

const params = new URLSearchParams(location.search);
export const UNLOCK_ALL = params.get('unlock') === 'all';

const fresh = () => ({
  v: 1, mode: 'walk', inv: { 'seed:snapdragon': 4, 'seed:columbine': 3, 'seed:cosmos': 3, 'seed:poppy': 2, 'seed:lavender': 2, 'seed:sunflower': 2 },
  beds: [], rocket: { parts: [] }, unlocks: {}, moon: { modules: {}, bonsai: null }, journal: { species: {}, planets: {} }, gather: {}, seen: {},
});
let G = slice('game', fresh);
for (const [k, v] of Object.entries(fresh())) if (G[k] === undefined) G[k] = v;
if (UNLOCK_ALL) {
  // test mode: a deep copy with everything unlocked; never persisted
  G = JSON.parse(JSON.stringify(G));
  G.rocket.parts = ['body', 'nose', 'fins', 'engine', 'capsule'];
  G.unlocks = { ...G.unlocks, rocket: true, moon: true, warp: true, fleet: true };
  G.moon.modules = { habitat: true, greenhouse: true, antenna: true };
  for (const k of Object.keys(ITEMS)) G.inv[k] = Math.max(G.inv[k] || 0, 20);
}
let listeners = new Set();
export const game = {
  get data() { return G; },
  count(id) { return G.inv[id] || 0; },
  add(id, n = 1) { G.inv[id] = (G.inv[id] || 0) + n; save(); emit({ type: 'add', id, n }); },
  take(id, n = 1) { if ((G.inv[id] || 0) < n) return false; G.inv[id] -= n; if (!G.inv[id]) delete G.inv[id]; save(); emit({ type: 'take', id, n }); return true; },
  has(cost) { return Object.entries(cost).every(([id, n]) => game.count(id) >= n || (id === 'find:any' && anyFinds() >= n) || (id === 'flower:any' && anyOf('flower:') >= n)); },
  pay(cost) {
    if (!game.has(cost)) return false;
    for (const [id, n] of Object.entries(cost)) {
      if (id === 'find:any' || id === 'flower:any') {
        let left = n; const pre = id === 'find:any' ? 'find:' : 'flower:';
        // spend the commonest first (arrowheads and crystals are kept when possible)
        const order = Object.keys(G.inv).filter((k) => k.startsWith(pre)).sort((a, b) => (G.inv[b] || 0) - (G.inv[a] || 0));
        for (const k of order) { const t = Math.min(left, G.inv[k]); G.inv[k] -= t; if (!G.inv[k]) delete G.inv[k]; left -= t; if (!left) break; }
      } else { G.inv[id] -= n; if (!G.inv[id]) delete G.inv[id]; }
    }
    save(); emit({ type: 'pay', cost }); return true;
  },
  unlock(k) { if (!G.unlocks[k]) { G.unlocks[k] = Date.now(); save(); emit({ type: 'unlock', k }); } },
  unlocked(k) { return !!G.unlocks[k]; },
  save, on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
function anyOf(pre) { return Object.entries(G.inv).filter(([k]) => k.startsWith(pre)).reduce((s, [, n]) => s + n, 0); }
function anyFinds() { return anyOf('find:'); }
game.total = anyOf;
function save() { if (!UNLOCK_ALL) persist(); }
function emit(e) { for (const fn of listeners) { try { fn(e); } catch (err) { console.warn(err); } } }
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
