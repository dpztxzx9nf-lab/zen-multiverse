// The bag's items: what each id is called and how it shows. Pure data (no save, no DOM), so the server shares it
// (js/game/bag-rules.js, server/src/bag.js). js/game/store.js re-exports all of it.
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
  cloth: F('Woven cloth', 'leaf', '#c9bfa6', 'Crafted'),
  glass: F('Visor glass', 'crystal', '#bfe3ff', 'Crafted'),
  seal: F('Pitch seal', 'leaf', '#5a3a22', 'Crafted'),
  tank: F('Oxygen tank', 'stone', '#b4bcc2', 'Crafted'),
  prop: F('Rocket propellant', 'water', '#d9c79a', 'Crafted'),
  // the sea (water/fishing.js)
  fish: F('Fish', 'fish', '#9fb8c4', 'Sea'),
  hide: F('Hide', 'leaf', '#8a7058', 'Gathered'),
  cooked_fish: F('Cooked fish', 'fish', '#c98f5a', 'Sea'),
  bait: F('Bait', 'leaf', '#b5736a', 'Sea'),
  fish_oil: F('Fish oil', 'water', '#d8b45a', 'Sea'),
  // living worlds: what peoples trade (life/economy.js)
  food: F('Food', 'leaf', '#c9a46a', 'Trade'),
  water: F('Water skins', 'ice', '#9fc9e0', 'Trade'),
  meat: F('Raw meat', 'leaf', '#b5655a', 'Gathered'),
  // things to set down in the world (js/game/fixtures.js): the bag's "Set down" places them
  'fx:bench': F('Workbench', 'build', '#a07a52', 'To set down'),
  'fx:forge': F('Metal smelter', 'stone', '#8a8580', 'To set down'),
  'fx:fire': F('Campfire', 'star', '#d98a4a', 'To set down'),
  'fx:chest': F('Wooden crate', 'bag', '#a8835a', 'To set down'),
  'fx:locker': F('Metal locker', 'stone', '#7f8a92', 'To set down'),
  'fx:safe': F('Metal safe', 'stone', '#9aa3a8', 'To set down'),
};
export function itemInfo(id) {
  if (ITEMS[id]) return ITEMS[id];
  if (id.startsWith('sample:')) return { ...ITEMS.sample, name: id.slice(7) };
  return F(id, 'leaf', '#ccc', 'Other');
}
