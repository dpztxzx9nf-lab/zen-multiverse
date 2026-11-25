// Rare, quiet delights: a shooting star at night, a red-crowned crane gliding over by day.
// Never on a schedule you can learn; never announced.
import * as THREE from 'three';
import { mergeGeometries, paintColor } from './util.js';

export function createSurprises(scene, { camera, params, audio }) {
  const forced = params.get('surprise');

  // ---- shooting star: a camera-facing streak with a soft head, high in the view
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(12), sUv = new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('uv', new THREE.BufferAttribute(sUv, 2));
  sGeo.setIndex([0, 2, 1, 2, 3, 1]);
  const sMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uA; varying vec2 vUv;
      void main() { float across = 1.0 - abs(vUv.y - 0.5) * 2.0; float along = pow(vUv.x, 2.2);
        float head = smoothstep(0.9, 1.0, vUv.x);
        vec3 c = mix(vec3(0.6, 0.75, 1.0), vec3(1.0, 0.97, 0.9), vUv.x) * (along * pow(across, 3.0) * 2.2 + head * across * 3.0);
        gl_FragColor = vec4(c * uA, 1.0); }`,
  });
  const star = new THREE.Mesh(sGeo, sMat);
  star.frustumCulled = false; star.visible = false; star.renderOrder = -5;
  scene.add(star);
  let starT = -1, starNext = forced === 'star' ? 0.05 : 25 + Math.random() * 90;
  const sA = new THREE.Vector3(), sB = new THREE.Vector3(), tmp = new THREE.Vector3(), side = new THREE.Vector3(), fwd = new THREE.Vector3();

  function launchStar() {
    camera.getWorldDirection(fwd);
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const yaw = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5) * hf * 0.6;
    // keep it above the hills (~10 deg) but inside the top of the frame
    const top = pitch + vf * 0.47;
    const el = Math.min(top - 0.04, Math.max(0.24, pitch + vf * (0.25 + Math.random() * 0.18)));
    const travel = (Math.random() < 0.5 ? -1 : 1) * hf * 0.4, drop = vf * 0.1;
    const R = 300;
    const at = (y, e) => new THREE.Vector3(Math.sin(y) * Math.cos(e), Math.sin(e), Math.cos(y) * Math.cos(e)).multiplyScalar(R).add(camera.position);
    sA.copy(at(yaw, el)); sB.copy(at(yaw + travel, el - drop));
    starT = forced === 'star' ? 0.45 : 0; star.visible = true;
    if (audio) audio.shimmer();
  }
  function updateStar(dt, night) {
    if (starT < 0) {
      if (night > 0.6) { starNext -= dt; if (starNext <= 0) { launchStar(); starNext = forced === 'star' ? 0.5 : 70 + Math.random() * 160; } }
      return;
    }
    starT += dt / (forced === 'star' ? 6 : 1.5);
    if (starT >= 1) { starT = -1; star.visible = false; return; }
    const headT = Math.min(1, starT * 1.25), tailT = Math.max(0, starT * 1.25 - 0.35);
    const H = tmp.copy(sA).lerp(sB, headT).clone();
    const T = sA.clone().lerp(sB, tailT);
    side.subVectors(H, T).cross(fwd.subVectors(camera.position, H)).normalize().multiplyScalar(0.9);
    const p = [T.clone().sub(side), T.clone().add(side), H.clone().sub(side), H.clone().add(side)];
    p.forEach((v, i) => sPos.set([v.x, v.y, v.z], i * 3));
    sGeo.attributes.position.needsUpdate = true;
    sMat.uniforms.uA.value = Math.sin(Math.PI * starT) * 1.3;
  }

  // ---- crane: white body, black neck and wingtips, red crown; slow wingbeats and glides
  const crane = new THREE.Group();
  const white = new THREE.Color('#f4f2ec'), black = new THREE.Color('#1c1c20'), red = new THREE.Color('#c8202a');
  const body = paintColor(new THREE.SphereGeometry(0.5, 14, 10).scale(0.55, 0.5, 1.5), white);
  const neck = paintColor(new THREE.CylinderGeometry(0.07, 0.11, 1.5, 6).rotateX(Math.PI / 2 - 0.15).translate(0, 0.12, 1.25), black);
  const head = paintColor(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.24, 2.0), white);
  const crown = paintColor(new THREE.SphereGeometry(0.07, 6, 5).translate(0, 0.33, 1.98), red);
  const beak = paintColor(new THREE.ConeGeometry(0.035, 0.42, 5).rotateX(Math.PI / 2).translate(0, 0.22, 2.3), new THREE.Color('#9a8a60'));
  const legs = paintColor(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 4).rotateX(Math.PI / 2 + 0.1).translate(0, -0.05, -1.35), black);
  const tail = paintColor(new THREE.ConeGeometry(0.25, 0.6, 6).rotateX(-Math.PI / 2).translate(0, 0.02, -0.85), black);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, emissive: '#3a3a40' });
  crane.add(new THREE.Mesh(mergeGeometries([body, neck, head, crown, beak, legs, tail].map((g) => g.index ? g.toNonIndexed() : g)), mat));
  function wingGeo(sign) {
    const s = new THREE.Shape();
    s.moveTo(0, 0.45); s.bezierCurveTo(1.2, 0.5, 2.2, 0.35, 2.9, -0.05);
    s.lineTo(2.6, -0.35); s.bezierCurveTo(1.8, -0.4, 0.9, -0.55, 0, -0.45); s.closePath();
    const g = new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const c = x > 2.0 || (z > 0.15 && x > 0.9) ? black : white;
      col.set([c.r, c.g, c.b], i * 3);
      p.setX(i, x * sign);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const wl = new THREE.Mesh(wingGeo(-1), mat), wr = new THREE.Mesh(wingGeo(1), mat);
  wl.position.set(-0.2, 0.15, 0.1); wr.position.set(0.2, 0.15, 0.1);
  crane.add(wl, wr);
  crane.scale.setScalar(1.1);
  crane.visible = false;
  scene.add(crane);
  let craneT = -1, craneNext = forced === 'crane' ? 0 : 45 + Math.random() * 120;
  const cFrom = new THREE.Vector3(), cTo = new THREE.Vector3(), cPos = new THREE.Vector3();
  let craneDur = 26;
  function launchCrane() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const zBase = -10 - Math.random() * 4;
    cFrom.set(-48 * dir, 6.2 + Math.random() * 1.0, zBase + 5);
    cTo.set(48 * dir, 7.0 + Math.random() * 1.2, zBase - 5);
    craneDur = 30 + Math.random() * 8;
    craneT = 0; crane.visible = true;
    if (audio) audio.craneCall();
  }
  function updateCrane(dt, now, day) {
    if (craneT < 0) {
      if (day > 0.5) { craneNext -= dt; if (craneNext <= 0) { launchCrane(); craneNext = 200 + Math.random() * 300; } }
      return;
    }
    craneT += dt / craneDur;
    if (craneT >= 1) { craneT = -1; crane.visible = false; return; }
    const t = forced === 'crane' ? 0.38 + craneT * 0.2 : craneT;
    cPos.copy(cFrom).lerp(cTo, t);
    cPos.y += Math.sin(t * Math.PI) * 1.2 + Math.sin(now * 0.6) * 0.25;
    crane.position.copy(cPos);
    tmp.copy(cTo).sub(cFrom).normalize();
    crane.rotation.set(0, Math.atan2(tmp.x, tmp.z), 0);
    crane.rotateZ(Math.sin(now * 0.3) * 0.08);
    // flap a few beats, then glide
    const cyc = (now % 7) / 7;
    const flap = cyc < 0.55 ? Math.sin(cyc / 0.55 * Math.PI * 4) : 0.12 * Math.sin(now * 0.8);
    wl.rotation.z = -flap * 0.55; wr.rotation.z = flap * 0.55;
    wl.rotation.x = wr.rotation.x = 0;
  }

  function update(dt, now, ts) {
    updateStar(dt, ts.night * (1 - (ts.overcast || 0)));
    updateCrane(dt, now, (1 - ts.night) * (1 - (ts.rain || 0)));
  }
  return { update, get state() { return { starT: +starT.toFixed(2), craneT: +craneT.toFixed(2), crane: crane.position.toArray().map((v) => +v.toFixed(1)), ndc: crane.position.clone().project(camera).toArray().map((v) => +v.toFixed(2)), vis: crane.visible, starVis: star.visible, sA: sA.clone().project(camera).toArray().map((v) => +v.toFixed(2)), p0: new THREE.Vector3().fromArray(sPos, 0).project(camera).toArray().map((v) => +v.toFixed(3)), p3: new THREE.Vector3().fromArray(sPos, 9).project(camera).toArray().map((v) => +v.toFixed(3)), uA: sMat.uniforms.uA.value }; } };
}
