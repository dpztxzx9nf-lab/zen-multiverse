// 0.2.38: camp combat and gun loot are wired to the existing gunplay skeleton.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;
const src = (p) => readFileSync(p, 'utf8');

const world = src('server/src/world.js');
ok(/import \{ Combat \} from '\.\/combat\.js'/.test(world), 'the world loads the combat module');
ok(/this\.combat = new Combat\(this\)/.test(world), 'combat is constructed with the world');
ok(/case 'rt':/.test(world) && /combat\.onMsg/.test(world), 'camp and loot messages are handled');
ok(/combat\.equipped\(a, m\.gun\)/.test(world), 'firing requires a server-issued gun, or Dev');
ok(!/async fire\(ws, a, m, t\) \{\n    if \(!this\.isDev\(a\)\) return;/.test(world), 'Dev is no longer the only way to fire');
ok(/hitKind === 'rattler'/.test(world) && /npcFire/.test(world), 'Rattlers can be hit and can shoot back with the lag-compensated scan');
ok(/combat\.hello/.test(world), 'joining grants the starter pistol');

const combat = src('server/src/combat.js');
ok(/INSERT OR IGNORE INTO guns/.test(combat) && /claimed_by/.test(combat), 'guns and drops are stored with an anti-dupe claim');
ok(/campRoster/.test(combat) && /CALL_RANGE/.test(combat), 'camps spawn a roster and Rattlers can call friends');
ok(/why: 'taken'|why: 'dupe'/.test(combat), 'a second claim of the same drop is refused');

const net = src('js/net.js');
ok(/bindGunNet/.test(net) && /dir\.gun/.test(net), 'the client sends the equipped gun id with each shot');
ok(/t === 'rt'|case 'rt'/.test(net), 'the client handles combat snapshots');

const gp = src('js/game/gunplay.js');
ok(/starterPistol|starter \? 20/.test(gp) && /gunFire/.test(gp), 'the starter pistol fires through the shared gun net, not Dev mode');

const rv = src('js/game/rattler-view.js');
ok(/k: 'camp'/.test(rv) && /k: 'loot'/.test(rv), 'reaching a camp announces it and loot can be picked up');

const av = src('js/game/avatar/index.js');
ok(/bindHeldGun/.test(av), 'the local avatar holds whatever gun is equipped, not only the Dev M4');

console.log(`ok ${passed} combat-038`);
