// The bag's rules, shared by the game and the server (server/src/bag.js). Signed in, the server owns every count in
// your bag: the game shows what the server says, plus what it has asked for and not yet heard back about.
//
// How things get into the bag:
//   * the server hands them over itself (a box you take from, a find, a fish you stow, a piece taken down, a craft at
//     a station, a trade): it counts them in, nothing to check
//   * you make them with your hands (a hand recipe): the server pays the cost from your bag and adds what it makes
//   * the world you are in made them (tending the garden, digging, a planet's samples, a market on a living world):
//     the server can't see those worlds, so it takes the claim within a pace a real player keeps (BUDGET below), and
//     anything you spent here and get back (a tank emptied back out of a rocket, the ship's hold) comes back first
//     from what you spent (escrow), so that is never limited
//   * crafted and set-down things (glass, tanks, crates, safes...) can only come from a craft, a box or a refund
// Spending is always checked: the server takes it only if your bag has it.
import { ITEMS } from './items.js';
import { RECIPES, COST_ALIAS } from './g7/craft.js';

export const BAG_MAX = 99999;            // one stack's most
export const ESC_MAX = 99999;            // how much spent-here can be waiting to come back, per item
export const OPS_MAX = 64;               // ops in one message
export const EXTRA = ['propellant', 'escapepod', 'shipkit', 'beacon']; // ship things the universe uses
const SAMPLE_RE = /^sample:[A-Za-z0-9 '_.-]{1,48}$/;
export const itemOk = (id) => typeof id === 'string' && id.length <= 60 && id !== 'sample' && (Object.prototype.hasOwnProperty.call(ITEMS, id) || EXTRA.includes(id) || SAMPLE_RE.test(id));

const BULK = new Set(['mat:soil', 'mat:sand', 'mat:stone', 'mat:ice', 'mat:wood', 'regolith', 'ice', 'clipping', 'fibre']);
const COMMON = new Set(['find:pebble', 'find:shell', 'salt', 'pinecone', 'driftwood', 'herb', 'fish', 'meat', 'hide', 'mat:ore', 'mat:crystal', 'water', 'food', 'bait', 'propellant']);
const RARE = new Set(['find:agate', 'find:crystal', 'find:arrowhead', 'moonglass', 'mat:metal', 'cloth']);
export function tierOf(id) {
  if (BULK.has(id)) return 'bulk';
  if (COMMON.has(id) || id.startsWith('seed:') || id.startsWith('flower:')) return 'common';
  if (RARE.has(id) || id.startsWith('sample:')) return 'rare';
  return 'made'; // glass, seal, tank, prop, cooked fish, fish oil, things to set down, ship kits
}
// burst: claimable at once; per: claimable per minute after that
export const BUDGET = { bulk: { burst: 800, per: 400 }, common: { burst: 200, per: 60 }, rare: { burst: 40, per: 10 }, made: { burst: 0, per: 0 } };
// moving an old save onto the server: each stack is taken up to this (an honest bag is far under it)
export const IMPORT_CAP = { bulk: 5000, common: 2000, rare: 400, made: 60 };
export const budgetOf = (id) => BUDGET[tierOf(id)];
// tokens a claim may use now (a bucket that refills at per/minute up to burst)
export const tokensNow = (id, tok, tt, now) => { const b = budgetOf(id); return Math.min(b.burst, Math.max(0, tok) + Math.max(0, now - tt) / 60e3 * b.per); };

// a saved bag, cleaned for import: known items only, whole counts, capped. Returns { inv, cut: [[id, had, kept]] }
export function cleanImport(raw) {
  const inv = {}, cut = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { inv, cut };
  for (const [id, v] of Object.entries(raw).slice(0, 400)) {
    const n = Math.floor(+v);
    if (!itemOk(id) || !Number.isFinite(n) || n <= 0) { if (n > 0) cut.push([String(id).slice(0, 60), n, 0]); continue; }
    const cap = IMPORT_CAP[tierOf(id)], k = Math.min(n, cap);
    inv[id] = k; if (k < n) cut.push([id, n, k]);
  }
  return { inv, cut };
}

// what a cost really takes from this bag: crystal / fuel / sand from whichever pile you have (js/game/g7/craft.js
// COST_ALIAS), 'find:any' / 'flower:any' from the commonest first. null if the bag can't pay.
export function resolve(cost, inv) {
  const left = { ...inv }, out = {};
  for (const [k, n0] of Object.entries(cost || {})) {
    let n = Math.floor(+n0); if (!(n > 0)) continue;
    let alts = COST_ALIAS[k] || null;
    if (k === 'find:any' || k === 'flower:any') { const pre = k.slice(0, -3); alts = Object.keys(left).filter((x) => x.startsWith(pre) && left[x] > 0).sort((a, b) => left[b] - left[a]); }
    if (!alts) alts = [k];
    for (const id of alts) { const t = Math.min(n, Math.max(0, left[id] || 0)); if (t) { out[id] = (out[id] || 0) + t; left[id] -= t; n -= t; } if (!n) break; }
    if (n) return null;
  }
  return out;
}
export const RECIPE = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
// what a recipe puts in the bag (tools, gear and abilities live in the save, not the bag)
export const recipeOut = (r) => (r && r.give && r.give.item ? { [r.give.item[0]]: r.give.item[1] } : {});
// apply ops to a bag (the game shows the server's bag plus its own ops still on the way)
export function applyOps(inv, ops) {
  const out = { ...inv };
  for (const op of ops) {
    if (op.o === '+') out[op.id] = (out[op.id] || 0) + op.n;
    else if (op.o === '-') out[op.id] = Math.max(0, (out[op.id] || 0) - op.n);
    else if (op.o === 'c') { const r = RECIPE[op.id], paid = r && resolve(r.cost, out); if (paid) { for (const [k, n] of Object.entries(paid)) out[k] -= n; for (const [k, n] of Object.entries(recipeOut(r))) out[k] = (out[k] || 0) + n; } }
  }
  for (const k of Object.keys(out)) if (!(out[k] > 0)) delete out[k];
  return out;
}
