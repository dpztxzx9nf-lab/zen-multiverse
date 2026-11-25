// Game session shared by all worlds: one HUD, one keyboard map, and the "active world" that
// receives E / R / Space / B / C / M and the on-screen buttons.
import { createHud } from './hud.js';
import { onKey } from './player.js';
import { isGameWorld } from './flags.js';
import { pad } from './gamepad.js';

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
  // game worlds: C is crouch/slide, so the quiet drift mode moves to V
  onKey('KeyV', call('mode')); void isGameWorld;
  onKey('KeyQ', call('tool'));
  onKey('Escape', () => { if (hud.panelOpen) hud.closePanel(); else call('escape')(); });
  // gamepad buttons that act on the world (movement buttons are read by the walker itself)
  let lastT = performance.now();
  const loop = () => {
    const t = performance.now(); pad.poll((t - lastT) / 1000); lastT = t;
    if (pad.connected) {
      if (pad.pressed('X')) { if (hud.dialogOpen) hud.el.dialog.dispatchEvent(new PointerEvent('pointerdown')); else call('primary')(); }
      if (pad.pressed('Y')) { if (hud.panelOpen) hud.closePanel(); else call('bag')(); }
      if (pad.pressed('B') && hud.panelOpen) hud.closePanel();
      if (pad.pressed('Start')) window.dispatchEvent(new CustomEvent('zen-menu'));
      if (pad.pressed('Back')) call('map')();
      if (pad.pressed('RB')) window.dispatchEvent(new CustomEvent('zen-hotbar', { detail: 1 }));
      if (pad.pressed('LB')) window.dispatchEvent(new CustomEvent('zen-hotbar', { detail: -1 }));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('zen-secondary', () => call('secondary')());
  return hud;
}
export function setActive(w) { active = w; }
export function getActive() { return active; }
