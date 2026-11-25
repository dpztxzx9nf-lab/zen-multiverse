// Game-only UI layer: crosshair, (later) the pause menu, settings, map, tutorial and milestones.
// Started from main.js only when isGameWorld(); mom's garden never loads it.
import { getHud } from './session.js';
import { settings, onChange } from './settings.js';
import { svg, resolve } from './crosshair.js';
import { mountCrosshair } from './crosshair-ui.js';
import { MAKER_CSS } from './zen-style.js';

export function startGameUI(env) {
  const { P } = env;
  const hud = getHud(P);
  const st = document.createElement('style'); st.id = 'zen-style'; st.textContent = MAKER_CSS; document.head.appendChild(st);
  // ---- crosshair: on by default, re-drawn whenever its settings change
  function applyCrosshair() {
    const H = settings.hud, spec = resolve(H.crosshair, H.customs);
    const off = !H.show.crosshair || (spec.shape === 'none' && !spec.dot);
    hud.setCrosshair(off ? null : svg(spec));
  }
  applyCrosshair();
  onChange((path) => { if (path === '*' || path.startsWith('hud')) applyCrosshair(); });
  // the bag gets a "Focal point" tab with the maker
  const xhTab = { id: 'xh', label: 'Focal point', icon: 'eye', render: (b, re) => mountCrosshair(b, re) };
  const open = hud.openPanel;
  hud.openPanel = (list, which) => open(list.some((t) => t.id === 'xh') ? list : [...list, xhTab], which);
  const api = { hud, applyCrosshair };
  if (env.params.has('debug')) window.__gameui = api;
  return api;
}
