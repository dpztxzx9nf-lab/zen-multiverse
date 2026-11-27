// The one in-game HUD: a single sci-fi hotbar (tools and guns share slots), a short
// hint, and (on touch) action buttons. Ammo is drawn on a slot only when that gun
// is equipped. One stylesheet also restyles the minimap and Online/Compete chips
// so they match this bar — there is no second garden HUD.
const STYLE = `
:root{--xen-hud-font:ui-sans-serif,system-ui,"Segoe UI",sans-serif;--xen-hud-bg:rgba(8,14,20,.72);--xen-hud-line:rgba(110,220,210,.28);--xen-hud-accent:#7ee0d6;--xen-hud-ink:#e8f4f2}
#g7-bar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);transform:translateX(-50%);display:flex;gap:6px;z-index:30;pointer-events:auto;font:11px/1.1 var(--xen-hud-font);color:var(--xen-hud-ink);letter-spacing:.04em;transition:opacity .3s}
#g7-bar .s{width:54px;height:54px;border-radius:6px;background:var(--xen-hud-bg);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:.88;cursor:pointer;border:1px solid var(--xen-hud-line);padding:0;box-sizing:border-box}
#g7-bar .s.on{opacity:1;border-color:var(--xen-hud-accent);box-shadow:0 0 0 1px rgba(126,224,214,.25),0 0 12px rgba(126,224,214,.15)}
#g7-bar .s i{font-style:normal;font-size:15px;line-height:1;font-weight:600}
#g7-bar .s b{font-weight:500;font-size:9px;opacity:.7;margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
#g7-bar .s .ammo{font:600 10px/1 ui-monospace,Menlo,Consolas,monospace;color:var(--xen-hud-accent);margin-top:2px;letter-spacing:.02em}
#g7-sub{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 78px);transform:translateX(-50%);z-index:30;font:12px/1.2 var(--xen-hud-font);color:var(--xen-hud-ink);text-shadow:0 1px 3px rgba(0,0,0,.65);opacity:.9;pointer-events:none;white-space:nowrap;letter-spacing:.04em}
#g7-touch{position:fixed;right:calc(env(safe-area-inset-right,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 90px);z-index:31;display:grid;grid-template-columns:repeat(2,58px);gap:12px;pointer-events:auto}
#g7-touch .b{width:58px;height:58px;border-radius:8px;background:var(--xen-hud-bg);border:1px solid var(--xen-hud-line);color:var(--xen-hud-ink);display:flex;align-items:center;justify-content:center;font:11px var(--xen-hud-font);letter-spacing:.06em;text-transform:uppercase;touch-action:none;user-select:none;-webkit-user-select:none}
#g7-touch .b.hide{visibility:hidden}
#g7-ring{position:fixed;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;z-index:29;pointer-events:none;opacity:0;transition:opacity .3s}
#mp{font-family:var(--xen-hud-font)!important}
#mp .chip{background:var(--xen-hud-bg)!important;border:1px solid var(--xen-hud-line)!important;border-radius:8px!important;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#zen-mini{border-radius:8px!important;box-shadow:0 0 0 1px var(--xen-hud-line),0 6px 20px rgba(0,0,0,.35)!important}
#zen-mini .n{font-family:var(--xen-hud-font)!important;font-weight:600;letter-spacing:.12em}
`;
let ammoById = {};
export function setHotbarAmmo(id, text) {
  if (text) ammoById[id] = text; else delete ammoById[id];
}
export function createHotbar({ touch = false }) {
  if (!document.getElementById('xenia-hud-style')) {
    const st = document.createElement('style'); st.id = 'xenia-hud-style'; st.textContent = STYLE; document.head.appendChild(st);
  }
  const bar = document.createElement('div'); bar.id = 'g7-bar'; document.body.appendChild(bar);
  const sub = document.createElement('div'); sub.id = 'g7-sub'; document.body.appendChild(sub);
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ring.id = 'g7-ring'; ring.setAttribute('viewBox', '0 0 34 34');
  ring.innerHTML = '<circle cx="17" cy="17" r="14" fill="none" stroke="rgba(126,224,214,.25)" stroke-width="2"/><circle id="g7-ring-p" cx="17" cy="17" r="14" fill="none" stroke="rgba(126,224,214,.9)" stroke-width="2" stroke-dasharray="88" stroke-dashoffset="88" transform="rotate(-90 17 17)" stroke-linecap="round"/>';
  document.body.appendChild(ring);
  const ringP = ring.querySelector('#g7-ring-p');
  let tb = null; const handlers = {};
  if (touch) {
    tb = document.createElement('div'); tb.id = 'g7-touch';
    tb.innerHTML = ['ability:gust', 'vine:vine', 'slide:slide', 'jump:jump', 'use:use', 'alt:place'].map((s) => { const [k, l] = s.split(':'); return `<div class="b" data-k="${k}">${l}</div>`; }).join('');
    document.body.appendChild(tb);
    tb.querySelectorAll('.b').forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.style.borderColor = 'var(--xen-hud-accent)'; handlers[k] && handlers[k](true); });
      const up = (e) => { e.preventDefault(); b.style.borderColor = ''; handlers[k] && handlers[k](false); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });
  }
  let onPick = null, lastKey = '';
  return {
    set(slots, sel) {
      const key = slots.map((s) => s.id + s.label + (s.ammo || ammoById[s.id] || '')).join('|') + sel; if (key === lastKey) return; lastKey = key;
      bar.innerHTML = slots.map((s, i) => {
        const ammo = (i === sel) ? (s.ammo || ammoById[s.id] || '') : '';
        return `<div class="s ${i === sel ? 'on' : ''}" data-i="${i}"><i>${s.glyph}</i><b>${i + 1} ${s.label}</b>${ammo ? `<span class="ammo">${ammo}</span>` : ''}</div>`;
      }).join('');
      bar.querySelectorAll('.s').forEach((d) => d.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPick && onPick(+d.dataset.i); }));
    },
    sub(t) { if (sub.textContent !== t) sub.textContent = t || ''; },
    progress(k) { ring.style.opacity = k > 0 && k < 1 ? '1' : '0'; ringP.setAttribute('stroke-dashoffset', String(88 * (1 - Math.max(0, Math.min(1, k))))); },
    show(on) { bar.style.opacity = on ? '1' : '0'; bar.style.pointerEvents = on ? 'auto' : 'none'; sub.style.opacity = on ? '.9' : '0'; if (tb) tb.style.display = on ? '' : 'none'; },
    touchBtn(k, visible, label) { if (!tb) return; const b = tb.querySelector(`[data-k=${k}]`); if (!b) return; b.classList.toggle('hide', !visible); if (label && b.textContent !== label) b.textContent = label; },
    on(k, fn) { handlers[k] = fn; },
    set onPick(f) { onPick = f; },
  };
}
