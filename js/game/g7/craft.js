// Crafting: what you can make from what the world gives you. Hand recipes anywhere; the rest at a
// workbench you build yourself. Tools change what you can dig and cut; charms are the abilities
// (wind dash, glide cloak, grapple vine, stone lift), each opened up by how far you have come.
export const RECIPES = [
  { id: 'pick1', name: 'Stone pick', desc: 'Dig stone and crystal, faster and deeper', cost: { 'mat:stone': 3, 'mat:wood': 1, fibre: 1 }, give: { tool: ['pick', 1] } },
  { id: 'axe1', name: 'Stone axe', desc: 'Fell trees into logs; split logs into planks', cost: { 'mat:stone': 2, 'mat:wood': 2 }, give: { tool: ['axe', 1] } },
  { id: 'drill', name: 'Fire drill', desc: 'Hold on dry grass, litter or wood to start a fire (not on wet ground)', cost: { 'mat:wood': 1, fibre: 1 }, give: { tool: ['drill', 1] } },
  { id: 'skin', name: 'Water skin', desc: 'Fill it at water, pour it where you want: puddles, mud, put out a fire', cost: { fibre: 3 }, give: { tool: ['skin', 1] } },
  { id: 'build', name: 'Building kit', desc: 'Walls, floors, beams, posts, ramps and blocks that snap together', cost: { 'mat:wood': 2, fibre: 1 }, give: { tool: ['build', 1] } },
  { id: 'shaper', name: 'Earth shaper', desc: 'Raise ground from your bag, flatten a floor', cost: { 'mat:stone': 4, 'mat:crystal': 1 }, give: { tool: ['shaper', 1] } },
  { id: 'ingot', name: 'Metal (smelt)', desc: 'Two ore and a little wood make one bar', cost: { 'mat:ore': 2, 'mat:wood': 1 }, give: { item: ['mat:metal', 1] }, station: true },
  { id: 'pick2', name: 'Metal pick', desc: 'Digs ore, wider and quicker', cost: { 'mat:metal': 3, 'mat:wood': 1 }, give: { tool: ['pick', 2] }, station: true, needs: { tool: ['pick', 1] } },
  { id: 'crate', name: 'Crate', desc: 'A wooden crate to stack, carry or knock over', cost: { 'mat:wood': 3 }, give: { prop: 'crate' }, station: true },
  // retired: no physical basis (kept out of the bench list)
  // { id: 'dash', name: 'Wind charm', desc: 'Q: a quick gust carries you a few metres (two charges)', cost: { 'mat:crystal': 2, fibre: 2 }, give: { ability: 'dash' }, needs: { worlds: 1 } },
  // { id: 'glide', name: 'Glide cloak', desc: 'Hold jump while falling to drift down slowly', cost: { fibre: 6, 'mat:wood': 2 }, give: { ability: 'glide' }, station: true },
  { id: 'vine', name: 'Grapple vine', desc: 'F: a vine to swing up to ledges, or pull things to you', cost: { fibre: 8, 'mat:metal': 1 }, give: { ability: 'vine' }, station: true, needs: { worlds: 2 } },
  { id: 'lift', name: 'Stone lift', desc: 'Lift and throw heavy things from further away', cost: { 'mat:stone': 4, 'mat:crystal': 2, 'mat:metal': 1 }, give: { ability: 'lift' }, station: true, needs: { tool: ['pick', 2] } },
  // the sea: spear and rod from what the shore gives; fish become food, bait, oil
  { id: 'spear', name: 'Fishing spear', desc: 'A wooden shaft with a stone point. Tap to jab, hold and let go to throw: water slows it fast, so get close and lead the fish', cost: { 'mat:wood': 2, 'mat:stone': 1, fibre: 1 }, give: { tool: ['spear', 1] } },
  { id: 'rod', name: 'Fishing rod', desc: 'A pole, a twisted fibre line and a bone-sharp hook. Hold and let go to cast; when it bites, press to set the hook, hold to haul, let go to give line', cost: { 'mat:wood': 2, fibre: 4 }, give: { tool: ['rod', 1] } },
  { id: 'bait', name: 'Worms (bait)', desc: 'Sift a handful of soil for worms', cost: { 'mat:soil': 1 }, give: { item: ['bait', 3] } },
  { id: 'cutbait', name: 'Cut bait', desc: 'Cut a fish into strips: fish come to it from further away', cost: { fish: 1 }, give: { item: ['bait', 5] } },
  { id: 'cookfish', name: 'Cooked fish', desc: 'Grilled over a small fire', cost: { fish: 1, fuel: 1 }, give: { item: ['cooked_fish', 1] } },
  { id: 'dryfish', name: 'Salted fish', desc: 'Salted and dried, it keeps: food to trade with the peoples of a world', cost: { fish: 2, salt: 1 }, give: { item: ['food', 2] } },
  { id: 'fishoil', name: 'Fish oil', desc: 'Render fish down at the bench: lamp oil that burns as fuel', cost: { fish: 3, fuel: 1 }, give: { item: ['fish_oil', 2] }, station: true },
  { id: 'tan', name: 'Tanned leather', desc: 'Scrape a hide, rub it with salt and let it dry: tough cloth for packs and straps', cost: { hide: 1, salt: 2 }, give: { item: ['cloth', 2] } },
  { id: 'cloth', name: 'Woven cloth', desc: 'Plant fibre, tight enough to hold a shape', cost: { fibre: 4 }, give: { item: ['cloth', 1] } },
  // clothes are sewn from cloth (Textiles) at the bench; everyone starts in the plain base layer
  { id: 'wear_robe', name: 'Garden wear', desc: 'Wrap, trousers and a linen shirt, sewn from cloth', cost: { cloth: 3, fibre: 2 }, give: { gear: 'wear_robe' }, station: true, needs: { skills: ['textiles'] } },
  { id: 'wear_expl', name: 'Explorer clothes', desc: 'A sturdy jacket and trousers for rough country', cost: { cloth: 4, fibre: 3 }, give: { gear: 'wear_expl' }, station: true, needs: { skills: ['textiles'] } },
  { id: 'acc_kasa', name: 'Straw kasa', desc: 'A wide woven hat for sun and rain', cost: { fibre: 5 }, give: { gear: 'acc_kasa' }, station: true, needs: { skills: ['textiles'] } },
  { id: 'acc_hood', name: 'Hood', desc: 'A cloth hood for the explorer jacket', cost: { cloth: 1 }, give: { gear: 'acc_hood' }, station: true, needs: { skills: ['textiles'] } },
  { id: 'acc_pauldron', name: 'Shoulder guard', desc: 'A metal plate on a cloth strap', cost: { cloth: 1, 'mat:metal': 1 }, give: { gear: 'acc_pauldron' }, station: true, needs: { skills: ['textiles', 'metalwork'] } },
  { id: 'acc_pack', name: 'Travel pack', desc: 'A cloth pack and a bedroll', cost: { cloth: 2, fibre: 2 }, give: { gear: 'acc_pack' }, station: true, needs: { skills: ['textiles'] } },
  { id: 'glass', name: 'Visor glass', desc: 'Sand and crystal, melted clear at the bench', cost: { sand: 3, crystal: 1, fuel: 1 }, give: { item: ['glass', 1] }, station: true, needs: { skills: ['metalwork'] } },
  { id: 'seal', name: 'Pitch seal', desc: 'Pine resin and fibre, for a stitch that holds air', cost: { pinecone: 2, fibre: 2 }, give: { item: ['seal', 1] }, station: true, needs: { skills: ['textiles'] } },
  { id: 'tank', name: 'Oxygen tank', desc: 'A metal bottle, a glass gauge, a crystal regulator', cost: { 'mat:metal': 2, glass: 1, crystal: 1 }, give: { item: ['tank', 1] }, station: true, needs: { skills: ['metalwork', 'sealing'] } },
  { id: 'suit', name: 'Space suit', desc: 'A sealed suit with a visor, a metal frame and a tank of air', cost: { glass: 1, cloth: 2, seal: 1, 'mat:metal': 3, tank: 1 }, give: { gear: 'suit' }, station: true, needs: { skills: ['gathering', 'textiles', 'metalwork', 'sealing', 'life'] } },
  { id: 'prop', name: 'Rocket propellant', desc: 'One 7 t load: kerosene distilled from wood and pine pitch, liquid oxygen condensed on a crystal cold-plate', cost: { fuel: 3, crystal: 1 }, give: { item: ['prop', 1] }, station: true, needs: { skills: ['metalwork'] } },
  { id: 'claws', name: 'Climbing claws', desc: 'Metal fingers wrapped in cloth: hold jump into a wall and scramble up', cost: { 'mat:metal': 2, cloth: 1 }, give: { ability: 'climb' }, station: true, needs: { skills: ['metalwork', 'textiles'] } },
  { id: 'jets', name: 'Jet boots', desc: 'Small fuel thrusters: press jump again in the air and hold to push upward while the fuel lasts', cost: { 'mat:metal': 3, cloth: 1, crystal: 1 }, give: { ability: 'doubleJump' }, station: true, needs: { skills: ['metalwork'] } },
];
export const ABILITIES = { dash: 'Wind dash', glide: 'Glide cloak', vine: 'Grapple vine', lift: 'Stone lift', climb: 'Climbing claws', doubleJump: 'Jet boots' };
export const COST_ALIAS = {
  crystal: ['mat:crystal', 'find:crystal'],
  fuel: ['mat:wood', 'driftwood', 'pinecone', 'fish_oil'],
  sand: ['mat:sand'],
};
