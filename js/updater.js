// Desktop auto-update prompt (Tauri only; main.js imports this inside the app, never on the web).
// The Rust side checks and downloads quietly at launch and every 45 minutes after. Once an update is fully downloaded we wait
// for a calm moment (window visible, mouse not captured, a few seconds without input) and show one
// small, non-blocking card. "Later" just hides it: the update then installs when the game is closed.
const POLL_MS = 15000;
const QUIET_MS = 6000;

function invoke(cmd, args) {
  const t = window.__TAURI_INTERNALS__;
  if (!t || typeof t.invoke !== 'function') return Promise.reject(new Error('no tauri'));
  return t.invoke(cmd, args || {});
}

function injectStyle() {
  if (document.getElementById('zm-update-style')) return;
  const s = document.createElement('style');
  s.id = 'zm-update-style';
  s.textContent = `
#zm-update{position:fixed;right:20px;bottom:20px;z-index:60;max-width:300px;padding:14px 16px;
  border-radius:12px;background:rgba(14,18,28,.78);color:#eef0ea;backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(8px);
  transition:opacity .8s ease,transform .8s ease}
#zm-update.on{opacity:1;transform:none}
#zm-update p{margin:0 0 4px}#zm-update small{display:block;opacity:.7;margin-bottom:10px}
#zm-update .row{display:flex;gap:8px;justify-content:flex-end}
#zm-update button{font:inherit;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;
  background:rgba(255,255,255,.12);color:inherit}
#zm-update button.go{background:#cfe3c4;color:#17210f}`;
  document.head.appendChild(s);
}

function showCard() {
  injectStyle();
  const card = document.createElement('div');
  card.id = 'zm-update';
  card.setAttribute('role', 'status');
  card.innerHTML = '<p>A new version is ready.</p>' +
    '<small>Restart now, or it will update next time you close the game.</small>' +
    '<div class="row"><button type="button" class="later">Later</button>' +
    '<button type="button" class="go">Restart now</button></div>';
  // keep clicks on the card from reaching the game (tending, looking around)
  for (const ev of ['pointerdown', 'pointerup', 'click', 'touchstart', 'mousedown', 'wheel']) {
    card.addEventListener(ev, (e) => e.stopPropagation());
  }
  const close = () => { card.classList.remove('on'); setTimeout(() => card.remove(), 900); };
  card.querySelector('.later').addEventListener('click', close);
  card.querySelector('.go').addEventListener('click', () => {
    card.querySelector('small').textContent = 'Saving and restarting…';
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    // flush any pending save (save.js writes on pagehide)
    try { window.dispatchEvent(new Event('pagehide')); } catch (_) {}
    setTimeout(() => invoke('zen_update_install').catch(close), 400);
  });
  document.body.appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('on')));
}

export function startUpdater() {
  if (!window.__TAURI_INTERNALS__) return;
  let lastInput = performance.now();
  const touch = () => { lastInput = performance.now(); };
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, touch, { passive: true, capture: true });

  // The Rust side re-checks every 45 minutes while the game runs, so we keep polling for the whole
  // session: an update that lands mid-session gets its card, and a newer one after "Later" gets one more.
  let ready = null; // version downloaded and waiting
  let shown = null; // version whose card was shown
  const calm = () => document.visibilityState === 'visible' && !document.pointerLockElement &&
    performance.now() - lastInput > QUIET_MS;

  const tick = () => {
    if (ready && ready !== shown) {
      if (calm() && !document.getElementById('zm-update')) { shown = ready; showCard(); setTimeout(tick, POLL_MS); return; }
      setTimeout(tick, 2000);
      return;
    }
    invoke('zen_update_status').then((s) => {
      if (s && s.ready && s.version) ready = s.version;
      setTimeout(tick, ready && ready !== shown ? 2000 : POLL_MS);
    }).catch(() => setTimeout(tick, POLL_MS * 4));
  };
  setTimeout(tick, POLL_MS);
}
