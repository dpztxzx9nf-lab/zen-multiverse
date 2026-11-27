// Landmark meshes, signs and colliders for the Xenia city hub (client only).
import * as THREE from 'three';
import {
  HUB_BOXES, LANDMARKS, PLOTS, STREETS, MANSIONS, HUB_PAD_Y, SEA_Y, SEAWARD_YAW,
  EARTH_SITE, cityToPlanet, gardenToPlanet, inHub,
} from './hub.js';

const GREY = {
  block: '#8a8a8a', tower: '#c5d0dc', shaft: '#b7c4d4', blade: '#9aadc2',
  crown: '#e8eef4', stall: '#9a9084',
  post: '#6e6e6e', canopy: '#7a7a7a', dock: '#6a6864', pier: '#5a5854',
  mansion: '#7a7670', street: '#6c6c6c', pad: '#9a9a94', sign: '#2e2e2e',
};
function tint(name) {
  if (name === 'bank-spire' || name === 'bank-crown') return GREY.crown;
  if (name.startsWith('bank-blade')) return GREY.blade;
  if (name === 'bank-shaft') return GREY.shaft;
  if (name.startsWith('bank')) return GREY.tower;
  if (name.startsWith('stall')) return GREY.stall;
  if (name.startsWith('bay-post')) return GREY.post;
  if (name.startsWith('bay-canopy')) return GREY.canopy;
  if (name.startsWith('dock')) return GREY.dock;
  if (name.startsWith('pier')) return GREY.pier;
  if (name.startsWith('mansion')) return GREY.mansion;
  return GREY.block;
}

function signTexture(title, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#d8d8d8'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#f2f2f2'; g.font = 'bold 56px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, 256, sub ? 64 : 80, 470);
  if (sub) { g.font = '28px system-ui,sans-serif'; g.fillStyle = '#c8c8c8'; g.fillText(sub, 256, 118, 470); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

function makeSign(title, sub) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.18), new THREE.MeshStandardMaterial({ color: GREY.post, roughness: 0.9 }));
  post.position.y = 1.2; post.castShadow = true; g.add(post);
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(title, sub), roughness: 0.7 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.15), mat);
  board.position.set(0, 2.55, 0.12); g.add(board);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.15), new THREE.MeshStandardMaterial({ color: GREY.sign, roughness: 0.9 }));
  back.position.set(0, 2.55, 0.10); back.rotation.y = Math.PI; g.add(back);
  g.userData.noCurve = false;
  return g;
}

function skyElev(W) {
  if (W && W.sky && typeof W.sky.sunElev === 'number') return W.sky.sunElev;
  try {
    const w = window.__garden && window.__garden.worlds && window.__garden.worlds.current;
    if (w && w.sky && typeof w.sky.sunElev === 'number') return w.sky.sunElev;
  } catch (e) { /* no sky yet */ }
  return null;
}
function nightK(W) {
  const e = skyElev(W);
  if (e == null) return 0;
  if (e <= 0.02) return 1;
  if (e >= 0.22) return 0;
  return 1 - (e - 0.02) / 0.20;
}
function nightEmFor(name) {
  if (name === 'bank-spire' || name === 'bank-crown') return 0.9;
  if (name.startsWith('bank')) return 0.4;
  return 0;
}

export function buildHub({ scene, colliders, interact, groundAt, home }) {
  if (!home) return { group: null, dispose() {}, refresh() {} };
  const group = new THREE.Group(); group.name = 'xenia-hub';
  const mats = new Map();
  const nightMats = [];
  const mat = (c, nightEm) => {
    const k = c + '|' + (nightEm || 0);
    if (!mats.has(k)) {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: nightEm ? 0.22 : 0.02 });
      if (nightEm) {
        m.emissive = new THREE.Color('#c8e4ff');
        m.emissiveIntensity = 0;
        m.userData.nightEm = nightEm;
        nightMats.push(m);
      }
      mats.set(k, m);
    }
    return mats.get(k);
  };
  const applyNight = (W) => {
    const k = nightK(W);
    for (const m of nightMats) m.emissiveIntensity = k * m.userData.nightEm;
  };

  for (const b of HUB_BOXES) {
    const h = Math.max(0.08, b.top - b.bottom);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, h, b.hd * 2), mat(tint(b.name), nightEmFor(b.name)));
    mesh.position.set(b.x, (b.bottom + b.top) / 2, b.z);
    mesh.rotation.y = b.ry || 0;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = b.name;
    if (b.name === 'bank-tower') mesh.onBeforeRender = () => applyNight();
    group.add(mesh);
    const cause = mesh;
    colliders.add({
      type: 'box', kind: 'solid', x: b.x, z: b.z, hw: b.hw, hd: b.hd, ry: b.ry || 0,
      h: b.h, bottom: b.bottom, top: b.top, name: b.name, tag: 'hub', cause,
    });
  }

  // streets: thin visual slabs, not solid
  const streetM = mat(GREY.street);
  for (const [al, lat, ha, hl] of STREETS) {
    const p = cityToPlanet(al, lat);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(hl * 2, 0.06, ha * 2), streetM);
    slab.position.set(p.x, HUB_PAD_Y + 0.03, p.z);
    slab.rotation.y = SEAWARD_YAW;
    slab.receiveShadow = true; slab.name = 'street';
    group.add(slab);
  }

  function placeSign(x, z, title, sub, yaw) {
    const y = groundAt ? groundAt(x, z) : HUB_PAD_Y;
    const s = makeSign(title, sub);
    s.position.set(x, y, z);
    s.rotation.y = yaw != null ? yaw : SEAWARD_YAW + Math.PI;
    group.add(s);
    return s;
  }
  for (const L of LANDMARKS) placeSign(L.x, L.z, L.name, L.what, SEAWARD_YAW + Math.PI);
  // a welcome sign in the plaza, facing people who walk in from the garden
  const gate = cityToPlanet(72, 0);
  placeSign(gate.x, gate.z, 'Xenia', 'The city hub', SEAWARD_YAW);

  const padM = mat(GREY.pad);
  for (const p of PLOTS) {
    const y = p.hill ? (MANSIONS.find((m) => Math.hypot((p.lx || 0) - m.lx, (p.lz || 0) - m.lz) < 20)?.padY || HUB_PAD_Y) : HUB_PAD_Y;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(8, 0.08, 10), padM);
    pad.position.set(p.x, y + 0.04, p.z);
    pad.rotation.y = p.hill ? 0.55 : SEAWARD_YAW;
    pad.receiveShadow = true; pad.name = p.id;
    group.add(pad);
    placeSign(p.x, p.z, p.name, 'For sale', p.hill ? 0.55 : SEAWARD_YAW + Math.PI);
  }

  if (interact) {
    for (const L of LANDMARKS) {
      interact.add({
        id: L.id, at: () => ({ x: L.x, y: 0, z: L.z }), r: 6, priority: 0.08, enabled: () => true,
        actions: () => [{ label: L.name, icon: 'star', run: () => {} }],
      });
    }
    for (const p of PLOTS) {
      interact.add({
        id: p.id, at: () => ({ x: p.x, y: 0, z: p.z }), r: 4, priority: 0.06, enabled: () => true,
        actions: () => [{ label: p.name + ' (for sale soon)', icon: 'star', run: () => {} }],
      });
    }
  }

  scene.add(group);
  const api = {
    group,
    inHub,
    refresh(W) {
      group.visible = !W || W.tile === EARTH_SITE.tile || W.tile === W.spawnTile;
      applyNight(W);
    },
    dispose() {
      if (interact) {
        for (const L of LANDMARKS) interact.remove && interact.remove(L.id);
        for (const p of PLOTS) interact.remove && interact.remove(p.id);
      }
      if (colliders && colliders.removeWhere) colliders.removeWhere((c) => c.tag === 'hub');
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    },
  };
  return api;
}
