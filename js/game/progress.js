// "What next?" — one calm sentence, worked out from the save. No quest log, no checklist:
// it shows as the first line of the Bag and, now and then, as a soft whisper on arriving somewhere.
import { game, itemInfo, dayKey } from './store.js';
import { ROCKET_PARTS } from './rocket.js';
import { SHIPS, fleetData, canCommission, worldsVisited } from './fleet.js';
import { hasSuit, nextSuitHint } from './skills.js';

const MOD_ORDER = [['habitat', 'a habitat'], ['greenhouse', 'a greenhouse'], ['antenna', 'an antenna'], ['solar', 'a solar array']];
const nameOf = (id) => (id === 'find:any' ? 'finds' : id === 'flower:any' ? 'flowers' : itemInfo(id).name.toLowerCase());
function missing(cost) {
  const out = [];
  for (const [id, n] of Object.entries(cost)) {
    const have = id === 'find:any' ? game.total('find:') : id === 'flower:any' ? game.total('flower:') : game.count(id);
    if (have < n) out.push(`${n - have} more ${nameOf(id)}`);
  }
  return out;
}
const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// returns { key, text } (key changes when the suggestion really changes)
export function nextStep() {
  const G = game.data, today = dayKey();
  const beds = (G.beds || []).filter(Boolean);
  if (!beds.length) return { key: 'plant', text: 'The beds by the house are waiting. A seed from your bag would do.' };
  const dry = beds.filter((b) => !(b.w || []).includes(today));
  if (dry.length && dry.length === beds.length) return { key: 'water:' + today, text: 'The beds have not had water today.' };
  const parts = (G.rocket && G.rocket.parts) || [];
  const next = ROCKET_PARTS.find((p) => !parts.includes(p.id));
  if (next) {
    const m = missing(next.cost);
    return m.length
      ? { key: 'part:' + next.id + ':' + m.length, text: `The rocket's ${next.name.toLowerCase()} still wants ${list(m.slice(0, 2))}.` }
      : { key: 'part:' + next.id, text: `There is enough to build the rocket's ${next.name.toLowerCase()} at the bench.` };
  }
  if (!hasSuit()) {
    const suit = nextSuitHint();
    if (suit) {
      if (!G.seen || !G.seen.moon) return { key: suit.key, text: 'The rocket can fly, but the moon has no air. ' + suit.text };
      return suit;
    }
  }
  if (!G.seen || !G.seen.moon) return { key: 'launch', text: 'The rocket stands ready on the pad.' };
  const mods = (G.moon && G.moon.modules) || {};
  const mod = MOD_ORDER.find(([id]) => !mods[id]);
  if (mod) return { key: 'mod:' + mod[0], text: `On the moon, ${mod[1]} could go up next.` };
  if (!game.unlocked('warp')) return { key: 'warp', text: 'The antenna is listening. Someone may answer soon.' };
  const fauna = Object.values((G.journal && G.journal.species) || {}).filter((e) => e.kind === 'fauna').length;
  if (!fauna) return { key: 'watch', text: 'On a new world, stand still and watch an animal for a while to name it.' };
  const F = fleetData();
  const ship = SHIPS.find((s) => s.cost && !F.owned.includes(s.id));
  if (ship) {
    if (canCommission(ship)) return { key: 'ship:' + ship.id, text: `The ${ship.name} could be made now, from the star map.` };
    const w = (ship.worlds || 0) - worldsVisited();
    if (w > 0) return { key: 'ship:' + ship.id + ':w' + w, text: `Visit ${w} more world${w > 1 ? 's' : ''} and the ${ship.name} can be made.` };
    const { sample = 0, ...rest } = ship.cost; const m = missing(rest); const s = sample - game.total('sample:');
    if (s > 0) m.unshift(`${s} more world sample${s > 1 ? 's' : ''}`);
    return { key: 'ship:' + ship.id + ':' + m.length, text: `The ${ship.name} still wants ${list(m.slice(0, 2))}.` };
  }
  return { key: 'free', text: `${worldsVisited()} worlds visited, ${fauna} creatures named. There is always another star.` };
}
