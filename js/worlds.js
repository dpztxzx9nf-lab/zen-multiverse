// World manager: the home world is Xenia, a planet ('planet' with the home seed); the moon base, deep space and
// generated planets register here too. 'earth' (the old separate garden world) is an alias for going home to
// Xenia's hub, so old saves, beacons and callers keep working.
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
    // parallel compile where the driver offers it; otherwise one synchronous compile (still under the veil)
    // compile for the target the world really draws into (the ink view's HDR target: programs differ from
    // the screen's in tone mapping and colour space, and a missing variant leaves ground undrawn for a moment)
    const prevT = renderer.getRenderTarget(); renderer.setRenderTarget(w.compileTarget || prevT);
    let job = null;
    try {
      if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) job = renderer.compileAsync(w.scene, w.camera);
      else renderer.compile(w.scene, w.camera);
    } finally { renderer.setRenderTarget(prevT); }
    if (job) await job;
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
  const nav = save.slice('worlds', () => ({ current: 'planet', visited: ['planet'] }));
  // home = Xenia's hub: the planet world with the home body's seed (arg.hub: a spot in hub metres)
  async function homeArg(arg = {}) {
    const m = await import('./universe/home.js'), h = m.homeBody('earth');
    const a = { ...arg, home: arg.from || 'boot', seed: h.body.seed, star: 0, index: 2, addr: h.addr, dim: 'prime', era: 'present' };
    if (arg.from === 'walk' && Number.isFinite(arg.x)) a.hub = { x: arg.x, z: arg.z, yaw: arg.yaw };
    if (a.from === 'walk') a.from = 'home';
    if (currentId === 'planet') a.from = 'warp'; // already on a planet: re-enter (onEnter puts her at the beacon / the hub)
    return a;
  }
  const mgr = {
    onSwitch: null,
    register(id, factory) { registry.set(id, factory); },
    // attach an already-built world
    adopt(id, world) { live.set(id, world); if (!current) { current = world; currentId = id; } return world; },
    async go(id, arg) {
      if (id === 'earth') return mgr.go('planet', await homeArg(arg || {}));
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
      // the laws of the hand-built home worlds (generated planets set their own on arrival)
      if (id !== 'planet') import('./universe/home.js').then((m) => { const r = m.setHomeRules(id); if (r && w.core) w.core.worldRules = r; }).catch(() => {});
      w.onEnter?.(arg);
      mgr.onSwitch?.(w);
      return w;
    },
    // get a world ready before she reaches it (walking out of the garden or the moon base): build it,
    // compile its shaders and let it load the spot she is heading for, without switching to it
    async prepare(id, arg) {
      if (id === 'earth') return null; // (the old garden world is gone)
      if (id === currentId) return current;
      let w = live.get(id);
      if (!w) { const f = registry.get(id); if (!f) return null; w = await f({ ...shared, save, worlds: mgr }); live.set(id, w); await warm(w, shared.renderer); }
      if (w.prepare) await w.prepare(arg);
      return w;
    },
    update(dt, clock) { current?.update?.(dt, clock); },
    liveWorlds() { return [...live.values()]; },
    get current() { return current; },
    get currentId() { return currentId; },
    // she is at home: on Xenia (any frame); inHub: in the hub frame around the spawn town
    get atHome() { return currentId === 'planet' && !!(current && current.debug && current.debug.W && current.debug.W.xenia); },
    get inHub() { return mgr.atHome && current.debug.W.tile === 'hub'; },
    get ids() { return [...registry.keys(), ...[...live.keys()].filter((k) => !registry.has(k))]; },
  };
  return mgr;
}
