// The pre-Xenia opening, journal/milestones menu, and Resting copy are gone.
import { readFileSync } from 'node:fs';
import { OPEN_ENABLED, OPEN_STEPS } from '../js/opening.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

ok(OPEN_ENABLED === false, 'OPEN_ENABLED is off');
ok(Array.isArray(OPEN_STEPS) && OPEN_STEPS.length >= 1, 'wording is still in the file so old saves stay readable');

const menu = readFileSync(new URL('../js/game/menu.js', import.meta.url), 'utf8');
ok(!/['\"]journal['\"]/.test(menu) || !/['\"]Journal['\"]/.test(menu), 'the pause menu no longer lists Journal');
ok(!/Milestones/.test(menu), 'the pause menu no longer lists Milestones');
ok(!/Resting/.test(menu), 'the pause menu is not titled Resting');
ok(!/Breathe\./.test(menu), 'the pause menu does not say Breathe');
ok(!/Back to the garden/.test(menu), 'the pause menu does not say Back to the garden');
ok(/<span>Xenia<\/span>/.test(menu) && /Paused\./.test(menu), 'the pause menu is a plain Xenia / Paused');

const compete = readFileSync(new URL('../js/compete.js', import.meta.url), 'utf8');
ok(!/old stone chamber/.test(compete), 'the vault no longer narrates an old stone chamber');
ok(/openEl\.style\.display = 'none'/.test(compete), 'the Ula site HUD stays hidden');

const earth = readFileSync(new URL('../js/game/earth-game.js', import.meta.url), 'utf8');
ok(/coveBar\.show\(false\)/.test(earth) && !/coveBar\.show\(on\)/.test(earth), 'the garden cove tool bar stays hidden');

const sandbox = readFileSync(new URL('../js/game/g7/sandbox.js', import.meta.url), 'utf8');
ok(/const BAR = \['hands', 'pick', 'axe', 'shovel'\]/.test(sandbox), 'the tool bar keeps pickaxe, axe and shovel');
ok(/BAR\.includes\(id\)/.test(sandbox) && /id === 'build'/.test(sandbox) === false || /available: \(\) => isActive && BAR.includes\(id\)/.test(sandbox), 'build is not on the kept tool bar');
ok(/hot\.show\(!hud\.panelOpen/.test(sandbox), 'the kept tool bar is shown while walking');
ok(/function digSpec\(t\)[\s\S]*shovel/.test(sandbox), 'the shovel has its own dig spec for soil and sand');

const gardenBuild = readFileSync(new URL('../js/game/garden-build.js', import.meta.url), 'utf8');
ok(/available: \(\) => false/.test(gardenBuild), 'the garden hammer / build kit is not selectable');

const tut = readFileSync(new URL('../js/game/tutorial.js', import.meta.url), 'utf8');
ok(/done: true, quiet: true/.test(tut) && /restart\(\) \{\}/.test(tut), 'the old tutorial starts already done');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
