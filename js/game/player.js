// The walker. The full game is the only mode now (Brock, Nov 25): everyone gets the full controller
// (player-game.js). player-calm.js still owns the shared keyboard, remappable move keys, gamepad
// stick state and look prefs that the settings write (BMSG-9); the old gentle walk stays there unused.
import { createGamePlayer } from './player-game.js';
export { onKey, keyDown, EYE, view, fpFov, moveKeys, pad, lookPrefs, clearKeyHandlers, prefs, setPref } from './player-calm.js';
export function createPlayer(opts) { return createGamePlayer(opts); }
