// Gamepad (standard mapping). Left stick walks, right stick looks; both through the per-stick inner /
// outer deadzones and the look curve in settings (zen.stick). Every button is a remappable action:
// presses go to the game (runAction) and to zen.emitAction (down and up) for systems like the hotbar.
// In the pause menu: D-pad / left stick move, A picks, B goes back, LB / RB switch settings tabs,
// D-pad left / right change a value, Start closes.
import { pad as padIn, lookPrefs } from './player.js';
import { settings, zen } from './settings.js';

export function createGamepad({ runAction, menu, onAction }) {
  let prev = [], capCb = null, name = '', haveT = 0, navT = 0, navXT = 0;
  function first() { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of l) if (g && g.connected) return g; return null; }
  function tick() {
    requestAnimationFrame(tick);
    const C = settings.pad, g = C.enabled ? first() : null;
    if (!g) { if (padIn.x || padIn.y || padIn.lx || padIn.ly) Object.assign(padIn, { x: 0, y: 0, lx: 0, ly: 0, run: 0 }); name = ''; return; }
    name = g.id; haveT = performance.now();
    const ax = g.axes;
    const pressed = g.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i) => pressed[i] && !prev[i];
    if (capCb) { const i = pressed.findIndex((p, k) => p && !prev[k]); if (i >= 0) { const cb = capCb; capCb = null; prev = pressed; cb(i); return; } }
    if (menu.open) {
      Object.assign(padIn, { x: 0, y: 0, lx: 0, ly: 0, run: 0 });
      const now = performance.now(), vy = Math.abs(ax[1] || 0) > 0.5 ? Math.sign(ax[1]) : 0, vx = Math.abs(ax[0] || 0) > 0.5 ? Math.sign(ax[0]) : 0;
      if (edge(12) || (vy < 0 && now > navT)) { menu.nav(-1); navT = now + 220; }
      if (edge(13) || (vy > 0 && now > navT)) { menu.nav(1); navT = now + 220; }
      if (!vy) navT = 0;
      if (menu.navX) {
        if (edge(14) || (vx < 0 && now > navXT)) { menu.navX(-1); navXT = now + 160; }
        if (edge(15) || (vx > 0 && now > navXT)) { menu.navX(1); navXT = now + 160; }
        if (!vx) navXT = 0;
      }
      if (menu.tab && edge(4)) menu.tab(-1);
      if (menu.tab && edge(5)) menu.tab(1);
      if (edge(0)) menu.select();
      if (edge(1)) menu.back();
      if (edge(9)) menu.close();
    } else {
      const [mx, my] = zen.stick(ax[0] || 0, ax[1] || 0, 'left');
      padIn.x = mx; padIn.y = -my;
      // look: player.js turns pad.lx/ly into 2.6 / 1.9 rad/s × padSens; give it the curved, scaled stick
      const B = C.buttons, ads = B.use2 != null && pressed[B.use2], m = ads ? C.ads : 1;
      const [rx, ry] = zen.stick(ax[2] || 0, ax[3] || 0, 'right');
      padIn.lx = rx * C.sensX * m; padIn.ly = ry * C.sensY * m;
      lookPrefs.padSens = 1; lookPrefs.padInvertY = C.invertY;
      for (const [a, i] of Object.entries(B)) {
        if (i == null) continue;
        if (edge(i)) { runAction(a); if (onAction) onAction(a, true, 'pad'); if (a === 'act') rumble(0.22, 50); }
        else if (!pressed[i] && prev[i] && onAction) onAction(a, false, 'pad');
      }
    }
    prev = pressed;
  }
  function rumble(w = 0.2, ms = 60) {
    const k = zen.vibration(); if (!k) return;
    const g = first(); const v = g && g.vibrationActuator;
    try { if (v && v.playEffect) v.playEffect('dual-rumble', { duration: ms, weakMagnitude: Math.min(1, w * k * 1.6), strongMagnitude: Math.min(1, w * 0.4 * k * 1.6) }); } catch (e) { /* */ }
  }
  requestAnimationFrame(tick);
  return {
    capture(cb) { capCb = cb; },
    rumble,
    status() { return name && performance.now() - haveT < 1500 ? name.replace(/\(.*?\)/g, '').trim().slice(0, 48) + ' · connected' : 'None found. Press any button on a connected controller.'; },
  };
}
