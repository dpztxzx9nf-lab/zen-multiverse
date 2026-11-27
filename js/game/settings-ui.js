// The settings page inside the pause menu, generated from settings-items.js: search across every
// tab, tooltips (hover a row, or focus it with a controller: the tip shows in the bar at the bottom),
// typed numbers next to every slider, reset per tab (and per keybind category), conflict warnings,
// a "Keep these display settings?" 10 s countdown, and full gamepad navigation.
import { settings, get, set, defaults, ACTION_GROUPS, ACTION_NAME, PAD_NAMES, keyName, conflicts, GAMES, fromGame, toGame, cm360, zen } from './settings.js';
import { ITEMS, TABS, TAB_SECTIONS, PRESETS } from './settings-items.js';
import { mountCrosshair } from './crosshair-ui.js';
import { persist } from '../save.js';
import { devAllowed, devOn, setDevOn, onDevChange } from './dev-mode.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PRESET_KEYS = Object.keys(PRESETS.high);

export const SETTINGS_CSS = `
#zen-menu .zst-devrow{display:none;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px 0}
#zen-menu .zst-devrow.on{display:flex}
#zen-menu .zst-devrow .l{font-weight:650;letter-spacing:.02em}
#zen-menu .zst-devrow .b{min-width:64px;padding:5px 14px;border-radius:10px;border:0;box-shadow:inset 0 0 0 1px rgba(236,222,196,.22);background:rgba(239,230,210,.07);color:inherit;cursor:pointer;font:inherit}
#zen-menu .zst-devrow .b.on{background:#2f6d46;box-shadow:inset 0 0 0 1px #4a9a68}
#zen-menu .zst-top{display:flex;align-items:center;gap:10px;padding:14px 18px 0}
#zen-menu .zst-search{flex:1;min-width:0;font:inherit;font-size:14px;color:var(--paper);background:rgba(239,230,210,.07);border:0;box-shadow:inset 0 0 0 1px rgba(236,222,196,.18);border-radius:12px;padding:8px 12px 8px 32px;outline:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23efe6d2' stroke-opacity='.6' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='6'/%3E%3Cpath d='m20 20-4.5-4.5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:9px center;background-size:16px}
#zen-menu .zst-search:focus{box-shadow:inset 0 0 0 1px rgba(255,230,190,.55)}
#zen-menu .zst-tipbar{flex:none;min-height:38px;padding:9px 22px 11px;font-size:13px;line-height:1.4;opacity:.78;border-top:1px solid rgba(236,222,196,.08);display:flex;gap:12px;align-items:center}
#zen-menu .zst-tipbar .t{flex:1;min-width:0}
#zen-menu .zst-tipbar .pads{opacity:.72;font-size:12px;white-space:nowrap}
html:not(.zs-pad) #zen-menu .zst-tipbar .pads{display:none}
#zen-menu .zs.f{box-shadow:inset 0 0 0 1px rgba(255,230,190,.55);background:rgba(239,230,210,.09)}
#zen-menu .zs.dis{opacity:.5}
#zen-menu .zs .why{font-size:12px;letter-spacing:.03em;padding:3px 8px;border-radius:999px;background:rgba(239,230,210,.09);opacity:.85;white-space:nowrap}
#zen-menu .zs input.num{width:64px;font:inherit;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;color:var(--paper);background:rgba(239,230,210,.07);border:0;box-shadow:inset 0 0 0 1px rgba(236,222,196,.18);border-radius:8px;padding:4px 7px;outline:none}
#zen-menu .zs input.num:focus{box-shadow:inset 0 0 0 1px rgba(255,230,190,.6)}
#zen-menu .zs .u{width:26px;margin-left:-6px;font-size:12px;opacity:.6;white-space:nowrap}
#zen-menu .zs select{font:inherit;font-size:13px;color:var(--paper);background:rgba(28,30,30,.9);border:0;box-shadow:inset 0 0 0 1px rgba(236,222,196,.22);border-radius:9px;padding:5px 8px;max-width:240px}
#zen-menu .zs .key.warn{box-shadow:inset 0 0 0 1px rgba(255,190,90,.85);background:rgba(255,170,60,.14)}
#zen-menu .zs .l small.warn{color:#ffcf8a;opacity:.95}
#zen-menu .zst-gh{display:flex;align-items:center;gap:10px}
#zen-menu .zst-gh h3{flex:1}
#zen-menu .zst-gh button,#zen-menu .zst-foot button{font-size:12px;padding:4px 11px}
#zen-menu .zst-path{font-size:12px;opacity:.68;letter-spacing:.04em;margin:14px 0 6px;text-transform:uppercase}
#zen-menu .zst-banner{margin:12px 0 4px;padding:9px 12px;border-radius:12px;background:rgba(255,170,60,.12);box-shadow:inset 0 0 0 1px rgba(255,190,90,.35);font-size:13px}
#zen-menu .zst-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
#zen-menu .zst-conv{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end}
#zen-menu .zst-conv .out{font-size:12px;opacity:.75;width:100%;text-align:right}
#zen-menu .zst-sticks{display:flex;gap:10px}
#zen-menu .zst-sticks canvas{width:84px;height:84px;border-radius:50%;background:rgba(239,230,210,.06);box-shadow:inset 0 0 0 1px rgba(236,222,196,.2)}
#zen-menu .zst-keep{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(6,8,8,.55);z-index:5}
#zen-menu .zst-keep .box{padding:22px 26px;border-radius:20px 16px 21px 15px / 15px 21px 16px 20px;min-width:300px;text-align:center}
#zen-menu .zst-keep .n{font-family:var(--serif);font-size:44px;margin:6px 0 2px}
#zen-menu .zst-keep .row{display:flex;gap:10px;justify-content:center;margin-top:14px}
#zen-menu .zst-empty{padding:30px 6px;opacity:.6}
`;

// controller hints only while a controller is connected
if (typeof window !== 'undefined') {
  const padSync = () => document.documentElement.classList.toggle('zs-pad', (navigator.getGamepads ? [...navigator.getGamepads()] : []).some((g) => g && g.connected));
  addEventListener('gamepadconnected', padSync); addEventListener('gamepaddisconnected', padSync);
}
export function createSettingsPage({ menu, hud, getPad, extra }) {
  let tab = 'mouse', query = '', focus = -1, capture = null, keep = null, stickRaf = 0, tipFixed = '';
  let root = null, bodyEl = null, tipEl = null;
  const val = (p) => get(p);

  // ---- setting a value (presets, display countdown)
  function setVal(it, v) {
    const p = it.p, old = val(p);
    if (JSON.stringify(old) === JSON.stringify(v)) return;
    if (it.display) startKeep(p, old);
    set(p, v);
    if (p === 'video.preset' && PRESETS[v]) for (const [k, x] of Object.entries(PRESETS[v])) set('video.' + k, x);
    else if (p.startsWith('video.') && PRESET_KEYS.includes(p.slice(6))) {
      const V = settings.video, match = Object.entries(PRESETS).find(([, pr]) => PRESET_KEYS.every((k) => pr[k] === V[k]));
      set('video.preset', match ? match[0] : 'custom');
    }
  }
  function startKeep(p, old) {
    if (keep) { if (!(p in keep.prev)) keep.prev[p] = old; keep.left = 10; return showKeep(); }
    keep = { prev: { [p]: old }, left: 10, t: setInterval(() => { if (window.__zenKeepHold) return; keep.left--; if (keep.left <= 0) endKeep(false); else showKeep(); }, 1000) };
    setTimeout(showKeep, 0);
  }
  function endKeep(ok) {
    if (!keep) return;
    clearInterval(keep.t); const prev = keep.prev; keep = null;
    if (!ok) for (const [p, v] of Object.entries(prev)) set(p, v);
    const m = root && root.querySelector('.zst-keep'); if (m) m.remove();
    if (!ok) render();
  }
  function showKeep() {
    if (!keep || !root) return;
    let m = root.querySelector('.zst-keep');
    if (!m) {
      m = document.createElement('div'); m.className = 'zst-keep';
      m.innerHTML = `<div class="box glass"><div>Keep these display settings?</div><div class="n"></div><div class="muted" style="font-size:13px">Reverting automatically…</div><div class="row"><button class="b" data-k="1">Keep changes</button><button class="b ghost" data-k="0">Revert</button></div></div>`;
      m.addEventListener('pointerdown', (e) => { e.stopPropagation(); const b = e.target.closest('[data-k]'); if (b) endKeep(b.dataset.k === '1'); });
      root.appendChild(m);
    }
    m.querySelector('.n').textContent = keep.left;
  }

  // ---- rows
  function rowHtml(it, i) {
    const S = settings, dis = it.dis ? it.dis(S) : false;
    const lab = `<span class="l">${esc(it.label)}${sub(it)}</span>`;
    const why = dis ? `<span class="why">${esc(dis)}</span>` : '';
    const a = `class="zs ${dis ? 'dis' : ''} ${focus === i ? 'f' : ''}" data-i="${i}" title="${esc(it.tip || '')}"`;
    const v = it.p ? val(it.p) : null;
    switch (it.kind) {
      case 'slider': {
        const k = it.pc ? 100 : 1, dd = Math.max(0, it.dec - (it.pc ? 2 : 0)), u = it.pc ? '%' : it.unit || '';
        return `<div ${a}>${lab}${why}<input type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}" ${dis ? 'disabled' : ''}><input class="num" type="number" min="${+(it.min * k).toFixed(dd)}" max="${+(it.max * k).toFixed(dd)}" step="${+(it.step * k).toFixed(Math.max(dd, 3))}" value="${(v * k).toFixed(dd)}" ${dis ? 'disabled' : ''}><span class="u">${esc(u)}</span></div>`;
      }
      case 'toggle': return `<div ${a}>${lab}${why}<span class="tg ${v ? 'on' : ''} ${dis ? 'dis' : ''}"></span></div>`;
      case 'choice': return `<div ${a}>${lab}${why}<span class="ch">${it.opts.map(([o, l]) => `<span class="${v === o ? 'on' : ''}" data-v="${esc(o)}">${esc(l)}</span>`).join('')}</span></div>`;
      case 'select': return `<div ${a}>${lab}${why}<select ${dis ? 'disabled' : ''}>${opts(it).map(([o, l]) => `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      case 'key': {
        const K = settings.keys[it.a] || [], C = conflicts();
        return `<div ${a}>${lab}${[0, 1].map((s) => { const c = K[s]; const cap = capture && capture.kind === 'key' && capture.a === it.a && capture.s === s; return `<span class="key ${c ? '' : 'empty'} ${c && C[c] ? 'warn' : ''} ${cap ? 'cap' : ''}" data-s="${s}">${cap ? 'press…' : c ? esc(keyName(c)) : '—'}</span>`; }).join('')}</div>`;
      }
      case 'padbtn': {
        const B = settings.pad.buttons, b = B[it.a], cap = capture && capture.kind === 'pad' && capture.a === it.a;
        const dup = b != null && Object.entries(B).some(([x, y]) => x !== it.a && y === b);
        return `<div ${a}>${lab}<span class="key ${b == null ? 'empty' : ''} ${dup ? 'warn' : ''} ${cap ? 'cap' : ''}">${cap ? 'press a button…' : b == null ? '—' : esc(PAD_NAMES[b] || 'Button ' + b)}</span></div>`;
      }
      case 'custom': return `<div ${a} data-custom="${it.id}">${lab}<span class="cus"></span></div>`;
    }
    return '';
  }
  function opts(it) {
    if (it.p === 'audio.device') return [['default', 'System default'], ...outDevices.map((d, i) => [d.deviceId, d.label || `Output ${i + 1}`])];
    return it.opts;
  }
  function sub(it) {
    if (it.p === 'mouse.sens' || it.p === 'mouse.sensX') { const s = it.p === 'mouse.sens' ? settings.mouse.sens : settings.mouse.sensX; return `<small data-cm>${cmText(s)}</small>`; }
    if (it.kind === 'key') {
      const C = conflicts(), shared = new Set();
      for (const c of settings.keys[it.a] || []) for (const o of C[c] || []) if (o !== it.a) shared.add(ACTION_NAME[o]);
      return shared.size ? `<small class="warn">Also bound to ${esc([...shared].join(', '))}</small>` : '';
    }
    if (it.kind === 'padbtn') {
      const B = settings.pad.buttons, b = B[it.a]; const o = b == null ? [] : Object.entries(B).filter(([x, y]) => x !== it.a && y === b).map(([x]) => ACTION_NAME[x]);
      return o.length ? `<small class="warn">Also on ${esc(o.join(', '))}</small>` : '';
    }
    return '';
  }
  const cmText = (s) => `${cm360(s).toFixed(1)} cm/360 at ${settings.mouse.dpi} DPI · eDPI ${Math.round(s * settings.mouse.dpi)}`;

  // ---- which rows are on screen
  let list = [];
  function visible() {
    const S = settings, q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return ITEMS.filter((it) => (q.length ? q.every((w) => it.search.includes(w)) : it.tab === tab) && (!it.show || it.show(S)));
  }
  function render() {
    if (!root) return;
    cancelAnimationFrame(stickRaf); stickRaf = 0;
    list = visible();
    if (focus >= list.length) focus = list.length - 1;
    root.querySelector('.zm-tabs').innerHTML = TABS.map(([id, l]) => `<div class="zm-tab ${!query && tab === id ? 'on' : ''}" data-st="${id}">${l}</div>`).join('');
    let html = '', lastG = '';
    if (!query && tab === 'keybinds') {
      const C = conflicts(), n = Object.keys(C).length;
      if (n) html += `<div class="zst-banner">${n} key${n === 1 ? ' is' : 's are'} bound to more than one action: ${Object.entries(C).map(([c, a]) => `<b>${esc(keyName(c))}</b> (${a.map((x) => esc(ACTION_NAME[x])).join(' + ')})`).join(', ')}. Both actions fire when it is pressed.</div>`;
    }
    list.forEach((it, i) => {
      const g = query ? `${TABS.find((t) => t[0] === it.tab)[1]} › ${it.group}` : it.group;
      if (g !== lastG) {
        lastG = g;
        if (query) html += `<div class="zst-path">${esc(g)}</div>`;
        else if (it.kind === 'key') html += `<div class="zst-gh"><h3>${esc(g)}</h3><button class="b ghost" data-rcat="${it.cat}">Reset ${esc(g.toLowerCase())}</button></div>`;
        else html += `<h3>${esc(g)}</h3>`;
      }
      html += rowHtml(it, i);
    });
    if (!list.length) html = `<div class="zst-empty">Nothing matches “${esc(query)}”.</div>`;
    else if (!query) html += `<div class="zst-foot"><button class="b ghost" data-rtab="${tab}">Reset ${esc(TABS.find((t) => t[0] === tab)[1])} to defaults</button></div>`;
    bodyEl.innerHTML = html;
    for (const el of bodyEl.querySelectorAll('[data-custom]')) custom(el.dataset.custom, el.querySelector('.cus'), el);
    tip();
    if (focus >= 0) { const f = bodyEl.querySelector('.zs.f'); if (f) f.scrollIntoView({ block: 'nearest' }); }
  }
  function tip(i = focus) {
    if (!tipEl) return;
    const it = list[i];
    tipEl.querySelector('.t').textContent = tipFixed || (it ? it.tip || '' : 'Hover a setting to see what it does.');
  }

  // ---- custom rows
  function custom(id, el, row) {
    if (id === 'mouse.convert') {
      const g = settings.mouse._conv || 'fortnite';
      el.innerHTML = `<span class="zst-conv"><select data-g>${GAMES.map(([k, l]) => `<option value="${k}" ${k === g ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><input class="num" type="number" step="0.001" min="0" data-gs value="${+toGame(g, settings.mouse.sens).toFixed(3)}"><button class="b ghost" data-use>Use</button><span class="out"></span></span>`;
      const sel = el.querySelector('[data-g]'), inp = el.querySelector('[data-gs]'), out = el.querySelector('.out');
      const show = () => { const s = fromGame(sel.value, +inp.value || 0); out.textContent = s > 0 ? `= ${s.toFixed(3)} here · ${cm360(s).toFixed(1)} cm/360` : ''; };
      sel.addEventListener('change', () => { settings.mouse._conv = sel.value; persist(400); inp.value = +toGame(sel.value, settings.mouse.sens).toFixed(3); show(); });
      inp.addEventListener('input', show);
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.querySelector('[data-use]').dispatchEvent(new PointerEvent('pointerdown')); });
      el.querySelector('[data-use]').addEventListener('pointerdown', (e) => {
        e.stopPropagation(); const s = Math.round(fromGame(sel.value, +inp.value || 0) * 1000) / 1000; if (!(s > 0)) return;
        set('mouse.sens', s); if (settings.mouse.xy) { set('mouse.sensX', s); set('mouse.sensY', s); } render();
      });
      show();
    } else if (id === 'pad.status') {
      el.innerHTML = `<span class="muted" style="font-size:13px">${esc(getPad() ? getPad().status() : 'None found')}</span>`;
    } else if (id === 'pad.sticks') {
      el.innerHTML = '<span class="zst-sticks"><canvas width="84" height="84"></canvas><canvas width="84" height="84"></canvas></span>';
      const cvs = el.querySelectorAll('canvas');
      const draw = () => {
        stickRaf = requestAnimationFrame(draw);
        const g = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find((x) => x && x.connected), ax = g ? g.axes : [0, 0, 0, 0];
        [['left', 0], ['right', 2]].forEach(([w, o], k) => {
          const c = cvs[k].getContext('2d'), P = settings.pad, inn = w === 'left' ? P.leftIn : P.rightIn, out = w === 'left' ? P.leftOut : P.rightOut;
          c.clearRect(0, 0, 84, 84);
          c.strokeStyle = 'rgba(239,230,210,.25)'; c.beginPath(); c.arc(42, 42, 38 * out, 0, 7); c.stroke();
          c.fillStyle = 'rgba(200,85,61,.25)'; c.beginPath(); c.arc(42, 42, 38 * inn, 0, 7); c.fill();
          c.fillStyle = 'rgba(239,230,210,.4)'; c.beginPath(); c.arc(42 + (ax[o] || 0) * 38, 42 + (ax[o + 1] || 0) * 38, 3, 0, 7); c.fill();
          const [x, y] = zen.stick(ax[o] || 0, ax[o + 1] || 0, w);
          c.fillStyle = '#e9d2a8'; c.beginPath(); c.arc(42 + x * 38, 42 + y * 38, 5, 0, 7); c.fill();
        });
      };
      draw();
    } else if (id === 'hud.maker') {
      row.style.display = 'block'; row.querySelector('.l').style.display = 'none';
      const re = () => mountCrosshair(el, re); el.style.display = 'block'; re();
    } else if (id === 'hud.hitTest') {
      el.innerHTML = '<button class="b ghost">Show hit marker</button>';
      el.firstChild.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (zen.hitmarker) zen.hitmarker('hit'); });
    } else if (id === 'gameplay.tutorial') {
      el.innerHTML = '<button class="b ghost">Show them again</button>';
      el.firstChild.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (extra.tutorial) extra.tutorial.restart(); menu.close(); });
    }
  }

  // ---- input on rows
  function wire() {
    bodyEl.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.zs[data-i]'); if (!row) return;
      e.stopPropagation();
      const i = +row.dataset.i, it = list[i]; if (!it) return;
      focus = i; bodyEl.querySelectorAll('.zs.f').forEach((x) => x.classList.remove('f')); row.classList.add('f'); tip();
      if (it.dis && it.dis(settings)) return;
      if (it.kind === 'toggle' && e.target.closest('.tg')) { setVal(it, !val(it.p)); render(); }
      else if (it.kind === 'choice') { const o = e.target.closest('[data-v]'); if (o) { const raw = o.dataset.v, cur = it.opts.find(([x]) => String(x) === raw); setVal(it, cur ? cur[0] : raw); render(); } }
      else if (it.kind === 'padbtn') startPadCapture(it);
    });
    // key slots start listening on click (after the mouse button that clicked is released)
    bodyEl.addEventListener('click', (e) => {
      const k = e.target.closest('.key[data-s]'); const row = e.target.closest('.zs[data-i]'); if (!k || !row) return;
      e.stopPropagation(); const it = list[+row.dataset.i]; if (it && it.kind === 'key') { capture = { kind: 'key', a: it.a, s: +k.dataset.s }; render(); }
    });
    bodyEl.addEventListener('input', (e) => {
      const row = e.target.closest('.zs[data-i]'); if (!row) return; const it = list[+row.dataset.i]; if (!it || it.kind !== 'slider') return;
      if (e.target.type === 'range') {
        const v = +(+e.target.value).toFixed(it.dec); setVal(it, v);
        const n = row.querySelector('input.num'); if (n) n.value = numText(it, v);
        updRow(row, it, v);
      }
    });
    bodyEl.addEventListener('change', (e) => {
      const row = e.target.closest('.zs[data-i]'); if (!row) return; const it = list[+row.dataset.i]; if (!it) return;
      if (it.kind === 'slider' && e.target.classList.contains('num')) {
        let v = +e.target.value / (it.pc ? 100 : 1); if (!isFinite(v) || e.target.value === '') v = val(it.p);
        v = Math.min(it.max, Math.max(it.min, +v.toFixed(it.dec))); e.target.value = numText(it, v);
        setVal(it, v); const r = row.querySelector('input[type=range]'); if (r) r.value = v; updRow(row, it, v);
      } else if (it.kind === 'select') { const o = opts(it).find(([x]) => String(x) === e.target.value); setVal(it, o ? o[0] : e.target.value); render(); }
    });
    bodyEl.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); } });
    bodyEl.addEventListener('pointerover', (e) => { const row = e.target.closest('.zs[data-i]'); if (row) tip(+row.dataset.i); });
    bodyEl.addEventListener('pointerleave', () => tip());
    root.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-st],[data-rtab],[data-rcat]'); if (!t) return; e.stopPropagation();
      if (t.dataset.st) { tab = t.dataset.st; query = ''; root.querySelector('.zst-search').value = ''; focus = -1; render(); }
      else if (t.dataset.rtab) resetTab(t.dataset.rtab);
      else if (t.dataset.rcat) resetCat(t.dataset.rcat);
    });
  }
  const numText = (it, v) => (it.pc ? (v * 100).toFixed(Math.max(0, it.dec - 2)) : (+v).toFixed(it.dec));
  function updRow(row, it, v) {
    const cm = row.querySelector('[data-cm]'); if (cm) cm.textContent = cmText(v);
  }
  function resetTab(t) {
    const d = defaults();
    for (const s of TAB_SECTIONS[t]) {
      if (s === 'pad' || s === 'mouse' || s === 'video') { const prev = settings[s]; const keepConv = prev && prev._conv; settings[s] = d[s]; if (keepConv) settings[s]._conv = keepConv; } else settings[s] = d[s];
      set(s, settings[s]);
    }
    tipFixed = `${TABS.find((x) => x[0] === t)[1]} reset to defaults.`; render(); setTimeout(() => { tipFixed = ''; tip(); }, 2500);
  }
  function resetCat(cat) {
    const d = defaults(), g = ACTION_GROUPS.find((x) => x[0] === cat); const keys = { ...settings.keys };
    for (const [a] of g[2]) keys[a] = d.keys[a].slice();
    set('keys', keys); render();
  }
  // ---- binding capture: keyboard, mouse buttons, the wheel
  function bindCode(code) {
    if (!capture || capture.kind !== 'key') return;
    const keys = JSON.parse(JSON.stringify(settings.keys)), l = (keys[capture.a] = keys[capture.a] || []);
    if (code === null) l.splice(capture.s, 1); else if (code) { l[capture.s] = code; keys[capture.a] = [...new Set(l.filter(Boolean))]; }
    capture = null; set('keys', keys); render();
  }
  addEventListener('keydown', (e) => {
    if (!menu.open || !capture || capture.kind !== 'key') return;
    e.preventDefault(); e.stopImmediatePropagation();
    bindCode(e.code === 'Escape' ? '' : e.code === 'Backspace' || e.code === 'Delete' ? null : e.code);
  }, true);
  addEventListener('mousedown', (e) => { if (!menu.open || !capture || capture.kind !== 'key') return; e.preventDefault(); e.stopImmediatePropagation(); bindCode('Mouse' + e.button); }, true);
  addEventListener('wheel', (e) => { if (!menu.open || !capture || capture.kind !== 'key' || !e.deltaY) return; e.preventDefault(); e.stopImmediatePropagation(); bindCode(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); }, { capture: true, passive: false });
  addEventListener('contextmenu', (e) => { if (menu.open && capture) e.preventDefault(); }, true);
  function startPadCapture(it) {
    capture = { kind: 'pad', a: it.a }; render();
    const p = getPad(); if (!p) return;
    p.capture((btn) => {
      if (!capture || capture.kind !== 'pad') return;
      const m = { ...settings.pad.buttons }; m[capture.a] = btn; capture = null; set('pad.buttons', m); render();
    });
  }

  // ---- output devices (labels appear once the page may see them)
  let outDevices = [];
  function loadDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((l) => { outDevices = l.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'); if (tab === 'audio' && root) render(); }).catch(() => {});
  }

  const api = {
    // mount into the menu's main column
    mount(main) {
      root = main;
      main.innerHTML = `<div class="zst-devrow"><span class="l">Dev mode</span><button type="button" class="b" data-dev="toggle">Off</button></div><div class="zst-top"><input class="zst-search" type="search" placeholder="Search all settings" spellcheck="false"></div><div class="zm-tabs"></div><div class="zm-body"></div><div class="zst-tipbar"><span class="t"></span><span class="pads">LB/RB tab · ◀▶ change · A select · B back</span></div>`;
      const paintDev = () => {
        const row = main.querySelector('.zst-devrow'); if (!row) return;
        row.classList.toggle('on', devAllowed());
        const b = row.querySelector('[data-dev="toggle"]');
        if (b) { b.textContent = devOn() ? 'On' : 'Off'; b.classList.toggle('on', devOn()); }
      };
      main.querySelector('[data-dev="toggle"]').onclick = () => { setDevOn(!devOn()); paintDev(); };
      if (api._offDev) api._offDev();
      api._offDev = onDevChange(paintDev);
      paintDev();
      bodyEl = main.querySelector('.zm-body'); tipEl = main.querySelector('.zst-tipbar');
      const s = main.querySelector('.zst-search'); s.value = query;
      s.addEventListener('input', () => { query = s.value; focus = -1; render(); });
      s.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { if (s.value) { s.value = ''; query = ''; render(); } else s.blur(); } if (e.key === 'ArrowDown' || e.key === 'Enter') { s.blur(); api.nav(1); } });
      wire(); loadDevices(); render();
      if (keep) showKeep();
    },
    unmount() { cancelAnimationFrame(stickRaf); stickRaf = 0; capture = null; if (api._offDev) { api._offDev(); api._offDev = null; } root = null; },
    render,
    get focus() { return focus; },
    get capturing() { return !!capture; },
    get tab() { return tab; },
    setTab(t) { tab = t; query = ''; focus = -1; if (root) { root.querySelector('.zst-search').value = ''; render(); } },
    search(q) { query = q; focus = -1; if (root) { root.querySelector('.zst-search').value = q; render(); } },
    // gamepad / keyboard navigation
    nav(d) { if (!list.length) return; focus = focus < 0 ? (d > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, focus + d)); render(); },
    tabStep(d) { const i = TABS.findIndex((t) => t[0] === tab); api.setTab(TABS[(i + d + TABS.length) % TABS.length][0]); },
    adjust(d) {
      const it = list[focus]; if (!it || (it.dis && it.dis(settings))) return;
      if (it.kind === 'slider') { const v = Math.min(it.max, Math.max(it.min, +(val(it.p) + d * it.step * (it.step < 0.01 ? 10 : 1)).toFixed(it.dec))); setVal(it, v); render(); }
      else if (it.kind === 'choice' || it.kind === 'select') { const o = opts(it), i = o.findIndex(([x]) => x === val(it.p)); setVal(it, o[(i + d + o.length) % o.length][0]); render(); }
      else if (it.kind === 'toggle') { setVal(it, d > 0); render(); }
    },
    activate() {
      const it = list[focus]; if (!it || (it.dis && it.dis(settings))) return;
      if (it.kind === 'toggle') { setVal(it, !val(it.p)); render(); } else if (it.kind === 'choice' || it.kind === 'select') api.adjust(1);
      else if (it.kind === 'padbtn') startPadCapture(it);
      else if (it.kind === 'key') { capture = { kind: 'key', a: it.a, s: 0 }; render(); }
      else if (it.kind === 'custom') { const b = bodyEl.querySelector('.zs.f button'); if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }
    },
    blur() { focus = -1; render(); },
    keepPending: () => !!keep,
    keep: (ok) => endKeep(ok),
  };
  return api;
}
