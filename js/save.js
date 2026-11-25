// One save object for everything that persists on this device.
//   localStorage['garden-save'] = { v, created, slices: { bonsai: {...}, garden: {...}, ... } }
// Each system (or future world) owns a named slice:  const s = save.slice('bonsai', defaults, legacyKey)
// A legacy key (from older versions) is migrated into the slice once, the first time it is read.
// Future worlds should namespace their slices, e.g. 'moon.base', 'earth.beds'.
const KEY = 'garden-save';
let root = null, timer = null;

function load() {
  if (root) return root;
  try { root = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { root = null; }
  if (!root || typeof root !== 'object' || !root.slices) root = { v: 1, created: Date.now(), slices: {} };
  return root;
}
function flush() {
  clearTimeout(timer); timer = null;
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) { /* private mode: keep in memory */ }
}
export function persist(delay = 200) {
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}
// returns the live slice object (mutate it, then call persist())
export function slice(name, defaults = () => ({}), legacyKey = null) {
  const r = load();
  if (!r.slices[name]) {
    let legacy = null;
    if (legacyKey) { try { legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null'); } catch (e) { legacy = null; } }
    r.slices[name] = legacy && typeof legacy === 'object' ? legacy : defaults();
    flush();
  }
  return r.slices[name];
}
export function replaceSlice(name, value) { load().slices[name] = value; persist(); return value; }
export function exportSave() { return JSON.parse(JSON.stringify(load())); }
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) flush(); });
