import { shouldOpenFirstRunStudio, lookIsCustomized, hasPlayProgress } from '../js/game/avatar/first-run.js';
import { DEFAULT } from '../js/game/avatar/appearance.js';
import { peekRelaunch, takeRelaunch, persistRelaunch, RELAUNCH_KEY } from '../js/safe-restart.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const def = DEFAULT();
ok(shouldOpenFirstRunStudio({ created: false, look: def, defaultLook: def, hasProgress: false, relaunch: false }), 'a brand-new player gets the character studio');
ok(!shouldOpenFirstRunStudio({ created: true, look: def, defaultLook: def, hasProgress: false, relaunch: false }), 'a player who already finished the studio does not see it again');
ok(!shouldOpenFirstRunStudio({ created: false, look: def, defaultLook: def, hasProgress: true, relaunch: false }), 'a returning save (play progress) goes straight into the world');
ok(!shouldOpenFirstRunStudio({ created: false, look: { ...def, body: 'm', beard: true }, defaultLook: def, hasProgress: false, relaunch: false }), 'an already-customized look is treated as a returning player');
ok(!shouldOpenFirstRunStudio({ created: false, look: def, defaultLook: def, hasProgress: false, relaunch: true }), 'an update relaunch skips the studio');
ok(lookIsCustomized({ ...def, outfit: 'expl' }, def), 'a different outfit counts as a customized look');
ok(!lookIsCustomized(def, def), 'the factory look is not customized');
ok(hasPlayProgress({ where: { world: 'planet' } }), 'a saved place counts as play progress');
ok(hasPlayProgress({ g7: { tools: { pick: 2, axe: 1 } } }), 'kept tools count as play progress');
ok(!hasPlayProgress({ g7: { tools: {} } }), 'an empty tools bag is not play progress');

// peek does not clear; take still does
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
persistRelaunch({ via: 'test' });
ok(!!peekRelaunch() && !!peekRelaunch(), 'peekRelaunch can be read more than once');
ok(!!takeRelaunch() && takeRelaunch() === null, 'takeRelaunch still clears the flag');
ok(!(RELAUNCH_KEY in Object.fromEntries(mem)), 'the relaunch key is gone after take');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
