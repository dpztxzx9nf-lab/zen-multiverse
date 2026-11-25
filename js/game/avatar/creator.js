// Character studio: shown once on the first game launch (skippable) and from the Bag's "You" tab /
// the pause menu (avatarApi.openCreator()). Its own small canvas + studio light; edits a working copy
// and writes the appearance (garden-save slice 'avatar') only on Done.
import * as THREE from 'three';
import { createAvatar } from './avatar.js';
import { EMOTES } from './anim.js';
import {
  appearance, sanitize, encode, decode, randomLook, SKIN_TONES, HAIR_COLORS, EYE_COLORS, HAIRS, HAIR_LABEL, OUTFITS, OUTFIT_LABEL,
  ACCS, ACC_LABEL, DYE_SLOTS, PALETTE,
} from './appearance.js';

const CSS = `
#av-creator{position:fixed;inset:0;z-index:60;display:flex;color:#efe6d2;font:15px/1.35 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
 background:radial-gradient(120% 90% at 65% 40%,#3a4038 0%,#1d2220 55%,#121514 100%);opacity:0;transition:opacity .5s}
#av-creator.on{opacity:1}
#av-creator canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}
#av-creator .side{position:relative;z-index:1;margin:18px;width:min(380px,92vw);max-height:calc(100% - 36px);display:flex;flex-direction:column;
 background:linear-gradient(162deg,rgba(34,37,33,.78),rgba(14,17,17,.84));border:1px solid rgba(236,222,196,.17);border-radius:30px 24px 32px 26px / 26px 32px 24px 30px;box-shadow:0 18px 50px rgba(0,0,0,.4)}
#av-creator h2{font-weight:400;font-size:22px;margin:18px 22px 2px;letter-spacing:.02em}
#av-creator .sub{opacity:.65;margin:0 22px 8px;font-size:14px}
#av-creator .tabs{display:flex;gap:2px;padding:0 14px;border-bottom:1px solid rgba(236,222,196,.08);flex-wrap:wrap}
#av-creator .tab{padding:8px 10px 10px;opacity:.6;cursor:pointer}
#av-creator .tab.on{opacity:1;box-shadow:inset 0 -2px 0 rgba(234,220,191,.75)}
#av-creator .body{overflow:auto;padding:6px 20px 14px;flex:1}
#av-creator h4{font-weight:400;font-size:14px;opacity:.72;margin:14px 0 8px}
#av-creator .chips{display:flex;flex-wrap:wrap;gap:6px}
#av-creator .chip{cursor:pointer;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.08);font-size:14px}
#av-creator .chip.on{background:rgba(255,236,200,.22);box-shadow:inset 0 0 0 1px rgba(255,230,190,.5)}
#av-creator .chip.off{opacity:.35;pointer-events:none}
#av-creator .sw{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
#av-creator .s{width:24px;height:24px;border-radius:50%;cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.45)}
#av-creator .s.on{box-shadow:0 0 0 2px #f4e3c2}
#av-creator input[type=color]{width:30px;height:26px;border:0;padding:0;background:none;cursor:pointer}
#av-creator input[type=range]{width:100%;accent-color:#e9d2a8}
#av-creator .row{display:flex;align-items:center;gap:10px;margin:4px 0}
#av-creator .row span{width:70px;opacity:.75;font-size:14px}
#av-creator .foot{display:flex;gap:8px;padding:12px 16px 16px;flex-wrap:wrap;border-top:1px solid rgba(236,222,196,.08)}
#av-creator button{font:inherit;cursor:pointer;border:0;border-radius:16px 13px 17px 12px / 12px 17px 13px 16px;padding:8px 16px;background:rgba(239,230,210,.1);color:#efe6d2;box-shadow:inset 0 0 0 1px rgba(236,222,196,.2)}
#av-creator button.main{background:#efe6d2;color:#141816;margin-left:auto}
#av-creator .code{width:100%;margin-top:8px;font:12px ui-monospace,Menlo,monospace;color:#f4f1ea;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:7px 9px}
#av-creator .poses{position:absolute;z-index:1;right:20px;bottom:18px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:50vw}
#av-creator .hint{position:absolute;z-index:1;right:24px;top:20px;opacity:.5;font-size:13px}
@media (max-width:700px){#av-creator{flex-direction:column;justify-content:flex-end}#av-creator .side{width:auto;max-height:56%;margin:10px}#av-creator .poses{top:14px;bottom:auto;left:14px;right:14px;max-width:none;justify-content:flex-start}#av-creator .hint{display:none}}
`;
let open = null;
export function openCreator({ firstRun = false, api = null } = {}) {
  if (open) return open.promise;
  if (!document.getElementById('av-creator-css')) { const st = document.createElement('style'); st.id = 'av-creator-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.id = 'av-creator';
  const canvas = document.createElement('canvas'); root.appendChild(canvas);
  const side = document.createElement('div'); side.className = 'side'; root.appendChild(side);
  const poses = document.createElement('div'); poses.className = 'poses'; root.appendChild(poses);
  const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Drag to turn · scroll to come closer'; root.appendChild(hint);
  document.body.appendChild(root); requestAnimationFrame(() => root.classList.add('on'));
  const player = api && api.player; if (player && player.setEnabled) player.setEnabled(false);
  let work = sanitize(JSON.parse(JSON.stringify(appearance.get())));
  // ---- studio
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight('#f3ead8', '#3b4237', 1.1));
  const key = new THREE.DirectionalLight('#fff1dc', 2.6); key.position.set(2.2, 3.6, 2.6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.2, bottom: -0.2, near: 0.5, far: 10 }); key.shadow.bias = -0.0004; scene.add(key);
  const rim = new THREE.DirectionalLight('#bcd4ff', 1.6); rim.position.set(-2.5, 2.4, -2.8); scene.add(rim);
  const fill = new THREE.DirectionalLight('#ffe2c6', 0.5); fill.position.set(-2, 1, 3); scene.add(fill);
  // a raked-gravel stone dais
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.08, 64), new THREE.MeshStandardMaterial({ color: '#77746b', roughness: 0.9 }));
  dais.position.y = -0.04; dais.receiveShadow = true; scene.add(dais);
  const sand = new THREE.Mesh(new THREE.RingGeometry(0.92, 3.6, 64), new THREE.MeshStandardMaterial({ color: '#4a4b44', roughness: 1 }));
  sand.rotation.x = -Math.PI / 2; sand.position.y = -0.075; sand.receiveShadow = true; scene.add(sand);
  const av = createAvatar({ scene, look: work, world: 'earth', P: { cls: 'pc' }, local: true });
  let yaw = 0.5, dist = 4.3, focusY = 1.0, spin = 0, dragging = false, lx = 0;
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h;
    cam.fov = w < 700 ? 38 : 30; cam.updateProjectionMatrix();
  };
  resize(); addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { yaw -= (e.clientX - lx) * 0.01; lx = e.clientX; spin = 0; } });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => { dist = THREE.MathUtils.clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), 1.4, 6); focusY = THREE.MathUtils.lerp(1.55, 1.0, (dist - 1.4) / 2.9); }, { passive: true });
  const wide = () => root.clientWidth >= 700;
  let last = performance.now(), raf = 0;
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t; spin = Math.min(1, spin + dt * 0.2);
    if (!dragging) yaw += dt * 0.18 * spin;
    av.update(dt);
    const ox = wide() ? -0.55 * (dist / 4.3) : 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    cam.position.set(fx * dist + fz * ox, focusY + 0.15 + dist * 0.06, fz * dist - fx * ox);
    cam.lookAt(fz * ox, focusY, -fx * ox);
    renderer.render(scene, cam);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  // ---- panel
  let tab = 'body';
  const TABS = [['body', 'Body'], ['hair', 'Hair & face'], ['outfit', 'Outfit'], ['dye', 'Colours'], ['extra', 'Extras']];
  const swatches = (list, cur, cb) => {
    const w = document.createElement('div'); w.className = 'sw';
    for (const c of list) { const s = document.createElement('div'); s.className = 's' + (c === cur ? ' on' : ''); s.style.background = c; s.title = c; s.onclick = () => cb(c); w.appendChild(s); }
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = cur; inp.oninput = () => cb(inp.value, true); w.appendChild(inp);
    return w;
  };
  const chips = (list, cur, label, cb, off = () => false) => {
    const w = document.createElement('div'); w.className = 'chips';
    for (const v of list) { const c = document.createElement('div'); c.className = 'chip' + (v === cur ? ' on' : '') + (off(v) ? ' off' : ''); c.textContent = label(v); c.onclick = () => cb(v); w.appendChild(c); }
    return w;
  };
  const h4 = (t) => { const e = document.createElement('h4'); e.textContent = t; return e; };
  const slider = (label, v, cb) => {
    const r = document.createElement('div'); r.className = 'row'; const s = document.createElement('span'); s.textContent = label;
    const i = document.createElement('input'); i.type = 'range'; i.min = 0; i.max = 1; i.step = 0.01; i.value = v; i.oninput = () => cb(+i.value); r.append(s, i); return r;
  };
  function change(patch, rerender = true) {
    work = sanitize({ ...work, ...patch, acc: { ...work.acc, ...(patch.acc || {}) }, dyes: { ...work.dyes, ...(patch.dyes || {}) } });
    av.setLook(work); if (rerender) render();
  }
  function render() {
    side.innerHTML = '';
    const t = document.createElement('h2'); t.textContent = firstRun ? 'Who walks this garden?' : 'Character studio';
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = firstRun ? 'Shape your wanderer. You can change everything later from the Bag.' : 'Changes show on you everywhere, and to other players.';
    const tabs = document.createElement('div'); tabs.className = 'tabs';
    for (const [id, l] of TABS) { const e = document.createElement('div'); e.className = 'tab' + (id === tab ? ' on' : ''); e.textContent = l; e.onclick = () => { tab = id; render(); }; tabs.appendChild(e); }
    const b = document.createElement('div'); b.className = 'body';
    if (tab === 'body') {
      b.append(h4('Body'), chips(['f', 'm'], work.body, (v) => (v === 'f' ? 'Body one' : 'Body two'), (v) => change({ body: v })));
      b.append(slider('Height', work.height, (v) => change({ height: v }, false)), slider('Build', work.build, (v) => change({ build: v }, false)));
      b.append(h4('Skin'), swatches(SKIN_TONES, work.skin, (c, live) => change({ skin: c }, !live)));
    } else if (tab === 'hair') {
      b.append(h4('Hair'), chips(HAIRS, work.hair, (v) => HAIR_LABEL[v], (v) => change({ hair: v })));
      b.append(h4('Hair colour'), swatches(HAIR_COLORS, work.hairColor, (c, live) => change({ hairColor: c }, !live)));
      b.append(h4('Face'), chips(['beard', 'brows'], null, (v) => (v === 'beard' ? (work.beard ? '✓ Beard' : 'Beard') : (work.brows ? '✓ Brows' : 'Brows')), (v) => change({ [v]: !work[v] })));
      b.append(h4('Eyes'), swatches(EYE_COLORS, work.eyes, (c, live) => change({ eyes: c }, !live)));
    } else if (tab === 'outfit') {
      b.append(h4('Wear'), chips(OUTFITS, work.outfit, (v) => OUTFIT_LABEL[v], (v) => change({ outfit: v })));
      b.append(h4('On the Moon'), chips(['auto'], null, () => (work.autoSuit ? '✓ Space suit on automatically' : 'Space suit on automatically'), () => change({ autoSuit: !work.autoSuit })));
    } else if (tab === 'dye') {
      const o = work.outfit; const slots = DYE_SLOTS[o];
      b.append(h4(OUTFIT_LABEL[o]));
      slots.forEach((label, i) => { b.append(h4(label), swatches(PALETTE, work.dyes[o][i], (c, live) => { const d = work.dyes[o].slice(); d[i] = c; change({ dyes: { [o]: d } }, !live); })); });
    } else if (tab === 'extra') {
      b.append(h4('Accessories'), chips(ACCS, null, (v) => (work.acc[v] ? '✓ ' : '') + ACC_LABEL[v], (v) => change({ acc: { [v]: !work.acc[v] } }), (v) => (v === 'hood' && work.outfit !== 'expl') || (work.outfit === 'suit' && v !== 'hood')));
      b.append(h4('Share this look'));
      const code = document.createElement('input'); code.className = 'code'; code.value = encode(work); code.onfocus = () => code.select();
      code.onchange = () => { const d = decode(code.value.trim()); if (d) change(d); };
      b.append(code);
    }
    const foot = document.createElement('div'); foot.className = 'foot';
    const rnd = document.createElement('button'); rnd.textContent = 'Surprise me'; rnd.onclick = () => change(randomLook());
    const done = document.createElement('button'); done.className = 'main'; done.textContent = firstRun ? 'Begin' : 'Done'; done.onclick = () => close(true);
    foot.append(rnd);
    if (firstRun) { const skip = document.createElement('button'); skip.textContent = 'Skip'; skip.onclick = () => close('skip'); foot.append(skip); }
    else { const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => close(false); foot.append(cancel); }
    foot.append(done);
    side.append(t, sub, tabs, b, foot);
  }
  render();
  for (const e of ['wave', ...EMOTES.filter((x) => x !== 'wave' && x !== 'talk')]) {
    const c = document.createElement('button'); c.textContent = { wave: 'Wave', yes: 'Nod', no: 'No', dance: 'Dance', fold: 'Fold arms', focus: 'Breathe', sit: 'Sit', drink: 'Tea' }[e] || e;
    c.onclick = () => { for (const L of [...(av.anim ? av.anim.layers.keys() : [])]) av.stop(L); av.play(e, e === 'dance' || e === 'sit' || e === 'fold' || e === 'focus' ? { loop: false } : {}); };
    poses.appendChild(c);
  }
  let resolveP;
  const promise = new Promise((r) => { resolveP = r; });
  function close(ok) {
    if (ok === true) appearance.set({ ...work, created: true });
    else if (ok === 'skip') appearance.set({ created: true });
    cancelAnimationFrame(raf); removeEventListener('resize', resize);
    root.classList.remove('on');
    setTimeout(() => { av.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); root.remove(); }, 450);
    if (player && player.setEnabled) player.setEnabled(true);
    open = null; resolveP(ok);
  }
  const onKey = (e) => { if (e.code === 'Escape' && open) { e.stopPropagation(); close(firstRun ? 'skip' : false); } };
  addEventListener('keydown', onKey, { capture: true, once: false });
  promise.then(() => removeEventListener('keydown', onKey, { capture: true }));
  open = { promise, close, avatar: av, root, get work() { return work; }, setTab(t) { tab = t; render(); }, change };
  if (api) api.creator = open;
  return promise;
}
export function creatorOpen() { return open; }
