#!/usr/bin/env node
// Headless swim smoke test: serves the repo, opens a sea planet, walks into the sea and swims, dives,
// surfaces and climbs out; checks the physics numbers and saves screenshots.
// usage: node tests/swim-smoke.mjs [--out DIR] [--seed N] [--headed]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2), opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true; };
const OUT = opt('out', path.join(os.tmpdir(), 'swim-shots')); fs.mkdirSync(OUT, { recursive: true });
const CHROME = ['/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.wasm': 'application/wasm', '.ktx2': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const server = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!p.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.stat(p, (e, st) => { if (e || !st.isFile()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }); }).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port, dport = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-swim-'));
const args = [`--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
if (!opt('headed', false)) args.push('--headless=new');
const chrome = spawn(CHROME, [...args, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* */ } server.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* */ } };
process.on('exit', cleanup); process.on('SIGINT', () => process.exit(130));
setTimeout(() => { console.error('FAIL: timeout'); process.exit(3); }, 15 * 60e3).unref();
let list; for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }
const page = list.find((t) => t.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 300000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await sleep(900); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('shot', path.join(OUT, name + '.png')); };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?game=1&debug&nothrottle&fastdt&creator=0` });
let ready = false; for (let i = 0; i < 1200 && !ready; i++) { try { ready = await ev("document.getElementById('veil').classList.contains('gone') && !!window.__garden"); } catch (e) { /* */ } if (!ready) await sleep(500); }
if (!ready) { console.error('FAIL: game did not load'); process.exit(2); }
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// a sea planet, and a shore: dry ground a few metres from water 3 m+ deep
let seed = +opt('seed', 0), found = null;
const HOME = !!opt('home', false), LIFE = !!opt('life', false);
const findBeach = (s) => `(() => { const d = window.__garden.worlds.current.debug, W = d.W; if (!W.hasSea || !(W.rules && W.rules.water && W.rules.water.liquid)) return null; if (${LIFE} && !(W.rules.biology && W.rules.biology.animals)) return null; const ox = d.player.position.x, oz = d.player.position.z;
    for (let r = 20; r < 1500; r += 15) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, x = ox + Math.sin(a) * r, z = oz + Math.cos(a) * r; const h = W.height(x, z); if (h > W.sea - 0.3) continue;
      for (let t = 0; t < 60; t += 1) { const xx = x - Math.sin(a) * t, zz = z - Math.cos(a) * t, hh = W.height(xx, zz); if (hh > W.sea + 0.6) { if (W.height(x + Math.sin(a) * 25, z + Math.cos(a) * 25) < W.sea - 6) return { seed: ${s}, land: [xx, zz], sea: [x + Math.sin(a) * 25, z + Math.cos(a) * 25], dir: a, seaY: W.sea, g: W.gravity, life: W.rules.biology }; break; } } }
    return null; })()`;
if (HOME) { await ev(`import('/js/universe/home.js').then((m) => { const h = m.homeBody('earth'); return window.__garden.worlds.go('planet', { from: 'walk', site: 'earth', seed: h.body.seed, star: 0, index: 2, addr: h.addr, dim: 'prime' }); }).then(() => true)`); await sleep(3000); found = await ev(findBeach(0)); }
for (let s = seed || 2; !HOME && s < (seed || 2) + 40 && !found; s++) {
  await ev(`window.__garden.worlds.go('planet', { from: 'warp', seed: ${s} }).then(() => true)`);
  found = await ev(findBeach(s)); if (0) await ev(`(() => { const d = window.__garden.worlds.current.debug, W = d.W; if (!W.hasSea || !(W.rules && W.rules.water && W.rules.water.liquid)) return null;
    for (let r = 20; r < 1500; r += 15) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, x = Math.sin(a) * r, z = Math.cos(a) * r; const h = W.height(x, z); if (h > W.sea - 0.3) continue;
      // walk from deep water toward land along the direction to find the beach
      for (let t = 0; t < 60; t += 1) { const xx = x - Math.sin(a) * t, zz = z - Math.cos(a) * t, hh = W.height(xx, zz); if (hh > W.sea + 0.6) { if (W.height(x + Math.sin(a) * 25, z + Math.cos(a) * 25) < W.sea - 6) return { seed: ${s}, land: [xx, zz], sea: [x + Math.sin(a) * 25, z + Math.cos(a) * 25], dir: a, seaY: W.sea, g: W.gravity }; break; } } }
    return null; })()`);
}
ok(!!found, 'found a sea planet with a beach ' + JSON.stringify(found));
if (!found) process.exit(1);
const P = 'window.__garden.worlds.current.debug.player';
if (opt('eval', false)) { await ev(`(async () => { const d = window.__garden.worlds.current.debug; d.player.teleport(${found.sea[0]}, ${found.sea[1]}, 0); await d.trek(0.01, 0.01, 2); return 1; })()`); await sleep(3000); console.log(JSON.stringify(await ev(fs.readFileSync(opt('eval'), 'utf8')))); process.exit(0); }
await ev(`(async () => { const d = window.__garden.worlds.current.debug; d.player.teleport(${found.land[0]}, ${found.land[1]}, ${found.dir}); d.player.snapCamera(); await d.trek(0.01, 0.01, 2); d.player.aim(${found.dir}, 0); return 1; })()`);
await sleep(1500);
// third person view for the shots
const view = (m) => ev(`(window.__avatar && window.__avatar.camera && window.__avatar.camera.setMode('${m}'), 1)`);
const st = () => ev(`(() => { const p = ${P}, s = p.swim; return { x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1), y: +p.position.y.toFixed(2), gnd: +window.__garden.worlds.current.debug.ground(p.position.x, p.position.z).toFixed(2), blocked: p.state.blocked, depth: +p.water.depth.toFixed(2), surf: p.water.surf, swimming: p.swimming, speed: +p.speed.toFixed(2), horiz: +s.horiz.toFixed(2), under: s.headUnder, breath: +s.breath.toFixed(2), stamina: +s.stamina.toFixed(2), health: +s.health.toFixed(2), strokes: s.strokes, grounded: !p.airborne, cam: +(window.__garden.worlds.current.debug.camera.position.y).toFixed(2), camUnder: +window.__garden.worlds.current.debug.ocean.cameraDepth().toFixed(2), eye: +p.eye.toFixed(2), view: window.__avatar && window.__avatar.camera ? window.__avatar.camera.mode + ':' + window.__avatar.camera.blend.toFixed(2) : 'none', fish: (window.__garden.worlds.current.debug.sealife.fish || []).filter((f) => f.alive).length, plants: window.__garden.worlds.current.debug.sealife.plants }; })()`);
// walk into the sea: record wading speed
let wadeSeen = null, swimAt = null; console.log('start', JSON.stringify(await st()), await ev(`window.__garden.worlds.current.debug.height(${found.sea[0]}, ${found.sea[1]})`), await ev(`window.__garden.worlds.current.debug.ground(${found.sea[0]}, ${found.sea[1]})`));
for (let i = 0; i < 90 && !swimAt; i++) { await ev(`(${P}.step(1/30, 0, 1), ${P}.step(1/30, 0, 1), ${P}.step(1/30, 0, 1), 1)`); const s = await st(); if (!s.swimming && s.depth > 0.5 && s.depth < 1.0 && !wadeSeen) wadeSeen = s; if (s.swimming) swimAt = s; }
ok(!!wadeSeen && wadeSeen.speed < 4.0, 'wading slows her ' + JSON.stringify(wadeSeen));
if (wadeSeen) await shot('01-wading');
ok(!!swimAt, 'she swims once the water is deep ' + JSON.stringify(swimAt));
// swim out on the surface
for (let i = 0; i < 60; i++) await ev(`(${P}.step(1/30, 0, 1), 1)`);
let s = await st(); ok(s.swimming && !s.under && s.speed > 1.0 && s.speed < 2.6 && s.strokes >= 1, 'surface crawl ' + JSON.stringify(s));
await view('third'); await sleep(4000); await shot('02-surface-swim'); console.log('sea life', JSON.stringify(await ev(`(() => { const L = window.__garden.worlds.current.debug.sealife; return { region: L.region, schools: L.schools.map((s) => [s.sp.kind, s.members.length, +s.hx.toFixed(0), +s.hz.toFixed(0)]), fish: L.fish.length }; })()`)));
for (let i = 0; i < 120; i++) await ev(`(${P}.step(1/30, 0, 1), 1)`);
// tread water: idle
for (let i = 0; i < 120; i++) await ev(`(${P}.step(1/30, 0, 0), 1)`);
s = await st(); ok(s.swimming && !s.under && s.horiz < 0.5, 'treading upright, head out ' + JSON.stringify(s));
await sleep(3000); await shot('03-treading'); await view('first'); await sleep(500); console.log('fp tread', JSON.stringify(await st())); await shot('03b-treading-fp');
// dive: hold crouch and swim forward looking down
await ev(`(${P}.aim(${P}.heading, -0.7), 1)`);
for (let i = 0; i < 150; i++) await ev(`(${P}.step(1/30, 0, 1, 0, { crouch: true }), 1)`);
s = await st(); ok(s.under && s.depth > 2.0 && s.breath < 1, 'diving: under, breath going ' + JSON.stringify(s));
await ev(`(${P}.aim(${P}.heading, 0.0), 1)`);
await shot('04-underwater'); await view('third'); await sleep(4000); await shot('04b-underwater-third'); await view('first');
const uw = await ev(`({ under: window.__garden.worlds.current.debug.underK, fog: window.__garden.worlds.current.debug.scene.fog.density })`);
ok(uw.under > 0 && uw.fog > 0.02, 'underwater light and fog ' + JSON.stringify(uw));
// let go: shallow under she drifts up and surfaces
for (let i = 0; i < 300; i++) await ev(`(${P}.step(1/30, 0, 0, 0, { jump: i < 120 }), 1)`.replace('i < 120', String(i < 120)));
s = await st(); ok(s.swimming && !s.under, 'she floats back up ' + JSON.stringify(s));
// swim back to the beach and walk out
await ev(`(${P}.aim(${found.dir} + Math.PI, 0), 1)`);
let out = null; for (let i = 0; i < 400 && !out; i++) { await ev(`(${P}.step(1/30, 0, 1), ${P}.step(1/30, 0, 1), 1)`); const q = await st(); if (!q.swimming && q.depth < 0.4) out = q; }
ok(!!out, 'back on her feet on the beach ' + JSON.stringify(out));
await shot('05-ashore');
ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
console.log(fails ? `SWIM SMOKE: ${fails} FAILED` : 'SWIM SMOKE PASS');
ws.close(); cleanup(); process.exit(fails ? 1 : 0);
