// Gamepad: polled once per frame (standard mapping). Left stick moves, right stick looks with a
// response curve and a turn ramp at full tilt (Apex-style), A jump, B crouch/slide, X use, Y bag,
// LB/RB hotbar, LT ability, RT use tool / throw, L3 sprint, Start menu. Rumble when supported.
//   import { pad } from './g7/pad.js';  (raw stick curves + buttons for the walker and tools; the remappable
//   action buttons and menu navigation live in ../gamepad.js, BMSG-9)
//  pad.poll(dt); pad.move -> {x,y}; pad.pressed('A')
import { moveSettings } from '../move-config.js';
const NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];
const radial = (x, y, dz) => { const l = Math.hypot(x, y); if (l < dz) return [0, 0]; const k = Math.min(1, (l - dz) / (1 - dz)) / l; return [x * k, y * k]; };
let lastPoll = -1, gp = null, prev = new Array(16).fill(false), now = new Array(16).fill(false), ramp = 0;
export const pad = {
  connected: false, move: { x: 0, y: 0 }, lookV: { x: 0, y: 0 }, lt: 0, rt: 0, lastUsed: 0,
  poll(dt) {
    const t = performance.now(); if (t - lastPoll < 3) return; lastPoll = t;
    const list = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    gp = null; for (const g of list || []) if (g && g.connected && g.mapping === 'standard') { gp = g; break; }
    if (!gp) for (const g of list || []) if (g && g.connected) { gp = g; break; }
    pad.connected = !!gp;
    prev = now; now = new Array(16).fill(false);
    if (!gp) { pad.move.x = pad.move.y = pad.lookV.x = pad.lookV.y = 0; return; }
    for (let i = 0; i < 16; i++) { const b = gp.buttons[i]; now[i] = !!(b && (b.pressed || b.value > 0.5)); }
    pad.lt = gp.buttons[6] ? gp.buttons[6].value : 0; pad.rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    const Z = moveSettings.zen && moveSettings.zen(), ax = gp.axes;
    let mx, my, lx, ly, l, sensY;
    if (Z) {
      // the settings page: per-stick inner / outer deadzones, the chosen response curve, X / Y and ADS sensitivity
      [mx, my] = Z.stick(ax[0] || 0, ax[1] || 0, 'left');
      l = Math.hypot(...radial(ax[2] || 0, ax[3] || 0, Z.settings.pad.rightIn));
      [lx, ly] = Z.stick(ax[2] || 0, ax[3] || 0, 'right');
      sensY = Z.settings.pad.sensY * (Z.aiming ? Z.settings.pad.ads : 1);
    } else {
      const dz = moveSettings.get('padDeadzone');
      [mx, my] = radial(ax[0] || 0, ax[1] || 0, dz);
      [lx, ly] = radial(ax[2] || 0, ax[3] || 0, dz);
      // response curve: fine aim near the centre, fast turns at the edge
      l = Math.hypot(lx, ly); const curved = l > 0 ? Math.pow(l, 2.0) / l : 0;
      lx *= curved; ly *= curved;
    }
    pad.move.x = mx; pad.move.y = -my;
    // a turn ramp when held at full tilt
    ramp = l > 0.95 && Math.abs(lx) > 0.7 ? Math.min(1, ramp + dt / 0.35) : Math.max(0, ramp - dt * 4);
    const sens = moveSettings.get('padSens'), yawMax = 3.0 + ramp * 2.4;
    pad.lookV.x = lx * yawMax * sens; pad.lookV.y = ly * 2.1 * (sensY != null ? sensY : sens) * (moveSettings.get('padInvertY') ? -1 : 1);
    if (mx || my || lx || ly || now.some(Boolean)) pad.lastUsed = performance.now();
  },
  down(n) { return now[NAMES.indexOf(n)]; },
  downIdx(i) { return !!now[i]; },
  pressed(n) { const i = NAMES.indexOf(n); return now[i] && !prev[i]; },
  released(n) { const i = NAMES.indexOf(n); return !now[i] && prev[i]; },
  rumble(weak = 0.3, strong = 0.2, ms = 80) {
    if (!gp || !moveSettings.get('haptics')) return;
    const Z = moveSettings.zen && moveSettings.zen(), k = Z ? Z.vibration() / 0.6 : 1; weak = Math.min(1, weak * k); strong = Math.min(1, strong * k);
    const a = gp.vibrationActuator; if (a && a.playEffect) { try { a.playEffect('dual-rumble', { duration: ms, weakMagnitude: weak, strongMagnitude: strong }); } catch (e) { /* */ } }
  },
};
