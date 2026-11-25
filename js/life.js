// Calm garden life: drifting motes, a few settling petals, and stones that tumble when
// tapped then settle back. Rapier runs on PC (lazy, after first frame). Phones use a
// tiny integrator so we do not pull a 4 MB wasm on first load.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const dummy = new THREE.Object3D();

function floorAt(x, z, inSand, inPond, pondLevel) {
  if (inPond && inPond(x, z, -0.15)) return pondLevel + 0.02;
  if (inSand && inSand(x, z)) return 0.13;
  return 0.03;
}

function makeMotes(scene, P) {
  const n = P.cls === 'pc' ? 48 : 14;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const ph = new Float32Array(n);
  const rnd = mulberry32(404);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -12 + rnd() * 28;
    pos[i * 3 + 1] = 0.4 + rnd() * 3.4;
    pos[i * 3 + 2] = -10 + rnd() * 20;
    ph[i] = rnd() * 6.28;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uI: { value: 0 }, uScale: { value: 10 }, uTime: { value: 0 } },
    vertexShader: `
      attribute float aPh; uniform float uScale, uTime, uI; varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.21 + aPh) * 0.45;
        p.z += cos(uTime * 0.17 + aPh * 1.3) * 0.35;
        p.y += sin(uTime * 0.31 + aPh * 0.7) * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.6 + 0.4 * sin(aPh * 3.0)) / max(0.8, -mv.z);
        vA = uI * (0.45 + 0.55 * sin(aPh + uTime * 0.4));
      }`,
    fragmentShader: `varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = exp(-r * r * 9.0) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.72) * a, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'lightMotes';
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    update(now, ts, px) {
      const day = Math.max(0, 1 - (ts.night || 0));
      const elev = ts.elev != null ? Math.max(0, Math.sin((ts.elev * Math.PI) / 180)) : day;
      mat.uniforms.uI.value = 0.55 * day * (0.35 + 0.65 * elev);
      mat.uniforms.uTime.value = now;
      mat.uniforms.uScale.value = px;
      pts.visible = mat.uniforms.uI.value > 0.02;
    },
  };
}

function petalGeo(season) {
  const s = new THREE.Shape();
  if (season === 'spring') {
    s.moveTo(0, -0.03);
    s.bezierCurveTo(0.028, -0.02, 0.025, 0.02, 0.008, 0.03);
    s.lineTo(0, 0.022); s.lineTo(-0.008, 0.03);
    s.bezierCurveTo(-0.025, 0.02, -0.028, -0.02, 0, -0.03);
  } else {
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const rr = k % 2 === 0 ? (k === 6 || k === 8 ? 0.035 : 0.052) : 0.024;
      const x = Math.sin(a) * rr, y = Math.cos(a) * rr;
      if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
  }
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function makePetals(scene, P, season, inSand, inPond, pondLevel) {
  const n = P.cls === 'pc' ? 16 : 6;
  const colors = {
    spring: ['#f6c6d6', '#fbe3ec', '#eaa0bb', '#fff3f7'],
    summer: ['#5d8a34', '#7fa448', '#4a7a2c', '#94b45a'],
    autumn: ['#c0301c', '#e86a2a', '#f0b23a', '#a8281a'],
    winter: ['#8a7462', '#7a634e', '#9a8470', '#6e5a48'],
  }[season] || ['#7fa448'];
  const mesh = new THREE.InstancedMesh(petalGeo(season), new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide,
  }), n);
  mesh.name = 'physicsPetals';
  mesh.frustumCulled = false;
  scene.add(mesh);
  const cols = colors.map((c) => new THREE.Color(c));
  const sources = [[18.5, -7.5, 6.5], [-16.5, -8.5, 6], [1.5, -7.2, 2.4], [-6, -1, 3]];
  const bodies = [];
  function spawn(b, initial) {
    const s = sources[Math.floor(Math.random() * sources.length)];
    b.x = s[0] + (Math.random() - 0.5) * 3;
    b.z = s[1] + (Math.random() - 0.5) * 3;
    b.y = s[2] * (0.5 + Math.random() * 0.5);
    if (initial) { b.y = 1.2 + Math.random() * 3.5; b.x = (Math.random() - 0.5) * 20; b.z = (Math.random() - 0.5) * 16; }
    b.vx = (Math.random() - 0.5) * 0.25;
    b.vz = (Math.random() - 0.5) * 0.25;
    b.vy = -0.15 - Math.random() * 0.2;
    b.rx = Math.random() * 6; b.ry = Math.random() * 6; b.rz = Math.random() * 6;
    b.wx = (Math.random() - 0.5) * 2; b.wy = (Math.random() - 0.5) * 1.4; b.wz = (Math.random() - 0.5) * 2;
    b.rest = 0; b.onWater = false;
  }
  for (let i = 0; i < n; i++) {
    const b = { i }; spawn(b, true); bodies.push(b);
    mesh.setColorAt(i, cols[i % cols.length]);
  }
  const scale = season === 'spring' ? 1.3 : 1.6;
  return {
    mesh, bodies, n,
    burst() { bodies.forEach((b) => { b.rest = 0; spawn(b, false); b.y = 2.2 + Math.random() * 2.5; }); },
    update(dt, now) {
      for (const b of bodies) {
        if (b.rest > 0) {
          b.rest -= dt;
          if (b.onWater) { b.x += Math.sin(now * 0.2 + b.i) * 0.05 * dt; b.z += Math.cos(now * 0.17 + b.i) * 0.05 * dt; }
          if (b.rest <= 0) spawn(b, false);
        } else {
          b.vy -= 1.6 * dt;
          b.vx += Math.sin(now * 0.9 + b.i) * 0.15 * dt;
          b.vz += Math.cos(now * 0.7 + b.i) * 0.12 * dt;
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          b.rx += b.wx * dt; b.ry += b.wy * dt; b.rz += b.wz * dt;
          const floor = floorAt(b.x, b.z, inSand, inPond, pondLevel);
          if (b.y <= floor) {
            b.y = floor; b.vy = 0; b.vx *= 0.3; b.vz *= 0.3;
            b.wx *= 0.2; b.wz *= 0.2;
            const wet = inPond && inPond(b.x, b.z, -0.15);
            b.rest = wet ? 18 + Math.random() * 14 : 6 + Math.random() * 10;
            b.onWater = wet;
            b.rx = 0; b.rz = 0;
          }
        }
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(b.rx, b.ry, b.rz);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(b.i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function makeStones(gardenRocks) {
  const recs = (gardenRocks && gardenRocks.records) || [];
  const rest = new Map();
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const euler = new THREE.Euler();
  recs.forEach((r) => {
    r.im.getMatrixAt(r.i, m4);
    m4.decompose(pos, quat, scl);
    rest.set(r, { px: pos.x, py: pos.y, pz: pos.z, qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w, sx: scl.x, sy: scl.y, sz: scl.z });
    r._phys = null;
  });
  const active = [];
  const maxActive = 8;
  function applyMatrix(r, st) {
    quat.set(st.qx, st.qy, st.qz, st.qw);
    m4.compose(pos.set(st.px, st.py, st.pz), quat, scl.set(st.sx, st.sy, st.sz));
    r.im.setMatrixAt(r.i, m4);
    r.im.instanceMatrix.needsUpdate = true;
  }
  function tumble(r, dir) {
    if (!r || !rest.has(r)) return false;
    const rs = rest.get(r);
    let st = r._phys;
    if (!st) {
      if (active.length >= maxActive) {
        const old = active.shift();
        applyMatrix(old.r, rest.get(old.r));
        old.r._phys = null;
      }
      st = r._phys = {
        r, ...rs,
        vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
        t: 0, recover: false,
        _R: attachRapier._rapier && attachRapier._rapier.R,
        _world: attachRapier._rapier && attachRapier._rapier.world,
      };
      active.push(st);
    }
    const side = dir && dir.length() > 0 ? dir.clone().normalize() : new THREE.Vector3((Math.random() - 0.5), 0, (Math.random() - 0.5)).normalize();
    const ix = side.x * (1.3 + Math.random() * 0.6);
    const iz = side.z * (1.3 + Math.random() * 0.6);
    const iy = 1.1 + Math.random() * 0.5;
    st.vx += ix; st.vz += iz; st.vy += iy;
    st.wx += (Math.random() - 0.5) * 6;
    st.wz += (Math.random() - 0.5) * 6;
    st.wy += (Math.random() - 0.5) * 2;
    st.t = 0;
    st.recover = false;
    if (st._R && st._world && !st.body) {
      const R = st._R, world = st._world;
      const rb = R.RigidBodyDesc.dynamic()
        .setTranslation(st.px, st.py, st.pz)
        .setRotation({ x: st.qx, y: st.qy, z: st.qz, w: st.qw })
        .setLinearDamping(1.15).setAngularDamping(1.3).setCanSleep(true);
      st.body = world.createRigidBody(rb);
      const hx = Math.max(0.08, st.sx * 0.35), hy = Math.max(0.06, st.sy * 0.3), hz = Math.max(0.08, st.sz * 0.35);
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.16).setFriction(0.75), st.body);
    }
    if (st.body) {
      st.body.wakeUp();
      st.body.setLinvel({ x: st.vx, y: st.vy, z: st.vz }, true);
      st.body.setAngvel({ x: st.wx, y: st.wy, z: st.wz }, true);
      st.body.applyImpulse({ x: ix * 0.4, y: iy * 0.4, z: iz * 0.4 }, true);
    }
    return true;
  }
  function attachRapier(rapier) {
    active.forEach((st) => { st._R = rapier.R; st._world = rapier.world; });
    attachRapier._rapier = rapier;
  }
  function update(dt, inSand, inPond, pondLevel, rapier) {
    if (rapier && rapier.world && !attachRapier._rapier) attachRapier(rapier);
    const hz = 1 / 45;
    // simple fixed-ish step; callers already cap dt
    for (let i = active.length - 1; i >= 0; i--) {
      const st = active[i];
      st.t += dt;
      if (!st.recover && st.t > 1.35) st.recover = true;
      const rs = rest.get(st.r);
      const snapOff = () => {
        if (st.body && st._world) { try { st._world.removeRigidBody(st.body); } catch (e) { /* already gone */ } st.body = null; }
        Object.assign(st, rs);
        applyMatrix(st.r, rs);
        st.r._phys = null;
        active.splice(i, 1);
      };
      if (st.body) {
        if (st.recover) {
          const t0 = st.body.translation(), r0 = st.body.rotation();
          st.body.applyImpulse({ x: (rs.px - t0.x) * 2.2, y: (rs.py - t0.y) * 2.2, z: (rs.pz - t0.z) * 2.2 }, true);
          const d = Math.hypot(t0.x - rs.px, t0.y - rs.py, t0.z - rs.pz);
          if (d < 0.03 && st.t > 2.0) { snapOff(); continue; }
        }
        const t0 = st.body.translation(), r0 = st.body.rotation();
        st.px = t0.x; st.py = t0.y; st.pz = t0.z;
        st.qx = r0.x; st.qy = r0.y; st.qz = r0.z; st.qw = r0.w;
        applyMatrix(st.r, st);
        continue;
      }
      if (st.recover) {
        // spring back to the rest pose so the garden is not left messy
        st.vx += (rs.px - st.px) * 6 * dt;
        st.vy += (rs.py - st.py) * 6 * dt;
        st.vz += (rs.pz - st.pz) * 6 * dt;
        st.vx *= Math.pow(0.08, dt);
        st.vy *= Math.pow(0.08, dt);
        st.vz *= Math.pow(0.08, dt);
        st.wx *= Math.pow(0.05, dt);
        st.wy *= Math.pow(0.05, dt);
        st.wz *= Math.pow(0.05, dt);
        // slerp quaternion toward rest
        const q = new THREE.Quaternion(st.qx, st.qy, st.qz, st.qw);
        const qRest = new THREE.Quaternion(rs.qx, rs.qy, rs.qz, rs.qw);
        q.slerp(qRest, Math.min(1, 4 * dt));
        st.qx = q.x; st.qy = q.y; st.qz = q.z; st.qw = q.w;
        const d = Math.hypot(st.px - rs.px, st.py - rs.py, st.pz - rs.pz);
        if (d < 0.012 && st.t > 2.0) { snapOff(); continue; }
      } else {
        st.vy -= 9.81 * dt;
        st.vx *= Math.pow(0.55, dt);
        st.vz *= Math.pow(0.55, dt);
      }
      st.px += st.vx * dt;
      st.py += st.vy * dt;
      st.pz += st.vz * dt;
      // integrate spin into quaternion
      const w = new THREE.Vector3(st.wx, st.wy, st.wz);
      const q = new THREE.Quaternion(st.qx, st.qy, st.qz, st.qw);
      const dq = new THREE.Quaternion(w.x, w.y, w.z, 0).multiply(q);
      q.x += dq.x * 0.5 * dt; q.y += dq.y * 0.5 * dt; q.z += dq.z * 0.5 * dt; q.w += dq.w * 0.5 * dt;
      q.normalize();
      st.qx = q.x; st.qy = q.y; st.qz = q.z; st.qw = q.w;
      const floor = floorAt(st.px, st.pz, inSand, inPond, pondLevel) + Math.max(0.04, st.sy * 0.15);
      if (st.py < floor) {
        st.py = floor;
        if (st.vy < 0) st.vy *= -0.18;
        st.vx *= 0.7; st.vz *= 0.7;
        st.wx *= 0.6; st.wz *= 0.6;
      }
      applyMatrix(st.r, st);
    }
    void hz;
  }
  function pick(raycaster) {
    const meshes = [];
    const seen = new Set();
    recs.forEach((r) => { if (!seen.has(r.im)) { seen.add(r.im); meshes.push(r.im); } });
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const rec = recs.find((r) => r.im === h.object && r.i === h.instanceId);
    if (!rec) return null;
    return { rec, point: h.point, dist: h.distance, kind: 'stone' };
  }
  return { tumble, update, pick, rest, recs, attachRapier };
}

export async function createLife({ scene, P, season, gardenRocks, inSand, inPond, pondLevel }) {
  const motes = makeMotes(scene, P);
  const petals = makePetals(scene, P, season, inSand, inPond, pondLevel);
  const stones = makeStones(gardenRocks);
  let rapier = null;
  if (P.cls === 'pc') {
    import('../vendor/rapier/rapier.mjs').then(async (mod) => {
      const R = mod.default || mod;
      if (R.init) await R.init();
      const world = new R.World({ x: 0.0, y: -9.81, z: 0.0 });
      const ground = R.ColliderDesc.cuboid(40, 0.05, 40);
      world.createCollider(ground, world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0)));
      rapier = { R, world };
    }).catch((e) => { console.warn('[life] rapier skipped', e && e.message); });
  }
  let acc = 0;
  const step = P.cls === 'pc' ? 1 / 45 : 1 / 30;
  return {
    update(dt, now, ts, px) {
      motes.update(now, ts, px || 10);
      acc += Math.min(0.05, dt);
      while (acc >= step) {
        petals.update(step, now);
        stones.update(step, inSand, inPond, pondLevel, rapier && rapier.world);
        if (rapier && rapier.world) rapier.world.timestep = step, rapier.world.step();
        acc -= step;
      }
    },
    tumble(rec, dir) { return stones.tumble(rec, dir); },
    pickStone(raycaster) { return stones.pick(raycaster); },
    burstPetals() { petals.burst(); },
    tumbleNearest(x, z) {
      let best = null, bd = 1e9;
      stones.recs.forEach((r) => {
        const d = (r.x - x) ** 2 + (r.z - z) ** 2;
        if (d < bd) { bd = d; best = r; }
      });
      if (best) stones.tumble(best, new THREE.Vector3(0.4, 0, 0.2));
      return best ? { x: best.x, z: best.z, name: best.name } : null;
    },
  };
}
