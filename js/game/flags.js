// The playable game (rocket, workshop, hangar, pad, game HUD) lives on the game
// preview host or behind ?game=1. Mom's calm garden preview stays a garden.
export function isGameWorld() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('game') === '0') return false;
    if (p.get('game') === '1' || p.get('unlock') === 'all') return true;
    const h = (location.hostname || '').toLowerCase();
    if (h === 'game.zen-garden-preview.pages.dev' || h.startsWith('game.')) return true;
  } catch (e) { /* no window */ }
  return false;
}
