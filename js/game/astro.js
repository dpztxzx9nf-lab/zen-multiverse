// Low-precision real-time astronomy (good to a degree or so): where the sun and moon are overhead
// right now, in Earth-fixed latitude/longitude, plus the moon's phase. All angles in radians.
const RAD = Math.PI / 180;
function days(date) { return date.getTime() / 86400000 - 10957.5; } // days since J2000.0
function gmst(d) { return ((280.46061837 + 360.98564736629 * d) % 360) * RAD; }
function eqToGeo(ra, dec, d) { let lon = ra - gmst(d); lon = Math.atan2(Math.sin(lon), Math.cos(lon)); return { lat: dec, lon }; }
export function sunNow(date = new Date()) {
  const d = days(date);
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  return { ...eqToGeo(ra, dec, d), eclLon: L };
}
export function moonNow(date = new Date()) {
  const d = days(date);
  const L = (218.316 + 13.176396 * d) * RAD, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.22935 * d) * RAD;
  const lon = L + 6.289 * RAD * Math.sin(M), lat = 5.128 * RAD * Math.sin(F), e = 23.439 * RAD;
  const ra = Math.atan2(Math.sin(lon) * Math.cos(e) - Math.tan(lat) * Math.sin(e), Math.cos(lon));
  const dec = Math.asin(Math.sin(lat) * Math.cos(e) + Math.cos(lat) * Math.sin(e) * Math.sin(lon));
  const sun = sunNow(date);
  let el = lon - sun.eclLon; el = Math.atan2(Math.sin(el), Math.cos(el));
  // phase: 0 new, 0.5 full; illum fraction
  const phase = ((el / (Math.PI * 2)) % 1 + 1) % 1;
  return { ...eqToGeo(ra, dec, d), phase, illum: (1 - Math.cos(el)) / 2 };
}
// Earth-fixed direction for a lat/lon, matching three.js SphereGeometry's equirectangular UVs
export function llDir(lat, lon, out) {
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}
export const HOME = { lat: 40.167 * RAD, lon: -105.1 * RAD }; // Longmont, Colorado
