// When an update is ready (desktop installer or a new service worker), restart only at a safe
// moment: immediately on a menu, loading or death screen, or when idle; otherwise a brief
// non-blocking 10 s countdown. Never mid-fight, mid-build, in the air, or in the water.
export const COUNTDOWN_S = 10;
export const IDLE_MS = 6000;
export const RELAUNCH_KEY = 'zm-relaunch';
// Rust-side fallback if the JS poller is frozen (WebView timer throttling while hidden).
// Keep these in sync with src-tauri/src/lib.rs (WATCHDOG_BACKGROUND_S, WATCHDOG_STUCK_S).
export const WATCHDOG_BACKGROUND_S = 30;
export const WATCHDOG_STUCK_S = 120;

// Pure: should the Rust watchdog install a pending update now?
// JS gets the first 30 s (idle, menu, 10 s toast, or hidden-is-now). After that,
// an unfocused or minimized window is installed from Rust; after 120 s, even a
// focused window is, so a stuck air/fight flag cannot hold the update forever.
export function watchdogShouldInstall({ pendingForS = 0, focused = true, minimized = false } = {}) {
  if (pendingForS >= WATCHDOG_STUCK_S) return { install: true, reason: 'stuck' };
  if (pendingForS >= WATCHDOG_BACKGROUND_S && (minimized || !focused)) {
    return { install: true, reason: 'background' };
  }
  return { install: false, reason: 'wait' };
}

// Pure: given a snapshot of the player's situation, decide what to do.
//   now       — restart immediately
//   countdown — restart after a 10 s heads-up (not in a blocked state)
//   wait      — hold off (fight / build / air / water)
// A hidden, minimized, or fully occluded window is a safe moment: the player is
// not at the keyboard, the game loop is often paused, and fight/air/water flags
// may be stuck on the last frame. Waiting here left a downloaded update sitting
// until the window was focused again.
export function decideRestart(s = {}) {
  if (s.hidden) return { action: 'now', reason: 'hidden' };
  if (s.fight) return { action: 'wait', reason: 'fight' };
  if (s.build) return { action: 'wait', reason: 'build' };
  if (s.air) return { action: 'wait', reason: 'air' };
  if (s.water) return { action: 'wait', reason: 'water' };
  if (s.loading || s.menu || s.death || s.idle) {
    return { action: 'now', reason: s.loading ? 'loading' : s.menu ? 'menu' : s.death ? 'death' : 'idle' };
  }
  return { action: 'countdown', reason: 'play' };
}

export function snapshot(opts = {}) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  const now = opts.now != null ? opts.now : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const lastInput = opts.lastInput != null ? opts.lastInput : now;
  const note = (win && win.__zmMoment) || {};
  const fightUntil = note.fightUntil || 0;
  const wall = opts.wall != null ? opts.wall : Date.now();
  const veil = doc && doc.getElementById('veil');
  const loading = !!(veil && !veil.classList.contains('gone')) || !!(note.loading);
  const menu = !!(doc && (
    doc.querySelector('#zen-menu:not(.hidden)') ||
    doc.querySelector('#gmenu.open') ||
    doc.querySelector('.menu.open') ||
    doc.querySelector('#zm-creator:not(.hidden)')
  )) || !!note.menu;
  const death = !!(doc && (doc.querySelector('#zm-death') || doc.querySelector('.zm-dead'))) || !!note.dead;
  const hidden = !!(doc && doc.visibilityState && doc.visibilityState !== 'visible');
  const pointerLock = !!(doc && doc.pointerLockElement);
  const player = findPlayer(opts.worlds || (win && win.__garden && win.__garden.worlds));
  const air = note.air != null ? !!note.air : !!(player && player.airborne);
  const water = note.water != null ? !!note.water : !!(player && (player.swimming || (player.swim && player.swim.on)));
  const build = !!note.build;
  const fight = !!note.fight || (fightUntil > wall);
  const idle = !pointerLock && (now - lastInput >= IDLE_MS) && !fight && !build && !air && !water;
  return { loading, menu, death, hidden, idle, fight, build, air, water, pointerLock };
}

export function findPlayer(worlds) {
  const w = worlds && worlds.current;
  if (!w) return null;
  const d = w.debug || {};
  return d.player || (d.core && d.core.player) || (d.game && d.game.player) || null;
}

export function noteMoment(partial) {
  if (typeof window === 'undefined') return partial;
  const prev = window.__zmMoment || {};
  const next = { ...prev, ...partial, t: Date.now() };
  window.__zmMoment = next;
  return next;
}

export function persistRelaunch(data = {}) {
  try {
    const payload = { ...data, t: Date.now() };
    localStorage.setItem(RELAUNCH_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

// Read and clear. Only a relaunch in the last hour counts, so a leftover flag can't surprise later.
export function takeRelaunch() {
  try {
    const raw = localStorage.getItem(RELAUNCH_KEY);
    localStorage.removeItem(RELAUNCH_KEY);
    const j = raw ? JSON.parse(raw) : null;
    if (!j || typeof j !== 'object' || Date.now() - (j.t || 0) > 60 * 60e3) return null;
    return j;
  } catch {
    return null;
  }
}

export async function flushProgress() {
  try {
    if (typeof window !== 'undefined' && window.__gardenFlush) await window.__gardenFlush();
  } catch { /* keep going: a failed local flush must not block a restart whose server save is already good */ }
}

export function toastStyle() {
  return `#zm-update{position:fixed;right:20px;bottom:20px;z-index:60;max-width:300px;padding:14px 16px;
  border-radius:12px;background:rgba(14,18,28,.78);color:#eef0ea;backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(8px);
  transition:opacity .8s ease,transform .8s ease;pointer-events:none}
#zm-update.on{opacity:1;transform:none}
#zm-update p{margin:0 0 4px}#zm-update small{display:block;opacity:.7}`;
}
