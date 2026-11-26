// The star map: the endless universe, three zooms deep.
//   Galaxy  - the whole galaxy's star density (spiral arms, core), where you are, neighbouring galaxies
//   Sectors - a 3 x 3 window of 10-ly sectors around any BigInt sector coordinate, pan forever; your jump range ring
//   System  - the selected star's planets and moons, each with its WorldRules summary and the trip's real cost
// Trips cost propellant and must fit the ship's jump range (../universe/travel.js). Eras need a Chronometer.
import { rng, DIMENSIONS } from './names.js';
import { galaxy, density, starsIn, planetsOf, moonsOf, landable, addrKey, parseAddr, HOME, SECTOR_LY, lyBetween } from '../universe/universe.js';
import { dimLaws } from '../universe/dimensions.js';
import { makeWorldRules, summarize, ERAS, ERA_ORDER } from '../universe/rules.js';
import { shipStats, fuelState, refuel, tripCheck, jumpCost } from '../universe/travel.js';
import { worldRules } from '../universe/current.js';
import { game } from './store.js';
import { icon } from './icons.js';
import { SHIPS, fleetData, activeShip, canCommission, commission, setActive as flyShip, worldsVisited } from './fleet.js';

const CSS = `
#starmap{position:fixed;inset:0;z-index:40;background:radial-gradient(120% 90% at 50% 60%,#16204a 0%,#0a0e24 55%,#04050d 100%);color:#eef;font:15px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;transition:opacity .5s;touch-action:none;user-select:none}
#starmap.on{opacity:1}
#starmap canvas{position:absolute;inset:0;width:100%;height:100%}
#starmap .dims{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center}
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
#starmap .bar2 .pad{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);gap:4px}
#starmap .bar2 .pad .b{padding:0;justify-content:center;font-size:18px}
#starmap .bar2{position:absolute;left:max(12px,env(safe-area-inset-left));top:max(70px,calc(env(safe-area-inset-top) + 64px));display:flex;flex-direction:column;gap:6px}
#starmap .pl{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:14px}
#starmap .pl .grow{flex:1;min-width:0}
#starmap .pl .s{opacity:.7;font-size:12px}
#starmap .card{max-height:56vh;overflow:auto}
#starmap .fuel{font-size:13px;opacity:.85;width:100%;text-align:center}
#warpfx{position:fixed;inset:0;z-index:45;pointer-events:none;opacity:0;transition:opacity .6s}
`;
// Navigation only: picking a star or a world sets the ship's course (G.universe.nav); the ship flies it.
// Nothing here moves her. Fast travel is the beacons, from inside the ship.
export function openStarMap({ onClose = null, current = null } = {}) {
  const G = game.data;
  if (!document.getElementById('starmap-css')) { const s = document.createElement('style'); s.id = 'starmap-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = document.createElement('div'); root.id = 'starmap';
  root.innerHTML = `<canvas></canvas><div class="bar"><div class="t">Nav map</div><span class="dims"></span><div class="fuel"></div></div><div class="bar2"></div><button class="b x" title="Close" aria-label="Close">${icon('close')}</button><div class="card"></div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('on'));
  const cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), card = root.querySelector('.card');
  G.universe = G.universe || {};
  // where the ship is now (a system address); old saves: home, or the legacy sector they last looked at
  const here = parseAddr(G.universe.at) || (current === 'planet' && G.where && G.where.addr ? parseAddr(G.where.addr) : null) || HOME;
  const hereSys = { g: here.g, s: here.s, star: here.star };
  let view = 'sectors', dim = G.dim || 'prime', sel = null, raf = 0, t0 = performance.now(), fleetView = false, eraSel = 'present', note = '';
  let cx = here.s[0], cy = here.s[1], gal = here.g; // sector window centre (BigInt) and galaxy
  if (G.mapSector && !G.universe.at && here === HOME) { cx = BigInt(G.mapSector); cy = 0n; }
  const dimsUnlocked = () => Object.keys(DIMENSIONS).filter((k) => k === 'prime' || G.unlocks['dim:' + k] || G.unlocks.dims);
  const ship = () => activeShip();
  if (!ship().dims.includes(dim)) dim = 'prime';
  const loaded = refuel();
  if (loaded) note = `Loaded ${loaded} propellant into the tank.`;
  // stars in the 3 x 3 window, laid out in window coordinates 0..3
  function stars() {
    const out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const s of starsIn(gal, cx + BigInt(i), cy + BigInt(j))) out.push({ ...s, g: gal, s: [cx + BigInt(i), cy + BigInt(j)], wx: (i + 1 + s.x) / 3, wy: (j + 1 + s.y) / 3, r: s.home ? 7 : 1.6 + Math.min(4, Math.pow(s.lum, 0.25) * 2.2) });
    return out;
  }
  let S = stars();
  const sysOf = (s) => ({ g: s.g, s: s.s, star: s.star });
  const isHere = (s) => s.g[0] === hereSys.g[0] && s.g[1] === hereSys.g[1] && s.s[0] === hereSys.s[0] && s.s[1] === hereSys.s[1] && s.star === hereSys.star;
  function size() { const pr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * pr; cv.height = innerHeight * pr; ctx.setTransform(pr, 0, 0, pr, 0, 0); }
  size(); addEventListener('resize', size);
  const bg = []; { const r = rng(1234); for (let i = 0; i < 380; i++) bg.push([r(), r(), r() * 1.1 + 0.2, r()]); }
  // map window -> screen (square, centred)
  const frameBox = () => { const W = innerWidth, H = innerHeight, side = Math.min(W * 0.96, H * 0.8); return { x0: (W - side) / 2, y0: (H - side) / 2 - H * 0.04, side }; };
  let galImg = null, galImgKey = '';
  function drawGalaxy(W, H, t) {
    const Gx = galaxy(gal[0], gal[1]), fb = frameBox(), N = 120, key = `${gal[0]},${gal[1]}`;
    if (galImgKey !== key) {
      galImgKey = key; const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
      const span = Gx.radius * 2.4;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const sx = Gx.core[0] + BigInt(Math.round((x / N - 0.5) * span)), sy = Gx.core[1] + BigInt(Math.round((y / N - 0.5) * span));
        const d = Math.min(1, density(Gx, sx, sy) / 3), o = (y * N + x) * 4;
        img.data[o] = 200 + 55 * d; img.data[o + 1] = 205 + 40 * d; img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * Math.pow(d, 0.7));
      }
      g.putImageData(img, 0, 0); galImg = c;
    }
    ctx.imageSmoothingEnabled = true; ctx.drawImage(galImg, fb.x0, fb.y0, fb.side, fb.side);
    const span = Gx.radius * 2.4, toS = (sx, sy) => [fb.x0 + (Number(sx - Gx.core[0]) / span + 0.5) * fb.side, fb.y0 + (Number(sy - Gx.core[1]) / span + 0.5) * fb.side];
    const [hx, hy] = toS(hereSys.s[0], hereSys.s[1]), [vx, vy] = toS(cx, cy);
    ctx.strokeStyle = 'rgba(255,220,160,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 7 + Math.sin(t * 2) * 1.5, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,220,255,.7)'; ctx.strokeRect(vx - 5, vy - 5, 10, 10);
    ctx.fillStyle = 'rgba(235,240,255,.8)'; ctx.font = '13px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${Gx.name} · ${Gx.kind} · ${Math.round(Gx.radius * SECTOR_LY * 2).toLocaleString()} ly across`, W / 2, fb.y0 + fb.side + 18);
    ctx.fillText('You', hx, hy - 12);
  }
  function draw() {
    const W = innerWidth, H = innerHeight, t = (performance.now() - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const [x, y, s2, p] of bg) { ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 0.6 + p * 30); ctx.fillStyle = '#cfd8ff'; ctx.fillRect(x * W, y * H, s2, s2); }
    ctx.globalAlpha = 1;
    if (view === 'galaxy') { drawGalaxy(W, H, t); raf = requestAnimationFrame(draw); return; }
    const fb = frameBox(), X = (s) => fb.x0 + s.wx * fb.side, Y = (s) => fb.y0 + s.wy * fb.side;
    // sector grid
    ctx.strokeStyle = 'rgba(160,180,255,.08)'; ctx.lineWidth = 1;
    for (let k = 0; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(fb.x0 + k * fb.side / 3, fb.y0); ctx.lineTo(fb.x0 + k * fb.side / 3, fb.y0 + fb.side); ctx.stroke(); ctx.beginPath(); ctx.moveTo(fb.x0, fb.y0 + k * fb.side / 3); ctx.lineTo(fb.x0 + fb.side, fb.y0 + k * fb.side / 3); ctx.stroke(); }
    // jump range ring around the ship's system (when it is in this window)
    const hs = S.find(isHere);
    if (hs) { const rr = shipStats().jumpLy / (SECTOR_LY * 3) * fb.side; ctx.strokeStyle = 'rgba(255,220,160,.35)'; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.arc(X(hs), Y(hs), rr, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    const labels = [];
    for (const s of S) {
      const x = X(s), y = Y(s), visited = !s.home && G.journal.planets && Object.keys(G.journal.planets).some((k) => k.startsWith(s.seed + ':'));
      const tw = 1 + 0.12 * Math.sin(t * 1.3 + (s.seed % 7));
      const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 5 * tw);
      g.addColorStop(0, s.col); g.addColorStop(0.18, s.col + 'aa'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s.r * 5 * tw, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, s.r * 0.55, 0, 7); ctx.fill();
      if (sel === s || visited || isHere(s)) { ctx.strokeStyle = isHere(s) ? 'rgba(255,220,160,.9)' : sel === s ? 'rgba(220,230,255,.85)' : 'rgba(200,220,255,.3)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, s.r * 2.5 + 7 + (sel === s ? Math.sin(t * 2) * 2 : 0), 0, 7); ctx.stroke(); }
      if (sel === s || s.home || isHere(s) || s.r > 3.2) labels.push([sel === s ? 3 : isHere(s) || s.home ? 2 : 1, s, x, y]);
    }
    // names: most important first; each tries below, then above its star, and a minor one that would overlap is left out
    ctx.font = '12px system-ui,sans-serif'; ctx.textAlign = 'center';
    const boxes = [], hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    labels.sort((a, b) => b[0] - a[0]);
    for (const [pri, s, x, y] of labels) {
      const w = ctx.measureText(s.name).width + 6, off = s.r * 2.5 + 20;
      let ly = y + off, b = [x - w / 2, ly - 11, x + w / 2, ly + 3];
      if (hit(b)) { ly = y - off + 10; b = [x - w / 2, ly - 11, x + w / 2, ly + 3]; if (hit(b)) { if (pri < 2) continue; ly = y + off; b = [x - w / 2, ly - 11, x + w / 2, ly + 3]; } }
      boxes.push(b); ctx.fillStyle = `rgba(235,240,255,${pri === 3 ? 0.95 : 0.72})`; ctx.fillText(s.name, x, ly);
    }
    ctx.fillStyle = 'rgba(235,240,255,.55)'; ctx.font = '12px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Sector ${cx}, ${cy} · ${galaxy(gal[0], gal[1]).name} · ${SECTOR_LY * 3} ly across`, innerWidth / 2, fb.y0 + fb.side + 18);
    raf = requestAnimationFrame(draw);
  }
  draw();
  function fuelBar() { const st = shipStats(), F = fuelState(); root.querySelector('.fuel').textContent = `${st.name} · tank ${F.fuel}/${st.tank} propellant · jump ${st.jumpLy} ly${st.chrono ? ' · Chronometer' : ''}${st.void ? ' · Void drive' : ''}`; }
  function dimsBar() {
    const el = root.querySelector('.dims');
    el.innerHTML = dimsUnlocked().map((k) => `<button class="b ${k === dim ? 'sel' : ''}" data-dim="${k}" ${ship().dims.includes(k) ? '' : 'style="opacity:.4"'}>${DIMENSIONS[k].name}</button>`).join('') +
      `<button class="b ${view === 'galaxy' ? 'sel' : ''}" data-view>${view === 'galaxy' ? 'Sectors' : 'Galaxy'}</button><button class="b ${fleetView ? 'sel' : ''}" data-fleet>${icon('rocket')} ${ship().name}</button>`;
    el.querySelectorAll('[data-dim]').forEach((b) => b.addEventListener('click', () => {
      if (!ship().dims.includes(b.dataset.dim)) { sel = null; fleetView = true; dimsBar(); renderCard(`The ${ship().name} cannot cross into ${DIMENSIONS[b.dataset.dim].name}. A bigger ship can.`); return; }
      dim = b.dataset.dim; G.dim = dim; game.save(); dimsBar(); renderCard(); }));
    el.querySelector('[data-fleet]').addEventListener('click', () => { fleetView = !fleetView; dimsBar(); renderCard(); });
    el.querySelector('[data-view]').addEventListener('click', () => { view = view === 'galaxy' ? 'sectors' : 'galaxy'; sel = null; dimsBar(); renderCard(); });
    root.querySelector('.bar2').innerHTML = view === 'galaxy' ? `<button class="b" data-gal="-1,0">‹ Galaxy</button><button class="b" data-gal="1,0">Galaxy ›</button><button class="b" data-gohere>Back to my galaxy</button>`
      : `<div class="pad"><button class="b" data-pan="0,-1" style="grid-area:1/2" title="Pan up" aria-label="Pan up">↑</button><button class="b" data-pan="-1,0" style="grid-area:2/1" title="Pan left" aria-label="Pan left">←</button><button class="b" data-pan="1,0" style="grid-area:2/3" title="Pan right" aria-label="Pan right">→</button><button class="b" data-pan="0,1" style="grid-area:3/2" title="Pan down" aria-label="Pan down">↓</button></div><button class="b" data-gohere title="Back to where the ship is">Here</button>`;
    root.querySelectorAll('[data-pan]').forEach((b) => b.addEventListener('click', () => { const [dx, dy] = b.dataset.pan.split(',').map(BigInt); pan(dx, dy); }));
    root.querySelectorAll('[data-gal]').forEach((b) => b.addEventListener('click', () => { const [dx, dy] = b.dataset.gal.split(',').map(BigInt); gal = [gal[0] + dx, gal[1] + dy]; const Gx = galaxy(gal[0], gal[1]); cx = Gx.core[0] + BigInt(Math.round(Gx.radius * 0.5)); cy = Gx.core[1]; S = stars(); sel = null; renderCard(); }));
    root.querySelector('[data-gohere]').addEventListener('click', () => { gal = here.g; cx = here.s[0]; cy = here.s[1]; S = stars(); sel = null; renderCard(); });
    fuelBar();
  }
  function pan(dx, dy) { cx += dx; cy += dy; S = stars(); sel = null; renderCard(); }
  const eraBtns = () => (shipStats().chrono ? `<div class="pl"><span class="s">Era</span>${ERA_ORDER.map((e) => `<button class="b ${e === eraSel ? 'sel' : ''}" data-era="${e}" style="padding:6px 11px">${ERAS[e].name}</button>`).join('')}</div>` : '');
  function renderCard(msg = '') {
    note = msg || note;
    if (fleetView) { fleetCard(note); note = ''; return; }
    const top = note ? `<div class="muted" style="color:#ffe1b0;margin-bottom:6px">${note}</div>` : ''; note = '';
    if (view === 'galaxy') {
      const Gx = galaxy(gal[0], gal[1]);
      card.innerHTML = `${top}<h2>${Gx.name}</h2><div class="muted">A ${Gx.kind} galaxy${Gx.arms ? ` with ${Gx.arms} arms` : ''}. Tap anywhere to look at that region's stars. Galaxy cell ${gal[0]}, ${gal[1]}: the universe has no edge in any direction.</div>`;
      return;
    }
    if (!sel) { card.innerHTML = `${top}<h2>Sector ${cx}, ${cy}</h2><div class="muted">Tap a star. Every one has its own planets and moons, made from its coordinates. Pan as far as you like: there is always more.</div>`; return; }
    const sys = sysOf(sel), trip = isHere(sel) ? null : tripCheck(hereSys, sys, { rules: null });
    const ly = isHere(sel) ? 0 : lyBetween(hereSys, sys);
    const head = `${top}<h2>${sel.name}</h2><div class="muted">${sel.home ? 'Home. ' : ''}${sel.cls}-type star · ${sel.lum < 0.01 ? sel.lum.toFixed(4) : sel.lum.toFixed(2)} suns bright · ${sel.age} billion years old${isHere(sel) ? ' · you are here' : ` · ${ly.toFixed(1)} ly away`}</div>`;
    const navNow = G.universe.nav && G.universe.nav.addr;
    const why = (trip && !trip.ok ? `<div class="muted" style="margin-top:6px;color:#ffc9a8">${trip.why}</div>` : trip ? `<div class="muted" style="margin-top:6px">To get there: fly past this system's edge, then engage a warp coil (${jumpCost(ly)} propellant for ${ly.toFixed(1)} ly) and fly the crossing.</div>` : '<div class="muted" style="margin-top:6px">In this system: set a course, then fly there (cruise above the air).</div>')
      + `<div style="margin-top:8px"><button class="b ${navNow === addrKey(sys) ? 'main' : ''}" data-course="star">${navNow === addrKey(sys) ? 'Course set' : 'Set course to this star'}</button></div>`;
    const rows = [];
    for (const p of planetsOf(sel)) {
      const bodies = [{ b: p, idx: p.index, moon: null }, ...moonsOf(sel, p).map((m) => ({ b: m, idx: (p.index + 1) * 100 + m.index, moon: m.index, parent: p }))];
      for (const { b, idx, moon, parent } of bodies) {
        const land = landable(b);
        const R = land ? makeWorldRules({ seed: b.seed, body: { ...b }, star: sel, era: eraSel, dim: dimLaws(dim) }) : null;
        const special = b.world === 'earth' || b.world === 'moon';
        const named = G.journal.planets[`${sel.seed}:${idx}:${dim}`];
        rows.push(`<div class="pl" style="${moon != null ? 'padding-left:18px' : ''}"><div class="grow"><div>${named && named.name ? named.name : b.name}${moon != null ? ` <span class="s">moon of ${parent.name}</span>` : ''} <span class="s">· ${b.kind}${b.au ? ` · ${b.au} AU` : ''}</span></div><div class="s">${R ? summarize(R) : 'a gas giant: no surface to stand on'}</div></div><button class="b ${navNow === addrKey({ ...sys, planet: p.index, moon: moon != null ? moon : undefined }) ? 'main' : ''}" data-body="${p.index}${moon != null ? '.' + moon : ''}">${navNow === addrKey({ ...sys, planet: p.index, moon: moon != null ? moon : undefined }) ? 'Course set' : 'Set course'}</button></div>`); void special; void land;
      }
    }
    card.innerHTML = head + why + eraBtns() + rows.join('');
    card.querySelectorAll('[data-era]').forEach((b) => b.addEventListener('click', () => { eraSel = b.dataset.era; renderCard(); }));
    const setCourse = (addr, name) => { G.universe.nav = { addr, name, era: eraSel, dim }; game.save(); renderCard(`Course set: ${name}. Fly there from the ship (the target ring shows the way).`); };
    card.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => setCourse(addrKey(sys), sel.name)));
    card.querySelectorAll('[data-body]').forEach((b) => b.addEventListener('click', () => {
      const [pi, mi] = b.dataset.body.split('.').map(Number), p = planetsOf(sel)[pi], body = mi >= 0 ? moonsOf(sel, p)[mi] : p;
      if (body.world && eraSel !== 'present') { renderCard('Home is home: the garden and the moon base stay in the present.'); return; }
      if (eraSel !== 'present' && !shipStats().chrono) { renderCard('Arriving in another era needs a Chronometer (craft one at a workbench).'); return; }
      const named = G.journal.planets[`${sel.seed}:${mi >= 0 ? (pi + 1) * 100 + mi : pi}:${dim}`];
      setCourse(addrKey({ ...sys, planet: pi, moon: mi >= 0 ? mi : undefined }), named && named.name ? named.name : body.name);
    }));
  }
  function fleetCard(msg) {
    const F = fleetData(), vis = worldsVisited();
    card.innerHTML = `<h2>Your fleet</h2><div class="muted">${msg || 'Each ship jumps further, carries more propellant and crosses into more dimensions. New ones are made from what you gather out there.'}</div>` +
      SHIPS.map((s) => {
        const own = F.owned.includes(s.id), act = F.active === s.id;
        const need = !own && s.cost ? `<div style="margin-top:4px;font-size:13px;opacity:.85">${Object.entries(s.cost).map(([k, n]) => `${n} ${k === 'sample' ? 'world samples' : k === 'flower:any' ? 'flowers' : k === 'find:any' ? 'garden finds' : k === 'moonglass' ? 'moon glass' : k === 'herb' ? 'moon herbs' : k === 'fibre' ? 'plant fibre' : k}`).join(' · ')}${s.worlds ? ` · after ${s.worlds} worlds (${Math.min(vis, s.worlds)}/${s.worlds})` : ''}</div>` : '';
        const btn = act ? '<span class="muted" style="font-size:13px">flying</span>' : own ? `<button class="b" data-fly="${s.id}">Fly</button>` : s.cost ? `<button class="b" data-make="${s.id}" ${canCommission(s) ? '' : 'disabled style="opacity:.45"'}>Make</button>` : '';
        return `<div style="display:flex;gap:10px;align-items:center;margin-top:10px;${own ? '' : 'opacity:.85'}"><span style="width:12px;height:12px;border-radius:50%;background:${s.accent};flex:none"></span><div style="flex:1"><div>${s.name}${own ? '' : ' <span class="muted" style="font-size:13px">· not yet</span>'}</div><div class="muted" style="font-size:13px">${s.desc}</div>${need}</div>${btn}</div>`;
      }).join('');
    card.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => { flyShip(b.dataset.fly); if (!ship().dims.includes(dim)) dim = 'prime'; dimsBar(); renderCard(); }));
    card.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', () => { if (commission(b.dataset.make)) { dimsBar(); renderCard(`The ${ship().name} is ready. It will be waiting wherever you land.`); } }));
  }
  dimsBar(); renderCard();
  // drag to pan the sector window; tap to select
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || view !== 'sectors') return;
    const fb = frameBox(), step = fb.side / 3, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) > step * 0.6 || Math.abs(dy) > step * 0.6) { drag.moved = true; pan(BigInt(-Math.round(dx / step)), BigInt(-Math.round(dy / step))); drag.x = e.clientX; drag.y = e.clientY; }
  });
  cv.addEventListener('pointerup', (e) => {
    const d = drag; drag = null; if (!d || d.moved) return;
    if (view === 'galaxy') {
      const Gx = galaxy(gal[0], gal[1]), fb = frameBox(), span = Gx.radius * 2.4;
      cx = Gx.core[0] + BigInt(Math.round(((e.clientX - fb.x0) / fb.side - 0.5) * span)); cy = Gx.core[1] + BigInt(Math.round(((e.clientY - fb.y0) / fb.side - 0.5) * span));
      view = 'sectors'; S = stars(); sel = null; dimsBar(); renderCard(); return;
    }
    const fb = frameBox(); let best = null, bd = 40;
    for (const s of S) { const dd = Math.hypot(fb.x0 + s.wx * fb.side - e.clientX, fb.y0 + s.wy * fb.side - e.clientY); if (dd < bd) { bd = dd; best = s; } }
    sel = best; fleetView = false; dimsBar(); renderCard();
  });
  function close(viaTravel = false) { cancelAnimationFrame(raf); removeEventListener('resize', size); root.classList.remove('on'); setTimeout(() => root.remove(), 500); if (viaTravel !== true && onClose) onClose(); }
  root.querySelector('.x').addEventListener('click', () => close());
  return {
    close, stars: () => S, fleet() { fleetView = true; dimsBar(); renderCard(); },
    select(i) { sel = typeof i === 'number' ? S[i] : S.find((s) => s.name === i || s.star === i); fleetView = false; renderCard(); return sel; },
    sector(x, y = 0n) { cx = BigInt(x); cy = BigInt(y); S = stars(); sel = null; renderCard(); },
    galaxyView(on = true) { view = on ? 'galaxy' : 'sectors'; dimsBar(); renderCard(); },
    era(e) { eraSel = e; renderCard(); }, get here() { return addrKey(hereSys); },
  };
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
