// World manager: the garden is world 'earth'; later worlds (rocket, moon base, deep space) register here.
// A world module exports a factory:
//   async create(ctx) -> { scene, camera?, update(dt, clock), pick?(ray), onEnter?(), onExit?(), dispose?() }
// ctx carries shared services: { renderer, P (device tier), audio, save, tending, worlds }.
// Only one world is active; switching runs onExit/onEnter so a world can fade its sound and light.
import * as save from './save.js';

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
    get current() { return current; },
    get currentId() { return currentId; },
    get ids() { return [...registry.keys(), ...[...live.keys()].filter((k) => !registry.has(k))]; },
  };
  return mgr;
}
