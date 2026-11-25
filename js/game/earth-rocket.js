// Phase 2 on Earth: the workshop shed, gathering outside the garden (salt crystals on the flats,
// pine cones under the pines beyond the wall), the rocket growing on its pad, and the launch.
import * as THREE from 'three';
import { game, dayKey, itemInfo, UNLOCK_ALL } from './store.js';
import { buildRocket, ROCKET_PARTS } from './rocket.js';
import { mulberry32, mergeGeometries } from '../util.js';
import { icon } from './icons.js';
import { consolidate } from './character.js';

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
  const { scene, P, params, audio, nature } = E;
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
  const builtSet = () => new Set(G.rocket.parts);
  function syncRocket() { const b = builtSet(); for (const p of ROCKET_PARTS) R.parts[p.id].visible = b.has(p.id); R.flame.visible = b.size > 0; }
  syncRocket();
  const rocketDone = () => ROCKET_PARTS.every((p) => G.rocket.parts.includes(p.id));
  const nextPart = () => ROCKET_PARTS.find((p) => !G.rocket.parts.includes(p.id));
  pc.circle(PAD.x, PAD.z, 1.3, { h: 13, name: 'rocket' });

  // a part "arrives": it settles down into place with a little sparkle
  let arriving = null;
  function build(part) {
    if (!game.pay(part.cost)) { hud.toast('Not quite enough yet', 'rocket'); return false; }
    G.rocket.parts.push(part.id); game.save(); syncRocket();
    arriving = { part: R.parts[part.id], t: 0 };
    audio.chime(); audio.place(); audio.setActivity && audio.setActivity('build', 5);
    hud.toast(rocketDone() ? 'The rocket is finished. Walk to the pad to board' : `The ${part.name.toLowerCase()} is on the rocket`, 'rocket', 3600);
    if (rocketDone()) game.unlock('rocket');
    return true;
  }
  function rocketTab() {
    return { id: 'rocket', label: 'Rocket', icon: 'rocket', render: (b, rerender) => {
      const built = builtSet(); const nx = nextPart();
      b.innerHTML = `<h3>The rocket</h3><p class="muted" style="margin:0 0 12px">Build it piece by piece at the workshop bench, from things you gather and grow.</p>` + ROCKET_PARTS.map((p) => {
        const done = built.has(p.id), isNext = nx && nx.id === p.id, can = isNext && game.has(p.cost);
        return `<div class="row" style="${!done && !isNext ? 'opacity:.45' : ''}"><span style="width:26px;height:26px;display:inline-flex;color:${done ? '#bfe8b0' : '#fff'}">${icon(done ? 'star' : 'rocket')}</span><div class="grow"><div>${p.name}${done ? ' <span class="done">· built</span>' : ''}</div><div class="muted" style="font-size:13px">${p.desc}</div>${done ? '' : `<div style="margin-top:6px">${hud.cost(p.cost)}</div>`}</div>${isNext ? `<button class="b" data-build="${p.id}" ${can && nearBench() ? '' : 'disabled'}>${nearBench() ? 'Build' : 'At the bench'}</button>` : ''}</div>`;
      }).join('') + `<h3>Where things are</h3><p class="muted" style="font-size:14px;line-height:1.5">Salt crystals sparkle out on the salt flats. Pine cones fall under the tall pines behind the garden wall. Finds turn up in the sand and along the pond. Flowers come from the beds, and clippings from pruning the bonsai.</p>`;
      b.querySelectorAll('[data-build]').forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); const p = ROCKET_PARTS.find((q) => q.id === el.dataset.build); if (build(p)) rerender(); }));
    } };
  }
  const nearBench = () => Math.hypot(player.position.x - benchAt.x, player.position.z - benchAt.z) < 2.2;
  EG.extraTabs.push(rocketTab());
  interact.add({ id: 'bench', at: () => benchAt, r: 1.6, priority: 0.3, actions: () => [{ label: rocketDone() ? 'Admire the plans' : 'Work on the rocket', icon: 'build', run: async () => EG.openBag('rocket') }] });
  interact.add({
    id: 'pad', at: () => ({ x: PAD.x - 2.2, z: PAD.z }), r: 2.6,
    actions: () => rocketDone()
      ? [{ label: 'Board the rocket', icon: 'rocket', run: () => launch() }]
      : [{ label: G.rocket.parts.length ? 'The rocket is coming along' : 'An empty launch pad', icon: 'rocket', run: async () => hud.toast(G.rocket.parts.length ? `${ROCKET_PARTS.length - G.rocket.parts.length} more part${ROCKET_PARTS.length - G.rocket.parts.length > 1 ? 's' : ''} to build at the workshop` : 'The workshop bench by the garden has the plans', 'rocket', 3200) }],
  });

  // ---- gathering: a fresh handful each day (salt on the flats, pine cones under the pines)
  const gatherGrp = new THREE.Group(); scene.add(gatherGrp);
  const saltM = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 0.08 });
  const coneM = new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.85 });
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
  const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillRect(31, 6, 2, 52); g.fillRect(6, 31, 52, 2); return new THREE.CanvasTexture(c); })();
  const dk = dayKey();
  const taken = new Set(G.gather[dk] || []);
  for (const k of Object.keys(G.gather)) if (k !== dk) delete G.gather[k];
  const items = [];
  const rnd = mulberry32([...dk].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0);
  const pines = (nature.trees || []).filter((t) => t.name === 'pine');
  const nSalt = UNLOCK_ALL || params.has('gather') ? 10 : 6, nCone = 4;
  for (let i = 0; i < nSalt; i++) {
    const a = rnd() * Math.PI * 2, r = 27 + rnd() * 22;
    items.push({ id: `salt${i}`, kind: 'salt', x: 1.5 + Math.cos(a) * r, z: -0.5 + Math.sin(a) * r * 0.9 });
  }
  for (let i = 0; i < nCone; i++) {
    const t = pines.length ? pines[i % pines.length] : { x: -9.5, z: -16 };
    const a = rnd() * Math.PI * 2, r = 1.2 + rnd() * 1.8;
    items.push({ id: `cone${i}`, kind: 'pinecone', x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r });
  }
  // nudge anything that landed on the pad, the shed or a tree trunk
  for (const it of items) { const v = new THREE.Vector3(it.x, 0, it.z); pc.resolve(v, 0.5); it.x = v.x; it.z = v.z; }
  const cg = coneGeo();
  for (const it of items) {
    if (taken.has(it.id)) continue;
    const r2 = mulberry32(it.id.length * 977 + Math.floor(it.x * 13));
    const m = new THREE.Mesh(it.kind === 'salt' ? saltGeo(r2) : cg, it.kind === 'salt' ? saltM : coneM);
    m.position.set(it.x, 0, it.z); m.rotation.y = r2() * 6; m.castShadow = true; gatherGrp.add(m);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: it.kind === 'salt' ? '#ffffff' : '#ffe7b0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    sp.scale.setScalar(0.4); sp.position.set(it.x, 0.18, it.z); gatherGrp.add(sp);
    it.mesh = m; it.spark = sp; it.phase = r2() * 6;
    interact.add({
      id: 'g-' + it.id, at: () => it, r: 1.3, priority: 0.4,
      actions: () => [{ label: it.kind === 'salt' ? 'Gather the salt crystals' : 'Pick up the pine cone', icon: it.kind === 'salt' ? 'salt' : 'pine', run: async () => {
        const pr = player.act('kneel', 1.3, it);
        await wait(700);
        gatherGrp.remove(m); gatherGrp.remove(sp); it.gone = true; interact.remove('g-' + it.id);
        G.gather[dk] = [...(G.gather[dk] || []), it.id];
        const n = it.kind === 'salt' ? 2 : 1;
        game.add(it.kind, n); audio.pickup(0);
        await pr;
        hud.toast(`${n > 1 ? n + ' ' : 'A '}${itemInfo(it.kind).name.toLowerCase().replace(/s$/, n > 1 ? 's' : '')}`, it.kind === 'salt' ? 'salt' : 'pine');
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
  const IGN = 3.2, COUNT = params.has('fastspace') ? 2 : 7;
  // calm captions, said once each: a quiet countdown, then the climb
  const LINES = [[-COUNT + 0.6, 'All quiet on the pad. Clear skies over the garden'], [-3, 'Three'], [-2, 'Two'], [-1, 'One'], [0.2, 'Ignition'], [IGN + 1.2, 'Lift-off'], [IGN + 8, 'Climbing through the haze, the garden falling away']];
  function updateLaunch(dt, camera, clock) {
    L.t += dt; const tc = L.t;
    for (const [at, line] of LINES) if (tc >= at && !L.said[at]) { L.said[at] = true; if (tc - at < 1) { hud.toast(line, null, at < 0 && at > -COUNT + 1 ? 900 : 3200); if (at < 0 && at > -COUNT + 1) audio.plink && audio.plink(0.35, 0.03); } }
    if (tc < 0) { // countdown: a still, low view of her rocket, steam drifting off the pad
      if (Math.random() < 0.3) smoke.emit(PAD.x, 0.4, PAD.z, 1, 0.6); smoke.update(dt);
      camP.set(PAD.x - 26, 1.7, PAD.z + 14); camT.set(PAD.x, 6.5, PAD.z);
      camera.fov = THREE.MathUtils.clamp(2 * Math.atan(16 / camP.distanceTo(camT)) * 57.3, 14, 50);
      camera.position.copy(camP); camera.lookAt(camT); camera.updateProjectionMatrix(); R.setFlame(0, clock);
      return 0.18;
    }
    const t = tc;
    const lift = Math.max(0, t - IGN);
    const y = 0.18 + 0.5 * 2.6 * lift * lift + lift * 0.4;
    R.group.position.y = y;
    const k = Math.min(1, t / IGN);
    R.setFlame(t < 0.6 ? t / 0.6 * 0.3 : 0.3 + 0.7 * k, clock);
    if (L.rumble) { const rk = 0.25 * Math.min(1, k + 0.2) * Math.max(0.2, 1 - lift / 18); L.rumble.g.gain.setTargetAtTime(rk, L.rumble.ctx.currentTime, 0.3); }
    // smoke: a billowing ring at the pad, then a trail
    if (y < 30) smoke.emit(PAD.x, 0.6, PAD.z, Math.round(dt * (lite ? 70 : 160) * Math.min(1, t)), 3.0 + k * 3);
    else if (Math.random() < 0.5) smoke.emit(PAD.x, y - 3, PAD.z, 2, 0.4);
    smoke.update(dt);
    // camera: a low, steady view from the edge of the garden, tilting up to follow
    const shake = (t < IGN + 4 ? Math.min(1, t / IGN) * 0.04 : 0.02) * Math.sin(clock * 61);
    // shot 1: from the garden's edge, the camera tilts up and zooms to keep her rocket framed
    // shot 2 (after ~9 s of climb): riding alongside, looking down on the garden falling away
    const two = lift > 9;
    if (!two) {
      camP.set(PAD.x - 26, 1.7 + shake, PAD.z + 14);
      camT.set(PAD.x, Math.max(6.5, y + 6.5), PAD.z);
      const dist = camP.distanceTo(camT);
      camera.fov = THREE.MathUtils.clamp(2 * Math.atan(16 / dist) * 57.3, 14, 50);
    } else {
      const u = lift - 9;
      if (!L.cut) { L.cut = true; }
      // a shallow look down past her rocket toward the sea and hills; the climb melts into haze
      camP.set(PAD.x - 16 - u * 0.6, y + 7 + u * 0.4, PAD.z + 12 + u * 0.4);
      camT.set(PAD.x + 6, y - 5, PAD.z - 4);
      camera.fov = 50;
    }
    camera.position.copy(camP); camera.lookAt(camT);
    camera.updateProjectionMatrix();
    return y;
  }
  const api = {
    rocket: R, shed, pad, items, build, nextPart, rocketDone,
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
        R.group.position.y = y; R.setFlame(u < 0.98 ? 0.35 + 0.4 * Math.min(1, (1 - u) * 3) : (1 - u) * 20, clock);
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
      const y = updateLaunch(dt, camera, clock);
      if (y > 260 && !L.leaving) {
        L.leaving = true;
        (async () => {
          await hud.fadeTo(1, 1600);
          if (L.rumble) L.rumble.stop();
          api.onLaunched && (await api.onLaunched());
        })();
      }
      return true;
    },
    // after a trip: the rocket is back on its pad, and so is she
    reset() {
      L = null; EG.cinematic = false; R.group.position.y = 0.18; R.setFlame(0, 0); smoke.pts.visible = false;
      player.setVisible(true); player.teleport(PAD.x - 6.5, PAD.z + 1.5, -Math.PI / 2);
      hud.setMode('walk');
    },
  };
  return api;
}
