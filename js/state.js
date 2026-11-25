// Garden state saved on the device, plus a clean hook for a future shared sync.
//
// Local (this device):   finds collected, breath sessions, last visit.
// Shared (merged in):    gifts  - things Brock sends that appear in the garden
//                                 { id, type: 'flower' | 'lantern', seed?, at? (ISO date) }
//                        visits - signs that someone visited
//                                 { id, type: 'rake' | 'lantern-lit', seed?, at? }
// A later sync step only needs to call  garden.mergeShared({ gifts: [...], visits: [...] })
// (e.g. after fetching a small JSON document); items are merged by id and applied once.
// The bonsai keeps its own growth record (key 'zen-garden-bonsai-v1').
import { slice, replaceSlice, persist } from './save.js';
const KEY = 'zen-garden-state-v1'; // legacy key, migrated into the shared save object (slice 'garden')

const fresh = () => ({ v: 1, firstVisit: Date.now(), lastVisit: 0, finds: [], breaths: 0, shared: { gifts: [], visits: [] }, applied: [] });

export function createState() {
  let s = slice('garden', fresh, KEY);
  if (!s || s.v !== 1) s = replaceSlice('garden', fresh());
  s.shared = s.shared || { gifts: [], visits: [] };
  s.applied = s.applied || [];
  const listeners = new Set();
  function save() {
    persist();
  }
  function emit() { for (const fn of listeners) fn(s); }
  const lastVisit = s.lastVisit;
  s.lastVisit = Date.now();
  save();

  function mergeShared(remote = {}) {
    let changed = false;
    for (const k of ['gifts', 'visits']) {
      for (const item of remote[k] || []) {
        if (!item || !item.id || s.shared[k].some((x) => x.id === item.id)) continue;
        s.shared[k].push(item); changed = true;
      }
    }
    if (changed) { save(); emit(); }
    return changed;
  }
  // items not yet shown get applied exactly once (returns them and marks them applied)
  function takeUnapplied() {
    const out = [];
    for (const k of ['gifts', 'visits']) for (const it of s.shared[k]) {
      if (!s.applied.includes(it.id)) { out.push({ ...it, kind: k }); s.applied.push(it.id); }
    }
    if (out.length) save();
    return out;
  }
  return {
    get data() { return s; },
    lastVisit,
    save, mergeShared, takeUnapplied,
    allShared() { return [...s.shared.gifts.map((g) => ({ ...g, kind: 'gifts' })), ...s.shared.visits.map((g) => ({ ...g, kind: 'visits' }))]; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
