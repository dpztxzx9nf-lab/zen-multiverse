// Fishing and spearfishing, simulated: the spear and the bobber are real projectiles (gravity, quadratic
// drag in air and in water, buoyancy), a hooked fish is a body on a line (it swims away with the power it
// has left, the line pulls back as a stiff spring, water drag slows both), and a catch scares the rest of
// the spot (sealife.js keeps a fear map that fades over real hours).
//
//   const fishing = createFishing({ scene, player, sealife, ocean, hud, audio, gravity: () => g, solid, T7 });
//   fishing.update(dt)           every frame (projectiles fly and the line works even with another item held)
//
// Spear (tool 'spear'): tap = thrust (1.7 m reach), hold and release = throw; underwater the arm itself is
// slowed by the water, so a throw leaves the hand slower and the water bleeds its speed away within a few
// metres: lead a moving fish and get close. The spear floats (wood shaft): swim or walk to it to pick it up.
// Rod (tool 'rod'): hold and release to cast (a worm from your bait goes on the hook if you have any);
// wait for a bite, press to set the hook, then hold to haul line in and let go to give line: the fish pulls
// with what strength it has left and tires; past ~32 N the fibre line snaps.
import * as THREE from 'three';
import { equip } from '../equip.js';
import { game } from '../store.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
import { SPEAR, LINE, stepProjectile, stepHooked } from './fishing-phys.js';

export function createFishing({ scene, player, sealife, ocean, hud, audio = null, gravity = () => 9.81, solid = () => false, ground = () => -1e9, T7 = () => ({}), active = () => true, lite = false }) {
  const inv = () => (game.data && game.data.inv) || {};
  const add = (id, n) => game.add(id, n);
  const take = (id, n) => ((inv()[id] || 0) >= n ? game.pay({ [id]: n }) !== false : false);
  const toast = (m, ic = 'fish', ms = 1800) => hud && hud.toast && hud.toast(m, ic, ms);
  const sfx = (k, p) => { try { audio && audio.water && audio.water(k, p); } catch (e) { /* */ } };
  const liq = (x, z) => (ocean ? ocean.liquid(x, z) : null);
  const G = () => gravity() || 9.81;
  const tmpE = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmp = new THREE.Vector3();

  // ---------------- meshes
  const spearMesh = new THREE.Group();
  { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, SPEAR.len, 6), new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.9 }));
    shaft.rotation.x = Math.PI / 2; spearMesh.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.7 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = SPEAR.len / 2 + 0.06; spearMesh.add(tip); }
  spearMesh.visible = false; scene.add(spearMesh);
  const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd84a32, roughness: 0.5 }));
  bobber.visible = false; scene.add(bobber);
  const NL = 14, lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NL * 3), 3));
  const lineMesh = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.75 }));
  lineMesh.frustumCulled = false; lineMesh.visible = false; scene.add(lineMesh);
  // tension meter
  const meter = document.createElement('div'); meter.id = 'zm-line';
  meter.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 150px);transform:translateX(-50%);width:180px;height:8px;border-radius:5px;background:rgba(10,20,25,.45);box-shadow:0 0 0 1px rgba(255,255,255,.25) inset;display:none;z-index:30;pointer-events:none;overflow:hidden';
  meter.innerHTML = '<b style="display:block;height:100%;width:0;background:#9fd6a8;border-radius:5px"></b><i style="position:absolute;left:0;right:0;top:-18px;text-align:center;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000;font-style:normal"></i>';
  document.body.appendChild(meter); const meterBar = meter.firstChild, meterLbl = meter.lastChild;

  // ---------------- spear
  const sp = { state: 'held', p: new THREE.Vector3(), v: new THREE.Vector3(), charge: 0, down: false, downT: 0, flyT: 0, hit: null };
  function spearCtx() { return { g: G(), mass: SPEAR.mass, vol: SPEAR.mass / SPEAR.rho }; }
  function catchFish(f, how) {
    const loot = sealife && sealife.take(f, how); if (!loot) return null;
    add('fish', 1);
    const store = game.data.sea = game.data.sea || {};
    (store.catches = store.catches || []).push({ ...loot, t: Date.now() }); if (store.catches.length > 60) store.catches.splice(0, store.catches.length - 60);
    const cm = Math.round(loot.len * 100), kg = loot.mass < 1 ? Math.round(loot.mass * 1000) + ' g' : loot.mass.toFixed(1) + ' kg';
    toast(`Caught a ${cm} cm ${loot.kind === 'predator' ? 'hunter' : 'fish'} (${kg}). In your bag: cook it, cut it for bait, dry it with salt.`, 'fish', 3600);
    emit('catch', loot); return loot;
  }
  function thrust(ray) {
    tmpE.copy(ray.origin).addScaledVector(ray.dir, ray.start);
    let best = null, bt = 1e9;
    for (const f of sealife ? sealife.fishNear(tmpE, SPEAR.thrust + 1) : []) {
      tmp.subVectors(f.p, tmpE); const t = tmp.dot(ray.dir); if (t < 0 || t > SPEAR.thrust) continue;
      const miss = tmp.addScaledVector(ray.dir, -t).length(); if (miss < f.len * 0.35 + 0.07 && t < bt) { bt = t; best = f; }
    }
    sfx(player.swim && player.swim.headUnder ? 'bubbles' : 'stroke', 0.5);
    if (best) catchFish(best, 'spear'); return !!best;
  }
  function throwSpear(ray, charge) {
    const under = !!(player.swim && player.swim.headUnder);
    // a strong overarm throw is ~16 m/s; under water the arm moves through water and manages ~5
    const v0 = under ? 2.5 + 3 * charge : 7 + 9 * charge;
    tmpE.copy(ray.origin).addScaledVector(ray.dir, ray.start + 0.5);
    sp.p.copy(tmpE); sp.v.copy(ray.dir).multiplyScalar(v0);
    sp.state = 'flying'; sp.flyT = 0; sp.tumbled = false; spearMesh.visible = true; emit('throw', { v0, under });
    sfx(under ? 'bubbles' : 'stroke', 0.6);
  }
  function updateSpear(dt) {
    if (sp.state === 'held') return;
    const p = sp.p;
    if (sp.state === 'flying' || sp.state === 'drift') {
      const n = Math.max(1, Math.ceil((sp.v.length() * dt) / 0.25)); const h = dt / n;
      for (let i = 0; i < n && sp.state !== 'stuck'; i++) {
        const L = liq(p.x, p.z), inW = !!L && p.y < L.surf;
        const wasAbove = sp.wasAbove; sp.wasAbove = !inW;
        if (inW && wasAbove && sp.v.length() > 2) { ocean && ocean.splash && ocean.splash(p.x, L.surf, p.z, 0.6, 0.2); sfx('splash', 0.5); }
        const prev = tmp.copy(p);
        // drag: nose-first it is slender, sideways (once it has slowed and tumbles) it is broad
        if (inW && (sp.v.length() < 2.2 || sp.flyT > 0.7)) sp.tumbled = true; const cda = sp.tumbled ? SPEAR.cdaSide : SPEAR.cdaAxial; // once slowed it turns broadside to its motion and stays that way
        stepProjectile(p, sp.v, h, { ...spearCtx(), rhoFluid: L ? L.rho : 1000, inFluid: inW, cda });
        // floats: settle at the surface
        if (inW && L && p.y > L.surf - 0.03 && sp.v.length() < 1.2) { p.y = L.surf - 0.03; sp.v.y = Math.min(0, sp.v.y); sp.v.x *= 0.98; sp.v.z *= 0.98; sp.state = 'drift'; }
        // fish along the segment from prev to p
        if (sealife && sp.v.length() > 1.0) {
          tmpD.subVectors(p, prev); const segL = tmpD.length(); if (segL > 1e-5) tmpD.divideScalar(segL);
          for (const f of sealife.fishNear(prev, segL + 1.2)) {
            tmpE.subVectors(f.p, prev); const t = clamp(tmpE.dot(tmpD), 0, segL); const miss = tmpE.addScaledVector(tmpD, -t).length();
            if (miss < f.len * 0.35 + 0.05) { catchFish(f, 'spear'); sp.v.multiplyScalar(0.3); break; }
          }
        }
        if (solid(p.x, p.y, p.z)) { p.copy(prev); sp.v.set(0, 0, 0); sp.state = 'stuck'; sfx('stroke', 0.3); }
      }
      sp.flyT += dt;
      if (sp.v.lengthSq() > 0.01) { tmp.copy(p).add(sp.v); spearMesh.position.copy(p); spearMesh.lookAt(tmp); }
      else spearMesh.position.copy(p);
      if (sp.state === 'drift') { const L = liq(p.x, p.z); if (L) { p.y = L.surf - 0.03; const fl = L.flow ? L.flow(p.x, p.y, p.z) : null; if (fl) { p.x += fl[0] * dt; p.z += fl[2] * dt; } } spearMesh.position.copy(p); spearMesh.rotation.x = 0; }
    }
    // pick it up: reach it
    const me = player.position; tmp.set(me.x, me.y + 1.0, me.z);
    if (sp.flyT > 0.8 && sp.v.length() < 1.5 && tmp.distanceTo(p) < 1.5) { sp.state = 'held'; spearMesh.visible = false; toast('Spear back in hand', 'fish', 900); emit('spearBack'); }
  }
  equip.register({ id: 'spear', order: 18, glyph: '🔱', label: () => (sp.state === 'held' ? 'spear' : 'spear (thrown)'),
    available: () => active() && !!(T7().tools && T7().tools.spear),
    primary(down, ray) {
      if (sp.state !== 'held') { if (down) toast('Your spear is out there: go and pick it up', 'fish', 1400); return true; }
      if (down) { sp.down = true; sp.downT = 0; return true; }
      if (!sp.down) return true; sp.down = false;
      if (sp.downT < 0.22) thrust(ray); else throwSpear(ray, clamp((sp.downT - 0.22) / 0.9, 0, 1));
      return true;
    },
    update(dt) { if (sp.down) sp.downT += dt; },
    unequip() { sp.down = false; },
  });

  // ---------------- rod
  const rod = { state: 'idle', p: new THREE.Vector3(), v: new THREE.Vector3(), down: false, downT: 0, baited: false, biteT: 0, nibble: 0, fish: null, line: { len: 0 }, T: 0, waitT: 0, tip: new THREE.Vector3() };
  const tipPos = (out) => { player.eyePos(out); player.aimDir(tmpD); out.addScaledVector(tmpD, 1.0); out.y += 0.35; return out; };
  function cast(charge) {
    rod.baited = take('bait', 1);
    tipPos(rod.p); player.aimDir(tmpD); tmpD.y = Math.max(tmpD.y, -0.1) + 0.35; tmpD.normalize();
    rod.v.copy(tmpD).multiplyScalar(5 + 9 * charge); rod.state = 'flying'; bobber.visible = lineMesh.visible = true; rod.waitT = 0; rod.nibble = 0;
    if (!rod.baited) toast('A bare hook: few fish will take it. Sift soil for worms or cut a fish for bait.', 'fish', 2600);
    emit('cast', { baited: rod.baited });
  }
  function reelEnd(msg) { if (rod.state !== 'idle') { (rod.log = rod.log || []).push({ from: rod.state, msg: msg || null, why: new Error().stack.split('\n').slice(2, 4).join(' < ').replace(/https?:[^ )]*\//g, '') }); if (rod.log.length > 8) rod.log.shift(); } if (rod.state !== 'idle') emit('end', { msg: msg || null, fish: rod.fish ? { p: rod.fish.p.toArray(), stamina: rod.fish.stamina } : null, line: rod.line.len, T: rod.T }); rod.state = 'idle'; bobber.visible = lineMesh.visible = false; meter.style.display = 'none'; if (rod.fish) { rod.fish.hooked = false; rod.fish = null; } if (msg) toast(msg, 'fish', 2200); }
  function hookOn(f) {
    rod.fish = f; f.hooked = true; f.stamina = 1; f.mass = 12 * f.len ** 3; f.v = f.v || new THREE.Vector3(); rod.state = 'fight';
    tipPos(rod.tip); rod.line.len = rod.tip.distanceTo(f.p) + 0.2; meter.style.display = 'block'; emit('hooked', { len: f.len });
    toast('Hooked! Hold to haul in, let go to give it line before it snaps', 'fish', 2400); sfx('splash', 0.4);
  }
  function updateRod(dt) {
    if (rod.state === 'idle') return;
    const p = rod.p;
    if (rod.state === 'flying') {
      const L = liq(p.x, p.z);
      stepProjectile(p, rod.v, dt, { g: G(), rhoFluid: 1000, inFluid: false, mass: 0.03, vol: 0, cda: 0.003 });
      if (L && p.y <= L.surf) { rod.state = 'float'; sfx('splash', 0.25); ocean && ocean.ring && ocean.ring(p.x, p.z, 0.08, 0.5, 1.2); }
      else if (solid(p.x, p.y, p.z)) reelEnd('It landed on the ground: cast into the water');
    } else if (rod.state === 'float' || rod.state === 'bite') {
      const L = liq(p.x, p.z); if (!L) { reelEnd(); return; }
      const fl = L.flow ? L.flow(p.x, L.surf, p.z) : null; if (fl) { p.x += fl[0] * dt * 0.5; p.z += fl[2] * dt * 0.5; }
      p.y = L.surf - (rod.state === 'bite' ? 0.09 + 0.05 * Math.sin(rod.biteT * 30) : 0.015);
      rod.waitT += dt;
      // the hook hangs ~1.5 m below; fish near it notice the bait (smell spreads slowly), scared spots stay empty
      tmp.set(p.x, L.surf - 1.5, p.z);
      if (rod.state === 'float' && sealife) {
        const near = sealife.fishNear(tmp, 9).filter((f) => !f.hooked && f.len < 0.9);
        const fear = sealife.fearAt(p.x, p.z);
        const scent = rod.baited ? Math.min(1, rod.waitT / 6) : 0.12;
        const rate = near.length * scent * 0.05 * Math.exp(-fear * 0.7);
        if (near.length && Math.random() < rate * dt) { rod.state = 'bite'; rod.biteT = 0; rod.fish = near[0]; sfx('bubbles', 0.3); emit('bite'); }
      } else if (rod.state === 'bite') {
        rod.biteT += dt;
        if (rod.biteT > 0.9) { if (rod.baited && Math.random() < 0.6) { rod.baited = false; toast('It stole the bait', 'fish', 1500); } rod.state = 'float'; rod.fish = null; rod.waitT = rod.baited ? 3 : 0; }
      }
    } else if (rod.state === 'fight') {
      const f = rod.fish; if (!f || !f.alive) { reelEnd('It got away'); return; }
      tipPos(rod.tip); const L = liq(f.p.x, f.p.z);
      const bottom = ground(f.p.x, f.p.z);
      // the line and fish are a stiff spring on a small mass: sub-step so it stays stable on slow frames
      const n = Math.max(1, Math.min(40, Math.ceil((dt * Math.sqrt(LINE.k / (f.mass * 1.6))) / 0.4))); let T = 0; if (!(dt > 0)) return;
      for (let i = 0; i < n; i++) { T = Math.max(i ? T : 0, stepHooked(f, rod.line, rod.tip, dt / n, { rho: L ? L.rho : 1025, reeling: rod.down, surf: L ? L.surf : 0, bottom })); }
      if (!Number.isFinite(f.p.x + f.p.y + f.p.z + T)) { f.p.copy(p); f.v.set(0, 0, 0); reelEnd('It got away'); return; }
      rod.T = rod.T + (T - rod.T) * Math.min(1, dt * 12);
      p.copy(f.p); if (L) p.y = Math.max(p.y, L.surf - 0.3);
      if (T > LINE.breakN) { const lost = f; reelEnd('Snap! The line broke'); if (sealife) sealife.addFear(lost.p.x, lost.p.z, 0.5); lost.panic = 1; emit('snap', { T }); return; }
      if (rod.tip.distanceTo(f.p) < 1.6 || (Math.hypot(rod.tip.x - f.p.x, rod.tip.z - f.p.z) < 2.0 && f.stamina < 0.5)) /* close and spent: lift it out */ { const fish = f; rod.fish = null; reelEnd(); fish.hooked = false; catchFish(fish, 'line'); return; }
      if (rod.line.len >= LINE.maxLen - 0.01 && T >= LINE.slipN) { reelEnd('It ran all your line out and threw the hook'); return; }
      const k = clamp(rod.T / LINE.breakN, 0, 1); meterBar.style.width = (k * 100).toFixed(0) + '%'; meterBar.style.background = k > 0.8 ? '#e2574c' : k > 0.55 ? '#e8c35a' : '#9fd6a8';
      meterLbl.textContent = `line ${rod.T.toFixed(0)} N · fish ${(f.stamina * 100).toFixed(0)}% · ${rod.line.len.toFixed(1)} m`;
      if (Math.random() < dt * (1 + 3 * f.stamina) && L && f.p.y > L.surf - 0.6) { ocean && ocean.splash && ocean.splash(f.p.x, L.surf, f.p.z, 0.3 + f.stamina * 0.4, 0.2); }
    }
    // the line: rod tip to bobber/fish, sagging under its own weight when slack
    tipPos(rod.tip); const a = rod.tip, b = rod.state === 'flying' || rod.state === 'float' || rod.state === 'bite' ? p : p;
    const d = a.distanceTo(b), slack = rod.state === 'fight' ? Math.max(0, rod.line.len - d) : Math.max(0.2, d * 0.06);
    const arr = lineGeo.attributes.position.array;
    for (let i = 0; i < NL; i++) { const t = i / (NL - 1); arr[i * 3] = a.x + (b.x - a.x) * t; arr[i * 3 + 1] = a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * slack * 0.5; arr[i * 3 + 2] = a.z + (b.z - a.z) * t; }
    lineGeo.attributes.position.needsUpdate = true; bobber.position.copy(p); bobber.visible = rod.state !== 'fight';
    // walked off too far
    if (rod.state !== 'fight' && d > LINE.maxLen + 4) reelEnd();
  }
  equip.register({ id: 'rod', order: 19, glyph: '🎣', label: () => 'rod' + (inv().bait ? ' · ' + inv().bait + ' bait' : ''),
    available: () => active() && !!(T7().tools && T7().tools.rod),
    primary(down) {
      if (down) {
        rod.down = true; rod.downT = 0;
        if (rod.state === 'bite') { hookOn(rod.fish); rod.down = false; rod.noCast = true; return true; } // setting the hook is a jerk; press again to haul
        if (rod.state === 'float') { reelEnd(); rod.down = false; rod.noCast = true; return true; }
        return true;
      }
      const wasDown = rod.down; rod.down = false;
      if (rod.noCast) { rod.noCast = false; return true; }
      if (wasDown && rod.state === 'idle') cast(clamp(rod.downT / 1.0, 0, 1));
      return true;
    },
    secondary(down) { if (down && rod.state !== 'idle') reelEnd(rod.state === 'fight' ? 'You cut the line free' : null); return true; },
    update(dt) { if (rod.down) rod.downT += dt; },
    unequip() { rod.down = false; if (rod.state !== 'idle') reelEnd(); },
  });

  const listeners = new Map();
  function emit(k, e) { for (const fn of listeners.get(k) || []) { try { fn(e); } catch (er) { /* */ } } }
  return {
    update(dt) { if (!(dt > 0)) return; dt = Math.min(dt, 0.05); updateSpear(dt); updateRod(dt); },
    on(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); },
    get spear() { return sp; }, get rod() { return rod; },
    reset() { sp.state = 'held'; spearMesh.visible = false; reelEnd(); },
    // tests: drive the items without pointer input
    debug: { thrust, throwSpear, cast, hookOn, catchFish },
    dispose() { for (const m of [spearMesh, bobber, lineMesh]) scene.remove(m); meter.remove(); equip.unregister('spear'); equip.unregister('rod'); },
  };
}
