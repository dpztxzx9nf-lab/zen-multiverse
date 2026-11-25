// Rigid bodies for the physical world. PC: Rapier (lazy-loaded WASM, 60 Hz fixed step, contact
// with the heightfield as small trimesh tiles near moving bodies and with every voxel chunk).
// Phones: a small 30 Hz integrator against the same ground queries (no WASM download).
// Same API either way:
//   const ph = createPhysics({ P, env, heightTile })
//   const b = ph.add({ shape: {type:'box', hx,hy,hz} | {type:'ball', r} | {type:'cyl', r, hh} | {type:'hull', points}, mass, pos, quat, mesh, friction, restitution })
//   ph.fixed(spec) for build pieces; ph.step(dt, focus); ph.carry(b, target); ph.impulse(b, v); ph.remove(b)
import * as THREE from 'three';
const TILE = 16;

export function createPhysics({ P, env, heightTile, gravity = 9.81 }) {
  const lite = P.cls !== 'pc' || new URLSearchParams(location.search).has('litephys');
  const bodies = new Set();
  let R = null, world = null, ready = false;
  const tiles = new Map(); // tile key -> collider (heightfield tiles)
  const vox = new Map();   // voxel chunk key -> collider
  const fixedQ = [];
  let G = gravity;
  const readyP = lite ? Promise.resolve(true) : import('../../../vendor/rapier/rapier.mjs').then(async (mod) => {
    R = mod.default || mod; if (R.init) await R.init();
    world = new R.World({ x: 0, y: -G, z: 0 });
    world.timestep = 1 / 60;
    ready = true;
    for (const b of bodies) if (!b.rb) makeRapier(b);
    for (const f of fixedQ.splice(0)) makeFixed(f);
    return true;
  }).catch((e) => { console.warn('[phys] rapier unavailable, using the light integrator', e && e.message); return false; });
  const usingRapier = () => ready && world;
  function colliderDesc(s) {
    if (s.type === 'ball') return R.ColliderDesc.ball(s.r);
    if (s.type === 'cyl') return R.ColliderDesc.cylinder(s.hh, s.r);
    if (s.type === 'hull') return R.ColliderDesc.convexHull(s.points) || R.ColliderDesc.ball(s.r || 0.3);
    return R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
  }
  const vol = (s) => (s.type === 'ball' ? 4.19 * s.r ** 3 : s.type === 'cyl' ? Math.PI * s.r * s.r * s.hh * 2 : s.type === 'hull' ? (s.vol || 0.1) : 8 * s.hx * s.hy * s.hz);
  const radiusOf = (s) => (s.type === 'ball' ? s.r : s.type === 'cyl' ? Math.hypot(s.r, s.hh) : s.type === 'hull' ? s.r : Math.hypot(s.hx, s.hy, s.hz));
  function makeRapier(b) {
    const d = R.RigidBodyDesc.dynamic().setTranslation(b.pos.x, b.pos.y, b.pos.z).setRotation({ x: b.quat.x, y: b.quat.y, z: b.quat.z, w: b.quat.w })
      .setLinvel(b.vel.x, b.vel.y, b.vel.z).setAngvel({ x: b.ang.x, y: b.ang.y, z: b.ang.z }).setLinearDamping(0.05).setAngularDamping(0.25).setCanSleep(true).setCcdEnabled(b.radius < 0.25);
    b.rb = world.createRigidBody(d);
    const c = colliderDesc(b.shape).setMass(b.mass).setFriction(b.friction).setRestitution(b.restitution);
    b.col = world.createCollider(c, b.rb);
    if (b.sleep) b.rb.sleep();
  }
  function makeFixed(f) {
    const d = R.RigidBodyDesc.fixed().setTranslation(f.pos.x, f.pos.y, f.pos.z).setRotation({ x: f.quat.x, y: f.quat.y, z: f.quat.z, w: f.quat.w });
    f.rb = world.createRigidBody(d); f.col = world.createCollider(colliderDesc(f.shape).setFriction(f.friction ?? 0.7), f.rb);
  }
  let seq = 0;
  const api = {
    get lite() { return lite; }, get rapier() { return usingRapier(); }, ready: readyP, bodies,
    add(o) {
      const b = { id: ++seq, shape: o.shape, mass: o.mass || 10, friction: o.friction ?? 0.6, restitution: o.restitution ?? 0.1, mesh: o.mesh || null, kind: o.kind, data: o.data || {},
        pos: new THREE.Vector3().copy(o.pos), quat: new THREE.Quaternion().copy(o.quat || new THREE.Quaternion()), vel: new THREE.Vector3().copy(o.vel || new THREE.Vector3()), ang: new THREE.Vector3().copy(o.ang || new THREE.Vector3()),
        prevV: new THREE.Vector3(), radius: radiusOf(o.shape), sleep: !!o.sleep, still: o.sleep ? 2 : 0, held: false, rb: null, onImpact: o.onImpact || null, born: performance.now() };
      b.volume = vol(o.shape);
      if (usingRapier()) makeRapier(b);
      bodies.add(b); return b;
    },
    remove(b) { if (!bodies.has(b)) return; bodies.delete(b); if (b.rb && world) world.removeRigidBody(b.rb); b.rb = null; },
    fixed(f) { f.pos = new THREE.Vector3().copy(f.pos); f.quat = new THREE.Quaternion().copy(f.quat || new THREE.Quaternion()); if (usingRapier()) makeFixed(f); else if (!lite) fixedQ.push(f); return f; },
    unfix(f) { if (f.rb && world) world.removeRigidBody(f.rb); f.rb = null; const i = fixedQ.indexOf(f); if (i >= 0) fixedQ.splice(i, 1); },
    setGravity(g) { G = g; if (world) world.gravity = { x: 0, y: -g, z: 0 }; },
    // voxel chunk mesh became a collider (or went away)
    setTerrainMesh(key, mesh) {
      if (!usingRapier()) { if (!lite) readyP.then((ok) => ok && api.setTerrainMesh(key, mesh)); return; }
      const old = vox.get(key); if (old) { world.removeCollider(old, false); vox.delete(key); }
      if (!mesh) return;
      const p = mesh.geometry.attributes.position.array, idx = mesh.geometry.index.array, v = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) { v[i] = p[i] + mesh.position.x; v[i + 1] = p[i + 1] + mesh.position.y; v[i + 2] = p[i + 2] + mesh.position.z; }
      vox.set(key, world.createCollider(R.ColliderDesc.trimesh(v, new Uint32Array(idx)).setFriction(0.8)));
    },
    // the heightfield under a tile changed (a hole was cut, or it became voxels)
    dropTile(key) { const c = tiles.get(key); if (c && world) world.removeCollider(c, false); tiles.delete(key); },
    wake(b) { if (b.rb) b.rb.wakeUp(); b.sleep = false; b.still = 0; },
    impulse(b, v) { api.wake(b); b.skip = 3; if (b.rb) b.rb.applyImpulse({ x: v.x * b.mass, y: v.y * b.mass, z: v.z * b.mass }, true); else b.vel.add(v); },
    setVel(b, v) { api.wake(b); b.skip = 3; if (b.rb) b.rb.setLinvel({ x: v.x, y: v.y, z: v.z }, true); else b.vel.copy(v); },
    spin(b, w) { if (b.rb) b.rb.setAngvel({ x: w.x, y: w.y, z: w.z }, true); else b.ang.copy(w); },
    // hold a body near a point (hands / stone lift): a stiff spring on velocity, no gravity
    carry(b, target, dt, k = 14) {
      api.wake(b); b.held = true;
      const v = new THREE.Vector3().subVectors(target, b.pos).multiplyScalar(k); const l = v.length(); if (l > 16) v.multiplyScalar(16 / l);
      if (b.rb) { b.rb.setGravityScale(0, true); b.rb.setLinvel({ x: v.x, y: v.y, z: v.z }, true); const w = b.rb.angvel(); b.rb.setAngvel({ x: w.x * 0.85, y: w.y * 0.85, z: w.z * 0.85 }, true); }
      else { b.vel.copy(v); b.ang.multiplyScalar(0.85); }
      void dt;
    },
    release(b) { b.held = false; if (b.rb) b.rb.setGravityScale(1, true); },
    step(dt, focus) {
      if (usingRapier()) stepRapier(dt, focus); else if (lite) stepLite(dt);
      for (const b of bodies) if (b.mesh) { b.mesh.position.copy(b.pos); b.mesh.quaternion.copy(b.quat); }
    },
    // ray vs bodies (bounding spheres, then a box/sphere test): what is under the crosshair
    pick(o, d, maxD = 3, filter = null) {
      let best = null, bt = maxD;
      for (const b of bodies) {
        if (filter && !filter(b)) continue;
        const ox = b.pos.x - o.x, oy = b.pos.y - o.y, oz = b.pos.z - o.z, t = ox * d.x + oy * d.y + oz * d.z;
        if (t < 0 || t - b.radius > bt) continue;
        const dd = ox * ox + oy * oy + oz * oz - t * t, r = b.radius * (b.shape.type === 'box' ? 0.9 : 1.05);
        if (dd > r * r) continue;
        const th = t - Math.sqrt(Math.max(0, r * r - dd)); if (th < bt) { bt = th; best = b; }
      }
      return best ? { body: best, t: bt } : null;
    },
    get count() { return bodies.size; },
  };
  // ---- Rapier stepping, with ground tiles only where something is moving
  let acc = 0;
  const eq = () => null;
  function ensureTiles(b) {
    const cx = Math.floor(b.pos.x / TILE), cz = Math.floor(b.pos.z / TILE);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const key = (cx + i) + ',' + (cz + j); if (tiles.has(key)) continue;
      const t = heightTile(cx + i, cz + j); // null when the column is voxels (its chunk meshes collide)
      tiles.set(key, t ? world.createCollider(R.ColliderDesc.trimesh(t.pos, t.idx).setFriction(0.8)) : null);
    }
  }
  function stepRapier(dt, focus) {
    acc += Math.min(dt, 0.1); let n = 0;
    for (const b of bodies) if (!b.rb.isSleeping() || b.held) ensureTiles(b);
    while (acc >= 1 / 60 && n < 3) { world.step(); acc -= 1 / 60; n++; }
    if (n === 3) acc = 0;
    for (const b of bodies) {
      const t = b.rb.translation(), q = b.rb.rotation(), v = b.rb.linvel();
      b.prevV.copy(b.vel); b.pos.set(t.x, t.y, t.z); b.quat.set(q.x, q.y, q.z, q.w); b.vel.set(v.x, v.y, v.z);
      b.sleep = b.rb.isSleeping();
      impactCheck(b);
      if (b.pos.y < -2000) api.remove(b);
    }
    // forget far tiles
    if (tiles.size > 120 && focus) for (const [k, c] of tiles) { const [x, z] = k.split(',').map(Number); if (Math.hypot((x + 0.5) * TILE - focus.x, (z + 0.5) * TILE - focus.z) > 90) { if (c) world.removeCollider(c, false); tiles.delete(k); } }
    void eq;
  }
  // a sudden change of velocity is an impact (works the same for both backends)
  function impactCheck(b) {
    if (b.held) return;
    const dv = Math.hypot(b.vel.x - b.prevV.x, b.vel.y - b.prevV.y, b.vel.z - b.prevV.z);
    // velocity we set ourselves (a throw, a push, being carried) is not an impact
    if (b.skip > 0 || b.held) { b.skip = (b.skip || 1) - 1; return; }
    if (dv > 2.2 && b.onImpact && performance.now() - b.born > 250) b.onImpact(b, dv);
  }
  // ---- light integrator (phones): spheres on the ground, simple stacking, gentle tumbling
  const lstep = 1 / 30; let lacc = 0; const tq = new THREE.Quaternion(), ax = new THREE.Vector3();
  function stepLite(dt) {
    lacc += Math.min(dt, 0.1);
    while (lacc >= lstep) {
      lacc -= lstep;
      for (const b of bodies) {
        if (b.sleep && !b.held) continue;
        b.prevV.copy(b.vel);
        if (!b.held) b.vel.y -= G * lstep;
        b.pos.addScaledVector(b.vel, lstep);
        const rr = b.shape.type === 'box' ? Math.min(b.shape.hx, b.shape.hy, b.shape.hz) * 1.15 : b.shape.type === 'cyl' ? b.shape.r : b.radius * 0.8;
        const g = env.top(b.pos.x, b.pos.z, b.pos.y + rr);
        if (b.pos.y - rr < g) {
          b.pos.y = g + rr;
          if (b.vel.y < 0) b.vel.y = -b.vel.y * b.restitution;
          const f = Math.max(0, 1 - b.friction * 6 * lstep * (env.friction ? env.friction(b.pos.x, b.pos.y - rr, b.pos.z) : 1));
          b.vel.x *= f; b.vel.z *= f; b.ang.multiplyScalar(0.9);
          // roll with the motion
          ax.set(b.vel.z, 0, -b.vel.x); const sp = ax.length(); if (sp > 1e-3) { ax.divideScalar(sp); b.ang.lerp(ax.multiplyScalar(sp / Math.max(0.1, rr)), 0.3); }
        }
        const w = b.ang.length(); if (w > 1e-4) { tq.setFromAxisAngle(ax.copy(b.ang).divideScalar(w), w * lstep); b.quat.premultiply(tq); }
        // bodies push each other apart (crude stacking)
        for (const o of bodies) {
          if (o === b) continue; const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z, d = Math.hypot(dx, dy, dz), m = (b.radius + o.radius) * 0.8;
          if (d > 1e-4 && d < m) { const k = (m - d) / d * (o.mass / (o.mass + b.mass)); b.pos.x += dx * k; b.pos.y += dy * k; b.pos.z += dz * k; if (dy > 0 && b.vel.y < 0) b.vel.y *= 0.3; if (o.sleep) { o.sleep = false; o.still = 0; } }
        }
        b.still = b.vel.lengthSq() < 0.01 ? b.still + lstep : 0;
        if (b.still > 1.2 && !b.held) { b.sleep = true; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0); }
        impactCheck(b);
      }
    }
  }
  return api;
}
