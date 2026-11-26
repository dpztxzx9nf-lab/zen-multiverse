// Hand-placed points of interest around the world spawn (pure data; the game and the server both use it).
// Each is a real place with something to find, dig into or unlock. A place shows on the map and the
// minimap only after you have been there (or seen it from the lookout), never before.
// Garden frame metres (tile null), all inside the flat ground around the garden (< 55 m from its middle; 60 m is the edge).
export const PLACES = [
  { id: 'wardens', name: 'Warden camp', x: -30, z: 38, r: 12, what: 'The Wardens keep the trails. Tents, a storehouse, a fire.' },
  { id: 'reavers', name: 'Reaver post', x: 41, z: 24, r: 11, what: 'A lean-to, a cache, a captive\'s post. They hunt.' },
  { id: 'ruins', name: 'Old ruins', x: -24, z: -36, r: 8, what: 'Broken walls of a house nobody remembers. Something is buried in the rubble.', dig: 8, at: [-24.27, -36.75], reach: 2.4,
    loot: { 'mat:stone': 3, 'mat:crystal': 1 }, relic: 'hearthstone', found: 'Under the rubble: building stone, a little crystal someone kept on a shelf, and a cracked hearthstone with a family mark cut into it.' },
  { id: 'lookout', name: 'Lookout hill', x: 30, z: -34, r: 9, top: 5.2, what: 'A grassy hill with a stone cairn on top. From up there you can see every place around the spawn.' },
  { id: 'wreck', name: 'Crashed ship', x: -44, z: -4, r: 7, what: 'A small ship came down hard here. Its hull can be stripped for parts.', dig: 10, at: [-44, -4], reach: 3.6,
    loot: { 'mat:metal': 3, fibre: 2 }, relic: 'cell', found: 'You pry off hull plates and a coil of cable insulation (plant fibre). A sealed propellant cell rolls out of the hull onto the ground.' },
  { id: 'cove', name: 'Salt cove', x: 2, z: -35, r: 12, what: 'Deep, still water cut into the salt flat. Something about the headland stone on the far side: the water runs in under it.' },
  // the sea cave: its way in is a tunnel under the headland, a metre below the surface (js/cove.js). Not visible
  // from the lookout; found only from inside, in the air chamber. The dig is the shelf at the back.
  { id: 'seacave', name: 'Sea cave', x: 2, z: -49, r: 3.4, hidden: true, what: 'An air chamber inside the headland, lit by a crack in the roof. There is a dry shelf at the back.', dig: 6, at: [2, -51.4], reach: 1.9, ymin: -1.6, ymax: 2.8,
    loot: { 'mat:crystal': 2, 'mat:ore': 2 }, relic: 'pearl', found: 'You prise loose a crust of crystal and a vein of dark ore from the shelf. In a pool on the shelf, a big pearl in an old shell.' },
];
// a dig is shared: everyone who digs at it moves the same rubble (two people dig twice as fast); when it
// gives way, everyone who helped gets the materials and the one relic drops on the ground for anyone to
// pick up. Then it settles and fills again after a while (the server owns all of this when online).
export const DIG_REFILL_MS = 6 * 3600e3;
export const RELICS = { hearthstone: 'cracked hearthstone', cell: 'sealed propellant cell', pearl: 'sea-cave pearl' };
// things to gather that grow back: the same for everyone (the server keeps the count when online). Each spot
// holds up to 'max', you take one 'per' press, and one comes back every 'every' ms (driftwood washes up, reeds regrow).
import { DRIFT, REEDS, COVE, shoreR } from './cove.js';
export const NODES = [
  ...DRIFT.map((d, i) => ({ id: 'drift' + i, kind: 'drift', name: 'driftwood', x: d.x, z: d.z, reach: 1.9, give: { 'mat:wood': 1 }, max: 3, every: 20 * 60e3, verb: 'Break off a piece of driftwood' })),
  ...REEDS.map((d, i) => ({ id: 'reed' + i, kind: 'reed', name: 'reeds', x: d.x, z: d.z, reach: 1.8, give: { fibre: 1 }, max: 4, every: 10 * 60e3, verb: 'Cut an armful of reeds (fibre)' })),
];
// how many are at a gathering spot now, from the last record {n, ts} (null = untouched, full)
// the cove's fish: one shared stock (the server's count when online). A catch takes one; they come back slowly,
// so two people fishing hard empty it for an hour. You fish from the water or the bank (up to 'reach' outside
// the shoreline: a rod casts a few metres).
export const FISH = { id: 'covefish', kind: 'fish', name: 'cove fish', max: 8, every: 6 * 60e3, reach: 9, minGap: 6000 };
export function atCove(x, z, pad = FISH.reach) { const th = Math.atan2(x - COVE.x, z - COVE.z); return Math.hypot(x - COVE.x, z - COVE.z) < shoreR(th) + pad; }
export function nodeNow(nd, r, t = Date.now()) {
  if (!r) return { n: nd.max, ts: t };
  const gained = Math.floor(Math.max(0, t - r.ts) / nd.every), n = Math.min(nd.max, r.n + gained);
  return { n, ts: n >= nd.max ? t : r.ts + gained * nd.every };
}
export function digSpot(p) { return p.at ? { x: p.at[0], z: p.at[1] } : { x: p.x, z: p.z }; }
// the lookout hill's height (m) at a garden point: a smooth walkable mound (max slope about 30 degrees)
export function lookoutHeight(x, z) {
  const L = PLACES[3], d = Math.hypot(x - L.x, z - L.z), R = 13;
  if (d >= R) return 0;
  const k = 1 - d / R; return L.top * k * k * (3 - 2 * k);
}
// planets (next step): the same kinds of places generated from geology and life: caves in limestone,
// wrecks along travel routes, ruins only where a civilization existed. See the plan Page.
