// One player avatar: the same model for the local player and for everyone else in multiplayer.
//   const av = createAvatar({ scene, look: appearanceDescriptor | 'ZA1.code', world: 'earth', ground, P });
//   await av.ready;
//   local:  av.follow(player, dt, { firstPerson })      (reads the walker, picks states, places the body)
//   remote: av.applyNet(snapshot); av.update(dt)          (smoothed network pose)
//   av.anim.play('throw'), av.anim.set('glide'), av.setLook(desc), av.attach(obj, 'hand_r'), av.handWorld(out)
import * as THREE from 'three';
import { buildRig, clipsFor } from './rig.js';
import { createAnimator } from './anim.js';
import { decode, sanitize } from './appearance.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const dampAngle = (a, b, k, dt) => a + wrap(b - a) * (1 - Math.exp(-k * dt));
// world gestures from the walker (player.act names) -> avatar actions
const GESTURE = { kneel: 'plant', water: 'water', prune: 'interact', toss: 'throw', reach: 'pickup', wave: 'wave', dig: 'dig', build: 'build', throw: 'throw', pickup: 'pickup', drink: 'drink' };
const SOCKET = { hand_r: 'hand_r', hand_l: 'hand_l', head: 'Head', back: 'spine_03', hips: 'pelvis' };

// how far the swim clip needs the body tipped to lie flat (radians; the clip itself is upright)
export let SWIM_TILT = Math.PI / 2;
export function setSwimTilt(v) { SWIM_TILT = v; }
export function createAvatar({ scene, look, world = 'earth', ground = null, P = {}, local = true, castShadow = true }) {
  const group = new THREE.Group(); group.name = 'avatar';
  if (scene) scene.add(group);
  let desc = sanitize(typeof look === 'string' ? decode(look) || {} : look || {});
  let rig = null, anim = null, worldId = world, worn = null;
  const queue = [];
  const proxy = (fn) => (...a) => (anim ? fn(...a) : (queue.push(() => fn(...a)), Promise.resolve(false)));
  const st = { yaw: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, prev: null, turn: 0, holding: false, net: null, bodyYaw: 0, airT: 0 };
  const attached = [];
  let fp = false;
  async function build(body) {
    const r = await buildRig(body);
    const clips = await clipsFor(r);
    if (rig) { rig.dispose(); }
    rig = r; group.add(rig.root);
    rig.root.traverse((o) => { if (o.isSkinnedMesh) o.castShadow = castShadow; });
    anim = createAnimator(rig, clips, { ground });
    worn = rig.setLook(desc, { world: worldId });
    rig.setFP(fp);
    for (const a of attached) socketOf(a.socket).add(a.obj);
    while (queue.length) queue.shift()();
    return api;
  }
  const socketOf = (s) => (rig && rig.bones[SOCKET[s] || s]) || group;
  const tmpV = new THREE.Vector3();
  // swimming: the body pivots about the chest from upright (treading) to lying along its motion
  const CHEST = 1.3, tiltV = new THREE.Vector3(), tiltE = new THREE.Euler(0, 0, 0, 'YXZ');
  function placeRoot(dt) {
    if (!rig) return;
    group.position.set(st.x, st.y, st.z);
    st.tilt = damp(st.tilt || 0, st.tiltT || 0, 5, Math.min(dt || 0.016, 0.1));
    if (Math.abs(st.tilt) > 1e-3) {
      rig.root.rotation.order = 'YXZ'; rig.root.rotation.set(st.tilt, st.bodyYaw, 0);
      tiltE.set(st.tilt, st.bodyYaw, 0); tiltV.set(0, CHEST, 0).applyEuler(tiltE); rig.root.position.set(-tiltV.x, CHEST - tiltV.y, -tiltV.z);
    } else { rig.root.rotation.set(0, st.bodyYaw, 0); rig.root.position.set(0, 0, 0); }
  }
  const api = {
    group,
    get rig() { return rig; },
    get anim() { return anim; },
    get look() { return desc; },
    get worn() { return worn; },
    ready: null,
    setLook(d) {
      const n = sanitize(typeof d === 'string' ? decode(d) || desc : d);
      const bodyChanged = !rig || n.body !== desc.body;
      desc = n;
      if (bodyChanged) return (api.ready = build(desc.body));
      worn = rig.setLook(desc, { world: worldId }); return Promise.resolve(api);
    },
    setWorld(w) { worldId = w; if (rig) worn = rig.setLook(desc, { world: w }); },
    setFirstPerson(on) { fp = !!on; if (rig) rig.setFP(fp); },
    get firstPerson() { return fp; },
    setVisible(v) { group.visible = v; },
    play: proxy((n, o) => anim.play(n, o)),
    stop: proxy((n, f) => anim.stop(n, f)),
    setState: proxy((s) => anim.set(s)),
    // attach a prop (rake, watering can, tool, lantern) to a bone socket
    attach(obj, socket = 'hand_r', { position = null, rotation = null } = {}) {
      api.detach(obj);
      attached.push({ obj, socket });
      if (position) obj.position.copy(position); if (rotation) obj.rotation.copy(rotation);
      socketOf(socket).add(obj); return obj;
    },
    detach(obj) { const i = attached.findIndex((a) => a.obj === obj); if (i >= 0) { attached.splice(i, 1); obj.removeFromParent(); } },
    handWorld(out = new THREE.Vector3(), side = 'r') { const b = rig && rig.bones['hand_' + side]; if (!b) return null; return b.getWorldPosition(out); },
    headWorld(out = new THREE.Vector3()) { const b = rig && rig.bones.Head; return b ? b.getWorldPosition(out) : out.set(st.x, st.y + 1.6, st.z); },
    // ---- the local walker drives everything from its own state
    follow(player, dt, { firstPerson = true, photo = false, holding = false } = {}) {
      const p = player.position;
      if (!st.prev) { st.prev = p.clone(); st.bodyYaw = player.heading; }
      const idt = dt > 1e-5 ? 1 / dt : 0;
      const vx = (p.x - st.prev.x) * idt, vz = (p.z - st.prev.z) * idt, vy = player.velocity ? player.velocity.y : (p.y - st.prev.y) * idt;
      st.prev.copy(p);
      // smooth the measured speed (frame-time jitter) but keep it honest
      const raw = Math.min(14, Math.hypot(vx, vz));
      st.speed = damp(st.speed, raw, 14, dt);
      const moving = st.speed > 0.25;
      const heading = player.heading;
      const moveYaw = moving ? Math.atan2(vx, vz) : st.bodyYaw;
      const S = player.state || {};
      const grounded = player.airborne === undefined ? true : !player.airborne;
      const busy = player.busy || !!(anim && [...anim.layers.values()].some((L) => L.target > 0 && L.def.mask === 'full'));
      let twist = 0, backward = false;
      const prevYaw = st.bodyYaw;
      if (!photo) {
        if (firstPerson || holding || busy) {
          // first person: the body faces the crosshair; the legs twist toward strafing, walk backward when going back
          if (firstPerson) st.bodyYaw = heading;
          else st.bodyYaw = dampAngle(st.bodyYaw, heading, 10, dt);
          if (moving) {
            const rel = wrap(moveYaw - st.bodyYaw);
            if (Math.abs(rel) > 1.95) { backward = true; twist = THREE.MathUtils.clamp(wrap(rel - Math.PI), -0.9, 0.9); }
            else twist = THREE.MathUtils.clamp(rel, -1.1, 1.1);
          }
        } else {
          // third person: turn toward where she is going; standing still, turn only when looking well behind
          if (moving) st.bodyYaw = dampAngle(st.bodyYaw, moveYaw, st.speed > 5 ? 7 : 10, dt);
          else if (Math.abs(wrap(heading - st.bodyYaw)) > 1.9) st.bodyYaw = dampAngle(st.bodyYaw, heading, 4, dt);
        }
      }
      st.turn = damp(st.turn, wrap(st.bodyYaw - prevYaw) * idt, 6, dt);
      st.x = p.x; st.y = p.y; st.z = p.z;
      { const sw = player.swimming && player.swim; st.tiltT = sw ? sw.horiz * (SWIM_TILT - sw.pitch) : 0; }
      // first person: the body sits a little behind the eye so looking down shows the chest and feet, not the inside of the neck
      if (firstPerson && !photo) {
        const pitch = player.pitch || 0;
        const back = 0.07 + Math.max(0, -pitch - 0.15) * 0.34;
        st.x -= Math.sin(heading) * back; st.z -= Math.cos(heading) * back;
      }
      if (anim) {
        anim.drive({
          speed: st.speed, grounded, vy, sliding: !!(player.sliding || S.sliding), gliding: !!(player.gliding || S.gliding), mantling: !!(player.mantling || S.mantle),
          climbing: !!(S.climbT > 0 && !grounded && !S.mantle && vy > 0.3 && S.climbing !== false && S.wallClimb), crouching: !!(player.crouching || S.crouch), swimming: !!player.swimming,
          backward, twist, bodyYaw: st.bodyYaw, turnRate: st.turn, aimYaw: heading, aimPitch: player.pitch || 0, fp: firstPerson && !photo, holding, lookOff: photo,
        });
      }
      api.update(dt);
    },
    update(dt) {
      if (st.net) {
        const n = st.net, k = 12;
        // direct: the caller already interpolates on the sender's clock (net.js), so place it exactly (no second lag)
        if (n.direct) { st.x = n.x; st.y = n.y; st.z = n.z; st.bodyYaw = n.yaw; }
        else { st.x = damp(st.x, n.x, k, dt); st.y = damp(st.y, n.y, k, dt); st.z = damp(st.z, n.z, k, dt); st.bodyYaw = dampAngle(st.bodyYaw, n.yaw, 10, dt); }
        st.tiltT = n.tl; // swim body pitch (lying along the stroke), relayed from her
        const prevYaw = st.turnYaw ?? st.bodyYaw; st.turnYaw = st.bodyYaw;
        st.turn = damp(st.turn, dt > 1e-5 ? wrap(st.bodyYaw - prevYaw) / dt : 0, 6, dt); // body lean into turns, like hers
        if (anim) anim.drive({ speed: n.sp, grounded: n.g, vy: n.vy, sliding: n.st === 'slide' || n.st === 'slide_exit', gliding: n.st === 'glide', mantling: n.st === 'mantle', climbing: n.st === 'climb',
          swimming: n.st === 'swim' || n.st === 'swim_idle', crouching: n.st === 'crouch' || n.st === 'crouch_walk', bodyYaw: st.bodyYaw, turnRate: st.turn, aimYaw: n.ay, aimPitch: n.ap, fp: false });
      }
      placeRoot(dt);
      if (anim) anim.update(Math.min(dt, 0.1));
    },
    // LOD by distance to the camera (the local player keeps LOD0)
    lodFor(cam) {
      if (!rig) return 0;
      if (local) {
        // her own body: full detail, except phones in third person (LOD1 ~12k tris keeps the phone frame under budget)
        const i = P.cls === 'phone' && !fp && cam.position.distanceTo(group.position) > 2.0 ? 1 : 0;
        rig.setLod(i); return i;
      }
      const d = cam.position.distanceTo(group.position) * (P.cls === 'phone' ? 1.6 : 1);
      const i = d < 9 ? 0 : d < 28 ? 1 : 2; rig.setLod(i);
      group.visible = d < (P.cls === 'phone' ? 90 : 160);
      return i;
    },
    // ---- network: 20 numbers' worth of state; the appearance travels separately as its ZA1 code
    snapshot(player) {
      const n = anim ? anim.net() : { s: 'idle', a: [] };
      return { x: +st.x.toFixed(2), y: +st.y.toFixed(2), z: +st.z.toFixed(2), yaw: +st.bodyYaw.toFixed(2), sp: +st.speed.toFixed(2), g: player ? !player.airborne : true,
        vy: player && player.velocity ? +player.velocity.y.toFixed(1) : 0, st: n.s, a: n.a.slice(0, 2), ay: player ? +player.heading.toFixed(2) : st.bodyYaw, ap: player ? +(player.pitch || 0).toFixed(2) : 0, tl: +(st.tiltT || 0).toFixed(2) };
    },
    applyNet(s) {
      if (!s || typeof s !== 'object') return;
      const f = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
      const n = { x: f(s.x), y: f(s.y), z: f(s.z), yaw: f(s.yaw), sp: Math.min(20, Math.max(0, f(s.sp))), g: !!s.g, vy: f(s.vy), st: typeof s.st === 'string' ? s.st.slice(0, 16) : 'idle', ay: f(s.ay), ap: f(s.ap), tl: Math.max(-2, Math.min(2, f(s.tl))), direct: !!s.direct };
      if (!st.net) { st.x = n.x; st.y = n.y; st.z = n.z; st.bodyYaw = n.yaw; }
      st.net = n;
      if (anim && Array.isArray(s.a)) {
        for (const name of s.a.slice(0, 2)) if (typeof name === 'string' && !anim.playing(name)) anim.play(name);
        for (const L of anim.layers.values()) if (!s.a.includes(L.name) && L.loop) anim.stop(L.name);
      }
    },
    gesture(name) { const a = GESTURE[name]; if (a) return api.play(a); return Promise.resolve(false); },
    tris() { return rig ? rig.tris() : 0; },
    dispose() { group.removeFromParent(); if (rig) rig.dispose(); },
  };
  void tmpV;
  api.ready = build(desc.body);
  return api;
}
