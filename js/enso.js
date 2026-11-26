// The ensō: Raked Light's one ring (art bible 1 and 7). One brush stroke, never quite closed: it starts
// heavy, thins as the ink runs out, and leaves a gap. The same ring marks loading, the compass and beacons.
// Helpers: a Canvas 2D stroke (compass) and a 3D tube (beacons). The loading ensō is SVG in index.html.
import * as THREE from 'three';

// width along the stroke, t in 0..1: a pressed start, a long even body, a dry-brush tail
export const ensoWidth = (t) => (0.55 + 0.45 * Math.min(1, t / 0.06)) * (1 - 0.75 * Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.6)) * (1 + 0.06 * Math.sin(t * 23.0));

// Canvas 2D: centre, radius, max width (px), gap centred at angle `at` (radians, canvas angles; -PI/2 = up)
export function drawEnso(ctx, cx, cy, r, w, { at = -Math.PI / 2, gap = 0.5, color = '#efe6d2', alpha = 0.9 } = {}) {
  const a0 = at + gap / 2, span = Math.PI * 2 - gap, N = 96, outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = a0 + span * t, ww = w * ensoWidth(t) / 2, rr = r + Math.sin(t * 9.0 + 1.3) * w * 0.08;
    outer.push([cx + Math.cos(a) * (rr + ww), cy + Math.sin(a) * (rr + ww)]);
    inner.push([cx + Math.cos(a) * (rr - ww), cy + Math.sin(a) * (rr - ww)]);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath();
  outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

// 3D: a tube along the open ring in the XY plane, radius tapering like the brush (beacons)
export function ensoGeometry(r = 0.5, tube = 0.06, { gap = 0.55, tubular = 72, radial = 8 } = {}) {
  const a0 = Math.PI / 2 + gap / 2, span = Math.PI * 2 - gap;
  class Arc extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = a0 + span * t; return o.set(Math.cos(a) * r, Math.sin(a) * r, 0); } }
  const curve = new Arc(), g = new THREE.TubeGeometry(curve, tubular, tube, radial, false), pos = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular, k = ensoWidth(t); curve.getPoint(t, c);
    for (let j = 0; j <= radial; j++) { const n = i * (radial + 1) + j; v.fromBufferAttribute(pos, n).sub(c).multiplyScalar(k).add(c); pos.setXYZ(n, v.x, v.y, v.z); }
  }
  g.computeVertexNormals();
  return g;
}
