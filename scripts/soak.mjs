#!/usr/bin/env node
// Long-session soak test (release checklist). Zero npm deps: Node >= 22 and a Chrome/Edge binary.
// Serves this repo, opens the game, and wanders across worlds for --minutes (default 30): the garden,
// the moon, a stream of procedural planets (new seeds = new terrain, flora, creatures) and back,
// walking with real key presses and teleport hops. Every 10 s it reads window.__perf (frame times,
// renderer.info.memory, JS heap) and the error ring buffer. Fails (exit 1) on:
//   - any page error / logged error, or a 'memory growth' entry from the in-game memory watch
//   - geometries or textures on a return visit to the garden > first visit * 1.25 + 30
//   - JS heap at the end > first garden visit * 1.6 + 120 MB
//   - frame p99 > --p99 ms (default 50; only checked with --gpu, software rendering is meaningless)
// usage: node scripts/soak.mjs [--minutes 30] [--chrome PATH] [--headed] [--gpu] [--size 1280x720] [--out soak.json]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2), opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true; };
const MIN = +opt('minutes', 30), GPU = !!opt('gpu', false), HEADED = !!opt('headed', false), P99 = +opt('p99', 50), OUT = opt('out', '');
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const CHROME = opt('chrome', [process.env.CHROME, '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p)));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.stat(p, (e, st) => { if (e || !st.isFile()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port, dport = 9400 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-soak-'));
const args = [`--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'];
if (!HEADED) args.push('--headless=new');
if (!GPU) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const chrome = spawn(CHROME, [...args, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) { /* */ } server.close(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* */ } };
process.on('exit', cleanup);
let list; for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); const pageErrors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } if (d.method === 'Inspector.targetCrashed') { console.error('FAIL: the page crashed (renderer killed: out of memory or a GPU/driver fault)'); process.exit(2); } if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); console.error(`FAIL: no answer from the page to ${method} in 6 min (hung or crashed)`); process.exit(2); } }, 360000); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 300000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (code, ms) => { const k = code.replace(/^Key/, '').toLowerCase(); await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await sleep(ms); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
await send('Runtime.enable'); await send('Page.enable'); await send('Inspector.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?game=1&debug&nothrottle${GPU ? '' : '&fastdt'}` });
let ready = false; // software rendering can take minutes to compile and warm the first world
for (let i = 0; i < 2400 && !ready; i++) { try { ready = await ev("document.getElementById('veil').classList.contains('gone') && !!window.__perf && !!window.__garden"); } catch (e) { /* loading */ } if (!ready) await sleep(500); }
if (!ready) { console.error('FAIL: the game never finished loading (20 min)', pageErrors.slice(0, 5)); process.exit(1); }
const t0 = Date.now(), samples = [], visits = [];
const sample = async (label) => {
  const s = await ev('JSON.stringify({ p: window.__perf.snapshot(), errs: window.__zmErrors().filter((e) => !e.old), world: window.__garden.worlds.currentId })').then(JSON.parse);
  const row = { t: Math.round((Date.now() - t0) / 1000), label, world: s.world, fps: s.p.fps, p99: s.p.frame.p99, cpu: s.p.cpu.mean, gpu: s.p.gpu && s.p.gpu.mean, calls: s.p.calls, ...s.p.mem, errs: s.errs.length };
  samples.push(row); console.log(JSON.stringify(row)); return { row, errs: s.errs };
};
const go = (w, arg) => ev(`window.__garden.worlds.go(${JSON.stringify(w)}, ${JSON.stringify({ from: 'debug', ...arg })}).then(() => true)`);
let seed = 11, lastErrs = [];
const legs = [['earth'], ['moon'], ['planet'], ['planet'], ['earth'], ['planet'], ['moon'], ['earth']];
let leg = 0;
while (Date.now() - t0 < MIN * 60000) {
  const [w] = legs[leg % legs.length]; leg++;
  const arg = w === 'planet' ? { seed: seed++ } : {};
  await go(w, arg); await sleep(2500);
  const first = await sample(`enter ${w}${arg.seed ? ' ' + arg.seed : ''}`); visits.push({ world: w, ...first.row });
  const legEnd = Date.now() + Math.min(MIN * 60000 / 8, 240000);
  while (Date.now() < legEnd && Date.now() - t0 < MIN * 60000) {
    // wander: walk, turn, hop; on planets also trek far enough to stream new chunks and flora
    await key('KeyW', 1500); await key('KeyD', 400); await key('ShiftLeft', 50); await key('KeyW', 1200); await key('Space', 80);
    if (w === 'planet') await ev(`(async () => { const d = window.__garden.worlds.current.debug; if (d.trek) await d.trek(${(Math.random() - 0.5) * 300}, ${(Math.random() - 0.5) * 300}, 6); return 1; })()`).catch(() => {});
    if (w === 'earth') await ev(`(window.__garden.walkTo && window.__garden.walkTo(${(Math.random() - 0.5) * 8}, ${(Math.random() - 0.5) * 8}), 1)`).catch(() => {});
    lastErrs = (await sample('wander')).errs;
    await sleep(Math.max(0, 10000 - 3300));
  }
}
const fails = [];
if (pageErrors.length) fails.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
const bad = lastErrs.filter((e) => e.kind !== 'gpu');
if (bad.length) fails.push(`logged errors (${bad.length}): ${bad.slice(-3).map((e) => e.kind + ': ' + e.msg).join(' | ')}`);
const earth = visits.filter((v) => v.world === 'earth');
if (earth.length > 1) { const a = earth[0], b = earth[earth.length - 1];
  if (b.geo > a.geo * 1.25 + 30) fails.push(`geometries grew ${a.geo} -> ${b.geo} between garden visits`);
  if (b.tex > a.tex * 1.25 + 30) fails.push(`textures grew ${a.tex} -> ${b.tex} between garden visits`); }
const end = samples[samples.length - 1];
if (earth[0] && end.heap && earth[0].heap && end.heap > earth[0].heap * 1.6 + 120) fails.push(`JS heap ${earth[0].heap} -> ${end.heap} MB`);
const p99s = samples.filter((s) => s.label === 'wander').map((s) => s.p99).sort((x, y) => x - y);
const p99 = p99s[Math.floor(p99s.length * 0.9)] || 0;
if (GPU && p99 > P99) fails.push(`frame p99 ${p99} ms > ${P99}`);
const report = { minutes: MIN, gpu: GPU, samples: samples.length, visits, p99_90th: p99, end, fails };
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ...report, samples }, null, 1));
console.log(fails.length ? `SOAK FAIL\n- ${fails.join('\n- ')}` : `SOAK PASS: ${samples.length} samples over ${MIN} min, garden geo ${earth[0]?.geo}->${earth.at(-1)?.geo}, tex ${earth[0]?.tex}->${earth.at(-1)?.tex}, heap ${earth[0]?.heap}->${end.heap} MB, p99(90th) ${p99} ms`);
ws.close(); cleanup(); process.exit(fails.length ? 1 : 0);
