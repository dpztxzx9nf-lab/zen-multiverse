// World "moon": grey regolith under a black sky, Earth hanging in it (lit by the real phase), low
// gravity, craters, her rocket on its legs, and a small base she builds from moon materials:
// a habitat, a greenhouse with a moon bonsai, and an antenna that listens. When it is finished a
// friendly fleet arrives and the guide teaches the warp drive (the star map).
import * as THREE from 'three';
import { fpFov } from '../game/player.js';
import { groundMaterial } from '../game/pbr.js';
import { loadModel } from '../game/models.js';
import { createWalkCore } from '../game/walkcore.js';
import { buildRocket } from '../game/rocket.js';
import { game, dayKey, itemInfo, UNLOCK_ALL } from '../game/store.js';
import { moonNow } from '../game/astro.js';
import { rng } from '../game/names.js';
import { openStarMap } from '../game/starmap.js';
import { icon } from '../game/icons.js';
import { createColliders } from '../colliders.js';
import { MODULES, UPGRADES, maxLevel, buildHabitat, buildGreenhouse, buildAntenna, buildSolar, decorateModule, buildMoonBonsai, buildShip, preloadModules } from '../game/moonbase.js';

const REFF = 9000; // a stylised small-world curvature: the horizon sits close, like on the real moon
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function createMoon({ renderer, canvas, P, params, engine, worlds, audio }) {
  const lite = P.cls !== 'pc';
  const G = game.data;
  G.moon = G.moon || { modules: {} }; G.moon.modules = G.moon.modules || {};
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#020309');
  const camera = new THREE.PerspectiveCamera(55, engine.width / engine.height, 0.1, 6000);

  // ---------------- terrain: gentle undulation, craters, a flattened base site
  const hashN = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hashN(ix, iz), b = hashN(ix + 1, iz), c = hashN(ix, iz + 1), d = hashN(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; };
  const fbm = (x, z, o = 4) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return s; };
  const R = rng(4242);
  const craters = [
    { x: -92, z: 96, r: 52, d: 0.2 },   // the big old crater: its floor stays in shadow (ice)
    { x: 58, z: -38, r: 17, d: 0.22, young: true }, // a young crater with bright rays (moon glass)
  ];
  for (let i = 0; i < 110; i++) {
    const r = 2.5 + Math.pow(R(), 2.4) * 46, a = R() * Math.PI * 2, dist = 40 + Math.pow(R(), 0.8) * 900;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    if (Math.hypot(x, z) < 36 + r) continue;
    if (craters.some((c) => Math.hypot(c.x - x, c.z - z) < (c.r + r) * 0.7)) continue;
    craters.push({ x, z, r, d: 0.15 + R() * 0.07 });
  }
  for (let i = 0; i < 46; i++) { const a = R() * Math.PI * 2, dist = 24 + R() * 110; craters.push({ x: Math.cos(a) * dist, z: Math.sin(a) * dist, r: 0.8 + R() * 3, d: 0.18 }); }
  function hRaw(x, z) {
    let h = (fbm(x / 110 + 7, z / 110) - 0.5) * 9 + (fbm(x / 26, z / 26 + 3) - 0.5) * 1.6;
    for (const c of craters) {
      const dx = x - c.x, dz = z - c.z, q = dx * dx + dz * dz, rr = c.r * 2.2;
      if (q > rr * rr) continue;
      const d = Math.sqrt(q) / c.r;
      if (d < 1) h += c.r * c.d * (d * d - 1) * (1 - 0.25 * (1 - d * d));
      h += c.r * 0.065 * Math.exp(-(((d - 1) / 0.3) ** 2));
    }
    return h;
  }
  function height(x, z) {
    const dist = Math.hypot(x, z), k = smooth(20, 48, dist);
    const site = (fbm(x / 9, z / 9) - 0.5) * 0.25;
    return site + (hRaw(x, z) - hRaw(0, 0) * 0) * k - (x * x + z * z) / (2 * REFF) - 0.0;
  }
  const S = 1400, SEG = lite ? 230 : 380;
  const map = (t) => S * (0.15 * t + 0.85 * t * t * t);
  const geo = new THREE.PlaneGeometry(2, 2, SEG, SEG); geo.rotateX(-Math.PI / 2);
  {
    const p = geo.attributes.position, n = p.count, col = new Float32Array(n * 3), uv = geo.attributes.uv;
    for (let i = 0; i < n; i++) {
      const x = map(p.getX(i)), z = map(p.getZ(i)), y = height(x, z);
      p.setXYZ(i, x, y, z); uv.setXY(i, x / 3.2, z / 3.2);
      // colour: soft maria, darker crater floors, bright rims and rays
      let v = 0.5 + (fbm(x / 14, z / 14) - 0.5) * 0.12;
      v -= smooth(0.5, 0.68, fbm(x / 380 + 11, z / 380)) * 0.13;
      for (const c of craters) {
        if (c.r < 4) continue;
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz) / c.r;
        if (d < 1) v -= 0.05 * (1 - d);
        v += 0.07 * Math.exp(-(((d - 1.05) / 0.22) ** 2));
        if (c.young && d < 5) { const a = Math.atan2(dz, dx); const ray = Math.pow(Math.max(0, Math.sin(a * 7 + Math.sin(a * 3) * 2)), 6) + Math.pow(Math.max(0, Math.sin(a * 11 + 1)), 10) * 0.6; v += (0.16 * ray + 0.08) * smooth(5, 1.1, d); }
      }
      col[i * 3] = v * 1.02; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.97;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
  }
  // regolith grain: speckles and tiny pits (used as colour detail and as a bump map)
  const grain = (() => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    const img = g.createImageData(N, N), r = rng(77);
    for (let i = 0; i < N * N; i++) { const v = 200 + (r() - 0.5) * 60; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) { const x = r() * N, y = r() * N, s = 1 + r() * 5; const gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(90,90,90,.55)'); gr.addColorStop(0.7, 'rgba(120,120,120,.2)'); gr.addColorStop(1, 'rgba(255,255,255,.12)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = lite ? 2 : 8; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  void grain;
  // photographic regolith (CC0 scan) over the crater/ray colouring; steep crater walls go to bare rock
  const groundMat = await groundMaterial({ ground: 'moon_dusted_02', rock: 'moon_01', scale: 0.42, rockScale: 0.25, vertexTint: true, detail: 1, normalK: 1.3, slope: [0.6, 0.8], P, renderer });
  groundMat.color.setScalar(0.42); // regolith is dark (albedo ~0.12); the harsh sun makes it read grey
  const ground = new THREE.Mesh(geo, groundMat); ground.receiveShadow = true; ground.castShadow = false; scene.add(ground); // terrain self-shadow at grazing sun made a hard band at the shadow box edge

  // ---------------- boulders and pebbles (one instanced mesh)
  const colliders = createColliders();
  // scanned lunar rock samples (Poly Haven CC0, decimated + baked in Blender), scaled up into boulders.
  // Near the base they use the detailed LOD; far out a light one. Each rock type is one instanced mesh.
  {
    const sets = (await Promise.all(['moonrock_a', 'moonrock_b', 'moonrock_c'].map(loadModel))).filter(Boolean);
    const rr = rng(99), N = lite ? 420 : 1100, nearR = lite ? 18 : 40;
    const place = [];
    while (place.length < N) {
      const a = rr() * Math.PI * 2, dist = 9 + Math.pow(rr(), 1.4) * 380, big = rr() < 0.06, sc = big ? 0.8 + rr() * 1.6 : 0.08 + Math.pow(rr(), 2) * 0.45;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (Math.hypot(x - 2, z) < 26 && (rr() < 0.85 || sc > 0.5)) continue; // keep the base site mostly clear
      place.push({ x, z, sc, big, dist, t: Math.floor(rr() * Math.max(1, sets.length)), ry: rr() * 6.28, tilt: (rr() - 0.5) * 0.5, sink: 0.15 + rr() * 0.2, g: 0.85 + rr() * 0.3 });
      if (big && dist < 140) colliders.circle(x, z, sc * 0.95, { h: sc * 1.2 });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
    sets.forEach((set, ti) => {
      for (const near of [true, false]) {
        const list = place.filter((p) => p.t === ti && (Math.hypot(p.x - 2, p.z) < nearR) === near);
        if (!list.length) continue;
        const lod = set.variants[0].lods[near ? 0 : Math.min(1, set.variants[0].lods.length - 1)];
        const mat = lod.material.clone(); mat.color.setScalar(0.8);
        const im = new THREE.InstancedMesh(lod.geometry, mat, list.length);
        const base = Math.max(lod.size.x, lod.size.z);
        list.forEach((p, k) => {
          const f = (p.sc * 2) / base; // the sample's footprint becomes the boulder's
          e.set(p.tilt, p.ry, p.tilt * 0.6); q.setFromEuler(e); s.set(f, f * (0.8 + (p.g - 0.85)), f);
          v.set(p.x, height(p.x, p.z) - lod.size.y * f * p.sink, p.z); m.compose(v, q, s); im.setMatrixAt(k, m);
          c.setScalar(p.g); im.setColorAt(k, c);
        });
        im.castShadow = near || !lite; im.receiveShadow = true; scene.add(im);
      }
    });
  }

  // reflections: black sky above, sunlit grey regolith below (what metal and glass on the moon mirror)
  {
    const es = new THREE.Scene();
    const envMat = new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'varying vec3 vD; void main(){ float y = normalize(vD).y; vec3 g = vec3(0.42, 0.4, 0.37) * smoothstep(0.02, -0.25, y); gl_FragColor = vec4(g + vec3(0.004), 1.); }' });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.02).texture; scene.environmentIntensity = 1.0; pm.dispose();
  }

  // ---------------- sky: stars, the sun, and Earth (lit to match the real phase)
  const sky = new THREE.Group(); scene.add(sky);
  const sunDir = new THREE.Vector3(), earthDir = new THREE.Vector3();
  {
    const N = lite ? 2200 : 5000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), r = rng(5);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(a) * 4000; pos[i * 3 + 1] = Math.abs(u) * 4000 * (u < -0.1 ? -1 : 1); pos[i * 3 + 2] = s * Math.sin(a) * 4000;
      const b = 0.35 + Math.pow(r(), 3) * 0.9, t = r(); col[i * 3] = b * (t < 0.2 ? 1 : 0.9); col[i * 3 + 1] = b * 0.93; col[i * 3 + 2] = b * (t > 0.7 ? 1.1 : 0.88);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sky.add(new THREE.Points(g, new THREE.PointsMaterial({ size: lite ? 2.2 : 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false })));
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,250,235,.95)'); gr.addColorStop(0.25, 'rgba(255,240,210,.25)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  // in vacuum the sun is a hard white disc (0.53°, drawn a touch larger to read) with only a small lens glare
  const discTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.9, 'rgba(255,252,246,1)'); gr.addColorStop(0.97, 'rgba(255,250,240,0.6)'); gr.addColorStop(1, 'rgba(255,250,240,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, color: new THREE.Color(8, 7.8, 7.4), transparent: true, depthWrite: false, fog: false, toneMapped: false })); sunSprite.scale.setScalar(80); sky.add(sunSprite);
  const sunGlare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); sunGlare.scale.setScalar(420); sky.add(sunGlare);
  const loader = new THREE.TextureLoader();
  const load = (u) => new Promise((res) => loader.load(u, res, undefined, () => res(null)));
  const [dayT, nightT] = await Promise.all([load('assets/space/earth-phone.webp'), load('assets/space/lights-phone.webp')]);
  if (dayT) dayT.colorSpace = THREE.SRGBColorSpace;
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uDay: { value: dayT }, uNight: { value: nightT }, uSun: { value: sunDir } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform sampler2D uDay, uNight; uniform vec3 uSun; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){ vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW); float d=dot(N,uSun);
        vec3 day=pow(texture2D(uDay,vUv).rgb,vec3(2.2)); float L=pow(texture2D(uNight,vUv).r,1.6);
        vec3 cp=N*vec3(5.,9.,5.); float c=smoothstep(.55,.85,n3(cp)*.6+n3(cp*2.3)*.3+n3(cp*5.)*.15);
        vec3 col=day*(0.006+1.5*max(d,0.)); col=mix(col,vec3(1.)*(0.006+1.3*max(d,0.)),c*.85);
        col+=vec3(1.,.72,.38)*smoothstep(.3,.9,L)*(1.-smoothstep(-.1,.2,d))*0.22;
        float rim=pow(1.-max(dot(N,V),0.),3.); float fs=pow(max(dot(uSun,-V),0.),3.); col+=vec3(.35,.6,1.)*rim*(smoothstep(-.2,.4,d)*0.9+fs*smoothstep(-.6,0.,d)*1.4);
        gl_FragColor=vec4(pow(col,vec3(1./2.2)),1.); }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(230, 96, 64), earthMat); sky.add(earth);
  const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#7fb2ff', transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending })); earthGlow.scale.setScalar(650); sky.add(earthGlow);
  // the real phase: Earth from the moon is "full" when the moon is new. Keep the sun up and Earth high.
  function placeSky() {
    const k = moonNow().illum; // moon's lit fraction; Earth's is about 1 - k
    const theta = Math.acos(THREE.MathUtils.clamp(2 * k - 1, -1, 1)); // sun-to-Earth angle seen from the moon
    const th = THREE.MathUtils.clamp(theta, 1.2, 2.6); // near 'new Earth' keep it ~29° from the sun: a thin lit crescent, the rest in earthshine-dark with city lights
    const ee = 0.3, es = 0.2; // elevations (rad): a low sun, as on the Apollo landings, for long black shadows
    const cosD = THREE.MathUtils.clamp((Math.cos(th) - Math.sin(ee) * Math.sin(es)) / (Math.cos(ee) * Math.cos(es)), -1, 1);
    const azE = -2.2, azS = azE + Math.acos(cosD);
    earthDir.set(Math.cos(ee) * Math.sin(azE), Math.sin(ee), Math.cos(ee) * Math.cos(azE));
    sunDir.set(Math.cos(es) * Math.sin(azS), Math.sin(es), Math.cos(es) * Math.cos(azS)).normalize();
    earth.position.copy(earthDir).multiplyScalar(3000); earthGlow.position.copy(earth.position);
    sunSprite.position.copy(sunDir).multiplyScalar(3600); sunGlare.position.copy(sunSprite.position);
    const now = new Date(); earth.rotation.y = -((now.getUTCHours() + now.getUTCMinutes() / 60) / 24) * Math.PI * 2 + 2.0;
    return { k, earthLit: 1 - k };
  }
  const skyInfo = placeSky();
  // she arrives facing home: Earth a little above the horizon, framed in the upper part of the view
  function lookEarth() { player.aim(Math.atan2(earthDir.x, earthDir.z) + 0.25, Math.asin(earthDir.y) * 0.55); }
  const sun = new THREE.DirectionalLight('#fffaf2', 4.2); sun.castShadow = true; // unfiltered sunlight: hard and white
  sun.shadow.mapSize.set(lite ? 1024 : 4096, lite ? 1024 : 4096);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 1200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#9db6e8', '#4a4844', 0.07)); // no sky: only a whisper of earthshine and bounce from the dust, so shadows go nearly black

  // ---------------- her rocket, standing on the moon
  const LZ = { x: -9, z: 7 };
  const rocket = buildRocket({ lite }); for (const k in rocket.parts) rocket.parts[k].visible = true;
  rocket.group.position.set(LZ.x, height(LZ.x, LZ.z) - 0.05, LZ.z); rocket.group.rotation.y = 0.6; scene.add(rocket.group);
  colliders.circle(LZ.x, LZ.z, 1.7, { h: 13 });
  // a little dust skirt where it landed
  { const sk = new THREE.Mesh(new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.12, depthWrite: false })); sk.position.set(LZ.x, height(LZ.x, LZ.z) + 0.03, LZ.z); scene.add(sk); }

  // ---------------- the walking core (low gravity, a bubble helmet)
  const extraTabs = [];
  const core = createWalkCore({ world: 'moon', scene, camera, P, canvas, ground: (x, z) => height(x, z), gravity: 1.62, jumpV: 2.3, walk: 1.35, run: 2.9, speedScale: 0.85, start: { x: LZ.x + 3.5, z: LZ.z - 2.5, yaw: 2.4 }, bounds: { cx: 0, cz: 0, r: 420 }, colliders, extraTabs, onMap: () => openMap(), audio, surface: 'regolith' });
  const { hud, player, interact } = core;

  // ---------------- base modules: placed where she chooses (survey stakes suggest a spot), upgraded in levels
  // save: G.moon.modules[id] = { at, lvl, x, z, ry }
  const DEF = { habitat: { x: 6, z: -5, ry: 0.35 }, greenhouse: { x: 13.5, z: 6.5, ry: -0.5 }, antenna: { x: -2, z: -15, ry: 0 }, solar: { x: 1.5, z: 12, ry: 0.25 } };
  const CORE = ['habitat', 'greenhouse', 'antenna']; // these three wake the antenna (the fleet story)
  const MM = G.moon.modules;
  const site = (id) => (MM[id] && MM[id].x != null ? MM[id] : DEF[id]);
  const lvlOf = (id) => (MM[id] ? MM[id].lvl || 1 : 0);
  const builders = { habitat: buildHabitat, greenhouse: buildGreenhouse, antenna: buildAntenna, solar: (o) => buildSolar({ ...o, lvl: lvlOf('solar') || 1 }) };
  const built = {};
  const ghosts = {};
  function placeModule(id, appear = false) {
    if (built[id]) { scene.remove(built[id]); colliders.remove('mod-' + id); }
    const s = site(id), m = builders[id]({ lite });
    decorateModule(id, m, lvlOf(id), { lite });
    m.position.set(s.x, height(s.x, s.z) - 0.05, s.z); m.rotation.y = s.ry; scene.add(m);
    const c = m.userData.collider;
    if (c.type === 'box') colliders.box(s.x, s.z, c.hw, c.hd, { ry: s.ry, h: 4, name: 'mod-' + id }); else colliders.circle(s.x, s.z, c.r, { h: 4, name: 'mod-' + id });
    built[id] = m;
    if (ghosts[id]) { scene.remove(ghosts[id]); delete ghosts[id]; }
    if (id === 'greenhouse') setBonsai();
    if (id === 'antenna') { m.updateMatrixWorld(); const head = m.userData.head; const wp = head.getWorldPosition(new THREE.Vector3()); head.lookAt(wp.clone().addScaledVector(earthDir, 100)); }
    if (appear) { m.scale.setScalar(0.01); appearing.push({ m, t: 0 }); }
  }
  // an unbuilt site is surveyed, the way real crews mark ground: aluminium stakes with orange flags
  const stakeMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.8, roughness: 0.35 });
  const flagMat = new THREE.MeshStandardMaterial({ color: '#d2601a', roughness: 0.7, side: THREE.DoubleSide });
  const stakeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).translate(0, 0.45, 0);
  const flagGeo = new THREE.PlaneGeometry(0.16, 0.1).translate(0.08, 0.83, 0);
  function placeGhost(id) {
    const s = site(id), m = new THREE.Group();
    const n = id === 'antenna' ? 3 : 6, r = id === 'antenna' ? 1.6 : id === 'solar' ? 2.6 : 3.7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const st = new THREE.Mesh(stakeGeo, stakeMat), fl = new THREE.Mesh(flagGeo, flagMat);
      st.position.set(x, 0, z); fl.position.set(x, 0, z); fl.rotation.y = a * 1.7; st.rotation.z = (i % 2 ? 1 : -1) * 0.04;
      st.castShadow = fl.castShadow = !lite; m.add(st, fl);
    }
    m.position.set(s.x, height(s.x, s.z) - 0.02, s.z); m.rotation.y = s.ry; scene.add(m); ghosts[id] = m;
  }
  const appearing = [];
  let bonsai = null;
  await preloadModules();
  for (const md of MODULES) { if (MM[md.id]) placeModule(md.id); else placeGhost(md.id); }

  // placing: a pale outline of the module rides on the ground where she looks; tap sets it down
  let placing = null; // { id, ghost, ry, x, z, ok, move }
  const ghostOk = new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.32, depthWrite: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: '#ffb38a', transparent: true, opacity: 0.32, depthWrite: false });
  function startPlacing(id, move = false) {
    stopPlacing();
    const g = builders[id]({ lite }); decorateModule(id, g, lvlOf(id), { lite });
    g.traverse((o) => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; o.receiveShadow = false; } });
    scene.add(g);
    placing = { id, ghost: g, ry: site(id).ry, x: 0, z: 0, ok: false, move };
    hud.closePanel && hud.closePanel();
    hud.toast(`Look where the ${MODULES.find((m) => m.id === id).name.toLowerCase()} should go. Tap to set it down. Open your bag to stop`, 'build', 5200);
  }
  function stopPlacing() { if (placing) { scene.remove(placing.ghost); placing = null; } }
  const _dir = new THREE.Vector3();
  function updatePlacing() {
    if (!placing) return;
    if (hud.panelOpen) { stopPlacing(); return; }
    camera.getWorldDirection(_dir);
    const ox = camera.position.x, oz = camera.position.z, oy = camera.position.y;
    let d = 4; for (; d < 16; d += 0.25) { if (oy + _dir.y * d <= height(ox + _dir.x * d, oz + _dir.z * d) + 0.05) break; }
    const flat = Math.hypot(_dir.x, _dir.z) || 1, dd = Math.max(5, Math.min(14, d));
    const x = ox + (_dir.x / flat) * dd * flat, z = oz + (_dir.z / flat) * dd * flat;
    placing.x = x; placing.z = z;
    const R = MODULES.find((m) => m.id === placing.id).r;
    let ok = Math.hypot(x - LZ.x, z - LZ.z) > R + 3.5 && Math.hypot(x - player.position.x, z - player.position.z) > R * 0.7;
    for (const md of MODULES) if (md.id !== placing.id && MM[md.id] && Math.hypot(x - site(md.id).x, z - site(md.id).z) < R + md.r + 0.8) ok = false;
    const slope = Math.abs(height(x + R, z) - height(x - R, z)) + Math.abs(height(x, z + R) - height(x, z - R));
    if (slope > R * 0.5) ok = false;
    if (ok !== placing.ok) { placing.ok = ok; placing.ghost.traverse((o) => { if (o.isMesh) o.material = ok ? ghostOk : ghostBad; }); }
    placing.ghost.position.set(x, height(x, z) - 0.05, z); placing.ghost.rotation.y = placing.ry;
  }
  function confirmPlacing() {
    const P = placing; if (!P || !P.ok) { hud.toast('Too close to something, or too steep. Try a flatter, open spot', 'build'); return; }
    const md = MODULES.find((m) => m.id === P.id);
    if (!P.move) { if (!game.pay(md.cost)) { hud.toast('Not quite enough yet', 'build'); return; } MM[P.id] = { at: Date.now(), lvl: 1 }; }
    Object.assign(MM[P.id], { x: +P.x.toFixed(2), z: +P.z.toFixed(2), ry: +P.ry.toFixed(3) }); game.save();
    stopPlacing(); placeModule(P.id, true); audio.place && audio.place(); audio.setActivity && audio.setActivity('build', 4);
    hud.toast(P.move ? `The ${md.name.toLowerCase()} has a new spot` : `The ${md.name.toLowerCase()} is built`, 'build', 3200);
    if (!P.move) builtStory();
  }
  interact.add({ id: 'placing', at: () => ({ x: placing ? placing.x : 0, y: placing ? height(placing.x, placing.z) - 0.3 : -99, z: placing ? placing.z : 0 }), r: 30, gazeR: 4, gazeH: 3, priority: 9, enabled: () => !!placing,
    actions: () => [{ label: placing && placing.ok ? 'Set it down here' : 'Not here: find open, flat ground', icon: 'build', run: async () => confirmPlacing() }, { label: 'Turn it', icon: 'build', run: async () => { placing.ry += Math.PI / 4; } }] });
  function builtStory() {
    if (CORE.every((k) => MM[k]) && !G.moon.fleet) setTimeout(() => hud.toast('The antenna hums. Something out there is listening back', 'star', 4200), 3400);
  }
  function upgrade(id) {
    const L = lvlOf(id), up = UPGRADES[id][L + 1]; if (!up) return false;
    if (lvlOf('solar') < up.power) { hud.toast(`It needs more power first: the solar array at level ${up.power}`, 'build', 3600); return false; }
    if (!game.pay(up.cost)) { hud.toast('Not quite enough yet', 'build'); return false; }
    MM[id].lvl = L + 1; game.save(); placeModule(id, true); audio.place && audio.place(); audio.setActivity && audio.setActivity('build', 4);
    hud.toast(up.desc.replace(/\.$/, '') + '. Done', 'build', 3600);
    return true;
  }
  function setBonsai() {
    const gh = built.greenhouse; if (!gh) return;
    const b = G.moon.bonsai || (G.moon.bonsai = { water: 0, planted: Date.now() });
    const days = (Date.now() - b.planted) / 864e5;
    const k = Math.min(1, 0.55 + (b.water * 0.04 + days * 0.03) * (lvlOf('greenhouse') >= 3 ? 1.5 : 1));
    if (bonsai) gh.userData.bonsaiHolder.remove(bonsai);
    bonsai = buildMoonBonsai(k * 1.15, 5); gh.userData.bonsaiHolder.add(bonsai);
  }
  // tests: build straight onto the suggested spot
  function build(id, spot = null) {
    const md = MODULES.find((m) => m.id === id);
    if (MM[id]) return false;
    if (!game.pay(md.cost)) { hud.toast('Not quite enough yet', 'build'); return false; }
    const s = spot || DEF[id]; MM[id] = { at: Date.now(), lvl: 1, x: s.x, z: s.z, ry: s.ry }; game.save();
    placeModule(id, true);
    hud.toast(`The ${md.name.toLowerCase()} is built`, 'build', 3200);
    builtStory();
    return true;
  }
  extraTabs.push({ id: 'base', label: 'Moon base', icon: 'build', render: (b, rerender) => {
    const pw = lvlOf('solar');
    b.innerHTML = `<h3>The moon base</h3><p class="muted" style="margin:0 0 12px">Set each module down wherever you like (the flags are only a suggestion), then add to it as the base grows. The solar array powers the bigger upgrades.</p>` + MODULES.map((m) => {
      const L = lvlOf(m.id), done = L > 0, mx = maxLevel(m.id), up = done && L < mx ? UPGRADES[m.id][L + 1] : null;
      const can = !done ? game.has(m.cost) : up ? game.has(up.cost) && pw >= up.power : false;
      const lv = done && mx > 1 ? ` <span class="done">· level ${L} of ${mx}</span>` : done ? ' <span class="done">· built</span>' : '';
      const body = !done ? `<div class="muted" style="font-size:13px">${m.desc}</div><div style="margin-top:6px">${hud.cost(m.cost)}</div>`
        : up ? `<div class="muted" style="font-size:13px">Next: ${up.desc}${up.power > pw ? ` Needs the solar array at level ${up.power}.` : ''}</div><div style="margin-top:6px">${hud.cost(up.cost)}</div>` : `<div class="muted" style="font-size:13px">${m.desc}</div>`;
      const btn = !done ? `<button class="b" data-place="${m.id}" ${can ? '' : 'disabled'}>Place</button>` : `${up ? `<button class="b" data-up="${m.id}" ${can ? '' : 'disabled'}>Add</button>` : ''}<button class="b" data-move="${m.id}" style="margin-left:6px">Move</button>`;
      return `<div class="row"><span style="width:26px;height:26px;display:inline-flex;color:${done ? '#bfe8b0' : '#fff'}">${icon(done ? 'star' : 'build')}</span><div class="grow"><div>${m.name}${lv}</div>${body}</div>${btn}</div>`;
    }).join('') + `<h3>Where things are</h3><p class="muted" style="font-size:14px;line-height:1.5">Moon dust lies in soft drifts around the base. Moon glass glints green out by the young bright crater to the east. Ice hides in the shadowed floor of the big old crater to the north west.</p>`;
    const on = (sel, fn) => b.querySelectorAll(sel).forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(el); }));
    on('[data-place]', (el) => startPlacing(el.dataset.place));
    on('[data-move]', (el) => startPlacing(el.dataset.move, true));
    on('[data-up]', (el) => { if (upgrade(el.dataset.up)) rerender(); });
  } });
  for (const md of MODULES) {
    interact.add({ id: 'site-' + md.id, at: () => { const s = site(md.id); return { x: s.x, y: height(s.x, s.z), z: s.z }; }, r: md.id === 'habitat' ? 5.2 : 4.6, priority: 0.1,
      enabled: () => !MM[md.id] && !placing,
      actions: () => [{ label: `Build the ${md.name.toLowerCase()} here`, icon: 'build', run: async () => { if (!game.has(md.cost)) { core.openBag('base'); return; } build(md.id); } }, { label: 'Choose another spot', icon: 'build', run: async () => startPlacing(md.id) }] });
    if (md.id === 'solar') interact.add({ id: 'mod-solar', at: () => { const s = site('solar'); return { x: s.x, y: height(s.x, s.z) + 1, z: s.z }; }, r: 4.4, priority: 0.2, enabled: () => !!MM.solar && !placing,
      actions: () => [{ label: lvlOf('solar') < 3 ? 'Look over the solar array' : 'The array hums quietly', icon: 'build', run: async () => { hud.toast(`Solar array, level ${lvlOf('solar')}. ${lvlOf('solar') < 3 ? 'More panels would power bigger upgrades' : 'Enough power for the whole base, day and night'}`, 'build', 3600); } }] });
  }
  // greenhouse: water the moon bonsai with a little melted ice
  interact.add({ id: 'moon-bonsai', at: () => ({ x: site('greenhouse').x, y: 0, z: site('greenhouse').z }), r: 5.2, priority: 0.3, enabled: () => !!G.moon.modules.greenhouse,
    actions: () => [lvlOf('greenhouse') >= 2 && (G.moon.herbDay !== dayKey()) ? { label: 'Pick moon herbs', icon: 'leaf', run: async () => {
      await player.act('kneel', 1.4, site('greenhouse')); const n = lvlOf('greenhouse') >= 3 ? 3 : 2; G.moon.herbDay = dayKey(); game.add('herb', n); game.save();
      hud.toast(`${n} handfuls of moon herbs, fragrant under the grow lights`, 'leaf', 3200); } } : null,
      { label: game.count('ice') ? 'Water the moon bonsai (1 ice)' : 'Admire the moon bonsai', icon: game.count('ice') ? 'water' : 'leaf', run: async () => {
      if (!game.count('ice')) { hud.toast('It would love a little melted moon ice', 'ice'); return; }
      const today = dayKey(); const b = G.moon.bonsai;
      if (b.lastWater === today) { hud.toast('Watered already today. It drinks slowly up here', 'leaf'); return; }
      await player.act('water', 1.8, site('greenhouse')); game.take('ice'); b.water = (b.water || 0) + 1; b.lastWater = today; game.save(); setBonsai(); hud.toast('The moon bonsai drinks it in', 'leaf');
    } }] });
  interact.add({ id: 'habitat-rest', at: () => ({ x: site('habitat').x + 4.4 * Math.cos(site('habitat').ry), y: 0, z: site('habitat').z - 4.4 * Math.sin(site('habitat').ry) }), r: 2.2, priority: 0.4, enabled: () => !!G.moon.modules.habitat,
    actions: () => [{ label: 'Peek inside the habitat', icon: 'home', run: async () => hud.say('Habitat', ['A cot with a quilt from home, a little lamp, seed packets pinned to the wall.', 'Through the round window: Earth, ' + phaseWord() + '.']) }] });
  interact.add({ id: 'antenna', at: () => ({ x: site('antenna').x, y: 0, z: site('antenna').z }), r: 3.2, priority: 0.3, enabled: () => !!G.moon.modules.antenna,
    actions: () => [!G.moon.fleet && CORE.every((k) => MM[k]) ? { label: 'Listen to the stars', icon: 'star', run: () => fleetArrives() }
      : G.moon.fleet ? { label: 'Open the star map', icon: 'map', run: async () => openMap() } : { label: 'The antenna listens', icon: 'star', run: async () => hud.toast('Finish the base and the antenna will hear more', 'star') }] });
  interact.add({ id: 'rocket', at: () => ({ x: LZ.x, y: 0, z: LZ.z }), r: 3.2, priority: 0.2,
    actions: () => [{ label: 'Fly home to the garden', icon: 'home', run: () => flyHome() }] });
  function phaseWord() { const e = skyInfo.earthLit; return e > 0.9 ? 'full and bright' : e > 0.6 ? 'nearly full' : e > 0.4 ? 'half lit' : e > 0.1 ? 'a slim crescent' : 'dark, with city lights along its edge'; }

  // ---------------- gathering: moon dust drifts, moon glass by the young crater, ice in the old one
  const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillRect(31, 6, 2, 52); g.fillRect(6, 31, 52, 2); return new THREE.CanvasTexture(c); })();
  const dk = dayKey();
  if (!G.moon.gather || G.moon.gather.day !== dk) G.moon.gather = { day: dk, ids: [] };
  const taken = new Set(G.moon.gather.ids);
  const items = [], gr = rng([...dk].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0);
  const many = UNLOCK_ALL || params.has('gather');
  for (let i = 0; i < (many ? 14 : 9); i++) { const a = gr() * 6.283, r = 8 + gr() * 26; items.push({ id: 'dust' + i, kind: 'regolith', n: 2, x: 2 + Math.cos(a) * r, z: Math.sin(a) * r }); }
  const yc = craters[1], bc = craters[0];
  for (let i = 0; i < (many ? 8 : 5); i++) { const a = gr() * 6.283, r = yc.r * (1.1 + gr() * 1.6); items.push({ id: 'glass' + i, kind: 'moonglass', n: 1, x: yc.x + Math.cos(a) * r, z: yc.z + Math.sin(a) * r }); }
  for (let i = 0; i < (many ? 8 : 5); i++) { const a = gr() * 6.283, r = bc.r * gr() * 0.55; items.push({ id: 'ice' + i, kind: 'ice', n: 1, x: bc.x + Math.cos(a) * r, z: bc.z + Math.sin(a) * r }); }
  const gatherGrp = new THREE.Group(); scene.add(gatherGrp);
  {
    const dustM = new THREE.MeshStandardMaterial({ color: '#b7b4ae', roughness: 1 }), glassM = new THREE.MeshStandardMaterial({ color: '#7fd9b8', roughness: 0.15, metalness: 0.1, emissive: '#1f6b55', emissiveIntensity: 0.5 }), iceM = new THREE.MeshStandardMaterial({ color: '#d9f0ff', roughness: 0.2, emissive: '#5f8fbf', emissiveIntensity: 0.35 });
    for (const it of items) {
      if (taken.has(it.id)) { it.gone = true; continue; }
      const y = height(it.x, it.z); let m;
      if (it.kind === 'regolith') m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 8, 0, 6.283, 0, 1.2).scale(1, 0.45, 1), dustM);
      else if (it.kind === 'moonglass') { m = new THREE.Group(); for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.05 + k * 0.012, 10, 8), glassM); b.position.set((k % 3 - 1) * 0.11, 0.05, (Math.floor(k / 3) - 0.5) * 0.12); m.add(b); } }
      else { m = new THREE.Group(); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + k * 0.03, 0).scale(0.7, 1.4, 0.7), iceM); b.position.set((k % 2 - 0.5) * 0.18, 0.12, (Math.floor(k / 2) - 0.5) * 0.18); b.rotation.set(k, k * 2, 0.3); m.add(b); } }
      m.position.set(it.x, y, it.z); m.traverse((o) => { o.castShadow = true; o.receiveShadow = true; }); gatherGrp.add(m);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: it.kind === 'moonglass' ? '#b9ffe4' : it.kind === 'ice' ? '#cfe9ff' : '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
      sp.scale.setScalar(0.45); sp.position.set(it.x, y + 0.3, it.z); gatherGrp.add(sp);
      it.mesh = m; it.spark = sp; it.phase = gr() * 6; it.y = y;
      const label = it.kind === 'regolith' ? 'Scoop up moon dust' : it.kind === 'moonglass' ? 'Pick up the moon glass' : 'Chip off the ice';
      interact.add({ id: 'g-' + it.id, at: () => it, r: 1.4, priority: 0.4, enabled: () => !it.gone,
        actions: () => [{ label, icon: it.kind === 'regolith' ? 'stone' : it.kind === 'ice' ? 'ice' : 'crystal', run: async () => {
          const pr = player.act('kneel', 1.3, it); await wait(700);
          it.gone = true; gatherGrp.remove(it.mesh); gatherGrp.remove(it.spark);
          G.moon.gather.ids.push(it.id); game.add(it.kind, it.n);
          hud.toast(`${it.n > 1 ? it.n + ' scoops of ' : ''}${itemInfo(it.kind).name.toLowerCase()}`, it.kind === 'regolith' ? 'stone' : it.kind === 'ice' ? 'ice' : 'crystal'); await pr;
        } }] });
    }
  }

  // ---------------- footprints in the dust
  const FP = lite ? 160 : 320;
  const fpTex = (() => { const c = document.createElement('canvas'); c.width = 32; c.height = 64; const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 32, 64); const gr = g.createRadialGradient(16, 22, 2, 16, 26, 16); gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(16, 24, 11, 20, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(16, 52, 8, 9, 0, 0, 7); g.fill(); for (let y = 8; y < 58; y += 5) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(6, y, 20, 1.5); } return new THREE.CanvasTexture(c); })();
  const fpMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: fpTex, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }), FP);
  fpMesh.count = 0; fpMesh.frustumCulled = false; scene.add(fpMesh);
  let fpI = 0, fpLast = null, fpSide = 1;
  const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fv = new THREE.Vector3(), fs = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  function footprints() {
    const p = player.position;
    if (player.airborne) return;
    if (!fpLast) { fpLast = p.clone(); return; }
    if (fpLast.distanceToSquared(p) < 0.42 * 0.42) return;
    const h = Math.atan2(p.x - fpLast.x, p.z - fpLast.z); fpLast.copy(p); fpSide = -fpSide;
    fv.set(p.x + Math.cos(h) * 0.1 * fpSide, height(p.x, p.z) + 0.02, p.z - Math.sin(h) * 0.1 * fpSide);
    fq.setFromAxisAngle(up, h); fm.compose(fv, fq, fs); fpMesh.setMatrixAt(fpI % FP, fm); fpI++; fpMesh.count = Math.min(FP, fpI); fpMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------- the friendly fleet and the guide
  const fleet = new THREE.Group(); scene.add(fleet);
  const SHIPS = [
    { accent: '#7fe0d0', scale: 2.2, guide: true, at: [22, 9, -20] },
    { accent: '#ffb48a', scale: 1.1, at: [-30, 46, -60] },
    { accent: '#c6a8ff', scale: 1.4, at: [40, 62, -85] },
    { accent: '#9fe6a6', scale: 0.9, at: [-6, 70, -110] },
    { accent: '#ffd88a', scale: 1.2, at: [70, 40, -40] },
  ];
  const ships = SHIPS.map((s, i) => { const m = buildShip({ ...s, lite }); m.visible = false; fleet.add(m); return { ...s, m, i, from: new THREE.Vector3(s.at[0] * 4 - 200, 600 + i * 60, s.at[2] * 6 - 900), to: new THREE.Vector3(s.at[0], height(s.at[0], s.at[2]) + s.at[1], s.at[2]) }; });
  const guide = ships[0];
  let arrival = null;
  function showFleet() { for (const s of ships) { s.m.visible = true; s.m.position.copy(s.to); } }
  if (G.moon.fleet) showFleet();
  const lerpV = new THREE.Vector3();
  async function fleetArrives() {
    core.cinematic = true; hud.setMode('cinematic'); hud.setPrompt(null);
    for (const s of ships) { s.m.visible = true; s.m.position.copy(s.from); }
    arrival = { t: 0, dur: params.has('fastfleet') ? 3 : 11 };
    await new Promise((r) => (arrival.done = r));
    player.act('wave', 2.0, guide.to);
    await hud.say('Ilo, of the Lantern Fleet', [
      'Hello, gardener. We heard your antenna singing, and we followed the song.',
      'You built a home here from dust and ice and a little bonsai. That is how every good journey starts.',
      'Let me show you the warp. It is gentle: you choose a star, and the space between simply folds, like a petal.',
      'Every star out there has worlds no one has walked yet. Name what you find. And you can always come home.',
    ]);
    G.moon.fleet = Date.now(); game.unlock('warp'); game.unlock('fleet'); game.save();
    core.cinematic = false; core.activate();
    hud.toast('Warp drive learned. Open the star map with the map button (M)', 'map', 5200);
  }
  interact.add({ id: 'guide', at: () => ({ x: guide.to.x, y: 0, z: guide.to.z }), r: 9, priority: 0.2, enabled: () => !!G.moon.fleet && !arrival,
    actions: () => [{ label: 'Talk to Ilo', icon: 'talk', run: () => hud.say('Ilo', ['The fleet will wait here as long as you like.', 'Shift dimensions on the star map when you want a world to feel different: lighter, bluer, slower.']) }, { label: 'Star map', icon: 'map', run: async () => openMap() }] });
  function updateFleet(dt, t) {
    if (arrival) {
      arrival.t += dt; const u = Math.min(1, arrival.t / arrival.dur);
      for (const s of ships) {
        const k = THREE.MathUtils.clamp((u - s.i * 0.08) / (1 - 0.32), 0, 1), e = 1 - Math.pow(1 - k, 3);
        lerpV.copy(s.from).lerp(s.to, e); s.m.position.copy(lerpV); s.m.rotation.z = (1 - e) * 0.25;
      }
      // camera: from beside her, looking up past the antenna at the sky as they come down
      const p = player.position;
      camera.position.set(p.x - 6, p.y + 2.2, p.z + 7);
      const look = lerpV.set(guide.m.position.x, guide.m.position.y, guide.m.position.z).lerp(new THREE.Vector3(p.x + 6, p.y + 4, p.z - 10), 0.35);
      camera.lookAt(look);
      if (u >= 1 && arrival.done) { const d = arrival.done; arrival = null; d(); }
    }
    if (G.moon.fleet || arrival) for (const s of ships) {
      if (!arrival) s.m.position.y = s.to.y + Math.sin(t * 0.6 + s.i) * 0.35;
      s.m.rotation.y += dt * 0.12 * (s.i % 2 ? 1 : -1);
      s.m.userData.ring.material.opacity = 0.6 + 0.3 * Math.sin(t * 1.5 + s.i);
    }
  }

  // ---------------- travel: the star map, and flying home
  function openMap() {
    if (!game.unlocked('warp')) { hud.toast('The star map opens once you learn the warp', 'map'); return; }
    return openStarMap({ current: 'moon', onTravel: (d) => { if (d.world === 'moon') return; worlds.go(d.world, { ...d, from: 'warp' }).catch((e) => { console.warn('[G] warp failed', e); hud.toast('That world is still forming', 'star'); }); } });
  }
  let leaving = null, landing = null;
  // arriving from Earth: a slow powered descent onto the landing zone, dust blowing out in a ring
  const dustRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#cfc9bd', transparent: true, opacity: 0, depthWrite: false }));
  dustRing.position.set(LZ.x, height(LZ.x, LZ.z) + 0.15, LZ.z); scene.add(dustRing);
  function startLanding() {
    return new Promise((done) => {
      landing = { t: 0, dur: params.has('landdur') ? +params.get('landdur') : params.has('fastspace') ? 4 : 14, done, said: {} };
      core.cinematic = true; hud.setMode('cinematic'); hud.setPrompt(null); player.setVisible(false);
    });
  }
  function updateLanding(dt, t) {
    landing.t += dt; const L = landing, u = Math.min(1, L.t / L.dur), g0 = height(LZ.x, LZ.z) - 0.05;
    const y = g0 + 140 * Math.pow(1 - u, 2.4);
    rocket.group.position.y = y;
    rocket.setFlame(u < 1 ? 0.3 + 0.45 * Math.min(1, (1 - u) * 4) : Math.max(0, 1 - (L.t - L.dur) * 3) * 0.3, t);
    const near = Math.max(0, 1 - (y - g0) / 18);
    dustRing.scale.setScalar(2 + near * 14 + (u >= 1 ? (L.t - L.dur) * 6 : 0)); dustRing.material.opacity = near * 0.35 * (u >= 1 ? Math.max(0, 1 - (L.t - L.dur) / 2) : 1);
    if (!L.said.a && L.t > 1) { L.said.a = true; hud.toast('Powered descent. Slow and steady', null, 3200); }
    if (!L.said.b && y - g0 < 12) { L.said.b = true; hud.toast('Dust blowing out across the ground', null, 2600); }
    if (!L.said.c && u >= 1) { L.said.c = true; hud.toast('Touchdown. The engine stops, and it is very quiet', null, 3800); }
    { const dd = 72 - 42 * Math.min(1, u * 1.1); camera.position.set(LZ.x - dd * 0.79, Math.max(g0, height(LZ.x - dd * 0.79, LZ.z + dd * 0.61)) + 7, LZ.z + dd * 0.61); camera.lookAt(LZ.x, g0 + 5 + Math.min(y - g0, 50) * 0.5, LZ.z); }
    if (u >= 1 && L.t > L.dur + 2.6 && !L.out) {
      L.out = true;
      (async () => { await hud.fadeTo(1, 1200); landing = null; dustRing.material.opacity = 0; rocket.setFlame(0, 0); core.cinematic = false; player.setVisible(true); player.teleport(LZ.x + 3.5, LZ.z - 2.5, 2.4); lookEarth(); core.activate(); hud.fadeTo(0, 1600); L.done(); })();
    }
  }
  async function flyHome() {
    core.cinematic = true; hud.setMode('cinematic'); hud.setPrompt(null); player.setVisible(false);
    leaving = { t: 0 };
    await wait(params.has('fastspace') ? 2500 : 6500);
    await hud.fadeTo(1, 1400);
    await worlds.go('space', { from: 'moon', to: 'earth' });
  }
  function updateLeaving(dt, t) {
    leaving.t += dt; const L = Math.max(0, leaving.t - 1.6);
    rocket.group.position.y = height(LZ.x, LZ.z) - 0.05 + 0.5 * 1.4 * L * L;
    rocket.setFlame(Math.min(1, leaving.t / 1.6), t);
    camera.position.set(LZ.x + 18, height(LZ.x, LZ.z) + 3, LZ.z + 16); camera.lookAt(LZ.x, rocket.group.position.y + 6, LZ.z);
  }

  // ---------------- frame
  let clock = 0, frameN = 0;
  const shadowAt = new THREE.Vector3();
  function frame(dt) {
    clock += dt; frameN++;
    renderer.toneMappingExposure = 1.0;
    core.update(dt);
    if (!core.cinematic && !core.drift) footprints();
    updateFleet(dt, clock);
    for (const a of appearing) { a.t += dt; const e = 1 - Math.pow(1 - Math.min(1, a.t / 1.6), 3); a.m.scale.setScalar(Math.max(0.01, e)); }
    for (let i = appearing.length - 1; i >= 0; i--) if (appearing[i].t > 1.6) appearing.splice(i, 1);
    for (const it of items) if (it.spark && !it.gone) { const tw = Math.exp(-((((clock + it.phase) % 4 - 0.3) ** 2) / 0.03)); it.spark.material.opacity = 0.25 + tw; it.spark.scale.setScalar(0.3 + tw * 0.5); }
    if (built.antenna) built.antenna.userData.beacon.material.emissiveIntensity = Math.sin(clock * 2.4) > 0.7 ? 3 : 0.3;
    if (built.greenhouse && bonsai) bonsai.rotation.y = Math.sin(clock * 0.2) * 0.05;
    updatePlacing();
    if (leaving) updateLeaving(dt, clock);
    else if (landing) updateLanding(dt, clock);
    else if (!arrival) { core.updateCamera(dt); rocket.setFlame(0, clock); }
    // the sky is infinitely far: it rides along with the camera
    sky.position.copy(camera.position);
    // shadows follow her (snapped to texels so they do not shimmer)
    const p = player.position, texel = 56 / sun.shadow.mapSize.x;
    shadowAt.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, Math.round(p.z / texel) * texel);
    sun.position.copy(shadowAt).addScaledVector(sunDir, 500); sun.target.position.copy(shadowAt);
    if (!lite || frameN % 2 === 0) renderer.shadowMap.needsUpdate = true;
    // habitat / greenhouse interiors get a short reverb; the rest of the moon stays open and thin
    let indoors = false;
    if (G.moon && G.moon.modules) {
      for (const id of ['habitat', 'greenhouse']) {
        const m = G.moon.modules[id];
        if (m && m.x != null && Math.hypot(p.x - m.x, p.z - m.z) < 3.6) { indoors = true; break; }
      }
    }
    audio.update(dt, {
      world: 'moon', biome: 'regolith', zone: indoors ? 'interior' : 'open', indoors,
      camera, speed: player.speed || 0, altitude: camera.position.y,
      gust: 0.3, night: 0, rain: 0, mist: 0,
    });
    renderer.render(scene, camera);
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = fpFov(w, h); camera.updateProjectionMatrix(); }
  resize(engine.width, engine.height);

  const api = {
    id: 'moon', scene, camera, resize, frame, input: core.input,
    mapData: () => ({ name: 'The moon', fit: true, extent: { cx: LZ.x, cz: LZ.z, r: 80 }, height, items: [...interact.items().filter((it) => !/^(mod|site)-/.test(it.id)), ...Object.keys(MM).map((k) => { const q = site(k); return { id: 'mod-' + k, x: q.x, z: q.z }; })], player: { x: player.position.x, z: player.position.z, yaw: player.heading } }),
    where() { if (core.cinematic || landing || placing) return null; const q = player.position; return { world: 'moon', x: +q.x.toFixed(2), z: +q.z.toFixed(2), yaw: +(player.cam.yaw - Math.PI).toFixed(3) }; },
    restoreWhere(w) { if (!w || w.world !== 'moon') return; player.teleport(w.x, w.z, w.yaw || 0); player.snapCamera(); },
    degrade() { return false; },
    debug: {
      core, player, interact, build, upgrade, startPlacing, confirmPlacing, get placing() { return placing && { id: placing.id, x: placing.x, z: placing.z, ok: placing.ok }; }, fleetArrives, openMap, items, height, ships, lookEarth: () => lookEarth(), sunDir,
      info: () => { const q = player.position; return { world: 'moon', device: P.cls, pos: [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)], prompt: interact.current ? interact.current.id : null, modules: Object.keys(G.moon.modules), fleet: !!G.moon.fleet, warp: game.unlocked('warp'), earthLit: +skyInfo.earthLit.toFixed(2), totalCalls: renderer.info.render.calls, totalTris: renderer.info.render.triangles, fps: Math.round(engine.fps) }; },
    },
    onEnter(arg = {}) {
      leaving = null; core.cinematic = false; player.setVisible(true);
      rocket.group.position.y = height(LZ.x, LZ.z) - 0.05;
      if (arg.from === 'space') { startLanding().then(() => { if (!G.seen.moon) { G.seen.moon = Date.now(); game.save(); setTimeout(() => hud.toast('The moon. Low gravity: jumps float. Gather dust, glass and ice to build a base', 'star', 5200), 1800); } }); hud.fadeTo(0, 1600); return; }
      player.teleport(LZ.x + 3.5, LZ.z - 2.5, 2.4); lookEarth();
      core.activate();
      hud.fadeTo(0, 1600);
      if (!G.seen.moon) { G.seen.moon = Date.now(); game.save(); setTimeout(() => hud.toast('The moon. Low gravity: jumps float. Gather dust, glass and ice to build a base', 'star', 5200), 1800); }
      void arg;
    },
    onExit() { core.deactivate(); },
  };
  return api;
}
