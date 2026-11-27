// Skills you learn by doing, saved with the game slice (G.g7.skills, .practice, .gear)
// alongside tools and abilities. Nothing here is granted for free.
import { worldRules } from '../universe/current.js';
import { game, itemInfo, UNLOCK_ALL } from './store.js';
import { RECIPES, ABILITIES, COST_ALIAS } from './g7/craft.js';
import { appearance } from './avatar/appearance.js';

export const SKILLS = {
  gathering: { name: 'Gathering', desc: 'Take what the land gives, and know it.', need: 8, via: 'picking things up: salt, cones, finds, flowers, ore, sand, fibre' },
  textiles: { name: 'Textiles', desc: 'Fibre into cloth that can hold a shape.', need: 6, via: 'gathering plant fibre and weaving cloth' },
  metalwork: { name: 'Metalwork', desc: 'Ore in the fire, a bar in the hand.', need: 2, via: 'smelting ore into metal at a bench' },
  sealing: { name: 'Sealing', desc: 'Pitch and stitches that keep air in.', need: 1, via: 'making a pitch seal, or building the rocket capsule' },
  life: { name: 'Life support', desc: 'A tank, a regulator, a breath you can carry.', need: 1, via: 'assembling an oxygen tank, or finishing the capsule' },
};
export const SKILL_ORDER = ['gathering', 'textiles', 'metalwork', 'sealing', 'life'];
const GATHER_PRE = ['find:', 'flower:', 'sample:'];
const GATHER_IDS = new Set(['salt', 'pinecone', 'driftwood', 'fibre', 'clipping', 'regolith', 'ice', 'moonglass', 'herb', 'mat:soil', 'mat:sand', 'mat:stone', 'mat:ice', 'mat:ore', 'mat:wood', 'mat:crystal', 'mat:scrap', 'mat:resonite', 'mat:deep-resonite']);
const toast = (t, ms) => { try { const h = window.__garden && window.__garden.hud; if (h && h.toast) h.toast(t, 'leaf', ms || 4200); } catch (e) { /* */ } };

export function ensureG7(g = game.data) {
  const t = g.g7 || (g.g7 = {});
  t.v = t.v || 1;
  t.tools = t.tools || {}; t.abilities = t.abilities || {}; t.worlds = t.worlds || {};
  t.skills = t.skills || {}; t.practice = t.practice || {}; t.gear = t.gear || {};
  if (t.o2 == null) t.o2 = 100;
  return t;
}
export function grantAll(g = game.data) {
  const t = ensureG7(g);
  for (const k of SKILL_ORDER) t.skills[k] = t.skills[k] || 1;
  t.gear.suit = t.gear.suit || 1; t.o2 = 100;
  g.unlocks = g.unlocks || {}; g.unlocks.suit = g.unlocks.suit || 1;
  for (const k of ['dash', 'glide', 'vine', 'lift', 'climb', 'doubleJump']) t.abilities[k] = t.abilities[k] || 1;
}

export const practiced = (id) => ensureG7().practice[id] || 0;
export const learned = (id) => !!ensureG7().skills[id];
export const hasGear = (id) => !!(ensureG7().gear[id] || game.unlocked(id));
export const hasSuit = () => hasGear('suit');
// clothes are made, not given: the base layer is everyone's; garments and accessories are crafted
export const ownsWear = (o) => o === 'base' || (o === 'suit' ? hasSuit() : hasGear('wear_' + o));
export const ownsAcc = (a) => hasGear('acc_' + a);
// a look may only show what she owns (older saves fall back to the base layer)
export function wardrobeFix() {
  const d = appearance.get(); const patch = {};
  if (!ownsWear(d.outfit)) patch.outfit = 'base';
  const acc = { ...d.acc }; let accChanged = false;
  for (const a of Object.keys(acc)) if (acc[a] && !ownsAcc(a)) { acc[a] = false; accChanged = true; }
  if (accChanged) patch.acc = acc;
  if (Object.keys(patch).length) appearance.set(patch);
  return appearance.get();
}
export const wearingSuit = () => appearance.get().outfit === 'suit' && hasSuit();
export function wearSuit(on = true) {
  if (on && !hasSuit()) return false;
  const back = () => ['expl', 'robe'].find((o) => ownsWear(o)) || 'base';
  appearance.set({ outfit: on ? 'suit' : (appearance.get().outfit === 'suit' ? back() : appearance.get().outfit) });
  return true;
}

export function practice(id, n = 1) {
  if (!SKILLS[id] || n <= 0) return false;
  const t = ensureG7();
  if (UNLOCK_ALL) return false;
  t.practice[id] = (t.practice[id] || 0) + n;
  if (t.skills[id]) { game.save(); return false; }
  if (t.practice[id] < SKILLS[id].need) { game.save(); return false; }
  t.skills[id] = Date.now(); game.save();
  toast(`You have learned ${SKILLS[id].name.toLowerCase()}.`, 4800);
  return true;
}

export function practiceGather(id, n = 1) {
  if (!n) return;
  const hit = GATHER_IDS.has(id) || GATHER_PRE.some((p) => id.startsWith(p));
  if (hit) practice('gathering', 1);
  if (id === 'fibre') practice('textiles', n);
}

// spend crystal / fuel / sand from whichever pile you actually have
export function resolveCost(cost) {
  const out = {};
  for (const [k, n] of Object.entries(cost || {})) {
    const alts = COST_ALIAS[k];
    if (!alts) { out[k] = (out[k] || 0) + n; continue; }
    let left = n;
    for (const id of alts) {
      const take = Math.min(left, game.count(id));
      if (take) { out[id] = (out[id] || 0) + take; left -= take; }
      if (!left) break;
    }
    if (left) out[alts[0]] = (out[alts[0]] || 0) + left;
  }
  return out;
}


const movers = new Set();
let fuelToastAt = 0;
export function spendFuel(n = 1) {
  if (UNLOCK_ALL) return true;
  const cost = resolveCost({ fuel: n });
  if (game.pay(cost)) return true;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - fuelToastAt > 2500) { fuelToastAt = now; toast('The jet boots are out of fuel: wood, driftwood or a pine cone.', 2800); }
  return false;
}
export function applyMoveAbilities(player) {
  if (player && player.abilities) movers.add(player);
  const t = ensureG7();
  for (const p of [...movers]) {
    if (!p || !p.abilities) { movers.delete(p); continue; }
    p.abilities.glide = false; // retired: a cloak can't glide; a real glider wing (needs air) may come later
    p.abilities.dash = false;  // retired: no physical basis
    p.abilities.climb = !!t.abilities.climb;
    p.abilities.doubleJump = !!t.abilities.doubleJump;
    p.abilities.spendJumpFuel = () => spendFuel(1);
  }
}
export function recipeBlocked(r) {
  const t = ensureG7();
  if (r.unique && r.give?.item && game.count(r.give.item[0])) return 'already made';
  if (r.needs?.react && !worldRules.can(r.needs.react)) return 'not possible on this world (' + r.needs.react + ')';
  if (r.needs?.worlds) {
    const n = Object.keys((game.data.journal && game.data.journal.planets) || {}).length;
    if (n < r.needs.worlds) return 'visit ' + r.needs.worlds + ' world' + (r.needs.worlds > 1 ? 's' : '') + ' first';
  }
  if (r.needs?.tool && (t.tools[r.needs.tool[0]] || 0) < r.needs.tool[1]) return 'needs a ' + (r.needs.tool[0] === 'pick' ? 'metal pick' : r.needs.tool[0]);
  if (r.needs?.skills) {
    const miss = r.needs.skills.filter((k) => !learned(k));
    if (miss.length) return 'learn ' + miss.map((k) => SKILLS[k].name.toLowerCase()).join(' and ') + ' first';
  }
  return null;
}
export function owned(r) {
  const t = ensureG7();
  if (r.give?.tool) return (t.tools[r.give.tool[0]] || 0) >= r.give.tool[1];
  if (r.give?.ability) return !!t.abilities[r.give.ability];
  if (r.give?.gear) return hasGear(r.give.gear);
  return false;
}

// Online, a recipe made at a station is asked of the server first (server/src/storage.js: are you within
// STATION_R of a real one?); window.__zenStorage is js/storage.js when the shared server has storage.
const storageNet = () => { try { const z = typeof window !== 'undefined' && window.__zenStorage; return z && z.online ? z : null; } catch (e) { return null; } };
export const STATION_LABEL = { bench: 'workbench', forge: 'smelter', fire: 'campfire' };
export function tryCraft(r, opts = {}) {
  const { stationNear, stationMsg, hud, onProp } = opts;
  if (!r || owned(r) || recipeBlocked(r)) return false;
  const cost = resolveCost(r.cost);
  if (r.station && !opts.confirmed) {
    const net = storageNet();
    if (net) { // the server says yes (and Ula hears of it), then it is made here from the bag
      if (!game.has(cost)) { hud && hud.toast('Not enough yet'); return false; }
      net.ask(r, (ok, why) => {
        if (!ok) { hud && hud.toast(why || `Make this at ${'a ' + STATION_LABEL[r.station]}`); return; }
        if (tryCraft(r, { ...opts, confirmed: true }) && opts.after) opts.after(r);
        if (opts.rerender) opts.rerender();
      });
      return false;
    }
    if (!stationNear || !stationNear(r.station)) { hud && hud.toast(stationMsg || `Make this at a ${STATION_LABEL[r.station] || 'workbench'}`); return false; }
  }
  if (!game.pay(cost)) { hud && hud.toast('Not enough yet'); return false; }
  const t = ensureG7();
  if (r.give.tool) t.tools[r.give.tool[0]] = r.give.tool[1];
  if (r.give.ability) { t.abilities[r.give.ability] = Date.now(); applyMoveAbilities(); }
  if (r.give.item) game.add(r.give.item[0], r.give.item[1]);
  if (r.give.gear) { t.gear[r.give.gear] = Date.now(); game.unlock(r.give.gear); }
  if (r.give.prop && onProp) onProp(r.give.prop);
  if (r.id === 'ingot') practice('metalwork', 1);
  if (r.id === 'cloth') practice('textiles', 4);
  if (r.id === 'seal') practice('sealing', 1);
  if (r.id === 'tank' || r.id === 'glass') { if (r.id === 'tank') practice('life', 1); }
  if (r.give.gear === 'suit') {
    wearSuit(true);
    hud && hud.toast('A space suit, made by your own hands. The moon is waiting.', 'star', 5600);
  } else if (r.give.gear === 'satchel') hud && hud.toast('A leather shoulder bag: room for 3 more things in your hands.', 'bag', 5200);
  else if (r.give.gear && /^wear_/.test(r.give.gear)) {
    appearance.set({ outfit: r.give.gear.slice(5) }); // put it straight on
    hud && hud.toast(`${r.name}, sewn by hand. Change what you wear in the character studio.`, null, 5200);
  } else if (r.give.gear && /^acc_/.test(r.give.gear)) hud && hud.toast(`${r.name} made. Wear it from the character studio (Extras).`, null, 4800);
  else if (r.give.ability) hud && hud.toast(`${ABILITIES[r.give.ability]}: ${r.desc}`, null, 5200);
  else if (r.give.tool) hud && hud.toast(`${r.name}: ${r.desc}`, null, 4200);
  else if (r.give.item && /^fx:/.test(r.give.item[0])) hud && hud.toast(`${r.name} made. Set it down from your bag (Bag, then Set down).`, 'build', 5200);
  else if (!r.give.gear) hud && hud.toast(`Made ${r.name.toLowerCase()}`, 'leaf', 2800);
  game.save();
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('zen-made', { detail: { id: r.id, confirmed: !!opts.confirmed } })); // compete.js tells the server (Ula's walk) for hand recipes
  return true;
}

// The craft menus. only: 'hand' (the bag: what your hands can make anywhere, and a list of what is made where),
// or a station id (the menu of a real workbench / forge / fire you walked up to: only its recipes).
// stationNear(kind) says whether that station is within reach (offline; online the server decides).
export function craftTab({ only = 'hand', stationNear, stationHere, stationAway, stationMsg, hud, onProp, after, id = 'craft', label } = {}) {
  const atStation = only !== 'hand';
  return { id, label: label || (atStation ? ({ bench: 'Workbench', forge: 'Smelter', fire: 'Campfire' }[only] || 'Craft') : 'Craft'), icon: atStation && only === 'fire' ? 'star' : 'leaf', render: (b, rerender) => {
    const costFn = (c) => (hud && hud.cost ? hud.cost(resolveCost(c)) : Object.entries(resolveCost(c)).map(([k, n]) => `${n} ${k}`).join(', '));
    const list = RECIPES.filter((r) => (atStation ? r.station === only : !r.station));
    const row = (r) => {
      const no = recipeBlocked(r), have = owned(r);
      return `<div class="row" style="opacity:${no ? 0.5 : 1}"><div class="grow"><div><b style="font-weight:600">${r.name}</b></div><div class="muted" style="font-size:13px;margin:3px 0">${r.desc}</div><div>${costFn(r.cost)}</div></div>${have ? '<span class="muted">owned</span>' : no ? `<span class="muted" style="font-size:12px">${no}</span>` : `<button class="b" data-r="${r.id}">Make</button>`}</div>`;
    };
    const intro = atStation
      ? (stationHere || { bench: 'At the workbench: tools, spears and rods, crates, clothes and building kits.', forge: 'At the smelter: ore into metal, glass, metal tools, lockers and safes.', fire: 'At the campfire: cook fish and meat, smoke food, render oil.' }[only])
      : (stationAway || 'Made in your hands, anywhere. Everything else is made at a real workbench, smelter or campfire: walk up to one and press E.');
    let elsewhere = '';
    if (!atStation) {
      const by = {}; for (const r of RECIPES) if (r.station && !owned(r)) (by[r.station] = by[r.station] || []).push(r.name);
      elsewhere = Object.entries(by).map(([k, n]) => `<p class="muted" style="font-size:13px;margin:6px 0"><b style="font-weight:600">At a ${STATION_LABEL[k]}:</b> ${n.join(', ')}</p>`).join('');
      if (elsewhere) elsewhere = '<h3>Made elsewhere</h3>' + elsewhere;
    }
    b.innerHTML = `<p class="muted" style="margin:6px 0 12px">${intro}</p>` + list.map(row).join('') + elsewhere + footer();
    b.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = RECIPES.find((x) => x.id === el.dataset.r);
      const near = atStation ? () => true : stationNear;
      if (tryCraft(r, { stationNear: near, stationMsg, hud, onProp, after, rerender })) { after && after(r); rerender(); }
    }));
  } };
}
// a station's own menu (walk up, press E): one tab per kind of station there
export function openStation(hud, kinds, opts = {}) {
  if (!hud || !hud.openPanel) return;
  hud.openPanel(kinds.map((k) => craftTab({ ...opts, only: k, hud, id: 'st-' + k })), 'st-' + kinds[0]);
}
function footer() {
  const t = ensureG7();
  const tools = Object.entries(t.tools).map(([k, v]) => (v ? k + (v > 1 ? '+' : '') : '')).filter(Boolean).join(', ') || 'bare hands';
  const abs = Object.keys(t.abilities).map((k) => ABILITIES[k]).join(', ') || 'none yet';
  const sk = SKILL_ORDER.filter((k) => learned(k)).map((k) => SKILLS[k].name).join(', ') || 'none yet';
  return `<p class="muted" style="font-size:13px;margin-top:12px">Tools: ${tools} · Abilities: ${abs} · Skills: ${sk}${hasSuit() ? ' · Space suit' : ''}</p>`;
}

export function skillHtml() {
  const hint = nextSuitHint();
  const rows = SKILL_ORDER.map((id) => {
    const S = SKILLS[id], got = learned(id), have = Math.min(practiced(id), S.need);
    const bar = got ? 'learned' : `${have}/${S.need}`;
    return `<div class="row ${got ? 'done' : ''}"><div class="grow"><div><b style="font-weight:600">${S.name}</b> <span style="font-size:13px;opacity:.78;font-variant-numeric:tabular-nums">· ${bar}</span></div><div class="muted" style="font-size:13px;margin:3px 0">${got ? S.desc : S.via}</div>${got ? '' : `<div style="height:3px;border-radius:2px;background:rgba(239,230,210,.1);margin-top:5px" role="progressbar" aria-label="${S.name}" aria-valuenow="${have}" aria-valuemax="${S.need}"><div style="height:100%;width:${Math.round(100 * have / S.need)}%;border-radius:2px;background:rgba(169,196,154,.8)"></div></div>`}</div>${got ? '<span class="done">✓</span>' : ''}</div>`;
  }).join('');
  const wear = hasSuit()
    ? `<p style="margin:12px 0 4px"><button class="b" data-wear="${wearingSuit() ? 'off' : 'on'}">${wearingSuit() ? 'Take off the space suit' : 'Put on the space suit'}</button></p>`
    : '';
  return `<p class="muted" style="margin:6px 0 12px">Skills are learned by doing the work, not given. The suit comes after.</p>${rows}${wear}${hint ? `<p class="next" style="margin-top:14px">${esc(hint.text)}</p>` : ''}`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function bagTab() {
  return { id: 'skills', label: 'Skills', icon: 'star', render: (b, re) => {
    b.innerHTML = `<h3>Skills</h3>` + skillHtml();
    const btn = b.querySelector('[data-wear]');
    if (btn) btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); wearSuit(btn.dataset.wear === 'on'); re(); });
  } };
}

// one calm line for the bag / pause hint, used while the suit is still unearned
export function nextSuitHint() {
  if (hasSuit()) return null;
  const t = ensureG7();
  const missing = (cost) => {
    const out = [], resolved = resolveCost(cost);
    for (const [id, n] of Object.entries(resolved)) if (game.count(id) < n) out.push(`${n - game.count(id)} more ${itemInfo(id).name.toLowerCase()}`);
    return out;
  };
  const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  if (!learned('gathering')) return { key: 'sk:gather', text: 'Gather from the flats, the pines and the pond shore. The work itself is the lesson.' };
  if (!learned('textiles')) {
    if (game.count('fibre') < 4) return { key: 'sk:fibre', text: 'Flower stems make plant fibre. Fibre becomes cloth, once you have a handful.' };
    return { key: 'sk:cloth', text: 'Weave cloth from the fibre in your bag. That is how textiles is learned.' };
  }
  if (!learned('metalwork')) {
    if (game.count('mat:ore') < 2) return { key: 'sk:ore', text: 'Rusty ore lies in the rocks beyond the garden. Smelt it at the workshop bench.' };
    return { key: 'sk:smelt', text: 'Two lumps of ore and a little fuel make a metal bar at the bench.' };
  }
  if (!learned('sealing')) return { key: 'sk:seal', text: 'Pine pitch and fibre make a seal. A cabin, or a suit, is only as tight as its stitches.' };
  if (!learned('life')) return { key: 'sk:tank', text: 'An oxygen tank is metal, glass and a crystal regulator, made at the bench.' };
  const suit = RECIPES.find((r) => r.id === 'suit');
  const m = missing(suit.cost);
  if (m.length) return { key: 'sk:mats:' + m.length, text: `The space suit still wants ${list(m.slice(0, 2))}.` };
  return { key: 'sk:make', text: 'There is enough at the workshop to make a space suit.' };
}

ensureG7();
if (UNLOCK_ALL) grantAll();
game.on((e) => { if (e.type === 'add') practiceGather(e.id, e.n); });
if (new URLSearchParams(location.search).has('debug')) window.__skills = { practice, learned, hasSuit, wearingSuit, wearSuit, grantAll, ensureG7, applyMoveAbilities, spendFuel, SKILLS };
