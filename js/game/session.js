// Game session shared by all worlds: one HUD, one keyboard map, and the "active world" that
// receives E / R / Space / B / C / M and the on-screen buttons.
// Keys are bound per action; the game's settings can remap them (bindKeys), the garden keeps the defaults.
import { createHud } from './hud.js';
import { onKey, clearKeyHandlers, moveKeys } from './player.js';

let hud = null, active = null;
const call = (k) => () => active && active[k] && active[k]();
const BAG = () => (hud.panelOpen ? hud.closePanel() : call('bag')());
// hooks the game layer fills in (pause menu, world map); the garden leaves them empty
export const hooks = { pause: null, worldmap: null, menuOpen: () => false, closeMenu: null };
const ACTION = {
  act: () => call('primary')(),
  alt: () => call('secondary')(),
  jump: () => { if (hud.dialogOpen) hud.el.dialog.dispatchEvent(new PointerEvent('pointerdown')); else call('jump')(); },
  bag: () => { if (hooks.menuOpen()) return; BAG(); },
  map: () => { if (!hooks.menuOpen()) call('map')(); },
  drift: () => { if (!hooks.menuOpen()) call('mode')(); },
  tool: () => call('tool')(),
  worldmap: () => hooks.worldmap && hooks.worldmap(),
  pause: () => {
    if (hud.panelOpen && !hooks.menuOpen()) { hud.closePanel(); return; }
    if (hooks.pause) hooks.pause(); else call('escape')();
  },
};
export const DEFAULT_BINDS = { act: ['KeyE', 'Enter'], alt: ['KeyR'], jump: ['Space'], bag: ['KeyB', 'KeyI', 'Tab'], map: ['KeyM'], drift: ['KeyC'], tool: ['KeyQ'], pause: ['Escape'] };
export function bindKeys(map = DEFAULT_BINDS) {
  clearKeyHandlers();
  for (const [a, codes] of Object.entries(map)) {
    if (moveKeys[a]) { moveKeys[a] = codes.slice(); continue; }
    if (ACTION[a]) for (const c of codes || []) onKey(c, ACTION[a]);
  }
  // Escape always closes whatever is open, even if pause moved elsewhere
  if (!(map.pause || []).includes('Escape')) onKey('Escape', () => { if (hooks.menuOpen() && hooks.closeMenu) hooks.closeMenu(); else if (hud.panelOpen) hud.closePanel(); });
}
export const runAction = (a) => ACTION[a] && ACTION[a]();
export function getHud(P) {
  if (hud) return hud;
  hud = createHud({ P });
  for (const k of ['primary', 'secondary', 'jump', 'bag', 'map', 'mode', 'tool']) hud.on(k, call(k));
  hud.on('panelClosed', call('panelClosed'));
  bindKeys();
  return hud;
}
export function setActive(w) { active = w; }
export function getActive() { return active; }
