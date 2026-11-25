// Gamepad (standard mapping): left stick walks, right stick looks, buttons are remappable actions.
// In the pause menu: D-pad / stick moves, A picks, B goes back, Start closes.
import { pad as padIn, lookPrefs } from './player.js';
import { settings } from './settings.js';

export function createGamepad({ runAction, menu }) {
  let prev = [], capCb = null, name = '', haveT = 0, navT = 0;
  const dz = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d));
  function first() { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of l) if (g && g.connected) return g; return null; }
  function tick() {
    requestAnimationFrame(tick);
    const C = settings.controls.pad, g = C.enabled ? first() : null;
    if (!g) { if (padIn.x || padIn.y || padIn.lx || padIn.ly) Object.assign(padIn, { x: 0, y: 0, lx: 0, ly: 0, run: 0 }); name = ''; return; }
    name = g.id; haveT = performance.now();
    const d = C.deadzone, ax = g.axes;
    const pressed = g.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i) => pressed[i] && !prev[i];
    if (capCb) { const i = pressed.findIndex((p, k) => p && !prev[k]); if (i >= 0) { const cb = capCb; capCb = null; prev = pressed; cb(i); return; } }
    lookPrefs.padSens = C.sens; lookPrefs.padInvertY = C.invertY;
    if (menu.open) {
      Object.assign(padIn, { x: 0, y: 0, lx: 0, ly: 0, run: 0 });
      const now = performance.now(), vy = dz(ax[1] || 0, 0.5);
      if (edge(12) || (vy < 0 && now > navT)) { menu.nav(-1); navT = now + 260; }
      if (edge(13) || (vy > 0 && now > navT)) { menu.nav(1); navT = now + 260; }
      if (edge(0)) menu.select();
      if (edge(1)) menu.back();
      if (edge(9)) menu.close();
    } else {
      padIn.x = dz(ax[0] || 0, d); padIn.y = -dz(ax[1] || 0, d);
      padIn.lx = dz(ax[2] || 0, d); padIn.ly = dz(ax[3] || 0, d);
      const B = C.buttons;
      padIn.run = B.run != null && pressed[B.run] ? 1 : 0;
      for (const [a, i] of Object.entries(B)) if (a !== 'run' && edge(i)) { runAction(a); if (a === 'act') rumble(0.22, 50); }
    }
    prev = pressed;
  }
  function rumble(w = 0.2, ms = 60) {
    if (!settings.controls.pad.vibration) return;
    const g = first(); const v = g && g.vibrationActuator;
    try { if (v && v.playEffect) v.playEffect('dual-rumble', { duration: ms, weakMagnitude: w, strongMagnitude: w * 0.4 }); } catch (e) { /* */ }
  }
  requestAnimationFrame(tick);
  return {
    capture(cb) { capCb = cb; },
    rumble,
    status() { return name && performance.now() - haveT < 1500 ? name.replace(/\(.*?\)/g, '').trim().slice(0, 48) + ' · connected' : 'None found. Press any button on a connected controller.'; },
  };
}
