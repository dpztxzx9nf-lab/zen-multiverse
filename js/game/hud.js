// Calm game HUD (DOM overlay). Phone/tablet: joystick on the LEFT, actions in RIGHT-thumb reach.
// PC: WASD/arrows to walk, drag to look, E (primary) / R (secondary), Space jump, B bag, M map, C camera.
// Everything fades away in ambient mode except one small "walk" button.
import { icon } from './icons.js';
import { game, itemInfo } from './store.js';

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;font:500 15px/1.25 ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f1e8;letter-spacing:.01em;z-index:5;
 --glass:rgba(22,28,34,.38);--line:rgba(255,255,255,.22);transition:opacity .8s ease}
#hud *{box-sizing:border-box}
#hud .glass{background:var(--glass);border:1px solid var(--line);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2);box-shadow:0 6px 24px rgba(0,0,0,.18)}
#hud .btn{pointer-events:auto;display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;color:#f7f3ea;touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .15s ease,opacity .4s ease,background .3s}
#hud .btn:active,#hud .btn.press{transform:scale(.93);background:rgba(255,255,255,.22)}
#hud .btn svg{width:52%;height:52%}
#hud .hidden{opacity:0!important;pointer-events:none!important}
#hud-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);right:calc(env(safe-area-inset-right,0px) + 12px);display:flex;gap:10px}
#hud-top .btn{width:44px;height:44px}
#hud-joy{position:absolute;left:calc(env(safe-area-inset-left,0px) + 26px);bottom:calc(env(safe-area-inset-bottom,0px) + 34px);width:128px;height:128px;border-radius:50%;pointer-events:auto;touch-action:none}
#hud-joy .ring{position:absolute;inset:0;border-radius:50%}
#hud-joy .knob{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.5);box-shadow:0 2px 10px rgba(0,0,0,.2);transition:transform .12s ease}
#hud-joy.active .knob{transition:none}
#hud-act{position:absolute;right:calc(env(safe-area-inset-right,0px) + 22px);bottom:calc(env(safe-area-inset-bottom,0px) + 40px);width:84px;height:84px}
#hud-act2{position:absolute;right:calc(env(safe-area-inset-right,0px) + 118px);bottom:calc(env(safe-area-inset-bottom,0px) + 30px);width:58px;height:58px}
#hud-jump{position:absolute;right:calc(env(safe-area-inset-right,0px) + 34px);bottom:calc(env(safe-area-inset-bottom,0px) + 140px);width:58px;height:58px}
#hud-prompt{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 30px);transform:translateX(-50%);display:flex;gap:10px;align-items:center;transition:opacity .35s ease,transform .35s ease}
#hud-prompt .pill{display:flex;align-items:center;gap:9px;padding:9px 16px 9px 10px;border-radius:999px;white-space:nowrap}
#hud-prompt .key{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,.88);color:#24302c;font-weight:700;font-size:13px}
#hud-prompt svg{width:20px;height:20px}
html[data-device=phone] #hud-prompt,html[data-device=tablet] #hud-prompt{left:auto;right:calc(env(safe-area-inset-right,0px) + 22px);transform:none;bottom:calc(env(safe-area-inset-bottom,0px) + 134px);flex-direction:column;align-items:flex-end;gap:6px}
html[data-device=phone] #hud-prompt .key,html[data-device=tablet] #hud-prompt .key{display:none}
html[data-device=phone] #hud-prompt .pill,html[data-device=tablet] #hud-prompt .pill{padding:7px 13px;font-size:14px}
#hud-tool{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);padding:7px 14px 7px 10px;border-radius:999px;display:flex;gap:8px;align-items:center;pointer-events:auto;cursor:pointer}
#hud-tool svg{width:18px;height:18px}
#hud-toast{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center}
#hud-toast .t{padding:9px 16px;border-radius:14px;opacity:0;transform:translateY(-6px);transition:opacity .6s ease,transform .6s ease;display:flex;gap:8px;align-items:center;text-align:center;max-width:80vw}
#hud-toast .t.on{opacity:1;transform:none}
#hud-toast .t svg{width:18px;height:18px;flex:none}
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
#hud-hint{position:absolute;left:calc(env(safe-area-inset-left,0px) + 16px);top:calc(env(safe-area-inset-top,0px) + 16px);font-size:13px;opacity:.75;line-height:1.55;padding:10px 14px;border-radius:14px;transition:opacity 1.2s ease}
#hud-hint b{display:inline-block;min-width:20px;text-align:center;padding:0 5px;border-radius:5px;background:rgba(255,255,255,.85);color:#25302b;font-size:12px;margin-right:4px}
#hud-fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 1.2s ease;z-index:6}
#hud-dialog{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 150px);transform:translateX(-50%);width:min(520px,90vw);padding:16px 20px;border-radius:20px;pointer-events:auto;cursor:pointer;transition:opacity .5s ease}
#hud-dialog .who{font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;margin-bottom:6px}
#hud-dialog .more{font-size:12px;opacity:.55;margin-top:8px;text-align:right}
html[data-device=pc] #hud-joy,html[data-device=pc] #hud-act,html[data-device=pc] #hud-act2,html[data-device=pc] #hud-jump{display:none}
html:not([data-device=pc]) #hud-hint{display:none}
`;

export function createHud({ P }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'hud';
  root.innerHTML = `
    <div id="hud-top">
      <div class="btn glass" id="hud-map" title="Star map (M)">${icon('map')}</div>
      <div class="btn glass" id="hud-bag" title="Bag (B)">${icon('bag')}</div>
      <div class="btn glass" id="hud-mode" title="Walk / drift (C)">${icon('leaf')}</div>
    </div>
    <div id="hud-hint" class="glass"><b>W</b><b>A</b><b>S</b><b>D</b> walk · drag to look<br><b>E</b> tend · <b>B</b> bag · <b>C</b> drift mode</div>
    <div id="hud-tool" class="glass hidden"></div>
    <div id="hud-toast"></div>
    <div id="hud-joy"><div class="ring glass"></div><div class="knob"></div></div>
    <div id="hud-prompt" class="hidden"></div>
    <div class="btn glass hidden" id="hud-act2"></div>
    <div class="btn glass hidden" id="hud-act"></div>
    <div class="btn glass hidden" id="hud-jump">${icon('up')}</div>
    <div id="hud-dialog" class="glass hidden"><div class="who"></div><div class="txt"></div><div class="more">tap to continue</div></div>
    <div id="hud-panel" class="glass hidden"><div class="tabs"></div><div class="body"></div></div>`;
  document.body.appendChild(root);
  const fade = document.createElement('div'); fade.id = 'hud-fade'; document.body.appendChild(fade);
  const $ = (id) => root.querySelector(id);
  const el = { top: $('#hud-top'), joy: $('#hud-joy'), knob: $('#hud-joy .knob'), act: $('#hud-act'), act2: $('#hud-act2'), jump: $('#hud-jump'), prompt: $('#hud-prompt'), toast: $('#hud-toast'), panel: $('#hud-panel'), tool: $('#hud-tool'), mode: $('#hud-mode'), bag: $('#hud-bag'), map: $('#hud-map'), hint: $('#hud-hint'), dialog: $('#hud-dialog') };
  const handlers = {};
  const fire = (k, ...a) => handlers[k] && handlers[k](...a);
  const tapBtn = (b, k) => {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('press'); fire(k); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => b.classList.remove('press'));
  };
  tapBtn(el.act, 'primary'); tapBtn(el.act2, 'secondary'); tapBtn(el.jump, 'jump'); tapBtn(el.mode, 'mode'); tapBtn(el.bag, 'bag'); tapBtn(el.map, 'map'); tapBtn(el.tool, 'tool');
  el.dialog.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fire('dialog'); });

  // ---- joystick (left thumb): a vector in [-1, 1]^2, y up = forward
  const joy = { x: 0, y: 0, id: null };
  const R = 52;
  function joyAt(e) {
    const r = el.joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    joy.x = dx / R; joy.y = -dy / R;
    el.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  el.joy.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); joy.id = e.pointerId; try { el.joy.setPointerCapture(e.pointerId); } catch (err) { /* */ } el.joy.classList.add('active'); joyAt(e); fire('touch'); });
  el.joy.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) { e.preventDefault(); joyAt(e); } });
  const joyEnd = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; el.joy.classList.remove('active'); el.knob.style.transform = ''; };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.joy.addEventListener(ev, joyEnd);

  // ---- toasts
  function toast(text, ic = null, ms = 2600) {
    const t = document.createElement('div'); t.className = 't glass';
    t.innerHTML = (ic ? icon(ic) : '') + `<span>${text}</span>`;
    el.toast.appendChild(t);
    while (el.toast.children.length > 3) el.toast.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 700); }, ms);
  }
  // ---- prompt: up to two actions
  let promptKey = '';
  function setPrompt(a, b) {
    const key = (a ? a.label + a.icon : '') + '|' + (b ? b.label + b.icon : '');
    if (key === promptKey) return;
    promptKey = key;
    el.prompt.classList.toggle('hidden', !a);
    el.act.classList.toggle('hidden', !a); el.act2.classList.toggle('hidden', !b);
    if (!a) return;
    el.act.innerHTML = icon(a.icon || 'hand');
    if (b) el.act2.innerHTML = icon(b.icon || 'hand');
    el.prompt.innerHTML = (b ? `<div class="pill glass"><span class="key">R</span>${icon(b.icon || 'hand')}<span>${b.label}</span></div>` : '') + `<div class="pill glass"><span class="key">E</span>${icon(a.icon || 'hand')}<span>${a.label}</span></div>`;
  }
  function setTool(t) {
    el.tool.classList.toggle('hidden', !t);
    if (t) el.tool.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`;
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
    const order = ['Seeds', 'Flowers', 'Finds', 'Garden', 'Gathered', 'Moon', 'Worlds', 'Other'];
    return order.filter((g) => groups[g]).map((g) => `<h3>${g}</h3><div class="grid">${groups[g].map(([, n, inf]) => `<div class="item"><span class="ic" style="color:${inf.color}">${icon(inf.icon)}</span><span>${inf.name}</span><span class="n">${n}</span></div>`).join('')}</div>`).join('') || '<p class="muted">Nothing yet. Things you gather and grow will rest here.</p>';
  }
  const cost = (c) => Object.entries(c).map(([id, n]) => {
    const inf = id === 'find:any' ? { name: 'finds', icon: 'stone', color: '#c9b9a0' } : id === 'flower:any' ? { name: 'flowers', icon: 'flower', color: '#e58fb4' } : itemInfo(id);
    const have = id === 'find:any' ? game.total('find:') : id === 'flower:any' ? game.total('flower:') : game.count(id);
    return `<span class="chip" style="${have >= n ? '' : 'opacity:.55'}"><span style="color:${inf.color}">${icon(inf.icon)}</span>${Math.min(have, n)}/${n} ${inf.name}</span>`;
  }).join('');

  let mode = 'walk';
  function setMode(m) {
    mode = m;
    for (const k of ['joy', 'prompt', 'act', 'act2', 'jump', 'bag', 'map', 'tool', 'hint']) el[k].style.visibility = m === 'walk' ? '' : 'hidden';
    el.mode.style.visibility = m === 'cinematic' || m === 'away' ? 'hidden' : '';
    el.top.style.visibility = m === 'cinematic' ? 'hidden' : '';
    el.mode.innerHTML = icon(m === 'walk' ? 'leaf' : 'walk');
    el.mode.title = m === 'walk' ? 'Drift quietly (C)' : 'Walk the garden (C)';
  }
  let hintT = 0;
  return {
    el, joy, toast, setPrompt, setTool, openPanel, closePanel, renderPanel, say, itemsHtml, cost, setMode,
    get panelOpen() { return !el.panel.classList.contains('hidden'); },
    get dialogOpen() { return !!dlg; },
    on(k, fn) { handlers[k] = fn; },
    showJump(on) { el.jump.classList.toggle('hidden', !on); },
    showMap(on) { el.map.style.display = on ? '' : 'none'; },
    fadeTo(o, ms = 1200) { fade.style.transitionDuration = ms + 'ms'; fade.style.opacity = o; return new Promise((r) => setTimeout(r, ms)); },
    tick(dt, moving) { if (moving) { hintT += dt; if (hintT > 8) el.hint.style.opacity = 0; } },
    get mode() { return mode; },
  };
}
