// Display mode + window size. Desktop app: the Tauri window API (fullscreen / borderless = maximised
// with no frame / windowed with a chosen size). Browser: the Fullscreen API for fullscreen and
// borderless, nothing for window size.
const T = () => (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : null);
const call = (cmd, args = {}) => T().invoke('plugin:window|' + cmd, { label: 'main', ...args });

export const isDesktopApp = () => !!T();
let busy = Promise.resolve();
export function applyDisplay(mode, resolution) {
  if (T()) {
    busy = busy.then(async () => {
      try {
        if (mode === 'fullscreen') { await call('set_decorations', { value: true }); await call('set_fullscreen', { value: true }); }
        else if (mode === 'borderless') { await call('set_fullscreen', { value: false }); await call('set_decorations', { value: false }); await call('maximize'); }
        else {
          await call('set_fullscreen', { value: false }); await call('set_decorations', { value: true });
          if (resolution && resolution !== 'native') {
            const [w, h] = resolution.split('x').map(Number);
            await call('unmaximize');
            await call('set_size', { value: { Logical: { width: w, height: h } } });
            await call('center').catch(() => {});
          }
        }
      } catch (e) { console.warn('[display]', e); }
    });
    return busy;
  }
  // browser: needs the click that changed the setting (user activation)
  const fs = !!document.fullscreenElement;
  try {
    if ((mode === 'fullscreen' || mode === 'borderless') && !fs && document.documentElement.requestFullscreen) return document.documentElement.requestFullscreen().catch(() => {});
    if (mode === 'windowed' && fs && document.exitFullscreen) return document.exitFullscreen().catch(() => {});
  } catch (e) { /* */ }
  return Promise.resolve();
}
