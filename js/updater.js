// Desktop auto-update (Tauri only; main.js imports this inside the app, never on the web).
// The Rust side checks and downloads quietly at launch and every 45 minutes after. Once an update
// is fully downloaded we save, then install and relaunch at a safe moment: right away on a menu,
// loading or death screen or when idle; otherwise after a brief non-blocking 10 s countdown toast.
// Never mid-fight, mid-build, in the air or in the water. There is no Update / Restart button.
// A failed install is retried quietly; the running app is left as it is.
import { decideRestart, snapshot, persistRelaunch, takeRelaunch, flushProgress, toastStyle, COUNTDOWN_S } from './safe-restart.js';

const POLL_MS = 15000;

function invoke(cmd, args) {
  const t = window.__TAURI_INTERNALS__;
  if (!t || typeof t.invoke !== 'function') return Promise.reject(new Error('no tauri'));
  return t.invoke(cmd, args || {});
}

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
  return card;
}

function hideToast() {
  const card = document.getElementById('zm-update');
  if (!card) return;
  card.classList.remove('on');
  setTimeout(() => card.remove(), 900);
}

export function startUpdater() {
  if (!window.__TAURI_INTERNALS__) return;
  takeRelaunch(); // clear the flag written before the last auto-restart; auto-save already restored her place
  let lastInput = performance.now();
  const touch = () => { lastInput = performance.now(); };
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, touch, { passive: true, capture: true });

  let ready = null; // version downloaded and waiting
  let installing = false;
  let counting = null; // { version, until }
  let failWait = 0;

  const live = () => snapshot({ lastInput, worlds: window.__garden && window.__garden.worlds });

  async function install(version) {
    if (installing) return;
    installing = true;
    showToast('Saving and restarting…', version ? ('Version ' + version) : '');
    persistRelaunch({ version, world: (window.__net && window.__net.state && window.__net.state.world) || null });
    await flushProgress();
    try {
      await new Promise((r) => setTimeout(r, 200));
      await invoke('zen_update_install');
    } catch (e) {
      installing = false;
      counting = null;
      failWait = performance.now() + 30000;
      hideToast();
      // leave the game running; the Rust side will download again and we will retry
    }
  }

  const tick = () => {
    if (installing) { setTimeout(tick, 1000); return; }
    if (failWait && performance.now() < failWait) { setTimeout(tick, 2000); return; }
    const plan = () => {
      const d = decideRestart(live());
      if (d.action === 'now') { counting = null; hideToast(); install(ready); return true; }
      if (d.action === 'wait') {
        counting = null;
        hideToast();
        return false;
      }
      // countdown
      const now = performance.now();
      if (!counting || counting.version !== ready) counting = { version: ready, until: now + COUNTDOWN_S * 1000 };
      const left = Math.max(1, Math.ceil((counting.until - now) / 1000));
      showToast('A new version is ready.', 'Restarting in ' + left + 's. You will come back right where you are.');
      if (now >= counting.until) { counting = null; install(ready); return true; }
      return false;
    };

    if (ready) {
      plan();
      setTimeout(tick, 500);
      return;
    }
    invoke('zen_update_status').then((s) => {
      if (s && s.ready && s.version) ready = s.version;
      setTimeout(tick, ready ? 500 : POLL_MS);
    }).catch(() => setTimeout(tick, POLL_MS * 4));
  };

  window.__zmApplyUpdate = (why) => {
    invoke('zen_update_check').catch(() => {});
    if (why) { /* status poll will pick up a ready download */ }
  };

  setTimeout(tick, POLL_MS);
}
