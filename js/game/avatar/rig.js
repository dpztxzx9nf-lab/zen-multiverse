// Loads the avatar bodies (assets/char/avatar_<f|m>.glb: Quaternius Universal Base Characters + Modular
// Outfits, CC0, rebuilt in Blender by mom-garden-tools/char/build_char.py) and the shared animation library
// (avatar_anims.glb: Quaternius Universal Animation Library 1 + 2, CC0). Every wearable is skinned to the one
// skeleton; materials take the appearance through small shader hooks (skin tone, hair colour, outfit dyes,
// cover mask so skin never pokes through clothes, first-person head hiding that still casts a shadow).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const url = (f) => new URL(`../../../assets/char/${f}`, import.meta.url).href;
const cache = new Map();
function loadGltf(f) {
  if (!cache.has(f)) cache.set(f, new Promise((res, rej) => loader.load(url(f), res, undefined, rej)));
  return cache.get(f);
}
const texCache = new Map(), texReady = new Map();
function loadTex(f) {
  if (!texCache.has(f)) {
    let done; texReady.set(f, new Promise((r) => { done = r; }));
    const t = new THREE.TextureLoader().load(url(f), () => done(), undefined, () => done());
    t.flipY = false; t.colorSpace = THREE.NoColorSpace; texCache.set(f, t);
  }
  return texCache.get(f);
}
// the avatar is ready once the meshes, clips and dye masks are in (so the first frame already wears its colours)
export function preloadAvatar(body = 'f') {
  loadTex('dye_robe.webp'); loadTex('dye_expl.webp');
  return Promise.all([loadGltf(`avatar_${body}.glb`), loadGltf('avatar_anims.glb'), texReady.get('dye_robe.webp'), texReady.get('dye_expl.webp')]);
}

// linear means of the authored textures (see build notes) -> tint ratios
const REF = { skin: [0.40, 0.196, 0.10], skin_alt: [0.375, 0.17, 0.078], hair: [0.28, 0.284, 0.27] };
const DYE_MEAN = { // sRGB means of the dye mask families (char/dye/means.json)
  robe: ['#25180b', '#51381c', '#918b72'], expl: ['#5b3c23', '#526147', '#0b200f'],
};
const lin = (hex) => new THREE.Color(hex); // THREE.Color(hex) is already linear in r152+ colour management

// ---- shader hooks (one program per kind, shared by every avatar)
const HOOK = {
  common: `
    uniform float uFP; uniform vec4 uCover; varying vec4 vMask; varying float vBase; varying float vHeadPart; uniform vec4 uCut; varying vec3 vFpW;`,
};
function hook(m, kind, U) {
  m.userData.kind = kind; m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const isBody = kind === 'skin';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      ${isBody ? 'attribute vec4 mask; attribute float baseL;' : ''} varying vec4 vMask; varying float vBase; uniform float uHeadPart; varying float vHeadPart; varying vec3 vFpW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vMask = ${isBody ? 'mask' : 'vec4(0.0)'}; vBase = ${isBody ? 'baseL' : '0.0'}; vHeadPart = uHeadPart;`)
      // world position after skinning, for the first-person cut around the eye
      .replace('#include <project_vertex>', `#include <project_vertex>
      vFpW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>
      ${HOOK.common} uniform vec3 uTint; uniform vec3 uDye0; uniform vec3 uDye1; uniform vec3 uDye2; uniform vec3 uEye; uniform sampler2D uDyeMask;`);
    fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uFP > 0.5 && (vHeadPart > 0.5 || vMask.a > 0.5)) discard;
      if (uCut.w > 0.0 && distance(vFpW, uCut.xyz) < uCut.w) discard; // first person: nothing of her own body right around the eye (no inside of the neck or shoulders)
      if (dot(vMask.rgb, uCover.rgb) > 0.5) discard;`);
    let col = '';
    if (kind === 'skin') col = 'diffuseColor.rgb *= uTint; if (uCover.a > 0.5 && vBase > 0.5) diffuseColor.rgb = vec3(0.30, 0.29, 0.27);'; // base layer: plain soft grey
    else if (kind === 'skin_alt') col = 'diffuseColor.rgb *= uTint;';
    else if (kind === 'hair') col = 'diffuseColor.rgb = uTint * (dot(diffuseColor.rgb, vec3(0.333)) / 0.28);';
    else if (kind === 'eyes') col = 'float sat = smoothstep(0.04, 0.16, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))); diffuseColor.rgb = mix(diffuseColor.rgb, uEye * (dot(diffuseColor.rgb, vec3(0.333)) / 0.2), sat);';
    else if (kind === 'robe' || kind === 'expl') col = `vec3 dm = texture2D(uDyeMask, vMapUv).rgb; diffuseColor.rgb *= vec3(1.0) + dm.r * (uDye0 - 1.0) + dm.g * (uDye1 - 1.0) + dm.b * (uDye2 - 1.0);`;
    else if (kind === 'suit') col = `vec3 vc = diffuseColor.rgb; float accent = step(0.25, vc.r - vc.b); float lum = dot(vc, vec3(0.333)); float shell = (1.0 - accent) * step(0.5, lum); float pads = (1.0 - accent) * (1.0 - shell) * step(0.22, lum);
      diffuseColor.rgb = vc * (vec3(1.0) + shell * (uDye0 - 1.0) + accent * (uDye1 - 1.0) + pads * (uDye2 - 1.0));`;
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + col);
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'avatar-' + kind;
}
function uniforms() {
  return {
    uFP: { value: 0 }, uCut: { value: new THREE.Vector4() }, uCover: { value: new THREE.Vector4() }, uHeadPart: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
    uDye0: { value: new THREE.Color(1, 1, 1) }, uDye1: { value: new THREE.Color(1, 1, 1) }, uDye2: { value: new THREE.Color(1, 1, 1) },
    uEye: { value: new THREE.Color(0.2, 0.12, 0.06) }, uDyeMask: { value: null },
  };
}
const KIND = (name) => {
  const n = (name || '').toLowerCase();
  for (const k of ['skin_alt', 'skin', 'eyes', 'brow', 'hair', 'robe', 'expl', 'suitmetal', 'suitpack', 'suit', 'glass', 'canvas', 'roll', 'straw']) if (n.startsWith(k)) return k;
  return 'other';
};
// body cover mask: rgb from COLOR_0 (robe / explorer / suit cover), a = head + neck from the skin weights (first-person cut)
// base layer (from the skin weights too): torso and pelvis + upper legs = a plain tank top and shorts
function baseAttr(o) {
  const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const names = o.skeleton.bones.map((b) => b.name);
  const ids = new Set(['pelvis', 'spine_01', 'spine_02', 'spine_03', 'thigh_l', 'thigh_r'].map((n) => names.indexOf(n)).filter((i) => i >= 0));
  const a = new Float32Array(g.attributes.position.count);
  for (let i = 0; i < a.length; i++) { let w = 0; for (let k = 0; k < 4; k++) if (ids.has(si.getComponent(i, k))) w += sw.getComponent(i, k); a[i] = w > 0.55 ? 1 : 0; }
  return new THREE.BufferAttribute(a, 1);
}
function maskAttr(o) {
  const g = o.geometry, c = g.attributes.color, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const names = o.skeleton.bones.map((b) => b.name); const hi = names.indexOf('Head'), ni = names.indexOf('neck_01');
  const a = new Float32Array(g.attributes.position.count * 4);
  for (let i = 0; i < g.attributes.position.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k); if (b === hi) w += sw.getComponent(i, k); else if (b === ni) w += sw.getComponent(i, k) * 0.6; }
    a[i * 4] = c ? c.getX(i) : 0; a[i * 4 + 1] = c ? c.getY(i) : 0; a[i * 4 + 2] = c ? c.getZ(i) : 0; a[i * 4 + 3] = w > 0.5 ? 1 : 0;
  }
  return new THREE.BufferAttribute(a, 4);
}
const HEAD_PARTS = /^(hair_|brows|eyes|acc_kasa|acc_hood|suit_helmet)/;

// one avatar instance: { root, skeleton, bones, parts: { name: [lod0, lod1, lod2] }, setLook(d, ctx), setLod(i), setFP(on) }
export async function buildRig(body) {
  const [g] = await preloadAvatar(body);
  const root = cloneSkinned(g.scene);
  root.name = 'avatar-' + body;
  const parts = {}; const mats = new Map(); const bones = {};
  let skeleton = null;
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isSkinnedMesh) return;
    skeleton = skeleton || o.skeleton;
    o.frustumCulled = false; // skinned bounds don't follow the animation
    o.castShadow = true; o.receiveShadow = true;
    // a mesh with two materials loads as a Group (node name) holding one SkinnedMesh per primitive
    const nm = o.parent && o.parent.type === 'Group' && !o.parent.isBone && o.parent !== root && o.parent.children.every((c) => c.isMesh) ? o.parent.name : o.name;
    const m = /^(.*?)(?:_lod(\d))?$/.exec(nm.replace(/\.\d+$/, ''));
    const base = m[1], li = +(m[2] || 0);
    const slot = (parts[base] = parts[base] || []);
    if (slot[li]) { if (!slot[li].isGroupProxy) { const g = { isGroupProxy: true, list: [slot[li]] }; slot[li] = g; } slot[li].list.push(o); } else slot[li] = o;
    // per-instance materials
    const src = o.material; const k = KIND(src.name);
    const key = src.uuid;
    if (!mats.has(key)) {
      let mm = src.clone();
      if (k === 'glass') { mm = new THREE.MeshStandardMaterial({ color: '#dfeeff', roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.6 }); }
      if (k === 'skin' || k === 'skin_alt' || k === 'hair' || k === 'eyes' || k === 'brow') { mm.metalness = 0; mm.metalnessMap = null; }
      if (k === 'skin' || k === 'skin_alt') { mm.roughness = 0.62; }
      if (k === 'robe' || k === 'expl') { mm.metalness = 0; mm.metalnessMap = null; }
      mm.vertexColors = false; // only the space suit is painted per vertex (the body's COLOR_0 is its cover mask)
      if (k === 'suit') { mm.vertexColors = true; mm.roughness = 0.72; }
      const U = uniforms();
      if (k === 'robe' || k === 'expl') U.uDyeMask.value = loadTex(`dye_${k}.webp`);
      hook(mm, k === 'brow' ? 'hair' : k, U);
      mats.set(key, mm);
    }
    o.material = mats.get(key);
    if (k === 'skin' && !o.geometry.attributes.mask) { o.geometry.setAttribute('mask', maskAttr(o)); o.geometry.setAttribute('baseL', baseAttr(o)); }
    if (o.geometry.attributes.color && KIND(src.name) !== 'suit') o.geometry.deleteAttribute('color');
  });
  // head parts hide in first person through a per-part uniform (cloned material per head part kind)
  for (const [name, lods] of Object.entries(parts)) {
    if (!HEAD_PARTS.test(name)) continue;
    for (const o of lods.flatMap((x) => (x && x.isGroupProxy ? x.list : [x]))) {
      if (!o) continue;
      if (!o.material.userData.headClone) {
        const src = o.material; const c = src.clone(); c.onBeforeCompile = src.onBeforeCompile; c.customProgramCacheKey = src.customProgramCacheKey;
        const U = { ...src.userData.U, uHeadPart: { value: 1 } }; c.userData = { kind: src.userData.kind, U, headClone: true };
        c.onBeforeCompile = (sh) => { src.onBeforeCompile(sh); Object.assign(sh.uniforms, U); };
        o.material = c;
      }
    }
  }
  const allMats = new Set(); root.traverse((o) => { if (o.isSkinnedMesh) allMats.add(o.material); });
  const restHead = new THREE.Vector3(); root.updateMatrixWorld(true); bones.Head.getWorldPosition(restHead);
  let lod = 0, fp = false, look = null, worn = new Set();
  const visibleFor = (name, d, outfit) => {
    if (name === 'body' || name === 'eyes') return true;
    if (name === 'brows') return d.brows;
    if (name.startsWith('hair_')) {
      const h = name.slice(5);
      if (h === 'beard') return d.beard;
      if (outfit === 'suit' && h === 'long') return true;
      if (d.acc.hood && outfit === 'expl' && (h === 'buns' || h === 'long')) return false;
      return h === d.hair;
    }
    if (name.startsWith('robe_')) return outfit === 'robe';
    if (name.startsWith('expl_')) return outfit === 'expl';
    if (name.startsWith('suit_')) return outfit === 'suit';
    if (name === 'acc_kasa') return d.acc.kasa && outfit !== 'suit' && !(d.acc.hood && outfit === 'expl');
    if (name === 'acc_hood') return d.acc.hood && outfit === 'expl';
    if (name === 'acc_pauldron') return d.acc.pauldron && outfit !== 'suit';
    if (name === 'acc_pack' || name === 'acc_roll') return d.acc.pack && outfit !== 'suit';
    return false;
  };
  const setVis = (o, v) => { if (o.isGroupProxy) for (const x of o.list) x.visible = v; else o.visible = v; };
  function applyVisibility() {
    for (const [name, lods] of Object.entries(parts)) {
      const on = worn.has(name);
      for (let i = 0; i < lods.length; i++) if (lods[i]) setVis(lods[i], false);
      if (!on) continue;
      // fall back to the nearest LOD that exists
      let i = Math.min(lod, lods.length - 1); while (i > 0 && !lods[i]) i--;
      if (lod >= 2 && /^(brows|eyes)$/.test(name)) continue;
      if (lods[i]) setVis(lods[i], true);
    }
  }
  const tmpC = new THREE.Color();
  const ratio = (hex, ref, out) => { tmpC.set(hex); return out.setRGB(tmpC.r / ref[0], tmpC.g / ref[1], tmpC.b / ref[2]); };
  const rig = {
    root, bones, skeleton, parts, body, restHead, mats: allMats,
    get lod() { return lod; },
    get outfit() { return look ? look.outfit : null; },
    setLook(d, { world = null } = {}) {
      look = d;
      const outfit = d.outfit;
      look = { ...d, outfit };
      worn = new Set(Object.keys(parts).filter((n) => visibleFor(n, d, outfit)));
      applyVisibility();
      const cover = outfit === 'robe' ? [1, 0, 0] : outfit === 'expl' ? [0, 1, 0] : outfit === 'suit' ? [0, 0, 1] : [0, 0, 0];
      for (const m of allMats) {
        const U = m.userData.U; if (!U) continue; const k = m.userData.kind;
        U.uCover.value.set(cover[0], cover[1], cover[2], outfit === 'base' ? 1 : 0);
        if (k === 'skin') ratio(d.skin, [REF.skin[0] * 1.2, REF.skin[1] * 1.2, REF.skin[2] * 1.2], U.uTint.value);
        if (k === 'skin_alt') ratio(d.skin, [REF.skin_alt[0] * 1.2, REF.skin_alt[1] * 1.2, REF.skin_alt[2] * 1.2], U.uTint.value);
        if (k === 'hair') U.uTint.value.set(d.hairColor);
        if (k === 'eyes') U.uEye.value.set(d.eyes);
        if (k === 'robe' || k === 'expl') {
          const dy = d.dyes[k], mean = DYE_MEAN[k];
          [U.uDye0, U.uDye1, U.uDye2].forEach((u, i) => { const a = lin(dy[i]), b = lin(mean[i]); u.value.setRGB(a.r / Math.max(b.r, 0.004), a.g / Math.max(b.g, 0.004), a.b / Math.max(b.b, 0.004)); });
        }
        if (k === 'suit') {
          const dy = d.dyes.suit, base = ['#ecebe6', '#c8643c', '#9a968e'];
          [U.uDye0, U.uDye1, U.uDye2].forEach((u, i) => { const a = lin(dy[i]), b = lin(base[i]); u.value.setRGB(a.r / b.r, a.g / b.g, a.b / b.b); });
        }
      }
      const h = 0.94 + d.height * 0.12, w = 0.95 + d.build * 0.1;
      root.scale.set(h * w, h, h * w);
      return look;
    },
    setLod(i) { if (i !== lod) { lod = i; applyVisibility(); } },
    setFP(on) { fp = !!on; for (const m of allMats) if (m.userData.U) m.userData.U.uFP.value = fp ? 1 : 0; },
    // a sphere around the eye where her own body isn't drawn (first person); r = 0 turns it off. Shadows keep the whole body.
    setCut(x, y, z, r) { for (const m of allMats) if (m.userData.U && m.userData.U.uCut) m.userData.U.uCut.value.set(x, y, z, r); },
    get fp() { return fp; },
    tris() {
      let t = 0; root.traverse((o) => { if (o.isSkinnedMesh && o.visible) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return t;
    },
    dispose() { root.removeFromParent(); for (const m of allMats) m.dispose(); },
  };
  return rig;
}

// animation clips retargeted onto a body: q_target = rest_target * inverse(rest_source) * q_source
// (local, per joint), pelvis translation scaled by hip height. Cached per body.
const clipCache = new Map();
export async function clipsFor(rig) {
  if (clipCache.has(rig.body)) return clipCache.get(rig.body);
  const p = (async () => {
    const [, A] = await preloadAvatar(rig.body);
    const src = {}; A.scene.traverse((o) => { src[o.name] = o; });
    const out = {};
    const qs = new THREE.Quaternion(), qr = new THREE.Quaternion(), qt = new THREE.Quaternion();
    for (const clip of A.animations) {
      const tracks = [];
      for (const tr of clip.tracks) {
        const [node, prop] = tr.name.split('.');
        const sb = src[node], tb = rig.bones[node];
        if (!sb || !tb) continue;
        if (prop === 'quaternion') {
          const v = tr.values.slice();
          qr.copy(sb.quaternion).invert();
          for (let i = 0; i < v.length; i += 4) {
            qs.fromArray(v, i); qt.copy(tb.quaternion).multiply(qr).multiply(qs).toArray(v, i);
          }
          tracks.push(new THREE.QuaternionKeyframeTrack(tr.name, tr.times, v));
        } else if (prop === 'position' && node === 'pelvis') {
          const k = tb.position.length() / Math.max(1e-4, sb.position.length());
          const v = tr.values.slice(); for (let i = 0; i < v.length; i++) v[i] *= k;
          tracks.push(new THREE.VectorKeyframeTrack(tr.name, tr.times, v));
        }
      }
      out[clip.name] = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    return out;
  })();
  clipCache.set(rig.body, p);
  return p;
}
