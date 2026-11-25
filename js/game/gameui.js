// Game-only UI layer: crosshair, the zen look, pause menu, settings (applied live), gamepad,
// world map, first-play tutorial and quiet milestones. Started from main.js only when isGameWorld();
// mom's garden never loads any of it.
import { getHud, hooks, bindKeys, runAction } from './session.js';
import { settings, onChange } from './settings.js';
import { svg, resolve } from './crosshair.js';
import { mountCrosshair } from './crosshair-ui.js';
import { MAKER_CSS, ZEN_CSS, CAIRN } from './zen-style.js';
import { createMenu, MENU_CSS } from './menu.js';
import { createGamepad } from './gamepad.js';
import { view, prefs, lookPrefs } from './player.js';

const EXTRA_CSS = `
#hud.zen.no-prompt #hud-word,#hud.zen.no-toasts #hud-msg,#hud.zen.no-buttons #hud-top,#hud.zen.no-saved #hud-saved{display:none!important}
#hud.zen #hud-top,#hud.zen #hud-gaze,#hud.zen #hud-msg,#hud.zen #hud-tool,#hud.zen #hud-saved,#hud.zen #hud-joy{filter:opacity(var(--ho,1))}
#hud.zen #hud-top,#hud.zen #hud-panel,#hud.zen #hud-dialog,#hud.zen #zen-menu .zm-card,#hud.zen #zen-cap{zoom:var(--hs,1)}
#hud.zen #zen-menu{font-size:calc(15px * var(--ts,1))}
#hud.zen #hud-panel{font-size:calc(15px * var(--ts,1))}
#hud.zen.joy-right #hud-move{left:auto;right:0}
#hud.zen #hud-joy{transform:scale(var(--js,1))}
html.reduce-motion #hud *,html.reduce-motion #hud-fade{transition-duration:.01s!important}
#zen-cap{position:absolute;left:calc(env(safe-area-inset-left,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;flex-direction:column;gap:4px;align-items:flex-start;pointer-events:none}
#zen-cap .c{font-family:var(--serif);font-style:italic;font-size:calc(14px * var(--ts,1));opacity:0;transition:opacity .6s ease;text-shadow:0 1px 2px rgba(0,0,0,.7);padding:2px 10px;border-radius:10px;background:rgba(14,17,17,.35)}
#zen-cap .c.on{opacity:.85}
`;
// colour filters: daltonize (shift what a colour-blind eye loses into channels it keeps), or grey
const SIM = {
  protan: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deutan: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritan: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};
const SHIFT = [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]];
function daltonMatrix(kind) {
  if (kind === 'mono') return [[0.299, 0.587, 0.114], [0.299, 0.587, 0.114], [0.299, 0.587, 0.114]];
  const S = SIM[kind], I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const D = I.map((r, i) => r.map((v, j) => v - S[i][j]));
  const ED = SHIFT.map((r) => [0, 1, 2].map((j) => r.reduce((a, v, k) => a + v * D[k][j], 0)));
  return I.map((r, i) => r.map((v, j) => v + ED[i][j]));
}

export function startGameUI(env) {
  const { P, worlds, renderer, engine, audio } = env;
  const hud = getHud(P);
  const st = document.createElement('style'); st.id = 'zen-style'; st.textContent = ZEN_CSS + MAKER_CSS + MENU_CSS + EXTRA_CSS; document.head.appendChild(st);
  hud.root.classList.add('zen');
  hud.root.style.setProperty('--cairn', `url("data:image/svg+xml,${encodeURIComponent(CAIRN.replace('currentColor', '#efe6d2'))}")`);
  const cap = document.createElement('div'); cap.id = 'zen-cap'; hud.root.appendChild(cap);
  // colour filter defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.style.position = 'absolute';
  defs.innerHTML = ['protan', 'deutan', 'tritan', 'mono'].map((k) => { const m = daltonMatrix(k); return `<filter id="zen-cb-${k}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${m.map((r) => r.map((v) => v.toFixed(4)).join(' ') + ' 0 0').join(' ')} 0 0 0 1 0"/></filter>`; }).join('');
  document.body.appendChild(defs);

  // ---- crosshair
  function applyCrosshair() {
    const H = settings.hud, spec = resolve(H.crosshair, H.customs);
    const off = !H.show.crosshair || (spec.shape === 'none' && !spec.dot);
    hud.setCrosshair(off ? null : svg(spec));
  }
  const xhTab = { id: 'xh', label: 'Focal point', icon: 'eye', render: (b, re) => mountCrosshair(b, re) };
  const open = hud.openPanel;
  hud.openPanel = (list, which) => open(list.some((t) => t.id === 'xh') ? list : [...list, xhTab], which);

  // ---- menu + gamepad
  const extra = {};
  const menu = createMenu({ hud, worlds, env, pad: null, extra });
  const pad = createGamepad({ runAction, menu });
  menu.padRef = pad;
  hooks.pause = () => menu.toggle();
  hooks.menuOpen = () => menu.open;
  hooks.closeMenu = () => menu.close();
  hooks.worldmap = () => (menu.open ? menu.close() : menu.section('map'));
  // two fingers tapping together: rest
  let two = null;
  addEventListener('touchstart', (e) => { if (e.touches.length === 2) two = { t: performance.now(), x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (!two || e.touches.length) { if (!e.touches.length) two = null; return; }
    const ok = performance.now() - two.t < 320; two = null;
    if (ok && settings.controls.touch.twoFingerPause && !hud.dialogOpen) menu.toggle();
  }, { passive: true });

  // ---- apply settings
  let lastWorld = null;
  function applyWorld() {
    const w = worlds.current; if (!w) return;
    const V = settings.video;
    if (w.setAO) w.setAO(V.ao && V.quality !== 'low');
  }
  function apply(path = '*') {
    const all = path === '*';
    const C = settings.controls, V = settings.video, A = settings.audio, H = settings.hud, X = settings.access;
    if (all || path.startsWith('controls')) {
      bindKeys(C.keys);
      lookPrefs.sens = C.sens; lookPrefs.invertY = C.invertY; lookPrefs.touchSens = C.touch.sens;
      lookPrefs.padSens = C.pad.sens; lookPrefs.padInvertY = C.pad.invertY;
      hud.root.classList.toggle('joy-right', C.touch.side === 'right');
      hud.root.style.setProperty('--js', C.touch.joySize);
    }
    if (all || path.startsWith('video') || path.startsWith('access')) {
      view.fov = V.fov;
      engine.renderScale = V.renderScale;
      // quality ladder, frame cap and frame counter live in js/perf (window.__perf)
      if (engine.perf) { engine.perf.setPreset(V.quality); engine.perf.setFpsCap(V.fpsCap); }
      renderer.shadowMap.enabled = !!V.shadows; renderer.shadowMap.needsUpdate = true;
      prefs.bob = V.bob && !X.reduceMotion; // in memory only: the garden's own pref is untouched
      applyWorld();
      env.resize();
    }
    if ((all || path.startsWith('audio')) && audio && audio.setLevels) audio.setLevels({ master: A.master, music: A.music, ambience: A.ambience, effects: A.effects });
    if (all || path.startsWith('hud')) {
      applyCrosshair();
      hud.root.style.setProperty('--hs', H.scale); hud.root.style.setProperty('--ho', H.opacity);
      for (const k of ['prompt', 'toasts', 'buttons', 'saved']) hud.root.classList.toggle('no-' + k, !H.show[k]);
      if (engine.perf) engine.perf.setOverlay(!!H.show.fps || new URLSearchParams(location.search).get('fps') === '1');
    }
    if (all || path.startsWith('access')) {
      hud.root.style.setProperty('--ts', X.textSize);
      document.documentElement.classList.toggle('reduce-motion', !!X.reduceMotion);
      const cv = renderer.domElement; cv.style.filter = X.colorblind && X.colorblind !== 'none' ? `url(#zen-cb-${X.colorblind})` : '';
    }
  }
  apply();
  onChange((p) => apply(p));
  setInterval(() => { if (worlds.currentId !== lastWorld) { lastWorld = worlds.currentId; applyWorld(); } }, 1000);

  // ---- captions for sounds (Access > captions)
  const capSeen = {};
  function caption(text) {
    if (!settings.access.subtitles) return;
    const now = performance.now(); if (capSeen[text] && now - capSeen[text] < 6000) return; capSeen[text] = now;
    const c = document.createElement('div'); c.className = 'c'; c.textContent = text; cap.appendChild(c);
    while (cap.children.length > 3) cap.firstChild.remove();
    requestAnimationFrame(() => c.classList.add('on'));
    setTimeout(() => { c.classList.remove('on'); setTimeout(() => c.remove(), 700); }, 2600);
  }
  const CAPS = { chime: '[wind chimes]', splash: '[a soft splash]', lotus: '[a lotus bell rings]', craneCall: '[a crane calls]', shimmer: '[a quiet shimmer]', chomp: '[koi nibble]' };
  if (audio) for (const [k, t] of Object.entries(CAPS)) if (typeof audio[k] === 'function') { const f = audio[k]; audio[k] = (...a) => { caption(t); return f.apply(audio, a); }; }
  // whispers (the arrival hint and calm toasts) also go to captions when messages are hidden
  const toast = hud.toast;
  hud.toast = (text, ic, ms) => { if (!settings.hud.show.toasts && settings.access.subtitles) caption(String(text)); return toast(text, ic, ms); };

  window.__zenHintOff = () => !settings.hud.show.hint;
  const api = { hud, menu, pad, apply, applyCrosshair, caption, extra, settings };
  if (env.params.has('debug')) window.__gameui = api;
  return api;
}
