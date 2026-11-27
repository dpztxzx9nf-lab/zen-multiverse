// 0.2.35: one sci-fi HUD, shared hotbar, one camera policy, no greybox city spawn.
import { readFileSync } from 'node:fs';
import { pickFrontierSpawn } from '../js/game/frontier-spawn.js';
import { setRifleOut, setRifleFirstPerson, setRifleAiming, rifleUseViewmodel, rifleAiming } from '../js/game/rifle-state.js';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;
const src = (p) => readFileSync(p, 'utf8');

const hot = src('js/game/g7/hotbar.js');
ok(!/Georgia/.test(hot), 'the hotbar is not the old serif garden bar');
ok(/setHotbarAmmo/.test(hot) && /--xen-hud-font/.test(hot), 'one sci-fi HUD module owns the bar and ammo');
ok(/#mp \.chip/.test(hot) && /#zen-mini/.test(hot), 'Online/Compete chips and the minimap share that style');
ok(/ammo/.test(hot) && /selected/.test(hot) || /\.ammo/.test(hot), 'ammo lives on a hotbar slot');

const m4 = src('js/game/m4.js');
const ui = src('js/game/gameui.js');
ok(!/zen-m4-hud/.test(m4) && !/zen-m4-hud/.test(ui), 'the separate 30/30 HUD is gone');
ok(/id:\s*'m4'/.test(m4) && /setHotbarAmmo/.test(m4), 'the M4 is a shared inventory slot');

const sb = src('js/game/g7/sandbox.js');
ok(/equip\.list\(\)/.test(sb), 'the bar lists every equipped item, including the M4');
ok(/Digit\(\[1-9\]\)/.test(sb), 'keys 1-9 pick any shared slot');
ok(!/hold to mine stone and ore/.test(sb), 'the old garden hint wording is gone');

const set = src('js/game/settings.js');
ok(/v:\s*4/.test(set) && /view:\s*'third'/.test(set), 'the default camera is third person');

const av = src('js/game/avatar/index.js');
ok(/rifleUseViewmodel\(\)/.test(av) && /lockedFP:\s*rifleAiming\(\)/.test(av), 'ADS and first person share one viewmodel policy');
ok(/gunOut && !vm/.test(av), 'the world-model gun is only bound when the viewmodel is down');

const pl = src('js/worlds/planet.js');
ok(!/installHubHeight/.test(pl), 'home Earth no longer flattens a city pad');
ok(!/buildHub/.test(pl), 'the greybox city is not drawn');
ok(/pickFrontierSpawn/.test(pl), 'landings use a frontier biome spawn');

function fakeW() {
  return {
    hasSea: true, sea: -3, tile: '1:1:1',
    height() { return 12; },
    biomesAt() { return { forest: 1, shore: 0, salt: 0, ice: 0, crystal: 0 }; },
    dominant() { return 'forest'; },
  };
}
const s = pickFrontierSpawn(fakeW(), { x: 294.21, z: 222.02 });
ok(s.biome === 'forest' && Math.hypot(s.x - 294.21, s.z - 222.02) >= 80, 'frontier spawn is away from the old plaza, in a forest biome');

setRifleOut(true); setRifleFirstPerson(false); setRifleAiming(false);
ok(!rifleUseViewmodel(), 'third person, un-aimed: no viewmodel');
setRifleAiming(true);
ok(rifleUseViewmodel() && rifleAiming(), 'aiming uses the viewmodel');
setRifleAiming(false); setRifleFirstPerson(true);
ok(rifleUseViewmodel(), 'toggled first person uses the viewmodel');
setRifleOut(false);
ok(!rifleUseViewmodel(), 'no viewmodel when the gun is holstered');

console.log(`ok ${passed}`);
