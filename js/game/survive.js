// Hostile places (the airless moon, and any world marked vacuum): oxygen, cold and radiation.
// A suit you earned makes them walkable. Running out is a retreat to safety, never an instant death.
import { game, UNLOCK_ALL } from './store.js';
import { ensureG7, hasSuit, wearingSuit } from './skills.js';

const CSS = `
#hud-vitals{position:absolute;left:calc(env(safe-area-inset-left,0px) + 16px);top:calc(env(safe-area-inset-top,0px) + 44px);width:min(200px,46vw);pointer-events:none;opacity:0;transition:opacity .6s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.65))}
#hud-vitals.on{opacity:.92}
#hud-vitals .vb{height:5px;border-radius:999px;background:rgba(0,0,0,.35);margin:0 0 6px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
#hud-vitals .vb>i{display:block;height:100%;width:0;border-radius:inherit;background:#cfe8b8;transition:width .2s linear,background .4s}
#hud-vitals .vb.o2>i{background:#9fd0e8}
#hud-vitals .vb.o2.low>i{background:#e8c46a}
#hud-vitals .vb.o2.crit>i{background:#e07a58}
#hud-vitals .vb.heat>i{background:#9ec4e0}
#hud-vitals .vb.heat.low>i{background:#e8c46a}
#hud-vitals .vb.rad>i{background:#d9a441}
#hud-vitals .vl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin:0 0 3px;text-shadow:0 1px 2px rgba(0,0,0,.5)}
#hud-warn{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 52px);transform:translateX(-50%);width:min(520px,86vw);text-align:center;font-size:15px;letter-spacing:.02em;opacity:0;transition:opacity .7s ease;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.6),0 0 14px rgba(0,0,0,.4)}
#hud-warn.on{opacity:.92}
#hud-warn.crit{color:#f0c4b0}
`;

export const HAZARD = {
  moon: { vacuum: true, o2Empty: 52, tank: 640, coldEmpty: 80, radFull: 140 },
  space: { vacuum: false },
  earth: { vacuum: false },
  planet: { vacuum: false },
};
export function profileFor(world, extra) {
  const base = { ...(HAZARD[world] || HAZARD.planet) };
  if (extra && (extra.vacuum || extra.airless || extra.hazard === 'vacuum')) Object.assign(base, HAZARD.moon, extra);
  return base;
}

let installed = false, el = { vitals: null, warn: null };
function install(hud) {
  if (installed || !hud || !hud.root) return;
  if (!document.getElementById('hud-survive-css')) {
    const st = document.createElement('style'); st.id = 'hud-survive-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  el.vitals = document.createElement('div'); el.vitals.id = 'hud-vitals';
  el.vitals.innerHTML = `<div class="vl o2l">Oxygen</div><div class="vb o2"><i></i></div><div class="vl heatl">Warmth</div><div class="vb heat"><i></i></div><div class="vl radl">Exposure</div><div class="vb rad"><i></i></div>`;
  el.warn = document.createElement('div'); el.warn.id = 'hud-warn'; el.warn.className = 'soft';
  hud.root.appendChild(el.vitals); hud.root.appendChild(el.warn);
  installed = true;
}

export function createSurvival({ world = 'earth', player, hud, hazard = null, isSafe, retreat, isPaused }) {
  install(hud);
  const P = profileFor(world, hazard);
  const t = ensureG7();
  const S = { o2: 100, heat: 100, rad: 0, line: '', lastLine: '', lastAt: 0, retreating: false };
  // a worn suit carries its tank between worlds
  if (wearingSuit() && t.o2 != null) S.o2 = t.o2;
  const setBar = (cls, v, invert = false) => {
    const b = el.vitals && el.vitals.querySelector('.vb.' + cls); if (!b) return;
    const i = b.querySelector('i'); const k = invert ? v : v;
    i.style.width = Math.max(0, Math.min(100, k)) + '%';
    b.classList.toggle('low', !invert && v <= 45 && v > 18);
    b.classList.toggle('crit', !invert && v <= 18);
  };
  const show = (on) => { if (el.vitals) el.vitals.classList.toggle('on', on); };
  const warn = (text, crit = false) => {
    S.line = text || '';
    if (!el.warn) return;
    if (S.line !== S.lastLine) { el.warn.textContent = S.line; S.lastLine = S.line; S.lastAt = 0; }
    el.warn.classList.toggle('on', !!S.line);
    el.warn.classList.toggle('crit', !!crit);
  };
  async function collapse() {
    if (S.retreating || !retreat) return;
    S.retreating = true;
    warn('You cannot stay. Get back.', true);
    try { if (hud.fadeTo) await hud.fadeTo(1, 900); } catch (e) { /* */ }
    try { await retreat(); } catch (e) { console.warn('[survive] retreat', e); }
    S.o2 = 100; S.heat = 100; S.rad = 0; t.o2 = 100; game.save();
    if (player && player.burden != null) player.burden = 1;
    try { if (hud.fadeTo) await hud.fadeTo(0, 1200); } catch (e) { /* */ }
    hud.toast('You made it back. Air fills your lungs.', 'star', 5200);
    warn(''); S.retreating = false;
  }
  const api = {
    get state() { return S; },
    get profile() { return P; },
    debug(patch = {}) { Object.assign(S, patch); if (patch.o2 != null) t.o2 = patch.o2; return S; },
    tick(dt) {
      if (!P.vacuum || !hud || (isPaused && isPaused()) || S.retreating) {
        if (!P.vacuum) { show(false); warn(''); }
        return;
      }
      const safe = !!(isSafe && isSafe());
      const suited = wearingSuit();
      const hidden = hud.mode === 'cinematic' || hud.mode === 'away';
      if (safe) {
        S.o2 = Math.min(100, S.o2 + dt * (suited ? 28 : 40));
        S.heat = Math.min(100, S.heat + dt * 25);
        S.rad = Math.max(0, S.rad - dt * 8);
        t.o2 = S.o2;
        if (player) player.burden = 1;
        const showBar = suited && S.o2 < 99.5;
        show(!hidden && showBar);
        if (showBar) { setBar('o2', S.o2); if (el.vitals) { el.vitals.querySelector('.heatl').style.display = 'none'; el.vitals.querySelector('.vb.heat').style.display = 'none'; el.vitals.querySelector('.radl').style.display = 'none'; el.vitals.querySelector('.vb.rad').style.display = 'none'; } }
        warn(suited && S.o2 < 99 ? '' : (hasSuit() && !suited ? 'The rocket holds air. Your suit is not on.' : ''));
        return;
      }
      // out in the vacuum
      if (el.vitals) {
        el.vitals.querySelector('.heatl').style.display = suited ? 'none' : '';
        el.vitals.querySelector('.vb.heat').style.display = suited ? 'none' : '';
        el.vitals.querySelector('.radl').style.display = suited ? 'none' : '';
        el.vitals.querySelector('.vb.rad').style.display = suited ? 'none' : '';
      }
      if (suited) {
        S.o2 = Math.max(0, S.o2 - dt * (100 / P.tank));
        S.heat = 100; S.rad = Math.max(0, S.rad - dt * 4);
        t.o2 = S.o2;
        if (player) player.burden = 1;
      } else {
        S.o2 = Math.max(0, S.o2 - dt * (100 / P.o2Empty));
        S.heat = Math.max(0, S.heat - dt * (100 / P.coldEmpty));
        S.rad = Math.min(100, S.rad + dt * (100 / P.radFull));
        if (player) player.burden = S.heat < 40 ? 0.72 : S.heat < 70 ? 0.88 : 1;
      }
      show(!hidden);
      setBar('o2', S.o2); setBar('heat', S.heat); setBar('rad', S.rad);
      let line = '', crit = false;
      if (!suited) {
        if (S.o2 <= 18 || S.heat <= 18) { line = 'The air is gone. Get back to the rocket.'; crit = true; }
        else if (S.o2 <= 45) line = 'Your lungs are already thinning. The rocket still holds a breath.';
        else if (S.heat <= 50) line = 'The cold is getting into you.';
        else if (S.rad > 30) line = 'The sun is harsh without a visor.';
        else line = hasSuit() ? 'No air here. The suit is not on.' : 'No air here, and the cold bites. The rocket still holds a breath.';
      } else if (S.o2 <= 18) { line = 'The tank is nearly empty. Get back and refill.'; crit = true; }
      else if (S.o2 <= 40) line = 'The tank is running low. The rocket or the habitat can refill it.';
      warn(hidden ? '' : line, crit);
      if (S.o2 <= 0 || S.heat <= 0 || S.rad >= 100) collapse();
    },
  };
  if (new URLSearchParams(location.search).has('debug')) window.__survive = api;
  void UNLOCK_ALL;
  return api;
}
