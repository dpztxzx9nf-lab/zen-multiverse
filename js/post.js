// Finishing passes: god rays through the bamboo (PC) and one painterly grade for every tier
// (split-toned shadows/highlights, soft contrast, sun haze, vignette, film grain, PC tilt-shift).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createGodRays(samples) {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 1.2) }, uI: { value: 0 },
      uCol: { value: new THREE.Color(1, 0.9, 0.7) }, uAspect: { value: 1.6 }, uTime: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uI, uAspect, uTime; uniform vec3 uCol; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        if (uI <= 0.001) { gl_FragColor = base; return; }
        vec2 delta = (uSun - vUv) * (0.85 / ${samples.toFixed(1)});
        vec2 uv = vUv + delta * hash(gl_FragCoord.xy + fract(uTime) * 61.0);
        float illum = 0.0, decay = 1.0;
        for (int i = 0; i < ${samples}; i++) {
          uv += delta;
          vec4 s = texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999)));
          float m = step(1.5, s.a) * min(dot(s.rgb, vec3(0.3, 0.59, 0.11)), 3.0);
          illum += m * decay;
          decay *= 0.965;
        }
        illum /= ${samples.toFixed(1)};
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        float fall = exp(-length(d) * 0.7);
        gl_FragColor = vec4(base.rgb + uCol * illum * fall * uI * 1.6, base.a);
      }`,
  });
}

export function createGrade({ tilt = false, grain = true }) {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uShadow: { value: new THREE.Color(0.96, 0.98, 1.06) }, uHigh: { value: new THREE.Color(1.04, 1.0, 0.95) },
      uSat: { value: 1.06 }, uContrast: { value: 0.12 }, uVig: { value: 0.22 }, uGrain: { value: grain ? 0.025 : 0 },
      uSun: { value: new THREE.Vector2(0.5, 1.2) }, uHaze: { value: 0 }, uHazeCol: { value: new THREE.Color(1, 0.85, 0.6) },
      uTilt: { value: tilt ? 1 : 0 }, uLift: { value: new THREE.Color(0, 0, 0) }, uFade: { value: 0 }, uBlack: { value: 0 },
      uHeat: { value: 0 }, uHorizon: { value: 0.7 }, uSharp: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uSat, uContrast, uVig, uGrain, uHaze, uTilt, uFade, uHeat, uHorizon, uBlack, uSharp; uniform vec2 uRes, uSun;
      uniform vec3 uShadow, uHigh, uHazeCol, uLift; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        // salt-flat mirage: a thin shimmering band just above/below the horizon on hot bright days
        float band = exp(-pow((vUv.y - uHorizon) * 38.0, 2.0)) * uHeat;
        vec2 suv = vUv + vec2(sin(vUv.y * 420.0 + uTime * 2.3) * 0.0011 + sin(vUv.x * 60.0 - uTime * 1.1) * 0.0004, sin(vUv.x * 90.0 + uTime * 1.7) * 0.0008) * band;
        vec3 c = texture2D(tDiffuse, suv).rgb;
        // lower render scales (quality ladder): contrast-adaptive sharpen (CAS-style, 4 taps), clamped to the
        // local min/max so it can't ring, so the browser's upscale of a smaller canvas still reads crisp
        if (uSharp > 0.0) {
          vec2 px = 1.0 / uRes;
          vec3 n = texture2D(tDiffuse, suv + vec2(0.0, px.y)).rgb, s2 = texture2D(tDiffuse, suv - vec2(0.0, px.y)).rgb;
          vec3 e = texture2D(tDiffuse, suv + vec2(px.x, 0.0)).rgb, w = texture2D(tDiffuse, suv - vec2(px.x, 0.0)).rgb;
          vec3 mn = min(c, min(min(n, s2), min(e, w))), mx = max(c, max(max(n, s2), max(e, w)));
          vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
          vec3 wgt = -amp * uSharp * 0.2;
          c = clamp((c + (n + s2 + e + w) * wgt) / (1.0 + 4.0 * wgt), mn, mx);
        }
        c += vec3(0.05, 0.05, 0.055) * band * (0.6 + 0.4 * sin(vUv.x * 30.0 + uTime * 0.6));
        ${tilt ? `
        // gentle tilt-shift: soften the far top and near bottom of the frame (diorama feel)
        float b = (smoothstep(0.30, 0.0, vUv.y) * 0.8 + smoothstep(0.7, 1.0, vUv.y) * 0.7) * uTilt;
        if (b > 0.02) {
          vec2 px = b * 2.6 / uRes;
          vec3 acc = c;
          acc += texture2D(tDiffuse, vUv + vec2( 1.0,  0.3) * px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2(-0.6,  1.0) * px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2(-1.0, -0.4) * px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2( 0.5, -1.0) * px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2( 1.9, -0.6) * px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2(-1.8,  0.8) * px).rgb;
          c = acc / 7.0;
        }` : ''}
        float aspect = uRes.x / uRes.y;
        // sun haze (cheap atmospheric glow toward the sun, screen-blended)
        vec2 sd = (vUv - uSun) * vec2(aspect, 1.0);
        vec3 h = uHazeCol * uHaze * exp(-dot(sd, sd) * 1.6);
        // dehaze: into the sun the veiling glare of fog + glow lifts the blacks; re-seat the black point
        c = max(c - uBlack, 0.0) / (1.0 - uBlack);
        c = 1.0 - (1.0 - c) * (1.0 - clamp(h, 0.0, 1.0));
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(lum), c, uSat);
        c *= mix(uShadow, uHigh, smoothstep(0.05, 0.75, lum));
        c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
        c += uLift * (1.0 - lum);
        float v = length((vUv - 0.5) * vec2(aspect * 0.75, 1.0));
        c *= 1.0 - uVig * smoothstep(0.35, 0.95, v);
        c += (hash(vUv * uRes + fract(uTime * 7.13) * 100.0) - 0.5) * uGrain;
        c = mix(c, vec3(0.96, 0.95, 0.92), uFade);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });
}
