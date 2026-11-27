// Game-only UI layer: crosshair, the zen look, pause menu, settings (applied live), gamepad,
// world map, first-play tutorial and quiet milestones. Started from main.js only when isGameWorld();
// the old garden preview never loads any of it.
import { getHud, hooks, bindKeys, runAction, isLegacyAction } from './session.js';
import { settings, onChange, zen } from './settings.js';
import { createInput } from './input.js';
import { createOverlays, OVERLAY_CSS } from './overlays.js';
import { applyDisplay } from './display.js';
import { svg, resolve } from './crosshair.js';
import { mountCrosshair } from './crosshair-ui.js';
import { MAKER_CSS, ZEN_CSS, CAIRN } from './zen-style.js';
import { createMenu, MENU_CSS } from './menu.js';
import { createGamepad } from './gamepad.js';
import { view, prefs, lookPrefs } from './player.js';
import { renderMap, recordTrail, MAP_CSS } from './worldmap.js';
import { createTutorial, TUT_CSS } from './tutorial.js';
import { createAchievements, ACH_CSS } from './achievements.js';
import { startM4 } from './m4.js';
import { startGunplay } from './gunplay.js';
import { onDevChange } from './dev-mode.js';
import { grantAll } from './skills.js';

const EXTRA_CSS = `
#hud.zen.no-prompt #hud-word,#hud.zen.no-toasts #hud-msg,#hud.zen.no-buttons #hud-top,#hud.zen.no-saved #hud-saved{display:none!important}
#hud.zen #hud-top,#hud.zen #hud-gaze,#hud.zen #hud-msg,#hud.zen #hud-tool,#hud.zen #hud-saved,#hud.zen #hud-joy{filter:opacity(var(--ho,1))}
#hud.zen #hud-top,#hud.zen #hud-panel,#hud.zen #hud-dialog,#hud.zen #zen-menu .zm-card,#hud.zen #zen-cap{zoom:var(--hs,1)}
#hud.zen #zen-menu{font-size:calc(15px * var(--ts,1))}
#hud.zen #hud-panel{font-size:calc(15px * var(--ts,1))}
#hud.zen.joy-right #hud-move{left:auto;right:0}
#hud.zen #hud-joy{transform:scale(var(--js,1))}
#hud.zen{inset:calc(var(--safe,0) * 100vh) calc(var(--safe,0) * 100vw)}
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
  const st = document.createElement('style'); st.id = 'zen-style'; st.textContent = ZEN_CSS + MAKER_CSS + MENU_CSS + MAP_CSS + TUT_CSS + ACH_CSS + EXTRA_CSS + OVERLAY_CSS; document.head.appendChild(st);
  hud.root.classList.add('zen');
  hud.root.style.setProperty('--cairn', `url("data:image/svg+xml,${encodeURIComponent(CAIRN.replace('currentColor', '#efe6d2'))}")`);
  const cap = document.createElement('div'); cap.id = 'zen-cap'; hud.root.appendChild(cap);
  // colour filter defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.style.position = 'absolute';
  defs.innerHTML = ['protan', 'deutan', 'tritan', 'mono'].map((k) => { const m = daltonMatrix(k); return `<filter id="zen-cb-${k}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${m.map((r) => r.map((v) => v.toFixed(4)).join(' ') + ' 0 0').join(' ')} 0 0 0 1 0"/></filter>`; }).join('');
  defs.innerHTML += '<filter id="zen-gamma" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="gamma" exponent="1"/><feFuncG type="gamma" exponent="1"/><feFuncB type="gamma" exponent="1"/></feComponentTransfer></filter>';
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
  const whereNow = () => { try { return worlds.current && worlds.current.where && worlds.current.where(); } catch (e) { return null; } };
  const extra = { map: (b) => renderMap(b, worlds.current, whereNow()) };
  // remember where she walks (per world) for the map
  setInterval(() => recordTrail(whereNow()), 2000);
  const menu = createMenu({ hud, worlds, env, pad: null, extra });
  const input = createInput({ runAction, isLegacy: isLegacyAction, menuOpen: () => menu.open });
  const pad = createGamepad({ runAction, menu, onAction: (a, down, src) => input.action(a, down, src) });
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
    if (ok && settings.touch.twoFingerPause && !hud.dialogOpen) menu.toggle();
  }, { passive: true });

  // ---- apply settings (everything reads the one settings object; other systems use zen.*)
  const overlays = createOverlays({ hud, engine, renderer, worlds, whereNow, audio });
  let lastWorld = null;
  const SHADOW_K = { low: 0.5, high: 1, ultra: 2 };
  const ANISO = { low: 1, medium: 4, high: 16 };
  function applyWorld() {
    const w = worlds.current; if (!w) return;
    const V = settings.video;
    if (w.setAO) w.setAO(V.ao);
    if (w.setBloom) w.setBloom(V.bloom);
    if (w.setAA) Promise.resolve(w.setAA(V.aa)).catch((e) => console.warn('[aa]', e));
    if (w.qualityCap) w.qualityCap(1.25 * V.viewDist);
    overlays.applyGrain();
    // shadow-map size and texture filtering: walk the scene once per change
    const sc = w.scene; if (!sc || !sc.traverse) return;
    const maxA = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1, an = Math.min(maxA, ANISO[V.textures] || 4);
    const sk = SHADOW_K[V.shadows] || 1;
    // the worlds' suns are sized by the quality governor (js/perf/governor.js) times this setting
    if (engine.userShadowK !== sk) { engine.userShadowK = sk; if (engine.perf && engine.perf.reapply) engine.perf.reapply(); }
    sc.traverse((o) => {
      if (o.isLight && o.castShadow && o.shadow && !o.userData.govShadow) {
        const base = (o.userData.zenShadow = o.userData.zenShadow || o.shadow.mapSize.x);
        const sz = Math.max(256, Math.min(8192, Math.round(base * sk)));
        if (o.shadow.mapSize.x !== sz) { o.shadow.mapSize.set(sz, sz); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } }
      }
      const m = o.material; if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) { const t = mm[k]; if (t && t.isTexture && t.anisotropy !== an) { t.anisotropy = an; t.needsUpdate = true; } }
    });
  }
  const aspect = () => Math.max(0.3, innerWidth / Math.max(1, innerHeight));
  function applyFov() { view.fov = zen.fovV(aspect()); }
  addEventListener('resize', applyFov);
  function applyLook() {
    const M = settings.mouse, k = (zen.aiming ? M.ads : 1) / 0.4;
    lookPrefs.sens = (M.xy ? M.sensX : M.sens) * k; lookPrefs.invertY = M.invertY; // drag-to-look (pointer not locked)
    lookPrefs.touchSens = settings.touch.sens;
  }
  zen.onAction(({ action }) => { if (action === 'use2') applyLook(); });
  let lastDisplay = null;
  function applyFilters() {
    const V = settings.video, X = settings.access, f = [];
    if (X.colorblind && X.colorblind !== 'none') f.push(`url(#zen-cb-${X.colorblind})`);
    if (Math.abs(V.gamma - 1) > 0.005) { defs.querySelectorAll('#zen-gamma feFuncR,#zen-gamma feFuncG,#zen-gamma feFuncB').forEach((n) => n.setAttribute('exponent', (1 / V.gamma).toFixed(3))); f.push('url(#zen-gamma)'); }
    if (Math.abs(V.brightness - 1) > 0.005) f.push(`brightness(${V.brightness})`);
    renderer.domElement.style.filter = f.join(' ');
  }
  function apply(path = '*') {
    const all = path === '*', is = (s) => all || path === s || path.startsWith(s + '.');
    const V = settings.video, A = settings.audio, H = settings.hud, X = settings.access, T = settings.touch;
    if (is('keys')) bindKeys(settings.keys);
    if (is('mouse') || is('touch')) applyLook();
    if (is('touch')) { hud.root.classList.toggle('joy-right', T.side === 'right'); hud.root.style.setProperty('--js', T.joySize); }
    if (is('pad')) lookPrefs.padInvertY = settings.pad.invertY;
    if (is('video') || is('camera') || is('access')) {
      applyFov();
      const scaleChanged = engine.renderScale !== V.renderScale;
      engine.renderScale = V.renderScale;
      engine.fpsCap = V.fpsCap || 0;
      const sh = V.shadows !== 'off'; if (renderer.shadowMap.enabled !== sh) { renderer.shadowMap.enabled = sh; renderer.shadowMap.needsUpdate = true; }
      prefs.bob = zen.bob(); // in memory only: the garden's own pref is untouched
      if (all || /^video\.(preset|shadows|textures|aa|ao|bloom|viewDist|filmGrain)/.test(path) || path === 'video') applyWorld();
      if (scaleChanged) env.resize();
      const d = V.display + '|' + V.resolution;
      if (lastDisplay !== null && d !== lastDisplay) applyDisplay(V.display, V.resolution);
      lastDisplay = d;
      applyFilters();
    }
    if (is('audio') && audio && audio.setLevels) audio.setLevels({ master: A.master, music: A.music, ambience: A.ambience, effects: A.effects, voice: A.voice == null ? 1 : A.voice });
    if (is('audio')) applySink();
    if (is('hud')) {
      applyCrosshair();
      hud.root.style.setProperty('--hs', H.scale); hud.root.style.setProperty('--ho', H.opacity); hud.root.style.setProperty('--safe', H.safe || 0);
      for (const k of ['prompt', 'toasts', 'buttons', 'saved']) hud.root.classList.toggle('no-' + k, !H.show[k]);
      overlays.drawMini();
    }
    if (is('access')) {
      hud.root.style.setProperty('--ts', X.textSize);
      document.documentElement.classList.toggle('reduce-motion', !!X.reduceMotion);
    }
  }
  // output device (Chrome / WebView2: AudioContext.setSinkId)
  let sinkNow = 'default';
  function applySink() {
    const id = settings.audio.device || 'default'; if (id === sinkNow) return;
    const r = audio && audio.raw ? audio.raw() : null, ctx = r && r.ctx;
    if (!ctx || !ctx.setSinkId) return;
    ctx.setSinkId(id === 'default' ? '' : id).then(() => { sinkNow = id; }).catch((e) => console.warn('[audio] output device', e));
  }
  // mute while another window is in front
  let mutedByFocus = false;
  const focusMute = (away) => {
    if (!audio || !audio.setMuted) return;
    if (away && settings.audio.muteUnfocused && !mutedByFocus) { mutedByFocus = true; audio.setMuted(true); }
    else if (!away && mutedByFocus) { mutedByFocus = false; audio.setMuted(false); applySink(); }
  };
  addEventListener('blur', () => focusMute(true));
  addEventListener('focus', () => focusMute(false));
  document.addEventListener('visibilitychange', () => focusMute(document.hidden));
  apply();
  // a saved display mode is applied on start (desktop app: fullscreen / borderless come back)
  if (settings.video.display !== 'windowed' && window.__TAURI_INTERNALS__) applyDisplay(settings.video.display, settings.video.resolution);
  onChange((p) => apply(p));
  setInterval(() => { if (worlds.currentId !== lastWorld) { lastWorld = worlds.currentId; applyWorld(); applySink(); } }, 1000);

  // ---- captions for sounds (Access > captions)
  const capSeen = {};
  function caption(text) {
    if (!settings.audio.subtitles) return;
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
  hud.toast = (text, ic, ms) => { if (!settings.hud.show.toasts && settings.audio.subtitles) caption(String(text)); return toast(text, ic, ms); };

  window.__zenHintOff = () => !settings.hud.show.hint;
  const tutorial = createTutorial({ hud, worlds, menu });
  const ach = createAchievements({ hud, audio });
  extra.milestones = (b) => ach.render(b);
  extra.tutorial = tutorial;
  startGunplay();
  const m4 = startM4({
    getCamera: () => worlds.current && worlds.current.camera,
    getScene: () => worlds.current && worlds.current.scene,
    getPlayer: () => {
      const d = worlds.current && worlds.current.debug;
      return d && (d.player || (d.game && d.game.player) || (d.core && d.core.player));
    },
  });
  onDevChange(({ on }) => { if (on) grantAll(); });

  const api = { tutorial, ach, hud, menu, pad, input, overlays, apply, applyCrosshair, caption, extra, settings, zen, m4 };
  if (env.params.has('debug')) window.__gameui = api;
  return api;
}
