// Free error tracking: window errors, unhandled promise rejections and console.error go into a ring
// buffer (last 200 in memory, last 60 kept in localStorage 'zm-errlog' across restarts). Viewable with
// ?fps=1 (tap the counter) or window.__zmErrors(). In the desktop app each entry is also appended to
// the app log dir (zen-errors.log, rotated at 512 KB) through the log_append command.
const KEY = 'zm-errlog';
const MAX = 200, KEEP = 60;
const buf = [];
let tauriInvoke = null, persistT = 0, sinceBoot = 0;
try { const old = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(old)) buf.push(...old.slice(-KEEP).map((e) => ({ ...e, old: 1 }))); } catch (e) { /* */ }
function short(s, n = 600) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
function persist() {
  persistT = 0;
  try { localStorage.setItem(KEY, JSON.stringify(buf.slice(-KEEP))); } catch (e) { /* quota: drop quietly */ }
}
export function logError(kind, msg, extra) {
  const e = { t: new Date().toISOString(), kind, msg: short(msg), ...(extra ? { x: short(typeof extra === 'string' ? extra : JSON.stringify(extra), 1500) } : {}) };
  // the same message storming every frame is one entry with a count
  const last = buf[buf.length - 1];
  if (last && !last.old && last.kind === kind && last.msg === e.msg) { last.n = (last.n || 1) + 1; last.t = e.t; }
  else { buf.push(e); if (buf.length > MAX) buf.shift(); }
  sinceBoot++;
  if (!persistT) persistT = setTimeout(persist, 2000);
  if (tauriInvoke && (!last || last.msg !== e.msg)) tauriInvoke('log_append', { line: JSON.stringify(e) }).catch(() => {});
  return e;
}
export function errors() { return buf.slice(); }
export function errorCount() { return sinceBoot; }
export function clearErrors() { buf.length = 0; persist(); }
export function installErrorLog() {
  try { if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) tauriInvoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a); } catch (e) { /* */ }
  addEventListener('error', (ev) => {
    if (ev.target && ev.target !== window && ev.target.tagName) { logError('resource', `${ev.target.tagName} failed: ${ev.target.src || ev.target.href || ''}`); return; }
    logError('error', ev.message || String(ev.error), ev.error && ev.error.stack ? { stack: ev.error.stack, at: `${ev.filename}:${ev.lineno}:${ev.colno}` } : `${ev.filename}:${ev.lineno}`);
  }, true);
  addEventListener('unhandledrejection', (ev) => { const r = ev.reason; logError('rejection', r && r.message ? r.message : String(r), r && r.stack ? { stack: r.stack } : null); });
  const ce = console.error.bind(console);
  console.error = (...a) => { try { logError('console', a.map((x) => (x && x.message) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); } catch (e) { /* */ } ce(...a); };
  window.__zmErrors = errors;
  addEventListener('pagehide', persist);
}
