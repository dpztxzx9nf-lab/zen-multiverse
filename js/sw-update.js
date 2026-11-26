// PWA: when a new service worker is ready, reload at the same safe moments as the desktop updater,
// with progress saved and (via the relaunch flag + auto-save) the player's place restored.
import { decideRestart, snapshot, persistRelaunch, flushProgress, toastStyle, COUNTDOWN_S } from './safe-restart.js';

const CHECK_MS = 15 * 60 * 1000;
const FLAG = 'zm-sw-reloaded';

function injectStyle() {
  if (document.getElementById('zm-update-style')) return;
  const s = document.createElement('style');
  s.id = 'zm-update-style';
  s.textContent = toastStyle();
  document.head.appendChild(s);
}

function showToast(title, sub) {
  injectStyle();
  let card = document.getElementById('zm-update');
  if (!card) {
    card = document.createElement('div');
    card.id = 'zm-update';
    card.setAttribute('role', 'status');
    card.innerHTML = '<p></p><small></small>';
    document.body.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('on')));
  }
  card.querySelector('p').textContent = title;
  card.querySelector('small').textContent = sub || '';
}

function hideToast() {
  const card = document.getElementById('zm-update');
  if (!card) return;
  card.classList.remove('on');
  setTimeout(() => card.remove(), 900);
}

export function startSwUpdate() {
  if (!('serviceWorker' in navigator)) return;
  let pending = false;
  let counting = null;
  let lastInput = performance.now();
  let reloading = false;
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true, capture: true });

  const live = () => snapshot({ lastInput, worlds: window.__garden && window.__garden.worlds });

  async function reload() {
    if (reloading) return;
    reloading = true;
    showToast('Saving and restarting…', '');
    persistRelaunch({ via: 'sw' });
    try { sessionStorage.setItem(FLAG, String(Date.now())); } catch { /* */ }
    await flushProgress();
    location.reload();
  }

  function schedule() {
    pending = true;
  }

  const tick = () => {
    if (!pending || reloading) { setTimeout(tick, pending ? 500 : 4000); return; }
    const d = decideRestart(live());
    if (d.action === 'now') { counting = null; hideToast(); reload(); return; }
    if (d.action === 'wait') { counting = null; hideToast(); setTimeout(tick, 500); return; }
    const now = performance.now();
    if (!counting) counting = { until: now + COUNTDOWN_S * 1000 };
    const left = Math.max(1, Math.ceil((counting.until - now) / 1000));
    showToast('A new version is ready.', 'Restarting in ' + left + 's. You'll come back right where you are.');
    if (now >= counting.until) { counting = null; reload(); return; }
    setTimeout(tick, 500);
  };
  setTimeout(tick, 2000);

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.t === 'sw-updated') schedule();
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // a new worker took over; if we just reloaded to apply it, don't loop
    try { const t = +sessionStorage.getItem(FLAG) || 0; if (Date.now() - t < 15000) return; } catch { /* */ }
    schedule();
  });

  async function check() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      if (reg && reg.waiting) schedule();
    } catch { /* */ }
  }
  addEventListener('load', () => check());
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });

  window.__zmApplyUpdate = () => { check(); schedule(); };
}
