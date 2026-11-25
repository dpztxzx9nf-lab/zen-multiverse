// Tending actions as an extensible system.
// Each action handles one kind of touched thing (from the world's raycast pick):
//   tending.register('bonsai', { start(hit, ctx), move?(hit, ctx), end?(ctx), cooldown?: seconds })
// The world's pick() returns { kind, ... }; dispatch() runs the matching action.
// New tending (planting, pruning, harvesting) = a new pick target + register('plant-bed', {...}).
// Every completed action can be logged into the save object via log(), so growth systems can read history.
import { slice, persist } from './save.js';

export function createTending({ world = 'earth' } = {}) {
  const actions = new Map();
  const last = new Map();
  const history = slice(`${world}.tending`, () => ({ log: [] }));
  if (!Array.isArray(history.log)) history.log = [];
  return {
    register(kind, action) { actions.set(kind, action); return () => actions.delete(kind); },
    has(kind) { return actions.has(kind); },
    dispatch(hit, ctx) {
      const a = hit && actions.get(hit.kind);
      if (!a || !a.start) return false;
      const t = ctx.clock ?? 0;
      if (a.cooldown && t - (last.get(hit.kind) ?? -1e9) < a.cooldown) return false;
      last.set(hit.kind, t);
      a.start(hit, ctx);
      return true;
    },
    // small rolling record: { k: kind, t: epoch ms, d?: extra }
    log(kind, d) {
      history.log.push(d === undefined ? { k: kind, t: Date.now() } : { k: kind, t: Date.now(), d });
      if (history.log.length > 400) history.log.splice(0, history.log.length - 400);
      persist();
    },
    get history() { return history.log; },
  };
}
