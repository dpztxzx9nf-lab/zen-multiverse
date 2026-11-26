import { isGameWorld } from './flags.js';
// First-person HUD: almost nothing on screen. A tiny gaze dot that appears only when her eyes rest on
// something she can tend, with one soft word that fades; messages as quiet fading text; the bag and
// map as two faint marks in a corner. Phone: an invisible joystick anywhere on the left half (it
// appears under the thumb), drag on the right half to look, tap what you look at to act.
// PC: WASD/arrows walk, drag to look, click or E acts (R the second), Space jump, B bag, M map, C drift.
import { icon } from './icons.js';
import { game, itemInfo } from './store.js';
import { nextStep } from './progress.js';
import { prefs, setPref } from './player.js';
import { settings, keyName } from './settings.js';

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font:400 15px/1.3 ui-sans-serif,-apple-system,"SF Pro Text","Segoe UI",system-ui,sans-serif;color:#f4f1ea;letter-spacing:.015em;z-index:5;
 --glass:rgba(18,22,26,.5);--line:rgba(255,255,255,.14);transition:opacity .8s ease}
#hud *{box-sizing:border-box}
#hud .glass{background:var(--glass);border:1px solid var(--line);-webkit-backdrop-filter:blur(14px) saturate(1.1);backdrop-filter:blur(14px) saturate(1.1);box-shadow:0 10px 40px rgba(0,0,0,.25)}
#hud .btn{pointer-events:auto;display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;color:#f7f3ea;touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .15s ease,opacity .4s ease,background .3s}
#hud .btn svg{width:52%;height:52%}
#hud .hidden{opacity:0!important;pointer-events:none!important}
#hud .soft{text-shadow:0 1px 2px rgba(0,0,0,.5),0 0 14px rgba(0,0,0,.35)}
#hud-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 10px);display:flex;gap:2px;opacity:.42;transition:opacity .6s ease}
#hud-top:hover{opacity:.85}
#hud-saved{position:absolute;top:calc(env(safe-area-inset-top,0px) + 21px);left:calc(env(safe-area-inset-left,0px) + 16px);width:15px;height:15px;color:#cfe8b8;opacity:0;transition:opacity 1.2s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
#hud-saved.on{opacity:.5;transition:opacity .5s ease}
#hud-saved svg{width:15px;height:15px}
#hud-panel .next{font-size:14px;opacity:.82;margin:0 0 12px;font-style:italic}
#hud-top .btn{width:38px;height:38px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
#hud-top .btn svg{width:19px;height:19px}
#hud-gaze{position:absolute;left:50%;top:50%;width:0;height:0}
#hud-dot{position:absolute;left:-2.5px;top:-2.5px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.82);box-shadow:0 0 0 1px rgba(0,0,0,.22),0 0 6px rgba(0,0,0,.3);opacity:0;transform:scale(.4);transition:opacity .35s ease,transform .35s ease}
#hud-gaze.on #hud-dot{opacity:1;transform:none}
#hud-xh{position:absolute;left:0;top:0;transform:translate(-50%,-50%);line-height:0;transition:transform .35s ease,filter .35s ease,opacity .5s ease;pointer-events:none}
#hud-xh svg{display:block}
#hud-gaze.on #hud-xh{transform:translate(-50%,-50%) scale(1.22);filter:drop-shadow(0 0 3px rgba(255,226,170,.85)) drop-shadow(0 0 9px rgba(255,214,150,.35))}
#hud.has-xh #hud-dot{display:none}
#hud.has-xh #hud-word{top:18px}
html.notrans *,html.notrans *::before,html.notrans *::after{transition:none!important;animation:none!important}
#hud-word{position:absolute;left:0;top:14px;transform:translateX(-50%);white-space:nowrap;font-size:13px;letter-spacing:.06em;text-transform:lowercase;opacity:0;transition:opacity .7s ease;display:flex;gap:10px;align-items:baseline}
#hud-word.on{opacity:.88}
#hud-word .w2{opacity:.6;font-size:12px;pointer-events:auto;cursor:pointer;padding:6px 4px;margin:-6px -4px}
#hud-word .k{opacity:.5;font-size:11px;margin-right:4px}
html:not([data-device=pc]) #hud-word .k{display:none}
#hud-msg{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16vh);transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;width:min(640px,86vw)}
#hud-msg .t{font-size:16px;text-align:center;opacity:0;transform:translateY(4px);transition:opacity 1.1s ease,transform 1.1s ease}
#hud-msg .t.on{opacity:.92;transform:none}
#hud-tool{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);font-size:12px;letter-spacing:.06em;opacity:.6;pointer-events:auto;cursor:pointer;transition:opacity .5s}
#hud-move{position:absolute;left:0;top:20%;bottom:0;width:46%;pointer-events:auto;touch-action:none}
#hud-joy{position:absolute;width:118px;height:118px;margin:-59px 0 0 -59px;border-radius:50%;border:1.5px solid rgba(255,255,255,.28);opacity:0;transition:opacity .25s ease;pointer-events:none}
#hud-joy.active{opacity:1}
#hud-joy .knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.4)}
html[data-device=pc] #hud-move{display:none}
#hud-panel{position:absolute;inset:auto 0 0 0;margin:auto;top:0;bottom:0;width:min(560px,92vw);height:min(560px,78vh);border-radius:24px;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;transition:opacity .35s ease,transform .35s ease}
#hud-panel.hidden{transform:translateY(14px) scale(.98)}
#hud-panel .tabs{display:flex;gap:6px;padding:14px 14px 6px}
#hud-panel .tab{pointer-events:auto;padding:8px 14px;border-radius:999px;cursor:pointer;opacity:.7;display:flex;gap:7px;align-items:center}
#hud-panel .tab svg{width:17px;height:17px}
#hud-panel .tab.on{background:rgba(255,255,255,.18);opacity:1}
#hud-panel .x{margin-left:auto;width:38px;height:38px}
#hud-panel .body{flex:1;overflow:auto;padding:8px 18px 20px;touch-action:pan-y;-webkit-overflow-scrolling:touch}
#hud-panel h3{font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin:14px 0 8px}
#hud-panel .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
#hud-panel .item{display:flex;gap:10px;align-items:center;padding:9px 11px;border-radius:14px;background:rgba(255,255,255,.07)}
#hud-panel .item .ic{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.2);flex:none}
#hud-panel .item .ic svg{width:18px;height:18px}
#hud-panel .item .n{opacity:.7;margin-left:auto;font-variant-numeric:tabular-nums}
#hud-panel .muted{opacity:.6}
#hud-panel .row{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.07);margin-bottom:8px}
#hud-panel .row .grow{flex:1}
#hud-panel .chip{display:inline-flex;gap:4px;align-items:center;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.22);font-size:13px;margin:2px 4px 2px 0}
#hud-panel .chip svg{width:13px;height:13px}
#hud-panel .done{color:#bfe8b0}
#hud-panel button.b{pointer-events:auto;font:inherit;color:#1d2622;background:rgba(255,255,255,.88);border:0;border-radius:999px;padding:8px 14px;cursor:pointer}
#hud-panel button.b[disabled]{opacity:.35;cursor:default}
#hud-fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 1.2s ease;z-index:6}
#hud-dialog{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 9vh);transform:translateX(-50%);width:min(520px,90vw);padding:16px 20px;border-radius:20px;pointer-events:auto;cursor:pointer;transition:opacity .5s ease}
#hud-dialog .who{font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;margin-bottom:6px}
#hud-dialog .more{font-size:12px;opacity:.55;margin-top:8px;text-align:right}
#hud-panel .set{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.07);margin-bottom:8px;pointer-events:auto;cursor:pointer}
#hud-panel .set .sw{margin-left:auto;opacity:.75}
`;

export function createHud({ P }) {
  void P;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'hud';
  root.innerHTML = `
    <div id="hud-move"><div id="hud-joy"><div class="knob"></div></div></div>
    <div id="hud-top">
      <div class="btn" id="hud-map" role="button" title="Star map" aria-label="Star map">${icon('map')}</div>
      <div class="btn" id="hud-bag" role="button" title="Bag" aria-label="Bag">${icon('bag')}</div>
      <div class="btn" id="hud-mode" role="button" title="Drift quietly" aria-label="Drift quietly">${icon('leaf')}</div>
    </div>
    <div id="hud-gaze"><div id="hud-dot"></div><div id="hud-xh"></div><div id="hud-word" class="soft"></div></div>
    <div id="hud-tool" class="soft hidden"></div>
    <div id="hud-msg"></div>
    <div id="hud-saved" aria-hidden="true">${icon('leaf')}</div>
    <div id="hud-dialog" class="glass hidden"><div class="who"></div><div class="txt"></div><div class="more">tap to continue</div></div>
    <div id="hud-panel" class="glass hidden"><div class="tabs"></div><div class="body"></div></div>`;
  document.body.appendChild(root);
  const fade = document.createElement('div'); fade.id = 'hud-fade'; document.body.appendChild(fade);
  const $ = (id) => root.querySelector(id);
  const el = { top: $('#hud-top'), move: $('#hud-move'), joy: $('#hud-joy'), knob: $('#hud-joy .knob'), gaze: $('#hud-gaze'), word: $('#hud-word'), prompt: $('#hud-gaze'), toast: $('#hud-msg'), panel: $('#hud-panel'), tool: $('#hud-tool'), mode: $('#hud-mode'), bag: $('#hud-bag'), map: $('#hud-map'), dialog: $('#hud-dialog') };
  const gameWorld = isGameWorld();
  if (new URLSearchParams(location.search).has('shotui')) document.documentElement.classList.add('notrans');
  if (!gameWorld) { el.bag.style.display = 'none'; el.map.style.display = 'none'; }
  // auto-save: a tiny leaf glows for a moment in the corner (game only; never a popup)
  const savedEl = root.querySelector('#hud-saved'); let savedT = 0, savedLast = 0;
  if (gameWorld) window.addEventListener('garden-saved', () => {
    const now = performance.now(); if (now - savedLast < 6000) return; savedLast = now;
    savedEl.classList.add('on'); clearTimeout(savedT); savedT = setTimeout(() => savedEl.classList.remove('on'), 1400);
  });
  const handlers = {};
  const fire = (k, ...a) => handlers[k] && handlers[k](...a);
  const tapBtn = (b, k) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fire(k); });
  tapBtn(el.mode, 'mode'); tapBtn(el.bag, 'bag'); tapBtn(el.map, 'map'); tapBtn(el.tool, 'tool');
  el.dialog.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fire('dialog'); });
  el.word.addEventListener('pointerdown', (e) => { if (e.target.closest('.w2')) { e.preventDefault(); e.stopPropagation(); fire('secondary'); } });

  // ---- floating joystick: wherever the left thumb lands; a quick tap there is a little hop
  const joy = { x: 0, y: 0, id: null, cx: 0, cy: 0, t0: 0, moved: 0 };
  const R = 50;
  function joyAt(e) {
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    joy.moved = Math.max(joy.moved, Math.hypot(dx, dy));
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    joy.x = dx / R; joy.y = -dy / R;
    el.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  el.move.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); if (joy.id !== null) return;
    joy.id = e.pointerId; joy.t0 = performance.now(); joy.moved = 0;
    try { el.move.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    const r = el.move.getBoundingClientRect(); joy.cx = e.clientX; joy.cy = e.clientY;
    el.joy.style.left = (e.clientX - r.left) + 'px'; el.joy.style.top = (e.clientY - r.top) + 'px';
    el.joy.classList.add('active'); joyAt(e); fire('touch');
  });
  el.move.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) { e.preventDefault(); joyAt(e); } });
  const joyEnd = (e) => {
    if (e.pointerId !== joy.id) return;
    if (e.type === 'pointerup' && joy.moved < 8 && performance.now() - joy.t0 < 260) fire('jump');
    joy.id = null; joy.x = joy.y = 0; el.joy.classList.remove('active'); el.knob.style.transform = '';
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.move.addEventListener(ev, joyEnd);

  // ---- messages: soft text low in the view that fades in and out (no boxes, no icons)
  function toast(text, ic = null, ms = 3400) {
    void ic;
    const t = document.createElement('div'); t.className = 't soft'; t.textContent = String(text).replace(/<[^>]+>/g, '');
    el.toast.appendChild(t);
    while (el.toast.children.length > 2) el.toast.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 1200); }, ms);
  }
  // ---- gaze: a dot when her eyes rest on something, and one word (the first of the action) that fades
  let promptKey = '', wordT = 0;
  const oneWord = (l) => String(l || '').split(/\s+/)[0].toLowerCase();
  function setPrompt(a, b) {
    const key = (a ? a.label : '') + '|' + (b ? b.label : '');
    if (key === promptKey) return;
    promptKey = key; wordT = 0;
    el.gaze.classList.toggle('on', !!a);
    el.word.classList.toggle('on', !!a);
    if (!a) return;
    el.word.innerHTML = `<span><span class="k">E</span>${oneWord(a.label)}</span>` + (b ? `<span class="w2"><span class="k">R</span>${oneWord(b.label)}</span>` : '');
    el.word.title = a.label + (b ? ' / ' + b.label : '');
  }
  function setTool(t) {
    el.tool.classList.toggle('hidden', !t);
    if (t) el.tool.textContent = t.label.toLowerCase();
  }
  // ---- panel with tabs: each tab is { id, label, icon, render(body) }
  let tabs = [], tabOn = null;
  function openPanel(list, which) {
    tabs = list; tabOn = which || (tabOn && list.find((t) => t.id === tabOn) ? tabOn : list[0].id);
    renderPanel();
    el.panel.classList.remove('hidden');
  }
  function renderPanel() {
    const tb = el.panel.querySelector('.tabs'), body = el.panel.querySelector('.body');
    tb.innerHTML = tabs.map((t) => `<div class="tab ${t.id === tabOn ? 'on' : ''}" data-t="${t.id}">${icon(t.icon)}<span>${t.label}</span></div>`).join('') + `<div class="btn x" data-x="1">${icon('close')}</div>`;
    tb.querySelectorAll('[data-t]').forEach((d) => d.addEventListener('pointerdown', (e) => { e.stopPropagation(); tabOn = d.dataset.t; renderPanel(); }));
    tb.querySelector('[data-x]').addEventListener('pointerdown', (e) => { e.stopPropagation(); closePanel(); });
    body.innerHTML = '';
    tabs.find((t) => t.id === tabOn).render(body, renderPanel);
  }
  function closePanel() { el.panel.classList.add('hidden'); fire('panelClosed'); }
  el.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  // ---- dialog (guide ship etc.)
  let dlg = null;
  function say(who, lines) {
    return new Promise((res) => {
      dlg = { lines: [...lines], res };
      el.dialog.querySelector('.who').textContent = who;
      next();
      el.dialog.classList.remove('hidden');
    });
  }
  function next() {
    if (!dlg) return;
    if (!dlg.lines.length) { el.dialog.classList.add('hidden'); const r = dlg.res; dlg = null; r(); return; }
    el.dialog.querySelector('.txt').textContent = dlg.lines.shift();
  }
  handlers.dialog = next;

  function itemsHtml(filter = () => true) {
    const groups = {};
    for (const [id, n] of Object.entries(game.data.inv)) {
      if (!n || !filter(id)) continue;
      const inf = itemInfo(id); (groups[inf.group] = groups[inf.group] || []).push([id, n, inf]);
    }
    const order = ['Seeds', 'Flowers', 'Finds', 'Garden', 'Gathered', 'Crafted', 'Moon', 'Worlds', 'Other'];
    let next = '';
    if (gameWorld) { try { next = `<p class="next">${nextStep().text}</p>`; } catch (e) { /* */ } }
    return next + (order.filter((g) => groups[g]).map((g) => `<h3>${g}</h3><div class="grid">${groups[g].map(([, n, inf]) => `<div class="item"><span class="ic" style="color:${inf.color}">${icon(inf.icon)}</span><span>${inf.name}</span><span class="n">${n}</span></div>`).join('')}</div>`).join('') || '<p class="muted">Nothing yet. Things you gather and grow will rest here.</p>');
  }
  const cost = (c) => Object.entries(c).map(([id, n]) => {
    const inf = id === 'find:any' ? { name: 'finds', icon: 'stone', color: '#c9b9a0' } : id === 'flower:any' ? { name: 'flowers', icon: 'flower', color: '#e58fb4' } : itemInfo(id);
    const have = id === 'find:any' ? game.total('find:') : id === 'flower:any' ? game.total('flower:') : game.count(id);
    return `<span class="chip" style="${have >= n ? '' : 'opacity:.55'}"><span style="color:${inf.color}">${icon(inf.icon)}</span>${Math.min(have, n)}/${n} ${inf.name}</span>`;
  }).join('');

  // button tooltips carry the key as bound now (Settings > Keybinds can move them)
  const kb = (a) => { const c = ((settings.keys || {})[a] || [])[0]; return c ? ` (${keyName(c)})` : ''; };
  function keyTitles() {
    for (const [b, a, t] of [[el.map, 'map', 'Star map'], [el.bag, 'bag', 'Bag'], [el.mode, 'drift', el.mode.dataset.t || 'Drift quietly']]) { b.title = t + kb(a); b.setAttribute('aria-label', t); }
  }
  el.top.addEventListener('pointerenter', keyTitles);
  let mode = 'walk', firstHint = false;
  function setMode(m) {
    mode = m;
    for (const k of ['move', 'gaze', 'bag', 'map', 'tool']) el[k].style.visibility = m === 'walk' ? '' : 'hidden';
    if (!gameWorld) { el.bag.style.visibility = 'hidden'; el.map.style.visibility = 'hidden'; el.bag.style.display = 'none'; el.map.style.display = 'none'; }
    el.mode.style.visibility = m === 'cinematic' || m === 'away' ? 'hidden' : '';
    el.top.style.visibility = m === 'cinematic' ? 'hidden' : '';
    el.mode.innerHTML = icon(m === 'walk' ? 'leaf' : 'walk');
    el.mode.dataset.t = m === 'walk' ? 'Drift quietly' : 'Walk'; keyTitles();
    if (m === 'walk' && !firstHint) {
      firstHint = true;
      let seen = false; try { seen = localStorage.getItem('garden-fp-hint') === '1'; localStorage.setItem('garden-fp-hint', '1'); } catch (e) { /* */ }
      if (!seen) setTimeout(() => mode === 'walk' && toast(document.documentElement.dataset.device === 'pc' ? 'W A S D to walk, drag to look, click what you look at' : 'left thumb to walk, right to look, tap what you look at', null, 6500), 2200);
    }
  }
  // a quiet settings page that rides along with the bag
  const feelTab = { id: 'feel', label: 'Settings', icon: 'eye', render: (b, re) => {
    b.innerHTML = `<div class="set" data-k="bob"><span>Head bob while walking</span><span class="sw">${prefs.bob ? 'on' : 'off'}</span></div><p class="muted">Turn it off if walking feels queasy. Drag to look, tap or click what you look at to tend it.</p>`;
    b.querySelector('[data-k=bob]').addEventListener('pointerdown', (e) => { e.stopPropagation(); setPref('bob', !prefs.bob); re(); });
  } };
  const openPanelBase = openPanel;
  function openPanelWithFeel(list, which) { return openPanelBase(list.some((t) => t.id === 'feel') ? list : [...list, feelTab], which); }
  return {
    el, joy, toast, setPrompt, setTool, openPanel: openPanelWithFeel, closePanel, renderPanel, say, itemsHtml, cost, setMode,
    // the crosshair (game): an svg string, or null for none. The gaze ring (.on) warms it.
    setCrosshair(svgStr) { const x = root.querySelector('#hud-xh'); x.innerHTML = svgStr || ''; root.classList.toggle('has-xh', !!svgStr); },
    root,
    get panelOpen() { return !el.panel.classList.contains('hidden') || root.classList.contains('menu-open'); },
    get dialogOpen() { return !!dlg; },
    on(k, fn) { handlers[k] = fn; },
    showJump() {},
    showMap(on) { el.map.style.display = (gameWorld && on) ? '' : 'none'; },
    fadeTo(o, ms = 1200) { fade.style.transitionDuration = ms + 'ms'; fade.style.opacity = o; return new Promise((r) => setTimeout(r, ms)); },
    // the word under the dot says itself once, then fades; the dot stays while she looks
    tick(dt) { if (promptKey && promptKey !== '|') { wordT += dt; if (wordT > 2.4) el.word.classList.remove('on'); } },
    get mode() { return mode; },
  };
}
