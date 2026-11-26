// Crafting: what you can make from what the world gives you. A few things are made in your hands anywhere
// (station absent): a fire drill, worms, cut bait, cloth, a workbench and a campfire. Everything else is made
// at a real thing standing in the world (station: 'bench' | 'forge' | 'fire', see js/game/fixtures.js), within
// arm's reach of it; online the server checks that you are (server/src/storage.js). Tools change what you can dig
// and cut; the kit abilities (grappling hook, lifting straps) open up with how far you have come. Grounded
// modern-day kit only, melee first (js/game/g7/melee.js): see mom-garden-notes/xenia-progress.md.
export const RECIPES = [
  // things you set down in the world (js/game/fixtures.js): where the rest is made, and where things are kept
  { id: 'fx_bench', name: 'Workbench', desc: 'A heavy plank top on four legs. Tools, spears, rods, crates and clothes are made at one', cost: { 'mat:wood': 4, fibre: 2 }, give: { item: ['fx:bench', 1] } },
  { id: 'fx_fire', name: 'Campfire', desc: 'A ring of stones and a stack of wood: cook fish and meat, smoke food, render oil', cost: { 'mat:stone': 3, 'mat:wood': 2 }, give: { item: ['fx:fire', 1] } },
  { id: 'fx_chest', name: 'Wooden crate', desc: '20 slots for what will not fit in your hands or bag. Anyone can open a crate: lock up what matters', cost: { 'mat:wood': 6, fibre: 2 }, give: { item: ['fx:chest', 1] }, station: 'bench' },
  { id: 'fx_forge', name: 'Metal smelter', desc: 'A steel drum furnace with a chimney pipe, hot enough to melt scrap and ore, with an anvil beside it. Metal, glass, lockers and safes are made here', cost: { 'mat:stone': 8, 'mat:wood': 3 }, give: { item: ['fx:forge', 1] }, station: 'bench' },
  { id: 'fx_locker', name: 'Metal locker', desc: '16 slots behind a steel door with a padlock. Opens for you and friends you add; someone with a crowbar-grade tool can pry it open', cost: { 'mat:metal': 3, 'mat:wood': 2 }, give: { item: ['fx:locker', 1] }, station: 'forge' },
  { id: 'fx_safe', name: 'Metal safe', desc: '12 slots behind a riveted door. Only you, and friends you add, can open it; it cannot be broken or carried off', cost: { 'mat:metal': 4, 'mat:stone': 4 }, give: { item: ['fx:safe', 1] }, station: 'forge' },
  { id: 'satchel', name: 'Shoulder bag', desc: 'A strap and a pouch of hide over the shoulder: carry 6 things in your hands instead of 3', cost: { hide: 2, fibre: 3 }, give: { gear: 'satchel' }, station: 'bench' },
  { id: 'pick1', name: 'Scrap pickaxe', desc: 'A sharpened rock head bolted to a handle: dig stone and crystal, faster and deeper', cost: { 'mat:stone': 3, 'mat:wood': 1, fibre: 1 }, give: { tool: ['pick', 1] }, station: 'bench' },
  { id: 'axe1', name: 'Hatchet', desc: 'Fell trees into logs; split logs into planks', cost: { 'mat:stone': 2, 'mat:wood': 2 }, give: { tool: ['axe', 1] }, station: 'bench' },
  { id: 'drill', name: 'Bow-drill fire kit', desc: 'Hold on dry grass, litter or wood to start a fire (not on wet ground)', cost: { 'mat:wood': 1, fibre: 1 }, give: { tool: ['drill', 1] } },
  { id: 'skin', name: 'Water bottle', desc: 'Fill it at water, pour it where you want: puddles, mud, put out a fire', cost: { fibre: 3 }, give: { tool: ['skin', 1] }, station: 'bench' },
  { id: 'build', name: 'Building kit', desc: 'Walls, floors, beams, posts, ramps and blocks that snap together', cost: { 'mat:wood': 2, fibre: 1 }, give: { tool: ['build', 1] }, station: 'bench' },
  { id: 'shaper', name: 'Shovel', desc: 'Raise ground from your bag, flatten a floor', cost: { 'mat:stone': 4, 'mat:crystal': 1 }, give: { tool: ['shaper', 1] }, station: 'bench' },
  { id: 'ingot', name: 'Metal (smelt)', desc: 'Two ore and a little wood make one bar', cost: { 'mat:ore': 2, 'mat:wood': 1 }, give: { item: ['mat:metal', 1] }, station: 'forge' },
  { id: 'pick2', name: 'Steel pickaxe', desc: 'Digs ore, wider and quicker', cost: { 'mat:metal': 3, 'mat:wood': 1 }, give: { tool: ['pick', 2] }, station: 'forge', needs: { tool: ['pick', 1] } },
  { id: 'crate', name: 'Crate', desc: 'A wooden crate to stack, carry or knock over', cost: { 'mat:wood': 3 }, give: { prop: 'crate' }, station: 'bench' },
  // retired: no physical basis (kept out of the bench list)
  // { id: 'dash', name: 'Wind charm', desc: 'Q: a quick gust carries you a few metres (two charges)', cost: { 'mat:crystal': 2, fibre: 2 }, give: { ability: 'dash' }, needs: { worlds: 1 } },
  // { id: 'glide', name: 'Glide cloak', desc: 'Hold jump while falling to drift down slowly', cost: { fibre: 6, 'mat:wood': 2 }, give: { ability: 'glide' }, station: true },
  { id: 'vine', name: 'Grappling hook', desc: 'F: a hook on a rope to climb up to ledges, or pull things to you', cost: { fibre: 8, 'mat:metal': 1 }, give: { ability: 'vine' }, station: 'forge', needs: { worlds: 2 } },
  { id: 'lift', name: 'Lifting straps', desc: 'Webbing straps and a harness: lift and throw heavy things from further away', cost: { 'mat:stone': 4, 'mat:crystal': 2, 'mat:metal': 1 }, give: { ability: 'lift' }, station: 'forge', needs: { tool: ['pick', 2] } },
  // melee first (js/game/g7/melee.js): hand tools that double as weapons; a hit's energy against the target's material
  { id: 'bat', name: 'Baseball bat', desc: 'A turned hardwood bat: a heavy blunt swing that cracks glass, stone and crates', cost: { 'mat:wood': 3 }, give: { tool: ['bat', 1] }, station: 'bench' },
  { id: 'knife', name: 'Knife', desc: 'A steel blade in a wooden handle: quick cuts through rope, cloth, plants and hide', cost: { 'mat:metal': 1, 'mat:wood': 1 }, give: { tool: ['knife', 1] }, station: 'forge' },
  { id: 'machete', name: 'Machete', desc: 'A long steel blade: clears brush, bites wood, cuts deep', cost: { 'mat:metal': 2, 'mat:wood': 1 }, give: { tool: ['machete', 1] }, station: 'forge' },
  { id: 'crowbar', name: 'Crowbar', desc: 'A steel pry bar: splits planks and crates at the joints, pries lockers, and swings hard', cost: { 'mat:metal': 2 }, give: { tool: ['crowbar', 1] }, station: 'forge' },
  // the sea: spear and rod from what the shore gives; fish become food, bait, oil
  { id: 'spear', name: 'Pole spear', desc: 'A spearfishing pole with a sharpened point. Tap to jab, hold and let go to throw: water slows it fast, so get close and lead the fish', cost: { 'mat:wood': 2, 'mat:stone': 1, fibre: 1 }, give: { tool: ['spear', 1] }, station: 'bench' },
  { id: 'rod', name: 'Fishing rod', desc: 'A pole, a twisted fibre line and a bone-sharp hook. Hold and let go to cast; when it bites, press to set the hook, hold to haul, let go to give line', cost: { 'mat:wood': 2, fibre: 4 }, give: { tool: ['rod', 1] }, station: 'bench' },
  { id: 'bait', name: 'Worms (bait)', desc: 'Sift a handful of soil for worms', cost: { 'mat:soil': 1 }, give: { item: ['bait', 3] } },
  { id: 'cutbait', name: 'Cut bait', desc: 'Cut a fish into strips: fish come to it from further away', cost: { fish: 1 }, give: { item: ['bait', 5] } },
  { id: 'cookfish', name: 'Cooked fish', desc: 'Grilled over a small fire', cost: { fish: 1, fuel: 1 }, give: { item: ['cooked_fish', 1] }, station: 'fire' },
  { id: 'roast', name: 'Roast meat', desc: 'Meat on a stick over the coals: food that keeps a day or two, and trades', cost: { meat: 1, fuel: 1 }, give: { item: ['food', 2] }, station: 'fire' },
  { id: 'dryfish', name: 'Salted fish', desc: 'Salted and dried, it keeps: food to trade with the peoples of a world', cost: { fish: 2, salt: 1 }, give: { item: ['food', 2] }, station: 'fire' },
  { id: 'fishoil', name: 'Fish oil', desc: 'Render fish down over the fire: lamp oil that burns as fuel', cost: { fish: 3, fuel: 1 }, give: { item: ['fish_oil', 2] }, station: 'fire' },
  { id: 'tan', name: 'Tanned leather', desc: 'Scrape a hide, rub it with salt and let it dry: tough cloth for packs and straps', cost: { hide: 1, salt: 2 }, give: { item: ['cloth', 2] }, station: 'bench' },
  { id: 'cloth', name: 'Woven cloth', desc: 'Plant fibre, tight enough to hold a shape', cost: { fibre: 4 }, give: { item: ['cloth', 1] } },
  // clothes are sewn from cloth (Textiles) at the bench; everyone starts in the plain base layer
  { id: 'wear_robe', name: 'Work clothes', desc: 'Canvas trousers and a work shirt, sewn from cloth', cost: { cloth: 3, fibre: 2 }, give: { gear: 'wear_robe' }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'wear_expl', name: 'Field jacket', desc: 'A sturdy jacket and cargo trousers for rough country', cost: { cloth: 4, fibre: 3 }, give: { gear: 'wear_expl' }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'acc_kasa', name: 'Boonie hat', desc: 'A wide-brimmed hat for sun and rain', cost: { fibre: 5 }, give: { gear: 'acc_kasa' }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'acc_hood', name: 'Hood', desc: 'A cloth hood for the field jacket', cost: { cloth: 1 }, give: { gear: 'acc_hood' }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'acc_pauldron', name: 'Shoulder pad', desc: 'A hard pad on a webbing strap', cost: { cloth: 1, 'mat:metal': 1 }, give: { gear: 'acc_pauldron' }, station: 'forge', needs: { skills: ['textiles', 'metalwork'] } },
  { id: 'acc_pack', name: 'Backpack', desc: 'A canvas backpack and a bedroll: 3 more things carried (9 with the shoulder bag)', cost: { cloth: 2, fibre: 2 }, give: { gear: 'acc_pack' }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'glass', name: 'Visor glass', desc: 'Sand and crystal, melted clear at the bench', cost: { sand: 3, crystal: 1, fuel: 1 }, give: { item: ['glass', 1] }, station: 'forge', needs: { skills: ['metalwork'] } },
  { id: 'seal', name: 'Pitch seal', desc: 'Pine resin and fibre, for a stitch that holds air', cost: { pinecone: 2, fibre: 2 }, give: { item: ['seal', 1] }, station: 'bench', needs: { skills: ['textiles'] } },
  { id: 'tank', name: 'Oxygen tank', desc: 'A metal bottle, a glass gauge, a crystal regulator', cost: { 'mat:metal': 2, glass: 1, crystal: 1 }, give: { item: ['tank', 1] }, station: 'forge', needs: { skills: ['metalwork', 'sealing'] } },
  { id: 'suit', name: 'Space suit', desc: 'A sealed suit with a visor, a metal frame and a tank of air', cost: { glass: 1, cloth: 2, seal: 1, 'mat:metal': 3, tank: 1 }, give: { gear: 'suit' }, station: 'bench', needs: { skills: ['gathering', 'textiles', 'metalwork', 'sealing', 'life'] } },
  { id: 'prop', name: 'Rocket propellant', desc: 'One 7 t load: kerosene distilled from wood and pine pitch, liquid oxygen condensed on a crystal cold-plate', cost: { fuel: 3, crystal: 1 }, give: { item: ['prop', 1] }, station: 'bench', needs: { skills: ['metalwork'] } },
  { id: 'claws', name: 'Climbing spikes', desc: 'Steel spikes on padded gloves: hold jump into a wall and scramble up', cost: { 'mat:metal': 2, cloth: 1 }, give: { ability: 'climb' }, station: 'forge', needs: { skills: ['metalwork', 'textiles'] } },
  { id: 'jets', name: 'Jet boots', desc: 'Small fuel thrusters: press jump again in the air and hold to push upward while the fuel lasts', cost: { 'mat:metal': 3, cloth: 1, crystal: 1 }, give: { ability: 'doubleJump' }, station: 'forge', needs: { skills: ['metalwork'] } },
];
export const ABILITIES = { dash: 'Sprint burst', glide: 'Paraglider', vine: 'Grappling hook', lift: 'Lifting straps', climb: 'Climbing spikes', doubleJump: 'Jet boots' };
export const COST_ALIAS = {
  crystal: ['mat:crystal', 'find:crystal'],
  fuel: ['mat:wood', 'driftwood', 'pinecone', 'fish_oil'],
  sand: ['mat:sand'],
};
