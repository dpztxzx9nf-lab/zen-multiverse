// node tests/safe-restart.test.mjs: when an update may restart, and the relaunch flag
import { decideRestart, snapshot, persistRelaunch, takeRelaunch, RELAUNCH_KEY, IDLE_MS, COUNTDOWN_S, WATCHDOG_BACKGROUND_S, WATCHDOG_STUCK_S, watchdogShouldInstall } from '../js/safe-restart.js';
import { PROTOCOL as clientProto } from '../js/protocol.js';
import { PROTOCOL as serverProto } from '../server/src/protocol.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };

t(clientProto === serverProto && clientProto >= 1, `client and server protocol match (${clientProto})`);
t(COUNTDOWN_S === 10, 'countdown is 10 seconds');

t(decideRestart({ menu: true }).action === 'now' && decideRestart({ menu: true }).reason === 'menu', 'menu restarts now');
t(decideRestart({ loading: true }).action === 'now', 'loading screen restarts now');
t(decideRestart({ death: true }).action === 'now', 'death screen restarts now');
t(decideRestart({ idle: true }).action === 'now', 'idle restarts now');
t(decideRestart({ fight: true }).action === 'wait' && decideRestart({ fight: true }).reason === 'fight', 'mid-fight waits');
t(decideRestart({ build: true }).action === 'wait', 'mid-build waits');
t(decideRestart({ air: true }).action === 'wait', 'in the air waits');
t(decideRestart({ water: true }).action === 'wait', 'in the water waits');
t(decideRestart({ hidden: true, menu: true }).action === 'now' && decideRestart({ hidden: true, menu: true }).reason === 'hidden', 'a hidden or occluded window restarts now, even on a menu');
t(decideRestart({ menu: true, fight: true }).action === 'wait', 'a fight blocks a menu restart');
t(decideRestart({ idle: true, air: true }).action === 'wait', 'idle in the air still waits');
t(decideRestart({}).action === 'countdown' && decideRestart({}).reason === 'play', 'ordinary play gets a 10 s countdown');

// snapshot from a fake document
function fakeDoc(html, { hidden = false, lock = false } = {}) {
  const ids = {};
  const root = { classList: { contains: (c) => (html || '').includes(c) }, querySelector: (sel) => {
    if (sel === '#zen-menu:not(.hidden)' && /id="zen-menu"/.test(html) && !/id="zen-menu"[^>]*hidden/.test(html) && !/zen-menu hidden/.test(html)) return {};
    if (sel === '#gmenu.open' && /id="gmenu"[^>]*open/.test(html)) return {};
    if (sel === '.menu.open' && /class="[^"]*menu[^"]*open/.test(html)) return {};
    if (sel === '#zm-death' && /id="zm-death"/.test(html)) return {};
    if (sel === '.zm-dead' && /zm-dead/.test(html)) return {};
    if (sel === '#zm-creator:not(.hidden)' && /id="zm-creator"/.test(html) && !/creator hidden/.test(html)) return {};
    return null;
  } };
  // very small querySelector on the root used by snapshot
  return {
    visibilityState: hidden ? 'hidden' : 'visible',
    pointerLockElement: lock ? {} : null,
    getElementById: (id) => {
      if (id === 'veil') {
        const gone = /id="veil"[^>]*gone/.test(html) || /veil gone/.test(html);
        return { classList: { contains: (c) => c === 'gone' && gone } };
      }
      return ids[id] || null;
    },
    querySelector: (...a) => root.querySelector(...a),
  };
}

const loading = snapshot({ document: fakeDoc('<div id="veil"></div>'), lastInput: 0, now: 99999 });
t(loading.loading && decideRestart(loading).action === 'now', 'veil without gone is a loading restart');
const ready = snapshot({ document: fakeDoc('<div id="veil" class="veil gone"></div>'), lastInput: 0, now: 99999 });
t(!ready.loading && ready.idle && decideRestart(ready).action === 'now', 'gone veil + no input is idle');
const paused = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div><div id="zen-menu"></div>'), lastInput: 0, now: 50, window: {} });
t(paused.menu && decideRestart(paused).action === 'now', 'open pause menu restarts now');
const locked2 = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div>', { lock: true }), lastInput: 0, now: 99999 });
t(!locked2.idle && decideRestart(locked2).action === 'countdown', 'pointer lock is not idle: countdown');
const hid = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div><div id="zen-menu"></div>', { hidden: true }) });
t(hid.hidden && decideRestart(hid).action === 'now' && decideRestart(hid).reason === 'hidden', 'hidden or occluded window restarts now');
const winFight = { __zmMoment: { fightUntil: 5000 } };
const fighting = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div>'), window: winFight, wall: 1000, lastInput: 0, now: 99999 });
t(fighting.fight && decideRestart(fighting).action === 'wait', 'recent fight flag waits');
const cooled = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div>'), window: winFight, wall: 9000, lastInput: 0, now: 99999 });
t(!cooled.fight && cooled.idle, 'expired fight flag can be idle');
const air = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div>'), window: { __zmMoment: { air: true } }, lastInput: 0, now: 99999 });
t(air.air && decideRestart(air).action === 'wait', 'airborne flag waits');
const water = snapshot({ document: fakeDoc('<div id="veil" class="gone"></div>'), worlds: { current: { debug: { player: { airborne: false, swimming: true } } } }, lastInput: 0, now: 99999, window: {} });
t(water.water && decideRestart(water).action === 'wait', 'swimming player waits');
t(decideRestart({ hidden: true, fight: true, air: true, water: true, build: true }).action === 'now'
  && decideRestart({ hidden: true, fight: true }).reason === 'hidden', 'stale mid-action flags do not block a hidden window');
t(decideRestart({ fight: true }).action === 'wait', 'a visible fight still waits');

t(WATCHDOG_BACKGROUND_S === 30 && WATCHDOG_STUCK_S === 120, 'watchdog waits 30 s in the background and 120 s if stuck');
t(!watchdogShouldInstall({ pendingForS: 29, focused: false, minimized: false }).install, 'under 30 s, even unfocused, the JS path still has time');
t(watchdogShouldInstall({ pendingForS: 30, focused: false, minimized: false }).install
  && watchdogShouldInstall({ pendingForS: 30, focused: false, minimized: false }).reason === 'background', 'unfocused for 30 s: rust installs');
t(watchdogShouldInstall({ pendingForS: 30, focused: true, minimized: true }).install, 'minimized for 30 s: rust installs');
t(!watchdogShouldInstall({ pendingForS: 30, focused: true, minimized: false }).install, 'focused and visible at 30 s: rust leaves it to JS');
t(watchdogShouldInstall({ pendingForS: 120, focused: true, minimized: false }).install
  && watchdogShouldInstall({ pendingForS: 120, focused: true, minimized: false }).reason === 'stuck', 'after 120 s rust installs even if still focused');
t(IDLE_MS === 6000, 'idle is 6 seconds without input');

// relaunch flag
const store = { [RELAUNCH_KEY]: null };
const mem = {
  setItem: (k, v) => { store[k] = v; },
  getItem: (k) => store[k],
  removeItem: (k) => { delete store[k]; },
};
const real = globalThis.localStorage;
Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true });
const saved = persistRelaunch({ world: 'home:x', yaw: 1.2 });
t(saved && saved.world === 'home:x' && saved.t > 0, 'relaunch flag is written');
const got = takeRelaunch();
t(got && got.world === 'home:x' && got.yaw === 1.2, 'relaunch flag is read once');
t(takeRelaunch() === null, 'relaunch flag is cleared after read');
mem.setItem(RELAUNCH_KEY, JSON.stringify({ world: 'old', t: Date.now() - 2 * 60 * 60e3 }));
t(takeRelaunch() === null, 'a leftover flag older than an hour is ignored');
if (real) Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });

console.log(`safe-restart: ${ok} ok, ${bad} failed`);
process.exit(bad ? 1 : 0);
