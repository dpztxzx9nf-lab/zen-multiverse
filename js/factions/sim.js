// Factions without a reputation number. Pure state + functions, shared by the multiplayer server (the authority,
// server/src/factions.js) and the offline game (js/factions/client.js), so both work out the same world.
//
//   People see (sight range, a field of view, tents and banks in the way) and hear (loudness in dB at 1 m,
//   spreading loss, air absorption, and the air itself via audio-medium.js: no air, no sound). What they
//   perceive becomes a memory: who, did what, to whom, how they know (saw / heard / found / told), when, where.
//   Memories fade with age, and die with the person who held them.
//   News moves only by contact: two people of the same side within talking distance tell each other what
//   they know; a courier walks it to the road, and from there it travels between worlds at ship speed.
//   Nobody has a score. When you meet someone, how they treat you is worked out right then from what that
//   one person remembers (mind()), and what they say quotes those memories.
//   People walk on fixed loops in absolute time, so the server and every client place them identically
//   without a tick loop; a freed or spared person walks home at walking (or limping) pace, and a tracker
//   follows your real footprints, which go cold after a while.
import { air as airOf } from '../audio-medium.js';

export const FA_V = 1;
const hyp = Math.hypot;
const r2 = (v) => Math.round(v * 100) / 100;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---- a fresh scene from the data (home: Xenia's hub frame, anchor 0,0 plus the scene's offset; elsewhere: near the first arrival)
export function createScene(D, kind, anchor = { x: 0, z: 0, tile: null }) {
  const S = D.scenes[kind]; if (!S) throw new Error('no scene ' + kind);
  const off = S.offset || [0, 0];
  const ax = anchor.x + off[0], az = anchor.z + off[1];
  const P = (p) => [r2(ax + p[0]), r2(az + p[1])];
  const st = { v: FA_V, kind, anchor: { x: ax, z: az, tile: anchor.tile || null }, t: 0, seq: 0, npcs: {}, caches: {}, packs: {}, mem: {}, bodies: [], trails: {}, last: {}, owed: {}, out: [], sent: {}, seen: {}, names: {} };
  for (const p of S.people) {
    const n = { id: p.id, name: p.name, f: p.f, role: p.role, pr: p.pr || 'm', st: p.state || 'ok', home: P(p.home), yaw: p.yaw || 0 };
    if (p.teaches) n.teaches = p.teaches;
    if (p.held) n.held = p.held;
    if (p.at) n.mv = { k: 'stay', x: P(p.at)[0], z: P(p.at)[1], yaw: p.yaw || 0 };
    else n.mv = loopOf(p.path.map(P), p.v || 1, p.id, p.yaw || 0);
    st.npcs[p.id] = n; st.mem[p.id] = [];
  }
  for (const c of S.caches) { const [x, z] = P([c.x, c.z]); st.caches[c.id] = { id: c.id, f: c.f, x, z, goods: { ...c.goods } }; }
  for (const k of S.packs) { const [x, z] = P([k.x, k.z]); st.packs[k.id] = { id: k.id, owner: k.owner, x, z, goods: { ...k.goods }, st: 'ground', by: null }; }
  st.props = S.props.map((p) => ({ ...p, x: r2(ax + p.x), z: r2(az + p.z), ...(p.gate ? { gate: { x: r2(ax + p.gate.x), z: r2(az + p.gate.z) } } : {}) }));
  st.occ = S.occluders.map((o) => ({ x: r2(ax + o.x), z: r2(az + o.z), r: o.r, what: o.what }));
  return st;
}
// Xenia moved the home camps out of the old garden (scenes.home.offset): a saved home scene from before keeps
// everything people remember (memories, debts, who is hurt or held, what the caches hold, the packs) and gets
// the new layout. Returns the state to use (the same one when nothing needed moving).
export function migrateScene(D, st) {
  if (!st || st.kind !== 'home') return st;
  const off = (D.scenes.home && D.scenes.home.offset) || [0, 0];
  if (Math.abs(st.anchor.x - off[0]) < 0.01 && Math.abs(st.anchor.z - off[1]) < 0.01) return st;
  const dx = off[0] - st.anchor.x, dz = off[1] - st.anchor.z;
  const fresh = createScene(D, 'home', { x: 0, z: 0, tile: st.anchor.tile || null });
  for (const k of ['t', 'seq', 'mem', 'last', 'owed', 'sent', 'seen', 'names']) if (st[k] !== undefined) fresh[k] = st[k];
  for (const [id, n] of Object.entries(st.npcs || {})) {
    const f = fresh.npcs[id]; if (!f) continue;
    for (const [k, v] of Object.entries(n)) if (k !== 'home' && k !== 'mv' && k !== 'x' && k !== 'z') f[k] = v;
  }
  for (const [id, c] of Object.entries(st.caches || {})) if (fresh.caches[id]) fresh.caches[id].goods = { ...c.goods };
  for (const [id, k] of Object.entries(st.packs || {})) fresh.packs[id] = { ...k, x: r2(k.x + dx), z: r2(k.z + dz) };
  fresh.bodies = (st.bodies || []).map((b) => ({ ...b, ...(b.x != null ? { x: r2(b.x + dx), z: r2(b.z + dz) } : {}) }));
  return fresh;
}
function loopOf(pts, v, id, yaw) {
  if (pts.length < 2) return { k: 'stay', x: pts[0][0], z: pts[0][1], yaw };
  const L = polyLen(pts, true);
  return { k: 'loop', pts, v, ph: r2((hash(id) % 1000) / 1000 * L) };
}
function polyLen(pts, closed) { let L = 0; const n = pts.length; for (let i = 0; i < (closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; L += hyp(b[0] - a[0], b[1] - a[1]); } return L; }
function along(pts, s, closed) {
  const n = pts.length; const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], l = hyp(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === segs - 1) { const k = l > 1e-6 ? Math.min(1, Math.max(0, s / l)) : 0; return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), moving: l > 1e-6 && s < l }; }
    s -= l;
  }
  return { x: pts[0][0], z: pts[0][1], yaw: 0, moving: false };
}

// where someone is at time t (ms). Pure: the same answer on the server and in every client.
export function pos(st, n, t) {
  const m = n.mv;
  if (m.k === 'stay') return { x: m.x, z: m.z, yaw: m.yaw || 0, moving: false };
  if (m.k === 'loop') { const L = polyLen(m.pts, true); const s = ((m.v * t / 1000 + m.ph) % L + L) % L; return along(m.pts, s, true); }
  if (m.k === 'go') { const s = Math.max(0, m.v * (t - m.t0) / 1000); const L = polyLen(m.pts, false); const p = along(m.pts, Math.min(s, L), false); p.moving = s < L; return p; }
  if (m.k === 'track') {
    const tr = (st.trails[m.aid] || []).filter((q) => q[2] >= m.from);
    const pts = [[m.x0, m.z0], ...tr.map((q) => [q[0], q[1]])];
    const s = Math.max(0, m.v * (t - m.t0) / 1000), L = polyLen(pts, false);
    const p = pts.length > 1 ? along(pts, Math.min(s, L), false) : { x: m.x0, z: m.z0, yaw: 0 };
    p.moving = s < L; p.end = s >= L; return p;
  }
  return { x: n.home[0], z: n.home[1], yaw: 0, moving: false };
}
const awake = (n) => n.st !== 'dead';
// what this person is asking for (from the data, by id, so worlds saved before asks existed get them too)
export function asksOf(D, st, n) { const S = D.scenes[st.kind]; const p = S && S.people.find((q) => q.id === n.id); return (p && p.asks) || []; }

// ---- perception: can this person know what just happened at P?
// sight: within range, inside the field of view (or close enough to feel it), nothing solid between.
// hearing: loudness at 1 m minus spherical spreading (20 log10 d) and air absorption, scaled by the air.
export function perceive(D, st, n, P, loud, t, airK = 1) {
  if (!awake(n)) return null;
  const S = D.senses, q = pos(st, n, t), d = hyp(P.x - q.x, P.z - q.z);
  const blocked = st.occ.some((o) => segCircle(q.x, q.z, P.x, P.z, o.x, o.z, o.r) && hyp(o.x - q.x, o.z - q.z) > o.r && hyp(o.x - P.x, o.z - P.z) > o.r);
  if (d <= S.near) return 'saw';
  if (d <= S.sight && !blocked && n.st !== 'bound') {
    let a = Math.atan2(P.x - q.x, P.z - q.z) - q.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) <= S.cone / 2) return 'saw';
  }
  if (n.st === 'bound' && d <= S.sight * 0.6 && !blocked) return 'saw'; // tied up, but can still turn her head
  const lvl = heardDb(D, loud, d, airK, blocked);
  return lvl >= S.hearDb ? 'heard' : null;
}
export function heardDb(D, loud, d, airK = 1, blocked = false) {
  if (airK <= 0) return -Infinity;
  return loud - 20 * Math.log10(Math.max(1, d)) - D.senses.absorbDbPerM * d + 20 * Math.log10(airK) - (blocked ? 8 : 0);
}
export const airFromKPa = (k) => airOf(k);
function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; if (l2 < 1e-9) return false;
  const k = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2));
  return hyp(ax + dx * k - cx, az + dz * k - cz) < r;
}

// ---- memory
export function retention(D, m, t) { const hl = (D.memory.halfLifeDays[m.by] || 90) * 864e5; return Math.pow(0.5, Math.max(0, t - m.at) / hl); }
function remember(st, n, m) {
  const list = st.mem[n.id] || (st.mem[n.id] = []);
  const had = list.find((o) => o.id === m.id);
  if (had) { if (had.s == null && m.s) { Object.assign(had, m); return true; } return false; } // now they know who
  list.push(m); if (list.length > 120) list.splice(0, list.length - 120);
  return true;
}
function meaning(D, f, m) {
  const a = D.acts[m.act]; if (!a) return null;
  const v = a.means[f]; if (!v) return null;
  return v[m.vf === f ? 'ours' : 'theirs'] || null;
}

// How this one person feels about you, from their own memories (oldest first, so the latest weighs last).
// Returns the memories behind it so they can say why.
export function mind(D, st, n, aid, t) {
  const mine = (st.mem[n.id] || []).filter((m) => m.s === aid && retention(D, m, t) >= D.memory.forgetBelow).sort((a, b) => a.at - b.at);
  let grudge = null, owed = null, wrong = null, right = null;
  for (const m of mine) {
    const v = meaning(D, n.f, m), personal = m.v === n.id;
    if (v === 'wrong') { wrong = m; if (personal) grudge = m; }
    if (v === 'right') { right = m; if (personal) owed = m; }
  }
  let stance = 'stranger';
  if (grudge && !(owed && owed.at > grudge.at)) stance = 'hostile';
  else if (owed) stance = 'grateful';
  else if (wrong && !(right && right.at > wrong.at)) stance = 'wary';
  else if (right) stance = 'friendly';
  const hunts = n.f === 'reavers' && (stance === 'hostile' || stance === 'wary');
  return { stance, grudge, owed, wrong, right, hunts, known: mine };
}
export function describe(D, st, m, n) {
  const me = m.v === n.id, f = m.vp === 'f';
  const teller = m.by === 'told' && m.from && m.from === m.vn; // "Sela told me you splinted her ankle"
  const W = me ? { victim: 'me', they: 'I', them: 'me', their: 'my' } : { victim: teller ? (f ? 'her' : 'him') : m.vn || 'someone', they: f ? 'she' : 'he', them: f ? 'her' : 'him', their: f ? 'her' : 'his' };
  const fname = (k) => D.factions[k] ? D.factions[k].name.replace(/^the /, '') : k;
  let s = (D.said[m.by === 'found' ? 'found' : m.act] || m.act).replaceAll("{victim}'s", me ? 'my' : teller ? W.their : `${W.victim}'s`);
  for (const k of Object.keys(W)) s = s.replaceAll(`{${k}}`, W[k]);
  const side = (k) => (k === n.f ? 'our' : `the ${fname(k)}'`);
  s = s.replaceAll('the {victimF}', side(m.vf)).replaceAll('the {captorF}', side(m.cf || 'reavers'));
  if (m.by === 'found') return `${s[0].toUpperCase()}${s.slice(1)}.`;
  if (m.by === 'saw') return `I saw you: you ${s}.`;
  if (m.by === 'heard') return `I heard it, clear as anything: you ${s}.`;
  return `${m.from || 'Someone'} told me you ${s}.`;
}
// what this person says and is willing to do for you
export function talk(D, st, n, aid, t, known = {}) {
  const M = mind(D, st, n, aid, t), why = (m) => (m ? describe(D, st, m, n) : null), lines = [], offers = [];
  const F = n.f;
  if (!awake(n)) return { lines: [], offers, stance: 'gone' };
  if (n.st === 'downed') return { lines: ['(He is hurt badly and can barely lift his head.) "Water…"'], offers, stance: M.stance };
  if (n.st === 'bound') return { lines: ['(Her hands are tied to the post.) "Please. Cut me loose before they come back."'], offers, stance: M.stance };
  if (n.st === 'hurt') return { lines: ['"My ankle is gone. I can\'t walk on it."'], offers, stance: M.stance };
  if (F === 'wardens') {
    if (M.stance === 'hostile') lines.push(why(M.grudge), '"Get away from our camp."');
    else if (M.stance === 'wary') lines.push(why(M.wrong), '"We don\'t trade with people who do that. Move on."');
    else if (M.stance === 'grateful') lines.push(why(M.owed), '"You\'re welcome at our fire, always."');
    else if (M.stance === 'friendly') lines.push(why(M.right), '"Sit, rest. What do you need?"');
    else lines.push(`"A stranger. We are ${D.factions[F].name}. We keep the trails here."`);
    const good = M.stance === 'friendly' || M.stance === 'grateful';
    if (good) offers.push('trade', 'shelter');
    if (n.role === 'teacher' && good && !known[n.teaches]) offers.push('teach');
    if (n.role === 'gatekeeper') offers.push(good ? 'gate' : 'gate-shut');
  } else {
    if (M.stance === 'grateful') lines.push(why(M.owed), '"I owe you for that. The others won\'t hear me say it."');
    else if (M.hunts) lines.push(why(M.wrong), '"You\'ve got some nerve walking in here."');
    else if (M.stance === 'friendly') lines.push(why(M.right), '"We\'re square. Keep it that way."');
    else lines.push('"Keep walking."');
    if (M.hunts && Object.keys((st.owed[aid] || {})[F] || {}).length) offers.push('settle');
  }
  // what they ask: a relic until you have brought it; another person until they are back home (they say it
  // only to people they would talk to at all). Done is never ticked off: it is what they remember.
  if (M.stance !== 'hostile' && !M.hunts) {
    for (const q of asksOf(D, st, n)) {
      if (q.k) { const gave = M.known.some((m) => m.act === 'gift-' + q.k && m.v === n.id); if (!gave) { lines.push(q.line); offers.push('gift-' + q.k); } else if (q.repeat) { lines.push(q.again || q.line); offers.push('gift-' + q.k); } }
      else if (q.about) { const o = st.npcs[q.about]; if (o && o.st !== 'ok' && o.st !== 'returning' && o.st !== 'dead') lines.push(q.line); }
    }
  }
  return { lines: lines.filter(Boolean), offers, stance: M.stance };
}

// ---- the simulation
export function createSim(D, st, { pKPa = 101.325, world = 'local', label = 'home', idGen } = {}) {
  const airK = airOf(pKPa);
  const S = D.senses, TR = D.travel;
  const nid = idGen || (() => `${hash(world).toString(36)}-${Date.now().toString(36)}-${(++st.seq).toString(36)}`);
  const events = []; // things the caller should show/send (ambush, arrivals)

  function goHome(n, t, speed) {
    const p = pos(st, n, t);
    n.mv = { k: 'go', pts: [[r2(p.x), r2(p.z)], n.home], v: speed, t0: t, then: { k: 'stay', x: n.home[0], z: n.home[1], yaw: n.yaw || 0 } };
  }
  function freshAt(aid, x, z, t, r) {
    const tr = st.trails[aid] || []; const lim = S.trailScentMin * 60e3;
    for (let i = tr.length - 1; i >= 0; i--) { const q = tr[i]; if (t - q[2] > lim) break; if (hyp(q[0] - x, q[1] - z) <= r) return q; }
    return null;
  }
  function share(a, b, t) {
    let n = 0;
    for (const m of st.mem[a.id] || []) {
      if (retention(D, m, t) < D.memory.forgetBelow) continue;
      if (remember(st, b, { ...m, by: 'told', from: a.name, t })) n++;
    }
    return n;
  }
  function tickAt(t) {
    const live = Object.values(st.npcs).filter(awake);
    const P = {};
    for (const n of live) {
      const m = n.mv;
      if (m.k === 'go' && m.v * (t - m.t0) / 1000 >= polyLen(m.pts, false)) { n.mv = m.then; if (n.st === 'returning') n.st = 'ok'; }
      if (m.k === 'track') {
        const p = pos(st, n, t), me = st.last[m.aid];
        if (p.end) {
          if (me && t - me.t < 20e3 && hyp(me.x - p.x, me.z - p.z) < 6) ambush(n, m.aid, t);
          else if (!m.endT) m.endT = t;
          else if (t - m.endT > 10 * 60e3) goHome(n, t, TR.walk);
        }
      }
      P[n.id] = pos(st, n, t);
    }
    // contact: people on the same side close enough to talk tell each other everything they know
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.f !== b.f || a.st === 'downed' || b.st === 'downed' || a.st === 'bound' || b.st === 'bound') continue;
      if (hyp(P[a.id].x - P[b.id].x, P[a.id].z - P[b.id].z) > S.talk) continue;
      share(a, b, t); share(b, a, t);
    }
    // a body is found by whoever walks close enough; fresh tracks leading away say who
    for (const b of st.bodies) for (const n of live) {
      if ((b.foundBy || []).includes(n.id) || n.st !== 'ok') continue;
      if (hyp(P[n.id].x - b.x, P[n.id].z - b.z) > S.bodySight) continue;
      (b.foundBy || (b.foundBy = [])).push(n.id);
      let who = null;
      for (const aid of Object.keys(st.trails)) { const q = freshAt(aid, b.x, b.z, t, 4); if (q && Math.abs(q[2] - b.at) < 5 * 60e3) { who = aid; break; } }
      if (who) remember(st, n, { id: b.act, s: who, act: 'kill', v: b.npc, vf: b.f, vn: b.name, vp: b.pr, by: 'found', at: b.at, t, x: b.x, z: b.z });
    }
    // trackers pick up the fresh trail of anyone they have reason to hunt
    for (const n of live) {
      if (n.role !== 'tracker' || n.st !== 'ok' || n.mv.k === 'track' || n.mv.k === 'go') continue;
      for (const aid of Object.keys(st.trails)) {
        if (!mind(D, st, n, aid, t).hunts) continue;
        const q = freshAt(aid, P[n.id].x, P[n.id].z, t, S.trailPick);
        if (q) { n.mv = { k: 'track', aid, from: q[2], x0: r2(P[n.id].x), z0: r2(P[n.id].z), v: TR.track, t0: t }; events.push({ k: 'tracking', npc: n.id, aid, t }); break; }
      }
    }
    // couriers carry what they know off the world when they reach the road
    for (const n of live) {
      if (n.role !== 'courier' || n.st !== 'ok') continue;
      const road = st.props.find((p) => p.k === 'road' && p.f === n.f); if (!road) continue;
      if (hyp(P[n.id].x - road.x, P[n.id].z - road.z) > 2.5) continue;
      for (const m of st.mem[n.id] || []) {
        if (!m.s) continue;
        const key = `${m.id}|${n.f}`; if (st.sent[key]) continue;
        st.sent[key] = t;
        st.out.push({ id: key, f: n.f, s: m.s, act: m.act, v: m.v, vf: m.vf, vn: m.vn, vp: m.vp || null, cf: m.cf || null, by: m.by, at: m.at, dep: t, origin: world, via: n.name });
      }
    }
  }
  function ambush(n, aid, t) {
    const owed = (st.owed[aid] || {})[n.f] || {};
    const seize = Object.keys(owed).length ? { ...owed } : null;
    if (st.owed[aid]) delete st.owed[aid][n.f];
    const id = nid();
    remember(st, n, { id, s: aid, act: 'seized', v: n.id, vf: n.f, vn: n.name, vp: n.pr, by: 'saw', at: t, t, x: st.last[aid].x, z: st.last[aid].z });
    events.push({ k: 'ambush', npc: n.id, name: n.name, aid, seize, rough: !seize, t });
    goHome(n, t, TR.walk);
  }
  function advance(t) {
    if (!st.t) { st.t = t; return; }
    const gap = t - st.t; if (gap <= 0) return;
    const step = gap <= 10 * 60e3 ? 1000 : gap / 600;
    for (let tt = st.t + step; tt < t; tt += step) tickAt(tt);
    tickAt(t); st.t = t;
    if (Math.random() < 0.02) prune(t);
  }
  function prune(t) {
    for (const k of Object.keys(st.mem)) st.mem[k] = st.mem[k].filter((m) => retention(D, m, t) >= D.memory.forgetBelow);
    const lim = 2 * S.trailScentMin * 60e3;
    for (const k of Object.keys(st.trails)) { st.trails[k] = st.trails[k].filter((q) => t - q[2] < lim); if (!st.trails[k].length) delete st.trails[k]; }
    if (st.out.length > 200) st.out.splice(0, st.out.length - 200);
  }
  // a player moved: last known spot and footprints (every trailStep metres)
  function pose(aid, x, z, t, name) {
    st.last[aid] = { x: r2(x), z: r2(z), t };
    if (name) st.names[aid] = name;
    const tr = st.trails[aid] || (st.trails[aid] = []);
    const q = tr[tr.length - 1];
    if (!q || hyp(q[0] - x, q[1] - z) >= S.trailStep) { tr.push([r2(x), r2(z), t]); if (tr.length > 800) tr.splice(0, tr.length - 800); }
  }
  // A player does something. me = where the authority saw them. Returns what happened and who knows.
  function act(aid, kind, target, me, t, name) {
    advance(t);
    const a = D.acts[kind];
    if (!a || a.event) return { ok: false, why: 'no-such-act' };
    if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return { ok: false, why: 'not-here' };
    if (name) st.names[aid] = name;
    let victim = null, give = null, take = null, place = { x: me.x, z: me.z };
    const near = (p) => hyp(p.x - me.x, p.z - me.z) <= a.reach + 0.6;
    if (a.on === 'person') {
      const n = st.npcs[target]; if (!n) return { ok: false, why: 'no-target' };
      if (kind === 'settle') {
        const owed = (st.owed[aid] || {})[n.f]; if (!owed || !Object.keys(owed).length || n.st !== 'ok') return { ok: false, why: 'state' };
        if (!near(pos(st, n, t))) return { ok: false, why: 'too-far' };
        take = { ...owed }; delete st.owed[aid][n.f];
        if (n.mv.k === 'track') goHome(n, t, TR.walk);
      } else {
        if (n.st !== a.needs) return { ok: false, why: 'state' };
        if (!near(pos(st, n, t))) return { ok: false, why: 'too-far' };
        if (kind === 'kill') { n.st = 'dead'; const p = pos(st, n, t); n.mv = { k: 'stay', x: r2(p.x), z: r2(p.z), yaw: 0 }; }
        else { n.st = 'returning'; goHome(n, t, kind === 'help' ? TR.limp : TR.walk); }
      }
      victim = n;
    } else if (a.on === 'pack') {
      const k = st.packs[target]; if (!k) return { ok: false, why: 'no-target' };
      if (kind === 'take') { if (k.st !== 'ground') return { ok: false, why: 'state' }; if (!near(k)) return { ok: false, why: 'too-far' }; k.st = 'carried'; k.by = aid; }
      if (kind === 'keep') { if (k.st !== 'carried' || k.by !== aid) return { ok: false, why: 'state' }; k.st = 'emptied'; give = { ...k.goods }; k.goods = {}; }
      victim = st.npcs[k.owner];
    } else if (a.on === 'owner') {
      const n = st.npcs[target]; if (!n || !awake(n)) return { ok: false, why: 'no-target' };
      const k = Object.values(st.packs).find((p) => p.st === 'carried' && p.by === aid && p.owner === n.id);
      if (!k) return { ok: false, why: 'state' };
      if (!near(pos(st, n, t))) return { ok: false, why: 'too-far' };
      k.st = 'home'; k.by = null; victim = n;
    } else if (a.on === 'gift') {
      // handing over a real object they asked for (the authority has checked it is in your hands and takes it)
      const n = st.npcs[target]; if (!n || !awake(n)) return { ok: false, why: 'no-target' };
      const ask = asksOf(D, st, n).find((q) => q.k === a.needs); if (!ask || (n.st !== 'ok' && n.st !== 'returning')) return { ok: false, why: 'state' };
      if (!near(pos(st, n, t))) return { ok: false, why: 'too-far' };
      // they pay from what their side really has in its cache (it runs out)
      const c = Object.values(st.caches).find((x) => x.f === n.f); give = {};
      for (const [g, want] of Object.entries(ask.pay || {})) { const have = c ? c.goods[g] || 0 : 0, k = Math.min(want, have); if (k > 0) { c.goods[g] = have - k; give[g] = k; } }
      // what you hand over is theirs now (a fish feeds the camp: food in the cache)
      if (c) for (const [g, v] of Object.entries(a.adds || {})) c.goods[g] = (c.goods[g] || 0) + v;
      victim = n;
    } else if (a.on === 'cache') {
      const c = st.caches[target]; if (!c) return { ok: false, why: 'no-target' };
      const goods = Object.entries(c.goods).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
      if (!goods.length) return { ok: false, why: 'empty' };
      if (!near(c)) return { ok: false, why: 'too-far' };
      const [g, have] = goods[0], n = Math.min(2, have);
      c.goods[g] -= n; give = { [g]: n };
      const o = (st.owed[aid] || (st.owed[aid] = {})); const of = o[c.f] || (o[c.f] = {}); of[g] = (of[g] || 0) + n;
      victim = { id: c.id, f: c.f, name: D.factions[c.f].name };
    }
    const id = nid();
    const mem = { id, s: aid, act: kind, v: victim ? victim.id : null, vf: victim ? victim.f : null, vn: victim ? victim.name : null, vp: victim && victim.pr, at: t, t, x: r2(place.x), z: r2(place.z) };
    if (kind === 'free' && victim && victim.held) mem.cf = victim.held;
    const seen = [];
    for (const n of Object.values(st.npcs)) {
      if (!awake(n)) continue;
      let how = n === victim ? 'saw' : perceive(D, st, n, place, a.loud, t, airK);
      if (!how) continue;
      // hearing it from further than a voice carries: they know it happened, not who did it
      const d = hyp(pos(st, n, t).x - place.x, pos(st, n, t).z - place.z);
      const m = how === 'heard' && d > S.voice ? { ...mem, s: null, by: how } : { ...mem, by: how };
      if (remember(st, n, m)) seen.push({ id: n.id, name: n.name, f: n.f, by: how, knows: !!m.s });
    }
    if (kind === 'kill' && victim) st.bodies.push({ npc: victim.id, f: victim.f, name: victim.name, pr: victim.pr, x: r2(pos(st, victim, t).x), z: r2(pos(st, victim, t).z), at: t, act: id, foundBy: [] });
    return { ok: true, id, act: kind, target, seen, give, take };
  }
  // news that arrived from another world (by courier ship): the courier here carries it into camp
  function receive(list, t) {
    let n = 0;
    for (const x of list) {
      if (st.seen[x.id]) continue; st.seen[x.id] = t;
      const who = Object.values(st.npcs).find((p) => p.f === x.f && p.role === 'courier' && awake(p)) || Object.values(st.npcs).find((p) => p.f === x.f && awake(p) && p.st === 'ok');
      if (!who) continue;
      const id = x.id.split('|')[0];
      if (remember(st, who, { id, s: x.s, act: x.act, v: x.v, vf: x.vf, vn: x.vn, vp: x.vp || null, cf: x.cf || null, by: 'told', from: `a courier from ${x.originName || 'another world'}`, at: x.at, t })) n++;
    }
    return n;
  }
  function drainOut() { return st.out.splice(0); }
  function drainEvents() { return events.splice(0); }
  // what one player's client gets to draw: everyone's movement (deterministic), state, and how they look at YOU
  function view(aid, t) {
    return {
      v: FA_V, kind: st.kind, t, anchor: st.anchor, props: st.props, occ: st.occ,
      npcs: Object.values(st.npcs).map((n) => ({ id: n.id, name: n.name, f: n.f, role: n.role, pr: n.pr, st: n.st, mv: n.mv, home: n.home, stance: awake(n) ? mind(D, st, n, aid, t).stance : 'gone',
        // a tracker on a trail walks your real footprints: the client needs them to place him
        ...(n.mv.k === 'track' ? { trail: (st.trails[n.mv.aid] || []).filter((q) => q[2] >= n.mv.from).slice(-300), you: n.mv.aid === aid } : {}) })),
      caches: Object.values(st.caches).map((c) => ({ id: c.id, f: c.f, x: c.x, z: c.z, n: Object.values(c.goods).reduce((s, v) => s + v, 0) })),
      packs: Object.values(st.packs).map((k) => ({ id: k.id, owner: k.owner, x: k.x, z: k.z, st: k.st, mine: k.by === aid })),
      bodies: st.bodies.map((b) => ({ npc: b.npc, x: b.x, z: b.z })),
      owed: st.owed[aid] || {},
      // your own trail (for reading tracks) is drawn locally; a tracker following you is visible in its mv
    };
  }
  return { st, advance, pose, act, receive, view, drainOut, drainEvents, talk: (id, aid, t, known) => { advance(t); const n = st.npcs[id]; return n ? talk(D, st, n, aid, t, known) : null; }, mind: (id, aid, t) => mind(D, st, st.npcs[id], aid, t), pos: (n, t) => pos(st, n, t) };
}

// how long news takes between worlds, by courier ship (physical speed), or a void jump between systems
export function transitMs(D, from, to, scale = 1) {
  if (from === to) return 0;
  const [ka, oa] = String(from).split(':'), [kb, ob] = String(to).split(':');
  const T = D.travel;
  let ms;
  if ((ka === 'home' || ka === 'moon') && (kb === 'home' || kb === 'moon') && oa === ob) ms = (T.earthMoonKm / T.shipKmS) * 1000; // Earth <-> its Moon
  else ms = T.jumpHours * 3600e3;
  return ms / Math.max(1, scale);
}
export function worldName(key) {
  const k = String(key || '').split(':')[0];
  return k === 'home' ? 'Xenia' : k === 'moon' ? 'a moon' : k === 'planet' ? 'a far planet' : 'another world';
}
