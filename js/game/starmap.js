// The star map: a calm overlay. Home (the Sun, Earth and the moon) and endless systems made from seeds,
// one sector at a time. Choose a star, choose a dimension, and warp. Visited worlds glow softly.
import { rng, hash, makeName, DIMENSIONS } from './names.js';
import { game } from './store.js';
import { icon } from './icons.js';
import { SHIPS, fleetData, activeShip, canCommission, commission, setActive as flyShip, worldsVisited } from './fleet.js';

const CSS = `
#starmap{position:fixed;inset:0;z-index:40;background:radial-gradient(120% 90% at 50% 60%,#16204a 0%,#0a0e24 55%,#04050d 100%);color:#eef;font:15px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;transition:opacity .5s;touch-action:none;user-select:none}
#starmap.on{opacity:1}
#starmap canvas{position:absolute;inset:0;width:100%;height:100%}
#starmap .bar{position:absolute;left:0;right:0;top:max(12px,env(safe-area-inset-top));display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;padding:0 64px}
#starmap .t{font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;width:100%;text-align:center}
#starmap .b{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:999px;padding:9px 15px;font:inherit;font-size:14px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
#starmap .b svg{width:18px;height:18px}
#starmap .b.sel{background:rgba(190,210,255,.3);border-color:rgba(220,230,255,.6)}
#starmap .x{position:absolute;right:max(14px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));width:44px;height:44px;border-radius:50%;padding:0;justify-content:center}
#starmap .card{position:absolute;left:50%;transform:translateX(-50%);bottom:max(18px,env(safe-area-inset-bottom));width:min(440px,calc(100% - 28px));background:rgba(20,26,60,.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px 18px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
#starmap .card h2{margin:0 0 2px;font-size:21px;font-weight:600}
#starmap .card .muted{opacity:.7;font-size:14px}
#starmap .card .go{margin-top:12px;display:flex;gap:8px;justify-content:flex-end}
#starmap .card .go .b.main{background:#cfe0ff;color:#16204a;border-color:#cfe0ff;font-weight:600}
#warpfx{position:fixed;inset:0;z-index:45;pointer-events:none;opacity:0;transition:opacity .6s}
`;
export function openStarMap({ onTravel, current = null }) {
  const G = game.data;
  if (!document.getElementById('starmap-css')) { const s = document.createElement('style'); s.id = 'starmap-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = document.createElement('div'); root.id = 'starmap';
  root.innerHTML = `<canvas></canvas><div class="bar"><div class="t">Star map</div><span class="dims"></span></div><button class="b x" title="Close">${icon('close')}</button><div class="card"></div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('on'));
  const cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), card = root.querySelector('.card');
  let sector = G.mapSector || 0, dim = G.dim || 'prime', sel = null, raf = 0, t0 = performance.now();
  const dimsUnlocked = () => Object.keys(DIMENSIONS).filter((k) => k === 'prime' || G.unlocks['dim:' + k] || G.unlocks.dims);
  let fleetView = false;
  const ship = () => activeShip();
  if (!ship().dims.includes(dim)) dim = 'prime';
  const inRange = () => Math.abs(sector) <= ship().range;
  function stars() {
    const out = [{ id: 'home', name: 'The Sun', home: true, x: 0.5, y: 0.62, r: 7, col: '#ffe7b0', planets: ['Earth', 'The Moon'] }];
    const R = rng(hash(sector, 77));
    const n = 13;
    for (let i = 0; i < n; i++) {
      const seed = hash(sector, i, 991) % 1000000;
      const r = rng(seed);
      let x, y, ok = false;
      for (let k = 0; k < 30 && !ok; k++) { x = 0.1 + R() * 0.8; y = 0.2 + R() * 0.62; ok = out.every((s) => Math.hypot(s.x - x, (s.y - y) * 0.7) > 0.1); }
      const temp = r();
      const col = temp < 0.3 ? '#ffb38a' : temp < 0.6 ? '#fff1d6' : temp < 0.85 ? '#dfe8ff' : '#a9c4ff';
      out.push({ id: seed, seed, name: makeName(seed), x, y, r: 2.2 + r() * 3.2, col, worlds: 1 + Math.floor(r() * 3), tw: r() * 6 });
    }
    return out;
  }
  let S = stars();
  function size() { const pr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * pr; cv.height = innerHeight * pr; ctx.setTransform(pr, 0, 0, pr, 0, 0); }
  size(); addEventListener('resize', size);
  // a fixed sprinkle of faint background stars and a soft nebula
  const bg = []; { const r = rng(1234 + sector); for (let i = 0; i < 380; i++) bg.push([r(), r(), r() * 1.1 + 0.2, r()]); }
  function draw() {
    const W = innerWidth, H = innerHeight, t = (performance.now() - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const neb = rng(hash(sector, 5));
    for (let i = 0; i < 4; i++) {
      const x = neb() * W, y = neb() * H, r = (0.25 + neb() * 0.35) * Math.max(W, H);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const hue = Math.floor(200 + neb() * 120);
      g.addColorStop(0, `hsla(${hue},70%,60%,0.10)`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    for (const [x, y, s, p] of bg) { ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 0.6 + p * 30); ctx.fillStyle = '#cfd8ff'; ctx.fillRect(x * W, y * H, s, s); }
    ctx.globalAlpha = 1;
    for (const s of S) {
      const x = s.x * W, y = s.y * H, visited = !s.home && G.journal.planets && Object.keys(G.journal.planets).some((k) => k.startsWith(s.seed + ':'));
      const tw = 1 + 0.12 * Math.sin(t * 1.3 + (s.tw || 0));
      const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 6 * tw);
      g.addColorStop(0, s.col); g.addColorStop(0.18, s.col + 'aa'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s.r * 6 * tw, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, s.r * 0.6, 0, 7); ctx.fill();
      if (sel === s || visited || s.home) {
        ctx.strokeStyle = sel === s ? 'rgba(220,230,255,.85)' : 'rgba(200,220,255,.3)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, s.r * 3 + 8 + (sel === s ? Math.sin(t * 2) * 2 : 0), 0, 7); ctx.stroke();
      }
      ctx.fillStyle = `rgba(235,240,255,${sel === s ? 0.95 : 0.55})`; ctx.font = '13px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.name, x, y + s.r * 3 + 24);
    }
    raf = requestAnimationFrame(draw);
  }
  draw();
  function dimsBar() {
    const el = root.querySelector('.dims');
    el.innerHTML = dimsUnlocked().map((k) => `<button class="b ${k === dim ? 'sel' : ''}" data-dim="${k}" ${ship().dims.includes(k) ? '' : 'style="opacity:.4"'}>${DIMENSIONS[k].name}</button>`).join('') +
      `<button class="b" data-sector="-1">‹ Sector</button><button class="b" data-sector="1">Sector ›</button><button class="b ${fleetView ? 'sel' : ''}" data-fleet>${icon('rocket')} ${ship().name}</button>`;
    el.querySelectorAll('[data-dim]').forEach((b) => b.addEventListener('click', () => {
      if (!ship().dims.includes(b.dataset.dim)) { sel = null; fleetView = true; dimsBar(); renderCard(`The ${ship().name} cannot cross into ${DIMENSIONS[b.dataset.dim].name}. A bigger ship can.`); return; }
      dim = b.dataset.dim; G.dim = dim; game.save(); dimsBar(); renderCard(); }));
    el.querySelector('[data-fleet]').addEventListener('click', () => { fleetView = !fleetView; dimsBar(); renderCard(); });
    el.querySelectorAll('[data-sector]').forEach((b) => b.addEventListener('click', () => { sector += +b.dataset.sector; G.mapSector = sector; game.save(); S = stars(); sel = null; renderCard(); }));
  }
  function renderCard(note = '') {
    if (fleetView) { fleetCard(note); return; }
    if (sel && !sel.home && !inRange()) {
      card.innerHTML = `<h2>${sel.name}</h2><div class="muted">Sector ${sector + 1} is beyond the ${ship().name}'s reach (${ship().range} sector${ship().range > 1 ? 's' : ''} from home). A bigger ship could take you there.</div><div class="go"><button class="b" data-fleetopen>${icon('rocket')} Your fleet</button></div>`;
      card.querySelector('[data-fleetopen]').addEventListener('click', () => { fleetView = true; dimsBar(); renderCard(); });
      return;
    }
    if (!sel) { card.innerHTML = `<h2>Sector ${sector + 1}</h2><div class="muted">Tap a star. Every one has its own worlds, and there are always more sectors.</div>`; return; }
    if (sel.home) {
      card.innerHTML = `<h2>Home</h2><div class="muted">The Sun, Earth and the moon. The garden keeps growing while you are away.</div><div class="go">${current !== 'moon' ? `<button class="b" data-go="moon">${icon('star')} The moon base</button>` : ''}${current !== 'earth' ? `<button class="b main" data-go="earth">${icon('home')} The garden</button>` : ''}</div>`;
    } else {
      const d = DIMENSIONS[dim];
      card.innerHTML = `<h2>${sel.name}</h2><div class="muted">${sel.worlds} world${sel.worlds > 1 ? 's' : ''} · ${d.name} dimension: ${d.hint}</div><div class="go">` +
        Array.from({ length: sel.worlds }, (_, i) => { const nm = makeName(hash(sel.seed, i, 3)); const named = G.journal.planets[`${sel.seed}:${i}:${dim}`]; return `<button class="b ${i === 0 ? 'main' : ''}" data-planet="${i}">${icon('star')} ${named && named.name ? named.name : nm}</button>`; }).join('') + `</div>`;
    }
    card.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => travel({ world: b.dataset.go })));
    card.querySelectorAll('[data-planet]').forEach((b) => b.addEventListener('click', () => travel({ world: 'planet', seed: hash(sel.seed, +b.dataset.planet, 3) % 1000000, star: sel.seed, index: +b.dataset.planet, dim })));
  }
  function fleetCard(note) {
    const F = fleetData(), vis = worldsVisited();
    card.innerHTML = `<h2>Your fleet</h2><div class="muted">${note || 'Each ship reaches further, and into more dimensions. New ones are made from what you gather out there.'}</div>` +
      SHIPS.map((s) => {
        const own = F.owned.includes(s.id), act = F.active === s.id;
        const reach = s.range === Infinity ? 'anywhere' : `${s.range} sector${s.range > 1 ? 's' : ''}`;
        const need = !own && s.cost ? `<div style="margin-top:4px;font-size:13px;opacity:.85">${Object.entries(s.cost).map(([k, n]) => `${n} ${k === 'sample' ? 'world samples' : k === 'flower:any' ? 'flowers' : k === 'find:any' ? 'garden finds' : k === 'moonglass' ? 'moon glass' : k === 'herb' ? 'moon herbs' : k === 'fibre' ? 'plant fibre' : k}`).join(' · ')}${s.worlds ? ` · after ${s.worlds} worlds (${Math.min(vis, s.worlds)}/${s.worlds})` : ''}</div>` : '';
        const btn = act ? '<span class="muted" style="font-size:13px">flying</span>' : own ? `<button class="b" data-fly="${s.id}">Fly</button>` : s.cost ? `<button class="b" data-make="${s.id}" ${canCommission(s) ? '' : 'disabled style="opacity:.45"'}>Make</button>` : '';
        return `<div style="display:flex;gap:10px;align-items:center;margin-top:10px;${own ? '' : 'opacity:.85'}"><span style="width:12px;height:12px;border-radius:50%;background:${s.accent};flex:none"></span><div style="flex:1"><div>${s.name}${own ? '' : ' <span class="muted" style="font-size:13px">· not yet</span>'}</div><div class="muted" style="font-size:13px">${s.desc} Reach: ${reach}.</div>${need}</div>${btn}</div>`;
      }).join('');
    card.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => { flyShip(b.dataset.fly); if (!ship().dims.includes(dim)) dim = 'prime'; dimsBar(); renderCard(); }));
    card.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', () => { if (commission(b.dataset.make)) { dimsBar(); renderCard(`The ${ship().name} is ready. It will be waiting wherever you land.`); } }));
  }
  dimsBar(); renderCard();
  cv.addEventListener('pointerdown', (e) => {
    const W = innerWidth, H = innerHeight; let best = null, bd = 44;
    for (const s of S) { const d = Math.hypot(s.x * W - e.clientX, s.y * H - e.clientY); if (d < bd) { bd = d; best = s; } }
    sel = best; fleetView = false; dimsBar(); renderCard();
  });
  function close() { cancelAnimationFrame(raf); removeEventListener('resize', size); root.classList.remove('on'); setTimeout(() => root.remove(), 500); }
  async function travel(dest) { close(); await warpFx(); onTravel && onTravel(dest); }
  root.querySelector('.x').addEventListener('click', close);
  return { close, select(i) { sel = S[i]; fleetView = false; renderCard(); }, travel, stars: () => S, fleet() { fleetView = true; dimsBar(); renderCard(); }, sector(n) { sector = n; S = stars(); sel = null; renderCard(); } };
}
// a calm warp: the stars stretch into soft streaks and fade to white-blue
export function warpFx(ms = 2200) {
  const c = document.createElement('canvas'); c.id = 'warpfx'; document.body.appendChild(c);
  const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const R = rng(9), st = Array.from({ length: 260 }, () => ({ a: R() * 6.283, d: R() * 0.2 + 0.02, s: R() * 0.6 + 0.4 }));
  const t0 = performance.now();
  requestAnimationFrame(() => (c.style.opacity = 1));
  return new Promise((res) => {
    function f() {
      const t = (performance.now() - t0) / ms, W = c.width, H = c.height, M = Math.max(W, H);
      ctx.fillStyle = `rgba(6,8,22,${0.35})`; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,220,255,.8)'; ctx.lineCap = 'round';
      for (const s of st) {
        s.d += s.s * 0.012 * (0.4 + t * 3);
        const r0 = s.d * M, r1 = r0 * (1 + 0.08 + t * 0.5);
        ctx.lineWidth = 1 + t * 2; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(s.a) * r0, H / 2 + Math.sin(s.a) * r0); ctx.lineTo(W / 2 + Math.cos(s.a) * r1, H / 2 + Math.sin(s.a) * r1); ctx.stroke();
        if (s.d > 0.9) s.d = 0.02;
      }
      if (t > 0.7) { ctx.fillStyle = `rgba(225,235,255,${(t - 0.7) / 0.3})`; ctx.fillRect(0, 0, W, H); }
      if (t < 1) requestAnimationFrame(f); else { res(); setTimeout(() => { c.style.opacity = 0; setTimeout(() => c.remove(), 700); }, 400); }
    }
    f();
  });
}
