// Points of interest around the world spawn (js/places.js): the models, the "you found a place" moment,
// map and minimap seals once discovered (never before), and the digs that hold something.
// Discovery is physical: you walk inside a place, or stand on top of the lookout hill and see them all.
// Online in the shared world the server owns it (server/src/places.js): it says which places you have
// found, counts every swing at a shared dig and hands out the loot; the relic drops as a real object.
// Offline (or an old server) it runs here, saved in game.data.places = { seen: {id: ts}, dug: {id: n}, looted: {id: ts} }.
import * as THREE from 'three';
import { PLACES, lookoutHeight, digSpot, NODES, nodeNow } from '../places.js';
import { solid, passable, bakeSolids } from '../solids-bake.js';

export function createPlaces({ scene, pc, interact, hud, game, ground }) {
  const D = () => (game.data.places = game.data.places || { seen: {}, dug: {}, looted: {} });
  const P = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const stone = new THREE.MeshStandardMaterial({ color: '#8f8b80', roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: '#4c4f52', roughness: 0.6, metalness: 0.55 });
  const rust = new THREE.MeshStandardMaterial({ color: '#7a4a32', roughness: 0.8, metalness: 0.3 });
  const grass = new THREE.MeshStandardMaterial({ color: '#6f8a4e', roughness: 1 });
  const root = new THREE.Group(); root.name = 'places'; scene.add(root);
  const gy = (x, z) => (ground ? ground(x, z) : lookoutHeight(x, z));

  // ruins: broken wall stubs of a small house, a fallen column, a rubble heap (the dig)
  {
    const R = P.ruins, g = new THREE.Group(); g.position.set(R.x, gy(R.x, R.z), R.z); g.rotation.y = 0.35;
    const walls = [[-3, 0, 6, 0.5, 1.6], [3, -0.6, 0.5, 4.8, 1.1], [-0.5, -3, 4, 0.5, 0.7], [-3.2, -2.4, 0.5, 1.6, 2.1]];
    for (const [x, z, w, d, h] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 3, 10), stone); col.rotation.z = Math.PI / 2; col.rotation.y = 0.8; col.position.set(1, 0.3, 1.8); g.add(col);
    const heap = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), stone); heap.scale.set(1.3, 0.45, 1); heap.position.set(0, 0.2, -0.8); heap.userData.dig = true; g.add(heap);
    solid(g, { name: 'ruin' }); root.add(g); R.heap = heap;
  }
  // lookout hill (Xenia's own terrain, 120 m): a cairn on top
  {
    const L = P.lookout; void grass;
    const cairn = new THREE.Group(); cairn.position.set(L.x + 0.9, gy(L.x + 0.9, L.z) - 0.05, L.z);
    [0.45, 0.36, 0.28, 0.2].forEach((r, i) => { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), stone); s.scale.y = 0.6; s.position.y = 0.15 + i * 0.32; s.castShadow = true; cairn.add(s); });
    solid(cairn, { name: 'cairn', whole: true, base: cairn.position.y + 0.05 }); root.add(cairn);
  }
  // crashed ship: a scorched, tilted hull half-buried in a furrow it ploughed
  {
    const W = P.wreck, g = new THREE.Group(); g.position.set(W.x, gy(W.x, W.z), W.z); g.rotation.y = -0.5;
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 4.2, 6, 14), dark); hull.rotation.z = Math.PI / 2 - 0.12; hull.rotation.x = 0.25; hull.position.y = 0.6; hull.castShadow = true; g.add(hull);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 1.6), rust); fin.position.set(-2.4, 1.4, 0.3); fin.rotation.x = 0.4; g.add(fin);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.9), rust); plate.position.set(1.8, 0.05, 1.6); plate.rotation.y = 0.7; g.add(plate);
    const furrow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 9), new THREE.MeshStandardMaterial({ color: '#5b4a39', roughness: 1 })); furrow.rotation.x = -Math.PI / 2; furrow.position.set(5.5, 0.015, 0); furrow.rotation.z = Math.PI / 2; passable(furrow, 'ploughed ground'); g.add(furrow);
    solid(g, { name: 'wreck' }); root.add(g);
  }

  // the server's word, once it has spoken in this world ({k:'pl'}); null = offline rules
  const NET = { on: false, seen: new Set(), digs: {}, nodes: {} };
  const net = () => window.__zenPlacesNet || null;
  const known = (id) => !!D().seen[id] || NET.seen.has(id);
  function announce(id) { hud.toast(`Discovered: ${P[id].name}. ${P[id].what}`, 'star', 6500); }
  function discover(id, how) {
    if (NET.on) return false; // online: the server decides (it saw where you walked)
    const d = D(); if (d.seen[id]) return false;
    d.seen[id] = Date.now(); game.save && game.save();
    if (how !== 'quiet') announce(id);
    return true;
  }
  // every place model is solid where its mesh is (js/solids-bake.js); re-baked when a heap is dug flat
  const rebake = () => bakeSolids(root, pc, { ground, tag: 'places' });
  const flat = (p, dug) => { if (p.id === 'ruins') { p.heap.scale.set(1.3, dug ? 0.2 : 0.45, 1); rebake(); } };
  const fmtGive = (g) => Object.entries(g).map(([k, n]) => `${n} ${k.replace('mat:', '')}`).join(', ');
  function onServer(m) {
    if (m.k === 'reset') { NET.on = false; NET.seen.clear(); NET.digs = {}; for (const p of PLACES) if (p.dig) flat(p, !!D().looted[p.id]); return; }
    if (m.k === 'pl') { NET.on = true; NET.seen = new Set(m.seen || []); NET.digs = m.digs || {}; NET.nodes = m.nodes || {}; for (const p of PLACES) if (p.dig) flat(p, !!(NET.digs[p.id] && NET.digs[p.id].left > 0)); return; }
    if (m.k === 'pfound') {
      const fresh = (m.ids || []).filter((id) => P[id] && !D().seen[id] && !NET.seen.has(id)); for (const id of m.ids || []) NET.seen.add(id);
      if (m.all) { const names = fresh.filter((id) => id !== 'lookout').map((id) => P[id].name); if (names.length) hud.toast(`From the top of the hill you can see ${names.join(', ')}. They're on your map now.`, 'star', 7000); }
      else for (const id of fresh) announce(id);
      return;
    }
    if (m.k === 'pdig') {
      const p = P[m.id]; if (!p) return; const was = NET.digs[m.id]; NET.digs[m.id] = { n: m.n, need: m.need, left: m.left };
      if (m.left > 0) flat(p, true);
      else if (!was || was.n !== m.n) hud.toast(p.id === 'wreck' ? `Prying at the plates… ${m.n}/${m.need}` : `Moving stones… ${m.n}/${m.need}`, 'star', 1600);
      return;
    }
    if (m.k === 'pnode') { NET.nodes[m.id] = m.n; return; }
    if (m.k === 'grant' && m.give) {
      for (const [k, n] of Object.entries(m.give)) if (Number.isFinite(n) && n > 0 && n <= 20) game.add(k, n);
      if (m.why === 'node') { hud.toast(`${m.text || ''} (+${fmtGive(m.give)})`, 'leaf', 2200); return; }
      hud.toast(`${m.text || 'You found something.'} (+${fmtGive(m.give)})`, 'star', 7500);
    }
  }
  window.__zenPlaces = { onServer };
  { const q = net(); if (q) { for (const m of q.q.splice(0)) onServer(m); } }
  // map + minimap seals (interact items list only enabled entries), and the E actions at each dig
  for (const p of PLACES) {
    interact.add({ id: 'place-' + p.id, at: () => ({ x: p.x, y: p.top || 0, z: p.z }), r: 0.01, priority: 0, enabled: () => known(p.id), actions: () => [] });
    if (!p.dig) continue;
    const at = digSpot(p);
    const open = () => (NET.on ? !(NET.digs[p.id] && NET.digs[p.id].left > 0) : !D().looted[p.id]);
    interact.add({ id: 'dig-' + p.id, at: () => ({ x: at.x, y: p.id === 'seacave' ? 0.1 : gy(at.x, at.z), z: at.z }), r: p.reach || 2.4, priority: 0.6, enabled: open,
      actions: () => [{ label: p.id === 'wreck' ? 'Salvage the hull' : 'Dig in the rubble', icon: 'star', run: () => {
        if (NET.on && net()) { net().send({ k: 'pdig', id: p.id }); return; } // the server counts it and hands out the loot
        const d = D(); discover(p.id); const need = Math.ceil(p.dig / 2); d.dug[p.id] = (d.dug[p.id] || 0) + 1; // alone and offline: half the swings
        if (d.dug[p.id] < need) { hud.toast(p.id === 'wreck' ? `Prying at the plates… (${d.dug[p.id]}/${need})` : `Moving stones… (${d.dug[p.id]}/${need})`, 'star', 1800); game.save && game.save(); return; }
        d.looted[p.id] = Date.now();
        for (const [k, n] of Object.entries(p.loot)) game.add(k, n);
        hud.toast(`${p.found.replace(/ A sealed propellant cell.*$|,? and a cracked hearthstone.*$/, '.').replace(/\.\.$/, '.')} (+${fmtGive(p.loot)})`, 'star', 7500);
        flat(p, true);
      } }] });
  }
  // gathering spots on the cove shore (driftwood, reeds): shared and counted by the server when online
  for (const nd of NODES) {
    const left = () => (NET.on ? (NET.nodes[nd.id] ?? nd.max) : nodeNow(nd, (D().nodes || {})[nd.id]).n);
    interact.add({ id: 'node-' + nd.id, at: () => ({ x: nd.x, y: ground ? ground(nd.x, nd.z) : 0, z: nd.z }), r: nd.reach, priority: 0.5, enabled: () => left() > 0,
      actions: () => [{ label: nd.verb, icon: 'leaf', run: () => {
        if (NET.on && net()) { net().send({ k: 'ntake', id: nd.id }); return; }
        const d = D(); d.nodes = d.nodes || {}; const c = nodeNow(nd, d.nodes[nd.id]); if (c.n <= 0) return;
        d.nodes[nd.id] = { n: c.n - 1, ts: c.ts };
        for (const [k, n] of Object.entries(nd.give)) game.add(k, n);
        hud.toast(`+${fmtGive(nd.give)}`, 'leaf', 1800); game.save && game.save();
      } }] });
  }
  rebake();
  if (D().looted.ruins) flat(P.ruins, true);
  let tick = 0;
  return {
    ground: (x, z) => lookoutHeight(x, z),
    // a fish caught at the cove: online it is the server's (shared stock, a real fish in your hands)
    onCatch() { if (NET.on && net()) { net().send({ k: 'catch' }); return true; } return false; },
    known, discover, list: () => PLACES.map((p) => ({ ...p, known: known(p.id) })),
    // walking: inside a place discovers it; on top of the lookout you can see them all
    update(dt, pos, extra) {
      if ((tick += dt) < 0.5 || !pos) return; tick = 0;
      const inY = (p) => (p.ymin == null || pos.y >= p.ymin) && (p.ymax == null || pos.y <= p.ymax);
      for (const p of PLACES) if (!known(p.id) && Math.hypot(pos.x - p.x, pos.z - p.z) < p.r && inY(p)) discover(p.id);
      const L = P.lookout;
      if (Math.hypot(pos.x - L.x, pos.z - L.z) < 3.2 && pos.y > L.top - 0.8) {
        const fresh = PLACES.filter((p) => p.id !== 'lookout' && !p.hidden && discover(p.id, 'quiet')).map((p) => p.name);
        if (fresh.length) hud.toast(`From the top of the hill you can see ${fresh.join(', ')}. They're on your map now.`, 'star', 7000);
      }
      if (extra) extra();
    },
  };
}
