// A small, calm tool row at the bottom of the screen (game worlds only) plus, on touch screens, a
// few soft round buttons for jump, slide, use and abilities. The UI layer can restyle these: the
// row is #g7-bar, buttons are #g7-touch > .b[data-k].
export function createHotbar({ touch = false }) {
  const css = `
#g7-bar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);transform:translateX(-50%);display:flex;gap:8px;z-index:30;pointer-events:auto;font:13px/1.1 Georgia,serif;color:#f4efe6;transition:opacity .6s}
#g7-bar .s{min-width:46px;height:46px;border-radius:14px;background:rgba(20,24,22,.34);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:.72;cursor:pointer;border:1px solid rgba(255,255,255,.12);padding:0 6px}
#g7-bar .s.on{opacity:1;background:rgba(20,24,22,.55);border-color:rgba(255,236,200,.55)}
#g7-bar .s i{font-style:normal;font-size:17px;line-height:1}
#g7-bar .s b{font-weight:400;font-size:10px;opacity:.7;margin-top:3px;letter-spacing:.04em}
#g7-sub{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 70px);transform:translateX(-50%);z-index:30;font:13px Georgia,serif;color:#f4efe6;text-shadow:0 1px 3px rgba(0,0,0,.6);opacity:.85;pointer-events:none;white-space:nowrap}
#g7-touch{position:fixed;right:calc(env(safe-area-inset-right,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 90px);z-index:31;display:grid;grid-template-columns:repeat(2,58px);gap:12px;pointer-events:auto}
#g7-touch .b{width:58px;height:58px;border-radius:50%;background:rgba(20,24,22,.32);border:1px solid rgba(255,255,255,.18);color:#f4efe6;display:flex;align-items:center;justify-content:center;font:12px Georgia,serif;touch-action:none;user-select:none;-webkit-user-select:none}
#g7-touch .b.hide{visibility:hidden}
#g7-ring{position:fixed;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;z-index:29;pointer-events:none;opacity:0;transition:opacity .3s}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const bar = document.createElement('div'); bar.id = 'g7-bar'; document.body.appendChild(bar);
  const sub = document.createElement('div'); sub.id = 'g7-sub'; document.body.appendChild(sub);
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ring.id = 'g7-ring'; ring.setAttribute('viewBox', '0 0 34 34');
  ring.innerHTML = '<circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><circle id="g7-ring-p" cx="17" cy="17" r="14" fill="none" stroke="rgba(255,240,215,.85)" stroke-width="2" stroke-dasharray="88" stroke-dashoffset="88" transform="rotate(-90 17 17)" stroke-linecap="round"/>';
  document.body.appendChild(ring);
  const ringP = ring.querySelector('#g7-ring-p');
  let tb = null; const handlers = {};
  if (touch) {
    tb = document.createElement('div'); tb.id = 'g7-touch';
    tb.innerHTML = ['ability:gust', 'vine:vine', 'slide:slide', 'jump:jump', 'use:use', 'alt:place'].map((s) => { const [k, l] = s.split(':'); return `<div class="b" data-k="${k}">${l}</div>`; }).join('');
    document.body.appendChild(tb);
    tb.querySelectorAll('.b').forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.style.background = 'rgba(255,240,215,.35)'; handlers[k] && handlers[k](true); });
      const up = (e) => { e.preventDefault(); b.style.background = ''; handlers[k] && handlers[k](false); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
  }
  let onPick = null, lastKey = '';
  return {
    set(slots, sel) {
      const key = slots.map((s) => s.id + s.label).join('|') + sel; if (key === lastKey) return; lastKey = key;
      bar.innerHTML = slots.map((s, i) => `<div class="s ${i === sel ? 'on' : ''}" data-i="${i}"><i>${s.glyph}</i><b>${i + 1} ${s.label}</b></div>`).join('');
      bar.querySelectorAll('.s').forEach((d) => d.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPick && onPick(+d.dataset.i); }));
    },
    sub(t) { if (sub.textContent !== t) sub.textContent = t || ''; },
    progress(k) { ring.style.opacity = k > 0 && k < 1 ? '1' : '0'; ringP.setAttribute('stroke-dashoffset', String(88 * (1 - Math.max(0, Math.min(1, k))))); },
    show(on) { bar.style.opacity = on ? '1' : '0'; bar.style.pointerEvents = on ? 'auto' : 'none'; sub.style.opacity = on ? '.85' : '0'; if (tb) tb.style.display = on ? '' : 'none'; },
    touchBtn(k, visible, label) { if (!tb) return; const b = tb.querySelector(`[data-k=${k}]`); if (!b) return; b.classList.toggle('hide', !visible); if (label && b.textContent !== label) b.textContent = label; },
    on(k, fn) { handlers[k] = fn; },
    set onPick(f) { onPick = f; },
  };
}
