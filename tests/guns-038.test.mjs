// 0.2.38: guns are rolled from parts, a maker, a rarity and sometimes a perk.
import { rollGun, starterPistol, gunStats, gunName, validateGun, RARITIES, PERKS, MAKER_NAMES, TYPE_NAMES, rng, hash } from '../js/game/guns.js';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const starter = starterPistol('st-test');
ok(starter.type === 'pistol' && starter.maker === 'Scrapwright' && starter.rarity === 'common', 'the starter is a common Scrapwright pistol');
ok(!starter.perk, 'a common starter pistol has no perk');
ok(starter.stats.mag >= 8 && starter.stats.dmg > 8, 'the starter pistol has modest stats from its parts');
ok(validateGun(starter) == null, 'the starter pistol passes the shape check');

const a = rollGun(hash('camp', 3, 4), { id: 'g1' });
const b = rollGun(hash('camp', 3, 4), { id: 'g1' });
ok(a.type === b.type && a.maker === b.maker && a.rarity === b.rarity && a.perk === b.perk, 'the same seed rolls the same gun');
ok(TYPE_NAMES.includes(a.type) && MAKER_NAMES.includes(a.maker), 'a rolled gun has a known type and maker');
ok(RARITIES.some((r) => r.id === a.rarity), 'a rolled gun has a known rarity');
ok(a.parts.body && a.parts.barrel && a.parts.mag && a.parts.sight, 'a rolled gun has body, barrel, mag and sight');
ok(gunName(a).includes(a.maker) && gunName(a).includes(a.parts.barrel.id), 'the name comes from the maker and the barrel');
ok(JSON.stringify(gunStats(a)) === JSON.stringify(a.stats), 'published stats match a fresh compute from the parts');

const rare = rollGun(1, { rarity: 'rare', type: 'rifle', maker: 'Halvorsen', id: 'r1' });
ok(rare.perk && PERKS.includes(rare.perk), 'Rare and up roll one perk');
ok(rare.stats.dmg > starter.stats.dmg, 'a rare Halvorsen rifle hits harder than the starter pistol');

const common = rollGun(2, { rarity: 'common', type: 'shotgun', id: 'c1' });
ok(!common.perk, 'Common guns have no perk');

ok(validateGun({ ...rare, type: 'laser' }) === 'type', 'an unknown type is rejected');
ok(validateGun({ ...rare, perk: 'Explode' }) === 'perk', 'an unknown perk is rejected');
ok(validateGun({ ...common, perk: 'Quiet' }) === 'perk-on-common', 'a perk on a Common gun is rejected');

// rarity colours are the usual ladder
ok(RARITIES.find((r) => r.id === 'common').color === '#9a9a9a', 'Common is grey');
ok(RARITIES.find((r) => r.id === 'uncommon').color === '#3d9e4a', 'Uncommon is green');
ok(RARITIES.find((r) => r.id === 'rare').color === '#3b7ddd', 'Rare is blue');
ok(RARITIES.find((r) => r.id === 'epic').color === '#9b4de0', 'Epic is purple');
ok(RARITIES.find((r) => r.id === 'relic').color === '#d4a017', 'Relic is gold');

const r = rng(9);
const types = new Set();
for (let i = 0; i < 40; i++) types.add(rollGun(r, { id: 'x' + i }).type);
ok(types.has('rifle') && types.has('pistol') && types.has('shotgun'), 'a mix of rifles, pistols and shotguns can drop');

console.log(`ok ${passed} guns-038`);
