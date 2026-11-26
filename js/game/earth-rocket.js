// Phase 2 on Earth: the workshop shed, gathering outside the garden (salt crystals on the flats,
// pine cones under the pines beyond the wall), the rocket growing on its pad, and the launch.
import * as THREE from 'three';
import { game, dayKey, itemInfo, UNLOCK_ALL } from './store.js';
import { buildRocket, buildStage, ROCKET_PARTS } from './rocket.js';
import { designFrom, readout, createFlight, worldRules, ENGINES, LOAD_KG, capacity } from './rocket-sim.js';
import { mulberry32, mergeGeometries } from '../util.js';
import { icon } from './icons.js';
import { consolidate } from './character.js';
import { practice, craftTab, openStation, hasSuit, wearingSuit, wearSuit, learned } from './skills.js';

export const SHED = { x: 20.2, z: 2.6, ry: -Math.PI / 2 }; // open side faces the garden (-x)
export const PAD = { x: 34, z: 1.0 };

function boardsTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const l = 46 + Math.random() * 10; g.fillStyle = `hsl(28, 24%, ${l}%)`; g.fillRect(i * 32, 0, 32, 256);
    g.fillStyle = 'rgba(40,25,15,0.55)'; g.fillRect(i * 32, 0, 2, 256);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(60,40,25,${Math.random() * 0.12})`; g.fillRect(i * 32 + Math.random() * 30, Math.random() * 256, 1, 10 + Math.random() * 40); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function createEarthRocket(EG, E) {
  const { scene, P, params, audio, nature, POND } = E;
  const { player, interact, hud, colliders: pc, wait } = EG;
  const G = game.data;
  const lite = P.cls !== 'pc';

  // ---- the workshop shed
  const shed = new THREE.Group(); shed.position.set(SHED.x, 0, SHED.z); shed.rotation.y = SHED.ry; scene.add(shed);
  const boards = boardsTexture();
  const wallM = new THREE.MeshStandardMaterial({ map: boards, roughness: 0.9, color: '#c9b49a' });
  const trimM = new THREE.MeshStandardMaterial({ color: '#4f5b57', roughness: 0.7 });
  const roofM = new THREE.MeshStandardMaterial({ color: '#5f6e6a', roughness: 0.6, metalness: 0.2 });
  const benchM = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.75 });
  const W = 3.6, D = 2.6, H = 2.5;
  {
    const box = (w, h, d, x, y, z, m, uvx = 1, uvy = 1) => { const g = new THREE.BoxGeometry(w, h, d); if (m === wallM) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvx, uv.getY(i) * uvy); } const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; shed.add(o); return o; };
    box(W + 0.2, 0.14, D + 0.2, 0, 0.07, 0, benchM); // floor deck
    box(W, H, 0.1, 0, H / 2, -D / 2, wallM, 3.5, 2.4); // back wall
    box(0.1, H, D, -W / 2, H / 2, 0, wallM, 2.4, 2.4); box(0.1, H, D, W / 2, H / 2, 0, wallM, 2.4, 2.4);
    for (const sx of [-1, 1]) box(0.14, H + 0.1, 0.14, sx * (W / 2), (H + 0.1) / 2, D / 2, trimM);
    box(W + 0.14, 0.16, 0.14, 0, H + 0.02, D / 2, trimM);
    const roof = box(W + 0.7, 0.08, D + 0.9, 0, H + 0.32, 0.15, roofM); roof.rotation.x = 0.2;
    // workbench along the back wall, a pegboard of tools, jars, a blueprint
    box(2.6, 0.07, 0.7, 0, 0.92, -D / 2 + 0.42, benchM);
    for (const sx of [-1, 1]) for (const sz of [0, 1]) box(0.07, 0.88, 0.07, sx * 1.22, 0.47, -D / 2 + 0.12 + sz * 0.6, trimM);
    box(2.4, 0.04, 0.6, 0, 0.3, -D / 2 + 0.42, benchM);
    box(1.8, 0.9, 0.03, 0, 1.75, -D / 2 + 0.07, new THREE.MeshStandardMaterial({ color: '#b9a78a', roughness: 0.9 }));
    const bp = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7fa7c9', roughness: 0.8, emissive: '#2a4a6a', emissiveIntensity: 0.15 }));
    bp.position.set(-0.3, 0.96, -D / 2 + 0.45); bp.rotation.y = 0.08; shed.add(bp);
    const jarM = new THREE.MeshStandardMaterial({ color: '#cfe3df', roughness: 0.15, transparent: true, opacity: 0.55 });
    for (let i = 0; i < 4; i++) { const j = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), jarM); j.position.set(0.55 + i * 0.16, 1.04, -D / 2 + 0.3); shed.add(j); }
    for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3 + (i % 3) * 0.08, 0.02), trimM); t.position.set(-0.6 + i * 0.3, 1.75, -D / 2 + 0.1); shed.add(t); }
    // a little lantern that glows at dusk
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: '#ffe2b0', emissive: '#ffb45a', emissiveIntensity: 1.2 }));
    lamp.position.set(0, H - 0.35, 0.1); shed.add(lamp);
    const pl = new THREE.PointLight('#ffc37a', 0, 7, 1.8); pl.position.copy(lamp.position); shed.add(pl);
    shed.userData.lamp = { lamp, pl };
  }
  shed.updateMatrixWorld(true);
  const shedLocal = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(shed.matrixWorld);
  {
    const back = shedLocal(0, -D / 2), l = shedLocal(-W / 2, 0), r = shedLocal(W / 2, 0);
    pc.box(back.x, back.z, W / 2, 0.12, { ry: SHED.ry, h: H, name: 'shed' });
    pc.box(l.x, l.z, 0.1, D / 2, { ry: SHED.ry, h: H, name: 'shed' });
    pc.box(r.x, r.z, 0.1, D / 2, { ry: SHED.ry, h: H, name: 'shed' });
    const bench = shedLocal(0, -D / 2 + 0.42); pc.box(bench.x, bench.z, 1.3, 0.36, { ry: SHED.ry, h: 0.95, name: 'bench' });
  }
  const benchAt = shedLocal(0, -D / 2 + 0.95);

  consolidate(shed);
  // ---- launch pad, gantry, and the rocket
  const pad = new THREE.Group(); pad.position.set(PAD.x, 0, PAD.z); scene.add(pad);
  {
    const conc = new THREE.MeshStandardMaterial({ color: '#b7b1a6', roughness: 0.95 });
    const d = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.18, lite ? 32 : 56), conc); d.position.y = 0.09; d.receiveShadow = true; pad.add(d);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.05, 6, lite ? 40 : 72).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0b24a', roughness: 0.6 })); ring.position.y = 0.19; pad.add(ring);
    const grate = new THREE.Mesh(new THREE.CircleGeometry(1.3, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a3a3c', roughness: 0.8, metalness: 0.4 })); grate.position.y = 0.185; pad.add(grate);
    // gantry: a lattice tower with an access arm
    const red = new THREE.MeshStandardMaterial({ color: '#7d3a2c', roughness: 0.75, metalness: 0.35 }); // weathered red-oxide steel
    const geo = []; const TX = 3.6, TH = 14, S = 1.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) geo.push(new THREE.BoxGeometry(0.12, TH, 0.12).translate(TX + sx * S / 2, TH / 2, sz * S / 2));
    for (let y = 1.2; y < TH; y += 1.4) {
      for (const sz of [-1, 1]) geo.push(new THREE.BoxGeometry(S, 0.07, 0.07).translate(TX, y, sz * S / 2));
      for (const sx of [-1, 1]) geo.push(new THREE.BoxGeometry(0.07, 0.07, S).translate(TX + sx * S / 2, y, 0));
      const br = new THREE.BoxGeometry(0.05, 1.8, 0.05).rotateZ(((y / 1.4) % 2 ? 1 : -1) * 0.66); br.translate(TX, y + 0.7, S / 2); geo.push(br);
      const br2 = br.clone().translate(0, 0, -S); geo.push(br2);
    }
    geo.push(new THREE.BoxGeometry(2.2, 0.12, 0.6).translate(TX - 1.6, 8.6, 0)); // access arm at the capsule hatch
    geo.push(new THREE.BoxGeometry(0.05, 1.0, 0.05).translate(TX - 2.6, 9.1, 0.28), new THREE.BoxGeometry(0.05, 1.0, 0.05).translate(TX - 2.6, 9.1, -0.28));
    const tower = new THREE.Mesh(mergeGeometries(geo), red); tower.castShadow = true; pad.add(tower);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff6a4a', emissive: '#ff3a2a', emissiveIntensity: 1.5 })); beacon.position.set(TX, TH + 0.2, 0); pad.add(beacon);
    pad.userData.beacon = beacon;
  }
  consolidate(pad);
  pc.circle(PAD.x + 3.6, PAD.z, 0.85, { h: 14, name: 'gantry' });
  const R = buildRocket({ lite });
  R.group.position.set(PAD.x, 0.18, PAD.z); R.group.rotation.y = -0.5; scene.add(R.group);
  const nearPad = () => Math.hypot(player.position.x - PAD.x, player.position.z - PAD.z) < 7;
  const nearBench = () => Math.hypot(player.position.x - benchAt.x, player.position.z - benchAt.z) < 2.2;
  const builtSet = () => new Set(G.rocket.parts);
  function syncRocket() { const b = builtSet(); for (const p of ROCKET_PARTS) R.parts[p.id].visible = b.has(p.id); R.flame.visible = b.size > 0; }
  syncRocket();
  const rocketDone = () => ROCKET_PARTS.every((p) => G.rocket.parts.includes(p.id));
  const nextPart = () => ROCKET_PARTS.find((p) => !G.rocket.parts.includes(p.id));
  pc.circle(PAD.x, PAD.z, 1.3, { h: 13, name: 'rocket' });

  // ---- the design: booster stages under the classic rocket (rocket-sim.js). What it is made of is
  // what it flies like: every part costs materials, propellant is loaded from what you make, nothing is given.
  const RS = () => { const r = G.rocket; if (!r.stages) r.stages = []; if (r.fuel == null) r.fuel = 0; if (!r.engine) r.engine = 'copper'; return r; };
  const COST = {
    tank: { 'mat:metal': 2 }, fin: { 'mat:metal': 1 }, decoupler: { 'mat:metal': 2 },
    engine: { pump: { 'mat:metal': 4, 'mat:crystal': 1 }, copper: { 'mat:metal': 3, 'find:any': 1 }, vac: { 'mat:metal': 4, 'mat:crystal': 2 } },
  };
  // taking a part off gives its materials back (a find comes back as a pebble)
  const refund = (cost, n = 1) => { for (const [id, k] of Object.entries(cost)) game.add(id === 'find:any' ? 'find:pebble' : id, k * n); };
  const mul = (cost, n) => Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, v * n]));
  // each engine mount is only as true as the hands that made it (metalwork tightens it)
  const mountErr = (n) => Array.from({ length: n }, () => (Math.random() * 2 - 1) * (learned('metalwork') ? 0.006 : 0.015));
  const rules = () => worldRules({ worldRules: (E.core && E.core.worldRules) || EG.worldRules || E.worldRules || (typeof window !== 'undefined' && window.zenWorld && window.zenWorld.rules) || null });
  const design = () => designFrom(RS());
  const boostRoot = new THREE.Group(); boostRoot.name = 'rocket-boosters'; scene.add(boostRoot);
  let boosters = []; // [{ group, height, flame, setFlame }] bottom first
  function syncBoosters() {
    for (const b of boosters) { boostRoot.remove(b.group); b.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    boosters = []; let y = 0;
    for (const st of RS().stages) { const b = buildStage(st, R.materials, { lite, engineLen: ENGINES[st.engine].len }); b.group.position.y = y; b.y = y; y += b.height; boostRoot.add(b.group); boosters.push(b); }
    boostRoot.userData.height = y;
    placeShip(0, 0, 0, 0, 0);
  }
  // the whole stack stands at (x, base y, z), tipped by `tilt` toward +x and `lean` toward +z
  const shipQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), up = new THREE.Vector3();
  function placeShip(dx, y, dz, tilt, lean) {
    tmpE.set(lean, -0.5, -tilt, 'XYZ'); shipQ.setFromEuler(tmpE);
    boostRoot.position.set(PAD.x + dx, 0.18 + y, PAD.z + dz); boostRoot.quaternion.copy(shipQ);
    const H = boostRoot.userData.height || 0;
    up.set(0, H, 0).applyQuaternion(shipQ);
    R.group.position.set(boostRoot.position.x + up.x, boostRoot.position.y + up.y, boostRoot.position.z + up.z); R.group.quaternion.copy(shipQ);
  }
  function readoutHtml() {
    const d = design(), r = readout(d, rules()), W = rules();
    const pct = Math.min(100, Math.round(r.dv / r.need * 100));
    const rows = d.stages.map((st, i) => {
      const o = r.stages[i], name = st.classic ? 'Rocket (upper stage)' : `Stage ${i + 1}`;
      return `<div class="row"><div class="grow"><div>${name}</div><div class="muted" style="font-size:13px">${st.engines ? `${st.engines} × ${ENGINES[st.engine].name.toLowerCase()}` : 'no engine'} · propellant ${st.fuel}/${st.loads} · burns ${Math.round(o.burn)} s</div></div><div style="text-align:right;font-size:14px">${Math.round(o.dv)} m/s<div class="muted" style="font-size:12px">TWR ${o.twr.toFixed(2)}</div></div></div>`;
    }).join('');
    const stab = r.margin > 0.5 ? 'stable (fins well behind the centre of mass)' : r.margin > 0 ? 'just stable, expect some wobble' : 'unstable: the engines have to hold her straight';
    const verdict = r.twr <= 1 ? `She is too heavy to leave the pad: thrust-to-weight ${r.twr.toFixed(2)} needs to be above 1 (1.3 or more is comfortable).`
      : r.dv < r.need ? `About ${Math.round(r.need)} m/s gets you into orbit around ${W.name}. This build has ${Math.round(r.dv)} m/s (${pct}%): she will come back down.`
      : `Enough on paper: ${Math.round(r.dv)} of about ${Math.round(r.need)} m/s to orbit. The air, the wind and how straight she flies decide the rest.`;
    return `<h3>Before launch</h3><div class="row"><div class="grow"><div>Thrust-to-weight on the pad</div><div class="muted" style="font-size:13px">${(r.mass / 1000).toFixed(1)} t on the pad, ${r.length.toFixed(1)} m tall</div></div><div style="font-size:18px">${r.twr.toFixed(2)}</div></div>
      <div class="row"><div class="grow"><div>Delta-v</div><div style="height:6px;border-radius:3px;background:rgba(255,255,255,.15);margin-top:6px"><div style="height:6px;border-radius:3px;width:${pct}%;background:${pct >= 100 ? '#bfe8b0' : '#e8c48a'}"></div></div></div><div style="font-size:18px;margin-left:12px">${Math.round(r.dv)} <span class="muted" style="font-size:12px">/ ${Math.round(r.need)} m/s</span></div></div>
      <div class="row"><div class="grow"><div>Stability</div><div class="muted" style="font-size:13px">${stab} (${r.margin.toFixed(2)} calibres)</div></div></div>
      ${rows}<p class="muted" style="font-size:14px;line-height:1.5;margin:8px 0">${verdict}</p>`;
  }
  // fill every tank from the propellant you have made (one load each)
  function fuelUp() {
    const r = RS(); let n = 0;
    const fill = (have, cap) => { let f = have; while (f < cap && game.count('prop') > 0) { game.take('prop', 1); f++; n++; } return f; };
    for (const st of r.stages) st.fuel = fill(+st.fuel || 0, capacity({ tanks: st.tanks }));
    r.fuel = fill(r.fuel, capacity({ tanks: 0, hull: G.rocket.parts.includes('body') }));
    game.save();
    return n;
  }
  function edit(fn) { const r = RS(); const ok = fn(r); if (ok !== false) { game.save(); syncBoosters(); audio.place && audio.place(); } return ok !== false; }
  const drain = (st, cap) => { if ((st.fuel || 0) > cap) { game.add('prop', st.fuel - cap); st.fuel = cap; } };
  const OPS = {
    addStage: () => edit((r) => { if (!game.pay(COST.decoupler)) return false; r.stages.unshift({ tanks: 0, engines: 0, engine: 'pump', fins: 0, err: [], fuel: 0 }); }),
    delStage: (i) => edit((r) => { const st = r.stages[i]; if (!st) return false; refund(COST.decoupler); refund(COST.tank, st.tanks); refund(COST.engine[st.engine], st.engines); refund(COST.fin, st.fins); drain(st, 0); r.stages.splice(i, 1); }),
    tank: (i, d) => edit((r) => { const st = r.stages[i]; if (d > 0) { if (!game.pay(COST.tank)) return false; st.tanks++; } else { if (!st.tanks) return false; st.tanks--; refund(COST.tank); drain(st, st.tanks); } }),
    engine: (i, d) => edit((r) => { const st = r.stages[i]; if (d > 0) { if (st.engines >= 9 || !game.pay(COST.engine[st.engine])) return false; st.engines++; st.err = [...(st.err || []), ...mountErr(1)]; } else { if (!st.engines) return false; st.engines--; st.err = (st.err || []).slice(0, st.engines); refund(COST.engine[st.engine]); } }),
    type: (i, t) => edit((r) => { const st = i < 0 ? null : r.stages[i]; const cur = st ? st.engine : r.engine, n = st ? st.engines : 1; if (cur === t || !ENGINES[t]) return false; if (!game.pay(mul(COST.engine[t], n))) return false; refund(COST.engine[cur], n); if (st) { st.engine = t; st.err = mountErr(n); } else { r.engine = t; r.err = mountErr(1); } }),
    fins: (i, n) => edit((r) => { const st = r.stages[i]; if (st.fins === n) return false; if (n > st.fins && !game.pay(mul(COST.fin, n - st.fins))) return false; if (n < st.fins) refund(COST.fin, st.fins - n); st.fins = n; }),
  };
  function designHtml() {
    const r = RS(), here = nearBench() || nearPad(), dis = here ? '' : 'disabled';
    const btn = (op, label, extra = '') => `<button class="b" data-op="${op}" ${extra} ${dis} style="padding:4px 11px;margin:2px">${label}</button>`;
    const typeBtns = (i, cur) => Object.entries(ENGINES).map(([k, E]) => `<button class="b" data-op="type:${i}:${k}" ${dis} style="padding:4px 10px;margin:2px;${k === cur ? 'outline:2px solid #bfe8b0' : 'opacity:.7'}">${E.name.split(' ')[0]}</button>`).join('');
    const st = r.stages.map((s, i) => `<div class="row" style="display:block"><div><b style="font-weight:600">Stage ${i + 1}</b> <span class="muted" style="font-size:12px">${i === 0 ? '· lights first, on the pad' : ''}</span></div>
      <div style="margin-top:6px">Tanks ${s.tanks} ${btn(`tank:${i}:-1`, '−')}${btn(`tank:${i}:1`, '+')} <span class="muted" style="font-size:12px">${hud.cost(COST.tank)}</span></div>
      <div>Engines ${s.engines} ${btn(`engine:${i}:-1`, '−')}${btn(`engine:${i}:1`, '+')} ${typeBtns(i, s.engine)} <span class="muted" style="font-size:12px">${hud.cost(COST.engine[s.engine])}</span></div>
      <div>Fins ${[0, 3, 4].map((n) => `<button class="b" data-op="fins:${i}:${n}" ${dis} style="padding:4px 10px;margin:2px;${s.fins === n ? 'outline:2px solid #bfe8b0' : 'opacity:.7'}">${n}</button>`).join('')} <span class="muted" style="font-size:12px">${hud.cost(COST.fin)} each</span> ${btn(`delStage:${i}`, 'Take this stage off')}</div></div>`).join('');
    return `<h3>Stages</h3><p class="muted" style="margin:0 0 8px;font-size:14px">The rocket on its own can't reach orbit. Stack stages under it: tanks hold propellant, engines push, fins keep her pointing into the air. Stages fall away when they run dry and are not coming back.</p>
      <div class="row" style="display:block"><div><b style="font-weight:600">The rocket</b> <span class="muted" style="font-size:12px">· the upper stage, the part that comes home</span></div><div style="margin-top:6px">Engine ${typeBtns(-1, r.engine)} <span class="muted" style="font-size:12px">${ENGINES[r.engine].desc}</span></div></div>
      ${st}<p>${btn('addStage', 'Add a stage underneath')} <span class="muted" style="font-size:12px">${hud.cost(COST.decoupler)} (decoupler)</span></p>
      ${here ? '' : '<p class="muted" style="font-size:13px">Changes are made at the workshop bench or by the pad.</p>'}`;
  }
  syncBoosters();

  // a part "arrives": it settles down into place with a little sparkle
  let arriving = null;
  function build(part) {
    if (!game.pay(part.cost)) { hud.toast('Not quite enough yet', 'rocket'); return false; }
    G.rocket.parts.push(part.id); if (part.id === 'engine') G.rocket.err = mountErr(1); game.save(); syncRocket();
    arriving = { part: R.parts[part.id], t: 0 };
    audio.chime(); audio.place(); audio.setActivity && audio.setActivity('build', 5);
    hud.toast(rocketDone() ? 'The rocket is finished. Walk to the pad to board' : `The ${part.name.toLowerCase()} is on the rocket`, 'rocket', 3600);
    if (rocketDone()) game.unlock('rocket');
    if (part.id === 'capsule') { practice('sealing', 1); practice('life', 1); }
    return true;
  }
  function rocketTab() {
    return { id: 'rocket', label: 'Rocket', icon: 'rocket', render: (b, rerender) => {
      const built = builtSet(); const nx = nextPart();
      b.innerHTML = `<h3>The rocket</h3><p class="muted" style="margin:0 0 12px">Build it piece by piece at the workshop bench, from things you gather and grow.</p>` + ROCKET_PARTS.map((p) => {
        const done = built.has(p.id), isNext = nx && nx.id === p.id, can = isNext && game.has(p.cost);
        return `<div class="row" style="${!done && !isNext ? 'opacity:.45' : ''}"><span style="width:26px;height:26px;display:inline-flex;color:${done ? '#bfe8b0' : '#fff'}">${icon(done ? 'star' : 'rocket')}</span><div class="grow"><div>${p.name}${done ? ' <span class="done">· built</span>' : ''}</div><div class="muted" style="font-size:13px">${p.desc}</div>${done ? '' : `<div style="margin-top:6px">${hud.cost(p.cost)}</div>`}</div>${isNext ? `<button class="b" data-build="${p.id}" ${can && nearBench() ? '' : 'disabled'}>${nearBench() ? 'Build' : 'At the bench'}</button>` : ''}</div>`;
      }).join('') + `<h3>Where things are</h3><p class="muted" style="font-size:14px;line-height:1.5">Salt crystals sparkle out on the salt flats. Pine cones fall under the tall pines behind the garden wall. Rusty ore sits in the rocks beyond the garden. Sand and driftwood rest along the pond shore. Finds turn up in the sand and along the pond. Flowers come from the beds, and clippings from pruning the bonsai. A space suit is made here, once you have learned the work.</p>`;
      if (rocketDone()) {
        const cap = design().stages.reduce((a, st) => a + st.loads - st.fuel, 0);
        b.innerHTML = `<h3>The rocket</h3>` + designHtml()
          + `<h3>Propellant</h3><div class="row"><div class="grow"><div>${cap ? `${cap} load${cap > 1 ? 's' : ''} to fill` : 'Every tank is full'}</div><div class="muted" style="font-size:13px">One load is ${LOAD_KG / 1000} t of kerosene and liquid oxygen, made at the bench. You have ${game.count('prop')}.</div></div><button class="b" data-fuel ${cap && game.count('prop') && nearPad() ? '' : 'disabled'}>${nearPad() ? 'Fuel up' : 'At the pad'}</button></div>`
          + readoutHtml()
          + `<p><button class="b" data-launch ${nearPad() ? '' : 'disabled'}>${nearPad() ? 'Launch' : 'Launch from the pad'}</button></p>`;
        b.querySelectorAll('[data-op]').forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); const [op, a, c] = el.dataset.op.split(':'); const ok = OPS[op](a === undefined ? undefined : +a, c === undefined ? undefined : (isNaN(+c) ? c : +c)); if (!ok) hud.toast('Not quite enough yet', 'rocket'); rerender(); }));
        const f = b.querySelector('[data-fuel]'); if (f) f.addEventListener('pointerdown', (e) => { e.stopPropagation(); const n = fuelUp(); hud.toast(n ? `${n} load${n > 1 ? 's' : ''} of propellant in the tanks` : 'No propellant to load', 'rocket'); rerender(); });
        const l = b.querySelector('[data-launch]'); if (l) l.addEventListener('pointerdown', (e) => { e.stopPropagation(); hud.closePanel(); launch(); });
        return;
      }
      b.querySelectorAll('[data-build]').forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); const p = ROCKET_PARTS.find((q) => q.id === el.dataset.build); if (build(p)) rerender(); }));
    } };
  }
  EG.extraTabs.push(rocketTab());
  EG.extraTabs.push(craftTab({ stationNear: nearBench, hud })); // the bag: hand recipes (and what is made where)
  // the shed's bench has its own menu (walk up, E). Offline its bench, hearth and fire pit make everything; online
  // the shared server keeps a forge beside the shed and a bench and fire at the cove (server/src/storage.js)
  const online = () => { try { return !!(window.__zenStorage && window.__zenStorage.online); } catch (e) { return false; } };
  const benchMenu = () => openStation(hud, online() ? ['bench'] : ['bench', 'forge', 'fire'], { stationNear: nearBench, stationHere: online() ? null : 'The shed has a bench, a small hearth and a fire pit.' });
  interact.add({ id: 'bench', at: () => benchAt, r: 1.6, priority: 0.3, actions: () => {
    const acts = [];
    acts.push({ label: 'Work on the rocket', icon: 'build', run: async () => EG.openBag('rocket') });
    acts.push({ label: 'Work at the bench', icon: 'leaf', run: async () => benchMenu() });
    return acts;
  } });
  interact.add({
    id: 'pad', at: () => ({ x: PAD.x - 2.2, z: PAD.z }), r: 2.6,
    actions: () => {
      if (!rocketDone()) return [{ label: G.rocket.parts.length ? 'The rocket is coming along' : 'An empty launch pad', icon: 'rocket', run: async () => hud.toast(G.rocket.parts.length ? `${ROCKET_PARTS.length - G.rocket.parts.length} more part${ROCKET_PARTS.length - G.rocket.parts.length > 1 ? 's' : ''} to build at the workshop` : 'The workshop bench by the garden has the plans', 'rocket', 3200) }];
      const acts = [];
      if (hasSuit() && !wearingSuit()) acts.push({ label: 'Put on the space suit', icon: 'star', run: async () => { wearSuit(true); hud.toast('Sealed.', 'star', 2400); } });
      if (wearingSuit() && (game.data.g7 && game.data.g7.o2 < 95)) acts.push({ label: 'Refill the oxygen tank', icon: 'water', run: async () => { game.data.g7.o2 = 100; game.save(); hud.toast('The tank is full.', 'star', 2400); } });
      acts.push({ label: 'Check the rocket and launch', icon: 'rocket', run: async () => EG.openBag('rocket') });
      return acts;
    },
  });

  // ---- gathering: a fresh handful each day (salt on the flats, pine cones under the pines)
  const gatherGrp = new THREE.Group(); scene.add(gatherGrp);
  const saltM = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 0.08 });
  const coneM = new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.85 });
  const oreM = new THREE.MeshStandardMaterial({ color: '#6a3b28', roughness: 0.7, metalness: 0.25 });
  const sandM = new THREE.MeshStandardMaterial({ color: '#d8c194', roughness: 0.95 });
  const woodM = new THREE.MeshStandardMaterial({ color: '#a8916f', roughness: 0.85 });
  function saltGeo(rnd) {
    const g = [];
    for (let i = 0; i < 5; i++) { const s = 0.05 + rnd() * 0.06; const b = new THREE.BoxGeometry(s, s * (0.8 + rnd()), s); b.rotateY(rnd() * 3).rotateX((rnd() - 0.5) * 0.6).translate((rnd() - 0.5) * 0.14, s * 0.4, (rnd() - 0.5) * 0.14); g.push(b); }
    return mergeGeometries(g);
  }
  function coneGeo() {
    const g = [new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1.7, 1)];
    for (let i = 0; i < 18; i++) { const a = i * 2.4, y = -0.06 + (i / 18) * 0.12; g.push(new THREE.ConeGeometry(0.022, 0.03, 4).rotateZ(Math.PI / 2 + 0.6).translate(0.04, 0, 0).rotateY(a).translate(0, y, 0)); }
    return mergeGeometries(g).rotateZ(1.3).translate(0, 0.045, 0);
  }
  function oreGeo(rnd) {
    const g = [];
    for (let i = 0; i < 4; i++) { const s = 0.07 + rnd() * 0.08; const b = new THREE.BoxGeometry(s, s * (0.6 + rnd() * 0.6), s * (0.8 + rnd() * 0.4)); b.rotateY(rnd() * 3).rotateZ((rnd() - 0.5) * 0.5).translate((rnd() - 0.5) * 0.1, s * 0.3, (rnd() - 0.5) * 0.1); g.push(b); }
    return mergeGeometries(g);
  }
  function sandGeo() { return new THREE.SphereGeometry(0.11, 8, 5).scale(1.3, 0.35, 1.1).translate(0, 0.04, 0); }
  function woodGeo() { return new THREE.CylinderGeometry(0.035, 0.028, 0.42, 6).rotateZ(1.15).translate(0, 0.05, 0); }
  const META = {
    salt: { label: 'Gather the salt crystals', icon: 'salt', n: 2, spark: '#ffffff', mat: saltM },
    pinecone: { label: 'Pick up the pine cone', icon: 'pine', n: 1, spark: '#ffe7b0', mat: coneM },
    'mat:ore': { label: 'Gather the ore', icon: 'stone', n: 2, spark: '#d9a07a', mat: oreM },
    'mat:sand': { label: 'Scoop the shore sand', icon: 'salt', n: 2, spark: '#e8d6a8', mat: sandM },
    driftwood: { label: 'Pick up the driftwood', icon: 'leaf', n: 1, spark: '#c9b49a', mat: woodM },
  };
  const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillRect(31, 6, 2, 52); g.fillRect(6, 31, 52, 2); return new THREE.CanvasTexture(c); })();
  const dk = dayKey();
  const taken = new Set(G.gather[dk] || []);
  for (const k of Object.keys(G.gather)) if (k !== dk) delete G.gather[k];
  const items = [];
  const rnd = mulberry32([...dk].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0);
  const pines = (nature.trees || []).filter((t) => t.name === 'pine');
  const many = UNLOCK_ALL || params.has('gather');
  const nSalt = many ? 10 : 6, nCone = 4, nOre = many ? 5 : 3, nSand = 3, nWood = 2;
  for (let i = 0; i < nSalt; i++) {
    const a = rnd() * Math.PI * 2, r = 27 + rnd() * 22;
    items.push({ id: `salt${i}`, kind: 'salt', x: 1.5 + Math.cos(a) * r, z: -0.5 + Math.sin(a) * r * 0.9 });
  }
  for (let i = 0; i < nCone; i++) {
    const t = pines.length ? pines[i % pines.length] : { x: -9.5, z: -16 };
    const a = rnd() * Math.PI * 2, r = 1.2 + rnd() * 1.8;
    items.push({ id: `cone${i}`, kind: 'pinecone', x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r });
  }
  for (let i = 0; i < nOre; i++) {
    const a = -0.4 + rnd() * 2.0, r = 16 + rnd() * 14;
    items.push({ id: `ore${i}`, kind: 'mat:ore', x: Math.cos(a) * r, z: 8 + Math.sin(a) * r * 0.55 });
  }
  if (POND) {
    for (let i = 0; i < nSand; i++) {
      const a = rnd() * Math.PI * 2, r = (POND.radius ? POND.radius(a) : POND.r) + 0.7 + rnd() * 0.5;
      items.push({ id: `sand${i}`, kind: 'mat:sand', x: POND.cx + Math.cos(a) * r, z: POND.cz + Math.sin(a) * r });
    }
    for (let i = 0; i < nWood; i++) {
      const a = 2.0 + rnd() * 1.8, r = (POND.radius ? POND.radius(a) : POND.r) + 0.85 + rnd() * 0.4;
      items.push({ id: `wood${i}`, kind: 'driftwood', x: POND.cx + Math.cos(a) * r, z: POND.cz + Math.sin(a) * r });
    }
  }
  // nudge anything that landed on the pad, the shed or a tree trunk
  for (const it of items) { const v = new THREE.Vector3(it.x, 0, it.z); pc.resolve(v, 0.5); it.x = v.x; it.z = v.z; }
  const geos = { pinecone: coneGeo(), 'mat:sand': sandGeo(), driftwood: woodGeo() };
  for (const it of items) {
    if (taken.has(it.id)) continue;
    const r2 = mulberry32(it.id.length * 977 + Math.floor(it.x * 13));
    const meta = META[it.kind];
    const geo = it.kind === 'salt' ? saltGeo(r2) : it.kind === 'mat:ore' ? oreGeo(r2) : geos[it.kind];
    const m = new THREE.Mesh(geo, meta.mat);
    m.position.set(it.x, 0, it.z); m.rotation.y = r2() * 6; m.castShadow = true; gatherGrp.add(m);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: meta.spark, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    sp.scale.setScalar(0.4); sp.position.set(it.x, 0.18, it.z); gatherGrp.add(sp);
    it.mesh = m; it.spark = sp; it.phase = r2() * 6;
    interact.add({
      id: 'g-' + it.id, at: () => it, r: 1.3, priority: 0.4,
      actions: () => [{ label: meta.label, icon: meta.icon, run: async () => {
        const pr = player.act('kneel', 1.3, it);
        await wait(700);
        gatherGrp.remove(m); gatherGrp.remove(sp); it.gone = true; interact.remove('g-' + it.id);
        G.gather[dk] = [...(G.gather[dk] || []), it.id];
        const n = meta.n;
        game.add(it.kind, n); audio.pickup(0);
        await pr;
        hud.toast(`${n > 1 ? n + ' ' : 'A '}${itemInfo(it.kind).name.toLowerCase()}`, meta.icon);
      } }],
    });
  }

  // ---- launch: ignition, lift-off and climb (then the space leg takes over)
  let L = null; // { t }
  const camP = new THREE.Vector3(), camT = new THREE.Vector3();
  const smoke = (() => {
    const N = lite ? 160 : 420;
    const g = new THREE.BufferGeometry(); const pos = new Float32Array(N * 3), a = new Float32Array(N), s = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(a, 1)); g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
    const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTex: { value: tex }, uScale: { value: 600 }, uCol: { value: new THREE.Color('#e9e4dc') } },
      vertexShader: 'attribute float aA; attribute float aS; varying float vA; uniform float uScale; void main(){ vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=aS*uScale/-mv.z; }',
      fragmentShader: 'uniform sampler2D uTex; uniform vec3 uCol; varying float vA; void main(){ vec4 t=texture2D(uTex,gl_PointCoord); gl_FragColor=vec4(uCol, t.a*vA); }' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.visible = false; scene.add(pts);
    const P2 = Array.from({ length: N }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 }));
    let k = 0;
    return {
      pts, emit(x, y, z, n, spread) { for (let i = 0; i < n; i++) { const p = P2[k++ % N]; const ang = Math.random() * 6.28; p.x = x; p.y = y; p.z = z; p.vx = Math.cos(ang) * spread * (0.5 + Math.random()); p.vz = Math.sin(ang) * spread * (0.5 + Math.random()); p.vy = 0.3 + Math.random() * 1.2; p.life = 4 + Math.random() * 3; p.max = p.life; p.s = 1.5 + Math.random() * 2; } },
      update(dt) { for (let i = 0; i < N; i++) { const p = P2[i]; if (p.life <= 0) { a[i] = 0; continue; } p.life -= dt; p.vx *= 0.985; p.vz *= 0.985; p.vy *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; const t = 1 - p.life / p.max; p.s += dt * 1.6; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; a[i] = Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t) * 0.7; s[i] = p.s; } g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.attributes.aS.needsUpdate = true; },
    };
  })();
  async function launch() {
    if (L) return;
    if (!wearingSuit()) hud.toast(hasSuit() ? 'The moon has no air. The suit is not on.' : 'The moon has no air. A suit, made at the workshop, would make the crossing survivable.', 'star', 4800);
    hud.setPrompt(null);
    await hud.fadeTo(1, 900);
    player.setVisible(false);
    L = { t: -COUNT, rumble: null, said: {} };
    EG.cinematic = true; hud.setMode('cinematic');
    smoke.pts.visible = true;
    R.flame.visible = true;
    L.rumble = startRumble(); audio.setActivity && audio.setActivity('launch', 28);
    await hud.fadeTo(0, 1200);
  }
  function startRumble() {
    if (audio.rumble) {
      audio.rumble(0.05);
      return { g: { gain: { setTargetAtTime(v) { audio.rumble(Math.min(1, Math.max(0, v) * 4)); } } }, ctx: { currentTime: 0 }, stop() { audio.rumble(0); } };
    }
    const a = audio.raw && audio.raw(); if (!a || !a.ctx) return null;
    const { ctx, master } = a;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(master); src.start();
    return { g, f, ctx, stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 1.2); setTimeout(() => { try { src.stop(); } catch (e) { /* */ } }, 4000); } };
  }
  const COUNT = params.has('fastspace') ? 2 : 7, SPOOL = 2.0, SEEN = 2600; // visible from the garden up to ~2.6 km
  const LINES = [[-COUNT + 0.6, 'All quiet on the pad'], [-3, 'Three'], [-2, 'Two'], [-1, 'One'], [0.2, 'Ignition']];
  const tele = (() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 14px);transform:translateX(-50%);font:14px/1.4 system-ui,sans-serif;color:#f3efe6;background:rgba(20,24,22,.45);padding:6px 14px;border-radius:999px;pointer-events:none;display:none;z-index:30;white-space:nowrap'; document.body.appendChild(d); return d; })();
  const say = (t, ms = 3200) => hud.toast(t, 'rocket', ms);
  // a booster that has fallen away keeps falling (and tumbling) where she can still be seen
  const falling = [];
  function dropStage(i) {
    const b = boosters[i]; if (!b) return;
    b.setFlame(0, 0);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(); b.group.getWorldPosition(wp); b.group.getWorldQuaternion(wq);
    boostRoot.remove(b.group); scene.add(b.group); b.group.position.copy(wp); b.group.quaternion.copy(wq);
    falling.push({ g: b.group, vy: 0, spin: (Math.random() - 0.5) * 0.6, t: 0 });
  }
  function updateFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i--) { const f = falling[i]; f.t += dt; f.vy -= 9.81 * dt; f.g.position.y += f.vy * dt; f.g.rotateZ(f.spin * dt); if (f.t > 12 || f.g.position.y < -20) { scene.remove(f.g); falling.splice(i, 1); } }
  }
  async function launch() {
    if (L) return;
    const d = design(), r = readout(d, rules());
    if (!d.stages.some((st) => st.fuel > 0)) { say('The tanks are empty. Fuel her up at the pad first'); return; }
    if (!wearingSuit()) hud.toast(hasSuit() ? 'The moon has no air. The suit is not on.' : 'The moon has no air. A suit, made at the workshop, would make the crossing survivable.', 'star', 4800);
    hud.setPrompt(null);
    await hud.fadeTo(1, 900);
    player.setVisible(false);
    L = { t: -COUNT, rumble: null, said: {}, design: d, readout: r, warp: 1, stage: 0, seen: true, spin: 0 };
    EG.cinematic = true; hud.setMode('cinematic');
    smoke.pts.visible = true;
    R.flame.visible = true;
    L.rumble = startRumble(); audio.setActivity && audio.setActivity('launch', 28);
    await hud.fadeTo(0, 1200);
  }
  function startRumble() {
    if (audio.rumble) {
      audio.rumble(0.05);
      return { g: { gain: { setTargetAtTime(v) { audio.rumble(Math.min(1, Math.max(0, v) * 4)); } } }, ctx: { currentTime: 0 }, stop() { audio.rumble(0); } };
    }
    const a = audio.raw && audio.raw(); if (!a || !a.ctx) return null;
    const { ctx, master } = a;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), dd = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; dd[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(master); src.start();
    return { g, f, ctx, stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 1.2); setTimeout(() => { try { src.stop(); } catch (e) { /* */ } }, 4000); } };
  }
  // what the flight cost: boosters are spent (they fell into the sea), propellant burned; a lost rocket
  // leaves only the capsule, which comes down under its parachute
  function settle(F) {
    const r = RS(), last = F.fuel.length - 1;
    if (F.outcome === 'pad') { r.stages.forEach((st, i) => { st.fuel = Math.floor(F.fuel[i] / LOAD_KG * 100) / 100; }); r.fuel = Math.floor(F.fuel[last] / LOAD_KG * 100) / 100; }
    else {
      r.stages = [];
      if (F.outcome === 'orbit') r.fuel = Math.floor(F.fuel[last] / LOAD_KG * 100) / 100;
      else { G.rocket.parts = G.rocket.parts.filter((id) => id === 'capsule'); r.fuel = 0; r.err = []; r.engine = 'copper'; }
    }
    G.rocket.flights = [...(G.rocket.flights || []).slice(-9), { at: Date.now(), outcome: F.outcome, alt: Math.round(F.maxAlt || F.alt), speed: Math.round(F.speed), t: Math.round(F.t) }];
    game.save(); syncRocket(); syncBoosters();
  }
  const WHY = {
    pad: 'She could not lift her own weight. The engines are off; the propellant left is still in the tanks.',
    tumble: 'She tipped over in the airflow and broke apart. The capsule came home under its parachute.',
    crash: 'She came back down. The capsule came home under its parachute.',
    suborbit: 'Out of propellant before orbit. She fell back; the capsule came home under its parachute.',
  };
  async function finish() {
    if (L.out) return; L.out = true; const F = L.F;
    tele.style.display = 'none';
    if (F.outcome === 'orbit') {
      say(`In orbit: ${Math.round(F.peri / 1000)} × ${Math.round(F.apo / 1000)} km`, 4200);
      settle(F);
      await hud.fadeTo(1, 1600); if (L && L.rumble) L.rumble.stop();
      api.onLaunched && (await api.onLaunched());
      return;
    }
    say(WHY[F.outcome] || 'The flight is over', 6000);
    await new Promise((res) => setTimeout(res, F.outcome === 'pad' ? 1800 : 2600));
    await hud.fadeTo(1, 1400); if (L && L.rumble) L.rumble.stop();
    settle(F); for (const f of falling) scene.remove(f.g); falling.length = 0;
    api.reset(); await hud.fadeTo(0, 1200);
  }
  function updateLaunch(dt, camera, clock) {
    L.t += dt; const tc = L.t;
    for (const [at, line] of LINES) if (tc >= at && !L.said[at]) { L.said[at] = true; if (tc - at < 1) { hud.toast(line, null, at < 0 && at > -COUNT + 1 ? 900 : 2400); if (at < 0 && at > -COUNT + 1) audio.plink && audio.plink(0.35, 0.03); } }
    updateFalling(dt);
    if (tc < 0) { // countdown: a still, low view of her rocket, steam drifting off the pad
      if (Math.random() < 0.3) smoke.emit(PAD.x, 0.4, PAD.z, 1, 0.6); smoke.update(dt);
      const H = (boostRoot.userData.height || 0) + 13.4;
      camP.set(PAD.x - 26 - H * 0.6, 1.7, PAD.z + 14 + H * 0.3); camT.set(PAD.x, H * 0.5, PAD.z);
      camera.fov = THREE.MathUtils.clamp(2 * Math.atan(H * 0.65 / camP.distanceTo(camT)) * 57.3, 14, 50);
      camera.position.copy(camP); camera.lookAt(camT); camera.updateProjectionMatrix(); R.setFlame(0, clock);
      return 0.18;
    }
    if (!L.F) { L.F = createFlight(L.design, rules(), { seed: (Date.now() & 0xffff) + 1 }); L.F.maxAlt = 0; }
    const F = L.F;
    // engines spool up, then the flight model runs (faster once she is out of sight)
    if (tc > SPOOL && !F.outcome) {
      const seen = F.alt < SEEN && !F.dry; // climbing in view: real time; out of sight or coming back down: fast-forward
      L.warp = seen ? 1 : F.dry && F.alt < SEEN ? 2 : Math.min(F.alt > 30000 || F.dry ? 24 : 8, L.warp + dt * 4);
      const n = Math.min(800, Math.ceil(dt * L.warp / 0.02));
      for (let i = 0; i < n && !F.outcome; i++) {
        const before = F.stage; F.step(F.phase === 'coast' && F.alt > 100e3 ? Math.min(0.25, dt * L.warp / n) : dt * L.warp / n);
        if (F.stage !== before) { if (F.alt < SEEN * 2) dropStage(before); else if (boosters[before]) boosters[before].group.visible = false; }
        F.maxAlt = Math.max(F.maxAlt, F.alt);
      }
      for (const e of F.events) if (!e.said) { e.said = true; if (e.kind === 'stage' || e.kind === 'lift' || e.kind === 'meco' || e.kind === 'circ' || e.kind === 'dry') say(e.text, 2600); }
    }
    const spool = Math.min(1, tc / SPOOL);
    // where she is: height, downrange, and how she is tipped (pitch program + wobble)
    const r = Math.hypot(F.x, F.y), upAng = Math.atan2(F.y, F.x);
    const tilt = F.lift ? (upAng - F.th) : 0, lean = F.psi;
    if (F.outcome && F.outcome !== 'orbit' && F.outcome !== 'pad') { L.spin += dt * 1.6; L.fall = (L.fall || 0) + 9.81 * dt; F.x += F.vx * dt * 0.2; F.y += (F.vy * 0.2 - L.fall) * dt; } // breaking up: she tumbles and falls
    const alt = Math.max(0, r - F.rules.radius);
    placeShip(F.downrange * 0.9, alt, F.downrange * 0.15, tilt + L.spin, lean + L.spin * 0.3);
    const burning = F.thrust > 0 || tc < SPOOL;
    const k = burning ? (tc < SPOOL ? 0.3 + 0.7 * spool : 1) : 0;
    boosters.forEach((b, i) => b.setFlame(i === F.stage && boosters.length && F.stage < boosters.length ? k : 0, clock));
    R.setFlame(F.stage >= boosters.length ? k : 0, clock);
    if (L.rumble) { const rk = 0.25 * k * Math.max(0.15, 1 - alt / 3000); L.rumble.g.gain.setTargetAtTime(rk, L.rumble.ctx.currentTime, 0.3); }
    if (alt < 30) smoke.emit(PAD.x, 0.6, PAD.z, Math.round(dt * (lite ? 70 : 160) * k), 3.0 + k * 3);
    else if (k && Math.random() < 0.5 && alt < SEEN) smoke.emit(boostRoot.position.x, boostRoot.position.y - 3, boostRoot.position.z, 2, 0.4);
    smoke.update(dt);
    // telemetry: what the flight model says
    tele.style.display = '';
    tele.textContent = `T+${Math.max(0, F.t).toFixed(0)} s · ${(alt / 1000).toFixed(alt < 10000 ? 2 : 0)} km · ${Math.round(F.speed)} m/s · stage ${F.stage + 1}/${F.fuel.length}${L.warp > 1.5 ? ` · ×${Math.round(L.warp)}` : ''}${F.wobble > 0.03 && F.q > 300 ? ' · wobbling' : ''}`;
    // camera: a low, steady view from the edge of the garden, tilting up to follow; out of sight -> the long view
    const shake = (k * 0.04 * Math.max(0.2, 1 - alt / 400)) * Math.sin(clock * 61);
    const H = (boostRoot.userData.height || 0) + 13.4, cy = boostRoot.position.y + H * 0.5;
    if (alt < 60 || F.outcome === 'pad') { // from the edge of the garden
      camP.set(PAD.x - 26 - H * 0.6, 1.7 + shake, PAD.z + 14 + H * 0.3);
      camT.set(boostRoot.position.x, Math.max(H * 0.5, cy), boostRoot.position.z);
    } else { // a chase plane climbing below and behind her, the ground still in frame
      const d = 60 + H + alt * 0.3;
      camP.set(boostRoot.position.x - d * 0.85, Math.max(1.7, alt * 0.8), boostRoot.position.z + d * 0.55);
      camT.set(boostRoot.position.x, cy, boostRoot.position.z);
    }
    camera.fov = THREE.MathUtils.clamp(2 * Math.atan(Math.max(16, H * 0.8) / camP.distanceTo(camT)) * 57.3, 6, 50);
    camera.position.copy(camP); camera.lookAt(camT); camera.updateProjectionMatrix();
    if (F.outcome) {
      if (!L.endAt) L.endAt = tc;
      if (tc - L.endAt > (F.outcome === 'orbit' ? 0 : 0.5)) finish();
    } else if (alt > SEEN && !L.dark) { L.dark = true; hud.fadeTo(0.88, 2500); } // out of sight: the numbers tell the rest
    return alt;
  }
  const api = {
    rocket: R, shed, pad, items, build, nextPart, rocketDone,
    // the design and the flight model (tests and the pause-menu readout): window.__garden.game.rocket.ops.tank(0, 1) ...
    // ?unlock=all only (tests): set a design outright with full tanks
    devSet(stages, engine = 'copper') { if (!UNLOCK_ALL) return false; const r = RS(); r.stages = stages.map((st) => ({ fins: 0, err: [], ...st })); r.stages.forEach((st) => { st.fuel = capacity({ tanks: st.tanks }); if (!st.err.length) st.err = mountErr(st.engines); }); r.engine = engine; r.err = mountErr(1); r.fuel = capacity({ tanks: 0, hull: true }); syncBoosters(); return readout(design(), rules()); },
    ops: OPS, fuelUp, design, readout: () => readout(design(), rules()), syncDesign: () => { syncRocket(); syncBoosters(); }, get flight() { return L && L.F ? { t: L.F.t, alt: L.F.alt, speed: L.F.speed, stage: L.F.stage, outcome: L.F.outcome, wobble: L.F.wobble, events: L.F.events.map((e) => e.kind) } : null; },
    get launching() { return !!L && !L.land; },
    get landing() { return !!L && !!L.land; },
    // tests: ?unlock=all  →  window.__garden.game.rocket.launch()
    launch,
    update(dt, clock, ts) {
      const night = ts ? ts.night : 0;
      shed.userData.lamp.pl.intensity = night * 4 + (ts ? ts.golden * 1.5 : 0);
      shed.userData.lamp.lamp.material.emissiveIntensity = 0.2 + night * 1.5;
      R.window.emissiveIntensity = 0.2 + night * 1.8;
      pad.userData.beacon.material.emissiveIntensity = 0.6 + 1.6 * (Math.sin(clock * 2.2) > 0.6 ? 1 : 0);
      for (const it of items) if (it.spark && !it.gone) { const tw = Math.exp(-(((clock + it.phase) % 4.5 - 0.3) ** 2) / 0.03); it.spark.material.opacity = (0.25 + tw) * (1 - night * 0.6); it.spark.scale.setScalar(0.3 + tw * 0.5); }
      if (arriving) {
        arriving.t += dt; const t = Math.min(1, arriving.t / 2.2), e = 1 - Math.pow(1 - t, 3);
        arriving.part.position.y = (1 - e) * 3; arriving.part.scale.setScalar(0.92 + 0.08 * e);
        if (t >= 1) arriving = null;
      }
      if (!L) R.setFlame(0, clock);
    },
    // coming home: a slow tail-first descent onto the pad under a soft engine, then she steps out
    land() {
      return new Promise((done) => {
        L = { land: true, t: 0, dur: params.has('landdur') ? +params.get('landdur') : params.has('fastspace') ? 4 : 15, done, said: {} };
        EG.cinematic = true; hud.setMode('cinematic'); player.setVisible(false); smoke.pts.visible = true; R.flame.visible = true;
        L.rumble = startRumble();
      });
    },
    cinematicCamera(dt, camera, clock) {
      if (!L) return false;
      if (L.land) {
        L.t += dt; const u = Math.min(1, L.t / L.dur), y = 0.18 + 170 * Math.pow(1 - u, 2.6);
        placeShip(0, y - 0.18, 0, 0, 0); R.setFlame(u < 0.98 ? 0.35 + 0.4 * Math.min(1, (1 - u) * 3) : (1 - u) * 20, clock);
        if (L.rumble) L.rumble.g.gain.setTargetAtTime(u < 0.98 ? 0.12 : 0, L.rumble.ctx.currentTime, 0.4);
        if (y < 30 && u < 0.99) smoke.emit(PAD.x, 0.5, PAD.z, Math.round(dt * (lite ? 40 : 90) * (1 - y / 30)), 2.5 + (1 - y / 30) * 3);
        smoke.update(dt);
        if (!L.said.a && L.t > 1.2) { L.said.a = true; hud.toast('Home. Bringing her down gently', null, 3200); }
        if (!L.said.b && u >= 1) { L.said.b = true; hud.toast('Touchdown, right on the pad', null, 3000); }
        camP.set(PAD.x - 26, 1.7, PAD.z + 14); camT.set(PAD.x, Math.max(6.5, y + 6), PAD.z);
        camera.fov = THREE.MathUtils.clamp(2 * Math.atan(16 / camP.distanceTo(camT)) * 57.3, 14, 50);
        camera.position.copy(camP); camera.lookAt(camT); camera.updateProjectionMatrix();
        if (u >= 1 && L.t > L.dur + 2.2 && !L.out) { L.out = true; const d = L.done; (async () => { await hud.fadeTo(1, 1200); if (L && L.rumble) L.rumble.stop(); api.reset(); camera.fov = 70; camera.updateProjectionMatrix(); d(); })(); }
        return true;
      }
      updateLaunch(dt, camera, clock);
      return true;
    },
    // after a trip: the rocket is back on its pad, and so is she
    reset() {
      L = null; EG.cinematic = false; tele.style.display = 'none'; placeShip(0, 0, 0, 0, 0); R.setFlame(0, 0); for (const b of boosters) b.setFlame(0, 0); smoke.pts.visible = false;
      player.setVisible(true); player.teleport(PAD.x - 6.5, PAD.z + 1.5, -Math.PI / 2);
      hud.setMode('walk');
    },
  };
  return api;
}
