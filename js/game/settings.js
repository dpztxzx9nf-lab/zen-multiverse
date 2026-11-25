// Game settings: one slice of the single save (garden-save.slices.gameSettings), mirrored to the
// Tauri app-data folder with the rest of the save. Three parts:
//   1. DEF: the defaults (competitive-shooter shaped: mouse, controller, keybinds, video, camera,
//      audio, HUD, gameplay, access), with migrations from older saves
//   2. ITEMS: one entry per setting (tab, group, label, tooltip, kind, range) — the settings page,
//      search, reset-per-tab and gamepad navigation are all generated from it
//   3. zen: the single API other systems read (movement, character, weapons): look scales, ADS,
//      stick curves, FOV, view mode, camera, toggles. Also on window.zenSettings.
import { slice, persist } from '../save.js';

// ---------------------------------------------------------------- actions + default binds
// codes: KeyboardEvent.code, 'Mouse0'..'Mouse4', 'WheelUp' / 'WheelDown'
export const ACTION_GROUPS = [
  ['movement', 'Movement', [['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Strafe left'], ['right', 'Strafe right'], ['jump', 'Jump'], ['sprint', 'Sprint'], ['crouch', 'Crouch']]],
  ['actions', 'Actions', [['use1', 'Primary use / fire'], ['use2', 'Secondary use / aim'], ['act', 'Interact / tend'], ['alt', 'Second action'], ['tool', 'Put away tool']]],
  ['hotbar', 'Hotbar', [...Array.from({ length: 9 }, (_, i) => [`slot${i + 1}`, `Hotbar slot ${i + 1}`]), ['slotNext', 'Next slot'], ['slotPrev', 'Previous slot']]],
  ['camera', 'Camera', [['view', 'First / third person'], ['shoulder', 'Swap shoulder']]],
  ['menus', 'Menus', [['bag', 'Bag'], ['map', 'Star map'], ['worldmap', 'World map'], ['drift', 'Drift camera'], ['pause', 'Pause menu']]],
];
export const ACTIONS = ACTION_GROUPS.flatMap(([, , a]) => a);
export const ACTION_NAME = Object.fromEntries(ACTIONS);
export const DEFAULT_KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft'], crouch: ['ControlLeft', 'KeyC'],
  use1: ['Mouse0'], use2: ['Mouse2'], act: ['KeyE', 'Enter'], alt: ['KeyR'], tool: ['KeyQ'],
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`slot${i + 1}`, [`Digit${i + 1}`]])),
  slotNext: ['WheelDown'], slotPrev: ['WheelUp'],
  view: ['KeyV'], shoulder: ['KeyX'],
  bag: ['Tab', 'KeyB'], map: ['KeyM'], worldmap: ['KeyN'], drift: ['KeyG'], pause: ['Escape', 'KeyP'],
};
// standard-mapping gamepad buttons
export const PAD_NAMES = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Share', 'Menu / Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
export const DEFAULT_PAD = { jump: 0, crouch: 1, act: 2, alt: 3, slotPrev: 4, slotNext: 5, use2: 6, use1: 7, map: 8, pause: 9, sprint: 10, view: 11, worldmap: 12, drift: 13, bag: 14, tool: 15 };

// video quality presets (the settings page sets these together; any single change makes it Custom)
export const PRESETS = {
  low: { shadows: 'off', viewDist: 0.6, textures: 'low', aa: 'fxaa', ao: false, bloom: false },
  medium: { shadows: 'low', viewDist: 0.85, textures: 'medium', aa: 'fxaa', ao: false, bloom: true },
  high: { shadows: 'high', viewDist: 1, textures: 'high', aa: 'smaa', ao: true, bloom: true },
  ultra: { shadows: 'ultra', viewDist: 1.3, textures: 'high', aa: 'smaa', ao: true, bloom: true },
};

const DEF = () => ({
  v: 2,
  mouse: { sens: 0.4, xy: false, sensX: 0.4, sensY: 0.4, ads: 1, scope: 1, raw: true, invertY: false, dpi: 800 },
  pad: {
    enabled: true, sensX: 1, sensY: 0.8, ads: 0.65, curve: 'exponential', curveK: 2, invertY: false,
    leftIn: 0.1, leftOut: 0.98, rightIn: 0.1, rightOut: 0.98, aimAssist: false, vibration: true, vibStrength: 0.6,
    buttons: { ...DEFAULT_PAD },
  },
  touch: { side: 'left', joySize: 1, sens: 1, twoFingerPause: true },
  keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)),
  video: {
    display: 'windowed', resolution: 'native', renderScale: 1, fpsCap: 0, vsync: true, fov: 103,
    preset: 'high', shadows: 'high', viewDist: 1, textures: 'high', aa: 'smaa', ao: true, bloom: true,
    motionBlur: false, filmGrain: false, brightness: 1, gamma: 1, perf: 'off',
  },
  camera: { view: 'first', shoulder: 'right', distance: 3.2, bob: true, bobStrength: 1, shake: 0.6 },
  audio: { master: 1, music: 0.8, ambience: 1, effects: 1, voice: 1, device: 'default', muteUnfocused: true, subtitles: true },
  hud: {
    crosshair: 'dot', customs: [], scale: 1, opacity: 1, safe: 0, minimap: true,
    hit: { style: 'x', color: '#f4f1ea', size: 1, ms: 260, sound: true },
    show: { crosshair: true, prompt: true, toasts: true, buttons: true, saved: true, hint: true },
  },
  gameplay: { autoSprint: false, sprintMode: 'hold', crouchMode: 'hold', language: 'en' },
  access: { colorblind: 'none', textSize: 1, reduceMotion: false },
});
// v1 (g6) -> v2: controls.* moved to mouse / pad / touch / keys; video.quality -> preset; subtitles -> audio
function migrate(S) {
  if (S.v >= 2) return S;
  const C = S.controls || {}, V = S.video || {}, A = S.access || {};
  const d = DEF();
  if (C.keys) { const k = { ...d.keys }; for (const [a, codes] of Object.entries(C.keys)) { const n = a === 'run' ? 'sprint' : a; if (k[n] && Array.isArray(codes) && codes.length) k[n] = codes.slice(); } S.keys = k; }
  S.mouse = { ...d.mouse, invertY: !!C.invertY, sens: Math.round(0.4 * (C.sens || 1) * 1000) / 1000 };
  S.mouse.sensX = S.mouse.sensY = S.mouse.sens;
  if (C.pad) S.pad = { ...d.pad, enabled: C.pad.enabled !== false, sensX: C.pad.sens || 1, sensY: (C.pad.sens || 1) * 0.8, invertY: !!C.pad.invertY, vibration: C.pad.vibration !== false, leftIn: C.pad.deadzone || 0.1, rightIn: C.pad.deadzone || 0.1 };
  if (C.touch) S.touch = { ...d.touch, ...C.touch };
  if (V.quality) {
    const pr = V.quality === 'auto' || !PRESETS[V.quality] ? 'high' : V.quality;
    S.video = { ...d.video, ...PRESETS[pr], preset: pr, renderScale: V.renderScale || 1, fpsCap: V.fpsCap || 0 };
    if (V.ao === false) S.video.ao = false; if (V.shadows === false) S.video.shadows = 'off';
    if (V.ao === false || V.shadows === false) S.video.preset = 'custom';
  }
  if (V.bob === false) S.camera = { ...d.camera, bob: false };
  if (A.subtitles === false) S.audio = { ...(S.audio || d.audio), subtitles: false };
  delete S.controls; if (S.access) delete S.access.subtitles;
  if (S.video) delete S.video.quality;
  S.v = 2; return S;
}
function merge(into, def) {
  for (const [k, v] of Object.entries(def)) {
    if (into[k] === undefined || (v && typeof v === 'object' && !Array.isArray(v) && (typeof into[k] !== 'object' || into[k] === null))) into[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'buttons') merge(into[k], v);
  }
  return into;
}
const S = merge(migrate(slice('gameSettings', DEF)), DEF());
export const settings = S;
export const defaults = DEF;
const listeners = new Set();
export function get(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
export function set(path, value, { silent = false } = {}) {
  const ks = path.split('.'); const last = ks.pop();
  const o = ks.reduce((a, k) => (a[k] = a[k] || {}), S);
  o[last] = value; persist(400);
  if (!silent) for (const fn of listeners) { try { fn(path, value); } catch (e) { console.warn('[settings]', e); } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function reset(section) {
  const d = DEF();
  if (section) S[section] = d[section]; else for (const k of Object.keys(d)) S[k] = d[k];
  persist(200);
  for (const fn of listeners) { try { fn(section || '*', null); } catch (e) { /* */ } }
}
export function keyName(code) {
  if (!code) return '';
  const M = { Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel up', WheelDown: 'Wheel down', Escape: 'Esc', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', ShiftLeft: 'Shift', ShiftRight: 'R Shift', AltLeft: 'Alt', AltRight: 'R Alt', Backquote: '`', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps' };
  return M[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
// actions sharing a key (for warnings): { code: [action, ...] } where more than one
export function conflicts(keys = S.keys) {
  const by = {};
  for (const [a, codes] of Object.entries(keys)) for (const c of codes || []) (by[c] = by[c] || []).push(a);
  return Object.fromEntries(Object.entries(by).filter(([, l]) => l.length > 1));
}

// ---------------------------------------------------------------- sensitivity maths
// Native mouse unit is Valorant-shaped: 0.07° of turn per mouse count at 1.0, so 0.4 at 800 DPI = 40.8 cm/360.
export const YAW = 0.07;
export const GAMES = [
  ['valorant', 'Valorant', 0.07], ['fortnite', 'Fortnite (%)', 0.005555], ['cod', 'Call of Duty (MW / Warzone)', 0.0066],
  ['apex', 'Apex Legends', 0.022], ['cs2', 'Counter-Strike 2', 0.022], ['overwatch', 'Overwatch 2', 0.0066],
];
export const fromGame = (game, sens) => { const g = GAMES.find((x) => x[0] === game); return g ? (sens * g[2]) / YAW : sens; };
export const toGame = (game, sens) => { const g = GAMES.find((x) => x[0] === game); return g ? (sens * YAW) / g[2] : sens; };
export const cm360 = (sens, dpi = S.mouse.dpi) => (360 / (sens * YAW * dpi)) * 2.54;
const D2R = Math.PI / 180;
function curve(v, kind, k) {
  const a = Math.abs(v); if (!a) return 0;
  const c = kind === 'linear' ? a : kind === 'dynamic' ? 0.5 * a + 0.5 * Math.pow(a, k + 1) : Math.pow(a, k);
  return Math.sign(v) * c;
}
function deadzone(x, y, inner, outer) {
  const m = Math.hypot(x, y); if (m <= inner) return [0, 0];
  const t = Math.min(1, (m - inner) / Math.max(0.01, outer - inner));
  return [(x / m) * t, (y / m) * t];
}

// ---------------------------------------------------------------- the one API other systems read
const toggles = { sprint: false, crouch: false };
const actionFns = new Set();
export const zen = {
  settings: S, get, set, on: onChange,
  // radians of [yaw, pitch] for raw mouse counts (pointer-locked movementX / movementY)
  mouseLook(dx, dy, { ads = zen.aiming, scoped = false } = {}) {
    const M = S.mouse, m = scoped ? M.scope : ads ? M.ads : 1;
    const sx = (M.xy ? M.sensX : M.sens) * YAW * D2R * m, sy = (M.xy ? M.sensY : M.sens) * YAW * D2R * m;
    return [dx * sx, dy * sy * (M.invertY ? -1 : 1)];
  },
  // the same idea for an unlocked drag (screen pixels), scaled so the default feels like before
  dragLook(dx, dy) { const M = S.mouse, k = 1 / 0.4; return [dx * (M.xy ? M.sensX : M.sens) * k, dy * (M.xy ? M.sensY : M.sens) * k * (M.invertY ? -1 : 1)]; },
  // a stick after its deadzone (inner/outer, radial) and response curve: [x, y] in -1..1
  stick(x, y, which = 'left') {
    const P = S.pad, [dx, dy] = which === 'left' ? deadzone(x, y, P.leftIn, P.leftOut) : deadzone(x, y, P.rightIn, P.rightOut);
    if (which === 'left') return [dx, dy];
    return [curve(dx, P.curve, P.curveK), curve(dy, P.curve, P.curveK)];
  },
  // right stick -> radians this frame
  padLook(x, y, dt, { ads = zen.aiming } = {}) {
    const P = S.pad, [cx, cy] = zen.stick(x, y, 'right'), m = ads ? P.ads : 1;
    return [cx * 2.6 * P.sensX * m * dt, cy * 1.9 * P.sensY * m * dt * (P.invertY ? -1 : 1)];
  },
  pointerLockOptions() { return S.mouse.raw ? { unadjustedMovement: true } : {}; },
  // field of view: the setting is horizontal (like CoD / Apex); cameras want vertical
  fovH: () => S.video.fov,
  fovV(aspect) { const h = S.video.fov * D2R; return (2 * Math.atan(Math.tan(h / 2) / Math.max(0.3, aspect))) / D2R; },
  // live state while playing: the view / shoulder keys flip these; the settings are the defaults
  state: { view: S.camera.view, shoulder: S.camera.shoulder },
  aiming: false, // secondary use held (mouse or LT): ADS sensitivity applies
  viewMode: () => zen.state.view, shoulder: () => zen.state.shoulder, camDistance: () => S.camera.distance,
  shake: () => (S.access.reduceMotion ? 0 : S.camera.shake), bob: () => (S.camera.bob && !S.access.reduceMotion ? S.camera.bobStrength : 0),
  vibration: () => (S.pad.vibration ? S.pad.vibStrength : 0), aimAssist: () => false,
  sprintMode: () => S.gameplay.sprintMode, crouchMode: () => S.gameplay.crouchMode, autoSprint: () => S.gameplay.autoSprint,
  // hold-or-toggle actions, fed by the input layer: is it on right now?
  toggles,
  isOn(a) { return !!toggles[a]; },
  // every bound action (down/up), for systems that want them: fn({ action, down, source })
  onAction(fn) { actionFns.add(fn); return () => actionFns.delete(fn); },
  emitAction(action, down, source) { for (const f of actionFns) { try { f({ action, down, source }); } catch (e) { console.warn(e); } } },
  cm360, fromGame, toGame, GAMES, keyName, conflicts,
  hitmarker: null, // set by the HUD: zen.hitmarker('hit' | 'kill')
};
onChange((p) => { if (p === '*' || p.startsWith('camera')) { zen.state.view = S.camera.view; zen.state.shoulder = S.camera.shoulder; } });
if (typeof window !== 'undefined') window.zenSettings = zen;
