// Movement settings: one small object the settings UI can wire up (BMSG-9 owns the UI).
//   import { moveSettings, MOVE_SCHEMA } from './move-config.js'
//   moveSettings.get('sens'); moveSettings.set('sens', 1.4); moveSettings.on((key, value) => ...)
// Stored in localStorage 'zen-move'. MOVE_SCHEMA describes each knob (label, type, range) so a
// settings screen can render it without knowing the controller. Tuning constants (speeds, accel)
// live in MOVE below; they are not user settings.
const KEY = 'zen-move';
export const MOVE_SCHEMA = {
  sens: { label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 4, step: 0.05, def: 1 },
  invertY: { label: 'Invert look up/down', type: 'bool', def: false },
  padSens: { label: 'Controller look speed', type: 'range', min: 0.3, max: 3, step: 0.05, def: 1 },
  padInvertY: { label: 'Controller invert Y', type: 'bool', def: false },
  padDeadzone: { label: 'Stick deadzone', type: 'range', min: 0.04, max: 0.3, step: 0.01, def: 0.12 },
  touchSens: { label: 'Touch look speed', type: 'range', min: 0.3, max: 3, step: 0.05, def: 1 },
  fov: { label: 'Field of view', type: 'range', min: 60, max: 110, step: 1, def: 80 },
  fovKick: { label: 'Speed FOV effect', type: 'range', min: 0, max: 1.5, step: 0.05, def: 1 },
  bob: { label: 'Head bob', type: 'bool', def: true },
  lean: { label: 'Camera lean on strafe and slide', type: 'bool', def: true },
  landDip: { label: 'Landing dip', type: 'bool', def: true },
  sprintToggle: { label: 'Sprint: toggle instead of hold', type: 'bool', def: false },
  autoSprint: { label: 'Always sprint', type: 'bool', def: false },
  crouchToggle: { label: 'Crouch: toggle instead of hold', type: 'bool', def: false },
  autoMantle: { label: 'Climb ledges automatically', type: 'bool', def: true },
  haptics: { label: 'Rumble and haptics', type: 'bool', def: true },
  pointerLock: { label: 'Lock the mouse while playing (PC)', type: 'bool', def: true },
};
// tuning: metres, seconds. Speeds follow Apex Legends' holstered values (walk 5.07, sprint 7.6,
// slide 11.4 m/s) eased down a little for a calm world; jump/mantle/coyote from Titanfall-style
// controllers. Per-world scale: earth garden 0.8, moon gravity-scaled jump.
export const MOVE = {
  walk: 4.6, sprint: 7.4, crouch: 2.2, strafeK: 0.92, backK: 0.85,
  groundAccel: 11, friction: 7, stopSpeed: 1.6,
  airAccel: 14, airWishCap: 1.6, airFriction: 0.05,
  jumpHeight: 1.25, airJumps: 1, doubleJumpK: 0.88,
  coyote: 0.12, jumpBuffer: 0.14,
  slideMin: 5.4, slideBoost: 2.6, slideCap: 10.8, slideFriction: 1.15, slideCooldown: 0.7, slideEye: 0.95,
  crouchEye: 1.05, eye: 1.6, radius: 0.32, height: 1.75,
  maxStep: 0.5, maxSlope: 0.85, // tan(slope) we can still walk up (~40°+) beyond the step
  mantleMax: 2.1, mantleTime: 0.36, climbTime: 0.55, climbSpeed: 3.6,
  fovSprint: 6, fovSlide: 9, fovDash: 14,
};
const listeners = new Set();
let vals = {};
try { vals = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { vals = {}; }
// the old head-bob switch (garden-prefs.bob) carries over
try { const old = JSON.parse(localStorage.getItem('garden-prefs') || '{}'); if (old.bob === false && vals.bob === undefined) vals.bob = false; } catch (e) { /* */ }
try { if (new URLSearchParams(location.search).get('bob') === '0') vals.bob = false; } catch (e) { /* */ }
export const moveSettings = {
  get(k) { return vals[k] !== undefined ? vals[k] : MOVE_SCHEMA[k] ? MOVE_SCHEMA[k].def : undefined; },
  set(k, v) { vals[k] = v; try { localStorage.setItem(KEY, JSON.stringify(vals)); } catch (e) { /* */ } for (const fn of listeners) { try { fn(k, v); } catch (e) { /* */ } } },
  reset() { vals = {}; try { localStorage.removeItem(KEY); } catch (e) { /* */ } for (const fn of listeners) fn('*', null); },
  all() { return Object.fromEntries(Object.keys(MOVE_SCHEMA).map((k) => [k, moveSettings.get(k)])); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  schema: MOVE_SCHEMA,
};
