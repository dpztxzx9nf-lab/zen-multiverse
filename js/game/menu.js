// The pause menu (game only): Esc / Start / two-finger tap. Resume, Settings, Journal, Map,
// Milestones, Quit to garden. Settings is its own page (settings-ui.js): searchable tabs generated
// from settings-items.js, written straight into the game's settings slice of garden-save.
import { icon } from './icons.js';
import { CAIRN, brush } from './zen-style.js';
import { createSettingsPage, SETTINGS_CSS } from './settings-ui.js';
import { game } from './store.js';
import { nextStep } from './progress.js';
import { skillHtml, wearSuit } from './skills.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WORLD_NAME = { earth: 'The garden', moon: 'The moon', planet: 'A far world', space: 'Between worlds' };
const ITEMS = [
  ['resume', 'Resume', 'walk'], ['settings', 'Settings', 'eye'], ['journal', 'Journal', 'book'],
  ['map', 'Map', 'map'], ['milestones', 'Milestones', 'star'], ['character', 'Character', 'leaf'], ['quit', 'Quit to garden', 'home'],
];

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
#zen-menu .zm-set{flex:1;display:flex;flex-direction:column;min-height:0;position:relative}
#zen-menu .zm-set .zm-body{min-height:0}
#zen-menu .zm-card{width:min(1040px,96vw);height:min(720px,92vh)}
@media (max-width:640px){#zen-menu .zm-card{flex-direction:column}#zen-menu .zm-rail{width:auto;flex-direction:row;flex-wrap:wrap;padding:12px;border-right:0;border-bottom:1px solid rgba(236,222,196,.08)}#zen-menu .zm-title,#zen-menu .zm-sub{display:none}#zen-menu .zm-it{padding:7px 10px;font-size:14px}#zen-menu .zm-it.quit{margin-top:0}}
` + SETTINGS_CSS;

export function createMenu({ hud, worlds, env, pad, extra = {} }) {
  const el = document.createElement('div'); el.id = 'zen-menu'; el.className = 'hidden';
  el.innerHTML = `<div class="zm-veil"></div><div class="zm-card glass"><div class="zm-rail"></div><div class="zm-main"><div class="zm-tabs"></div><div class="zm-body"></div></div><div class="zm-main zm-set" style="display:none"></div></div>`;
  hud.root.appendChild(el);
  const rail = el.querySelector('.zm-rail'), tabsEl = el.querySelector('.zm-tabs'), body = el.querySelector('.zm-body');
  let open = false, section = 'home', focus = 0, zone = 'rail', quitAsk = false;
  const stdEl = el.querySelector('.zm-main:not(.zm-set)'), setEl = el.querySelector('.zm-set');
  const page = createSettingsPage({ menu: { get open() { return open; }, close: () => close() }, hud, getPad: () => api.padRef, extra });
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
    // the character studio is its own full-screen view (avatar/creator.js)
    if (id === 'character') { close(); import('./avatar/index.js').then((m) => m.avatarApi.openCreator({})).catch(() => {}); return; }
    if (id === 'quit') { section = 'quit'; quitAsk = true; return render(); }
    section = id; render();
  }
  function render() {
    renderRail();
    tabsEl.innerHTML = ''; body.innerHTML = '';
    const onSet = section === 'settings';
    stdEl.style.display = onSet ? 'none' : ''; setEl.style.display = onSet ? '' : 'none';
    if (onSet) { if (!setEl.firstChild) page.mount(setEl); else page.render(); return; }
    if (setEl.firstChild) { page.unmount(); setEl.innerHTML = ''; }
    if (section === 'journal') journal(body);
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
    b.innerHTML = `<h3>Skills</h3>${skillHtml()}<h3>${n} species named across ${ps.length} world${ps.length === 1 ? '' : 's'}</h3>` + (ps.length ? ps.map(([pk, p]) => {
      const list = byP[pk] || [];
      return `<div class="jw"><div class="zs"><span class="l">${esc(p.name || pk)}<small>visited ${p.visits || 1} time${(p.visits || 1) === 1 ? '' : 's'} · ${list.length} met</small></span></div>${list.map(([, v]) => `<span class="sp">${icon(v.kind === 'fauna' ? 'eye' : 'leaf')}${esc(v.name)}<span class="muted" style="font-size:12px">${esc(v.label || '')}</span></span>`).join('') || '<span class="muted">Nothing named yet.</span>'}</div>`;
    }).join('') : '<p class="muted">The journal is empty for now. On a new world, stand still and watch an animal for a moment; walk among plants to meet them.</p>');
    const btn = b.querySelector('[data-wear]');
    if (btn) btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); wearSuit(btn.dataset.wear === 'on'); journal(b); });
  }
  function show(which) {
    if (which) section = which; else section = 'home';
    focus = Math.max(0, ITEMS.findIndex((x) => x[0] === section));
    if (hud.panelOpen && !open) hud.closePanel();
    open = true; el.classList.remove('hidden'); hud.root.classList.add('menu-open'); render();
  }
  function close() { if (!open) return; open = false; zone = 'rail'; if (setEl.firstChild) { page.unmount(); setEl.innerHTML = ''; } el.classList.add('hidden'); hud.root.classList.remove('menu-open'); }
  const api = {
    padRef: pad, el, show, close, render,
    get open() { return open; },
    toggle() { if (open) close(); else show(); },
    section: (s, t) => { if (t) page.setTab(t); show(s); },
    settings: page,
    // gamepad navigation: the rail, then the settings rows (zone 'body')
    get zone() { return zone; },
    nav(d) { if (zone === 'body' && section === 'settings') return page.nav(d); focus = (focus + d + ITEMS.length) % ITEMS.length; renderRail(); },
    navX(d) {
      if (section !== 'settings') return;
      if (zone === 'body') page.adjust(d); else if (d > 0) { zone = 'body'; page.nav(1); }
    },
    tab(d) { if (section === 'settings') page.tabStep(d); },
    select() {
      if (page.keepPending()) return page.keep(true);
      if (zone === 'body' && section === 'settings') return page.activate();
      pick(ITEMS[focus][0]);
      if (section === 'settings') { zone = 'body'; page.nav(1); }
    },
    back() {
      if (page.keepPending()) return page.keep(false);
      if (zone === 'body') { zone = 'rail'; page.blur(); return; }
      if (section !== 'home') { section = 'home'; render(); } else close();
    },
  };
  return api;
}
