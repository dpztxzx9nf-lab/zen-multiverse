import { tick } from '../haptics.js';
// Gaze interactions: things register { id, at() -> {x,y,z}, r, gazeR?, gazeH?, actions() -> [{ label, icon, run }] }.
// Each frame the thing her gaze rests on (within reach) offers up to two actions: a tap/click
// on the world or E runs the first, R (or the small second word) the second.
const THREE_clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function createInteractor({ hud, player }) {
  const list = new Map();
  let current = null, acts = [];
  let busy = false;
  const api = {
    add(it) { list.set(it.id, it); return () => list.delete(it.id); },
    remove(id) { list.delete(id); },
    get current() { return current; }, get labels() { return acts.map((a) => a.label); },
    update() {
      if (hud.panelOpen || hud.dialogOpen || hud.mode !== 'walk') { hud.setPrompt(null); current = null; return; }
      const p = player.position;
      let best = null, bs = Infinity;
      for (const it of list.values()) {
        if (it.enabled && !it.enabled()) continue;
        const a = it.at();
        const r = it.r || 1.6;
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d > r + 1.2) continue;
        if (it.maxDy != null && Math.abs((a.y || 0) - p.y) > it.maxDy) continue;
        let score;
        if (player.gazeHit) {
          // first person: it has to be where she is looking (a soft cylinder around the thing)
          const gr = (it.gazeR || THREE_clamp(r * 0.42, 0.32, 2.4)) * (it === current ? 1.3 : 1);
          const t = player.gazeHit(a, gr, it.gazeH || 0.9, r + 0.8);
          if (t == null) { if (d < 0.75 && player.facingDot(a) > 0.6) score = 2 + d; else continue; } else score = t * 0.25;
        } else score = d - player.facingDot(a) * 0.6;
        score -= (it.priority || 0) * 0.5;
        if (score < bs) { bs = score; best = it; }
      }
      current = best;
      acts = best && !busy ? best.actions().filter(Boolean).slice(0, 2) : [];
      hud.setPrompt(acts[0] || null, acts[1] || null);
    },
    async run(i = 0) {
      if (busy || player.busy || !acts[i]) return;
      busy = true; hud.setPrompt(null);
      tick();
      try { await acts[i].run(); } catch (e) { console.warn('[G] action failed', e); }
      busy = false;
    },
  };
  return api;
}

// Pointer look for first person: drag turns the head; a short, still press is a tap that acts.
// The left-half joystick lives in the HUD, so these pointers are the right hand (or the mouse).
export function lookInput({ player, look = () => true, tap = () => {} }) {
  let drag = null;
  return {
    down(e) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0 }; },
    move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      const s = (e.pointerType === 'mouse' ? 2.6 : 3.4) / Math.max(innerWidth, innerHeight);
      if (look()) player.look(dx * s, dy * s * 0.85);
      drag.x = e.clientX; drag.y = e.clientY;
    },
    up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const quick = performance.now() - drag.t0 < 380 && drag.moved < 10;
      drag = null;
      if (quick && (e.button == null || e.button === 0)) tap(e);
    },
    leave() { drag = null; },
  };
}
