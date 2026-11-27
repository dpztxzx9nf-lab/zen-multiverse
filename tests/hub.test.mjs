// node tests/hub.test.mjs: the Xenia city hub layout (pure data, no WebGL).
import { EARTH_SITE, HUB_SPAWN, GARDEN_ARRIVAL, GARDEN_ARRIVAL_PLANET, HUB_PAD_Y, SEA_Y, LANDMARKS, PLOTS, HUB_BOXES, hubForSolids, gardenToPlanet, planetToGarden, cityToPlanet, applyHubHeight, inHub, liftGardenPose, inGardenArea, gardenLocal } from '../js/hub.js';
import { WORLD_SPAWN } from '../js/spawn.js';
import { SOLIDS } from '../js/solids-data.js';
import { SOLIDS_V } from '../js/solids-v.js';
import { nearest } from '../js/solids.js';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

ok(EARTH_SITE.tile === '1:1:1' && EARTH_SITE.h === HUB_PAD_Y, 'Earth site tile and pad height are set');
ok(WORLD_SPAWN.x === HUB_SPAWN.x && WORLD_SPAWN.z === HUB_SPAWN.z && WORLD_SPAWN.tile === EARTH_SITE.tile, 'new players spawn at the city hub');
ok(GARDEN_ARRIVAL.x === 3.5 && GARDEN_ARRIVAL.z === 9.8, 'the garden arrival stone stayed put');
ok(HUB_SPAWN.y === HUB_PAD_Y && HUB_SPAWN.y > SEA_Y, 'spawn stands on the city pad, above the sea');

const names = LANDMARKS.map((L) => L.name);
ok(names.includes('Beach Bay') && names.includes('Bank Tower') && names.includes('The Docks') && names.includes('Night Market') && names.includes('Mansion Row'), 'every landmark is named: ' + names.join(', '));
ok(PLOTS.length >= 6 && PLOTS.length <= 10, `there are ${PLOTS.length} buyable plots`);
ok(PLOTS.every((p) => p.name && p.id.startsWith('hub-plot-')), 'each plot has a name and id');

const mid = { x: (GARDEN_ARRIVAL.x + 10), z: GARDEN_ARRIVAL.z };
const rt = planetToGarden(gardenToPlanet(mid.x, mid.z).x, gardenToPlanet(mid.x, mid.z).z);
ok(Math.abs(rt.x - mid.x) < 1e-9 && Math.abs(rt.z - mid.z) < 1e-9, 'garden <-> planet conversion rounds-trips');

ok(HUB_BOXES.length >= 20, `${HUB_BOXES.length} solid greybox shapes`);
ok(HUB_BOXES.every((b) => b.type === 'box' && b.top > b.bottom && b.hw > 0 && b.hd > 0 && b.tag === 'hub'), 'every hub box is a well-formed solid');

const spawnClear = nearest(HUB_BOXES, HUB_SPAWN.x, HUB_SPAWN.z);
ok(spawnClear > 2.5, `the plaza spawn is clear of buildings (nearest wall ${spawnClear.toFixed(2)} m)`);

const bank = HUB_BOXES.find((b) => b.name === 'bank-tower');
ok(bank && nearest([bank], bank.x, bank.z) < 0, 'the bank tower has a solid footprint');

ok(inHub(HUB_SPAWN.x, HUB_SPAWN.z), 'the plaza counts as inside the hub');
ok(!inHub(gardenToPlanet(3.5, 9.8).x, gardenToPlanet(3.5, 9.8).z), 'the garden arrival stone is not inside the hub');

const pad = applyHubHeight(20, HUB_SPAWN.x, HUB_SPAWN.z);
ok(Math.abs(pad - HUB_PAD_Y) < 0.05, `the plaza flattens to the pad (got ${pad.toFixed(2)})`);

const solidsHub = SOLIDS.hub || [];
const mine = hubForSolids();
const same = (a, b) => a.length === b.length && a.every((box, i) => Object.keys(box).sort().join() === Object.keys(b[i]).sort().join() && Object.keys(box).every((k) => box[k] === b[i][k]));
ok(same(solidsHub, mine), 'js/solids-data.js hub boxes match js/hub.js');
ok(SOLIDS_V === SOLIDS.v && /^[0-9a-f]{12}$/.test(SOLIDS_V), 'solids version is the 12-char hash');

ok(GARDEN_ARRIVAL_PLANET.tile === EARTH_SITE.tile, 'the arrival stone has a globe tile');
ok(inGardenArea(GARDEN_ARRIVAL_PLANET), 'the arrival stone is inside the garden on the globe');
ok(!inHub(GARDEN_ARRIVAL_PLANET.x, GARDEN_ARRIVAL_PLANET.z), 'the arrival stone is not inside the city grid');
const lifted = liftGardenPose({ x: GARDEN_ARRIVAL.x, y: 0, z: GARDEN_ARRIVAL.z, tile: null });
ok(Math.abs(lifted.x - GARDEN_ARRIVAL_PLANET.x) < 1e-9 && lifted.tile === EARTH_SITE.tile, 'a leftover garden pose lifts onto the globe');
ok(Math.abs(lifted.y - HUB_PAD_Y) < 1e-9, 'lifted height sits on the lawn pad');
const back = gardenLocal(lifted);
ok(Math.abs(back.x - GARDEN_ARRIVAL.x) < 1e-6 && Math.abs(back.z - GARDEN_ARRIVAL.z) < 1e-6, 'gardenLocal undoes the lift');
ok(liftGardenPose({ ...HUB_SPAWN }).tile === HUB_SPAWN.tile && liftGardenPose({ ...HUB_SPAWN }).x === HUB_SPAWN.x, 'a city pose is left alone');


console.log(bad ? `${bad} FAILED` : 'ALL PASSED');
process.exit(bad ? 1 : 0);
