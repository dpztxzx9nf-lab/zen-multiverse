// World manager: the garden is world 'earth'; later worlds (rocket, moon base, deep space) register here.
// A world module exports a factory:
//   async create(ctx) -> { scene, camera?, update(dt, clock), pick?(ray), onEnter?(), onExit?(), dispose?() }
// ctx carries shared services: { renderer, P (device tier), audio, save, tending, worlds }.
// Only one world is active; switching runs onExit/onEnter so a world can fade its sound and light.
import * as save from './save.js';

// Frame pacing: compile every shader (in parallel where KHR_parallel_shader_compile exists) and upload
// every texture before the first frame of a world, so the first look around doesn't stutter.
const ready = (t) => { const d = t.source && t.source.data; return !!d && (d.complete !== false) && (d.width || d.length || (t.mipmaps && t.mipmaps.length)); };
async function warm(w, renderer) {
  if (!renderer || !w || !w.scene || !w.camera) return;
  const t0 = performance.now();
  try {
    if (renderer.compileAsync) await renderer.compileAsync(w.scene, w.camera);
    const seen = new Set();
    w.scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) for (const k in m) { const t = m[k]; if (t && t.isTexture && !t.isRenderTargetTexture && !seen.has(t) && ready(t)) { seen.add(t); try { renderer.initTexture(t); } catch (e) { /* */ } } }
    });
    if (w.scene.environment && w.scene.environment.isTexture && !w.scene.environment.isRenderTargetTexture) renderer.initTexture(w.scene.environment);
  } catch (e) { console.warn('[warm]', e && e.message); }
  w.warmMs = Math.round(performance.now() - t0);
}
export function createWorlds(shared) {
  const registry = new Map();
  const live = new Map();
  let current = null, currentId = null;
  const nav = save.slice('worlds', () => ({ current: 'earth', visited: ['earth'] }));
  const mgr = {
    onSwitch: null,
    register(id, factory) { registry.set(id, factory); },
    // attach an already-built world
    adopt(id, world) { live.set(id, world); if (!current) { current = world; currentId = id; } return world; },
    async go(id, arg) {
      if (id === currentId) { if (arg && arg.from === 'warp') { current?.onExit?.(); current.onEnter?.(arg); } return current; }
      let w = live.get(id);
      if (!w) {
        const f = registry.get(id);
        if (!f) throw new Error(`unknown world ${id}`);
        w = await f({ ...shared, save, worlds: mgr });
        live.set(id, w);
        await warm(w, shared.renderer);
      }
      current?.onExit?.();
      shared.audio && shared.audio.setWorld && shared.audio.setWorld(id);
      current = w; currentId = id;
      nav.current = id; if (!nav.visited.includes(id)) nav.visited.push(id); save.persist();
      w.onEnter?.(arg);
      mgr.onSwitch?.(w);
      return w;
    },
    update(dt, clock) { current?.update?.(dt, clock); },
    liveWorlds() { return [...live.values()]; },
    get current() { return current; },
    get currentId() { return currentId; },
    get ids() { return [...registry.keys(), ...[...live.keys()].filter((k) => !registry.has(k))]; },
  };
  return mgr;
}
