// Game input layer on top of session.js: every bound action (keyboard, mouse buttons, the wheel,
// gamepad) becomes zen.emitAction({ action, down, source }) for systems that want it (hotbar,
// tools, view toggle). Sprint and crouch follow the hold / toggle / auto-sprint settings.
// Keyboard actions the world already knows (E, R, Space, B, M, N, Esc...) still run through
// session.js; mouse buttons and the wheel only count while the pointer is locked (FPS mode), so a
// click on the canvas or the HUD never doubles up as a bound action.
import { settings, zen, onChange } from './settings.js';
import { moveState } from './player.js';

export function createInput({ runAction, isLegacy, menuOpen }) {
  let byCode = new Map();
  function rebuild() {
    byCode = new Map();
    for (const [a, codes] of Object.entries(settings.keys)) for (const c of codes || []) { if (!byCode.has(c)) byCode.set(c, []); byCode.get(c).push(a); }
  }
  rebuild();
  onChange((p) => { if (p === '*' || p === 'keys') rebuild(); if (p === '*' || p.startsWith('gameplay')) { if (settings.gameplay.sprintMode === 'hold') zen.toggles.sprint = false; if (settings.gameplay.crouchMode === 'hold') zen.toggles.crouch = false; sprint(); } });
  const sprint = () => { const on = !!zen.toggles.sprint; moveState.sprint = settings.gameplay.autoSprint ? !on : on ? true : null; };
  sprint();
  const held = new Set();
  function action(a, down, source) {
    const key = a + ':' + source;
    if (down) { if (held.has(key)) return; held.add(key); } else { if (!held.has(key)) return; held.delete(key); }
    if (a === 'sprint' || a === 'crouch') {
      const mode = a === 'sprint' ? settings.gameplay.sprintMode : settings.gameplay.crouchMode;
      if (mode === 'toggle') { if (down) zen.toggles[a] = !zen.toggles[a]; } else zen.toggles[a] = down;
      if (a === 'crouch' && zen.toggles.crouch && settings.gameplay.sprintMode === 'toggle') zen.toggles.sprint = false;
      if (a === 'sprint') sprint();
    }
    if (a === 'use2') zen.aiming = down;
    if (down && a === 'view') zen.state.view = zen.state.view === 'first' ? 'third' : 'first';
    if (down && a === 'shoulder') zen.state.shoulder = zen.state.shoulder === 'right' ? 'left' : 'right';
    zen.emitAction(a, down, source);
  }
  const typing = (e) => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  addEventListener('keydown', (e) => { if (e.repeat || typing(e) || menuOpen()) return; for (const a of byCode.get(e.code) || []) action(a, true, 'key'); });
  addEventListener('keyup', (e) => { for (const a of byCode.get(e.code) || []) action(a, false, 'key'); });
  // the hold-sprint keys are released when the window loses focus
  addEventListener('blur', () => { for (const k of [...held]) { const [a, s] = k.split(':'); action(a, false, s); } });
  const locked = () => !!document.pointerLockElement;
  addEventListener('mousedown', (e) => {
    if (!locked() || menuOpen()) return;
    for (const a of byCode.get('Mouse' + e.button) || []) { action(a, true, 'mouse'); if (isLegacy(a)) runAction(a); }
  });
  addEventListener('mouseup', (e) => { for (const a of byCode.get('Mouse' + e.button) || []) action(a, false, 'mouse'); });
  addEventListener('wheel', (e) => {
    if (!locked() || menuOpen() || !e.deltaY) return;
    for (const a of byCode.get(e.deltaY < 0 ? 'WheelUp' : 'WheelDown') || []) { action(a, true, 'wheel'); action(a, false, 'wheel'); if (isLegacy(a)) runAction(a); }
  }, { passive: true });
  return { action, rebuild };
}
