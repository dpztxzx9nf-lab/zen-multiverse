// Auto-save for the game (never runs for mom's preview garden).
// Everything already lives in the one 'garden-save' (garden, bag, rocket, moon base, fleet,
// journal, visited worlds); this adds where she is standing, and makes sure it is written:
//   - debounced after every change (game.add/take/pay/unlock/save -> persist)
//   - a full save every 30 s (with her position)
//   - at once on visibilitychange (hidden) / pagehide, and before the Tauri window closes
// On load she is put back on the world she was on, where she stood.
// It also whispers the next calm step ("what now?") on arriving somewhere, once per change.
import * as save from '../save.js';
import { game } from './store.js';
import { nextStep } from './progress.js';
import { getHud } from './session.js';

export async function startAutosave({ worlds, P, params }) {
  const G = game.data;
  const hud = getHud(P);
  let hold = false; // tests: keep a hand-set position through a reload
  function capture() {
    if (hold) return;
    try { const w = worlds.current && worlds.current.where && worlds.current.where(); if (w) { G.where = { ...w, t: Date.now() }; } } catch (e) { /* */ }
  }
  const saveNow = () => { capture(); save.flushNow(); };
  setInterval(saveNow, 30e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', saveNow);
  if (window.__gardenFlush) { const f = window.__gardenFlush; window.__gardenFlush = () => { capture(); return f(); }; }
  // a meaningful action: write soon (the store already debounces at 200 ms; this adds her position)
  game.on(() => { capture(); save.persist(800); });

  // resume where she was (not when a test URL picks the world)
  const w = G.where;
  const st = { where: w, step: 'start' };
  if (params.has('debug')) window.__autosave = Object.assign(st, { setWhere(x) { hold = true; G.where = x; save.flushNow(); }, nextStep });
  const pinned = params.has('world') || params.has('beds') || params.has('noresume');
  if (w && !pinned) {
    try {
      if (w.world === 'planet' && w.seed != null) await worlds.go('planet', { from: 'resume', seed: w.seed, dim: w.dim, star: w.star, index: w.index });
      else if (w.world === 'moon' && game.unlocked('moon')) await worlds.go('moon', { from: 'resume' });
      const cur = worlds.current; st.step = 'went:' + worlds.currentId;
      if (cur && cur.restoreWhere && worlds.currentId === w.world) setTimeout(() => { cur.restoreWhere(w); st.step = 'restored'; }, 60);
    } catch (e) { st.step = 'error:' + e; console.warn('[autosave] resume', e); }
  }

  // the gentle "what next" whisper: on arriving in a world, if the suggestion is new
  let lastId = null, lastKey = G.hint || null;
  setInterval(() => {
    const id = worlds.currentId;
    if (id === lastId || id === 'space') return;
    lastId = id;
    setTimeout(() => {
      if (worlds.currentId !== id || hud.panelOpen || hud.dialogOpen) return;
      let n; try { n = nextStep(); } catch (e) { return; }
      if (!n || n.key === lastKey) return;
      if (G && window.__zenHintOff && window.__zenHintOff()) return;
      lastKey = G.hint = n.key; save.persist(1000);
      hud.toast(n.text, 'leaf', 5600);
    }, 11000);
  }, 1000);
  return { saveNow, capture };
}
