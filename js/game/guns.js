// Shared gun model for the client and the server. A gun is four parts (body, barrel,
// mag, sight), a maker, a rarity, and sometimes a perk. Stats come from the parts.
// The server is the only one that issues ids; this file only rolls and checks shape.

export const MAKERS = {
  Halvorsen: { color: '#c45c26', ident: 'heavy and steady', dmg: 1.15, rpm: 0.78, mag: 1.3, spread: 0.88, reload: 1.05 },
  Scrapwright: { color: '#8a7a3a', ident: 'fast and kicky', dmg: 0.9, rpm: 1.32, mag: 0.85, spread: 1.18, reload: 0.92 },
  Choirworks: { color: '#3aa7b8', ident: 'energy shots', dmg: 1.06, rpm: 1.0, mag: 0.95, spread: 0.92, reload: 1.0 },
};

export const GUN_TYPES = {
  rifle: { dmg: 22, rpm: 8, mag: 30, reload: 2.1, spread: 0.018, range: 80, glyph: 'RF' },
  pistol: { dmg: 16, rpm: 6, mag: 12, reload: 1.4, spread: 0.028, range: 45, glyph: 'PS' },
  shotgun: { dmg: 28, rpm: 1.5, mag: 6, reload: 2.6, spread: 0.08, range: 22, glyph: 'SG' },
};

export const RARITIES = [
  { id: 'common', label: 'Common', color: '#9a9a9a', roll: 0, perk: false, weight: 50 },
  { id: 'uncommon', label: 'Uncommon', color: '#3d9e4a', roll: 0.08, perk: false, weight: 28 },
  { id: 'rare', label: 'Rare', color: '#3b7ddd', roll: 0.16, perk: true, weight: 14 },
  { id: 'epic', label: 'Epic', color: '#9b4de0', roll: 0.24, perk: true, weight: 6 },
  { id: 'relic', label: 'Relic', color: '#d4a017', roll: 0.32, perk: true, weight: 2 },
];

export const PERKS = ['Ricochet', 'Shatter', 'Digger', 'Quiet'];
export const PARTS = ['body', 'barrel', 'mag', 'sight'];
export const MAKER_NAMES = Object.keys(MAKERS);
export const TYPE_NAMES = Object.keys(GUN_TYPES);

export function hash(...a) {
  let h = 2166136261;
  for (const x of a) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function rarityById(id) { return RARITIES.find((r) => r.id === id) || RARITIES[0]; }

export function rollRarity(r) {
  let n = r() * RARITIES.reduce((s, x) => s + x.weight, 0);
  for (const x of RARITIES) { n -= x.weight; if (n <= 0) return x.id; }
  return 'common';
}

function partRoll(r, lo, hi, rarityRoll) {
  const t = r() * (1 - rarityRoll * 0.35) + rarityRoll * 0.35;
  return lo + (hi - lo) * t;
}

export function gunName(g) {
  const barrel = g.parts && g.parts.barrel && g.parts.barrel.id ? String(g.parts.barrel.id) : 'Plain';
  const typ = (g.type || 'rifle').replace(/^./, (c) => c.toUpperCase());
  return `${g.maker || 'Scrapwright'} ${barrel} ${typ}`;
}

export function gunStats(g) {
  const typ = GUN_TYPES[g.type] || GUN_TYPES.pistol;
  const mk = MAKERS[g.maker] || MAKERS.Scrapwright;
  const rare = rarityById(g.rarity);
  const b = (g.parts && g.parts.barrel && g.parts.barrel.k) || 0.5;
  const m = (g.parts && g.parts.mag && g.parts.mag.k) || 0.5;
  const s = (g.parts && g.parts.sight && g.parts.sight.k) || 0.5;
  const boost = 1 + rare.roll;
  const dmg = typ.dmg * mk.dmg * (0.9 + 0.3 * b) * boost;
  const rpm = typ.rpm * mk.rpm;
  const mag = Math.max(1, Math.round(typ.mag * mk.mag * (0.8 + 0.5 * m) * (1 + rare.roll * 0.4)));
  const reload = typ.reload * mk.reload * (1.15 - 0.35 * m);
  const spread = typ.spread * mk.spread * (1.15 - 0.4 * s) * (1 - rare.roll * 0.2);
  const range = typ.range * (0.85 + 0.4 * b) * (1 + rare.roll * 0.15);
  return {
    dmg: Math.round(dmg * 10) / 10,
    rpm: Math.round(rpm * 10) / 10,
    mag,
    reload: Math.round(reload * 100) / 100,
    spread: Math.round(spread * 1000) / 1000,
    range: Math.round(range),
  };
}

const BARREL_NAMES = ['Short', 'Long', 'Heavy', 'Thin', 'Sawed'];
const MAG_NAMES = ['Light', 'Std', 'Drum', 'Slim'];
const SIGHT_NAMES = ['Iron', 'Reflex', 'Tube', 'Peep'];

export function rollGun(seed, opts = {}) {
  const r = typeof seed === 'function' ? seed : rng(hash(seed, opts.salt || 0));
  const type = opts.type && GUN_TYPES[opts.type] ? opts.type : TYPE_NAMES[Math.floor(r() * TYPE_NAMES.length)];
  const rarity = opts.rarity && rarityById(opts.rarity).id === opts.rarity ? opts.rarity : rollRarity(r);
  const maker = opts.maker && MAKERS[opts.maker] ? opts.maker : MAKER_NAMES[Math.floor(r() * MAKER_NAMES.length)];
  const rare = rarityById(rarity);
  const parts = {
    body: { maker, typ: type },
    barrel: { id: BARREL_NAMES[Math.floor(r() * BARREL_NAMES.length)], k: partRoll(r, 0, 1, rare.roll) },
    mag: { id: MAG_NAMES[Math.floor(r() * MAG_NAMES.length)], k: partRoll(r, 0, 1, rare.roll) },
    sight: { id: SIGHT_NAMES[Math.floor(r() * SIGHT_NAMES.length)], k: partRoll(r, 0, 1, rare.roll) },
  };
  const perk = rare.perk ? (opts.perk && PERKS.includes(opts.perk) ? opts.perk : PERKS[Math.floor(r() * PERKS.length)]) : null;
  const g = { id: opts.id || null, type, maker, rarity, perk, parts, starter: !!opts.starter };
  g.name = gunName(g);
  g.stats = gunStats(g);
  return g;
}

export function starterPistol(id) {
  const g = {
    id: id || null,
    type: 'pistol',
    maker: 'Scrapwright',
    rarity: 'common',
    perk: null,
    starter: true,
    parts: {
      body: { maker: 'Scrapwright', typ: 'pistol' },
      barrel: { id: 'Short', k: 0.35 },
      mag: { id: 'Std', k: 0.4 },
      sight: { id: 'Iron', k: 0.2 },
    },
  };
  g.name = gunName(g);
  g.stats = gunStats(g);
  return g;
}

export function validateGun(g) {
  if (!g || typeof g !== 'object') return 'shape';
  if (!GUN_TYPES[g.type]) return 'type';
  if (!MAKERS[g.maker]) return 'maker';
  if (!rarityById(g.rarity) || rarityById(g.rarity).id !== g.rarity) return 'rarity';
  if (g.perk != null && !PERKS.includes(g.perk)) return 'perk';
  if (rarityById(g.rarity).perk === false && g.perk) return 'perk-on-common';
  if (!g.parts || typeof g.parts !== 'object') return 'parts';
  for (const k of PARTS) if (!g.parts[k] || typeof g.parts[k] !== 'object') return 'part-' + k;
  if (g.parts.body.maker && g.parts.body.maker !== g.maker) return 'body-maker';
  return null;
}

export function publicGun(g) {
  if (!g) return null;
  const stats = g.stats || gunStats(g);
  return { id: g.id, type: g.type, maker: g.maker, rarity: g.rarity, perk: g.perk || null, parts: g.parts, name: g.name || gunName(g), stats, starter: !!g.starter };
}
