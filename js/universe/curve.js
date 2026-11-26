// Planet curvature for the floating-origin scene. The scene is laid out flat in the local tile frame;
// every standard material gets a tiny vertex-shader drop so the ground falls away with distance exactly
// as a sphere of radius R does (drop = d^2 / 2R, measured from the camera along world up). Near you the
// world is flat and physics stays simple; far off, horizons curve and hills sink behind them.
export const CURVE = { value: 0 };
export const setCurveRadius = (R) => { CURVE.value = R > 0 ? 1 / (2 * R) : 0; };
const INJECT = `#include <project_vertex>
{ vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); float hv = dot(mvPosition.xyz, upV);
  float d2 = max(0.0, dot(mvPosition.xyz, mvPosition.xyz) - hv * hv); mvPosition.xyz -= upV * d2 * uCurve; gl_Position = projectionMatrix * mvPosition; }`;
export function curveMaterial(m) {
  if (!m || m.userData.curved || m.isShaderMaterial || m.isRawShaderMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.userData.noCurve) return;
  m.userData.curved = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    sh.uniforms.uCurve = CURVE;
    sh.vertexShader = 'uniform float uCurve;\n' + sh.vertexShader.replace('#include <project_vertex>', INJECT);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|curve';
  m.needsUpdate = true;
}
// patch everything under root that has not been patched yet (cheap: a flag check per material)
export function curveTree(root) {
  root.traverse((o) => {
    if (o.userData && o.userData.noCurve) return;
    const m = o.material; if (!m) return;
    if (Array.isArray(m)) m.forEach(curveMaterial); else curveMaterial(m);
  });
}
