// Things you set down in the world and walk up to: the stations where things are made and the boxes where things
// are kept (Minecraft-style: a workbench has its own menu, a chest its own slots). Shared by the client
// (js/storage.js draws them and opens their menus) and the server (server/src/storage.js keeps them).
//   kind 'station': recipes with station === id are made within STATION_R of one (js/game/g7/craft.js)
//   kind 'box': slots, each a stack of up to STACK of one bag item, or one real object (a relic, the geode, a fish)
// A chest opens for anyone (so a chest is raidable: lock real valuables in a safe). Breaking a chest takes a few
// blows and spills what was inside on the ground for anyone. A safe opens only for its owner and the friends the
// owner adds, and cannot be broken or carried off by anyone else; the owner empties it and takes it down.
export const FIXTURES = {
  bench: { name: 'Workbench', kind: 'station', item: 'fx:bench', r: 0.75, hp: 0, verb: 'Work at the workbench' },
  forge: { name: 'Metal smelter', kind: 'station', item: 'fx:forge', r: 0.8, hp: 0, verb: 'Work at the smelter' },
  fire: { name: 'Campfire', kind: 'station', item: 'fx:fire', r: 0.5, hp: 0, verb: 'Cook at the campfire' },
  chest: { name: 'Wooden crate', kind: 'box', item: 'fx:chest', r: 0.5, hp: 40, slots: 20, open: 'anyone', verb: 'Open the crate' },
  safe: { name: 'Metal safe', kind: 'box', item: 'fx:safe', r: 0.45, hp: 0, slots: 12, open: 'owner', verb: 'Open the safe' },
};
export const FIXTURE_KINDS = Object.keys(FIXTURES);
export const STATION_R = 3;          // metres: close enough to work at a station
export const BOX_R = 2.6;            // metres: close enough to reach into a box
export const PLACE_R = 4;            // metres from you a thing can be set down
export const GAP = 0.9;              // metres between two things set down
export const STACK = 99;             // one slot holds this many of one bag item
export const CAPS = { bench: 4, forge: 2, fire: 4, chest: 10, safe: 4 }; // each player, each world
export const WORLD_CAP = 400;        // everything set down in one world
export const ALLOW_MAX = 8;          // friends one safe can open for
export const HANDS = 3;              // things carried in two hands
export const CARRY_GEAR = { satchel: 3, acc_pack: 3 }; // what you wear adds room for carrying
export const carryFor = (gear = []) => HANDS + gear.reduce((n, g) => n + (CARRY_GEAR[g] || 0), 0);
export const STATION_NAMES = { bench: 'a workbench', forge: 'a smelter', fire: 'a campfire' };
export const BREAK_HIT = { axe: 10, pick: 8, hand: 4 }; // a chest's 40 hp: 4 axe blows, 10 with bare hands
export const HIT_EVERY = 600;        // ms between blows
// slots a box's contents use: bag items as stacks of STACK, each real object one slot
export function slotsUsed(inv = {}, objs = 0) {
  let n = objs;
  for (const v of Object.values(inv)) if (v > 0) n += Math.ceil(v / STACK);
  return n;
}
// how many of item k still fit (bag items only)
export function room(def, inv = {}, objs = 0, k) {
  const free = def.slots - slotsUsed(inv, objs), have = inv[k] || 0;
  const top = have % STACK ? STACK - (have % STACK) : 0; // the part-filled stack takes more first
  return Math.max(0, top + Math.max(0, free) * STACK);
}
// bag item ids a box will take: plain item ids (no fixtures in boxes, nothing odd)
export const ITEM_RE = /^(?!fx:)[a-z][a-z0-9_]*(:[A-Za-z0-9 _-]{1,24})?$/;
