// Shared handle so looted guns and the starter pistol can fire on the server
// without going through Dev mode. Camp announces and loot claims are queued
// while the socket is down, then flushed when it opens, so a camp you load
// next to is not silently dropped.
const QUEUE_MAX = 32;
let net = { fire: null, rtt: () => 0, send: null, open: false };
let queue = [];
const readyHooks = new Set();

function canSend() { return !!(net.send && net.open); }

export function resetGunNet() {
  net = { fire: null, rtt: () => 0, send: null, open: false };
  queue = [];
  readyHooks.clear();
}

export function bindGunNet(h) {
  net = { ...net, ...h };
  if (h && Object.prototype.hasOwnProperty.call(h, 'open')) net.open = !!h.open;
  if (canSend()) flushGunNet();
}

export function gunNetOpen(on) {
  const was = !!net.open;
  net.open = !!on;
  if (net.open) {
    flushGunNet();
    if (!was) for (const fn of [...readyHooks]) { try { fn(); } catch { /* */ } }
  }
}

export function onGunNetOpen(fn) {
  readyHooks.add(fn);
  return () => readyHooks.delete(fn);
}

export function gunNetIsOpen() { return canSend(); }

export function gunFire(dir) { if (net.fire) net.fire(dir); }
export function gunRtt() { return net.rtt() || 0; }

export function gunSend(m) {
  if (!m) return false;
  if (canSend()) { net.send(m); return true; }
  queue.push(m);
  if (queue.length > QUEUE_MAX) queue.shift();
  return false;
}

export function flushGunNet() {
  if (!canSend() || !queue.length) return 0;
  const pending = queue; queue = [];
  for (const m of pending) net.send(m);
  return pending.length;
}

export function queuedGunNet() { return queue.slice(); }
