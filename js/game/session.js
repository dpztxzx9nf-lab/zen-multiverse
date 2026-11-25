// Game session shared by all worlds: one HUD, one keyboard map, and the "active world" that
// receives E / R / Space / B / C / M and the on-screen buttons.
import { createHud } from './hud.js';
import { onKey } from './player.js';

let hud = null, active = null;
const call = (k) => () => active && active[k] && active[k]();
export function getHud(P) {
  if (hud) return hud;
  hud = createHud({ P });
  for (const k of ['primary', 'secondary', 'jump', 'bag', 'map', 'mode', 'tool']) hud.on(k, call(k));
  hud.on('panelClosed', call('panelClosed'));
  onKey('KeyE', call('primary')); onKey('Enter', call('primary'));
  onKey('KeyR', call('secondary'));
  onKey('Space', () => { if (hud.dialogOpen) hud.el.dialog.dispatchEvent(new PointerEvent('pointerdown')); else call('jump')(); });
  onKey('KeyB', () => (hud.panelOpen ? hud.closePanel() : call('bag')()));
  onKey('KeyI', () => (hud.panelOpen ? hud.closePanel() : call('bag')()));
  onKey('Tab', () => (hud.panelOpen ? hud.closePanel() : call('bag')()));
  onKey('KeyM', call('map'));
  onKey('KeyC', call('mode'));
  onKey('KeyQ', call('tool'));
  onKey('Escape', () => { if (hud.panelOpen) hud.closePanel(); else call('escape')(); });
  return hud;
}
export function setActive(w) { active = w; }
export function getActive() { return active; }
