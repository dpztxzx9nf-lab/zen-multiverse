// Quiet milestones: gentle firsts, earned by living in the game, never by grinding. Saved in
// garden-save (game.ach = { id: time }). A soft toast when one arrives; the pause menu lists them.
import { game, UNLOCK_ALL } from './store.js';
import { icon } from './icons.js';
import { interactEvents } from './interact.js';

const n = (o) => Object.keys(o || {}).length;
const fauna = (G) => Object.values((G.journal || {}).species || {}).filter((e) => e.kind === 'fauna').length;
const waterDays = (G) => new Set((G.beds || []).filter(Boolean).flatMap((b) => b.w || [])).size;
export const MILESTONES = [
  { id: 'breath', name: 'First koi breath', hint: 'Hold a finger on the pond and breathe with the koi.', ic: 'fish', test: (G, X) => X.breaths > 0 || (G.stats && G.stats.breaths > 0) },
  { id: 'tend', name: 'A first small kindness', hint: 'Tend something: a stone, a bonsai, the koi.', ic: 'hand', test: (G, X) => X.runs > 0 },
  { id: 'seed', name: 'Seed in the soil', hint: 'Plant a seed in one of the beds.', ic: 'seed', test: (G) => (G.beds || []).filter(Boolean).length > 0 },
  { id: 'bloom', name: 'First bloom', hint: 'Water a bed for a few days and gather its flowers.', ic: 'flower', test: () => game.total('flower:') > 0 },
  { id: 'week', name: 'A week of watering', hint: 'Water the beds on seven different days.', ic: 'water', test: (G) => waterDays(G) >= 7 },
  { id: 'rocket', name: 'The rocket stands', hint: 'Build all five rocket parts.', ic: 'rocket', test: (G) => ((G.rocket || {}).parts || []).length >= 5 },
  { id: 'launch', name: 'First launch', hint: 'Ride the rocket to the moon.', ic: 'rocket', test: (G) => !!(G.seen && G.seen.moon) },
  { id: 'moonhome', name: 'A light on the moon', hint: 'Build a first module on the moon.', ic: 'home', test: (G) => n((G.moon || {}).modules) >= 1 },
  { id: 'base', name: 'A whole little base', hint: 'Habitat, greenhouse, antenna and solar array.', ic: 'build', test: (G) => ['habitat', 'greenhouse', 'antenna', 'solar'].every((k) => (G.moon || {}).modules && G.moon.modules[k]) },
  { id: 'world', name: 'Another sky', hint: 'Land on a world beyond the moon.', ic: 'star', test: (G) => n((G.journal || {}).planets) >= 1 },
  { id: 'watcher', name: 'Patient watcher', hint: 'Stand still and watch a creature until you know its name.', ic: 'eye', test: (G) => fauna(G) >= 1 },
  { id: 'ten', name: 'Ten names in the journal', hint: 'Meet ten species, plants or animals.', ic: 'book', test: (G) => n((G.journal || {}).species) >= 10 },
  { id: 'fleet', name: 'A second ship', hint: 'Make a new ship from what you have gathered.', ic: 'rocket', test: (G) => ((G.fleet || {}).owned || []).length >= 2 },
  { id: 'five', name: 'Five skies', hint: 'Visit five worlds.', ic: 'map', test: (G) => n((G.journal || {}).planets) >= 5 },
  { id: 'hour', name: 'An unhurried hour', hint: 'Spend an hour, all told, in the game.', ic: 'leaf', test: (G) => (G.stats && G.stats.sec || 0) >= 3600 },
];
export function createAchievements({ hud, audio }) {
  const G = game.data;
  G.ach = G.ach || {}; G.stats = G.stats || { breaths: 0, sec: 0 };
  const X = { breaths: 0, runs: 0 }; const runs0 = interactEvents.runs;
  // the pond breath: each breath with the koi passes through audio.breath(on, inhale)
  if (audio && audio.breath) { const f = audio.breath; audio.breath = (on, inhale) => { if (on && inhale != null) { X.breaths++; G.stats.breaths = (G.stats.breaths || 0) + 1; } return f.call(audio, on, inhale); }; }
  let first = true, queue = [];
  function check() {
    X.runs = interactEvents.runs - runs0;
    for (const m of MILESTONES) {
      if (G.ach[m.id]) continue;
      let ok = false; try { ok = m.test(G, X); } catch (e) { /* */ }
      if (!ok) continue;
      G.ach[m.id] = Date.now();
      // already true when the game first meets this save: granted quietly, no flood of toasts
      if (!first && !UNLOCK_ALL) queue.push(m);
    }
    first = false;
    if (queue.length) game.save();
  }
  // one toast at a time, spaced out
  setInterval(() => { const m = queue.shift(); if (m) hud.toast(`A quiet milestone · ${m.name}`, 'star', 5600); }, 6500);
  setInterval(() => { if (!document.hidden) { G.stats.sec = (G.stats.sec || 0) + 5; } check(); }, 5000);
  check();
  return {
    check,
    render(b) {
      const got = MILESTONES.filter((m) => G.ach[m.id]).length;
      b.innerHTML = `<h3>${got} of ${MILESTONES.length} quiet milestones</h3>` + MILESTONES.map((m) => {
        const t = G.ach[m.id];
        return `<div class="zs zach ${t ? 'got' : ''}"><span class="ai">${icon(m.ic)}</span><span class="l">${m.name}<small>${t ? 'on ' + new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : m.hint}</small></span>${t ? '<span class="seal">✓</span>' : ''}</div>`;
      }).join('');
    },
  };
}
export const ACH_CSS = `
#zen-menu .zach{opacity:.55}
#zen-menu .zach.got{opacity:1}
#zen-menu .zach .ai{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:52% 48% 46% 54% / 58% 50% 50% 42%;background:rgba(0,0,0,.25);flex:none}
#zen-menu .zach .ai svg{width:18px;height:18px}
#zen-menu .zach.got .ai{color:#cfe8b8}
#zen-menu .zach .seal{width:26px;height:26px;border-radius:5px;transform:rotate(-6deg);background:rgba(200,85,61,.75);color:#fbeee8;display:flex;align-items:center;justify-content:center;font-size:14px}
`;
