// Hand-placed points of interest around the world spawn (pure data; the game and the server both use it).
// Each is a real place with something to find, dig into or unlock. A place shows on the map and the
// minimap only after you have been there (or seen it from the lookout), never before.
// Garden frame metres (tile null), all inside the flat ground around the garden (< 50 m from its middle).
export const PLACES = [
  { id: 'wardens', name: 'Warden camp', x: -30, z: 38, r: 12, what: 'The Wardens keep the trails. Tents, a storehouse, a fire.' },
  { id: 'reavers', name: 'Reaver post', x: 41, z: 24, r: 11, what: 'A lean-to, a cache, a captive\'s post. They hunt.' },
  { id: 'ruins', name: 'Old ruins', x: -24, z: -36, r: 8, what: 'Broken walls of a house nobody remembers. Something is buried in the rubble.', dig: 4,
    loot: { 'mat:stone': 3, 'mat:crystal': 1 }, found: 'Under the rubble: a cracked hearthstone and a little crystal someone kept on a shelf.' },
  { id: 'lookout', name: 'Lookout hill', x: 30, z: -34, r: 9, top: 5.2, what: 'A grassy hill with a stone cairn on top. From up there you can see every place around the spawn.' },
  { id: 'wreck', name: 'Crashed ship', x: -44, z: -4, r: 7, what: 'A small ship came down hard here. Its hull can be stripped for parts.', dig: 5,
    loot: { 'mat:metal': 4, fibre: 2, propellant: 1 }, found: 'You pry off hull plates and find a sealed propellant cell and a coil of cable insulation (plant fibre).' },
];
// the lookout hill's height (m) at a garden point: a smooth walkable mound (max slope about 30 degrees)
export function lookoutHeight(x, z) {
  const L = PLACES[3], d = Math.hypot(x - L.x, z - L.z), R = 13;
  if (d >= R) return 0;
  const k = 1 - d / R; return L.top * k * k * (3 - 2 * k);
}
// planets (next step): the same kinds of places generated from geology and life: caves in limestone,
// wrecks along travel routes, ruins only where a civilization existed. See the plan Page.
