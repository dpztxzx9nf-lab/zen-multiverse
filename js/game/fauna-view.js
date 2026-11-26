// The garden animals you can see (js/fauna.js is their life): hares round the meadow and the cove path, a fox
// from the den in the far trees. Online, the server runs them and sends where each is a few times a second;
// we glide the bodies there. Alone and offline, the same simulation runs here with just you in it.
// Interactions are physical: thrust a spear (if you made one) within reach, hold out fibre to a hare that is
// calm enough to stay, brush a hare that follows you. Bodies are the Blender-rigged grazer, scaled and tinted.
import * as THREE from 'three';
import { preloadCreatures, buildCreature } from './creatures.js';
import { createFauna, stepFauna, faunaAct, wire, SPECIES, REACH } from '../fauna.js';

// muted coats (art bible: low saturation, nothing gold): a brown-grey hare, a dusty rust fox
const LOOK = {
  hare: { plan: 'quad', size: 0.3, back: '#7b6d5c', belly: '#d4cbb8', alien: 0, lean: 1.15, mats: null },
  fox: { plan: 'quad', size: 0.48, back: '#7f5640', belly: '#d8cbb4', alien: 0, lean: 0.95, mats: null },
};
const PACE = 1.25; // m/s of the grazer walk cycle at scale 1
const WHY = { far: 'Too far. Get within arm and spear reach.', scared: 'It is too jumpy to take anything right now.', wont: 'It will not have that.', gone: 'It is gone.' };

export function createFaunaView({ scene, interact, hud, game, ground, player, walking, send, me }) {
  const group = new THREE.Group(); group.name = 'garden-fauna'; scene.add(group);
  const bodies = new Map(); // id -> { root, parts, x, z, yaw, st, tame, v, sp, tx, tz, tyaw }
  let local = null, lastNet = 0, saveT = 0, lastPos = null, mySp = 0;
  const online = () => performance.now() - lastNet < 4000 && !!send();
  const T7 = () => (game.data.g7 && game.data.g7.tools) || {};
  const inv = () => game.data.inv || {};
  const myId = () => (online() ? me() : 'me');
  preloadCreatures().catch(() => {});

  function body(id, sp) {
    let b = bodies.get(id); if (b) return b;
    const made = buildCreature(LOOK[sp]); if (!made) return null; // models still loading: next frame
    // the garden's bright sky map turns a rough coat blue-grey; keep reflections faint so the fur keeps its colour
    for (const m of LOOK[sp].mats || []) if (m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.userData.zenFauna) { m.envMapIntensity = 0.22; m.userData.zenFauna = true; m.needsUpdate = true; }
    b = { ...made, sp, x: 0, z: 0, yaw: 0, st: 'idle', tame: null, v: 0, tx: 0, tz: 0, tyaw: 0, fresh: true };
    group.add(b.root); bodies.set(id, b);
    interact.add({ id: 'fauna-' + id, at: () => ({ x: b.x, y: b.root.position.y + 0.3, z: b.z }), r: REACH, priority: 0.55,
      enabled: () => walking() && b.st !== 'dead' && b.root.visible, actions: () => acts(id, b) });
    return b;
  }
  function acts(id, b) {
    const out = [], mine = b.tame && b.tame === myId(), name = SPECIES[b.sp].name;
    if (b.sp === 'hare' && !mine && (inv().fibre || 0) >= 1) out.push({ label: 'Hold out some fibre', icon: 'leaf', run: () => act('feed', id) });
    if (mine) out.push({ label: 'Brush its coat', icon: 'leaf', run: () => act('brush', id) });
    if (T7().spear && !mine) out.push({ label: `Thrust the spear at the ${name}`, icon: 'star', run: () => act('hit', id) });
    return out;
  }
  const pending = new Map();
  function act(kind, id) {
    if (online()) { pending.set(id + kind, true); send()({ k: { hit: 'fhit', feed: 'ffeed', brush: 'fbrush' }[kind], id }); return; }
    const P = player.position, r = faunaAct(local, kind, 'me', { x: P.x, z: P.z }, id, Date.now());
    result({ kind, id, ok: r.ok, why: r.why, text: r.text, killed: r.killed });
    if (r.ok && r.give) { for (const [k, n] of Object.entries(r.give)) game.add(k, n); hud.toast(`${r.text} (+${Object.entries(r.give).map(([k, n]) => n + ' ' + k).join(', ')})`, 'leaf', 2600); }
  }
  function result(m) {
    pending.delete(m.id + m.kind);
    if (m.ok && m.kind === 'feed') game.take('fibre', 1); // the handful is eaten only if it took it
    if (m.ok && m.give) return; // the grant toast says it
    if (m.ok && m.kind === 'hit' && m.killed) return; // ditto (grant follows)
    const t = m.text || (m.ok ? '' : WHY[m.why]); if (t) hud.toast(t, 'leaf', 2200);
  }
  function apply(rows) {
    const seen = new Set();
    for (const [id, sp, x, z, yaw, st, tame, v] of rows) {
      if (!LOOK[sp]) continue; const b = body(id, sp); if (!b) continue; seen.add(id);
      b.tx = x; b.tz = z; b.tyaw = yaw; b.st = st; b.tame = tame; b.v = v;
      if (b.fresh || Math.hypot(b.x - x, b.z - z) > 8) { b.x = x; b.z = z; b.yaw = yaw; b.fresh = false; }
    }
    for (const [id, b] of bodies) b.root.visible = seen.has(id) && b.st !== 'dead';
  }
  function onServer(m) {
    if (m.k === 'fauna' && Array.isArray(m.a)) { lastNet = performance.now(); apply(m.a); return; }
    if (m.k === 'fres') return result(m);
    if (m.k === 'reset') lastNet = 0;
  }
  window.__zenFauna = { onServer };
  { const q = window.__zenFaunaQ; if (q) for (const m of q.splice(0)) onServer(m); }

  function weigh(P, want, dt) { const k = Math.min(1, dt * 4); for (const [n, a] of Object.entries(P.acts)) a.setEffectiveWeight(a.getEffectiveWeight() + ((want[n] || 0) - a.getEffectiveWeight()) * k); }
  function update(dt) {
    const on = walking(); group.visible = on; if (!on) return;
    const P = player.position;
    const jump = lastPos ? Math.hypot(P.x - lastPos.x, P.z - lastPos.z) : 0; // a teleport or respawn is not running
    if (lastPos && jump < 3) { const s = jump / Math.max(dt, 1e-3); mySp += (Math.min(s, 12) - mySp) * Math.min(1, dt * 6); }
    lastPos = { x: P.x, z: P.z };
    if (!online()) {
      if (!local) { local = createFauna(); const sv = game.data.fauna; if (sv && Array.isArray(sv.animals)) for (const a of local.animals) { const o = sv.animals.find((s) => s.id === a.id); if (o) { a.tame = o.tame; a.mem = o.mem || []; } } }
      stepFauna(local, Math.min(dt, 0.1), [{ aid: 'me', x: P.x, z: P.z, sp: mySp }], Date.now());
      apply(wire(local));
      if ((saveT += dt) > 15) { saveT = 0; game.data.fauna = { animals: local.animals.map((a) => ({ id: a.id, tame: a.tame, mem: (a.mem || []).slice(-6) })) }; }
    }
    for (const b of bodies.values()) {
      if (!b.root.visible) continue;
      const k = Math.min(1, dt * 6); b.x += (b.tx - b.x) * k; b.z += (b.tz - b.z) * k;
      let dy = b.tyaw - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.yaw += dy * Math.min(1, dt * 8);
      const gy = ground ? ground(b.x, b.z) : 0; const r = b.root.position;
      r.x = b.x; r.z = b.z; r.y += ((b.st === 'rest' ? gy - 0.05 : gy) - r.y) * Math.min(1, dt * 10);
      b.root.rotation.y = b.yaw;
      const Pt = b.parts; if (!Pt || !Pt.mixer) continue;
      const moving = b.v > 0.1;
      weigh(Pt, moving ? { walk: 1 } : b.st === 'graze' || b.st === 'eat' ? { graze: 1 } : { idle: 1 }, dt);
      if (Pt.acts.walk) Pt.acts.walk.timeScale = Math.max(0.3, b.v / (PACE * LOOK[b.sp].size));
      if (Pt.acts.idle) Pt.acts.idle.timeScale = b.st === 'rest' ? 0.35 : 1;
      const far = Math.hypot(b.x - P.x, b.z - P.z) > 30; Pt.acc = (Pt.acc || 0) + dt;
      if (!far || Pt.acc > 0.12) { Pt.mixer.update(Pt.acc); Pt.acc = 0; }
    }
  }
  return { update, group, onServer };
}
