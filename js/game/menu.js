// The pause menu (game only): Esc / Start / two-finger tap. Resume, Settings, Journal, Map,
// Milestones, Quit to garden. Settings has its own tabs (Controls, Video, Audio, HUD, Access) and
// everything writes straight into the game's settings slice of garden-save.
import { icon } from './icons.js';
import { CAIRN, brush } from './zen-style.js';
import { settings, set, reset, ACTIONS, PAD_NAMES, keyName } from './settings.js';
import { mountCrosshair } from './crosshair-ui.js';
import { game } from './store.js';
import { nextStep } from './progress.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WORLD_NAME = { earth: 'The garden', moon: 'The moon', planet: 'A far world', space: 'Between worlds' };
const ITEMS = [
  ['resume', 'Resume', 'walk'], ['settings', 'Settings', 'eye'], ['journal', 'Journal', 'book'],
  ['map', 'Map', 'map'], ['milestones', 'Milestones', 'star'], ['quit', 'Quit to garden', 'home'],
];
const STABS = [['controls', 'Controls'], ['video', 'Video'], ['audio', 'Audio'], ['hud', 'HUD'], ['access', 'Access']];

export const MENU_CSS = `
#zen-menu{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease}
#zen-menu.hidden{opacity:0;pointer-events:none}
#zen-menu .zm-veil{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(10,12,12,.25),rgba(6,8,8,.62))}
#zen-menu .zm-card{position:relative;display:flex;width:min(900px,96vw);height:min(620px,90vh);overflow:hidden}
#zen-menu .zm-rail{width:210px;flex:none;padding:22px 10px 16px 16px;display:flex;flex-direction:column;gap:2px;border-right:1px solid rgba(236,222,196,.08)}
#zen-menu .zm-title{display:flex;align-items:center;gap:10px;font-family:var(--serif);font-size:19px;margin:0 0 4px 6px}
#zen-menu .zm-sub{font-size:12px;opacity:.55;margin:0 0 16px 38px;letter-spacing:.04em}
#zen-menu .zm-it{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px 12px 17px 13px / 12px 17px 13px 16px;cursor:pointer;font-family:var(--serif);font-size:16px;opacity:.72}
#zen-menu .zm-it svg{width:18px;height:18px;opacity:.8}
#zen-menu .zm-it:hover,#zen-menu .zm-it.focus{opacity:1;background:rgba(239,230,210,.07)}
#zen-menu .zm-it.on{opacity:1;background:rgba(239,230,210,.1);box-shadow:inset 3px 0 0 rgba(169,196,154,.7)}
#zen-menu .zm-it.quit{margin-top:auto;opacity:.55}
#zen-menu .zm-main{flex:1;display:flex;flex-direction:column;min-width:0}
#zen-menu .zm-tabs{display:flex;gap:2px;padding:16px 18px 0;flex-wrap:wrap}
#zen-menu .zm-tab{padding:8px 12px 10px;cursor:pointer;font-family:var(--serif);font-size:15px;opacity:.6}
#zen-menu .zm-tab.on{opacity:1;background:${brush()} center bottom/86% 9px no-repeat}
#zen-menu .zm-body{flex:1;overflow:auto;padding:10px 22px 22px;touch-action:pan-y}
#zen-menu h3{font-family:var(--serif);font-weight:400;font-size:15px;opacity:.8;margin:18px 0 10px}
#zen-menu .zs{display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:6px;border-radius:16px 12px 17px 13px / 12px 17px 13px 16px;background:rgba(239,230,210,.05)}
#zen-menu .zs>.l{flex:1;min-width:0}
#zen-menu .zs>.l small{display:block;opacity:.55;font-size:12px;margin-top:2px}
#zen-menu .zs input[type=range]{width:min(220px,34vw);accent-color:#e9d2a8}
#zen-menu .zs .v{width:46px;text-align:right;opacity:.75;font-size:13px;font-variant-numeric:tabular-nums}
#zen-menu .tg{width:44px;height:24px;border-radius:999px;background:rgba(239,230,210,.14);position:relative;cursor:pointer;flex:none}
#zen-menu .tg::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#cfc6b4;transition:left .25s ease,background .25s}
#zen-menu .tg.on{background:rgba(169,196,154,.45)}
#zen-menu .tg.on::after{left:23px;background:#f2ead8}
#zen-menu .tg.dis{opacity:.35;cursor:default}
#zen-menu .ch{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
#zen-menu .ch span{padding:5px 10px;border-radius:999px;background:rgba(239,230,210,.08);cursor:pointer;font-size:13px}
#zen-menu .ch span.on{background:rgba(255,236,200,.24);box-shadow:inset 0 0 0 1px rgba(255,230,190,.5)}
#zen-menu .key{min-width:64px;text-align:center;padding:5px 10px;border-radius:9px;box-shadow:inset 0 0 0 1px rgba(236,222,196,.3);cursor:pointer;font-size:13px;font-family:ui-sans-serif,system-ui,sans-serif}
#zen-menu .key.cap{background:rgba(200,85,61,.25);box-shadow:inset 0 0 0 1px rgba(232,140,120,.6)}
#zen-menu .key.empty{opacity:.4}
#zen-menu .rest{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;height:100%;padding:0 18px 40px}
#zen-menu .rest .big{font-family:var(--serif);font-size:42px;letter-spacing:.01em;margin-bottom:4px}
#zen-menu .rest .hint{font-family:var(--serif);font-size:18px;opacity:.85;max-width:460px;line-height:1.45;padding-left:14px;border-left:2px solid rgba(169,196,154,.55);margin-top:18px}
#zen-menu .rest .keys{margin-top:28px;font-size:13px;opacity:.5;line-height:1.8}
#zen-menu button.b{font:inherit;font-family:var(--serif);color:var(--ink);background:var(--paper);border:0;border-radius:16px 13px 17px 12px / 12px 17px 13px 16px;padding:7px 16px;cursor:pointer}
#zen-menu button.b.ghost{background:rgba(239,230,210,.1);color:var(--paper);box-shadow:inset 0 0 0 1px rgba(236,222,196,.2)}
#zen-menu .jw{margin-bottom:14px}
#zen-menu .jw .sp{display:inline-flex;gap:6px;align-items:center;padding:5px 10px;margin:3px 4px 3px 0;border-radius:12px;background:rgba(239,230,210,.06);font-size:14px}
#zen-menu .jw .sp svg{width:14px;height:14px;opacity:.7}
#zen-menu .muted{opacity:.6}
@media (max-width:640px){#zen-menu .zm-card{flex-direction:column}#zen-menu .zm-rail{width:auto;flex-direction:row;flex-wrap:wrap;padding:12px;border-right:0;border-bottom:1px solid rgba(236,222,196,.08)}#zen-menu .zm-title,#zen-menu .zm-sub{display:none}#zen-menu .zm-it{padding:7px 10px;font-size:14px}#zen-menu .zm-it.quit{margin-top:0}}
`;

export function createMenu({ hud, worlds, env, pad, extra = {} }) {
  const el = document.createElement('div'); el.id = 'zen-menu'; el.className = 'hidden';
  el.innerHTML = `<div class="zm-veil"></div><div class="zm-card glass"><div class="zm-rail"></div><div class="zm-main"><div class="zm-tabs"></div><div class="zm-body"></div></div></div>`;
  hud.root.appendChild(el);
  const rail = el.querySelector('.zm-rail'), tabsEl = el.querySelector('.zm-tabs'), body = el.querySelector('.zm-body');
  let open = false, section = 'home', stab = 'controls', focus = 0, capture = null, quitAsk = false;
  el.querySelector('.zm-veil').addEventListener('pointerdown', (e) => { e.stopPropagation(); close(); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  function renderRail() {
    const where = WORLD_NAME[worlds.currentId] || 'Somewhere';
    rail.innerHTML = `<div class="zm-title">${CAIRN}<span>Resting</span></div><div class="zm-sub">${esc(where)}</div>` +
      ITEMS.map(([id, label, ic], i) => `<div class="zm-it ${id === 'quit' ? 'quit' : ''} ${section === id ? 'on' : ''} ${focus === i ? 'focus' : ''}" data-i="${id}">${icon(ic)}<span>${label}</span></div>`).join('');
    rail.querySelectorAll('[data-i]').forEach((d) => d.addEventListener('pointerdown', (e) => { e.stopPropagation(); pick(d.dataset.i); }));
  }
  function pick(id) {
    focus = ITEMS.findIndex((x) => x[0] === id);
    if (id === 'resume') return close();
    if (id === 'quit') { section = 'quit'; quitAsk = true; return render(); }
    section = id; render();
  }
  function render() {
    renderRail();
    tabsEl.innerHTML = ''; body.innerHTML = ''; capture = null;
    if (section === 'settings') {
      tabsEl.innerHTML = STABS.map(([id, l]) => `<div class="zm-tab ${stab === id ? 'on' : ''}" data-st="${id}">${l}</div>`).join('');
      tabsEl.querySelectorAll('[data-st]').forEach((d) => d.addEventListener('pointerdown', (e) => { e.stopPropagation(); stab = d.dataset.st; render(); }));
      SET[stab](body);
    } else if (section === 'journal') journal(body);
    else if (section === 'map' && extra.map) extra.map(body);
    else if (section === 'milestones' && extra.milestones) extra.milestones(body);
    else if (section === 'quit') quitView(body);
    else home(body);
    body.scrollTop = 0;
  }
  function home(b) {
    let hint = ''; try { hint = nextStep().text; } catch (e) { /* */ }
    const pc = document.documentElement.dataset.device === 'pc';
    b.innerHTML = `<div class="rest"><div class="big">Breathe.</div><div class="muted">The world waits while you rest.</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      <div class="keys">${pc ? 'Esc to return · N for the map · B for the bag' : 'Tap outside to return · two fingers to rest again'}</div></div>`;
  }
  function quitView(b) {
    const onEarth = worlds.currentId === 'earth';
    b.innerHTML = `<div class="rest"><div class="big">${onEarth ? 'You are home.' : 'Go home?'}</div><div class="muted">${onEarth ? 'The garden is right here.' : 'The ship will carry you back to the garden. Everything is saved.'}</div>
      <div style="margin-top:22px;display:flex;gap:10px">${onEarth ? '<button class="b" data-q="stay">Back to the garden</button>' : '<button class="b" data-q="go">Go home</button><button class="b ghost" data-q="stay">Stay</button>'}</div></div>`;
    b.querySelectorAll('[data-q]').forEach((d) => d.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (d.dataset.q === 'go') { close(); hud.fadeTo(1, 900).then(() => worlds.go('earth', { from: 'warp' })).catch(() => hud.fadeTo(0, 600)); } else close();
    }));
  }
  // ---- journal across every world
  function journal(b) {
    const G = game.data, J = G.journal || { species: {}, planets: {} };
    const byP = {};
    for (const [k, v] of Object.entries(J.species || {})) (byP[v.planet || '?'] = byP[v.planet || '?'] || []).push([k, v]);
    const ps = Object.entries(J.planets || {});
    const n = Object.keys(J.species || {}).length;
    b.innerHTML = `<h3>${n} species named across ${ps.length} world${ps.length === 1 ? '' : 's'}</h3>` + (ps.length ? ps.map(([pk, p]) => {
      const list = byP[pk] || [];
      return `<div class="jw"><div class="zs"><span class="l">${esc(p.name || pk)}<small>visited ${p.visits || 1} time${(p.visits || 1) === 1 ? '' : 's'} · ${list.length} met</small></span></div>${list.map(([, v]) => `<span class="sp">${icon(v.kind === 'fauna' ? 'eye' : 'leaf')}${esc(v.name)}<span class="muted" style="font-size:12px">${esc(v.label || '')}</span></span>`).join('') || '<span class="muted">Nothing named yet.</span>'}</div>`;
    }).join('') : '<p class="muted">The journal is empty for now. On a new world, stand still and watch an animal for a moment; walk among plants to meet them.</p>');
  }
  // ---- settings widgets
  const val = (p) => p.split('.').reduce((o, k) => o[k], settings);
  function slider(p, label, min, max, step, fmt = (v) => v, sub = '') {
    return `<div class="zs"><span class="l">${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val(p)}" data-p="${p}"><span class="v" data-pv="${p}">${fmt(val(p))}</span></div>`;
  }
  function toggle(p, label, sub = '', dis = false) { return `<div class="zs"><span class="l">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="tg ${val(p) ? 'on' : ''} ${dis ? 'dis' : ''}" data-tg="${dis ? '' : p}"></span></div>`; }
  function choice(p, label, opts, sub = '') { return `<div class="zs"><span class="l">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="ch">${opts.map(([v, l]) => `<span class="${val(p) === v ? 'on' : ''}" data-ch="${p}" data-v="${v}">${l}</span>`).join('')}</span></div>`; }
  const FMT = {};
  function wire(b, re) {
    b.querySelectorAll('input[type=range][data-p]').forEach((r) => r.addEventListener('input', () => { const p = r.dataset.p; set(p, +r.value); const v = b.querySelector(`[data-pv="${p}"]`); if (v) v.textContent = (FMT[p] || ((x) => x))(+r.value); }));
    b.querySelectorAll('[data-tg]').forEach((t) => t.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!t.dataset.tg) return; set(t.dataset.tg, !val(t.dataset.tg)); t.classList.toggle('on'); }));
    b.querySelectorAll('[data-ch]').forEach((t) => t.addEventListener('pointerdown', (e) => { e.stopPropagation(); const v = t.dataset.v; set(t.dataset.ch, isNaN(+v) || v === '' ? v : +v); re(); }));
    b.querySelectorAll('[data-reset]').forEach((t) => t.addEventListener('pointerdown', (e) => { e.stopPropagation(); reset(t.dataset.reset); re(); }));
  }
  const pct = (v) => Math.round(v * 100) + '%';
  const resetBtn = (s) => `<div style="margin-top:16px"><button class="b ghost" data-reset="${s}">Reset to calm defaults</button></div>`;
  const SET = {
    controls(b) {
      const K = settings.controls.keys, PB = settings.controls.pad.buttons;
      const st = api.padRef ? api.padRef.status() : 'none';
      Object.assign(FMT, { 'controls.sens': (v) => v.toFixed(2) + '×', 'controls.pad.sens': (v) => v.toFixed(2) + '×', 'controls.pad.deadzone': pct, 'controls.touch.sens': (v) => v.toFixed(2) + '×', 'controls.touch.joySize': pct });
      b.innerHTML = `<h3>Keyboard</h3>${ACTIONS.map(([a, l]) => `<div class="zs"><span class="l">${l}</span>${[0, 1].map((i) => `<span class="key ${K[a] && K[a][i] ? '' : 'empty'}" data-key="${a}" data-slot="${i}">${K[a] && K[a][i] ? esc(keyName(K[a][i])) : '—'}</span>`).join('')}</div>`).join('')}
        <p class="muted" style="font-size:13px">Click a key box, then press the new key. Backspace clears it.</p>
        <h3>Mouse</h3>${slider('controls.sens', 'Look sensitivity', 0.2, 3, 0.05, FMT['controls.sens'])}${toggle('controls.invertY', 'Invert look up / down')}
        <h3>Gamepad</h3><div class="zs"><span class="l">Controller<small>${esc(st)}</small></span></div>
        ${toggle('controls.pad.enabled', 'Use a gamepad')}${slider('controls.pad.deadzone', 'Stick deadzone', 0.02, 0.45, 0.01, pct)}${slider('controls.pad.sens', 'Look speed', 0.2, 3, 0.05, FMT['controls.pad.sens'])}
        ${toggle('controls.pad.invertY', 'Invert right stick')}${toggle('controls.pad.vibration', 'Gentle vibration', 'a soft pulse when you tend something')}
        ${ACTIONS.filter(([a]) => !['forward', 'back', 'left', 'right'].includes(a)).map(([a, l]) => `<div class="zs"><span class="l">${l}</span><span class="key ${PB[a] == null ? 'empty' : ''}" data-pb="${a}">${PB[a] == null ? '—' : esc(PAD_NAMES[PB[a]] || 'Button ' + PB[a])}</span></div>`).join('')}
        <h3>Touch</h3>${choice('controls.touch.side', 'Walking thumb', [['left', 'Left'], ['right', 'Right']])}${slider('controls.touch.joySize', 'Stick size', 0.7, 1.5, 0.05, pct)}
        ${slider('controls.touch.sens', 'Swipe-to-look speed', 0.3, 3, 0.05, FMT['controls.touch.sens'])}${toggle('controls.touch.twoFingerPause', 'Two-finger tap rests', 'opens this menu')}
        ${resetBtn('controls')}`;
      wire(b, () => render());
      b.querySelectorAll('[data-key]').forEach((k) => k.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); b.querySelectorAll('.key.cap').forEach((x) => x.classList.remove('cap'));
        k.classList.add('cap'); k.textContent = 'press a key…'; capture = { kind: 'key', a: k.dataset.key, i: +k.dataset.slot };
      }));
      b.querySelectorAll('[data-pb]').forEach((k) => k.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); k.classList.add('cap'); k.textContent = 'press a button…'; capture = { kind: 'pad', a: k.dataset.pb };
        if (api.padRef) api.padRef.capture((btn) => { if (!capture || capture.kind !== 'pad') return; const m = { ...settings.controls.pad.buttons }; for (const [x, v] of Object.entries(m)) if (v === btn) delete m[x]; m[capture.a] = btn; capture = null; set('controls.pad.buttons', m); render(); });
      }));
    },
    video(b) {
      Object.assign(FMT, { 'video.fov': (v) => v + '°', 'video.renderScale': pct });
      b.innerHTML = `<h3>Picture</h3>${choice('video.quality', 'Quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], 'Auto keeps it smooth on its own')}
        ${slider('video.fov', 'Field of view', 55, 100, 1, FMT['video.fov'])}${slider('video.renderScale', 'Render scale', 0.5, 1, 0.05, pct, 'lower is softer and lighter on the battery')}
        ${choice('video.fpsCap', 'Frame cap', [['smart', 'Smart'], [0, 'Off'], [30, '30'], [60, '60'], [120, '120'], [144, '144'], [240, '240']], 'Smart: full speed while you move, calmer and cooler when still or in the background')}
        <h3>Light</h3>${toggle('video.shadows', 'Shadows')}${toggle('video.ao', 'Ambient occlusion', 'soft contact shade in the garden')}${toggle('video.motionBlur', 'Motion blur', 'always off: it never helps a calm walk', true)}
        <h3>Comfort</h3>${toggle('video.bob', 'Head bob while walking')}${resetBtn('video')}`;
      wire(b, () => render());
    },
    audio(b) {
      b.innerHTML = `<h3>Volume</h3>${slider('audio.master', 'Everything', 0, 1, 0.01, pct)}${slider('audio.music', 'Music', 0, 1, 0.01, pct, 'the slow pad chords')}
        ${slider('audio.ambience', 'Ambience', 0, 1, 0.01, pct, 'wind, water, birds, crickets, rain')}${slider('audio.effects', 'Effects', 0, 1, 0.01, pct, 'footsteps, bells, tools, splashes')}${resetBtn('audio')}`;
      wire(b, () => render());
    },
    hud(b) {
      b.innerHTML = `<div data-xh></div><h3>Layout</h3>${slider('hud.scale', 'HUD size', 0.75, 1.5, 0.05, pct)}${slider('hud.opacity', 'HUD opacity', 0.2, 1, 0.05, pct)}
        <h3>Show</h3>${toggle('hud.show.crosshair', 'Focal point')}${toggle('hud.show.prompt', 'Action word under it')}${toggle('hud.show.toasts', 'Messages')}${toggle('hud.show.buttons', 'Corner buttons', 'the bag, map and drift stones')}
        ${toggle('hud.show.saved', 'Saved leaf')}${toggle('hud.show.hint', 'Gentle next-step whispers')}${toggle('hud.show.fps', 'Frame counter', 'fps, frame time and quality level')}${resetBtn('hud')}`;
      wire(b, () => render());
      const xh = b.querySelector('[data-xh]'); const re = () => mountCrosshair(xh, re); re();
    },
    access(b) {
      b.innerHTML = `<h3>Seeing</h3>${choice('access.colorblind', 'Colour filter', [['none', 'None'], ['protan', 'Protan'], ['deutan', 'Deutan'], ['tritan', 'Tritan'], ['mono', 'Grey']], 'shifts reds, greens and blues apart')}
        ${slider('access.textSize', 'Text size', 0.85, 1.6, 0.05, pct)}
        <h3>Moving</h3>${toggle('access.reduceMotion', 'Reduce motion', 'no head bob, gentler fades and camera moves')}
        <h3>Hearing</h3>${toggle('access.subtitles', 'Captions for sounds and whispers', 'bells, splashes, the rocket, the ship')}${resetBtn('access')}`;
      wire(b, () => render());
    },
  };
  // key capture (capture phase, so the game never sees the key)
  addEventListener('keydown', (e) => {
    if (!open || !capture || capture.kind !== 'key') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const keys = JSON.parse(JSON.stringify(settings.controls.keys));
    const list = (keys[capture.a] = keys[capture.a] || []);
    if (e.code === 'Backspace' || e.code === 'Delete') list.splice(capture.i, 1);
    else if (e.code !== 'Escape') {
      for (const k of Object.keys(keys)) if (k !== capture.a) keys[k] = keys[k].filter((c) => c !== e.code); // one key, one job
      list[capture.i] = e.code; keys[capture.a] = list.filter(Boolean);
    }
    capture = null; set('controls.keys', keys); render();
  }, true);

  function show(which) {
    if (which) section = which; else section = 'home';
    focus = Math.max(0, ITEMS.findIndex((x) => x[0] === section));
    if (hud.panelOpen && !open) hud.closePanel();
    open = true; el.classList.remove('hidden'); hud.root.classList.add('menu-open'); render();
  }
  function close() { if (!open) return; open = false; capture = null; el.classList.add('hidden'); hud.root.classList.remove('menu-open'); }
  const api = {
    padRef: pad, el, show, close, render,
    get open() { return open; },
    toggle() { if (open) close(); else show(); },
    section: (s, t) => { if (t) stab = t; show(s); },
    // gamepad navigation
    nav(d) { focus = (focus + d + ITEMS.length) % ITEMS.length; renderRail(); },
    select() { pick(ITEMS[focus][0]); },
    back() { if (section !== 'home') { section = 'home'; render(); } else close(); },
  };
  return api;
}
