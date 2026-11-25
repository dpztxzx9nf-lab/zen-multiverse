// Device class detection + per-class quality profile. Decided once at load;
// framing (portrait / landscape / ultrawide) adapts live on resize and rotation.
export function detectDevice() {
  const q = new URLSearchParams(location.search);
  const mm = (s) => window.matchMedia && window.matchMedia(s).matches;
  const coarse = mm('(pointer: coarse)');
  const anyFine = mm('(any-pointer: fine)');
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const sw = Math.min(screen.width, screen.height), sh = Math.max(screen.width, screen.height);
  const ua = navigator.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && touch; // iPad pretending to be a Mac
  let cls;
  if ((coarse || iPadOS) && !(!coarse && anyFine)) cls = sw < 600 && sh < 1000 ? 'phone' : 'tablet';
  else if (touch && /Mobi|Android|iPhone/i.test(ua)) cls = 'phone';
  else cls = 'pc';
  const forced = q.get('device');
  if (forced === 'phone' || forced === 'tablet' || forced === 'pc') cls = forced;

  const dpr = window.devicePixelRatio || 1;
  const P = {
    phone: {
      maxPR: 1.5, minPR: 1.0, samples: 2, shadowMap: 1024, softShadows: false,
      sandTex: 512, sandSegs: 200, simSize: 128, simHz: 30, cheapWater: true,
      bambooStalks: 0.72, bambooLeaves: 42, grass: 520, treeFoliage: 'blob', treeBlobs: 55, treeBlobDetail: 0,
      shrubBlobs: 26, bonsaiDetail: 1, fireflies: 40, fallingLeaves: 16, koi: 5, rockSegs: 0.55,
      bloomScale: 0.5, bloomDayOff: true, hover: false, reflections: false, godRays: 0, tilt: false, grain: true, skySegs: [32, 16], hillSegs: [20, 10], lilies: 4,
    },
    tablet: {
      maxPR: 1.6, minPR: 1.0, samples: 2, shadowMap: 1024, softShadows: false,
      sandTex: 768, sandSegs: 280, simSize: 192, simHz: 45, cheapWater: true,
      bambooStalks: 0.75, bambooLeaves: 50, grass: 700, treeFoliage: 'blob', treeBlobs: 70, treeBlobDetail: 0,
      shrubBlobs: 36, bonsaiDetail: 1, fireflies: 60, fallingLeaves: 24, koi: 6, rockSegs: 0.75,
      bloomScale: 0.6, bloomDayOff: true, hover: false, reflections: false, godRays: 0, tilt: false, grain: true, skySegs: [40, 20], hillSegs: [28, 14], lilies: 6,
    },
    pc: {
      maxPR: 2, minPR: 1.0, samples: 4, shadowMap: 2048, softShadows: true,
      sandTex: 1536, sandSegs: 520, simSize: 256, simHz: 60, cheapWater: false,
      bambooStalks: 1.0, bambooLeaves: 140, grass: 1700, treeFoliage: 'cards', treeBlobs: 0, treeBlobDetail: 1,
      shrubBlobs: 0, bonsaiDetail: 2, fireflies: 110, fallingLeaves: 60, koi: 7, rockSegs: 1,
      bloomScale: 1, bloomDayOff: false, hover: true, reflections: true, godRays: 36, tilt: true, grain: true, skySegs: [48, 24], hillSegs: [40, 20], lilies: 6,
    },
  }[cls];
  P.cls = cls;
  P.touch = cls !== 'pc';
  P.dpr = dpr;
  return P;
}
