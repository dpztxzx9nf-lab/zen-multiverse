// The crosshair maker: presets, live preview, every knob, saved customs and share codes.
// mount(body, rerender) renders into a settings/bag tab body.
import { PRESETS, SHAPES, svg, encode, decode, resolve, clean } from './crosshair.js';
import { settings, set } from './settings.js';

const SWATCH = ['#f4f1ea', '#cfe8b8', '#ffd38a', '#f2a7b8', '#9fd8ff', '#7fe0d0', '#ffffff', '#1b1f22'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let draft = null, msg = '';

export function mountCrosshair(b, rerender) {
  const H = settings.hud;
  if (!draft) draft = { ...resolve(H.crosshair, H.customs) };
  const cur = H.crosshair;
  const tile = (id, spec, label) => `<div class="xh-tile ${cur === id ? 'on' : ''}" data-pick="${id}" title="${esc(label)}"><span class="xh-pv">${spec.shape === 'none' && !spec.dot ? '<i class="muted">none</i>' : svg(spec)}</span><span>${esc(label)}</span>${id.startsWith('custom:') ? `<span class="xh-del" data-del="${id.slice(7)}">×</span>` : ''}</div>`;
  const slider = (k, label, min, max, step) => `<label class="xh-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${draft[k]}" data-k="${k}"><span class="v" data-v="${k}">${draft[k]}</span></label>`;
  b.innerHTML = `
    <h3>Focal point</h3>
    <div class="xh-grid">${Object.entries(PRESETS).map(([id, p]) => tile(id, p, p.name)).join('')}${H.customs.map((c, i) => tile('custom:' + i, clean(c), c.name || 'Mine ' + (i + 1))).join('')}</div>
    <h3>Make your own</h3>
    <div class="xh-maker">
      <div class="xh-preview"><div class="xh-big">${svg(draft)}</div><div class="xh-big hot">${svg(draft)}</div><small class="muted">resting · on something</small></div>
      <div class="xh-knobs">
        <div class="xh-shapes">${SHAPES.map((s) => `<span class="pill ${draft.shape === s ? 'on' : ''}" data-shape="${s}">${s === 't' ? 'T' : s}</span>`).join('')}</div>
        ${slider('size', 'Size', 1, 24, 0.5)}${slider('thick', 'Thickness', 0.5, 6, 0.5)}${slider('gap', 'Gap', 0, 14, 0.5)}
        ${slider('opacity', 'Opacity', 0.1, 1, 0.05)}${slider('outline', 'Outline', 0, 3, 0.5)}
        <div class="xh-row"><span>Colour</span><span class="sw-row">${SWATCH.map((c) => `<span class="swatch ${draft.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}<input type="color" value="${draft.color}" data-k="color"></span></div>
        <div class="xh-row"><span>Centre dot</span><span class="pill ${draft.dot ? 'on' : ''}" data-dot="1">${draft.dot ? 'on' : 'off'}</span></div>
        <div class="xh-row"><button class="b" data-use="1">Use this</button><button class="b ghost" data-save="1">Save as mine</button></div>
      </div>
    </div>
    <h3>Share</h3>
    <div class="xh-row"><input class="xh-code" readonly value="${encode(draft)}" data-code="1"><button class="b ghost" data-copy="1">Copy</button></div>
    <div class="xh-row"><input class="xh-code" placeholder="Paste a ZEN1- code" data-import="1"><button class="b ghost" data-imp="1">Import</button></div>
    <p class="muted xh-msg">${esc(msg)}</p>`;
  msg = '';
  const stop = (e) => e.stopPropagation();
  const live = () => {
    const pv = svg(draft);
    b.querySelectorAll('.xh-big').forEach((d) => { d.innerHTML = pv; });
    const c = b.querySelector('[data-code]'); if (c) c.value = encode(draft);
  };
  b.querySelectorAll('[data-pick]').forEach((d) => d.addEventListener('pointerdown', (e) => {
    stop(e); if (e.target.dataset.del != null) return;
    set('hud.crosshair', d.dataset.pick); draft = { ...resolve(d.dataset.pick, H.customs) }; rerender();
  }));
  b.querySelectorAll('[data-del]').forEach((d) => d.addEventListener('pointerdown', (e) => {
    stop(e); const i = +d.dataset.del; const list = H.customs.filter((_, k) => k !== i);
    let pick = H.crosshair; if (pick === 'custom:' + i) pick = 'dot'; else { const m = /^custom:(\d+)$/.exec(pick); if (m && +m[1] > i) pick = 'custom:' + (+m[1] - 1); }
    set('hud.customs', list); set('hud.crosshair', pick); rerender();
  }));
  b.querySelectorAll('input[type=range]').forEach((r) => { r.addEventListener('pointerdown', stop); r.addEventListener('input', () => { draft[r.dataset.k] = +r.value; b.querySelector(`[data-v=${r.dataset.k}]`).textContent = r.value; live(); }); });
  b.querySelectorAll('[data-shape]').forEach((d) => d.addEventListener('pointerdown', (e) => { stop(e); draft.shape = d.dataset.shape; rerender(); }));
  b.querySelectorAll('[data-color]').forEach((d) => d.addEventListener('pointerdown', (e) => { stop(e); draft.color = d.dataset.color; rerender(); }));
  const ci = b.querySelector('input[type=color]'); ci.addEventListener('pointerdown', stop); ci.addEventListener('input', () => { draft.color = ci.value; live(); });
  b.querySelector('[data-dot]').addEventListener('pointerdown', (e) => { stop(e); draft.dot = !draft.dot; rerender(); });
  b.querySelector('[data-use]').addEventListener('pointerdown', (e) => {
    stop(e);
    // "use" edits the chosen custom in place, or makes a new custom from a preset
    const m = /^custom:(\d+)$/.exec(H.crosshair);
    if (m) { const list = H.customs.slice(); list[+m[1]] = { ...clean(draft), name: list[+m[1]].name }; set('hud.customs', list); }
    else saveNew();
    msg = 'In use.'; rerender();
  });
  function saveNew() {
    if (H.customs.length >= 8) { msg = 'Eight is plenty: remove one first.'; return; }
    const list = H.customs.concat([{ ...clean(draft), name: 'Mine ' + (H.customs.length + 1) }]);
    set('hud.customs', list); set('hud.crosshair', 'custom:' + (list.length - 1));
  }
  b.querySelector('[data-save]').addEventListener('pointerdown', (e) => { stop(e); saveNew(); if (!msg) msg = 'Saved.'; rerender(); });
  b.querySelector('[data-copy]').addEventListener('pointerdown', (e) => {
    stop(e); const c = encode(draft);
    try { navigator.clipboard.writeText(c).then(() => { msg = 'Copied ' + c; rerender(); }, () => { msg = c; rerender(); }); } catch (err) { msg = c; rerender(); }
  });
  const inp = b.querySelector('[data-import]'); inp.addEventListener('pointerdown', stop);
  b.querySelector('[data-imp]').addEventListener('pointerdown', (e) => {
    stop(e); const d = decode(inp.value);
    if (!d) { msg = 'That code did not read. It starts with ZEN1-'; rerender(); return; }
    draft = d; saveNew(); if (!msg) msg = 'Imported.'; rerender();
  });
}
export function crosshairDraft() { return draft; }
export function resetDraft() { draft = null; }
