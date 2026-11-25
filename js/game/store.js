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
  herb: F('Moon herbs', 'leaf', '#a6d98f', 'Moon'),
  // the physical world (g7): what digging, felling and breaking give back
  'mat:soil': F('Soil', 'stone', '#7a5a40', 'Gathered'),
  'mat:sand': F('Sand', 'salt', '#d8c194', 'Gathered'),
  'mat:stone': F('Stone', 'stone', '#9a948b', 'Gathered'),
  'mat:ice': F('Ice', 'ice', '#cfe6f2', 'Gathered'),
  'mat:ore': F('Metal ore', 'stone', '#8a6a55', 'Gathered'),
  'mat:metal': F('Metal bars', 'stone', '#b4bcc2', 'Gathered'),
  'mat:crystal': F('Crystal shards', 'crystal', '#c4bdf7', 'Gathered'),
  'mat:wood': F('Wood', 'leaf', '#a07a52', 'Gathered'),
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
// Save migrations: one step per version, run in order on load (the save is never thrown away).
//   (a whole-save backup and the Tauri disk copy live in ../save.js)
//   v1 -> v2: moon modules were timestamps; now { at, lvl, x?, z?, ry? } (placed + upgradable)
const MIGRATIONS = [
  (g) => { const m = (g.moon && g.moon.modules) || {}; for (const [k, v] of Object.entries(m)) if (!v || typeof v !== 'object') m[k] = { at: typeof v === 'number' ? v : Date.now(), lvl: 1 }; },
  //   v2 -> v3: fleet + where + journal shapes made explicit (older saves had none)
  (g) => {
    if (!g.fleet) g.fleet = { owned: g.unlocks && g.unlocks.warp ? ['skiff'] : [], active: 'skiff' };
    if (!Array.isArray(g.fleet.owned)) g.fleet.owned = [];
    if (g.where === undefined) g.where = null;
    g.journal = g.journal || {}; g.journal.species = g.journal.species || {}; g.journal.planets = g.journal.planets || {};
    for (const e of Object.values(g.journal.species)) if (e && e.kind === 'fauna' && !Array.isArray(e.seen)) e.seen = [];
    g.seen = g.seen || {}; g.gather = g.gather || {};
  },
];
export const SAVE_VERSION = 1 + MIGRATIONS.length;
export function migrate(g) {
  let v = g.v || 1;
  while (v < SAVE_VERSION) { try { MIGRATIONS[v - 1](g); } catch (e) { console.warn('[G] save migration', v, e); } v++; }
  g.v = v; return g;
}
migrate(G);
if (UNLOCK_ALL) {
  // test mode: a deep copy with everything unlocked; never persisted
  G = JSON.parse(JSON.stringify(G));
  G.rocket.parts = ['body', 'nose', 'fins', 'engine', 'capsule'];
  G.unlocks = { ...G.unlocks, rocket: true, moon: true, warp: true, fleet: true };
  G.moon.modules = { habitat: { at: 1, lvl: 1 }, greenhouse: { at: 1, lvl: 1 }, antenna: { at: 1, lvl: 1 }, ...(params.has('modlvl') ? { solar: { at: 1, lvl: +params.get('modlvl') } } : {}) };
  if (params.has('modlvl')) for (const k of ['habitat', 'greenhouse']) G.moon.modules[k].lvl = +params.get('modlvl');
  for (const k of Object.keys(ITEMS)) G.inv[k] = Math.max(G.inv[k] || 0, 20);
  G.fleet = { owned: params.get('ships') === 'one' ? ['skiff'] : ['skiff', 'lantern', 'heron', 'ark'], active: params.get('ship') || 'skiff' };
  G.inv['sample:Test shore'] = 20;
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
