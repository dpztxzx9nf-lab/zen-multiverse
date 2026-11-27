// Shared handle so looted guns and the starter pistol can fire on the server
// without going through Dev mode.
let net = { fire: null, rtt: () => 0, send: null };
export function bindGunNet(h) { net = { ...net, ...h }; }
export function gunFire(dir) { if (net.fire) net.fire(dir); }
export function gunRtt() { return net.rtt() || 0; }
export function gunSend(m) { if (net.send) net.send(m); }
