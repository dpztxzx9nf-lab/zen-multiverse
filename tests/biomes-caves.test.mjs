// 0.2.34 world: named Xenia biomes, the Hollow, ores with a purpose, city-only no-dig.
import { readFileSync } from 'node:fs';
import { caveOpen, inHollow, oreAt, ORE_TABLE } from '../js/game/g7/caves.js';
import { MAT, MATS } from '../js/game/g7/materials.js';
import { HUB_SPAWN, GARDEN_ARRIVAL_PLANET, isProtectedGround } from '../js/hub.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const pg = readFileSync(new URL('../js/game/planetgen.js', import.meta.url), 'utf8');
ok(/Bleachflats/.test(pg) && /Rustmesa/.test(pg) && /Glasswood/.test(pg) && /Snow Peaks/.test(pg) && /Shatter Coast/.test(pg),
  'surface biomes use the plan names (plus Snow Peaks for the mountain ice)');
ok(/hollow:/.test(pg) && /Hollow/.test(pg), 'the Hollow is named as the underground biome');
ok(/BIOME_PURPOSE/.test(pg), 'every biome states a purpose');

ok(ORE_TABLE.length === 5 && ORE_TABLE.every((o) => o.purpose && o.maxD > o.minD && o.rare < 1), 'every ore has a depth band, rarity and purpose');
ok(ORE_TABLE.some((o) => o.id === 'resonite') && ORE_TABLE.some((o) => o.id === 'deep-resonite'), 'Resonite and deep Resonite are in the table');
ok(MAT.SCRAP === 9 && MAT.RESONITE === 10 && MAT.DEEP_RESONITE === 11, 'new material ids are assigned');
ok(MATS[9].purpose && MATS[10].purpose && MATS[11].purpose && MATS[5].purpose, 'voxel materials carry a purpose');

const surface = 40, seed = 7;
let openHits = 0, hollowHits = 0;
for (let i = 0; i < 400; i++) {
  const x = (i % 20) * 7 + 3, z = Math.floor(i / 20) * 11 + 5;
  const y = surface - 8 - (i % 5) * 3;
  if (caveOpen(x, y, z, seed, surface) > 0.5) openHits++;
  if (inHollow(x, surface - 28, z, seed, surface)) hollowHits++;
}
ok(openHits > 8, `caves actually open somewhere (hits ${openHits})`);
ok(hollowHits > 0, `the Hollow appears in deeper caverns (hits ${hollowHits})`);

const blocked = () => true;
ok(caveOpen(10, surface - 4, 10, seed, surface, blocked) === 0, 'cave mouths stay closed under city / garden ground');

const mid = ORE_TABLE.find((o) => o.id === 'resonite');
let oreShallow = 0;
for (let i = 0; i < 80; i++) {
  const x = i * 13 + 1, z = i * 17 + 2;
  if (oreAt(x, surface - 4, z, seed, surface) === mid.mat) oreShallow++;
}
ok(oreShallow === 0, 'Resonite does not spawn in the shallow band');

ok(!!isProtectedGround(HUB_SPAWN.x, HUB_SPAWN.z), 'the city plaza is no-dig');
ok(!!isProtectedGround(GARDEN_ARRIVAL_PLANET.x, GARDEN_ARRIVAL_PLANET.z, HUB_SPAWN.tile), 'the garden is no-dig');
ok(!isProtectedGround(HUB_SPAWN.x + 2500, HUB_SPAWN.z + 2500), 'wilderness stays diggable and claimable (not no-dig)');

const vox = readFileSync(new URL('../js/game/g7/voxel.js', import.meta.url), 'utf8');
ok(/activateAround, setNoCave/.test(vox) && /caveOpen/.test(vox) && /1 - open/.test(vox), 'voxels export cave hooks and punch caves into sample/baseBlock');
const sb = readFileSync(new URL('../js/game/g7/sandbox.js', import.meta.url), 'utf8');
ok(/vox\.activateAround\(player\.position/.test(sb), 'the sandbox keeps cave columns live around the walker');
const pl = readFileSync(new URL('../js/worlds/planet.js', import.meta.url), 'utf8');
ok(/isProtectedGround/.test(pl) && /setNoCave/.test(pl) && /inCave/.test(pl), 'the planet uses city-only no-dig, no cave mouths under it, and a cave camera');

const fl = readFileSync(new URL('../js/game/flora.js', import.meta.url), 'utf8');
const fir = fl.match(/kind: 'fir'[^}]+density: (\d+)/);
const cry = fl.match(/kind: 'crystal'[^}]+density: (\d+)/);
ok(fir && +fir[1] <= 20, `Rustmesa is not an Earth forest (fir density ${fir && fir[1]})`);
ok(cry && +cry[1] >= 150, `Glasswood crystals are dense (density ${cry && cry[1]})`);

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
