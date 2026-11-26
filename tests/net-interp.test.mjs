// Remote-player smoothness: runs the REAL sample()/drawPeers() from js/net.js (extracted) against simulated networks.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/net.js', import.meta.url), 'utf8');
const grab = (name) => { const i = src.indexOf(`  function ${name}(`); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } };
const consts = src.match(/const SEND_HZ[^\n]*\n/)[0];
const lerpAng = src.match(/const lerpAng = [^\n]*\n/)[0];
const mk = new Function('clock', `${consts}${lerpAng}
  const performance = { now: () => clock.now };
  const peers = new Map(); const toLocal = (m) => m; const worlds = { current: { scene: null } };
  ${grab('sample')}
  ${grab('drawPeers')}
  const pos = { x: 0, z: 0, set(x, y, z) { this.x = x; this.z = z; } };
  peers.set('B', { id: 'B', samples: [], scene: null, group: { position: pos, rotation: {}, visible: false } });
  return { sample, drawPeers, pos };`);
const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const path = (t) => { const a = t * 0.25; return { x: Math.cos(a) * 16, z: Math.sin(a) * 16 }; };
function run(net, withCt) {
  const clock = { now: 0 }; const N = mk(clock); const FR = 1000 / 60, DUR = 60000;
  const pk = []; let acc = 0, lastArr = 0; const skew = 123456; // sender clock is unrelated to ours
  for (let t = 0; t < DUR; t += FR) { acc += FR; if (acc >= 100) { acc = 0; const p = path(t / 1000); let lat = net.base + Math.abs(gauss()) * net.jit; if (rnd() < net.stallP) lat += net.stallMs * (0.5 + rnd()); const arr = Math.max(t + lat, lastArr + 0.2); lastArr = arr; pk.push({ arr, m: { t: 'p', id: 'B', x: p.x, y: 0, z: p.z, yaw: 0, ...(withCt ? { ct: Math.round(t + skew) } : {}) } }); } }
  let i = 0; const shown = [];
  for (let now = 3.3; now < DUR; now += FR) { clock.now = now; while (i < pk.length && pk[i].arr <= now) N.sample(pk[i++].m); N.drawPeers(); shown.push({ x: N.pos.x, z: N.pos.z }); }
  let hitch = 0, n = 0, sq = 0;
  for (let k = 121; k < shown.length; k++) { const v = Math.hypot(shown[k].x - shown[k - 1].x, shown[k].z - shown[k - 1].z) / (FR / 1000); n++; if (v < 1 || v > 10) hitch++; sq += (v - 4) ** 2; }
  return { hitch: +(100 * hitch / n).toFixed(2), err: +Math.sqrt(sq / n).toFixed(2) };
}
const nets = { 'Wi-Fi 30±10 ms': { base: 30, jit: 10, stallP: 0, stallMs: 0 }, '4G 60±30, 1% 250 ms stalls': { base: 60, jit: 30, stallP: 0.01, stallMs: 250 }, '3G 150±60, 3% 400 ms stalls': { base: 150, jit: 60, stallP: 0.03, stallMs: 400 } };
let fails = 0;
for (const [k, n] of Object.entries(nets)) {
  const a = run(n, false), c = run(n, true);
  const ok = c.err < a.err * 0.6 && c.hitch <= a.hitch;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${k.padEnd(28)} speed wobble ${a.err} -> ${c.err} m/s, hitches ${a.hitch}% -> ${c.hitch}%`);
}
process.exit(fails ? 1 : 0);
