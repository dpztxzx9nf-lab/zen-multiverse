// The full game is the only mode now (web and desktop). The calm-garden-only mode was dropped
// on 2026-11-25; callers still ask isGameWorld() so the old branches can be removed gradually.
export function isGameWorld() {
  return true;
}
