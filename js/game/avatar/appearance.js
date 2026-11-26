// Player appearance: one small descriptor, saved in garden-save (slice 'avatar') and synced to other
// players as a compact code (ZA1.<base64url, 35 bytes>). Decoding never trusts its input: every byte
// is clamped to a known option, so a peer can only ever pick from the same wardrobe.
//   const d = appearance.get(); appearance.set({ hair: 'long' }); appearance.encode(d) -> 'ZA1.…'
import { slice, persist } from '../../save.js';

export const BODIES = ['f', 'm'];
export const HAIRS = ['buns', 'long', 'buzzedfemale', 'buzzed', 'simpleparted', 'none'];
export const HAIR_LABEL = { buns: 'Topknot buns', long: 'Long', buzzedfemale: 'Short crop', buzzed: 'Buzzed', simpleparted: 'Parted', none: 'Shaved' };
export const OUTFITS = ['robe', 'expl', 'suit'];
export const OUTFIT_LABEL = { robe: 'Garden wear', expl: 'Explorer', suit: 'Space suit' };
export const ACCS = ['kasa', 'hood', 'pauldron', 'pack'];
export const ACC_LABEL = { kasa: 'Straw kasa', hood: 'Hood', pauldron: 'Shoulder guard', pack: 'Travel pack' };
// Fitzpatrick-like range plus a couple of warmer / cooler in-betweens
export const SKIN_TONES = ['#f6d7c3', '#eec1a2', '#e3a985', '#d49a74', '#c68863', '#b07250', '#9a5f3f', '#7f4b30', '#683b25', '#4f2b1b', '#3c2014', '#f0c8a8'];
export const HAIR_COLORS = ['#1b1512', '#2e211a', '#4a3324', '#6b4a2f', '#8c6239', '#b9874f', '#d9b27a', '#e9d3a6', '#9a3b22', '#c25a2c', '#8e8a86', '#e8e4dc', '#3e4a6e', '#5f7f68'];
export const EYE_COLORS = ['#3b2414', '#5a3a22', '#6e5a2e', '#4d6b3a', '#3d6f7a', '#4b6ea8', '#7a8a96', '#2a2a2e'];
// dye slots per outfit (r, g, b of the dye mask). Defaults = the authored colours, except the zen garden wear.
export const DYE_SLOTS = {
  robe: ['Trousers + wrap', 'Leather', 'Linen'],
  expl: ['Leather', 'Cloth', 'Under layer'],
  suit: ['Shell', 'Accent', 'Pads'],
};
export const DYE_DEFAULT = {
  robe: ['#2f3a55', '#7a5434', '#e4ddc9'],
  expl: ['#9c7b5c', '#6f8a5a', '#2f4a36'],
  suit: ['#ecebe6', '#c8643c', '#9a968e'],
};
export const PALETTE = ['#e4ddc9', '#c9bfa6', '#8f8574', '#4a4440', '#1f1d1c', '#2f3a55', '#3e5a7a', '#6f8fb0', '#4f6b4a', '#6f8a5a', '#a3b38a', '#7a5434', '#9c7b5c', '#c89b6a', '#9a3b2a', '#c8643c', '#d9a441', '#b5527a', '#7a5a9a', '#ecebe6'];

export const DEFAULT = () => ({
  v: 1, body: 'f', height: 0.5, build: 0.5, skin: '#e3a985', hair: 'buns', hairColor: '#2e211a', eyes: '#5a3a22', beard: false, brows: true,
  outfit: 'robe', acc: { kasa: false, hood: false, pauldron: false, pack: false }, autoSuit: false,
  dyes: JSON.parse(JSON.stringify(DYE_DEFAULT)), created: false,
});

const hex = (s, def) => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : def);
const pick = (v, list, def) => (list.includes(v) ? v : def);
const num = (v, def) => (Number.isFinite(+v) ? Math.round(Math.min(1, Math.max(0, +v)) * 255) / 255 : def);
export function sanitize(d) {
  const D = DEFAULT(); d = d && typeof d === 'object' ? d : {};
  const out = {
    v: 1, body: pick(d.body, BODIES, D.body), height: num(d.height, D.height), build: num(d.build, D.build), skin: hex(d.skin, D.skin),
    hair: pick(d.hair, HAIRS, D.hair), hairColor: hex(d.hairColor, D.hairColor), eyes: hex(d.eyes, D.eyes), beard: !!d.beard, brows: d.brows !== false,
    outfit: pick(d.outfit, OUTFITS, D.outfit), acc: {}, autoSuit: !!d.autoSuit, dyes: {}, created: !!d.created,
  };
  for (const a of ACCS) out.acc[a] = !!(d.acc && d.acc[a]);
  for (const o of OUTFITS) out.dyes[o] = [0, 1, 2].map((i) => hex(d.dyes && d.dyes[o] && d.dyes[o][i], D.dyes[o][i]));
  return out;
}

// ---- compact code for multiplayer (and share codes)
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => (x & 255).toString(16).padStart(2, '0')).join('');
export function encode(d) {
  d = sanitize(d);
  const b = [1, BODIES.indexOf(d.body) | (d.beard ? 2 : 0) | (d.brows ? 4 : 0) | (d.autoSuit ? 8 : 0), Math.round(d.height * 255), Math.round(d.build * 255),
    ...rgb(d.skin), HAIRS.indexOf(d.hair), ...rgb(d.hairColor), ...rgb(d.eyes), OUTFITS.indexOf(d.outfit), ACCS.reduce((m, a, i) => m | (d.acc[a] ? 1 << i : 0), 0)];
  for (const o of OUTFITS) for (const c of d.dyes[o]) b.push(...rgb(c));
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return 'ZA1.' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const CODE_BYTES = 16 + 27;
export function decode(code) {
  try {
    if (typeof code !== 'string' || !code.startsWith('ZA1.') || code.length > 80) return null;
    const s = atob(code.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
    if (s.length !== CODE_BYTES) return null;
    const b = [...s].map((c) => c.charCodeAt(0));
    if (b[0] !== 1) return null;
    const d = {
      body: BODIES[b[1] & 1], beard: !!(b[1] & 2), brows: !!(b[1] & 4), autoSuit: !!(b[1] & 8), height: b[2] / 255, build: b[3] / 255,
      skin: toHex(b[4], b[5], b[6]), hair: HAIRS[Math.min(b[7], HAIRS.length - 1)], hairColor: toHex(b[8], b[9], b[10]), eyes: toHex(b[11], b[12], b[13]),
      outfit: OUTFITS[Math.min(b[14], OUTFITS.length - 1)], acc: Object.fromEntries(ACCS.map((a, i) => [a, !!(b[15] & (1 << i))])), dyes: {}, created: true,
    };
    let p = 16;
    for (const o of OUTFITS) { d.dyes[o] = []; for (let i = 0; i < 3; i++) { d.dyes[o].push(toHex(b[p], b[p + 1], b[p + 2])); p += 3; } }
    return sanitize(d);
  } catch (e) { return null; }
}

// a few ready-made looks for the creator's "Surprise me" and for NPC / guest players
export function randomLook(seed = Math.random()) {
  let s = Math.floor(seed * 2 ** 31) || 1; const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const P = (a) => a[Math.floor(r() * a.length)];
  const body = r() < 0.5 ? 'f' : 'm';
  const d = DEFAULT();
  Object.assign(d, { body, height: 0.25 + r() * 0.5, build: 0.25 + r() * 0.5, skin: P(SKIN_TONES), hairColor: P(HAIR_COLORS.slice(0, 11)), eyes: P(EYE_COLORS),
    hair: P(body === 'f' ? ['buns', 'long', 'buzzedfemale', 'simpleparted'] : ['buzzed', 'simpleparted', 'long', 'none']), beard: body === 'm' && r() < 0.4,
    outfit: P(['robe', 'robe', 'expl']) });
  d.dyes.robe[0] = P(['#2f3a55', '#3e5a7a', '#4f6b4a', '#4a4440', '#7a5434', '#9a3b2a']);
  d.dyes.robe[2] = P(['#e4ddc9', '#c9bfa6', '#ecebe6', '#a3b38a']);
  d.dyes.expl[1] = P(['#6f8a5a', '#3e5a7a', '#8f8574', '#9a3b2a', '#c89b6a']);
  d.acc.kasa = r() < 0.2; d.acc.pack = d.outfit === 'expl' && r() < 0.5;
  return sanitize(d);
}

let A = null;
function load() { if (!A) { const s = slice('avatar', DEFAULT); A = sanitize(s); Object.assign(s, A); A = s; } return A; }
const listeners = new Set();
export const appearance = {
  get() { return load(); },
  set(patch, { save = true } = {}) {
    const a = load(); const n = sanitize({ ...a, ...patch, acc: { ...a.acc, ...(patch.acc || {}) }, dyes: { ...a.dyes, ...(patch.dyes || {}) } });
    Object.assign(a, n); if (save) persist(300);
    for (const fn of listeners) { try { fn(a); } catch (e) { console.warn('[avatar]', e); } }
    return a;
  },
  replace(d) { return appearance.set(sanitize(d)); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  encode: () => encode(load()), decode,
};
