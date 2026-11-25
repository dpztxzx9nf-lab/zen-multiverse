// Offline support: cache the whole garden on first visit, then serve it from cache.
// Bump VERSION whenever files change so the new garden replaces the old one.
const VERSION = 'garden-v7-1';
// the page registers sw.js?tier=lite (phones/tablets) or ?tier=full (PC); that bundle is precached too
const TIER = new URL(self.location.href).searchParams.get('tier') === 'full' ? 'full' : 'lite';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/main.js', './js/device.js', './js/util.js', './js/sky.js', './js/sand.js', './js/pond.js', './js/bonsai.js',
  './js/flora.js', './js/rocks.js', './js/audio.js', './js/season.js', './js/weather.js', './js/surprises.js', './js/post.js',
  './js/nature.js', './js/mountains.js', './js/snapdragon.js', './js/finds.js', './js/lizard.js', './js/state.js', './js/save.js', './js/tending.js', './js/worlds.js', './js/worlds/earth.js', './js/camera-rig.js', './js/colliders.js', './js/wall.js',
  `./assets/nature-${TIER}.glb`,
  './assets/terrain/front-range.json',
  `./assets/terrain/front-range-${TIER === 'full' ? 'pc' : 'phone'}.bin`,
  './vendor/addons/loaders/GLTFLoader.js', './vendor/addons/utils/BufferGeometryUtils.js', './vendor/addons/libs/meshopt_decoder.module.js',
  './vendor/three.module.min.js',
  './vendor/addons/postprocessing/EffectComposer.js', './vendor/addons/postprocessing/RenderPass.js',
  './vendor/addons/postprocessing/UnrealBloomPass.js', './vendor/addons/postprocessing/OutputPass.js',
  './vendor/addons/postprocessing/ShaderPass.js', './vendor/addons/postprocessing/MaskPass.js', './vendor/addons/postprocessing/Pass.js',
  './vendor/addons/shaders/CopyShader.js', './vendor/addons/shaders/LuminosityHighPassShader.js', './vendor/addons/shaders/OutputShader.js',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // cache first (works offline); refresh the cache in the background when online.
  // (if the tier changes, e.g. a tablet docked to a keyboard, the other bundle is cached on first use)
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || (req.mode === 'navigate' ? cache.match('./') : Response.error());
  }));
});
