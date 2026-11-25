// The walker. Mom's calm garden preview keeps the original gentle first-person walk
// (player-calm.js, unchanged); the game worlds get the full controller (player-game.js).
import { isGameWorld } from './flags.js';
import { createPlayer as createCalm } from './player-calm.js';
import { createGamePlayer } from './player-game.js';
export { onKey, keyDown, EYE, fpFov, prefs, setPref } from './player-calm.js';
// the full game is always on (Brock, Nov 25): one player everywhere. createCalm kept only as a reference/fallback.
export function createPlayer(opts) { return createGamePlayer(opts); }
void isGameWorld; void createCalm;
