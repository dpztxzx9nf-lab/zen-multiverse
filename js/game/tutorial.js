// First walk: five gentle prompts in a small card, each finishing on its own when she does it.
// Skippable at any time; saved in garden-save (game.tutorial). Saves that already have a garden
// growing skip it quietly.
import { game } from './store.js';
import { interactEvents } from './interact.js';

const pc = () => document.documentElement.dataset.device === 'pc';
const padOn = () => { try { return [...(navigator.getGamepads ? navigator.getGamepads() : [])].some((g) => g && g.connected); } catch (e) { return false; } };
const STEPS = [
  { id: 'look', text: () => (padOn() ? 'The right stick turns your head. Look around.' : pc() ? 'Drag with the mouse to look around.' : 'Swipe with your right thumb to look around.') },
  { id: 'walk', text: () => (padOn() ? 'The left stick walks.' : pc() ? 'W A S D to walk. Shift to hurry.' : 'Your left thumb walks, wherever it lands.') },
  { id: 'focus', text: () => 'Rest the focal point on something close by. It warms when you can tend it.' },
  { id: 'act', text: () => (padOn() ? 'Press A to tend it.' : pc() ? 'Click, or press E, to tend it.' : 'Tap to tend it.') },
  { id: 'rest', text: () => (padOn() ? 'Start rests the world. Settings, the map and the journal live there.' : pc() ? 'Esc rests the world. Settings, the map and the journal live there.' : 'Tap with two fingers to rest. Settings, the map and the journal live there.') },
];
export const TUT_CSS = `
#zen-tut{position:absolute;left:calc(env(safe-area-inset-left,0px) + 18px);top:calc(env(safe-area-inset-top,0px) + 52px);width:min(330px,80vw);padding:14px 16px 12px 18px;pointer-events:auto;transition:opacity .7s ease,transform .7s ease}
#zen-tut.hidden{opacity:0;transform:translateY(-6px);pointer-events:none}
#zen-tut .tt{font-family:var(--serif);font-size:calc(16px * var(--ts,1));line-height:1.4}
#zen-tut .ft{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;opacity:.75}
#zen-tut .dot{width:7px;height:7px;border-radius:50%;background:rgba(239,230,210,.25)}
#zen-tut .dot.on{background:var(--moss)}
#zen-tut .skip{margin-left:auto;cursor:pointer;opacity:.8;text-decoration:underline;text-underline-offset:3px}
html[data-device=pc] #zen-tut{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 24px)}
`;
export function createTutorial({ hud, worlds, menu }) {
  const G = game.data;
  if (!G.tutorial) G.tutorial = (G.beds || []).length || ((G.rocket || {}).parts || []).length ? { step: STEPS.length, done: true, quiet: true } : { step: 0, done: false };
  const el = document.createElement('div'); el.id = 'zen-tut'; el.className = 'glass hidden'; hud.root.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  let base = null, focusT = 0, stepT0 = performance.now(), shownStep = -1;
  function render() {
    const s = STEPS[G.tutorial.step]; if (!s) return;
    el.innerHTML = `<div class="tt">${s.text()}</div><div class="ft">${STEPS.map((_, i) => `<span class="dot ${i <= G.tutorial.step ? 'on' : ''}"></span>`).join('')}<span class="skip" data-skip="1">skip the tips</span></div>`;
    el.querySelector('[data-skip]').addEventListener('pointerdown', (e) => { e.stopPropagation(); finish(true); });
  }
  function next() {
    G.tutorial.step++; base = null; focusT = 0; stepT0 = performance.now(); game.save();
    if (G.tutorial.step >= STEPS.length) finish(false); else { el.classList.add('hidden'); setTimeout(() => { render(); shownStep = G.tutorial.step; el.classList.remove('hidden'); }, 700); }
  }
  function finish(skipped) {
    G.tutorial.done = true; G.tutorial.skipped = !!skipped; G.tutorial.step = STEPS.length; game.save();
    el.classList.add('hidden');
    if (!skipped) setTimeout(() => hud.toast('That is all. The city and the shore will show you the rest.', 'leaf', 5200), 900);
  }
  const iv = setInterval(() => {
    if (G.tutorial.done) { el.classList.add('hidden'); return; }
    const w = worlds.current, md = w && w.mapData ? (() => { try { return w.mapData(); } catch (e) { return null; } })() : null;
    const walking = hud.mode === 'walk' && !hud.panelOpen && !hud.dialogOpen;
    if (!md || !walking) { if (!menu.open || STEPS[G.tutorial.step].id !== 'rest') el.classList.add('hidden'); }
    else if (shownStep !== G.tutorial.step || el.classList.contains('hidden')) { render(); shownStep = G.tutorial.step; el.classList.remove('hidden'); }
    const s = STEPS[G.tutorial.step]; if (!s || !md) return;
    const p = md.player;
    if (!base) base = { x: p.x, z: p.z, yaw: p.yaw, runs: interactEvents.runs, turn: 0, last: p.yaw };
    if (s.id === 'look') { let d = p.yaw - base.last; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; base.turn += Math.abs(d); base.last = p.yaw; if (base.turn > 0.9) next(); }
    else if (s.id === 'walk') { if (Math.hypot(p.x - base.x, p.z - base.z) > 3) next(); }
    else if (s.id === 'focus') { if (hud.el.gaze.classList.contains('on')) { focusT += 0.25; if (focusT > 0.5) next(); } }
    else if (s.id === 'act') { if (interactEvents.runs > base.runs) next(); }
    else if (s.id === 'rest') { if (menu.open) next(); }
  }, 250);
  return {
    get state() { return { ...G.tutorial }; },
    restart() { G.tutorial = { step: 0, done: false }; base = null; shownStep = -1; game.save(); },
    skip: () => finish(true),
    stop: () => clearInterval(iv),
  };
}
