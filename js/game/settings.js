// In-game settings (game only; mom's garden never loads this). One slice of the single save:
//   garden-save.slices.gameSettings = { v, controls, video, audio, hud, access }
// get() returns the live object; set(path, value) writes, saves and tells listeners.
import { slice, persist } from '../save.js';

export const ACTIONS = [
  ['forward', 'Walk forward'], ['back', 'Walk back'], ['left', 'Step left'], ['right', 'Step right'], ['run', 'Hurry'],
  ['jump', 'Hop'], ['act', 'Tend / use'], ['alt', 'Second action'], ['bag', 'Bag'], ['map', 'Star map'],
  ['worldmap', 'World map'], ['drift', 'Drift'], ['tool', 'Put down tool'], ['pause', 'Pause menu'],
  ['crouch', 'Crouch / slide'], ['dash', 'Wind dash'], ['vine', 'Grapple vine'],
];
export const DEFAULT_KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], act: ['KeyE', 'Enter'], alt: ['KeyR'], bag: ['KeyB', 'KeyI', 'Tab'],
  map: ['KeyM'], worldmap: ['KeyN'], drift: ['KeyV'], tool: ['KeyG'], pause: ['Escape', 'KeyP'],
  crouch: ['KeyC'], dash: ['KeyQ'], vine: ['KeyF'],
};
// standard-mapping gamepad buttons (0 A/Cross, 1 B/Circle, 2 X/Square, 3 Y/Triangle, 4 LB, 5 RB, 8 Back, 9 Start, 10 LS)
export const DEFAULT_PAD = { act: 0, jump: 1, alt: 2, bag: 3, drift: 4, worldmap: 5, map: 8, pause: 9, run: 10 };
export const PAD_NAMES = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back / Share', 'Start / Options', 'Left stick', 'Right stick', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];

const DEF = () => ({
  v: 3,
  controls: {
    keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)), sens: 1, invertY: false,
    pad: { enabled: true, deadzone: 0.16, sens: 1, invertY: false, vibration: true, buttons: { ...DEFAULT_PAD } },
    touch: { side: 'left', joySize: 1, sens: 1, twoFingerPause: true },
  },
  video: { quality: 'auto', fov: 70, renderScale: 1, fpsCap: 'smart', shadows: true, ao: true, motionBlur: false, bob: true },
  audio: { master: 1, music: 0.8, ambience: 1, effects: 1, voice: 1 },
  hud: {
    crosshair: 'dot', customs: [], scale: 1, opacity: 1,
    show: { crosshair: true, prompt: true, toasts: true, buttons: true, saved: true, hint: true, fps: false },
  },
  access: { colorblind: 'none', textSize: 1, reduceMotion: false, subtitles: true },
});

function merge(into, def) {
  for (const [k, v] of Object.entries(def)) {
    if (into[k] === undefined || (typeof v === 'object' && v && !Array.isArray(v) && (typeof into[k] !== 'object' || into[k] === null))) into[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) merge(into[k], v);
  }
  return into;
}
const S = merge(slice('gameSettings', DEF), DEF());
// v2 (g7): C crouches/slides, Q dashes, so drift moves to V and 'put down tool' to G
if ((S.v || 1) < 2) { const K = S.controls.keys; if (JSON.stringify(K.drift) === '["KeyC"]') K.drift = ['KeyV']; if (JSON.stringify(K.tool) === '["KeyQ"]') K.tool = ['KeyG']; S.v = 2; }
// v3 (perf): the frame cap default became 'smart' (0 'Off' was only ever the default)
if (S.v < 3) { if (!S.video.fpsCap) S.video.fpsCap = 'smart'; S.v = 3; }
const listeners = new Set();
export const settings = S;
export function get(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
export function set(path, value) {
  const ks = path.split('.'); const last = ks.pop();
  const o = ks.reduce((a, k) => (a[k] = a[k] || {}), S);
  o[last] = value; persist(400);
  for (const fn of listeners) { try { fn(path, value); } catch (e) { console.warn('[settings]', e); } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function reset(section) {
  const d = DEF();
  if (section) { S[section] = d[section]; } else for (const k of Object.keys(d)) S[k] = d[k];
  persist(200);
  for (const fn of listeners) { try { fn(section || '*', null); } catch (e) { /* */ } }
}
export const keyName = (code) => (code || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '↑').replace('↑Up', '↑').replace('↑Down', '↓').replace('↑Left', '←').replace('↑Right', '→').replace(/Left$/, ' L').replace(/Right$/, ' R').replace('Escape', 'Esc');
