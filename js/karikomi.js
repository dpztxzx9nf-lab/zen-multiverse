// Clipped azalea mounds (satsuki karikomi), the way they read in a real Japanese garden: a dark,
// twiggy interior under a dense skin of small glossy leaves, sheared into soft cloud domes of one to
// three lobes. The skin is thousands of small sprig cards (painted atlas: leaves, or leaves with
// pink-magenta blossoms in late spring) laid on the clipped surface with normals from the surface,
// so the mound shades as a volume while its silhouette and close-up stay leafy.
//   const k = createKarikomi(scene, { P, sway, season, spots: [[x, z, scale], ...], flowering: (i) => bool })
import * as THREE from 'three';
import { mulberry32, mergeGeometries } from './util.js';
import { paint } from './nature.js';

function sprigAtlas() {
  // 2 cells side by side: [0] leafy sprig, [1] sprig with blossoms. 256 px per cell ~ 20 cm
  const S = 256, c = document.createElement('canvas'); c.width = S * 2; c.height = S;
  const g = c.getContext('2d');
  for (let cell = 0; cell < 2; cell++) {
    const rnd = mulberry32(5 + cell * 13);
    g.save(); g.translate(cell * S, 0);
    for (let i = 0; i < 26; i++) {                     // small elliptical leaves, 2-3 cm, radiating
      const a = rnd() * Math.PI * 2, r = 20 + rnd() * 80, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.9;
      const L = 26 + rnd() * 16, W = L * (0.42 + rnd() * 0.1), tone = rnd();
      g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 0.8);
      const gr = g.createLinearGradient(-W / 2, 0, W / 2, 0);
      const base = [34 + tone * 26, 62 + tone * 34, 22 + tone * 12];
      gr.addColorStop(0, `rgb(${base[0] * 0.7},${base[1] * 0.7},${base[2] * 0.7})`);
      gr.addColorStop(0.5, `rgb(${base[0] * 1.15},${base[1] * 1.15},${base[2] * 1.1})`);
      gr.addColorStop(1, `rgb(${base[0] * 0.85},${base[1] * 0.85},${base[2] * 0.85})`);
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, W / 2, L / 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(160,190,110,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -L * 0.45); g.lineTo(0, L * 0.45); g.stroke();
      g.restore();
    }
    if (cell === 1) {
      for (let i = 0; i < 6; i++) {                     // azalea blossoms, 5 petals, 4-5 cm
        const x = 50 + rnd() * (S - 100), y = 50 + rnd() * (S - 100), R = 22 + rnd() * 8, hue = rnd();
        g.save(); g.translate(x, y); g.rotate(rnd() * 6.28);
        for (let p = 0; p < 5; p++) {
          g.rotate((Math.PI * 2) / 5);
          const gr = g.createRadialGradient(0, R * 0.5, 2, 0, R * 0.5, R * 0.6);
          gr.addColorStop(0, hue < 0.5 ? '#f27aa8' : '#e8508a'); gr.addColorStop(1, hue < 0.5 ? '#d9457e' : '#c22e6a');
          g.fillStyle = gr; g.beginPath(); g.ellipse(0, R * 0.5, R * 0.36, R * 0.55, 0, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#7a1c40'; g.beginPath(); g.arc(0, 0, 3, 0, 6.28); g.fill();
        g.restore();
      }
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createKarikomi(scene, { P, sway, season, spots, flowering = () => false, seed = 808 }) {
  const rnd = mulberry32(seed), S = season.season, pc = P.cls === 'pc';
  const perM2 = pc ? 190 : 80; // cards per square metre of clipped surface
  const card = new THREE.PlaneGeometry(1, 1);
  const parts = [], cores = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  const n = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const autumnRed = S === 'autumn' ? 0.18 : S === 'winter' ? 0.08 : 0;
  spots.forEach(([x, z, s], si) => {
    const flow = flowering(si);
    // one to three overlapping clipped lobes
    const lobes = [{ c: new THREE.Vector3(0, 0, 0), r: new THREE.Vector3(0.95, 0.5 + rnd() * 0.12, 0.85) }];
    const extra = rnd() < 0.55 ? (rnd() < 0.4 ? 2 : 1) : 0;
    for (let e = 0; e < extra; e++) {
      const a = rnd() * 6.28, k = 0.55 + rnd() * 0.25;
      lobes.push({ c: new THREE.Vector3(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.7), r: new THREE.Vector3(0.95 * k, 0.62 * k * (0.85 + rnd() * 0.3), 0.85 * k) });
    }
    const yaw = rnd() * 6.28, sc = s;
    const toW = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(sc).add(new THREE.Vector3(x, -0.05 * sc, z));
    const inside = (pt, skip) => lobes.some((L, li) => li !== skip && ((pt.x - L.c.x) / L.r.x) ** 2 + ((pt.y - L.c.y) / L.r.y) ** 2 + ((pt.z - L.c.z) / L.r.z) ** 2 < 0.97);
    lobes.forEach((L, li) => {
      // dark core: the twiggy shadowed interior seen through gaps
      const core = new THREE.SphereGeometry(1, pc ? 16 : 10, pc ? 10 : 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
      core.scale(L.r.x * 0.86, L.r.y * 0.86, L.r.z * 0.86).translate(L.c.x, L.c.y, L.c.z);
      core.rotateY(yaw).scale(sc, sc, sc).translate(x, -0.05 * sc, z);
      cores.push(core);
      const area = 2 * Math.PI * ((L.r.x * L.r.z + L.r.x * L.r.y + L.r.z * L.r.y) / 3) * sc * sc;
      const N = Math.round(area * perM2);
      for (let i = 0; i < N; i++) {
        // random direction on the upper ~70% of the ellipsoid
        let dx, dy, dz, d2;
        do { dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1; d2 = dx * dx + dy * dy + dz * dz; } while (d2 > 1 || d2 < 0.01);
        const dl = Math.sqrt(d2); dx /= dl; dy /= dl; dz /= dl;
        if (dy < -0.25) dy = -dy * 0.3;
        p.set(L.c.x + dx * L.r.x, L.c.y + dy * L.r.y, L.c.z + dz * L.r.z);
        if (inside(p, li)) continue;
        // hand-shearing is never perfect: low-frequency lumps over the dome
        const lump = 1 + 0.07 * Math.sin(dx * 4.1 + si) * Math.sin(dz * 3.7 + dy * 2.3 + si * 1.7) + 0.04 * Math.sin(dy * 6.0 + dx * 5.0);
        p.set(L.c.x + dx * L.r.x * lump, L.c.y + dy * L.r.y * lump, L.c.z + dz * L.r.z * lump);
        n.set(dx / L.r.x, dy / L.r.y, dz / L.r.z).normalize();
        p.addScaledVector(n, (rnd() - 0.4) * 0.05);  // shear depth jitter: clipped but leafy
        const wp = toW(p.clone()), wn = n.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        q.setFromUnitVectors(Z, wn.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5)).normalize());
        qz.setFromAxisAngle(Z, rnd() * 6.28); q.multiply(qz);
        const cs = (0.17 + rnd() * 0.08) * Math.min(1.2, 0.75 + sc * 0.25);
        m4.compose(wp, q, new THREE.Vector3(cs, cs, cs));
        const g = card.clone().applyMatrix4(m4);
        const fl = flow && rnd() < 0.6;
        const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + (fl ? 0.5 : 0));
        const nr = g.attributes.normal; for (let k = 0; k < nr.count; k++) nr.setXYZ(k, wn.x, wn.y, wn.z);
        // per-card tint: sun-bleached tops, a few reddened leaves in autumn/winter
        const top = Math.max(0, wn.y);
        if (!fl && rnd() < autumnRed) col.setRGB(1.5, 0.75, 0.45); else col.setRGB(0.95 + top * 0.25, 1.0 + top * 0.2, 0.85 + top * 0.05);
        col.multiplyScalar(0.82 + rnd() * 0.3);
        const cl = new Float32Array(uv.count * 3); for (let k = 0; k < uv.count; k++) { cl[k * 3] = col.r; cl[k * 3 + 1] = col.g; cl[k * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
        parts.push(g);
      }
    });
  });
  const leafMat = paint(new THREE.MeshStandardMaterial({ map: sprigAtlas(), vertexColors: true }), { leaf: true, sway, swayH: 1.6, swayAmp: 0.035 });
  leafMat.roughness = 0.55; leafMat.envMapIntensity = 0.7; // satsuki leaves are glossy
  const skin = new THREE.Mesh(mergeGeometries(parts), leafMat);
  skin.castShadow = true; skin.receiveShadow = true; skin.name = 'karikomi';
  const coreMat = new THREE.MeshStandardMaterial({ color: S === 'winter' ? '#1d2414' : '#17240f', roughness: 1 });
  const core = new THREE.Mesh(mergeGeometries(cores), coreMat);
  core.castShadow = true; core.receiveShadow = true;
  // the dense dark core is what stops you (js/solids-bake.js); the leaf skin over it is just leaves
  core.userData.phys = { k: 'solid', name: 'clipped azaleas' }; skin.userData.phys = { k: 'pass', why: 'leaf skin over the solid core' };
  scene.add(skin, core);
  return { skin, core, count: parts.length };
}
