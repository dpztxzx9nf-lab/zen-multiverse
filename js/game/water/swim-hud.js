// Breath and stamina in the water, drawn only while they matter: a row of bubbles for the held breath
// (each one is a few seconds of air), a thin stamina arc while she sprints, and the edge of the view
// darkening when the air is gone (hypoxia narrows vision before a blackout). Plus a faint water tint
// at the lens when the camera is under.
const CSS = `
#zm-swim{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 118px);transform:translateX(-50%);pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0;transition:opacity .5s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
#zm-swim.on{opacity:.95}
#zm-swim .bub{display:flex;gap:4px}
#zm-swim .bub i{width:11px;height:11px;border-radius:50%;border:1.5px solid rgba(220,240,255,.9);background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(150,210,240,.45) 45%,rgba(90,160,210,.25));transition:transform .25s,opacity .25s}
#zm-swim .bub i.gone{transform:scale(.3);opacity:0}
#zm-swim .bub i.pop{transform:scale(.7);opacity:.55}
#zm-swim .st{width:120px;height:4px;border-radius:999px;background:rgba(0,0,0,.35);overflow:hidden}
#zm-swim .st>b{display:block;height:100%;width:100%;border-radius:inherit;background:#bfe3a5;transition:width .15s linear}
#zm-swim .st.tired>b{background:#e3b45a}
#zm-swim .lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
#zm-uw{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at 50% 45%,rgba(40,120,150,0) 40%,rgba(10,40,60,.35) 100%)}
#zm-hyp{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 25%,rgba(0,0,0,.92) 80%)}
`;
const N = 10;
export function createSwimHud(hud) {
  if (!hud || !hud.root || typeof document === 'undefined') return { update() {}, dispose() {} };
  if (!document.getElementById('zm-swim-css')) { const st = document.createElement('style'); st.id = 'zm-swim-css'; st.textContent = CSS; document.head.appendChild(st); }
  const uw = document.createElement('div'); uw.id = 'zm-uw';
  const hyp = document.createElement('div'); hyp.id = 'zm-hyp';
  const el = document.createElement('div'); el.id = 'zm-swim';
  el.innerHTML = `<div class="lbl">Breath</div><div class="bub">${'<i></i>'.repeat(N)}</div><div class="st"><b></b></div>`;
  hud.root.prepend(uw, hyp); hud.root.appendChild(el);
  const bubs = [...el.querySelectorAll('.bub i')], stb = el.querySelector('.st'), stI = stb.querySelector('b'), lbl = el.querySelector('.lbl'), bubRow = el.querySelector('.bub');
  let last = '';
  return {
    update(player, underK = 0) {
      const S = player && player.swim, on = !!(player && player.swimming);
      uw.style.opacity = underK > 0 ? String(Math.min(1, underK)) : '0';
      if (!S) { el.classList.remove('on'); hyp.style.opacity = '0'; return; }
      const showB = on && (S.headUnder || S.breath < 0.999), showS = on && S.stamina < 0.995;
      el.classList.toggle('on', showB || showS);
      bubRow.style.display = lbl.style.display = showB ? '' : 'none';
      stb.style.display = showS ? '' : 'none';
      const n = S.breath * N, key = Math.ceil(n) + '|' + (n % 1 < 0.5 ? 1 : 0);
      if (key !== last) { last = key; bubs.forEach((b, i) => { b.classList.toggle('gone', i >= Math.ceil(n)); b.classList.toggle('pop', i === Math.ceil(n) - 1 && n % 1 < 0.5 && n % 1 > 0); }); }
      stI.style.width = Math.round(S.stamina * 100) + '%'; stb.classList.toggle('tired', !!S.tired);
      const hk = on ? Math.max(S.breath < 0.12 && S.headUnder ? (0.12 - S.breath) * 2.5 : 0, (1 - S.health) * 1.1, S.blackout ? 1 : 0) : 0;
      hyp.style.opacity = String(Math.min(1, hk));
    },
    dispose() { uw.remove(); hyp.remove(); el.remove(); },
  };
}
