// The walker. Mom's calm garden preview keeps the original gentle first-person walk
// (player-calm.js, unchanged); the game worlds get the full controller (player-game.js).
import { isGameWorld } from './flags.js';
import { createPlayer as createCalm } from './player-calm.js';
import { createGamePlayer } from './player-game.js';
export { onKey, keyDown, EYE, fpFov, prefs, setPref } from './player-calm.js';
export function createPlayer(opts) { return isGameWorld() ? createGamePlayer(opts) : createCalm(opts); }
