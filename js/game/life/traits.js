// Combinatorial traits: nothing is picked from a list of finished creatures or cultures. A body is a
// vector of continuous genes; a culture is a vector of leanings plus its own sound inventory. What a
// thing is called, how it looks and how it behaves all fall out of those numbers.
import { rng, hash } from '../names.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
// ---------------------------------------------------------------- bodies
// genes (all 0..1): size, diet (0 plants .. 1 meat), insulation, metabolism, social, nocturnal,
// legs (0 low/sprawling .. 1 long), armour, fecundity, cognition, lowAir (how little oxygen it needs),
// heat (preferred temperature, mapped to tempLo..tempHi of its world)
export const GENES = ['size', 'diet', 'insulation', 'metabolism', 'social', 'nocturnal', 'legs', 'armour', 'fecundity', 'cognition', 'lowAir', 'heat'];
export function randomGenome(r) { const g = {}; for (const k of GENES) g[k] = r(); g.cognition *= 0.3; return g; }
export function mutate(g, r, rate = 0.08) { const o = {}; for (const k of GENES) o[k] = clamp(g[k] + (r() - 0.5) * 2 * rate); return o; }
// real scaling: the largest body a world allows shrinks with gravity (bone strength ~ size^2, weight ~ size^3)
export const maxSize = (R) => clamp(1.6 / Math.pow(R.g / 9.81, 0.9), 0.4, 3);
export function bodySize(g, R) { return 0.25 + g.size * maxSize(R); } // metres at the shoulder-ish
// degrees C this body is comfortable at
export const prefTemp = (g, R) => R.tempC - 35 + g.heat * 70;

// how well a body fits a place (0..1). local = { tempC, o2, food, prey }
export function fitness(g, R, local) {
  const dT = local.tempC - prefTemp(g, R);
  const cold = dT < 0 ? -dT / (12 + g.insulation * 30 + g.size * 8) : 0;  // fur and bulk keep heat in
  const hot = dT > 0 ? dT / (14 + (1 - g.insulation) * 18) : 0;
  let f = Math.exp(-(cold * cold + hot * hot));
  // fast metabolisms need oxygen; adapted bodies need less but pay in speed
  const o2need = 0.02 + (1 - g.lowAir) * 0.12 * (0.4 + g.metabolism);
  f *= clamp(local.o2 / o2need, 0, 1);
  // heavy armour and long legs cost more under high gravity
  f *= 1 - clamp((R.g / 9.81 - 1) * (g.armour * 0.3 + g.legs * 0.3), 0, 0.6);
  // food: plant eaters need ground cover, meat eaters need prey
  const food = local.food * (1 - g.diet) + local.prey * g.diet;
  f *= clamp(food * 1.4, 0, 1);
  return f;
}
// body plan for the renderer (three rigged plans exist): legs + size + armour choose it
export function planOf(g) { return g.legs < 0.33 || g.armour > 0.72 ? 'crawler' : g.legs > 0.66 && g.size < 0.75 ? 'strider' : 'quad'; }

// a readable description built from the genes, never from a fixed label list
export function describeBody(g, R) {
  const s = bodySize(g, R);
  const bits = [];
  bits.push(s < 0.5 ? 'small' : s < 1.1 ? 'mid-sized' : s < 2 ? 'large' : 'huge');
  if (g.insulation > 0.7) bits.push('thick-coated'); else if (g.insulation < 0.2) bits.push('bare-skinned');
  if (g.armour > 0.65) bits.push('plated');
  bits.push(g.legs > 0.66 ? 'long-legged' : g.legs < 0.33 ? 'low-slung' : 'four-footed');
  const diet = g.diet < 0.3 ? 'grazer' : g.diet > 0.7 ? 'hunter' : 'forager';
  const when = g.nocturnal > 0.65 ? ', out at night' : '';
  const herd = g.social > 0.65 ? ' that lives in herds' : g.social < 0.25 ? ' that keeps alone' : '';
  return `${bits.join(' ')} ${diet}${herd}${when}`;
}

// ---------------------------------------------------------------- languages
// each lineage or culture gets its own sound inventory, so names within one people sound related
const ONSETS = ['b', 'd', 'g', 'k', 'p', 't', 'm', 'n', 'l', 'r', 's', 'v', 'z', 'h', 'th', 'sh', 'kh', 'dr', 'tr', 'q', 'y', 'w', 'f', 'gr', 'br'];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'aa', 'ei', 'ou', 'ia', 'ae', 'y', 'oo'];
const CODAS = ['', '', 'n', 'r', 'l', 's', 'k', 'th', 'm', 'x', 'nd', 'rk', 'sh'];
export function makeLanguage(seed) {
  const r = rng(hash(seed, 0x1a9));
  const pick = (arr, n) => { const a = [...arr], o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(r() * a.length), 1)[0]); return o; };
  const L = { on: pick(ONSETS, 5 + Math.floor(r() * 6)), nu: pick(NUCLEI, 3 + Math.floor(r() * 4)), co: pick(CODAS, 2 + Math.floor(r() * 4)), syl: 1 + Math.floor(r() * 2.4), apos: r() < 0.2 };
  L.word = (s2) => {
    const q = rng(hash(seed, s2, 0x77)); const n = L.syl + (q() < 0.4 ? 1 : 0); let w = '';
    for (let i = 0; i < n; i++) { w += L.on[Math.floor(q() * L.on.length)] + L.nu[Math.floor(q() * L.nu.length)]; if (i === n - 1 || q() < 0.25) w += L.co[Math.floor(q() * L.co.length)]; if (L.apos && i === 0 && n > 1 && q() < 0.5) w += "'"; }
    return w[0].toUpperCase() + w.slice(1);
  };
  return L;
}

// ---------------------------------------------------------------- cultures
// leanings (0..1): open (trade vs keep-out), martial, devout, craft, kin (clan ties), roam (settled vs moving)
export const LEAN = ['open', 'martial', 'devout', 'craft', 'kin', 'roam'];
export function cultureFrom(seed, parent, local, r) {
  const c = { seed, lang: parent ? parent.lang : makeLanguage(seed) };
  for (const k of LEAN) c[k] = parent ? clamp(parent[k] + (r() - 0.5) * 0.35) : r();
  // what they hold sacred comes from what shapes their lives most where they began
  const cand = [['the sea', local.water], ['the cold', local.cold], ['the sun', local.hot], ['the old trees', local.wood], ['the stone', local.stone], ['the sky lights', local.moons], ['their dead', 0.3 + r() * 0.3], ['the herds', local.herds]];
  cand.sort((a, b) => b[1] - a[1]); c.sacred = parent && r() < 0.6 ? parent.sacred : cand[Math.floor(r() * 2)][0];
  c.material = local.stone > local.wood ? (local.stone > 0.6 ? 'cut stone' : 'fieldstone') : local.wood > 0.3 ? 'timber' : local.salt > 0.4 ? 'salt brick' : local.cold > 0.6 ? 'packed ice' : 'mud brick';
  c.roof = parent && r() < 0.7 ? parent.roof : r(); // 0 flat .. 0.5 dome .. 1 steep
  c.hue = parent ? (parent.hue + (r() - 0.5) * 0.12 + 1) % 1 : r();
  c.name = parent ? c.lang.word(hash(seed, 3)) : c.lang.word(hash(seed, 1));
  return c;
}
export function describeCulture(c) {
  const t = [];
  t.push(c.open > 0.6 ? 'eager traders' : c.open < 0.3 ? 'wary of outsiders' : 'cautious traders');
  if (c.martial > 0.65) t.push('quick to fight'); else if (c.martial < 0.25) t.push('slow to anger');
  if (c.devout > 0.6) t.push(`devoted to ${c.sacred}`); else t.push(`who honour ${c.sacred}`);
  if (c.craft > 0.65) t.push('fine builders');
  if (c.roam > 0.6) t.push('often on the move');
  return t.join(', ');
}
