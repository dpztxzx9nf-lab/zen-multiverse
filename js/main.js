// Engine: renderer, input routing, the frame loop, adaptive pixel ratio and world switching.
// Worlds live in js/worlds/ (the home garden is worlds/earth.js) and plug in through the world manager.
import { surface } from './haptics.js';
import { initKtx2 } from './ktx2.js';
import * as THREE from 'three';
import { tickLook } from './look.js'; // Raked Light: the shared tonemap + stylized lighting (before any shader compiles)
import { createAudio } from './audio.js';
import { detectDevice } from './device.js';
import { createWorlds } from './worlds.js';
import { exportSave } from './save.js';
import { installErrorLog, logError } from './perf/errlog.js';
import { createPerf } from './perf/perf.js';
import { createGovernor } from './perf/governor.js';
import { createOverlay } from './perf/overlay.js';
installErrorLog();

const params = new URLSearchParams(location.search);
const DEBUG = ['hour', 'grow', 'debug'].some((k) => params.has(k));
const P = detectDevice();
document.documentElement.dataset.device = P.cls;
// Desktop (Tauri) already has a local copy of the files, so skip the service worker there.
function runningInTauri() {
  try {
    if (window.__TAURI_INTERNALS__ || window.__TAURI__) return true;
    const protocol = location.protocol;
    const host = location.hostname;
    if (protocol === 'tauri:' || protocol === 'asset:') return true;
    if (host === 'tauri.localhost' || host.endsWith('.tauri.localhost')) return true;
  } catch (_) {}
  return false;
}
// offline: the service worker precaches the nature bundle for this device's tier at install
if ('serviceWorker' in navigator && location.protocol === 'https:' && !runningInTauri()) {
  const tier = P.cls === 'pc' ? 'full' : 'lite';
  addEventListener('load', () => navigator.serviceWorker.register(`sw.js?tier=${tier}`).catch(() => {}));
}
// desktop app: quiet auto-update with one calm restart prompt
if (runningInTauri()) import('./updater.js').then((m) => m.startUpdater()).catch(() => {});

const canvas = document.getElementById('garden');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
const maxPR = Math.min(window.devicePixelRatio || 1, P.maxPR);
initKtx2(renderer);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
renderer.shadowMap.autoUpdate = false;

// shared engine state the worlds can read (size, pixel ratio, fps)
const engine = { width: 1, height: 1, pixelRatio: maxPR, fps: 0, frames: 0, renderScale: 1, fpsCap: 0 };
function measure() {
  const vv = window.visualViewport;
  engine.width = Math.round(vv ? vv.width : window.innerWidth);
  engine.height = Math.round(vv ? vv.height : window.innerHeight);
}
measure();
renderer.setPixelRatio(engine.pixelRatio * (engine.renderScale || 1));
renderer.setSize(engine.width, engine.height, false);

const audio = createAudio({ P });
const worlds = createWorlds({ renderer, canvas, P, params, DEBUG, audio, engine });
worlds.register('space', async (ctx) => (await import('./worlds/space.js')).createSpace(ctx));
worlds.register('moon', async (ctx) => (await import('./worlds/moon.js')).createMoon(ctx));
worlds.register('planet', async (ctx) => (await import('./worlds/planet.js')).createPlanet(ctx));
let world = await worlds.go('earth'); // home: Xenia's hub (js/worlds.js)
// debug: ?world=moon | ?world=planet&seed=123 | ?world=space (the flight)
{
  const w = params.get('world');
  if (w === 'moon' || w === 'planet' || w === 'space') {
    const seed = params.get('seed');
    world = await worlds.go(w, { from: 'debug', to: params.get('to') || 'moon', seed: seed != null ? +seed : undefined, seek: params.has('seek') ? +params.get('seek') : undefined, dim: params.get('dim') || undefined });
  }
}
worlds.onSwitch = (w) => { world = w; if (Q && w.applyQuality) w.applyQuality(Q); gov.settle(4); resize(); };
// the game saves itself (position, every 30 s, on hide/close) and resumes where she was
import('./game/flags.js').then(({ isGameWorld }) => {
  if (!isGameWorld()) return;
  import('./game/gameui.js').then((m) => m.startGameUI({ worlds, P, params, audio, engine, renderer, resize: () => resize() })).catch((e) => console.warn('[gameui]', e));
  return import('./game/autosave.js').then((m) => m.startAutosave({ worlds, P, params }));
}).catch((e) => console.warn('[autosave]', e));
// multiplayer: friends, chat, invites, shared worlds. Always started; if the server URL is unset or
// unreachable the client keeps playing offline solo instead of sitting on Reconnecting.
import('./net.js').then((m) => m.startNet({ worlds, params, engine })).catch((e) => console.warn('[net]', e));
// the Wardens and the Reavers: people who remember what you did (js/factions; the server decides when online)
import('./factions/client.js').then((m) => m.startFactions({ worlds, params })).catch((e) => console.warn('[factions]', e));

function resize() {
  measure();
  renderer.setPixelRatio(engine.pixelRatio * (engine.renderScale || 1));
  renderer.setSize(engine.width, engine.height, false);
  canvas.style.width = engine.width + 'px'; canvas.style.height = engine.height + 'px';
  world.resize(engine.width, engine.height, engine.pixelRatio);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---- input: one gentle finger at a time, routed to the active world
// on iPhone the pointer lands on an invisible native switch over the canvas (haptics.js)
const inputEl = surface(canvas);
let pointerId = null;
function unlockAudio() { audio.start(); }
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, unlockAudio, { capture: true });
inputEl.addEventListener('pointerdown', (e) => {
  if (inputEl === canvas) e.preventDefault(); // the switch needs its click (touch-action:none covers gestures)
  if (pointerId !== null) return;
  audio.start();
  pointerId = e.pointerId;
  try { inputEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  world.input.down(e);
}, { passive: false });
inputEl.addEventListener('pointermove', (e) => {
  if (pointerId !== null && e.pointerId === pointerId) e.preventDefault();
  world.input.move(e);
}, { passive: false });
function endPointer(e) {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  world.input.up(e);
}
inputEl.addEventListener('pointerup', endPointer);
inputEl.addEventListener('pointercancel', endPointer);
inputEl.addEventListener('lostpointercapture', endPointer);
inputEl.addEventListener('pointerleave', () => world.input.leave && world.input.leave());
for (const ev of ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick', 'selectstart']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (!(e.target.closest && e.target.closest('#hud-panel .body'))) e.preventDefault(); }, { passive: false });
document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// ---- performance: profiler, adaptive quality governor, frame pacing, throttling, memory watch
// (js/perf/). The settings menu talks to window.__perf: setPreset('auto'|'low'|'medium'|'high'|'ultra'),
// setFpsCap('smart'|0|30..240), setOverlay(bool). ?fps=1 shows the counter, ?prof=1 adds GPU time per pass.
const perf = createPerf({ renderer, params });
window.addEventListener('resize', () => perf.recalibrate());
const prFloor = P.cls === 'pc' ? Math.max(0.5, 0.6 * maxPR) : P.minPR;
let Q = null;
function applyQuality(q) {
  Q = q;
  const pr = Math.max(prFloor, Math.min(maxPR, maxPR * q.pr));
  if (Math.abs(pr - engine.pixelRatio) > 0.01) { engine.pixelRatio = pr; if (world) resize(); }
  for (const w of worlds.liveWorlds()) if (w.applyQuality) { try { w.applyQuality(q); } catch (e) { logError('quality', e.message); } }
}
// the ladder starts at the tier's own look; ?q-level=N pins a rung for tests
const gov = createGovernor({ perf, params, onApply: applyQuality, start: 0 });
if (params.has('qlevel')) gov.setPreset(['ultra', null, 'high', null, 'medium', null, null, null, 'low'][+params.get('qlevel')] || 'auto');
const overlay = createOverlay(perf, () => ({ goal: gov.goal, cap: capLabel(), throttle, pr: engine.pixelRatio, preset: gov.preset, level: gov.level, cpuBound: gov.cpuBound }));
if (params.get('fps') === '1' || params.has('prof')) overlay.set(true);

// Frame cap. 'smart' (default): the display's full rate while she is moving or touching, 60 once the
// view has been still for a few seconds, 30 when the window is in the background, nothing at all when
// hidden or minimised. 0 = uncapped (every vsync). A number caps at that rate.
let fpsCap = engine.fpsCap || 'smart';
// the settings menu writes engine.fpsCap ('smart', 0 = unlimited, or a rate); it lands here
Object.defineProperty(engine, 'fpsCap', { get: () => fpsCap, set: (c) => { fpsCap = c === 'smart' || c == null || c === '' ? 'smart' : Math.max(0, +c || 0); } });
const capLabel = () => (fpsCap === 'smart' ? 'smart' : fpsCap ? String(fpsCap) : '');
let lastInput = performance.now(), focused = true, minimized = false, throttle = '';
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true });
addEventListener('blur', () => { focused = false; }); addEventListener('focus', () => { focused = true; minimized = false; });
let padT = 0;
function padActive() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) { if (!g) continue; for (const a of g.axes) if (Math.abs(a) > 0.2) return true; for (const b of g.buttons) if (b.pressed) return true; }
  return false;
}
// Tauri: a minimised window keeps firing rAF in WebView2; ask the window while unfocused
const tauriInvoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
if (tauriInvoke) setInterval(() => { if (!focused) tauriInvoke('plugin:window|is_minimized', { label: 'main' }).then((m) => { minimized = !!m; }).catch(() => {}); }, 1000);
let lastDraw = 0, last = performance.now(), fpsN = 0, fpsT = 0, lost = false, memT = 0;
function effectiveCap(t, refresh) {
  if (document.hidden || minimized) { throttle = 'paused'; return -1; }
  if (!focused && !params.has('nothrottle')) { throttle = 'background'; return 30; }
  throttle = '';
  if (fpsCap === 'smart') {
    if ((padT += 1) > 30) { padT = 0; if (padActive()) lastInput = t; }
    const moving = t - lastInput < 4000 || (world && world.moving);
    if (!moving && !params.has('nothrottle')) { throttle = 'still'; return Math.min(60, refresh); }
    return 0;
  }
  return fpsCap || 0;
}

// ---- loop
const veil = document.getElementById('veil');
function frame(t) {
  requestAnimationFrame(frame);
  if (lost) return;
  if (perf.calibrating && !document.hidden) { perf.calibSample(t - last); last = t; return; } // a few bare vsyncs: the display rate
  const refresh = perf.refresh();
  const cap = effectiveCap(t, refresh);
  if (cap < 0) { last = t; return; } // hidden / minimised: draw nothing
  // cap below the display rate: draw on an even cadence of vsyncs (240 -> 60 is every 4th)
  if (cap && cap < refresh * 0.97) {
    const iv = 1000 / cap, slack = 500 / refresh;
    if (t - lastDraw < iv - slack) return;
    lastDraw = t - lastDraw > iv * 2 ? t : lastDraw + iv;
  } else lastDraw = t;
  const raw = (t - last) / 1000;
  last = t;
  // real time; only big spikes (tab switches, hitches) are tamed so nothing lurches
  const dtMax = world.DT_MAX || 0.25;
  // multiplayer lost its connection: hold the world still (calm "Reconnecting…" card from net.js)
  if (engine.hold) { requestAnimationFrame(frame); return; }
  const dt = raw > dtMax ? 1 / 60 : Math.max(0, raw);
  renderer.info.reset();
  perf.frameStart(raw * 1000);
  tickLook(dt);
  world.frame(dt, raw);
  perf.frameEnd();
  fpsN++; fpsT += raw; if (fpsT > 1) { engine.fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  engine.frames++;
  if (engine.frames === 3) veil.classList.add('gone');
  // the governor steers by the active-play goal; throttled stretches (still / background) don't count
  const goal = fpsCap && fpsCap !== 'smart' ? Math.min(fpsCap, refresh) : refresh;
  if (engine.frames > 30 && !throttle) gov.update(raw, goal);
  if ((memT += raw) > 10) { memT = 0; memWatch(); }
}
requestAnimationFrame(frame);

// ---- memory watch: renderer.info.memory + JS heap every 10 s. A count that keeps climbing while she
// stays in one world is a leak; it is logged once per world visit (and shown in ?fps=1).
let memBase = null, memWarned = false;
function memWatch() {
  const s = perf.memSample();
  if (!memBase || memBase.world !== worlds.currentId) { memBase = { world: worlds.currentId, geo: s.geo, tex: s.tex, heap: s.heap, t: s.t }; memWarned = false; return; }
  if (s.t - memBase.t < 60 || memWarned) return;
  const grow = (a, b) => a > b * 1.5 + 40;
  if (grow(s.geo, memBase.geo) || grow(s.tex, memBase.tex) || (s.heap && memBase.heap && s.heap > memBase.heap * 2 + 150)) {
    memWarned = true; logError('memory', `growth in ${memBase.world}: geo ${memBase.geo}->${s.geo} tex ${memBase.tex}->${s.tex} heap ${memBase.heap}->${s.heap}MB over ${s.t - memBase.t}s`);
  }
}

// ---- WebGL context loss: keep the page, wait for the browser to give the GPU back, then rebuild
// the few things that lived only on the GPU (baked env maps, impostor atlases) and carry on.
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; veil.classList.remove('gone'); logError('gpu', 'WebGL context lost'); }, false);
canvas.addEventListener('webglcontextrestored', () => {
  for (const w of worlds.liveWorlds()) { try { w.onContextRestored && w.onContextRestored(); } catch (e) { logError('gpu', 'restore: ' + e.message); } }
  renderer.shadowMap.needsUpdate = true;
  resize(); gov.settle(3);
  lost = false; last = performance.now(); setTimeout(() => veil.classList.add('gone'), 120);
  logError('gpu', 'WebGL context restored');
}, false);

window.__perf = {
  setPreset: (p) => gov.setPreset(p), get preset() { return gov.preset; }, get level() { return gov.level; },
  setFpsCap: (c) => { engine.fpsCap = c; }, reapply: () => gov.reapply(),
  get fpsCap() { return fpsCap; },
  setOverlay: (on) => overlay.set(!!on), get overlay() { return overlay.on; },
  snapshot: () => ({ ...perf.snapshot(), level: gov.level, preset: gov.preset, goal: gov.goal, pr: engine.pixelRatio, throttle, cap: capLabel(), history: gov.history.slice(-10), Q }),
  memory: () => perf.S.mem.slice(),
  perf, gov,
};
engine.perf = window.__perf;

if (DEBUG) {
  window.__garden = new Proxy({ worlds, save: exportSave, tending: world.tending, renderer, audio }, {
    get(o, k) { return k in o ? o[k] : world.debug[k]; },
  });
}
