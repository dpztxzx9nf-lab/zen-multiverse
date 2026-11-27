// Owner-only dev mode. The client only shows the toggle when the server said this account
// is allowed (from /me and the signed ticket). It never checks the player's name.
import { setDevUnlock } from './store.js';

let allowed = false, on = false;
const fns = new Set();
let net = { fire: null, refresh: null, rtt: () => 0 };

export function devAllowed() { return allowed; }
export function devOn() { return on; }
export function onDevChange(fn) { fns.add(fn); return () => fns.delete(fn); }
export function bindDevNet(h) { net = { ...net, ...h }; }
export function devFire(dir) { if (on && net.fire) net.fire(dir); }
export function devRtt() { return net.rtt() || 0; }
let hitFn = null;
export function onDevHit(fn) { hitFn = fn; }
export function devHit(m) { if (hitFn) hitFn(m); }

function emit() { for (const f of fns) { try { f({ allowed, on }); } catch (e) { console.warn(e); } } }

export function setDevAllowed(v) {
  allowed = !!v;
  if (!allowed && on) setDevOn(false);
  else emit();
}

export function setDevOn(v) {
  const want = !!v && allowed;
  if (want === on) return on;
  on = want;
  setDevUnlock(on);
  emit();
  if (net.refresh) net.refresh();
  return on;
}
