// Engine: renderer, input routing, the frame loop, adaptive pixel ratio and world switching.
// Worlds live in js/worlds/ (the home garden is worlds/earth.js) and plug in through the world manager.
import * as THREE from 'three';
import { createAudio } from './audio.js';
import { detectDevice } from './device.js';
import { createWorlds } from './worlds.js';
import { exportSave } from './save.js';

const params = new URLSearchParams(location.search);
const DEBUG = ['hour', 'grow', 'debug'].some((k) => params.has(k));
const P = detectDevice();
document.documentElement.dataset.device = P.cls;
// offline: the service worker precaches the nature bundle for this device's tier at install
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const tier = P.cls === 'pc' ? 'full' : 'lite';
  addEventListener('load', () => navigator.serviceWorker.register(`sw.js?tier=${tier}`).catch(() => {}));
}

const canvas = document.getElementById('garden');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
const maxPR = Math.min(window.devicePixelRatio || 1, P.maxPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false;
renderer.shadowMap.autoUpdate = false;

// shared engine state the worlds can read (size, pixel ratio, fps)
const engine = { width: 1, height: 1, pixelRatio: maxPR, fps: 0, frames: 0 };
function measure() {
  const vv = window.visualViewport;
  engine.width = Math.round(vv ? vv.width : window.innerWidth);
  engine.height = Math.round(vv ? vv.height : window.innerHeight);
}
measure();
renderer.setPixelRatio(engine.pixelRatio);
renderer.setSize(engine.width, engine.height, false);

const audio = createAudio();
const worlds = createWorlds({ renderer, canvas, P, params, DEBUG, audio, engine });
worlds.register('earth', async (ctx) => (await import('./worlds/earth.js')).createEarth(ctx));
// future: worlds.register('moon', async (ctx) => (await import('./worlds/moon.js')).createMoon(ctx));
let world = await worlds.go('earth');
worlds.onSwitch = (w) => { world = w; resize(); };

function resize() {
  measure();
  renderer.setPixelRatio(engine.pixelRatio);
  renderer.setSize(engine.width, engine.height, false);
  canvas.style.width = engine.width + 'px'; canvas.style.height = engine.height + 'px';
  world.resize(engine.width, engine.height, engine.pixelRatio);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---- input: one gentle finger at a time, routed to the active world
let pointerId = null;
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (pointerId !== null) return;
  audio.start();
  pointerId = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  world.input.down(e);
}, { passive: false });
canvas.addEventListener('pointermove', (e) => {
  if (pointerId !== null && e.pointerId === pointerId) e.preventDefault();
  world.input.move(e);
}, { passive: false });
function endPointer(e) {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  world.input.up(e);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('pointerleave', () => world.input.leave && world.input.leave());
for (const ev of ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick', 'selectstart']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => { if (!(e.target.closest && e.target.closest('#hud-panel .body'))) e.preventDefault(); }, { passive: false });
document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// ---- adaptive quality: pixel ratio first, then the world's own heavier effects
let perfAcc = 0, perfN = 0, perfT = 0, upgrades = 0;
const noAdapt = params.has('noadapt');
function adapt(dt) {
  perfAcc += dt; perfN++; perfT += dt;
  if (perfT < 3) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0; perfT = 0;
  if (avg > 1 / 50 && engine.pixelRatio > P.minPR) {
    engine.pixelRatio = Math.max(P.minPR, engine.pixelRatio - 0.25); resize();
  } else if (avg > 1 / 30 && engine.pixelRatio <= P.minPR) {
    world.degrade && world.degrade();
  } else if (avg < 1 / 58 && engine.pixelRatio < maxPR && upgrades < 2) {
    engine.pixelRatio = Math.min(maxPR, engine.pixelRatio + 0.25); upgrades++; resize();
  }
}

// ---- loop
let last = performance.now(), fpsN = 0, fpsT = 0;
const veil = document.getElementById('veil');
function frame(t) {
  const raw = (t - last) / 1000;
  last = t;
  // real time; only big spikes (tab switches, hitches) are tamed so nothing lurches
  const dtMax = world.DT_MAX || 0.25;
  const dt = raw > dtMax ? 1 / 60 : Math.max(0, raw);
  renderer.info.reset();
  world.frame(dt, raw);
  fpsN++; fpsT += raw; if (fpsT > 1) { engine.fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  engine.frames++;
  if (engine.frames === 3) veil.classList.add('gone');
  if (engine.frames > 30 && !noAdapt) adapt(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (DEBUG) {
  window.__garden = new Proxy({ worlds, save: exportSave, tending: world.tending }, {
    get(o, k) { return k in o ? o[k] : world.debug[k]; },
  });
}
