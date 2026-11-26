// Small game overlays driven by settings: performance counter, hit marker, minimap, film grain.
import { settings, zen } from './settings.js';
import { kindOf, trailKey } from './worldmap.js';
import { game } from './store.js';
import { drawEnso } from '../enso.js';

export const OVERLAY_CSS = `
#zen-perf{position:absolute;left:calc(env(safe-area-inset-left,0px) + 10px);top:calc(env(safe-area-inset-top,0px) + 8px);font:600 12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e9f2e0;background:rgba(8,10,10,.55);padding:4px 8px;border-radius:7px;pointer-events:none;white-space:pre;font-variant-numeric:tabular-nums;z-index:3}
#zen-perf .lo{color:#ffb070}#zen-perf .bad{color:#ff6b6b}
#zen-hit{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0}
#zen-hit svg{position:absolute;left:0;top:0;transform:translate(-50%,-50%) scale(var(--hk,1));overflow:visible}
#zen-hit.on{opacity:1;transition:none}#zen-hit.off{opacity:0;transition:opacity var(--hm,200ms) ease-out}
#zen-mini{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 64px);width:156px;height:156px;border-radius:50%;overflow:hidden;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:calc(.92 * var(--ho,1));zoom:var(--hs,1)}
#zen-mini canvas{width:100%;height:100%;display:block}
#zen-mini .n{position:absolute;top:2px;left:50%;transform:translateX(-50%);font:700 10px/1 ui-sans-serif,system-ui,sans-serif;color:#f4f1ea;text-shadow:0 1px 2px #000}
#zen-grain{position:fixed;inset:-50%;pointer-events:none;z-index:4;opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");animation:zen-grain .5s steps(4) infinite}
@keyframes zen-grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}}
html.reduce-motion #zen-grain{animation:none}
`;

export function createOverlays({ hud, engine, renderer, worlds, whereNow, audio }) {
  // ---- performance overlay
  const perf = document.createElement('div'); perf.id = 'zen-perf'; perf.style.display = 'none'; hud.root.appendChild(perf);
  let ft = [], lastT = performance.now();
  (function loop(t) { requestAnimationFrame(loop); if (settings.video.perf !== 'off') { ft.push(t - lastT); if (ft.length > 120) ft.shift(); } lastT = t; })(lastT);
  setInterval(() => {
    const mode = settings.video.perf; perf.style.display = mode === 'off' ? 'none' : '';
    if (mode === 'off') return;
    const fps = Math.round(engine.fps || 0), avg = ft.length ? ft.reduce((a, b) => a + b, 0) / ft.length : 0, worst = ft.length ? Math.max(...ft) : 0;
    const cls = fps < 30 ? 'bad' : fps < 55 ? 'lo' : '';
    perf.innerHTML = `<span class="${cls}">${fps} FPS</span>` + (mode === 'full' ? `\n${avg.toFixed(1)} ms avg  ${worst.toFixed(0)} ms max\n${renderer.info.render.calls} draws  ${Math.round(renderer.info.render.triangles / 1000)}k tris\n${Math.round(engine.width * engine.pixelRatio * engine.renderScale)}×${Math.round(engine.height * engine.pixelRatio * engine.renderScale)}${engine.fpsCap ? `  cap ${engine.fpsCap}` : ''}` : '');
  }, 250);

  // ---- hit marker (for tools now and weapons later): zen.hitmarker('hit' | 'kill')
  const hit = document.createElement('div'); hit.id = 'zen-hit'; hud.root.appendChild(hit);
  let hitT = 0;
  function hitSvg(kind) {
    const H = settings.hud.hit, c = kind === 'kill' ? '#ff4655' : H.color, w = 2.2, s = '0 0 2px rgba(0,0,0,.8)';
    if (H.style === 'ring') return `<svg width="34" height="34" viewBox="-17 -17 34 34" style="filter:drop-shadow(${s})"><circle r="11" fill="none" stroke="${c}" stroke-width="${w}"/></svg>`;
    if (H.style === 'dot') return `<svg width="12" height="12" viewBox="-6 -6 12 12" style="filter:drop-shadow(${s})"><circle r="4" fill="${c}"/></svg>`;
    return `<svg width="36" height="36" viewBox="-18 -18 36 36" style="filter:drop-shadow(${s})" stroke="${c}" stroke-width="${w}" stroke-linecap="round"><path d="M-12-12L-5-5M12-12L5-5M-12 12L-5 5M12 12L5 5"/></svg>`;
  }
  zen.hitmarker = (kind = 'hit') => {
    const H = settings.hud.hit; if (H.style === 'off') return;
    hit.innerHTML = hitSvg(kind); hit.style.setProperty('--hk', H.size * (kind === 'kill' ? 1.25 : 1)); hit.style.setProperty('--hm', Math.round(H.ms * 0.45) + 'ms');
    hit.classList.remove('off'); hit.classList.add('on');
    clearTimeout(hitT); hitT = setTimeout(() => { hit.classList.remove('on'); hit.classList.add('off'); }, H.ms * 0.55);
    if (H.sound && audio && audio.ui) try { audio.ui('tick'); } catch (e) { /* */ }
  };

  // ---- minimap: north up, 36 m around her, the same seals as the full map
  const mini = document.createElement('div'); mini.id = 'zen-mini'; mini.innerHTML = '<canvas width="312" height="312"></canvas><span class="n">N</span>'; hud.root.appendChild(mini);
  const mc = mini.querySelector('canvas').getContext('2d');
  function drawMini() {
    const w = worlds.current, on = settings.hud.minimap && w && w.mapData && !hud.root.classList.contains('menu-open');
    mini.style.display = on ? '' : 'none'; if (!on) return;
    let md; try { md = w.mapData(); } catch (e) { md = null; }
    if (!md || !md.player) { mini.style.display = 'none'; return; }
    const W = 312, R = 36, sc = W / 2 / R, p = md.player, X = (x) => W / 2 + (x - p.x) * sc, Y = (z) => W / 2 + (z - p.z) * sc;
    mc.fillStyle = 'rgba(18,22,20,.72)'; mc.fillRect(0, 0, W, W);
    if (md.height) {
      const st = 24, c = [];
      for (let py = 0; py < W; py += st) for (let px = 0; px < W; px += st) c.push([px, py, md.height(p.x + (px + st / 2 - W / 2) / sc, p.z + (py + st / 2 - W / 2) / sc)]);
      const lo = Math.min(...c.map((v) => v[2])), hi = Math.max(...c.map((v) => v[2]));
      for (const [px, py, h] of c) { const k = (h - lo) / (hi - lo + 1e-6), wet = md.sea != null && h < md.sea; mc.fillStyle = wet ? 'rgba(80,110,130,.8)' : `rgba(${150 - 60 * k},${150 - 55 * k},${130 - 50 * k},.55)`; mc.fillRect(px, py, st, st); }
    } else if (md.extent) { const E = md.extent; mc.fillStyle = 'rgba(150,165,120,.45)'; mc.beginPath(); mc.arc(X(E.cx), Y(E.cz), E.r * sc * 0.97, 0, 7); mc.fill(); }
    if (md.pond) { mc.fillStyle = 'rgba(110,140,150,.85)'; mc.beginPath(); md.pond.forEach(([x, z], i) => (i ? mc.lineTo(X(x), Y(z)) : mc.moveTo(X(x), Y(z)))); mc.closePath(); mc.fill(); }
    const wn = whereNow(), trail = wn ? ((game.data.trails || {})[trailKey(wn)] || []) : [];
    if (trail.length) { mc.strokeStyle = 'rgba(239,230,210,.45)'; mc.lineWidth = 3; mc.setLineDash([2, 8]); mc.beginPath(); trail.slice(-80).forEach(([x, z], i) => (i ? mc.lineTo(X(x), Y(z)) : mc.moveTo(X(x), Y(z)))); mc.stroke(); mc.setLineDash([]); }
    for (const it of md.items || []) {
      const k = kindOf(it.id); if (!k) continue;
      let x = X(it.x), y = Y(it.z); const dx = x - W / 2, dy = y - W / 2, d = Math.hypot(dx, dy);
      const edge = d > W / 2 - 12; if (edge) { if (k[1] === 'bed' || k[1] === 'sample') continue; x = W / 2 + (dx / d) * (W / 2 - 12); y = W / 2 + (dy / d) * (W / 2 - 12); }
      mc.fillStyle = k[3]; mc.strokeStyle = 'rgba(10,12,10,.8)'; mc.lineWidth = 2; mc.globalAlpha = edge ? 0.7 : 1;
      mc.beginPath(); mc.arc(x, y, k[1] === 'bed' || k[1] === 'sample' ? 4 : 8, 0, 7); mc.fill(); mc.stroke(); mc.globalAlpha = 1;
    }
    // her: a river stone that points (art bible 1), round at the back, a soft point where she faces
    const dx = Math.sin(p.yaw), dy = Math.cos(p.yaw), cx = W / 2, cy = W / 2, ang = Math.atan2(dy, dx);
    mc.fillStyle = '#f3ede1'; mc.strokeStyle = 'rgba(20,24,28,.85)'; mc.lineWidth = 2.5;
    mc.beginPath(); mc.arc(cx - dx * 2, cy - dy * 2, 8.5, ang + 0.55 * Math.PI, ang + 1.45 * Math.PI);
    mc.quadraticCurveTo(cx + dx * 6 - dy * 6, cy + dy * 6 + dx * 6, cx + dx * 15, cy + dy * 15);
    mc.quadraticCurveTo(cx + dx * 6 + dy * 6, cy + dy * 6 - dx * 6, cx - dx * 2 + Math.cos(ang + 0.55 * Math.PI) * 8.5, cy - dy * 2 + Math.sin(ang + 0.55 * Math.PI) * 8.5);
    mc.closePath(); mc.fill(); mc.stroke();
    // the compass ring is an ensō; its open gap is north (the N sits in it)
    drawEnso(mc, cx, cy, W / 2 - 9, 11, { at: -Math.PI / 2, gap: 0.42, color: '#f3ede1', alpha: 0.82 });
  }
  setInterval(drawMini, 400);

  // ---- film grain where the world has no grain of its own (the garden's grade does it in-shader)
  const grain = document.createElement('div'); grain.id = 'zen-grain'; grain.style.display = 'none'; document.body.appendChild(grain);
  function applyGrain() { const w = worlds.current; const own = w && w.setGrain; if (own) w.setGrain(settings.video.filmGrain); grain.style.display = settings.video.filmGrain && !own ? '' : 'none'; }
  return { drawMini, applyGrain, perf, hit, mini };
}
