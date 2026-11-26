// Xenia's map: the whole globe seen from above the hub (azimuthal: distance and bearing from the spawn are
// true, the far side is the outer ring), coloured by height and sea, the regions' borders and names, the places
// you have found and where you are. Opened from the map button on Xenia; "Star map" goes on to the nav map.
import { REGIONS, hubPolar, PEAK, FORT, LOOKOUT, XENIA, hubFrame } from './xenia.js';
import { PLACES } from '../places.js';
import { game } from '../game/store.js';

const RISK_COL = { safe: '#9fd39a', guarded: '#e3cf8a', contested: '#e7a172', wild: '#d77c7c' };
let el = null, cache = null;

function bake(W, S) {
  // the globe's colour on the map (cached: the planet never changes)
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), img = g.createImageData(S, S);
  const Rm = Math.PI * W.radius, f = hubFrame(W.radius), d = [0, 0, 0];
  const tmp = new (W.sky.zenith.constructor)();
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i / S * 2 - 1) * Rm, z = (j / S * 2 - 1) * Rm, r = Math.hypot(x, z), k = (j * S + i) * 4;
    if (r > Rm) { img.data[k + 3] = 0; continue; }
    f.toDir(x, z, d);
    const { h, c: cc } = W.colorDir(d, tmp);
    const shade = h > W.sea ? Math.min(1.25, 0.85 + h / 1400) : 1;
    img.data[k] = Math.min(255, cc.r * 255 * shade); img.data[k + 1] = Math.min(255, cc.g * 255 * shade); img.data[k + 2] = Math.min(255, cc.b * 255 * shade); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

export function openXeniaMap({ W, player, hud, onStars }) {
  if (el) { el.remove(); el = null; return null; }
  const S = 560, Rm = Math.PI * W.radius, k = S / 2 / Rm;
  el = document.createElement('div'); el.id = 'xenia-map';
  el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,14,18,.72);font:14px system-ui,sans-serif;color:#eef';
  el.innerHTML = `<div style="position:relative;background:rgba(18,24,32,.92);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><b style="font-size:17px">Xenia</b><span class="muted" style="opacity:.7">40 km around · the spawn in the middle, the far side at the edge</span>
    <span style="flex:1"></span><button data-stars style="background:#6f9a78;border:0;border-radius:9px;color:#fff;padding:6px 12px;cursor:pointer">Star map</button>
    <button data-close style="background:rgba(255,255,255,.12);border:0;border-radius:9px;color:#fff;padding:6px 12px;cursor:pointer">Close</button></div>
    <canvas width="${S}" height="${S}" style="width:min(${S}px,86vw);height:min(${S}px,86vw);display:block"></canvas></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  if (!cache || cache.W !== W) cache = { W, img: bake(W, 192) };
  g.imageSmoothingEnabled = true; g.drawImage(cache.img, 0, 0, S, S);
  const C = S / 2, at = (D, b) => [C + Math.sin(b * Math.PI / 180) * D * k, C - Math.cos(b * Math.PI / 180) * D * k];
  const hubPt = (x, z) => { const p = hubPolar(hubFrame(W.radius).toDir(x, z, [0, 0, 0]), W.radius); return at(p.D, p.b); };
  // distance rings every 5 km and the region borders
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  for (const r of [5000, 10000, 15000]) { g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 1.5;
  for (const r of REGIONS) {
    g.strokeStyle = RISK_COL[r.risk]; g.globalAlpha = 0.55;
    const r1 = Math.min(r.r1, Rm), full = r.b1 - r.b0 >= 360;
    g.beginPath();
    if (full) { g.arc(C, C, r1 * k, 0, Math.PI * 2); }
    else {
      const b1 = r.b1 < r.b0 ? r.b1 + 360 : r.b1;
      for (let b = r.b0; b <= b1; b += 2) { const [x, y] = at(r.r0, b); b === r.b0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      for (let b = b1; b >= r.b0; b -= 2) { const [x, y] = at(r1, b); g.lineTo(x, y); }
      g.closePath();
    }
    g.stroke(); g.globalAlpha = 1;
    const mid = full ? (r.id === 'home' ? [C, C + 18] : at((r.r0 + Rm) / 2, 180)) : at((r.r0 + r1) / 2, ((r.b0 + (r.b1 < r.b0 ? r.b1 + 360 : r.b1)) / 2) % 360);
    g.fillStyle = '#fff'; g.font = '600 13px system-ui'; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4;
    g.fillText(r.name, mid[0], mid[1]); g.font = '11px system-ui'; g.fillStyle = RISK_COL[r.risk]; g.fillText(r.risk, mid[0], mid[1] + 13); g.shadowBlur = 0;
  }
  // landmarks, and the places you have found
  const mark = (x, y, label, color = '#fff', rad = 3.5) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = '11px system-ui'; g.textAlign = 'left'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 3; g.fillText(label, x + 6, y + 4); g.shadowBlur = 0; };
  { const [x, y] = hubPt(PEAK.x, PEAK.z); mark(x, y, 'Grey Peak 900 m', '#ddd'); }
  { const [x, y] = hubPt(FORT.x, FORT.z); mark(x, y, 'Reaver fort', '#d77c7c'); }
  { const [x, y] = hubPt(LOOKOUT.x, LOOKOUT.z); mark(x, y, '', '#cfe3b0', 2.5); }
  const seen = new Set(Object.keys((game.data.places || {}).seen || {}));
  for (const p of PLACES) if (!p.hidden && (seen.has(p.id) || p.id === 'cove')) { const [x, y] = hubPt(p.x, p.z); mark(x, y, '', '#f2e3a0', 2.5); }
  { const [x, y] = at(0, 0); mark(x, y, 'Spawn', '#9fd39a'); }
  // you
  { const d = W.frame.toDir(player.position.x, player.position.z, [0, 0, 0]), p = hubPolar(d, W.radius), [x, y] = at(p.D, p.b);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#5ab0ff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  void XENIA;
  const close = () => { if (el) { el.remove(); el = null; } };
  el.querySelector('[data-close]').onclick = close;
  el.querySelector('[data-stars]').onclick = () => { close(); onStars && onStars(); };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  addEventListener('keydown', function esc(e) { if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') { close(); removeEventListener('keydown', esc); } });
  void hud;
  return { close, el };
}
