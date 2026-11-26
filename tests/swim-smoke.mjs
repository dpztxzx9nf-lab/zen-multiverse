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
const HOME = !!opt('home', false), LIFE = !!opt('life', false), COLD = !!opt('cold', false); // --cold: a cool sea (kelp grows below 22 C)
const findBeach = (s) => `(() => { const d = window.__garden.worlds.current.debug, W = d.W; if (!W.hasSea || !(W.rules && W.rules.water && W.rules.water.liquid)) return null; if (${LIFE} && !(W.rules.biology && W.rules.biology.animals)) return null; if (${COLD} && !(W.rules.temperature && W.rules.temperature.meanC < 19 && W.rules.biology && W.rules.biology.plants)) return null; const ox = d.player.position.x, oz = d.player.position.z;
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
if (opt('fish', false)) {
  // fishing and spearing: craft both from the shore, spear a fish underwater, cast from the beach, fight one in
  const D = 'window.__garden.worlds.current.debug';
  const view = (m) => ev(`(window.__avatar && window.__avatar.camera && window.__avatar.camera.setMode('${m}'), 1)`);
  const crafted = await ev(`(() => { const d = ${D}; const g = d.game; for (const [k, n] of Object.entries({ 'mat:wood': 6, 'mat:stone': 2, fibre: 8, 'mat:soil': 2, salt: 1 })) g.add(k, n);
    return ['spear', 'rod', 'bait'].map((id) => [id, d.sb.debug.craft(id)]); })()`);
  ok(crafted.every((c) => c[1]), 'crafted spear, rod and bait ' + JSON.stringify(crafted) + ' tools ' + JSON.stringify(await ev(`${D}.sb.T7.tools`)));
  // swim out over the sea point and dive next to a school
  await ev(`(async () => { const d = ${D}; d.player.teleport(${found.sea[0]}, ${found.sea[1]}, 0); await d.trek(0.01, 0.01, 2); return 1; })()`);
  for (let i = 0; i < 30; i++) { await sleep(1000); if (await ev(`${D}.sealife.schools.length`)) break; }
  await sleep(1500);
  const sch = await ev(`(() => { const L = ${D}.sealife; return L.schools.map((s) => ({ kind: s.sp.kind, n: s.members.filter((f) => f.alive).length, x: s.hx, z: s.hz })); })()`);
  console.log('schools', JSON.stringify(sch)); ok(sch.length > 0 && sch.some((s) => s.n > 0), 'fish schools are here');
  // put her 3 m from the nearest fish of a school (not a predator), looking at it, and hold still (fish keep swimming)
  const aimAt = (dist) => ev(`(() => { const d = ${D}, L = d.sealife, p = d.player; const f = L.fish.filter((f) => f.alive && f.s.kind !== 'predator' && !f.hooked).sort((a, b) => a.p.distanceTo(p.position) - b.p.distanceTo(p.position))[0]; if (!f) return null;
      const a = Math.random() * 6.28, x = f.p.x + Math.sin(a) * ${dist}, z = f.p.z + Math.cos(a) * ${dist}; p.teleport3 ? p.teleport3(x, f.p.y - 1.4, z) : p.teleport(x, z, 0);
      const e = p.eyePos(), dx = f.p.x - e.x, dy = f.p.y - e.y, dz = f.p.z - e.z; p.aim(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))); p.snapCamera && p.snapCamera(); return { fish: [f.p.x, f.p.y, f.p.z], len: f.len, me: [p.position.x, p.position.y, p.position.z], swimming: p.swimming }; })()`);
  const inv = () => ev(`(${D}.game.data.inv.fish || 0)`);
  let a = await aimAt(4); console.log('aim', JSON.stringify(a)); await sleep(2500); await view('first'); await shot('06-fish-school');
  await view('third'); await sleep(3500); await shot('06b-fish-school-third'); await view('first');
  // spear: thrust at point blank until one is taken (fish dodge), then throw
  let speared = 0, tries = 0; const f0 = await inv();
  for (; tries < 12 && !speared; tries++) { await aimAt(1.0); speared = (await ev(`(() => { const d = ${D}; d.sb.debug.select('spear'); const r = { origin: d.player.eyePos(), dir: d.player.aimDir(), start: 0 }; return d.fishing.debug.thrust(r) ? 1 : 0; })()`)); }
  ok(speared && (await inv()) > f0, `spear thrust takes a fish (${tries} tries, fish in bag ${await inv()})`);
  const flee = await ev(`(() => { const L = ${D}.sealife, p = ${D}.player.position; const near = L.fish.filter((f) => f.alive && f.p.distanceTo(p) < 6); return { near: near.length, panic: +(near.reduce((s, f) => s + f.panic, 0) / Math.max(1, near.length)).toFixed(2), fear: +L.fearAt(p.x, p.z).toFixed(2) }; })()`);
  ok(flee.fear > 0.5, 'the spot remembers it ' + JSON.stringify(flee));
  // throw: underwater it slows within a few metres
  await aimAt(3); const thr = await ev(`(async () => { const d = ${D}, F = d.fishing; const e = d.player.eyePos(), dir = d.player.aimDir(); F.debug.throwSpear({ origin: e, dir, start: 0 }, 1); const p0 = F.spear.p.clone(); const out = [];
      for (let i = 0; i < 120; i++) { F.update(1 / 60); if (i % 30 === 29) out.push(+F.spear.p.distanceTo(p0).toFixed(2)); } return { travel: out, state: F.spear.state, v: +F.spear.v.length().toFixed(2), fish: d.game.data.inv.fish || 0 }; })()`);
  ok(thr.travel[3] < 5 && thr.travel[0] > 0.5, 'underwater throw travels a few metres then the water stops it ' + JSON.stringify(thr));
  await shot('07-spear-thrown');
  // back to the beach: cast with bait, wait for a bite (or hook the nearest after a minute), fight it in
  await ev(`(async () => { const d = ${D}; d.player.teleport(${found.land[0]}, ${found.land[1]}, ${found.dir}); d.player.snapCamera(); await d.trek(0.01, 0.01, 2); d.player.aim(${found.dir}, 0.15); d.fishing.reset(); d.sb.debug.select('rod'); return 1; })()`);
  await sleep(1500);
  const cast = await ev(`(() => { const F = ${D}.fishing; F.debug.cast(1); for (let i = 0; i < 240 && F.rod.state === 'flying'; i++) F.update(1 / 60); return { state: F.rod.state, at: [+F.rod.p.x.toFixed(1), +F.rod.p.y.toFixed(2), +F.rod.p.z.toFixed(1)], baited: F.rod.baited }; })()`);
  ok(cast.state === 'float' && cast.baited, 'the cast lands in the water, baited ' + JSON.stringify(cast));
  await view('third'); await sleep(3500); await shot('08-cast');
  let bite = null; for (let i = 0; i < 40 && !bite; i++) { await sleep(1000); bite = await ev(`(${D}.fishing.rod.state === 'bite') ? 1 : 0`); }
  console.log(bite ? 'a natural bite' : 'no bite in 40 s: hooking the nearest fish');
  const hk = await ev(`(() => { const d = ${D}, F = d.fishing, L = d.sealife; let f = F.rod.state === 'bite' ? F.rod.fish : null;
      if (!f) { f = L.fish.filter((o) => o.alive && o.len < 0.45 && !o.hooked).sort((a, b) => a.p.distanceTo(F.rod.p) - b.p.distanceTo(F.rod.p))[0]; if (!f) return null; f.p.set(F.rod.p.x, F.rod.p.y - 1.2, F.rod.p.z); }
      F.debug.hookOn(f); return { len: f.len, state: F.rod.state }; })()`);
  await ev(`(${D}.fishing.on('end', (e) => (window.__fishEnds = window.__fishEnds || []).push(e)), 1)`);
  ok(hk && hk.state === 'fight', 'fish on the line ' + JSON.stringify(hk));
  await sleep(2500); await shot('09-fight');
  // fight it: haul while the line is below 70% of its strength, give line above
  const fightR = await ev(`(async () => { const d = ${D}, F = d.fishing; let maxT = 0, t = 0, f0 = d.game.data.inv.fish || 0;
      for (; t < 240 && F.rod.state === 'fight'; t += 1 / 30) { F.rod.down = F.rod.T < 22; F.update(1 / 30); maxT = Math.max(maxT, F.rod.T); if ((t * 30 | 0) % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
      const fp = F.rod.fish ? F.rod.fish.p.toArray().map((v) => +v.toFixed(2)) : null; return { log: F.rod.log, ends: window.__fishEnds || [], fp, tip: F.rod.tip.toArray().map((v) => +v.toFixed(2)), line: F.rod.line.len, secs: +t.toFixed(1), maxT: +maxT.toFixed(1), state: F.rod.state, got: (d.game.data.inv.fish || 0) - f0, last: (d.game.data.sea.catches || []).slice(-1)[0] }; })()`);
  ok(fightR.got === 1 && fightR.maxT > 2, 'played and landed it ' + JSON.stringify(fightR));
  const cook = await ev(`(() => { const d = ${D}; const r = ['cookfish', 'cutbait'].map((id) => [id, d.sb.debug.craft(id)]); return { r, inv: { fish: d.game.data.inv.fish || 0, cooked: d.game.data.inv.cooked_fish || 0, bait: d.game.data.inv.bait || 0 } }; })()`);
  ok(cook.r.every((c) => c[1]) && cook.inv.cooked >= 1, 'fish cook and cut into bait ' + JSON.stringify(cook));
  await shot('10-landed');
  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  console.log(fails ? `FISH SMOKE FAIL (${fails})` : 'FISH SMOKE PASS'); process.exit(fails ? 1 : 0);
}
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
// (a deep dive in fresh water on a light world rises slowly: allow up to 30 s, kicking up for the first 8)
const y0 = (await st()).y; for (let i = 0; i < 900; i++) { await ev(`(${P}.step(1/30, 0, 0, 0, { jump: ${i < 240} }), 1)`); if (i % 30 === 29 && !(await st()).under) break; }
s = await st(); console.log('rose from', y0, 'to', s.y); ok(s.swimming && !s.under, 'she floats back up ' + JSON.stringify(s));
// swim back to the beach and walk out
await ev(`(${P}.aim(${found.dir} + Math.PI, 0), 1)`);
let out = null; for (let i = 0; i < 400 && !out; i++) { await ev(`(${P}.step(1/30, 0, 1), ${P}.step(1/30, 0, 1), 1)`); const q = await st(); if (!q.swimming && q.depth < 0.4) out = q; }
ok(!!out, 'back on her feet on the beach ' + JSON.stringify(out));
await shot('05-ashore');
ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
console.log(fails ? `SWIM SMOKE: ${fails} FAILED` : 'SWIM SMOKE PASS');
ws.close(); cleanup(); process.exit(fails ? 1 : 0);
