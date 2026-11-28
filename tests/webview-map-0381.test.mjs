// Hotfix: Resume from the map left a large canvas alive and once crashed the
// WebView with STATUS_BREAKPOINT. We still do not have a proven single cause,
// but close() must drop the canvas, and map sampling is capped.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const map = readFileSync('js/game/worldmap.js', 'utf8');
ok(/STATUS_BREAKPOINT/.test(map), 'the map module records the STATUS_BREAKPOINT finding');
ok(/8000/.test(map) && /Math\.sqrt\(\(Wd \* Ht\) \/ 8000\)/.test(map), 'height sampling is capped so the map cannot flood the WebView');
ok(/export function releaseMapCanvases\(/.test(map), 'canvases can be zeroed and removed');
ok(/cv\.width = 0/.test(map) && /removeChild/.test(map), 'the backing store is zeroed and the node is removed');

const menu = readFileSync('js/game/menu.js', 'utf8');
ok(/releaseMapCanvases\(el\)/.test(menu), 'closing the menu (Resume) releases every menu canvas');
ok(/releaseMapCanvases\(body\)/.test(menu), 'leaving the map page also drops the canvas, not only hiding it');
ok(/from '\.\/worldmap\.js'/.test(menu), 'the menu uses the shared release helper');

console.log(`ok ${passed} webview-map-0381`);
