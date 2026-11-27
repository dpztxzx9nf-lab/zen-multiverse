// First-walk tips are retired (Xenia pivot). The save field is still written so old saves load.
import { game } from './store.js';

export function createTutorial() {
  const G = game.data;
  G.tutorial = { step: 5, done: true, quiet: true };
  return { get state() { return { ...G.tutorial }; }, restart() {}, skip() {}, stop() {} };
}

export const TUT_CSS = '';
