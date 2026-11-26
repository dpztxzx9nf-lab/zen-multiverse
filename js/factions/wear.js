// Where a camp's ground is worn (pure, no three.js): people walking the same few lines every day break the salt
// crust and pack the mud under it. Every stroke has a cause in the camp's own data: the hearth everyone gathers
// at, the tent doors and the storehouse gate they come and go through, where each person stands, and the trail
// out to the camp's road marker. Busier lines (shared by more trips) are wider and darker; a trail fades with
// distance from the hearth, where fewer feet reach. js/factions/ground.js paints these onto the ground.
export const DOOR = 1.95;       // a tent's door sits this far in front of its centre (+z), like the drawn door
const r2 = (v) => Math.round(v * 100) / 100;

// props -> camps: one per faction, centred on its hearth (the fire nearest that faction's tents)
export function campsOf(props, people = []) {
  const byF = {};
  for (const p of props) if (p.f && p.k !== 'road') (byF[p.f] = byF[p.f] || []).push(p);
  const fires = props.filter((p) => p.k === 'fire');
  const out = [];
  for (const [f, ps] of Object.entries(byF)) {
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length, cz = ps.reduce((s, p) => s + p.z, 0) / ps.length;
    let fire = null, best = 1e9;
    for (const q of fires) { const d = Math.hypot(q.x - cx, q.z - cz); if (d < best && d < 16) { best = d; fire = q; } }
    const hearth = fire ? { x: fire.x, z: fire.z } : { x: r2(cx), z: r2(cz) };
    const road = props.find((p) => p.k === 'road' && p.f === f && Math.hypot(p.x - hearth.x, p.z - hearth.z) < 60) || null;
    const folk = people.filter((n) => n.f === f && n.home && Math.hypot(n.home[0] - hearth.x, n.home[1] - hearth.z) < 16);
    out.push({ f, hearth, fire: !!fire, props: ps, road, folk });
  }
  return out;
}

// one camp -> strokes: { k: 'disc', x, z, r, w } and { k: 'line', pts: [[x,z],...], w, fade } (w = how worn, 0..1)
export function wearOf(camp) {
  const H = camp.hearth, S = [];
  const line = (x, z, w, width) => S.push({ k: 'line', pts: [[H.x, H.z], [r2(x), r2(z)]], w, width });
  if (camp.fire) { S.push({ k: 'ash', x: H.x, z: H.z, r: 1.3 }); S.push({ k: 'disc', x: H.x, z: H.z, r: 3.2, w: 0.9 }); }
  for (const p of camp.props) {
    if (p.k === 'tent') { const d = { x: p.x, z: p.z + DOOR }; S.push({ k: 'disc', x: d.x, z: d.z + 0.5, r: 1.2, w: 0.7 }); line(d.x, d.z + 0.4, 0.75, 0.9); }
    if (p.k === 'store' && p.gate) { S.push({ k: 'disc', x: p.gate.x, z: p.gate.z, r: 1.4, w: 0.8 }); line(p.gate.x, p.gate.z, 0.85, 1.1); }
    if (p.k === 'leanto') { S.push({ k: 'disc', x: p.x, z: p.z - 0.3, r: 1.8, w: 0.7 }); line(p.x, p.z - 0.3, 0.7, 1.0); }
    if (p.k === 'banner' || p.k === 'post') line(p.x, p.z, 0.35, 0.6);
  }
  for (const n of camp.folk) { S.push({ k: 'disc', x: n.home[0], z: n.home[1], r: 0.9, w: 0.55 }); line(n.home[0], n.home[1], 0.45, 0.7); }
  if (camp.road) {
    // the trail: hearth -> road marker -> on out the same way, fading where fewer people walk
    const R = camp.road, dx = R.x - H.x, dz = R.z - H.z, L = Math.hypot(dx, dz) || 1;
    const bend = 0.12 * L; // trails wander a little: one gentle bend, the same every time
    const mid = [r2(H.x + dx * 0.5 - dz / L * bend), r2(H.z + dz * 0.5 + dx / L * bend)];
    S.push({ k: 'line', pts: [[H.x, H.z], mid, [R.x, R.z], [r2(R.x + dx / L * 14), r2(R.z + dz / L * 14)]], w: 0.8, width: 1.2, fade: L + 14 });
  }
  return S;
}

// how worn the ground is at (x, z): the same field the painter draws (for tests and for keeping plants off paths)
export function wearAt(strokes, x, z) {
  let w = 0;
  for (const s of strokes) {
    if (s.k === 'disc' || s.k === 'ash') { const d = Math.hypot(x - s.x, z - s.z), r = s.r; if (d < r) w = Math.max(w, (s.w ?? 1) * (1 - (d / r) ** 2)); continue; }
    let along = 0;
    for (let i = 1; i < s.pts.length; i++) {
      const [ax, az] = s.pts[i - 1], [bx, bz] = s.pts[i], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * u, pz = az + ez * u;
      const d = Math.hypot(x - px, z - pz), half = s.width / 2;
      if (d < half) { const f = s.fade ? Math.max(0, 1 - (along + Math.sqrt(L2) * u) / s.fade) ** 0.7 : 1; w = Math.max(w, s.w * f * (1 - (d / half) ** 2)); }
      along += Math.sqrt(L2);
    }
  }
  return Math.min(1, w);
}
