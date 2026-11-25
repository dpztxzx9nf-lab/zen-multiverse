// In-game map of the world she is on: an ink-wash of the ground, the trail of places she has
// walked (saved per world in garden-save: game.trails), and quiet seals for the rocket, the base,
// the ship, beds and samples. Rendered into the pause menu's Map page (N opens it).
import { game } from './store.js';

const KIND = [
  [/^pad$|^rocket$/, 'rocket', 'Rocket', '#e8b27a'], [/^bench$/, 'work', 'Workshop', '#d9c7a4'], [/^shelf$/, 'home', 'Home', '#efe6d2'],
  [/^bonsai$|^moon-bonsai$/, 'tree', 'Bonsai', '#a9c49a'], [/^spot/, 'bed', 'Beds', '#b8d49a'],
  [/^mod-|^site-/, 'base', 'Base', '#9fd8ff'], [/^ship$/, 'ship', 'Ship', '#7fe0d0'], [/^s-/, 'sample', 'Samples', '#f2a7b8'],
  [/^guide$/, 'guide', 'Ilo', '#ffd38a'],
];
const kindOf = (id) => KIND.find(([re]) => re.test(id));
export function trailKey(w) { return w.world === 'planet' ? `planet:${w.seed}:${w.dim}` : w.world; }
// called every couple of seconds with world.where(): remembers places she has been
export function recordTrail(w) {
  if (!w) return;
  const G = game.data; G.trails = G.trails || {};
  const k = trailKey(w), t = (G.trails[k] = G.trails[k] || []);
  const last = t[t.length - 1];
  if (!last || Math.hypot(last[0] - w.x, last[1] - w.z) > 7) { t.push([Math.round(w.x * 10) / 10, Math.round(w.z * 10) / 10]); if (t.length > 400) t.splice(0, t.length - 400); game.save(); }
}

export function renderMap(body, world, whereNow) {
  const md = world && world.mapData ? world.mapData() : null;
  if (!md) { body.innerHTML = '<div class="rest"><div class="big">No map here.</div><div class="muted">Between worlds there is only the ship and the stars.</div></div>'; return; }
  const G = game.data, w = whereNow || {};
  const trail = ((G.trails || {})[w.world ? trailKey(w) : ''] || []);
  body.innerHTML = `<h3>${md.name}</h3><div class="zmap"><canvas width="1120" height="760"></canvas></div><div class="zleg"></div>
    <p class="muted" style="font-size:13px;margin-top:8px">${trail.length ? `${trail.length} places you have walked are inked in.` : 'Walk a little and your path will ink itself in.'} North is up.</p>`;
  const cv = body.querySelector('canvas'), c = cv.getContext('2d');
  const Wd = cv.width, Ht = cv.height; let E = md.extent;
  if (md.fit) {
    // frame what matters: the places, her, and her path (never tighter than 18 m)
    const pts = [...(md.items || []).filter((it) => kindOf(it.id)).map((it) => [it.x, it.z]), [md.player.x, md.player.z], ...trail.slice(-120)];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    E = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.min(md.extent.r, Math.max(18, (x1 - x0) / 2 * (Ht / Wd) + 6, (z1 - z0) / 2 + 6)) };
  }
  const sc = Math.min(Wd, Ht) / (E.r * 2.1);
  const X = (x) => Wd / 2 + (x - E.cx) * sc, Y = (z) => Ht / 2 + (z - E.cz) * sc;
  // ground: paper, washed by height (and water where there is sea)
  c.fillStyle = '#d8ceb6'; c.fillRect(0, 0, Wd, Ht);
  if (md.height) {
    const step = 8, img = c.createImageData(Wd, Ht); let lo = Infinity, hi = -Infinity; const hs = [];
    for (let py = 0; py < Ht; py += step) for (let px = 0; px < Wd; px += step) { const x = E.cx + (px - Wd / 2) / sc, z = E.cz + (py - Ht / 2) / sc; const h = md.height(x, z); hs.push(h); if (h < lo) lo = h; if (h > hi) hi = h; }
    let i = 0;
    for (let py = 0; py < Ht; py += step) for (let px = 0; px < Wd; px += step) {
      const h = hs[i++], k = (h - lo) / (hi - lo + 1e-6), wet = md.sea != null && h < md.sea;
      const r = wet ? 120 : 236 - 120 * k, g = wet ? 150 : 228 - 112 * k, b = wet ? 160 : 210 - 100 * k;
      for (let yy = 0; yy < step && py + yy < Ht; yy++) for (let xx = 0; xx < step && px + xx < Wd; xx++) { const o = ((py + yy) * Wd + px + xx) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; }
    }
    c.putImageData(img, 0, 0);
  } else {
    // the garden: a soft round of ground inside its wall
    const R = md.extent; c.fillStyle = '#c9d0b0'; c.beginPath(); c.arc(X(R.cx), Y(R.cz), R.r * sc * 0.97, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(40,40,34,.5)'; c.lineWidth = 3; c.stroke();
  }
  if (md.pond) { c.fillStyle = '#8fa6a8'; c.beginPath(); md.pond.forEach(([x, z], i) => (i ? c.lineTo(X(x), Y(z)) : c.moveTo(X(x), Y(z)))); c.closePath(); c.fill(); c.strokeStyle = 'rgba(30,40,40,.45)'; c.lineWidth = 2; c.stroke(); }
  // trail: a dotted ink line
  if (trail.length) {
    c.strokeStyle = 'rgba(28,30,28,.6)'; c.lineWidth = 4; c.setLineDash([3, 10]); c.lineCap = 'round';
    c.beginPath(); trail.forEach(([x, z], i) => (i ? c.lineTo(X(x), Y(z)) : c.moveTo(X(x), Y(z)))); c.stroke(); c.setLineDash([]);
    for (const [x, z] of trail) { c.fillStyle = 'rgba(28,30,28,.35)'; c.beginPath(); c.arc(X(x), Y(z), 3, 0, Math.PI * 2); c.fill(); }
  }
  // markers: one seal per kind (beds and samples as small dots), labels in ink
  const seen = new Map(), labels = [];
  for (const it of md.items || []) {
    const k = kindOf(it.id); if (!k) continue;
    const [, kind, label, col] = k;
    const px = X(it.x), py = Y(it.z); if (px < -20 || py < -20 || px > Wd + 20 || py > Ht + 20) continue;
    const small = kind === 'bed' || kind === 'sample';
    c.fillStyle = col; c.strokeStyle = 'rgba(20,22,20,.75)'; c.lineWidth = 2.5;
    c.beginPath(); c.arc(px, py, small ? 6 : 12, 0, Math.PI * 2); c.fill(); c.stroke();
    const text = it.id.startsWith('mod-') || it.id.startsWith('site-') ? it.id.replace(/^(mod|site)-/, '') : label;
    if (!seen.has(kind)) seen.set(kind, [label, col]);
    if (!small && !labels.some(([lx, ly, lt]) => lt === text || Math.hypot(lx - px, ly - py) < 70)) {
      labels.push([px, py, text]);
      { c.font = '26px "Iowan Old Style",Palatino,Georgia,serif'; c.fillStyle = 'rgba(20,22,20,.85)'; c.fillText(text, px + 18, py + 8); }
    }
  }
  // her: a brush arrow
  const p = md.player, ax = X(p.x), ay = Y(p.z), dx = Math.sin(p.yaw), dy = Math.cos(p.yaw);
  c.fillStyle = '#c8553d'; c.strokeStyle = 'rgba(20,22,20,.8)'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(ax + dx * 22, ay + dy * 22); c.lineTo(ax - dy * 11 - dx * 9, ay + dx * 11 - dy * 9); c.lineTo(ax - dx * 3, ay - dy * 3); c.lineTo(ax + dy * 11 - dx * 9, ay - dx * 11 - dy * 9); c.closePath(); c.fill(); c.stroke();
  body.querySelector('.zleg').innerHTML = [['You', '#c8553d'], ...(trail.length ? [['Your path', '#3a3c38']] : []), ...seen.values()].map(([l, col]) => `<span class="sp"><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col}"></i>${l}</span>`).join('');
}
export const MAP_CSS = `
#zen-menu .zmap{border-radius:18px 14px 20px 15px / 15px 20px 14px 18px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(236,222,196,.2),0 8px 30px rgba(0,0,0,.3)}
#zen-menu .zmap canvas{display:block;width:100%;height:auto}
#zen-menu .zleg{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}
#zen-menu .zleg .sp{display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border-radius:12px;background:rgba(239,230,210,.06);font-size:13px}
`;
