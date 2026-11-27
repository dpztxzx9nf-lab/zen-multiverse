// Xenia's core loop, the client side, in greybox (plain shapes and a plain HUD: Brock's rule, prove the loop
// before any art). The server (server/src/loop.js) decides everything; this draws it and sends intents.
//   T        draw the next weapon you carry (fists -> melee weapons -> pistol); holstered = fists
//   Mouse0   with a weapon drawn: swing at whoever is in front of you (or the build piece you face), or fire
//   R        with the pistol drawn: reload (the server moves rounds from your reserve; it takes time)
//   Enter    when down: get back up at the arrival stone (after the wait)
// Recoil: the server kicks every quick shot's aim up and sideways (js/xenia/loop.js recoil). The red dot shows
// where the next shot will really go while the gun is climbing, so you pull down against it like a real gun.
import * as THREE from 'three';
import { meleeSpec, GUNS, recoil, KIT_NAMES, WEAPONS, BODY_R, FACING } from './loop.js';

export function startLoop({ worlds, send, peers, me }) {
  const S = { hp: 100, kit: {}, w: 'hand', mag: {}, rl: 0, down: 0, rlEnd: 0, downEnd: 0, shotN: 0, shotT: 0, kick: 0 };
  const view = () => { const w = worlds.current, d = w && w.debug; return d && d.player ? d : null; };
  // ---- HUD (plain DOM)
  const el = document.createElement('div'); el.id = 'zm-loop';
  el.style.cssText = 'position:fixed;left:14px;bottom:86px;z-index:40;font:600 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;min-width:180px';
  el.innerHTML = '<div style="height:8px;background:#0006;border-radius:4px;overflow:hidden"><div id="zl-hp" style="height:100%;width:100%;background:#7cd67c"></div></div><div id="zl-w" style="margin-top:4px"></div><div id="zl-msg" style="margin-top:2px;opacity:.85"></div>';
  document.body.appendChild(el);
  const down = document.createElement('div');
  down.style.cssText = 'position:fixed;inset:0;z-index:45;display:none;align-items:center;justify-content:center;background:#300a;color:#fff;font:600 22px system-ui;text-align:center';
  document.body.appendChild(down);
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#f44;z-index:41;pointer-events:none;display:none';
  document.body.appendChild(dot);
  const hpEl = el.querySelector('#zl-hp'), wEl = el.querySelector('#zl-w'), msgEl = el.querySelector('#zl-msg');
  let msgT = 0; const say = (t) => { msgEl.textContent = t; msgT = performance.now() + 2500; };
  function render() {
    hpEl.style.width = Math.max(0, S.hp) + '%'; hpEl.style.background = S.hp > 50 ? '#7cd67c' : S.hp > 25 ? '#e0c050' : '#e05050';
    const G = GUNS[S.w];
    wEl.textContent = S.w === 'hand' ? 'Fists (T: draw a weapon)' : G ? `${G.label}  ${S.mag[S.w] || 0} / ${S.kit[G.ammo] || 0}${S.rlEnd > performance.now() ? '  reloading…' : ''}` : (KIT_NAMES['w_' + S.w] || S.w);
  }
  // ---- greybox gun / weapon in view: a plain block
  let held = null;
  function holdShape() {
    const d = view(); if (!d || !d.camera) return;
    if (held) { held.parent && held.parent.remove(held); held.geometry.dispose(); held = null; }
    if (S.w === 'hand') return;
    const G = GUNS[S.w], g = G ? new THREE.BoxGeometry(0.05, 0.11, 0.22) : new THREE.BoxGeometry(0.04, 0.04, (meleeSpec(S.w)?.reach || 1.5) * 0.45);
    held = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: G ? 0x333338 : 0x8a7a60 }));
    held.position.set(0.22, -0.2, -0.45); held.userData.phys = { k: 'pass', why: 'held in your hand (greybox weapon)' };
    d.camera.add(held); if (!d.camera.parent) d.scene.add(d.camera);
  }
  // ---- tracers: plain lines that fade
  const tracers = [];
  function tracer(o, dir) {
    const d = view(); if (!d) return;
    const a = new THREE.Vector3(o[0], o[1], o[2]), b = a.clone().addScaledVector(new THREE.Vector3(dir[0], dir[1], dir[2]), 60);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    l.userData.phys = { k: 'pass', why: 'a bullet tracer' }; d.scene.add(l); tracers.push({ l, t: 0.12, scene: d.scene });
  }
  // ---- intents
  function kitWeapons() { return ['hand', ...Object.entries(WEAPONS).filter(([k]) => S.kit[k] > 0).map(([, w]) => w)]; }
  function cycle() { const L = kitWeapons(), i = L.indexOf(S.w); send({ k: 'eq', w: L[(i + 1) % L.length] }); }
  function target() { // the person in front of you within reach, else the build piece you face
    const d = view(); if (!d) return null;
    const p = d.player.position, yaw = d.player.heading, fx = Math.sin(yaw), fz = Math.cos(yaw), spec = meleeSpec(S.w) || meleeSpec('hand');
    let best = null;
    for (const q of peers()) {
      if (!q.at) continue; const dx = q.at[0] - p.x, dz = q.at[2] - p.z, dist = Math.hypot(dx, dz);
      if (dist > spec.reach + BODY_R + 0.2) continue;
      if (dist > 0.3 && Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / dist))) > FACING) continue;
      if (!best || dist < best.dist) best = { id: q.id, dist };
    }
    if (best) return { id: best.id };
    const pcs = d.sb && d.sb.build && d.sb.build.pieces;
    if (pcs) for (const pc of pcs.values()) { const dx = pc.pos.x - p.x, dz = pc.pos.z - p.z, dist = Math.hypot(dx, dz); if (dist < spec.reach + 1.4 && (dx * fx + dz * fz) / Math.max(dist, 1e-3) > 0.5) return { piece: pc.id }; }
    return null;
  }
  function attack() {
    if (S.down) return;
    const d = view(); if (!d) return;
    const G = GUNS[S.w];
    if (G) {
      if (S.rlEnd > performance.now()) return;
      const now = performance.now(); if (now - S.shotT < G.every * 1000) return;
      S.shotN = now - S.shotT < G.settle * 1000 ? S.shotN + 1 : 0; S.shotT = now;
      const dir = d.player.aimDir(new THREE.Vector3());
      send({ k: 'fire', d: [dir.x, dir.y, dir.z] });
      if (held) held.rotation.x = 0.35; // the block jumps in your hand
      return;
    }
    const t = target();
    if (t) send({ k: 'sw', ...t }); else say('Nobody in reach.');
  }
  const onDown = (e) => {
    if (S.w === 'hand' && !S.down) return;
    if (e.button !== 0 || document.querySelector('.zs-panel.on, #zm-bag.on')) return;
    e.stopImmediatePropagation(); attack();
  };
  const onKey = (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'KeyT') { cycle(); e.preventDefault(); }
    else if (e.code === 'KeyR' && GUNS[S.w]) { send({ k: 'rl' }); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (e.code === 'Enter' && S.down) { send({ k: 'up' }); e.stopImmediatePropagation(); }
  };
  addEventListener('pointerdown', onDown, true); addEventListener('keydown', onKey, true);
  send({ k: 'hello' });
  // ---- server says
  function onMsg(m) {
    const myId = me()?.id, now = performance.now();
    switch (m.k) {
      case 'st': {
        const was = S.w; Object.assign(S, { hp: m.hp, kit: m.kit || {}, w: m.w || 'hand', mag: m.mag || {}, down: m.down });
        S.rlEnd = m.rl > 0 ? now + m.rl : 0; S.downEnd = m.down > 0 ? now + m.down : 0;
        if (was !== S.w) holdShape(); render(); break;
      }
      case 'hit':
        if (m.to === myId) { S.hp = m.hp; document.body.animate([{ boxShadow: 'inset 0 0 80px #f008' }, { boxShadow: 'inset 0 0 0 #f000' }], 400); }
        if (m.by === myId) say(m.head ? `Headshot: ${m.dmg}` : `Hit: ${m.dmg}`);
        render(); break;
      case 'ko': if (m.id === myId) { S.down = 1; S.downEnd = now + 5000; } else if (m.by === myId) say(`${m.name || 'They'} went down.`); break;
      case 'shot': if (Array.isArray(m.o) && Array.isArray(m.d)) tracer(m.o, m.d); break;
      case 'ph': say(m.left > 0 ? `Piece: ${Math.round(m.left * 100)}% left` : 'It broke.'); break;
      case 'raid': say(`${m.by} is breaking into your base!`); break;
      case 'click': say('Click. Empty: R to reload.'); break;
      case 'no': say(m.why); break;
    }
  }
  function update(dt) {
    const now = performance.now();
    for (let i = tracers.length - 1; i >= 0; i--) { const t = tracers[i]; t.t -= dt; t.l.material.opacity = Math.max(0, t.t / 0.12); if (t.t <= 0) { t.scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); tracers.splice(i, 1); } }
    if (S.down) { down.style.display = 'flex'; const s = Math.ceil(Math.max(0, S.downEnd - now) / 1000); down.textContent = s > 0 ? `You're down. Back up in ${s}…` : "You're down. Press Enter to get back up at the arrival stone."; }
    else down.style.display = 'none';
    if (msgT && now > msgT) { msgEl.textContent = ''; msgT = 0; }
    if (S.rlEnd && now > S.rlEnd) { S.rlEnd = 0; send({ k: 'hello' }); }
    if (!held && S.w !== 'hand') holdShape();
    if (held) held.rotation.x = Math.max(0, held.rotation.x - dt * 3);
    const G = GUNS[S.w], d = view();
    if (G && d && d.camera && now - S.shotT < G.settle * 1000) { // where the next quick shot goes
      const k = recoil(S.w, S.shotN + 1), f = (innerHeight / 2) / Math.tan((d.camera.fov || 60) * Math.PI / 360);
      dot.style.display = 'block'; dot.style.transform = `translate(${(Math.tan(k.yaw) * f).toFixed(1)}px, ${(-Math.tan(k.pitch) * f).toFixed(1)}px)`;
    } else dot.style.display = 'none';
  }
  let raf = 0; let last = performance.now();
  const tick = () => { const n = performance.now(); update(Math.min(0.1, (n - last) / 1000)); last = n; raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick);
  function stop() { cancelAnimationFrame(raf); removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); el.remove(); down.remove(); dot.remove(); if (held) held.parent && held.parent.remove(held); }
  const api = { onMsg, stop, state: S, attack, cycle };
  if (typeof window !== 'undefined') window.__zmLoop = api; // tests
  return api;
}
