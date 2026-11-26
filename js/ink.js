// Ink: the brush's outline pass (Raked Light, art bible section 3b). One cheap screen pass over the scene's
// own depth: silhouettes (a big jump in distance) and creases (a bend in the surface) get a line of ink.
// The ink is not black: it is the colour under it, darkened and cooled, like a sumi wash over paint, and
// it thins with distance so far forests read as masses, not scribbles. Phones get a thinner, 4-tap line.
//   garden: createInkPass({ P, camera, depth: () => texture })  (a composer pass, linear in / linear out)
//   planet / moon: createInkView(renderer, { P }) -> view.render(scene, camera)  (scene -> RT -> ink -> screen)
// ?ink=0 turns it off (also off with ?look=0).
import * as THREE from 'three';
import { LOOK_ON } from './look.js';

const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const INK_ON = LOOK_ON && qs.get('ink') !== '0';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
function frag(final, taps8) {
  return `
uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uK, uW, uFade, uOn, uPaint; varying vec2 vUv;
float rawD( vec2 uv ) { return texture2D( tDepth, uv ).x; }
// view distance from the hardware depth (perspective)
// strokes are mixed in a compressed space, so one HDR glint can't smear into a glowing blob
vec3 zmC( vec3 x ) { return x / ( 1.0 + dot( x, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
float linD( float d ) { return ( uNear * uFar ) / max( ( uFar - d * ( uFar - uNear ) ), 1e-6 ); }
void main() {
  vec4 src = texture2D( tDiffuse, vUv );
  vec3 c = src.rgb;
  ${taps8 ? `
  // brushwork (desktop): a 4-sector Kuwahara filter turns photo grit into flat strokes but keeps edges
  if ( uPaint > 0.0 ) {
    vec2 pp = uPaint * max( 1.0, uRes.y / 900.0 ) / uRes; // the same brush size on any screen
    vec3 m0 = vec3( 0.0 ), m1 = vec3( 0.0 ), m2 = vec3( 0.0 ), m3 = vec3( 0.0 ), q0 = vec3( 0.0 ), q1 = vec3( 0.0 ), q2 = vec3( 0.0 ), q3 = vec3( 0.0 );
    for ( int j = 0; j <= 2; j++ ) for ( int i = 0; i <= 2; i++ ) {
      vec2 o = vec2( float( i ), float( j ) ) * pp;
      vec3 a = zmC( texture2D( tDiffuse, vUv + vec2( -o.x, -o.y ) ).rgb ); m0 += a; q0 += a * a;
      vec3 b = zmC( texture2D( tDiffuse, vUv + vec2( o.x, -o.y ) ).rgb ); m1 += b; q1 += b * b;
      vec3 e = zmC( texture2D( tDiffuse, vUv + vec2( -o.x, o.y ) ).rgb ); m2 += e; q2 += e * e;
      vec3 g = zmC( texture2D( tDiffuse, vUv + vec2( o.x, o.y ) ).rgb ); m3 += g; q3 += g * g;
    }
    m0 /= 9.0; m1 /= 9.0; m2 /= 9.0; m3 /= 9.0;
    vec3 W3 = vec3( 0.2126, 0.7152, 0.0722 );
    // variance in log-ish space so bright and dark areas paint alike
    float v0 = dot( q0 / 9.0 - m0 * m0, W3 ) / ( dot( m0, W3 ) + 0.05 ), v1 = dot( q1 / 9.0 - m1 * m1, W3 ) / ( dot( m1, W3 ) + 0.05 );
    float v2 = dot( q2 / 9.0 - m2 * m2, W3 ) / ( dot( m2, W3 ) + 0.05 ), v3 = dot( q3 / 9.0 - m3 * m3, W3 ) / ( dot( m3, W3 ) + 0.05 );
    vec3 k = m0; float vm = v0;
    if ( v1 < vm ) { vm = v1; k = m1; } if ( v2 < vm ) { vm = v2; k = m2; } if ( v3 < vm ) { vm = v3; k = m3; }
    k = k / max( 1.0 - dot( k, W3 ), 0.02 ); // back out of the compressed space
    c = mix( c, k, 0.85 * ( 1.0 - smoothstep( 1.5, 4.0, dot( c, W3 ) ) ) ); // glints stay glints
  }` : ''}
  if ( uOn > 0.5 ) {
    float d0 = rawD( vUv );
    float z0 = linD( d0 );
    // line width in pixels: full near, thinner with distance
    float w = uW * max( 1.0, uRes.y / 900.0 ) * mix( 1.0, 0.6, smoothstep( 8.0, 60.0, z0 ) );
    vec2 px = w / uRes;
    float dl = rawD( vUv - vec2( px.x, 0.0 ) ), dr = rawD( vUv + vec2( px.x, 0.0 ) );
    float dd = rawD( vUv - vec2( 0.0, px.y ) ), du = rawD( vUv + vec2( 0.0, px.y ) );
    float zl = linD( dl ), zr = linD( dr ), zd = linD( dd ), zu = linD( du );
    float rz = 1.0 / max( z0, 0.5 );
    // silhouette: a neighbour much farther than us (the ink sits on the near object's edge). A feature
    // thinner than the line (both sides farther: a grass blade, a twig) gets no ink, so meadows stay calm.
    float gl = ( zl - z0 ) * rz, gr = ( zr - z0 ) * rz, gd = ( zd - z0 ) * rz, gu = ( zu - z0 ) * rz;
    // and the near side must be solid two more line-widths in (grass blades and twigs are not)
    float zl2 = linD( rawD( vUv - vec2( px.x * 2.5, 0.0 ) ) ), zr2 = linD( rawD( vUv + vec2( px.x * 2.5, 0.0 ) ) );
    float zd2 = linD( rawD( vUv - vec2( 0.0, px.y * 2.5 ) ) ), zu2 = linD( rawD( vUv + vec2( 0.0, px.y * 2.5 ) ) );
    float solidR = 1.0 - smoothstep( 0.02, 0.05, abs( zl2 - z0 ) * rz ), solidL = 1.0 - smoothstep( 0.02, 0.05, abs( zr2 - z0 ) * rz );
    float solidU = 1.0 - smoothstep( 0.02, 0.05, abs( zd2 - z0 ) * rz ), solidD = 1.0 - smoothstep( 0.02, 0.05, abs( zu2 - z0 ) * rz );
    float sx = max( smoothstep( 0.05, 0.14, gr ) * solidR, smoothstep( 0.05, 0.14, gl ) * solidL ) * ( 1.0 - smoothstep( 0.02, 0.05, min( gl, gr ) ) );
    float sy = max( smoothstep( 0.05, 0.14, gu ) * solidU, smoothstep( 0.05, 0.14, gd ) * solidD ) * ( 1.0 - smoothstep( 0.02, 0.05, min( gd, gu ) ) );
    float sil = max( sx, sy ) * step( d0, 0.99999 );
    // crease: 1/z is flat across any plane, so its laplacian only sees bends; only on one continuous surface
    float w0 = 1.0 / z0;
    float lap = ( abs( 1.0 / zl + 1.0 / zr - 2.0 * w0 ) + abs( 1.0 / zd + 1.0 / zu - 2.0 * w0 ) ) / w0;
    float cont = 1.0 - smoothstep( 0.015, 0.035, max( max( abs( gl ), abs( gr ) ), max( abs( gd ), abs( gu ) ) ) );
    lap *= cont;
    float crease = smoothstep( 0.012, 0.05, lap ) * ( 1.0 - sil );
    float e = max( sil, crease * 0.55 );
    // far things: masses, not scribbles
    e *= 1.0 - uFade * smoothstep( 25.0, 220.0, z0 );
    // sumi wash: the colour under the line, darkened and cooled (keeps its hue, never pure black)
    float L = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    vec3 inkC = c * vec3( 0.22, 0.2, 0.28 ) + vec3( 0.004, 0.004, 0.008 ) * ( 1.0 - L );
    c = mix( c, inkC, e * uK );
  }
  gl_FragColor = vec4( c, src.a );
  ${final ? `#include <tonemapping_fragment>
  #include <colorspace_fragment>
  // the sky dome writes display values itself (a direct render never tone-maps a plain ShaderMaterial)
  if ( texture2D( tDepth, vUv ).x >= 0.99999 ) gl_FragColor.rgb = src.rgb;` : ''}
}`;
}
function makeMat(P, final) {
  const phone = P.cls === 'phone';
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uK: { value: 1.0 }, uW: { value: phone ? 1.2 : 1.7 }, uFade: { value: 0.85 },
      uOn: { value: INK_ON ? 1 : 0 }, uPaint: { value: phone || qs.get('paint') === '0' ? 0 : 1.5 },
    },
    vertexShader: VERT, fragmentShader: frag(final, !phone), depthTest: false, depthWrite: false, toneMapped: final,
  });
}
const quad = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
};

// a composer pass (the garden): reads the scene colour from readBuffer and the depth from depth()
export function createInkPass({ P, camera, depth }) {
  const mat = makeMat(P, false);
  const mesh = new THREE.Mesh(quad(), mat); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = {
    enabled: INK_ON, needsSwap: true, clear: false, renderToScreen: false, isInk: true, uniforms: mat.uniforms,
    setSize(w, h) { mat.uniforms.uRes.value.set(w, h); },
    render(renderer, writeBuffer, readBuffer) {
      const dt = depth(readBuffer);
      if (!dt) { mat.uniforms.uOn.value = 0; } else { mat.uniforms.uOn.value = 1; mat.uniforms.tDepth.value = dt; }
      mat.uniforms.tDiffuse.value = readBuffer.texture;
      mat.uniforms.uNear.value = camera.near; mat.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      renderer.render(sc, cam);
    },
    dispose() { mat.dispose(); mesh.geometry.dispose(); },
  };
  return pass;
}

// a direct-render world (planet, moon): scene -> HDR target with depth -> ink + tonemap -> screen
export function createInkView(renderer, { P }) {
  if (!INK_ON) return { on: false, render: (s, c) => renderer.render(s, c), dispose() {} };
  const mat = makeMat(P, true);
  const mesh = new THREE.Mesh(quad(), mat); mesh.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const dtex = new THREE.DepthTexture(1, 1); dtex.type = THREE.FloatType; // 32-bit: a 24-bit target let the thin sea plane bleed through flat beaches
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: P.samples || 0, depthTexture: dtex });
  const size = new THREE.Vector2();
  return {
    on: true, uniforms: mat.uniforms, target: rt,
    bypass: false,
    render(scene, camera) {
      if (this.bypass) { renderer.render(scene, camera); return; }
      renderer.getDrawingBufferSize(size);
      if (rt.width !== size.x || rt.height !== size.y) { rt.setSize(size.x, size.y); mat.uniforms.uRes.value.copy(size); }
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      mat.uniforms.tDiffuse.value = rt.texture; mat.uniforms.tDepth.value = rt.depthTexture;
      mat.uniforms.uNear.value = camera.near; mat.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(prev); renderer.render(sc, cam);
    },
    dispose() { rt.dispose(); dtex.dispose(); mat.dispose(); mesh.geometry.dispose(); },
  };
}
