// Hotfix: camp announces must queue while the socket is down, then flush
// when it opens, and live camps must be re-announced on reconnect.
// This is the CI smoke for "you load next to a camp before connecting."
import { readFileSync } from 'node:fs';
import {
  resetGunNet, bindGunNet, gunNetOpen, gunSend, flushGunNet, onGunNetOpen,
  gunNetIsOpen, queuedGunNet,
} from '../js/game/gun-net.js';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

resetGunNet();
const sent = [];
bindGunNet({ send: (m) => sent.push(m), open: false, rtt: () => 0, fire: () => {} });
ok(!gunNetIsOpen(), 'the net starts closed even after bind, until the socket is open');

const camp = { t: 'rt', k: 'camp', cx: 1, cz: 2, x: 10, y: 3, z: 20, starter: true, type: 'rattler' };
ok(gunSend(camp) === false, 'a camp announce while disconnected is queued, not dropped');
ok(sent.length === 0, 'nothing goes on the wire while the socket is closed');
ok(queuedGunNet().length === 1 && queuedGunNet()[0].k === 'camp', 'the queued payload is the camp announce');

// load-near-camp-before-connect: announce first, socket opens later
let hooks = 0;
onGunNetOpen(() => { hooks++; gunSend({ t: 'rt', k: 'camp', cx: 1, cz: 2, x: 10, y: 3, z: 20, starter: true, type: 'rattler' }); });
gunNetOpen(true);
ok(gunNetIsOpen(), 'the net is open after gunNetOpen(true)');
ok(sent.length >= 1 && sent[0].k === 'camp', 'the queued camp announce flushes when the socket opens');
ok(hooks === 1, 'open hooks run once so live camps can re-announce');
ok(sent.length === 2, 'the re-announce on open is also sent (load-near-camp-before-connect)');
ok(queuedGunNet().length === 0, 'the queue is empty after the flush');

sent.length = 0;
gunSend({ t: 'rt', k: 'loot', id: 'abc' });
ok(sent.length === 1 && sent[0].k === 'loot', 'once open, later sends go through immediately');

gunNetOpen(false);
sent.length = 0;
gunSend({ t: 'rt', k: 'camp', cx: 3, cz: 4, x: 1, y: 0, z: 1 });
ok(sent.length === 0 && queuedGunNet().length === 1, 'a drop during reconnect is queued again');
gunNetOpen(true);
ok(sent.length === 2 && hooks === 2, 'reconnect flushes the queue and runs open hooks again');

// wiring: the game actually uses this path
const net = readFileSync('js/net.js', 'utf8');
ok(net.includes('gunNetOpen(true)'), 'the socket-open path marks the gun net open');
ok(net.includes('gunNetOpen(false)'), 'the socket-close path marks the gun net closed');
const planet = readFileSync('js/worlds/planet.js', 'utf8');
ok(planet.includes('onGunNetOpen') && planet.includes('reannounce'), 'the planet re-announces live camps when the socket opens');
const jig = readFileSync('js/game/jigsaw-view.js', 'utf8');
ok(/function reannounce\(/.test(jig), 'jigsaw-view can re-announce every live Rattler camp');
const rat = readFileSync('js/game/rattler-view.js', 'utf8');
ok(/function reannounce\(/.test(rat) && rat.includes('onGunNetOpen'), 'rattler-view re-announces remembered camps on open');
const combat = readFileSync('server/src/combat.js', 'utf8');
ok(combat.includes('wakeNear') && combat.includes('rattler_camps'), 'the server wakes stored camps when a player is in range');
ok(combat.includes('restoreCamp'), 'a slept camp can be restored from storage');

resetGunNet();
console.log(`ok ${passed} gun-net-0381`);
