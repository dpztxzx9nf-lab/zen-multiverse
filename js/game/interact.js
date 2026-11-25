// Proximity interactions: things register { id, at() -> {x,y,z}, r, actions() -> [{ label, icon, run }] }.
// Each frame the nearest one she is close to (and roughly facing) offers up to two actions:
// E / the big right-thumb button runs the first, R / the small button the second.
export function createInteractor({ hud, player }) {
  const list = new Map();
  let current = null, acts = [];
  let busy = false;
  const api = {
    add(it) { list.set(it.id, it); return () => list.delete(it.id); },
    remove(id) { list.delete(id); },
    get current() { return current; },
    update() {
      if (hud.panelOpen || hud.dialogOpen || hud.mode !== 'walk') { hud.setPrompt(null); current = null; return; }
      const p = player.position;
      let best = null, bs = Infinity;
      for (const it of list.values()) {
        if (it.enabled && !it.enabled()) continue;
        const a = it.at();
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d > (it.r || 1.6)) continue;
        if (it.maxDy != null && Math.abs((a.y || 0) - p.y) > it.maxDy) continue;
        const face = player.facingDot(a);
        const score = d - face * 0.6 - (it.priority || 0);
        if (score < bs) { bs = score; best = it; }
      }
      current = best;
      acts = best && !busy ? best.actions().filter(Boolean).slice(0, 2) : [];
      hud.setPrompt(acts[0] || null, acts[1] || null);
    },
    async run(i = 0) {
      if (busy || player.busy || !acts[i]) return;
      busy = true; hud.setPrompt(null);
      try { await acts[i].run(); } catch (e) { console.warn('[G] action failed', e); }
      busy = false;
    },
  };
  return api;
}
