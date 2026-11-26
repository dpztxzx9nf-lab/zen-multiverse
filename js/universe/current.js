// The one place every system reads the laws of the world you are standing in.
//   import { worldRules } from '../universe/current.js'   (or window.zenWorld in the console / other bundles)
//   worldRules.rules          -> the WorldRules object (see rules.js) or null between worlds
//   worldRules.meta           -> { world, pk, era, W } (W = the planet generator, for height / biome lookups)
//   worldRules.onChange(fn)   -> fn(rules, meta) whenever you arrive somewhere, change era, or change dimension; returns unsubscribe
//   worldRules.tempAt(dayFrac, heightM), worldRules.can('combustion'), worldRules.gravity
// Physics, survival, creatures, weather and the sim should read from here instead of keeping their own copies.
let cur = null, meta = {};
const subs = new Set();
export function setCurrentRules(rules, m = {}) {
  cur = rules; meta = m;
  for (const f of subs) { try { f(cur, meta); } catch (e) { console.warn('[worldRules] listener', e); } }
}
export const worldRules = {
  get rules() { return cur; },
  get meta() { return meta; },
  get gravity() { return cur ? cur.gravity : 9.81; },
  can(reaction) { return cur ? cur.can(reaction) : true; },
  tempAt(dayFrac, h) { return cur ? cur.tempAt(dayFrac, h) : 15; },
  onChange(fn) { subs.add(fn); if (cur) { try { fn(cur, meta); } catch (e) { /* */ } } return () => subs.delete(fn); },
};
export const currentRules = () => cur;
if (typeof window !== 'undefined') window.zenWorld = worldRules;
