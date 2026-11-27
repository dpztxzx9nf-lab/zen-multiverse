// Every setting the settings page shows, in one list: tab, group, label, tooltip, kind and range.
// The page, the search box, reset-per-tab, tooltips and gamepad navigation are generated from it.
// kind: slider (with a typed number box) | toggle | choice | select | key | padbtn | custom
// display: true -> a "Keep these display settings?" 10 s countdown after changing it.
import { ACTION_GROUPS, PAD_NAMES, PRESETS } from './settings.js';
export { PRESETS };

export const TABS = [
  ['mouse', 'Mouse'], ['controller', 'Controller'], ['keybinds', 'Keybinds'], ['video', 'Video'], ['camera', 'Camera'],
  ['audio', 'Audio'], ['hud', 'HUD'], ['gameplay', 'Gameplay'], ['access', 'Access'],
];
// which saved sections each tab's "Reset tab" restores (keybinds resets per category on its own page)
export const TAB_SECTIONS = { mouse: ['mouse'], controller: ['pad', 'touch'], keybinds: ['keys'], video: ['video'], camera: ['camera'], audio: ['audio'], hud: ['hud'], gameplay: ['gameplay'], access: ['access'] };

const TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export const FPS_OPTS = [['smart', 'Smart'], [30, '30'], [60, '60'], [120, '120'], [144, '144'], [165, '165'], [240, '240'], [0, 'Unlimited']];
export const RES_OPTS = [['native', 'Fit window'], ['1280x720', '1280 × 720'], ['1600x900', '1600 × 900'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160']];

const I = [];
const add = (tab, group, items) => { for (const it of items) I.push({ tab, group, ...it }); };

// ---- Mouse
add('mouse', 'Sensitivity', [
  { p: 'mouse.sens', label: 'Sensitivity', kind: 'slider', min: 0.01, max: 3, step: 0.001, dec: 3, tip: 'Valorant scale: 0.07° of turn per mouse count at 1.000. Type an exact value in the box. Your cm/360 is shown below.', tags: 'sens mouse look aim valorant', dis: (S) => S.mouse.xy && 'Using separate X / Y below' },
  { p: 'mouse.xy', label: 'Separate X and Y', kind: 'toggle', tip: 'Set horizontal and vertical sensitivity on their own (some players like a slower vertical).' },
  { p: 'mouse.sensX', label: 'Horizontal (X)', kind: 'slider', min: 0.01, max: 3, step: 0.001, dec: 3, show: (S) => S.mouse.xy, tip: 'Turning left and right.' },
  { p: 'mouse.sensY', label: 'Vertical (Y)', kind: 'slider', min: 0.01, max: 3, step: 0.001, dec: 3, show: (S) => S.mouse.xy, tip: 'Looking up and down.' },
  { p: 'mouse.ads', label: 'ADS multiplier', kind: 'slider', min: 0.1, max: 2, step: 0.01, dec: 2, tip: 'Sensitivity while aiming (secondary use held), as a multiple of your hip sensitivity. 1.00 = same as hip.', tags: 'aim down sights zoom' },
  { p: 'mouse.scope', label: 'Scoped multiplier', kind: 'slider', min: 0.1, max: 2, step: 0.01, dec: 2, tip: 'For high-zoom scopes, when tools get them. Multiple of hip sensitivity.', tags: 'sniper zoom' },
  { id: 'mouse.convert', label: 'Same as another game', kind: 'custom', tip: 'Pick your game, type the in-game sensitivity, and it is converted to the same cm/360 here (same DPI).', tags: 'fortnite cod call of duty apex cs2 overwatch valorant cm/360 convert dpi edpi' },
]);
add('mouse', 'Input', [
  { p: 'mouse.raw', label: 'Raw input', kind: 'toggle', tip: 'Reads the mouse sensor directly while the cursor is locked: no Windows pointer acceleration or "Enhance pointer precision".', tags: 'acceleration accel unadjusted' },
  { p: 'mouse.invertY', label: 'Invert vertical look', kind: 'toggle', tip: 'Mouse forward looks down.' },
  { p: 'mouse.lock', label: 'Lock the mouse while playing', kind: 'toggle', tip: 'Click the game to capture the cursor for FPS-style aiming; Esc releases it. Off: drag to look.', tags: 'pointer lock capture cursor fps' },
  { p: 'mouse.dpi', label: 'Mouse DPI', kind: 'slider', min: 100, max: 6400, step: 50, dec: 0, tip: 'Only used to show cm/360 and convert from other games. Set it in your mouse software.', tags: 'cpi' },
]);
// ---- Controller
add('controller', 'Look', [
  { id: 'pad.status', label: 'Controller', kind: 'custom', tip: 'Any standard controller (Xbox, PlayStation, Switch Pro) over USB or Bluetooth.' },
  { p: 'pad.enabled', label: 'Use controller', kind: 'toggle', tip: 'Turn off if a connected pad is drifting.' },
  { p: 'pad.sensX', label: 'Look sensitivity X', kind: 'slider', min: 0.1, max: 4, step: 0.01, dec: 2, tip: 'Horizontal turn speed at full stick.' },
  { p: 'pad.sensY', label: 'Look sensitivity Y', kind: 'slider', min: 0.1, max: 4, step: 0.01, dec: 2, tip: 'Vertical turn speed at full stick.' },
  { p: 'pad.ads', label: 'ADS sensitivity', kind: 'slider', min: 0.1, max: 2, step: 0.01, dec: 2, tip: 'Multiple of look sensitivity while aiming (LT by default).' },
  { p: 'pad.curve', label: 'Response curve', kind: 'choice', opts: [['linear', 'Linear'], ['exponential', 'Exponential'], ['dynamic', 'Dynamic']], tip: 'Linear: stick travel = turn speed. Exponential: fine control near the centre, fast at the edge. Dynamic: a blend.', tags: 'look curve' },
  { p: 'pad.curveK', label: 'Curve strength', kind: 'slider', min: 1.2, max: 3.5, step: 0.05, dec: 2, show: (S) => S.pad.curve !== 'linear', tip: 'Exponent of the curve. 2.00 is the common default.' },
  { p: 'pad.invertY', label: 'Invert vertical look', kind: 'toggle', tip: 'Stick up looks down.' },
]);
add('controller', 'Deadzones', [
  { p: 'pad.leftIn', label: 'Left stick inner', kind: 'slider', min: 0, max: 0.4, step: 0.01, dec: 2, pc: true, tip: 'Stick travel ignored around the centre. Raise it if you drift while not touching the stick.', tags: 'deadzone drift' },
  { p: 'pad.leftOut', label: 'Left stick outer', kind: 'slider', min: 0.6, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Stick travel that already counts as full. Lower it if your stick never quite reaches max speed.', tags: 'deadzone' },
  { p: 'pad.rightIn', label: 'Right stick inner', kind: 'slider', min: 0, max: 0.4, step: 0.01, dec: 2, pc: true, tip: 'Look stick: travel ignored around the centre.', tags: 'deadzone drift' },
  { p: 'pad.rightOut', label: 'Right stick outer', kind: 'slider', min: 0.6, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Look stick: travel that already counts as full.', tags: 'deadzone' },
  { id: 'pad.sticks', label: 'Live stick test', kind: 'custom', tip: 'Shows where the game reads your sticks after the deadzones.' },
]);
add('controller', 'Feel', [
  { p: 'pad.aimAssist', label: 'Aim assist', kind: 'toggle', dis: () => 'Off in PvE', tip: 'Reserved for future PvP modes. There is no aim assist in this world.' },
  { p: 'pad.vibration', label: 'Vibration', kind: 'toggle', tip: 'Rumble on actions.', tags: 'rumble haptics' },
  { p: 'pad.vibStrength', label: 'Vibration strength', kind: 'slider', min: 0.1, max: 1, step: 0.05, dec: 2, pc: true, show: (S) => S.pad.vibration, tip: 'How strong the rumble is.' },
]);
add('controller', 'Buttons', ACTION_GROUPS.flatMap(([, , acts]) => acts.filter(([a]) => !['forward', 'back', 'left', 'right'].includes(a) && !/^slot[2-9]$/.test(a)).map(([a, label]) => ({ id: 'padbtn.' + a, a, label, kind: 'padbtn', tip: `Press a controller button for "${label}". ${PAD_NAMES.length} buttons can be mapped.`, tags: 'remap button controller' }))));
add('controller', 'Touch', [
  { p: 'touch.side', label: 'Joystick side', kind: 'choice', opts: [['left', 'Left'], ['right', 'Right']], tip: 'Which thumb walks on a phone or tablet.' },
  { p: 'touch.joySize', label: 'Joystick size', kind: 'slider', min: 0.7, max: 1.5, step: 0.05, dec: 2, pc: true, tip: 'Size of the floating joystick.' },
  { p: 'touch.sens', label: 'Touch look sensitivity', kind: 'slider', min: 0.3, max: 2.5, step: 0.05, dec: 2, tip: 'Drag-to-look speed on touch screens.' },
  { p: 'touch.twoFingerPause', label: 'Two-finger tap pauses', kind: 'toggle', tip: 'Tap with two fingers at once to open this menu.' },
]);
// ---- Keybinds: one row per action, grouped by category (each with its own reset)
for (const [cat, title, acts] of ACTION_GROUPS) add('keybinds', title, acts.map(([a, label]) => ({ id: 'key.' + a, a, cat, label, kind: 'key', tip: 'Click a slot, then press a key, mouse button or scroll the wheel. Backspace clears it, Esc cancels.', tags: 'bind key ' + a })));
// ---- Video
add('video', 'Display', [
  { p: 'video.display', label: 'Display mode', kind: 'choice', display: true, opts: [['fullscreen', 'Fullscreen'], ['borderless', 'Borderless'], ['windowed', 'Windowed']], tip: TAURI ? 'Fullscreen takes the whole monitor; borderless is a maximised window with no frame (fast alt-tab); windowed keeps the title bar.' : 'In a browser, fullscreen and borderless both use the browser\'s fullscreen.', tags: 'fullscreen window borderless' },
  { p: 'video.resolution', label: 'Window size', kind: 'select', display: true, opts: RES_OPTS, dis: (S) => (!TAURI ? 'Desktop app only' : S.video.display !== 'windowed' && 'Windowed mode only'), tip: 'Size of the game window in windowed mode. For the 3D resolution itself use Render scale.', tags: 'resolution' },
  { p: 'video.renderScale', label: 'Render scale', kind: 'slider', display: true, min: 0.5, max: 1.5, step: 0.05, dec: 2, pc: true, tip: 'Resolution of the 3D view relative to the window. Below 100% is faster and softer; above 100% supersamples (sharper, slower).', tags: 'resolution supersample' },
  { p: 'video.fpsCap', label: 'Frame rate limit', kind: 'choice', opts: FPS_OPTS, tip: 'Caps how often frames are drawn. Smart runs at full speed while you move, 60 when the view is still, 30 in the background and pauses when minimized (cooler and quieter). Unlimited runs as fast as the display allows.', tags: 'fps cap frame limit hz' },
  { p: 'video.vsync', label: 'VSync', kind: 'toggle', dis: () => 'Always on in the game window', tip: 'The game window is always synced to your monitor (no tearing). Set the frame limit to your refresh rate for the lowest latency.' },
  { p: 'video.fov', label: 'Field of view', kind: 'slider', min: 70, max: 120, step: 1, dec: 0, unit: '° H', tip: 'Horizontal FOV (like Call of Duty / Apex). 103° horizontal is about 70° vertical at 16:9. Wider sees more but things look smaller.', tags: 'fov horizontal' },
  { p: 'video.brightness', label: 'Brightness', kind: 'slider', min: 0.6, max: 1.5, step: 0.01, dec: 2, pc: true, tip: 'Overall brightness of the 3D view.' },
  { p: 'video.gamma', label: 'Gamma', kind: 'slider', min: 0.6, max: 1.6, step: 0.01, dec: 2, tip: 'Lifts or deepens the shadows without blowing out the brights. 1.00 is neutral.' },
  { p: 'video.perf', label: 'Performance overlay', kind: 'choice', opts: [['off', 'Off'], ['fps', 'FPS'], ['full', 'FPS + frame time']], tip: 'Shows frames per second, and optionally frame time and draw calls, in the corner.', tags: 'fps counter frametime stats' },
]);
add('video', 'Quality', [
  { p: 'video.preset', label: 'Quality preset', kind: 'choice', opts: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']], tip: 'Sets all the options below at once. Changing any one of them switches to Custom.', tags: 'graphics' },
  { p: 'video.shadows', label: 'Shadows', kind: 'choice', opts: [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']], tip: 'Shadow on/off and shadow-map resolution.' },
  { p: 'video.viewDist', label: 'View distance', kind: 'slider', min: 0.5, max: 1.5, step: 0.05, dec: 2, pc: true, tip: 'How far plants, rocks and detail are drawn.', tags: 'draw distance lod' },
  { p: 'video.textures', label: 'Texture filtering', kind: 'choice', opts: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], tip: 'Anisotropic filtering: keeps ground textures sharp at grazing angles.', tags: 'anisotropic textures' },
  { p: 'video.aa', label: 'Anti-aliasing', kind: 'choice', opts: [['smaa', 'SMAA'], ['fxaa', 'FXAA'], ['off', 'Off']], tip: 'Smooths jagged edges. SMAA is sharper; FXAA is cheaper and softer.', tags: 'aa jaggies' },
  { p: 'video.ao', label: 'Ambient occlusion', kind: 'toggle', tip: 'Soft contact shadows where things meet (garden). Costs GPU time.', tags: 'ao ssao' },
  { p: 'video.bloom', label: 'Bloom', kind: 'toggle', tip: 'Glow around bright lights and the sun (garden).', tags: 'glow' },
  { p: 'video.motionBlur', label: 'Motion blur', kind: 'toggle', dis: () => 'Off: competitive default', tip: 'There is no motion blur: it hides detail when you turn.', tags: 'blur' },
  { p: 'video.filmGrain', label: 'Film grain', kind: 'toggle', tip: 'A fine photographic grain over the image.', tags: 'noise' },
]);
// ---- Camera
add('camera', 'View', [
  { p: 'camera.view', label: 'Default view', kind: 'choice', opts: [['first', 'First person'], ['third', 'Third person']], tip: 'The view you start in. The "First / third person" key (V) switches while playing.', tags: 'fpp tpp perspective' },
  { p: 'camera.shoulder', label: 'Shoulder', kind: 'choice', opts: [['right', 'Right'], ['left', 'Left']], tip: 'Which shoulder the third-person camera sits over. The "Swap shoulder" key (X) switches while playing.' },
  { p: 'camera.distance', label: 'Third-person distance', kind: 'slider', min: 1.5, max: 6, step: 0.1, dec: 1, unit: 'm', tip: 'How far behind you the third-person camera sits.' },
]);
add('camera', 'Motion', [
  { p: 'camera.bob', label: 'Head bob', kind: 'toggle', tip: 'A small step rhythm in first person.' },
  { p: 'camera.bobStrength', label: 'Head bob strength', kind: 'slider', min: 0.1, max: 1.5, step: 0.05, dec: 2, pc: true, show: (S) => S.camera.bob, tip: 'How much the view moves with each step.' },
  { p: 'camera.fovKick', label: 'Speed FOV effect', kind: 'slider', min: 0, max: 1.5, step: 0.05, dec: 2, pc: true, tip: 'The view widens a little when you sprint, slide or dash. 0% keeps the FOV fixed.', tags: 'fov kick' },
  { p: 'camera.lean', label: 'Camera lean', kind: 'toggle', tip: 'A touch of roll into strafes and slides.' },
  { p: 'camera.landDip', label: 'Landing dip', kind: 'toggle', tip: 'The view dips when you land from a height.' },
  { p: 'camera.shake', label: 'Camera shake', kind: 'slider', min: 0, max: 1, step: 0.05, dec: 2, pc: true, tip: 'Shake from landings, launches and future weapons. 0% turns it off.' },
]);
// ---- Audio
add('audio', 'Volume', [
  { p: 'audio.master', label: 'Master', kind: 'slider', min: 0, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Everything.' },
  { p: 'audio.music', label: 'Music', kind: 'slider', min: 0, max: 1, step: 0.01, dec: 2, pc: true, tip: 'The score.' },
  { p: 'audio.ambience', label: 'Ambience', kind: 'slider', min: 0, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Wind, water, birds, the base hum.' },
  { p: 'audio.effects', label: 'Effects', kind: 'slider', min: 0, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Footsteps, tools, the rocket, UI.', tags: 'sfx' },
  { p: 'audio.voice', label: 'Voice', kind: 'slider', min: 0, max: 1, step: 0.01, dec: 2, pc: true, tip: 'Ilo and other voices.' },
]);
add('audio', 'Output', [
  { p: 'audio.device', label: 'Output device', kind: 'select', opts: [['default', 'System default']], tip: 'Where the game plays sound. Headset names appear once the game has been allowed to see devices.', tags: 'headphones speakers headset' },
  { p: 'audio.muteUnfocused', label: 'Mute when in background', kind: 'toggle', tip: 'Silence the game while another window is in front.', tags: 'alt tab focus' },
  { p: 'audio.subtitles', label: 'Subtitles', kind: 'toggle', tip: 'Captions for voices, sounds and whispers (bells, splashes, the rocket, the ship).', tags: 'captions' },
]);
// ---- HUD
add('hud', 'Crosshair', [{ id: 'hud.maker', label: 'Crosshair', kind: 'custom', tip: 'Pick a crosshair or make your own.', tags: 'reticle focal point dot' }]);
add('hud', 'Hit marker', [
  { p: 'hud.hit.style', label: 'Hit marker', kind: 'choice', opts: [['x', 'Cross'], ['ring', 'Ring'], ['dot', 'Dot'], ['off', 'Off']], tip: 'The mark that flashes over the crosshair when a hit lands (for tools and future weapons).', tags: 'hitmarker' },
  { p: 'hud.hit.color', label: 'Hit marker colour', kind: 'choice', opts: [['#f4f1ea', 'White'], ['#ff4655', 'Red'], ['#ffe14d', 'Yellow'], ['#4dfcff', 'Cyan'], ['#9dff6e', 'Green']], tip: 'Pick a colour that stands out on your screen.' },
  { p: 'hud.hit.size', label: 'Hit marker size', kind: 'slider', min: 0.5, max: 2, step: 0.05, dec: 2, pc: true, tip: 'Size of the hit marker.' },
  { p: 'hud.hit.ms', label: 'Hit marker time', kind: 'slider', min: 80, max: 600, step: 10, dec: 0, unit: 'ms', tip: 'How long it stays up.' },
  { p: 'hud.hit.sound', label: 'Hit sound', kind: 'toggle', tip: 'A short tick when a hit lands.' },
  { id: 'hud.hitTest', label: 'Preview', kind: 'custom', tip: 'Flash a hit marker now.' },
]);
add('hud', 'Layout', [
  { p: 'hud.scale', label: 'HUD size', kind: 'slider', min: 0.75, max: 1.5, step: 0.05, dec: 2, pc: true, tip: 'Size of the HUD and menus.' },
  { p: 'hud.opacity', label: 'HUD opacity', kind: 'slider', min: 0.2, max: 1, step: 0.05, dec: 2, pc: true, tip: 'How solid the HUD is.' },
  { p: 'hud.safe', label: 'Safe area', kind: 'slider', min: 0, max: 0.1, step: 0.005, dec: 3, pc: true, tip: 'Pulls the HUD in from the screen edges (for TVs that crop the edge).', tags: 'overscan margin' },
  { p: 'hud.minimap', label: 'Minimap', kind: 'toggle', tip: 'A small north-up map in the top corner. The full map is on N.', tags: 'radar' },
]);
add('hud', 'Show', [
  { p: 'hud.show.crosshair', label: 'Crosshair', kind: 'toggle', tip: 'Show the crosshair.' },
  { p: 'hud.show.prompt', label: 'Action word under it', kind: 'toggle', tip: 'The word that says what E will do.' },
  { p: 'hud.show.toasts', label: 'Messages', kind: 'toggle', tip: 'Short messages at the top.' },
  { p: 'hud.show.buttons', label: 'Corner buttons', kind: 'toggle', tip: 'The bag, map and drift stones.' },
  { p: 'hud.show.saved', label: 'Saved leaf', kind: 'toggle', tip: 'The small leaf when the game saves.' },
  { p: 'hud.show.hint', label: 'Next-step hints', kind: 'toggle', tip: 'Whispers about what to do next.' },
]);
// ---- Gameplay
add('gameplay', 'Movement', [
  { p: 'gameplay.autoSprint', label: 'Auto-sprint', kind: 'toggle', tip: 'Always run when moving; the sprint key walks instead.', tags: 'run' },
  { p: 'gameplay.sprintMode', label: 'Sprint', kind: 'choice', opts: [['hold', 'Hold'], ['toggle', 'Toggle']], tip: 'Hold the key, or tap once to start and again to stop.', tags: 'run' },
  { p: 'gameplay.crouchMode', label: 'Crouch', kind: 'choice', opts: [['hold', 'Hold'], ['toggle', 'Toggle']], tip: 'Hold the key, or tap to crouch and tap to stand. Crouch while sprinting to slide.' },
  { p: 'gameplay.autoMantle', label: 'Climb ledges automatically', kind: 'toggle', tip: 'Walk into a ledge you can reach and you climb it; off: jump at it.', tags: 'mantle' },
]);
add('gameplay', 'Game', [
  { p: 'gameplay.language', label: 'Language', kind: 'select', opts: [['en', 'English']], tip: 'More languages later.' },
  { id: 'gameplay.tutorial', label: 'First-walk tips', kind: 'custom', tip: 'Show the five first-walk tips again.' },
]);
// ---- Access
add('access', 'Seeing', [
  { p: 'access.colorblind', label: 'Colour filter', kind: 'choice', opts: [['none', 'None'], ['protan', 'Protan'], ['deutan', 'Deutan'], ['tritan', 'Tritan'], ['mono', 'Grey']], tip: 'Shifts reds, greens and blues apart for colour-blind eyes.', tags: 'colorblind daltonize' },
  { p: 'access.textSize', label: 'Text size', kind: 'slider', min: 0.85, max: 1.6, step: 0.05, dec: 2, pc: true, tip: 'Size of menu and HUD text.' },
]);
add('access', 'Moving', [{ p: 'access.reduceMotion', label: 'Reduce motion', kind: 'toggle', tip: 'No head bob or camera shake, gentler fades.' }]);

for (const it of I) { it.id = it.id || it.p; it.search = `${it.label} ${it.group} ${it.tab} ${it.tip || ''} ${it.tags || ''}`.toLowerCase(); }
export const ITEMS = I;
