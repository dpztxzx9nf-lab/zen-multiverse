// The painted sky (Raked Light): shared by the garden's dome (js/sky.js) and every planet's (js/worlds/planet.js).
// The colours still come from the sky model (zenith, horizon and sun colour for this sun height and air);
// only the brush is ours: a three-stop gradient with a warm horizon band, a flat sun disc with a soft
// halo, and cumulus in three tones with crisp edges. Needs vnoise(vec2) defined before it.
export const PAINT_SKY = /* glsl */ `
float zmFbm3( vec2 p ) { return 0.55 * vnoise( p ) + 0.3 * vnoise( p * 2.13 + 3.1 ) + 0.15 * vnoise( p * 4.37 + 7.7 ); }
vec3 zmPaintSky( vec3 d, vec3 zen, vec3 hor, vec3 sunDir, vec3 sunCol, float sunVis, float golden, float night, float overcast, float t, float clouds ) {
  float h = d.y;
  vec3 mid = mix( hor, zen, 0.5 );
  vec3 col = mix( hor * 1.04, mid, smoothstep( -0.03, 0.2, h ) );
  col = mix( col, zen * 0.94, smoothstep( 0.16, 0.8, h ) );
  // a warm brushed band along the horizon on the sun's side
  vec2 hs = normalize( vec2( sunDir.x, sunDir.z ) + 1e-4 );
  float side = 0.5 + 0.5 * dot( normalize( d.xz + 1e-4 ), hs );
  col += sunCol * ( 0.05 + 0.2 * golden ) * side * ( 1.0 - smoothstep( 0.0, 0.14, abs( h - 0.02 ) ) );
  col = mix( col, hor * 0.82, smoothstep( 0.0, -0.2, h ) );
  // a painter's sky is a little bluer than the eye's: lift saturation up high, keep the horizon chalky
  col = max( mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, 1.0 + 0.28 * smoothstep( 0.05, 0.5, h ) ), 0.0 );
  // sun: halo, then a flat disc (no photographic bloom core)
  float ang = acos( clamp( dot( d, sunDir ), -1.0, 1.0 ) );
  col += sunCol * sunVis * ( exp( -ang * ang * 40.0 ) * 0.4 + exp( -ang * 5.0 ) * 0.1 );
  col = mix( col, sunCol * 2.6 + vec3( 0.5, 0.48, 0.42 ), smoothstep( 0.036, 0.031, ang ) * sunVis );
  if ( h > 0.0 && clouds > 0.001 ) {
    vec2 cp = d.xz / ( h + 0.2 ) * 0.85 + vec2( t * 0.004, t * 0.0015 );
    vec2 wq = vec2( vnoise( cp * 0.6 ), vnoise( cp * 0.6 + 7.3 ) );
    vec2 q = cp + wq * 1.3;
    float n = zmFbm3( q );
    float cov = mix( 0.53, 0.3, overcast );
    float m = smoothstep( cov, cov + 0.035, n ) * smoothstep( 0.0, 0.1, h ) * clouds;
    // which way the density falls toward the sun: that edge is lit
    float n2 = zmFbm3( q + hs * 0.09 );
    float lit = clamp( ( n - n2 ) * 9.0 + 0.45 + 0.25 * sunDir.y, 0.0, 1.0 );
    float core = smoothstep( cov + 0.06, cov + 0.22, n );
    float tone = lit - core * 0.35;
    vec3 cShade = mix( zen, hor, 0.72 ) * 0.92 + vec3( 0.07, 0.075, 0.1 );
    vec3 cMid = mix( hor, vec3( 1.0 ), 0.6 ) * 0.98;
    vec3 cLit = mix( vec3( 1.14, 1.1, 1.02 ), sunCol * 1.2, 0.22 + 0.5 * golden );
    vec3 cc = mix( cShade, cMid, smoothstep( 0.2, 0.3, tone ) );
    cc = mix( cc, cLit, smoothstep( 0.52, 0.6, tone ) );
    cc = mix( cc, zen * 1.6 + vec3( 0.02, 0.025, 0.05 ), night );
    cc = mix( cc, vec3( dot( cc, vec3( 0.33 ) ) ) * 0.9, overcast * 0.6 );
    col = mix( col, cc, m * 0.96 );
  }
  return col;
}`;
