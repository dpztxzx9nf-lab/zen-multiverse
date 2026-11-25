// The playable game (rocket, workshop, hangar, pad, game HUD) lives in the desktop app, on the game
// preview host, or behind ?game=1. Mom's calm garden preview stays a garden. ?game=0 always wins.
function inTauri() {
  try {
    if (window.__TAURI_INTERNALS__ || window.__TAURI__) return true;
    const h = (location.hostname || '').toLowerCase();
    if (location.protocol === 'tauri:' || h === 'tauri.localhost' || h.endsWith('.tauri.localhost')) return true;
  } catch (e) { /* no window */ }
  return false;
}

export function isGameWorld() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('game') === '0') return false;
    if (p.get('game') === '1' || p.get('unlock') === 'all') return true;
    if (inTauri()) return true;
    const h = (location.hostname || '').toLowerCase();
    if (h === 'game.zen-garden-preview.pages.dev' || h.startsWith('game.')) return true;
  } catch (e) { /* no window */ }
  return false;
}
