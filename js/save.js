// One save object for everything that persists on this device.
//   localStorage['garden-save'] = { v, created, saved, slices: { bonsai: {...}, garden: {...}, ... } }
// Each system (or future world) owns a named slice:  const s = save.slice('bonsai', defaults, legacyKey)
// A legacy key (from older versions) is migrated into the slice once, the first time it is read.
// Future worlds should namespace their slices, e.g. 'moon.base', 'earth.beds'.
//
// Safety net (auto-save):
//  - every write is serialised and read back before it replaces the save; a bad write never lands
//  - 'garden-save.bak' is a rolling copy of the last good save (refreshed at most every 2 min);
//    if the main save ever fails to parse, the backup is loaded instead
//  - writes are debounced (persist), and flushed at once when the page hides or closes
//  - in the desktop/mobile app (Tauri) the same text is mirrored to the app data folder
//    (save.json + save.bak.json), so clearing the webview cache never loses the garden;
//    on start the newer of disk and localStorage wins
//  - window 'garden-saved' event after each write (the game HUD shows a tiny leaf)
const KEY = 'garden-save';
const BAK = 'garden-save.bak';
const BAK_EVERY = 120e3;
let root = null, timer = null, lastBak = 0, lastGood = null, recovered = false;
const TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const valid = (o) => !!(o && typeof o === 'object' && o.slices && typeof o.slices === 'object');
function parse(s) { try { const o = JSON.parse(s || 'null'); return valid(o) ? o : null; } catch (e) { return null; } }
function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

function load() {
  if (root) return root;
  const main = read(KEY);
  root = parse(main);
  if (root) lastGood = main;
  else {
    const b = parse(read(BAK));
    if (b) { root = b; recovered = !!main; if (main) console.warn('[save] main save unreadable, restored the backup'); }
  }
  if (!root) root = { v: 1, created: Date.now(), slices: {} };
  return root;
}
function flush() {
  clearTimeout(timer); timer = null;
  const r = load();
  r.saved = Date.now();
  let s;
  try { s = JSON.stringify(r); } catch (e) { console.warn('[save] could not serialise', e); return false; }
  if (!parse(s)) { console.warn('[save] write failed its read-back; keeping the old save'); return false; }
  try {
    // the backup is the previous good save, refreshed every couple of minutes
    if (lastGood && r.saved - lastBak > BAK_EVERY) { localStorage.setItem(BAK, lastGood); lastBak = r.saved; }
    else if (!lastGood && !read(BAK)) { localStorage.setItem(BAK, s); lastBak = r.saved; }
    localStorage.setItem(KEY, s);
    lastGood = s;
  } catch (e) { /* private mode / quota: keep in memory, still mirror to disk below */ }
  if (TAURI) diskWrite(s);
  try { window.dispatchEvent(new CustomEvent('garden-saved', { detail: { t: r.saved } })); } catch (e) { /* */ }
  return true;
}
export function persist(delay = 200) {
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}
// write right now (pagehide, app close, the 30 s auto-save)
export function flushNow() { return flush(); }
export function savedAt() { return load().saved || 0; }
export function wasRecovered() { load(); return recovered; }
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

// ---- Tauri: mirror to the app data folder (survives cache clears)
let diskT = null, diskPending = null, diskBusy = null;
function invoke(cmd, args) { return window.__TAURI_INTERNALS__.invoke(cmd, args); }
function diskWrite(s, now = false) {
  diskPending = s; clearTimeout(diskT);
  if (now) return diskFlush();
  diskT = setTimeout(diskFlush, 800);
  return diskBusy || Promise.resolve();
}
function diskFlush() {
  clearTimeout(diskT); diskT = null;
  const s = diskPending; diskPending = null;
  if (!s) return diskBusy || Promise.resolve();
  diskBusy = Promise.resolve(diskBusy).then(() => invoke('save_write', { data: s })).catch((e) => console.warn('[save] disk write', e));
  return diskBusy;
}
if (TAURI) {
  // on start, the newer of disk and localStorage wins (a cleared cache comes back from disk)
  (async () => {
    try {
      const [dm, db] = await invoke('save_read');
      const disk = parse(dm) || parse(db);
      const local = parse(read(KEY));
      if (disk && (!local || (disk.saved || 0) > (local.saved || 0) + 1000)) {
        const k = 'garden-save.restored';
        if (!sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, '1');
          localStorage.setItem(KEY, JSON.stringify(disk));
          location.reload();
        }
      } else if (local && !disk) diskWrite(JSON.stringify(local));
    } catch (e) { console.warn('[save] disk read', e); }
  })();
  // the app asks for a last save before its window closes
  window.__gardenFlush = () => { flush(); return diskFlush(); };
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flush(); if (TAURI) diskFlush(); } });
}
