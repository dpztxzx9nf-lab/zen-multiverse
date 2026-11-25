// Earthen garden wall (Ryoan-ji style), true size: ~1.95 m of plaster under a ~0.3 m kawara tile cap.
// Plaster is a painted canvas texture (mottling, oil-stain blooms, damp base, a few hairline cracks),
// split into bays with slight tint variation; a moss skirt and ivy patches climb it; three small
// wall lamps throw warm pools of light on the plaster and gravel at night (additive decals, no lights).
import * as THREE from 'three';
import { mulberry32, mergeGeometries, noise3 } from './util.js';
import { addSnowCover } from './weather.js';

function plasterTexture(seed, W = 512, H = 128) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), rnd = mulberry32(seed);
  const base = [206, 178, 138];
  const blooms = Array.from({ length: 9 }, () => ({ x: rnd() * W, y: H * (0.2 + rnd() * 0.6), r: 20 + rnd() * 60, k: 0.1 + rnd() * 0.16 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H; // 0 top .. 1 bottom
    const n = noise3(x * 0.03, y * 0.03, seed) * 0.6 + noise3(x * 0.12, y * 0.12, seed + 3) * 0.3 + noise3(x * 0.5, y * 0.5, seed + 7) * 0.12;
    let r = base[0] + n * 22, gg = base[1] + n * 20, b = base[2] + n * 16;
    for (const bl of blooms) { const d = Math.hypot(x - bl.x, (y - bl.y) * 1.6) / bl.r; if (d < 1) { const k = (1 - d * d) * bl.k; r -= 70 * k; gg -= 62 * k; b -= 44 * k; } }
    const damp = Math.max(0, (v - 0.72) / 0.28) ** 1.5 * (0.75 + 0.25 * noise3(x * 0.05, 1, seed));
    r -= damp * 60; gg -= damp * 46; b -= damp * 40;
    const drip = Math.max(0, noise3(x * 0.4, 0.3, seed + 11) - 0.55) * Math.max(0, 0.6 - Math.abs(v - 0.25)) * 80;
    r -= drip * 0.7; gg -= drip * 0.65; b -= drip * 0.5;
    const k = (y * W + x) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // hairline cracks
  g.strokeStyle = 'rgba(80,60,40,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rnd() * W, y = H * (0.2 + rnd() * 0.5); g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (rnd() - 0.5) * 10; y += 3 + rnd() * 5; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function createWall(scene, { P, uSnow, season, z = -12.6, len = 35, x0 = 0, lamps = [-8.5, 4.6, 10.5] }) {
  const g = new THREE.Group(); g.position.set(x0, 0, z); g.name = 'wall';
  const H = 1.95, T = 0.5, BAYS = 5, bay = len / BAYS;
  const tex = [plasterTexture(11), plasterTexture(29)];
  const mats = tex.map((t, i) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, color: i ? '#fbf3ea' : '#ffffff' }));
  for (let i = 0; i < BAYS; i++) {
    const box = new THREE.BoxGeometry(bay - 0.02, H, T);
    // texture repeats per bay with an offset so neighbouring bays differ
    const uv = box.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (bay / 7));
    const m = new THREE.Mesh(box, mats[i % 2]); m.position.set(-len / 2 + bay * (i + 0.5), H / 2 + 0.18, 0);
    m.material.map.wrapS = THREE.RepeatWrapping;
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  // stone plinth and timber posts between bays
  const stoneM = new THREE.MeshStandardMaterial({ color: '#6f6a60', roughness: 1 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.2, T + 0.14), stoneM); plinth.position.y = 0.1; plinth.receiveShadow = true; g.add(plinth);
  const postG = [];
  for (let i = 0; i <= BAYS; i++) postG.push(new THREE.BoxGeometry(0.14, H, 0.06).translate(-len / 2 + bay * i, H / 2 + 0.18, T / 2 + 0.02));
  postG.push(new THREE.BoxGeometry(len, 0.08, 0.05).translate(0, H + 0.12, T / 2 + 0.02)); // top beam
  const wood = new THREE.Mesh(mergeGeometries(postG), new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.8 })); wood.castShadow = true; g.add(wood);
  // kawara tile cap: eaves board, rows of pan + cover tiles down both slopes, round ridge
  const capY = H + 0.18;
  const tileM = new THREE.MeshStandardMaterial({ color: '#3d4046', roughness: 0.55, metalness: 0.1 });
  addSnowCover(tileM, uSnow);
  const board = new THREE.Mesh(new THREE.BoxGeometry(len + 0.5, 0.06, T + 0.5), tileM); board.position.y = capY + 0.03; g.add(board);
  const nT = Math.round(len / (P.cls === 'phone' ? 0.3 : 0.2));
  const coverG = new THREE.CylinderGeometry(0.05, 0.05, 0.42, P.cls === 'phone' ? 5 : 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
  const tiles = new THREE.InstancedMesh(coverG, tileM, nT * 2); tiles.castShadow = true;
  const o = new THREE.Object3D(); let n = 0;
  for (const side of [-1, 1]) for (let i = 0; i < nT; i++) {
    o.position.set(-len / 2 - 0.2 + (i + 0.5) * ((len + 0.4) / nT), capY + 0.13, side * 0.2);
    o.rotation.set(side * -0.5, 0, 0); o.updateMatrix(); tiles.setMatrixAt(n++, o.matrix);
  }
  g.add(tiles);
  const slope = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len + 0.5, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6), tileM);
  slope.scale.set(1, 0.36, 1); slope.position.y = capY + 0.1; g.add(slope);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, len + 0.5, 10).rotateZ(Math.PI / 2), tileM);
  ridge.position.y = capY + 0.27; ridge.castShadow = true; g.add(ridge);
  // end tiles (onigawara) as small discs
  for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14).rotateZ(Math.PI / 2), tileM); d.position.set(sx * (len / 2 + 0.25), capY + 0.25, 0); g.add(d); }
  // moss skirt and ivy patches (instanced leaf cards on the garden face)
  const rnd = mulberry32(5150);
  const leafG = new THREE.PlaneGeometry(0.11, 0.09);
  const ivyM = new THREE.MeshStandardMaterial({ color: season.season === 'autumn' ? '#9a4a2a' : season.season === 'winter' ? '#6b5a3e' : '#3f6a2f', roughness: 0.8, side: THREE.DoubleSide });
  const mossM = new THREE.MeshStandardMaterial({ color: '#4f6b34', roughness: 1, side: THREE.DoubleSide });
  const nIvy = P.cls === 'phone' ? 260 : 700, nMoss = P.cls === 'phone' ? 160 : 420;
  const ivy = new THREE.InstancedMesh(leafG, ivyM, nIvy), moss = new THREE.InstancedMesh(new THREE.CircleGeometry(0.09, 6), mossM, nMoss);
  const patches = [[-14, 1.3], [-6.2, 0.9], [7.8, 1.5], [14.2, 1.0]];
  for (let i = 0; i < nIvy; i++) {
    const [px, ph] = patches[i % patches.length];
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
    const y = Math.max(0.2, 0.2 + rnd() ** 1.6 * ph * 1.4), x = px + Math.cos(a) * r * (1.3 - y * 0.35);
    o.position.set(x, Math.min(capY - 0.05, y), T / 2 + 0.01 + rnd() * 0.03);
    o.rotation.set((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.8, rnd() * 6.28); o.scale.setScalar(0.6 + rnd() * 0.7);
    o.updateMatrix(); ivy.setMatrixAt(i, o.matrix);
  }
  for (let i = 0; i < nMoss; i++) {
    o.position.set(-len / 2 + rnd() * len, 0.2 + rnd() ** 2.5 * 0.35, T / 2 + 0.012);
    o.rotation.set(0, 0, rnd() * 6.28); o.scale.set(0.7 + rnd() * 1.4, 0.5 + rnd() * 0.6, 1); o.updateMatrix(); moss.setMatrixAt(i, o.matrix);
  }
  g.add(ivy, moss);
  // wall lamps + warm light pools (decals on the plaster and the ground)
  const poolTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,200,130,1)'); gr.addColorStop(0.4, 'rgba(255,170,90,0.4)'); gr.addColorStop(1, 'rgba(255,150,70,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const lampM = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb25a', emissiveIntensity: 0, roughness: 0.9 });
  const lampFrame = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.8 });
  for (const lx of lamps) {
    const lamp = new THREE.Group(); lamp.position.set(lx, 1.55, T / 2 + 0.12);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), lampM); lamp.add(box);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.08, 4).rotateY(Math.PI / 4), lampFrame); cap.position.y = 0.15; lamp.add(cap);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.14), lampFrame); arm.position.set(0, 0.12, -0.08); lamp.add(arm);
    g.add(lamp);
    const wp = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), poolM); wp.position.set(lx, 1.35, T / 2 + 0.015); g.add(wp);
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4).rotateX(-Math.PI / 2), poolM); gp.position.set(lx, 0.03, T / 2 + 1.0); g.add(gp);
  }
  scene.add(g);
  function update(lan, flick = 1) {
    lampM.emissiveIntensity = lan * 3.2 * flick;
    poolM.opacity = lan * 0.95 * flick;
  }
  return { group: g, update, height: capY + 0.34 };
}
