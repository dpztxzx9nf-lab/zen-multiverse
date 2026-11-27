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


const games = readFileSync(new URL('../server/src/games.js', import.meta.url), 'utf8');
ok(!/Things to do right now/.test(games) && !/Ula the stone-keeper/.test(games) && !/go find Ula together/.test(games), 'the server no longer greets people with the Ula opening tip');

const net = readFileSync(new URL('../js/net.js', import.meta.url), 'utf8');
ok(!/only on your screen for now/.test(net), 'the leftover "only on your screen" build toast is gone');

const store = readFileSync(new URL('../js/game/store.js', import.meta.url), 'utf8');
ok(!/shaper: 1, build: 1, drill: 1, skin: 1/.test(store), 'Dev unlock does not hand back the purged build tools');

const settings = readFileSync(new URL('../js/game/settings-items.js', import.meta.url), 'utf8');
ok(!/First-walk tips/.test(settings) && !/gameplay\.tutorial/.test(settings), 'Settings no longer offers first-walk tips');

const hooks = readFileSync(new URL('../src-tauri/windows/hooks.nsh', import.meta.url), 'utf8');
ok(/Zen Multiverse/.test(hooks) && /io.thinkcore.zenmultiverse/.test(hooks), 'the NSIS hook cleans the old folder and leaves saves alone');
const tauri = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');
ok(/installerHooks/.test(tauri) && /windows\/hooks\.nsh/.test(tauri), 'the NSIS hook is wired into the installer');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
