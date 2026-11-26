// World "space": the in-between. A real-scale Earth (km) lit by the real sun right now, the moon
// where it really is, and the little rocket in the foreground. It plays a short calm flight:
//   onEnter({ to: 'moon' })  Longmont -> orbit -> the whole Earth -> the moon
//   onEnter({ to: 'earth' }) the moon -> Earth -> a warm re-entry -> home
// Two passes: the far scene (km) and the near scene (metres: the rocket), so depth stays precise.
import * as THREE from 'three';
import { buildRocket } from '../game/rocket.js';
import { sunNow, moonNow, llDir, HOME } from '../game/astro.js';
import { getHud, setActive } from '../game/session.js';

const RE = 6371, RM = 1737, DM = 384400;
export async function createSpace({ renderer, P, engine, worlds, audio, params }) {
  const lite = P.cls !== 'pc';
  const hud = getHud(P);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#000005');
  const near = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, engine.width / engine.height, 5, 3e6);
  const ncam = new THREE.PerspectiveCamera(50, engine.width / engine.height, 0.1, 2000);
  const loader = new THREE.TextureLoader();
  const tier = lite ? 'phone' : 'pc';
  const load = (u) => new Promise((res) => loader.load(u, (t) => res(t), undefined, () => res(null)));
  const [dayT, nightT, moonT] = await Promise.all([load(`assets/space/earth-${tier}.webp`), load(`assets/space/lights-${tier}.webp`), load('assets/space/moon.webp')]);
  for (const t of [dayT, moonT]) if (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }

  // ---- Earth: day map, city lights on the night side, a warm terminator, soft clouds
  const sunDir = new THREE.Vector3();
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uDay: { value: dayT }, uNight: { value: nightT }, uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uDay, uNight; uniform vec3 uSun; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }
      void main(){
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float d = dot(N, uSun);
        vec3 day = texture2D(uDay, vUv).rgb; day = pow(day, vec3(2.2));
        float lights = texture2D(uNight, vUv).r; lights = pow(lights, 1.6);
        float lit = smoothstep(-0.08, 0.25, d);
        // clouds: drifting fbm on the sphere, brighter by day
        vec3 cp = N * vec3(5.0, 9.0, 5.0) + vec3(uTime * 0.004, 0., uTime * 0.002);
        float c = smoothstep(0.56, 0.86, fbm(cp + fbm(cp * 1.7) * 1.3) * 0.8 + n3(cp * 9.) * 0.22) * 0.9;
        vec3 col = day * (0.04 + 1.25 * max(d, 0.)) ;
        col = mix(col, vec3(1.0) * (0.03 + 1.1 * max(d, 0.)), c * 0.85);
        // ocean glint
        vec3 Hh = normalize(uSun + V); float ocean = step(day.b, day.r * 0.9 + 0.02) < 0.5 ? 1.0 : 0.0;
        float sp = max(dot(N, Hh), 0.);
        col += vec3(1.0, 0.92, 0.8) * (pow(sp, 60.) * 0.25 + pow(sp, 700.) * 1.4) * ocean * (1. - c) * step(0., d);
        // warm band at the terminator and the city lights after dark
        col += vec3(1.0, 0.45, 0.15) * exp(-pow(d * 7.0, 2.)) * 0.12;
        col += vec3(1.0, 0.72, 0.38) * lights * (1. - lit) * (1. - c * 0.7) * 1.4;
        // a thin blue haze toward the limb
        float rim = pow(1. - max(dot(N, V), 0.), 5.);
        col = mix(col, vec3(0.35, 0.6, 1.0) * (0.15 + lit), rim * 0.45 * smoothstep(-0.3, 0.3, d));
        gl_FragColor = vec4(pow(col, vec3(1./2.2)), 1.);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(RE, lite ? 96 : 160, lite ? 64 : 112), earthMat);
  scene.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(RE * 1.03, lite ? 64 : 96, lite ? 48 : 64), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } }, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN);
        // back faces of a shell 3% above the ground: x runs from about -0.24 at the planet's limb to 0
        // at the shell's edge, so the glow is densest against the planet and thins out into space
        float x = dot(N, V); float f = pow(clamp(-x / 0.24, 0., 1.), 2.2);
        float sd = dot(N, uSun);
        float lit = smoothstep(-0.25, 0.35, sd);
        // Rayleigh blue by day, a thin amber band where the sun is setting through it
        vec3 c = mix(vec3(1.0, 0.55, 0.3), vec3(0.3, 0.55, 1.0), smoothstep(-0.05, 0.35, sd));
        gl_FragColor = vec4(c * f * lit * 1.25, f * lit); }`,
  }));
  scene.add(atmo);
  // ---- the moon where it really is, lit by the sun
  const moonMat = new THREE.MeshStandardMaterial({ map: moonT, color: moonT ? '#ffffff' : '#bdbab4', roughness: 1 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(RM, 64, 48), moonMat);
  scene.add(moon);
  const sunLight = new THREE.DirectionalLight('#fff6ea', 3.2); scene.add(sunLight); scene.add(sunLight.target);
  scene.add(new THREE.AmbientLight('#223', 0.08));
  // ---- stars + the sun's glow
  {
    const N = lite ? 2500 : 6000, pos = new Float32Array(N * 3), sz = new Float32Array(N), col = new Float32Array(N * 3);
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      v.randomDirection().multiplyScalar(2.5e6); pos.set([v.x, v.y, v.z], i * 3);
      const m = Math.pow(Math.random(), 6); sz[i] = 1 + m * 3.2;
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.25, 0.4 * Math.random(), 0.75 + m * 0.25); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sz, 1)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true, uniforms: { uPR: { value: 1 } },
      vertexShader: 'attribute float aS; varying vec3 vC; uniform float uPR; void main(){ vC = color; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = aS * uPR; }',
      fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vC, smoothstep(.5, .1, d)); }' });
    const stars = new THREE.Points(g, m); stars.frustumCulled = false; scene.add(stars); scene.userData.stars = m;
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,250,235,0.9)'); gr.addColorStop(0.25, 'rgba(255,220,170,0.25)'); gr.addColorStop(1, 'rgba(255,200,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(sunSprite);

  // ---- the rocket (near scene, metres)
  const R = buildRocket({ lite });
  for (const k in R.parts) R.parts[k].visible = true;
  const rig = new THREE.Group(); near.add(rig); rig.add(R.group); // rig follows the camera's turn
  near.add(new THREE.AmbientLight('#8090b0', 0.35));
  const nSun = new THREE.DirectionalLight('#fff3e0', 3.0); near.add(nSun); near.add(nSun.target);
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.6, 30, 16, 1, true).translate(0, -15, 0), new THREE.MeshBasicMaterial({ color: '#ffd7a0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  trail.visible = false; // the cone read as a grey beam; the flame and glow carry it
  const heat = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16).scale(1, 1.9, 1).translate(0, 9, 0), new THREE.MeshBasicMaterial({ color: '#ff8a3a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  R.group.add(heat);

  // ---- real positions right now
  const home = new THREE.Vector3(), moonPos = new THREE.Vector3(), tmp = new THREE.Vector3(), up = new THREE.Vector3();
  function placeBodies() {
    const s = sunNow(), m = moonNow();
    llDir(s.lat, s.lon, sunDir);
    llDir(m.lat, m.lon, moonPos).multiplyScalar(DM);
    moon.position.copy(moonPos);
    // keep the same face of the moon toward Earth
    moon.lookAt(0, 0, 0); moon.rotateY(-Math.PI / 2);
    sunLight.position.copy(sunDir).multiplyScalar(1e6); sunLight.target.position.set(0, 0, 0);
    sunSprite.position.copy(sunDir).multiplyScalar(2.2e6); sunSprite.scale.setScalar(1.6e5);
    llDir(HOME.lat, HOME.lon, home).multiplyScalar(RE);
    return { s, m };
  }
  placeBodies();

  // ---- the flight
  let F = null; // { to, t, dur }
  const ease = (t) => t * t * (3 - 2 * t);
  const camLook = new THREE.Vector3(), camPos = new THREE.Vector3();
  const east = new THREE.Vector3();
  function frameOut(t) {
    // 0..1 over the whole outbound flight
    const n = home.clone().normalize();
    east.set(0, 1, 0).cross(n).normalize();
    const north = n.clone().cross(east).normalize();
    if (t < 0.36) {
      // climbing over Colorado: curvature and the blue limb ahead
      const k = t / 0.36, alt = 40 + Math.pow(k, 2.2) * 1800;
      camPos.copy(n).multiplyScalar(RE + alt).addScaledVector(east, -alt * 0.25 + k * 900);
      camLook.copy(n).multiplyScalar(RE * 0.98).addScaledVector(east, 2400 + k * 2000).addScaledVector(north, 200);
      rocketPose(new THREE.Vector3(1.5, -2.5 + k * 1.0, -42 + k * 6), -0.35, 0.9);
    } else if (t < 0.66) {
      // pulling back to see the whole Earth, day and night
      const k = ease((t - 0.36) / 0.3), alt = 2000 + Math.pow(k, 1.6) * 34000;
      camPos.copy(n).multiplyScalar(RE + alt).addScaledVector(east, 3000 + k * 9000).addScaledVector(north, -k * 6000);
      camLook.set(0, 0, 0);
      rocketPose(new THREE.Vector3(3 - k * 2, -1 + k * 2, -40 - k * 260), -0.6, 0.7 * (1 - k));
    } else {
      // toward the moon
      const k = ease((t - 0.66) / 0.34);
      const start = n.clone().multiplyScalar(RE + 36000).addScaledVector(east, 12000).addScaledVector(north, -6000);
      const stop = moonPos.clone().addScaledVector(moonPos.clone().normalize(), -RM * 2.6).addScaledVector(up.set(0, 1, 0), RM * 0.6);
      camPos.lerpVectors(start, stop, Math.pow(k, 2.4));
      camLook.lerpVectors(new THREE.Vector3(0, 0, 0), moonPos, Math.min(1, k * 1.8));
      rocketPose(new THREE.Vector3(0, -1.5, -60 - (1 - k) * 200), 0, 0.35);
    }
  }
  function frameHome(t) {
    const n = home.clone().normalize();
    east.set(0, 1, 0).cross(n).normalize();
    if (t < 0.55) {
      const k = ease(t / 0.55);
      const start = moonPos.clone().addScaledVector(moonPos.clone().normalize(), -RM * 3.2);
      const stop = n.clone().multiplyScalar(RE + 30000).addScaledVector(east, -9000);
      camPos.lerpVectors(start, stop, 1 - Math.pow(1 - k, 2.4));
      camLook.lerpVectors(moonPos, new THREE.Vector3(0, 0, 0), Math.min(1, k * 1.6));
      rocketPose(new THREE.Vector3(0, -1.5, -70), Math.PI, 0.3);
    } else {
      const k = ease((t - 0.55) / 0.45), alt = 30000 * Math.pow(1 - k, 2.6) + 60;
      camPos.copy(n).multiplyScalar(RE + alt).addScaledVector(east, -alt * 0.3);
      camLook.copy(n).multiplyScalar(RE * 0.99).addScaledVector(east, 1500 + alt * 0.2);
      rocketPose(new THREE.Vector3(1.0, -1.5, -36), Math.PI * 0.92, 0.15);
      heat.material.opacity = Math.sin(Math.min(1, k * 1.3) * Math.PI) * 0.45;
    }
  }
  let rocketFlame = 0;
  // p: camera-space metres (-z ahead); roll: a gentle bank
  function rocketPose(p, roll, flame) { R.group.position.copy(p); R.group.rotation.set(-1.25, 0, roll * 0.3); rocketFlame = flame; }

  let clock = 0;
  function frame(dt) {
    clock += dt;
    renderer.toneMappingExposure = 1.0;
    audio.update(dt, { world: 'space', zone: 'space', biome: 'space', camera, gust: 0, night: 1, rain: 0, mist: 0, speed: 0, altitude: 0 });
    earthMat.uniforms.uTime.value = clock;
    if (F) {
      F.t += dt;
      const t = Math.min(1, F.t / F.dur);
      (F.to === 'moon' ? frameOut : frameHome)(t);
      // a few quiet mission lines along the way
      const lines = F.to === 'moon'
        ? [[0.04, 'Orbit. The engine falls quiet'], [0.3, 'Leaving Earth behind'], [0.62, 'Coasting to the moon'], [0.88, 'Lining up to land']]
        : [[0.05, 'Turning for home'], [0.55, 'Earth growing in the window'], [0.82, 'Re-entry: a warm glow, then the garden']];
      for (const [at, line] of lines) if (t >= at && !F.said[at]) { F.said[at] = true; if (t - at < 0.05) hud.toast(line, null, 3400); }
      if (t >= 1 && !F.done) { F.done = true; finish(); }
    }
    camera.position.copy(camPos); camera.lookAt(camLook);
    ncam.quaternion.copy(camera.quaternion); ncam.position.set(0, 0, 0);
    // the rocket lives in camera space so it stays crisp at any distance
    R.setFlame(rocketFlame, clock);
    rig.quaternion.copy(camera.quaternion);
    nSun.position.copy(sunDir).multiplyScalar(100);
    renderer.autoClear = false; renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(near, ncam);
    renderer.autoClear = true;
  }
  async function finish() {
    await hud.fadeTo(1, 1400);
    try {
      if (F.to === 'moon') await worlds.go('moon', { from: 'space' });
      else await worlds.go('earth', { from: 'space' });
    } catch (e) { console.info('[G] moon not ready, heading home', e.message); await worlds.go('earth', { from: 'space' }); }
  }
  function resize(w, h) { camera.aspect = ncam.aspect = w / h; camera.updateProjectionMatrix(); ncam.updateProjectionMatrix(); scene.userData.stars.uniforms.uPR.value = Math.min(2, engine.pixelRatio); }
  resize(engine.width, engine.height);
  const noop = () => {};
  return {
    id: 'space', scene, camera, resize, frame, moving: true,
    input: { down: noop, move: noop, up: noop, leave: noop },
    degrade() { return false; },
    debug: { info: () => ({ world: 'space', t: F ? +(F.t / F.dur).toFixed(2) : null, to: F && F.to, device: P.cls, totalCalls: renderer.info.render.calls, totalTris: renderer.info.render.triangles }), seek(t) { if (F) F.t = t * F.dur; } },
    onEnter(arg = {}) {
      placeBodies();
      F = { said: {}, to: arg.to || 'moon', t: 0, dur: params.has('fastspace') ? 6 : (arg.to === 'earth' ? 20 : 30) };
      heat.material.opacity = 0;
      hud.setMode('cinematic'); setActive({});
      if (arg.seek) F.t = arg.seek * F.dur;
      frameOut(0);
      hud.fadeTo(0, 1600);
    },
  };
}
