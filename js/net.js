// Multiplayer client. Always started. Talks to the Xenia server
// (Cloudflare Worker + one Durable Object per world):
//   sign in with an emailed 6-digit code (Turnstile on the request), keep a session token,
//   get a one-minute signed ticket for the world she's in, open a WebSocket to that world.
// Shows other players as simple avatars with names, presence count, chat, friends (add by Name#1234,
// join a friend), invites (code + link) and block / report.
// Netcode: the server is authoritative. Her own player is predicted locally (moves at once); every move is
// numbered, the server acks the newest it accepted and answers a refused one with a correction, which we
// reconcile (ease back if small, snap if big) and confirm. Other players are interpolated ~100–350 ms behind
// on the sender's own clock (adaptive to jitter), with a short extrapolation if packets are late.
// If the connection drops after you were online, the world holds still briefly, then you keep playing
// solo while we retry in the background and resume at the last accepted spot. If the server URL is
// unset or never comes up, the game plays offline solo (never sits on Reconnecting).
import * as THREE from 'three';
import { makeFrame, transfer } from './universe/sphere.js';
import { SHARED_HOME, SHARED_MOON } from './spawn.js';
import { enterHub } from './hub.js';
import { moveDelta, mergeMove, KEY_MS } from './net-delta.js';
import { bodyShape } from './solids.js';
import { PROTOCOL } from './protocol.js';
import { flushProgress, noteMoment } from './safe-restart.js';
import { bindDevNet, devOn, setDevAllowed, devHit } from './game/dev-mode.js';
import { bindWorldRifle } from './game/m4.js';
import { rifleOut } from './game/rifle-state.js';

const LS = 'zen-mp';
// One place to set the live Worker URL. ThinkCore hosts it at play.thinkcore.io.
export const MP_SERVER = 'https://play.thinkcore.io';
const EYE = 1.6;
const SEND_HZ = 10, BUF_MIN = 100, BUF_MAX = 300, EXTRAP_MS = 150;
const ALONE_HZ = 2;
const PING_MS = 4000, DEAD_MS = 9000, HOLD_AFTER_MS = 2500;

export async function startNet({ worlds, params, engine = {} }) {
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const SERVER = (params.get('mpserver') || (local ? 'http://127.0.0.1:8787' : MP_SERVER) || '').replace(/\/$/, '');
  let homeSeeds = null;
  import('./universe/home.js').then((m) => {
    try { homeSeeds = { earth: m.homeBody('earth').body.seed, moon: m.homeBody('moon').body.seed }; } catch (e) { /* */ }
  }).catch(() => {});
  let applying = false; // true while we apply a server edit, so we don't echo it back
  let sess = load();
  let host = null;            // unused since the one shared world (kept for the state readout)
  let nearNext = null;        // {id, world}: on the next ticket, ask to spawn next to this player
  let ws = null, wsKey = null, want = null, peersN = 1, closedWhy = '';
  // connection state: 'idle' (no shared world) | 'connecting' | 'open' | 'reconnecting' | 'stopped'
  let conn = 'idle', tries = 0, retryT = null, connectStart = 0, lastRx = 0, rtt = 0, everOpen = new Set(), stopKey = null;
  let deploying = 0; // Date.now() until when a server 'upd' / 1012 close should auto-resume without a Reconnect click
  const trace = []; const tr = (...a) => { trace.push(Math.round(performance.now()) + ' ' + a.join(' ')); if (trace.length > 80) trace.shift(); };
  let snapKey = null, snapAskT = 0; // which world+tile we last asked the server's builds/digs for
  let seq = 0, fixAck = 0; const sentAt = new Map(); let ease = null;
  const peers = new Map();    // id -> { name, tag, group, label, samples: [{t,x,y,z,yaw}] }
  const blocked = new Set();
  const ui = buildUi();

  function load() { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } }
  function store() { try { sess ? localStorage.setItem(LS, JSON.stringify(sess)) : localStorage.removeItem(LS); } catch { /* */ } }
  async function api(path, body) {
    const r = await fetch(SERVER + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(sess?.token ? { authorization: 'Bearer ' + sess.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/auth/verify') { sess = null; store(); ui.render(); }
    return { status: r.status, ...j };
  }

  // ---- which shared world she's in, from the local world manager
  function worldKey() {
    const id = worlds.currentId, w = worlds.current;
    if (!sess) return null;
    // one always-on shared world for everyone (regional and skill-based servers come later)
    if (id === 'earth') return SHARED_HOME;
    if (id === 'moon') return SHARED_MOON;
    if (id === 'planet') {
      const q = w.where && w.where();
      if (!q || q.flight) return null; // ship / cruise is still solo
      if (homeSeeds && q.seed === homeSeeds.earth && (q.dim || 'prime') === 'prime') return SHARED_HOME;
      if (homeSeeds && q.seed === homeSeeds.moon && (q.dim || 'prime') === 'prime') return SHARED_MOON;
      return q.seed != null ? `planet:${q.dim || 'prime'}:${q.seed >>> 0}` : null;
    }
    return null; // space flight is solo
  }
  function currentAb() {
    const w = worlds.current;
    const p = w?.debug?.player || w?.debug?.core?.player || w?.debug?.game?.player;
    const ab = p?.abilities || {};
    return (ab.climb ? 1 : 0) | (ab.doubleJump ? 2 : 0);
  }
  function pose() {
    const w = worlds.current; const q = w && w.where && w.where();
    if (!q || !w.camera || q.flight || q.x == null) return null;
    const tile = q.tile || w.debug?.W?.tile || null;
    let y = w.camera.position.y - EYE;
    const pl = AV && AV.player; // her walker's feet; third person lifts the camera off the eye
    if (pl && pl.position && Math.abs(pl.position.y - y) < 4) y = pl.position.y;
    const out = { x: q.x, y: +y.toFixed(2), z: q.z, yaw: q.yaw, ab: currentAb() };
    if (tile) out.tile = tile;
    return out;
  }

  // ---- connection (auto-reconnect with backoff + session resume)
  async function connect(key, { resume = false } = {}) {
    clearTimeout(retryT); retryT = null;
    if (key !== want) { tries = 0; stopKey = null; }
    want = key;
    if (ws) { const old = ws; ws = null; try { old.close(1000, 'moving'); } catch { /* */ } }
    clearPeers(); wsKey = null; peersN = 1; window.__factions?.offline();
    if (!key || !SERVER) { conn = SERVER ? 'idle' : 'solo'; hold(false); ui.render(); return; }
    if (stopKey === key) return;
    tr('connect', key, 'resume=' + resume, 'tries=' + tries);
    conn = tries ? 'reconnecting' : 'connecting'; connectStart = performance.now(); ui.status();
    let t;
    const nearId = !resume && nearNext && nearNext.world === key ? nearNext.id : null; nearNext = null; // spawn next to the inviter
    try { t = await api('/ticket', { world: key, resume, ...(nearId ? { near: nearId } : {}), ...(devOn() ? { dev: true } : {}) }); } catch { t = { error: 'network' }; }
    if (want !== key) return;
    if (!t.ticket) {
      if (t.status === 403 || t.status === 400) { // not allowed there (garden closed / blocked): go home calmly
        closedWhy = "Can't join the server right now."; ui.chatLine(null, closedWhy);
        if (host) { host = null; want = null; return connect(worldKey()); }
        conn = 'stopped'; stopKey = key; hold(false); ui.render(); return;
      }
      if (t.status === 401) { conn = 'idle'; hold(false); ui.render(); return; } // signed out
      return retry(key);
    }
    const s = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws?ticket=' + encodeURIComponent(t.ticket) + '&b=1'); // b=1: batched poses with interest management (older servers ignore it)
    ws = s; wsKey = key; lastRx = performance.now();
    s.onopen = () => { lastRx = performance.now(); tr('open'); };
    s.onmessage = (e) => {
      lastRx = performance.now();
      if (e.data === 'pong') { if (pingSent) { rtt = rtt ? rtt * 0.7 + (lastRx - pingSent) * 0.3 : lastRx - pingSent; pingSent = 0; } return; }
      let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m);
    };
    s.onclose = (e) => {
      tr('close', e.code, e.reason, ws === s ? 'current' : 'old');
      if (ws !== s) return; // a socket we replaced on purpose
      ws = null; clearPeers(); window.__factions?.offline();
      if ([4001, 4003, 4004].includes(e.code) && Date.now() > deploying) {
        // signed in elsewhere / failed checks / removed: don't loop; offer one calm button
        closedWhy = e.code === 4001 ? 'You joined from another device.' : (e.reason || 'Disconnected.');
        conn = 'stopped'; stopKey = key; hold(true, closedWhy, true); ui.render(); return;
      }
      if (e.code === 1012 || Date.now() < deploying) deploying = Date.now() + 30000;
      if (want === key) retry(key);
    };
  }
  function retry(key) {
    tr('retry', key, tries);
    conn = 'reconnecting'; tries++;
    if (everOpen.has(key) || performance.now() - connectStart > HOLD_AFTER_MS) hold(true);
    // 0.5 s, 1, 2, 4, 8, then every 10 s, with jitter so a server restart isn't hit by everyone at once.
    // A deploy close (1012 / 'upd') retries sooner the first time so you land back in quickly.
    const first = Date.now() < deploying && tries <= 2 ? 400 : 500 * 2 ** Math.min(tries - 1, 5);
    const d = Math.min(10000, first) * (0.75 + Math.random() * 0.5);
    clearTimeout(retryT);
    retryT = setTimeout(() => { if (want === key && !ws) connect(key, { resume: everOpen.has(key) }); }, d);
    ui.status();
  }
  // retry right away when the network comes back or the tab returns
  addEventListener('online', () => { if (conn === 'reconnecting' && want) connect(want, { resume: everOpen.has(want) }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn === 'reconnecting' && want && !ws) connect(want, { resume: everOpen.has(want) }); });
  function hold(on, text, button) {
    engine.hold = !!on;
    const auto = Date.now() < deploying;
    ui.overlay(on, text || (auto ? 'The server is updating. You will be back in a moment.' : (tries > 3 ? 'Reconnecting… your world is safe, just waiting for the connection.' : 'Reconnecting…')), auto ? false : button);
  }
  function opened(m) {
    const key = wsKey;
    conn = 'open'; tries = 0; closedWhy = ''; everOpen.add(key); snapKey = null;
    // resume: the server put her back at the last spot it accepted; match it if we drifted
    if (m.resume) {
      const w = worlds.current, q = w.where && w.where();
      if (worlds.currentId === 'earth' || (m.resume.tile && worlds.currentId !== 'planet')) {
        enterHub(worlds, m.resume).catch((e) => console.warn('[hub] hello', e));
      } else if (w && w.restoreWhere) {
        const d = q && q.tile && m.resume.tile && q.tile === m.resume.tile ? Math.hypot(q.x - m.resume.x, q.z - m.resume.z) : 99;
        if (!q || d > 0.5 || (m.resume.tile && m.resume.tile !== q.tile)) w.restoreWhere({ ...(q || {}), ...m.resume });
      }
    }
    lastSent = null; fixAck = 0; sentAt.clear();
    hold(false); ui.render();
  }

  function onMsg(m) {
    switch (m.t) {
      case 'hi':
        if (m.games) startGames();
        if (m.fa && window.__factions) window.__factions.online((o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); });
        tr('hi', m.n, JSON.stringify(m.resume), 'proto=' + (m.proto || ''));
        if (typeof m.proto === 'number' && m.proto > PROTOCOL) {
          ui.chatLine(null, 'A new version of the game is needed to stay on the server.');
          try { window.__zmApplyUpdate && window.__zmApplyUpdate('protocol'); } catch { /* */ }
        }
        peersN = m.n; for (const p of m.others) addPeer(p); for (const p of m.peers) sample(p); opened(m); break;
      case 'upd':
        deploying = Date.now() + 30000;
        flushProgress();
        hold(true, 'The server is updating. You will be back in a moment.', false);
        break;
      case 'a': { const t0 = sentAt.get(m.s); if (t0) { const r = performance.now() - t0; rtt = rtt ? rtt * 0.8 + r * 0.2 : r; } for (const k of sentAt.keys()) if (k <= m.s) sentAt.delete(k); break; }
      case 'n': peersN = m.n; ui.status(); break;
      case 'join': addPeer(m); ui.chatLine(null, `${m.name} arrived`); break;
      case 'leave': { const p = peers.get(m.id); if (p) { ui.chatLine(null, `${p.name} left`); dropPeer(m.id); } break; }
      case 'p': sample(m); break;
      case 'P': if (Array.isArray(m.ps)) for (const q of m.ps) if (q && typeof q.id === 'string') sample(q); break;
      case 'lk': lookOf(m.id, m.lk); break;
      case 'c': if (!blocked.has(m.id)) ui.chatLine(m, m.text); break;
      case 'sys': ui.chatLine(null, m.text); break;
      case 'fix': { // reconciliation: the server refused a move, so return to the spot it holds
        if (m.id <= fixAck) break;
        fixAck = m.id; lastSent = null; sentAt.clear();
        const w = worlds.current, q = w.where && w.where();
        if (q && w.restoreWhere && m.x != null) {
          const d = Math.hypot(q.x - m.x, q.z - m.z);
          if (d < 1.5 && (!m.tile || m.tile === q.tile)) ease = { x: m.x, z: m.z, tile: m.tile, k: 0 };
          else w.restoreWhere({ ...q, x: m.x, z: m.z, tile: m.tile || q.tile });
        }
        break;
      }
      case 'e': applyEdit(m); break;
      case 'fa': if (window.__factions) window.__factions.onMsg(m); break;
      case 'g': if (games) games.onMsg(m); else gq.push(m); break;
      case 'f': break;
      case 'hit':
        if (m.by === sess?.account?.id) devHit(m);
        if (m.id === sess?.account?.id) { ui.chatLine(null, 'That hit you.'); noteMoment({ fightUntil: Date.now() + 8000 }); }
        break;
      case 'kill':
        if (m.id === sess?.account?.id) ui.chatLine(null, 'You were downed.');
        else if (m.by === sess?.account?.id) ui.chatLine(null, 'Downed.');
        break;
      case 'respawn': {
        const w = worlds.current, q = w && w.where && w.where();
        const pose = { ...(q || {}), x: m.x, y: m.y, z: m.z, tile: m.tile, yaw: m.yaw };
        if (w && w.restoreWhere) w.restoreWhere(pose);
        const pl = w?.debug?.player || w?.debug?.game?.player;
        if (pl && pl.teleport) { pl.teleport(m.x, m.z, m.yaw || 0); pl.snapCamera && pl.snapCamera(); }
        ui.chatLine(null, 'Back at spawn.');
        break;
      }
      case 'blocked': blocked.add(m.id); dropPeer(m.id); break;
      case 'unblocked': blocked.delete(m.id); break;
    }
  }


  // compete / co-op / vault (js/compete.js): loaded only when the server says it has games
  let games = null, gamesLoading = false; const gq = [];
  function startGames() {
    if (games || gamesLoading) return; gamesLoading = true;
    import('./compete.js').then((mod) => {
      games = mod.startCompete({
        worlds, chatLine: (w, t) => ui.chatLine(w, t), toLocal,
        me: () => sess?.account,
        send: (o) => { if (ws && ws.readyState === 1 && conn === 'open') ws.send(JSON.stringify({ t: 'g', ...o })); },
        peerList: () => [...peers.values()].map((p) => ({ id: p.id, name: p.name, at: p.group.visible ? p.group.position.toArray() : null })),
      });
      for (const m of gq.splice(0)) games.onMsg(m);
    }).catch((e) => { gamesLoading = false; console.warn('[net] games', e); });
  }
  function toLocal(m) {
    const w = worlds.current;
    const q = w && w.where && w.where();
    const mine = (q && q.tile) || w?.debug?.W?.tile || null;
    if (!m.tile || !mine || m.tile === mine) return m;
    const R = w?.debug?.W?.radius; if (!R) return null;
    try {
      const trn = transfer(makeFrame(R, m.tile), makeFrame(R, mine), m.x, m.z, m.yaw);
      return { x: trn.x, y: m.y, z: trn.z, yaw: trn.yaw };
    } catch (e) { return null; }
  }
  function tools() {
    const w = worlds.current;
    const sb = w?.debug?.sb;
    const dig = w?.dig || w?.debug?.game?.dig;
    return { w, vox: sb?.vox || dig?.vox, build: sb?.build, tile: (w?.where && w.where())?.tile || w?.debug?.W?.tile || '' };
  }
  function applyEdit(m) {
    const { vox, build, tile } = tools();
    applying = true;
    try {
      if (m.k === 'vox' && m.diffs && vox) vox.load(m.diffs);
      if (m.k === 'no') { // the server didn't take an edit: it stays on this screen, nothing else happens
        tr('edit-no', m.what, m.why);
      }
      if (m.k === 'snap') {
        const packs = m.vox || {};
        for (const [tl, diffs] of Object.entries(packs)) {
          if (vox && diffs && (!tl || tl === (tile || '') || tl === 'undefined')) vox.load(diffs);
        }
        if (m.builds && build) for (const b of m.builds) {
          if ((b.tile || '') !== (tile || '')) continue; // only this world's pieces (a planet's never land in the garden)
          if (b.id && !build.pieces.has(b.id) && b.piece) {
            const [typ, mat, x, y, z, yaw] = b.piece;
            build.place(typ, mat, new THREE.Vector3(x, y, z), yaw, { id: b.id, quiet: true });
          }
        }
      }
      if (m.k === 'build' && build) {
        if (m.op === 'remove') {
          const pce = build.pieces.get(m.id);
          if (pce) build.removePiece(pce);
        } else if (m.op === 'place' && m.piece) {
          const [typ, mat, x, y, z, yaw] = m.piece;
          if (m.lid && m.lid !== m.id && build.pieces.has(m.lid) && !build.pieces.has(m.id)) {
            const old = build.pieces.get(m.lid); old.id = m.id; build.pieces.delete(m.lid); build.pieces.set(m.id, old);
          } else if (m.id && !build.pieces.has(m.id)) {
            build.place(typ, mat, new THREE.Vector3(x, y, z), yaw, { id: m.id, quiet: true });
          }
        }
      }
    } catch (e) { console.warn('[net] apply edit', e); }
    applying = false;
  }
  // where she is right now, sent before an edit so the server judges reach from her real spot (not a stale one)
  function poseNow() {
    if (!ws || ws.readyState !== 1 || conn !== 'open' || ease || engine.hold) return;
    const q = pose(); if (!q) return;
    if (lastSent && Math.hypot(q.x - lastSent.x, q.z - lastSent.z) < 0.02 && Math.abs(q.y - lastSent.y) < 0.03 && (q.tile || '') === (lastSent.tile || '')) return;
    seq++; const m = { t: 'p', ...q, s: seq, ct: Math.round(performance.now()) }; if (fixAck) m.r = fixAck;
    ws.send(JSON.stringify(m)); lastSent = q; sentAt.set(seq, performance.now());
  }
  const EDIT_SPLIT = 12000, CHUNK_MAX = 8000; // the server takes up to 24 chunks of <= 8000 chars in one message
  addEventListener('zen-edit', (e) => {
    if (applying || !ws || ws.readyState !== 1 || conn !== 'open') return;
    const d = e.detail || {};
    const tile = tools().tile || '';
    try {
      poseNow();
      if (d.k === 'vox' && d.diffs) { // a big dig touches many chunks: send them in parts, never one oversized message
        let part = {}, size = 0, n = 0;
        const flush = () => { if (n) ws.send(JSON.stringify({ t: 'e', k: 'vox', tile, diffs: part })); part = {}; size = 0; n = 0; };
        for (const [ck, data] of Object.entries(d.diffs)) {
          if (typeof data !== 'string' || data.length > CHUNK_MAX) continue; // too detailed to share; stays on this screen
          if (n && (size + data.length > EDIT_SPLIT || n >= 24)) flush();
          part[ck] = data; size += data.length + ck.length + 6; n++;
        }
        flush();
      }
      if (d.k === 'build') ws.send(JSON.stringify({ t: 'e', k: 'build', tile, op: d.op, id: d.id, lid: d.id, piece: d.piece }));
    } catch (err) { /* */ }
  });

  // ---- avatars
  const COLORS = [0x8fb996, 0xd8a47f, 0x9db4c0, 0xc9b6e4, 0xe6c86e, 0xa3c4bc, 0xe0a1a1, 0x7fa7d8];
  const hue = (id) => COLORS[parseInt(id.slice(0, 6), 16) % COLORS.length];
  function avatar(name, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.85, 6, 14), mat); body.position.y = 0.72; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf1e4d3, roughness: 0.6 })); head.position.y = 1.5; g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.05), new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.3 })); visor.position.set(0, 1.53, -0.17); g.add(visor);
    for (const m of [body, head, visor]) { m.castShadow = true; }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d'); x.font = '600 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = Math.min(244, x.measureText(name).width + 28);
    x.fillStyle = 'rgba(20,26,34,0.55)'; x.beginPath(); x.roundRect((256 - tw) / 2, 8, tw, 48, 24); x.fill();
    x.fillStyle = '#f6f1e7'; x.fillText(name, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    label.scale.set(1.0, 0.25, 1); label.position.y = 1.95; label.renderOrder = 10; g.add(label);
    g.userData.dispose = () => { g.traverse((o) => { o.geometry && o.geometry.dispose(); o.material && (o.material.map && o.material.map.dispose(), o.material.dispose()); }); };
    return g;
  }
  // ---- other players as real characters: the same rig, look, locomotion (walk/run/swim/climb/glide...), lean and
  // foot IK as hers (js/game/avatar), driven by the move state each pose carries (m) and the look code (lk).
  // The capsule stays only until the character module and rig are ready, or for an older client that sends no state.
  let AV = null, avLoading = false, lookTools = null;
  function needAV() {
    if (AV || avLoading) return; avLoading = true;
    Promise.all([import('./game/avatar/index.js'), import('./game/avatar/appearance.js')])
      .then(([a, b]) => { AV = a.avatarApi; lookTools = b; }).catch((e) => { console.warn('[net] avatar', e); });
  }
  needAV();
  const groundAt = (x, z) => (AV && AV.ground ? AV.ground(x, z) : 0);
  function lookOf(id, lk) {
    const p = peers.get(id); if (!p || typeof lk !== 'string' || lk === p.lk) return;
    p.lk = lk; if (p.av) p.av.setLook(lk);
  }
  function bodyFor(p) {
    if (p.av || !AV || !AV.scene || !lookTools) return p.av;
    const seed = (parseInt(p.id.slice(0, 8), 16) % 100000) / 100000 + 1e-6;
    const look = p.lk || lookTools.randomLook(seed); // her real look replaces this as soon as it arrives
    p.av = AV.createRemote(look, { scene: worlds.current?.scene, ground: groundAt, P: AV.P });
    p.av.setVisible(false); p.avScene = worlds.current?.scene;
    p.av.ready.then(() => { if (p.av) p.avReady = true; }).catch(() => {});
    return p.av;
  }
  function addPeer(p) {
    if (peers.has(p.id) || p.id === sess?.account.id || blocked.has(p.id)) return;
    const group = avatar(p.name, hue(p.id)); group.visible = false;
    worlds.current?.scene?.add(group);
    peers.set(p.id, { id: p.id, name: p.name, tag: p.tag, group, scene: worlds.current?.scene, samples: [] });
    if (typeof p.lk === 'string') lookOf(p.id, p.lk);
    ui.status();
  }
  // Samples are placed on the SENDER's clock when the pose carries one (ct): Wi-Fi/phone links deliver packets in
  // clumps (a lost TCP segment holds everything behind it), and spacing them by arrival made her friend speed up
  // and stall. offset = recent minimum of (arrival - ct) (clock difference + fastest trip), slewed so nobody jumps;
  // the delay covers one send interval plus the measured lateness. Older servers/clients without ct: arrival time.
  function sample(m) {
    const p = peers.get(m.id); if (!p) return;
    const now = performance.now(), hasCt = typeof m.ct === 'number' && Number.isFinite(m.ct);
    let last = p.samples[p.samples.length - 1];
    if (hasCt !== !!p.ct || (hasCt && last && m.ct < last.t - 2000)) { p.samples = []; p.offs = []; p.off = null; p.gap = 0; p.jit = 0; last = null; } // mode change or the sender restarted
    p.ct = hasCt;
    let t = now;
    if (hasCt) {
      if (last && m.ct <= last.t) return; // duplicate / out of order
      t = m.ct; const o = now - m.ct;
      p.offs.push(now, o); while (p.offs.length > 2 && p.offs[0] < now - 5000) p.offs.splice(0, 2);
      let mn = Infinity; for (let i = 1; i < p.offs.length; i += 2) if (p.offs[i] < mn) mn = p.offs[i];
      p.off = p.off == null ? mn : p.off + (mn - p.off) * 0.05;
      if (last) { const gap = t - last.t; if (gap < 1000) p.gap = p.gap ? p.gap * 0.9 + gap * 0.1 : gap; } // a pause in walking isn't a slow link
      p.jit = (p.jit || 0) * 0.95 + Math.max(0, o - mn) * 0.05;
    } else if (last) { const gap = t - last.t; p.gap = p.gap ? p.gap * 0.9 + gap * 0.1 : gap; p.jit = (p.jit || 0) * 0.9 + Math.abs(gap - p.gap) * 0.1; }
    const loc = toLocal(m); if (!loc) return;
    if (typeof m.lk === 'string') lookOf(m.id, m.lk);
    // move state arrives as parts (only what changed); the peer's full state is the merge of them
    if (m.m && typeof m.m === 'object') p.mv = mergeMove(p.mv, m.m);
    const mv = p.mv || null;
    // body yaw in the avatar's convention; a tile hand-over turns it by the same amount as the pose yaw (opposite sign)
    const by = mv && Number.isFinite(mv.by) ? mv.by - (loc.yaw - m.yaw) : null;
    p.samples.push({ t, x: loc.x, y: loc.y, z: loc.z, yaw: loc.yaw, tile: m.tile || null, mv, by });
    if (p.samples.length > 30) p.samples.splice(0, p.samples.length - 30);
  }
  function dropPeer(id) { const p = peers.get(id); if (!p) return; p.scene?.remove(p.group); p.group.userData.dispose(); if (p.av) { p.av.dispose(); p.av = null; } peers.delete(id); ui.status(); }
  function clearPeers() { for (const id of [...peers.keys()]) dropPeer(id); }
  const lerpAng = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
  function drawPeers() {
    const now = performance.now();
    for (const p of peers.values()) {
      const s = p.samples; if (!s.length) continue;
      // buffer = one update interval + 2x jitter, 100..300 ms: smooth on wobbly Wi-Fi, still close to live
      const buf = p.ct ? Math.min(BUF_MAX + 50, Math.max(BUF_MIN, (p.gap || 100) + 2.5 * (p.jit || 0)))
        : Math.min(BUF_MAX, Math.max(BUF_MIN, (p.gap || 100) + 2 * (p.jit || 0)));
      const t = (p.ct ? now - p.off : now) - buf;
      if (p.scene !== worlds.current?.scene) { p.scene?.remove(p.group); worlds.current?.scene?.add(p.group); p.scene = worlds.current?.scene; }
      let a = s[0], b = s[s.length - 1];
      for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= t) { a = s[i - 1]; b = s[i]; break; }
      // late packets: keep gliding along the last direction for up to 150 ms, then wait (no rubber band)
      const k = b.t > a.t ? Math.min(1 + EXTRAP_MS / Math.max(50, b.t - a.t), Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      p.group.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      p.group.rotation.y = -lerpAng(a.yaw, b.yaw, k);
      // in the sea: the same waves here as on her screen, so how deep she is tells us she is swimming
      const lq = worlds.current && worlds.current.liquidAt ? worlds.current.liquidAt(p.group.position.x, p.group.position.z) : null;
      const dep = lq ? lq.surf - p.group.position.y : 0, sp = Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.05, (b.t - a.t) / 1000);
      p.rawX = p.group.position.x; p.rawY = p.group.position.y; p.rawZ = p.group.position.z; p.swim = dep > 1.1; p.tilt = (p.tilt || 0) + ((p.swim ? (sp > 0.3 || dep > 1.9 ? -1.35 : -0.25) : 0) - (p.tilt || 0)) * 0.15;
      p.group.rotation.order = 'YXZ'; p.group.rotation.x = p.tilt;
      if (Math.abs(p.tilt) > 1e-3) { const c = 1.3, yw = p.group.rotation.y; const fz = Math.sin(p.tilt) * c, fy = Math.cos(p.tilt) * c; p.group.position.x -= Math.sin(yw) * fz; p.group.position.z -= Math.cos(yw) * fz; p.group.position.y += c - fy; }
      p.group.visible = true;
      // the character: placed exactly where the interpolation puts her, animated from her relayed state
      const av = (b.mv || p.av) ? bodyFor(p) : null;
      if (av && p.avReady) {
        if (p.avScene !== worlds.current?.scene) { worlds.current?.scene?.add(av.group); p.avScene = worlds.current?.scene; }
        const mv = b.mv || {}, dtv = Math.max(0.05, (b.t - a.t) / 1000);
        const by = a.by != null && b.by != null ? lerpAng(a.by, b.by, Math.min(1, k)) : -lerpAng(a.yaw, b.yaw, k);
        const swimming = typeof mv.st === 'string' ? mv.st.startsWith('swim') : p.swim;
        // speed from the motion we actually draw, so the feet keep pace with the ground (no skating)
        p.avSp = (p.avSp || 0) + (Math.min(20, sp) - (p.avSp || 0)) * 0.25;
        av.applyNet({ x: p.rawX, y: p.rawY, z: p.rawZ, yaw: by, sp: p.avSp, g: mv.g !== false, vy: Number.isFinite(mv.vy) ? mv.vy : (b.y - a.y) / dtv,
          st: swimming ? (p.avSp > 0.3 ? 'swim' : 'swim_idle') : (mv.st || 'idle'), a: Array.isArray(mv.a) ? mv.a : [], ay: Number.isFinite(mv.ay) ? mv.ay : by, ap: Number.isFinite(mv.ap) ? mv.ap : 0,
          tl: Number.isFinite(mv.tl) ? mv.tl : (swimming && p.avSp > 0.3 ? 1.2 : 0), direct: true });
        av.update(Math.min(0.1, (now - (p.avT || now)) / 1000)); p.avT = now;
        bindWorldRifle(av, !!mv.gn);
        if (worlds.current?.camera) av.lodFor(worlds.current.camera); else av.setVisible(true);
        // the capsule body hides; the name label stays over her head
        if (!p.capHidden) { p.group.children.forEach((c) => { if (!c.isSprite) c.visible = false; }); p.capHidden = true; }
        p.group.rotation.x = 0; p.group.position.set(p.rawX, p.rawY, p.rawZ); // the character tilts itself
      }
    }
  }
  // the world's sea throws splashes and wakes for other swimmers too (water/ocean.js reads this)
  if (typeof window !== 'undefined') window.__zmPeerSwimmers = () => [...peers.values()].filter((p) => p.group.visible).map((p) => ({ id: p.id, x: p.group.position.x, y: p.rawY ?? p.group.position.y, z: p.group.position.z, yaw: -p.group.rotation.y, swimming: !!p.swim, headUnder: false, impact: 2 }));

  // ---- connection supervision on a timer (not the frame loop: a slow or held frame loop must not stall it)
  let lastSent = null, sendAcc = 0, hbT = 0, pingSent = 0, lastPing = 0, lastT = performance.now();
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    // the page itself was frozen (a long hitch, a starved tab): messages are queued, the link isn't dead
    if (now - lastTick > 1500) lastRx = now;
    lastTick = now;
    // resume only a world this page already had open (a server update, a dropped link). A fresh launch restores
    // her own saved spot; resuming the server's last spot there (a planet, while the app starts in the garden)
    // put garden poses at planet coordinates and each read as a teleport (0.2.22 live: 399 m and 803 m flags)
    if (SERVER) { const k = worldKey(); if (k !== want) connect(k, { resume: everOpen.has(k) }); }
    // already-online drop: hold briefly. A first connection that never comes up stays playable.
    if (conn === 'connecting' && !engine.hold && everOpen.has(want) && now - connectStart > HOLD_AFTER_MS) hold(true);
    if (!ws || ws.readyState !== 1) return;
    if (now - lastPing > PING_MS) { lastPing = now; if (!pingSent) pingSent = now; ws.send('ping'); } // answered without waking the server
    if (now - hbT > 50e3) { hbT = now; ws.send('{"t":"hb"}'); }                                         // keeps her "online" for friends
    if (now - lastRx > DEAD_MS) { // half-open link (Wi-Fi dropped without a close): treat as lost
      tr('dead', Math.round(now - lastRx)); const s0 = ws; ws = null; clearPeers();
      try { s0.close(4000, 'dead'); } catch { /* */ }
      retry(want);
    }
    ui.net(conn, rtt);
  }, 250);
  // a hidden tab's timers are throttled; don't call the link dead for that
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lastRx = performance.now(); });

  // her move state for the others' copy of her character: animation state, overlay actions, speed, body/aim yaw
  let lastMvKey = '', lastLk = null, lastLkT = 0, sentMv = null, sentMvT = 0, sentMvWs = null; // what the others hold of her move state
  function moveState() {
    const av = AV && AV.avatar, pl = AV && AV.player;
    if (!av || !pl) return null;
    const n = av.snapshot(pl);
    const w = (v) => +Math.atan2(Math.sin(v || 0), Math.cos(v || 0)).toFixed(3); // body/aim yaw can wind past ±π
    return { sp: +(+n.sp || 0).toFixed(2), g: !!n.g, vy: +(+n.vy || 0).toFixed(2), st: n.st, a: n.a, by: w(n.yaw), ay: w(n.ay), ap: +(+n.ap || 0).toFixed(3), tl: +(+n.tl || 0).toFixed(2), gn: rifleOut() ? 1 : 0 };
  }
  function myLook() { try { return AV && AV.appearance ? AV.appearance.encode() : null; } catch { return null; } }
  // ---- frame loop: send her predicted pose (10 Hz while moving and someone else is here), draw the others
  function tick() {
    const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
    if (ease) { // small reconciliation: ease her back to the server's spot
      const w = worlds.current, q = w.where && w.where(); ease.k += dt / 0.15;
      if (!q || !w.restoreWhere || ease.k >= 1) { if (q && w.restoreWhere) w.restoreWhere({ ...q, x: ease.x, z: ease.z }); ease = null; }
      else w.restoreWhere({ ...q, x: q.x + (ease.x - q.x) * Math.min(1, ease.k), z: q.z + (ease.z - q.z) * Math.min(1, ease.k) });
    }
    if (ws && ws.readyState === 1 && conn === 'open' && !ease && !engine.hold) {
      // arriving in a world (or a new tile of it) with building: ask the server for what's been built and dug
      // there. The join snapshot only fills the world she joined in (the garden), so a planet's saved pieces and
      // digs stayed invisible after a reload until this.
      const tl = tools();
      if (tl.build || tl.vox) {
        const sk = (tl.w?.id || '') + '|' + (tl.w?.debug?.W?.seed ?? '') + '|' + (tl.tile || '');
        if (sk !== snapKey && now - snapAskT > 1000) { snapKey = sk; snapAskT = now; try { ws.send(JSON.stringify({ t: 'e', k: 'sync', tile: tl.tile || '' })); tr('sync', sk); } catch (e) { /* */ } }
      }
      sendAcc += dt;
      // with others here (or a camp watching) 10 Hz; alone still 2 Hz, so the server always knows where she is
      // (building alone on a planet sent no poses, every piece looked out of reach and she was kicked)
      const busy = peersN > 1 || window.__factions?.wantPose();
      if (sendAcc >= 1 / (busy ? SEND_HZ : ALONE_HZ)) {
        sendAcc = 0;
        const q = pose();
        const mv = moveState();
        const mvKey = mv ? mv.st + '|' + mv.a.join(',') + '|' + (mv.gn || 0) : '';
        if (q && (!lastSent || Math.hypot(q.x - lastSent.x, q.z - lastSent.z) > 0.02 || Math.abs(q.y - lastSent.y) > 0.03 || Math.abs(q.yaw - lastSent.yaw) > 0.02 || mvKey !== lastMvKey)) {
          seq++; const m = { t: 'p', ...q, s: seq, ct: Math.round(now) }; if (fixAck) m.r = fixAck;
          // delta-only: just the fields that changed since her last pose; a full keyframe each second and on a new socket
          if (mv) {
            const full = !sentMv || sentMvWs !== ws || now - sentMvT > KEY_MS;
            const part = full ? { ...mv } : moveDelta(sentMv, mv);
            if (part) { m.m = part; sentMv = mergeMove(full ? null : sentMv, part); }
            if (full) { sentMvT = now; sentMvWs = ws; }
          }
          lastMvKey = mvKey;
          const lk = myLook(); if (lk && (lk !== lastLk || now - lastLkT > 5000)) { m.lk = lk; lastLk = lk; lastLkT = now; } // late joiners get it within 5 s
          ws.send(JSON.stringify(m)); lastSent = q; sentAt.set(seq, now);
          if (sentAt.size > 64) sentAt.delete(sentAt.keys().next().value);
        }
      }
    }
    drawPeers();
    // the people you see are solid to walk into (capsules where they're drawn; the server checks the same)
    { const d = worlds.current?.debug, cols = d && (d.game?.player || d.player || d.core?.player)?.colliders;
      if (cols && cols.setBodies) cols.setBodies('peers', [...peers.values()].filter((p) => p.group.visible && p.scene === worlds.current?.scene).map((p) => bodyShape('person', p.group.position.x, p.group.position.z, p.group.position.y))); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- sign in
  let turnstileToken = null;
  async function turnstile(el) {
    const cfg = await api('/config');
    if (!window.turnstile) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    window.turnstile.render(el, { sitekey: cfg.turnstileSitekey, theme: 'dark', size: 'flexible', callback: (t) => { turnstileToken = t; } });
  }
  async function startSignIn(email) {
    const r = await api('/auth/start', { email, turnstile: turnstileToken });
    if (window.turnstile) try { window.turnstile.reset(); } catch { /* */ }
    turnstileToken = null;
    return r;
  }
  async function verify(email, code, name) {
    const r = await api('/auth/verify', { email, code, name });
    if (r.token) { sess = { token: r.token, account: r.account }; store(); afterSignIn(); }
    return r;
  }
  // ---- one-click invites: https://play.thinkcore.io/j/CODE (web) or zenmultiverse://join/CODE (desktop app).
  // A join that arrives before sign-in waits in localStorage; sign-in happens once, then the session
  // is remembered (server keeps it alive for 180 days of use), so the next link drops her straight in.
  const JOIN_LS = 'zen-mp-join';
  const joinCode = (v) => { const m = /(?:^|[/=])([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})\/?(?:[?#].*)?$/.exec(String(v || '').trim()); return m ? m[1].replace('-', '').toUpperCase() : null; };
  function stashJoin(code) { try { localStorage.setItem(JOIN_LS, JSON.stringify({ code, t: Date.now() })); } catch { /* */ } }
  function takeStash() { try { const j = JSON.parse(localStorage.getItem(JOIN_LS) || 'null'); localStorage.removeItem(JOIN_LS); return j && Date.now() - j.t < 864e5 ? j.code : null; } catch { return null; } }
  let invited = null; // shown on the sign-in panel while a join waits
  async function joinFromLink(raw) {
    const code = joinCode(raw); if (!code || !SERVER) return;
    if (sess) { const r = await redeem(code); if (r && r.error === 'signin') { sess = null; store(); } else return; }
    stashJoin(code); invited = code; ui.open();
  }
  async function refreshMe() {
    if (!sess) { setDevAllowed(false); return; }
    try {
      const r = await api('/me');
      if (r && r.id) { sess.account = { ...sess.account, ...r }; store(); }
    } catch { /* keep the cached account */ }
    setDevAllowed(!!sess?.account?.devAllowed);
  }
  async function afterSignIn() {
    ui.render();
    await refreshMe();
    const join = joinCode(params.get('join')) || takeStash();
    invited = null;
    if (join) await redeem(join);
  }
  async function redeem(code) {
    const r = await api('/invite/redeem', { code });
    if (!r.world) { ui.chatLine(null, r.error === 'signin' ? 'Please sign in again.' : 'That invite has expired. Ask for a fresh link.'); return r; }
    await visit(r.world, r.host, r.near); return r;
  }
  // join the shared server (an invite, a friend's Join): spawn next to them if they're playing, else at the world spawn
  async function visit(world, who, near) {
    const [kind] = world.split(':');
    host = null;
    if (kind === 'home' && worlds.currentId !== 'planet') await enterHub(worlds).catch((e) => console.warn('[hub] visit', e));
    if (kind === 'moon' && worlds.currentId !== 'moon') await worlds.go('moon', { from: 'visit' });
    const key = worldKey();
    if (near && near !== sess.account.id) nearNext = { id: near, world: key };
    ui.chatLine(null, near && near !== sess.account.id && who ? `Joining the server next to ${who.name}` : 'Joining the server');
    if (key === wsKey && conn === 'open') want = null; // already here: reconnect so the server can place us next to them
    connect(key); ui.render();
  }

  // ---- UI (all server text goes in with textContent, never innerHTML)
  function buildUi() {
    const css = document.createElement('style');
    css.textContent = `
#mp{position:fixed;top:12px;right:12px;z-index:30;font:13px/1.35 system-ui,sans-serif;color:#f3eee4;user-select:none;-webkit-user-select:none}
#mp .chip{background:rgba(18,24,32,.52);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:6px 11px;cursor:pointer;display:inline-flex;gap:7px;align-items:center}
#mp .dot{width:8px;height:8px;border-radius:50%;background:#7c8a7a}#mp .dot.on{background:#8fd39a;box-shadow:0 0 6px #8fd39a}
#mp .panel{margin-top:8px;width:270px;background:rgba(18,24,32,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;display:none}
#mp .panel.open{display:block}
#mp h4{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#c9d6c4;font-weight:600}
#mp input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:9px;color:#fff;padding:7px 9px;margin:3px 0;font:inherit;user-select:text;-webkit-user-select:text}
#mp button{background:#6f9a78;border:0;border-radius:9px;color:#fff;padding:6px 10px;font:inherit;cursor:pointer;margin:3px 4px 3px 0}
#mp button.ghost{background:rgba(255,255,255,.1)}
#mp .row{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}#mp .row span.n{flex:1}
#mp .code{font:600 18px ui-monospace,monospace;letter-spacing:.12em;padding:6px 0}
#mp .muted{color:#aab3ad;font-size:12px}
#mpchat{position:fixed;left:14px;bottom:86px;z-index:29;width:min(380px,70vw);font:14px/1.4 system-ui,sans-serif;color:#fff;pointer-events:none}
#mpchat .l{background:rgba(14,18,24,.45);border-radius:10px;padding:4px 9px;margin-top:4px;width:fit-content;max-width:100%;transition:opacity 1.2s;text-shadow:0 1px 2px rgba(0,0,0,.4)}
#mpchat .l b{font-weight:600;margin-right:6px;pointer-events:auto;cursor:pointer}
#mpchat .l.sys{color:#d6e3d0;font-style:italic}
#mpchat input{pointer-events:auto;width:100%;box-sizing:border-box;margin-top:6px;background:rgba(14,18,24,.7);border:1px solid rgba(255,255,255,.2);border-radius:10px;color:#fff;padding:8px 10px;font:inherit;display:none}
#mpchat.typing input{display:block}#mpchat.typing .l{opacity:1!important}
#mphold{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;background:rgba(10,14,20,.28);backdrop-filter:blur(3px) saturate(.8);-webkit-backdrop-filter:blur(3px) saturate(.8);font:15px/1.4 system-ui,sans-serif;color:#f3eee4}
#mphold.on{display:flex}#mphold .card{background:rgba(18,24,32,.72);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 24px;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:320px;text-align:center}
#mphold .leaf{width:22px;height:22px;border-radius:50% 0;background:#8fb996;animation:mpbreath 2.4s ease-in-out infinite}
@keyframes mpbreath{0%,100%{transform:rotate(45deg) scale(.8);opacity:.55}50%{transform:rotate(45deg) scale(1.05);opacity:1}}
#mphold button{background:#6f9a78;border:0;border-radius:9px;color:#fff;padding:7px 14px;font:inherit;cursor:pointer}
#mp .weak{color:#e6c86e;font-size:11px}
#mpmenu{position:fixed;z-index:40;background:rgba(18,24,32,.9);border-radius:10px;padding:6px;display:none;font:13px system-ui,sans-serif}
#mpmenu button{display:block;width:100%;background:none;border:0;color:#fff;padding:6px 12px;text-align:left;cursor:pointer;border-radius:6px}#mpmenu button:hover{background:rgba(255,255,255,.1)}`;
    document.head.appendChild(css);
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const root = el('div'); root.id = 'mp';
    const chip = el('div', 'chip'); const dot = el('span', 'dot'); const chipTxt = el('span', null, 'Play together');
    chip.append(dot, chipTxt); root.appendChild(chip);
    const panel = el('div', 'panel'); root.appendChild(panel);
    chip.onclick = () => { panel.classList.toggle('open'); if (panel.classList.contains('open')) render(); };
    document.body.appendChild(root);

    const chat = el('div'); chat.id = 'mpchat'; const log = el('div'); const inp = el('input'); inp.maxLength = 200; inp.placeholder = 'Say something kind…';
    chat.append(log, inp); document.body.appendChild(chat);
    const menu = el('div'); menu.id = 'mpmenu'; document.body.appendChild(menu);
    const holdEl = el('div'); holdEl.id = 'mphold'; const card = el('div', 'card'); const leaf = el('div', 'leaf'); const holdTxt = el('div'); const holdBtn = el('button', null, 'Reconnect');
    card.append(leaf, holdTxt, holdBtn); holdEl.appendChild(card); document.body.appendChild(holdEl);
    holdBtn.onclick = () => { const k = stopKey || want; stopKey = null; tries = 1; holdTxt.textContent = 'Reconnecting…'; holdBtn.style.display = 'none'; if (k) { want = null; connect(k, { resume: true }); } };
    // any card over the game frees the mouse (a locked pointer can't reach the button); Enter or R presses Reconnect
    function overlay(on, text, button) {
      holdEl.classList.toggle('on', !!on); holdTxt.textContent = text || ''; holdBtn.style.display = button ? '' : 'none';
      holdBtn.textContent = 'Reconnect (Enter)';
      if (on && document.pointerLockElement && document.exitPointerLock) { try { document.exitPointerLock(); } catch { /* */ } }
      if (on && button) { try { holdBtn.focus({ preventScroll: true }); } catch { /* */ } }
    }
    const weak = el('span', 'weak'); chip.appendChild(weak);
    function net(c, r) { const t = c === 'open' && r > 350 ? 'slow link' : ''; if (weak.textContent !== t) weak.textContent = t; }
    addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) menu.style.display = 'none'; }, true);
    addEventListener('keydown', (e) => {
      if (e.target === inp) {
        if (e.key === 'Enter') { const t = inp.value.trim(); if (t && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'c', text: t })); inp.value = ''; closeChat(); }
        else if (e.key === 'Escape') closeChat();
        e.stopPropagation(); return;
      }
      if (holdEl.classList.contains('on') && holdBtn.style.display !== 'none' && (e.key === 'Enter' || e.key === 'r' || e.key === 'R')) { e.preventDefault(); e.stopPropagation(); holdBtn.click(); return; }
      if (/INPUT|TEXTAREA/.test(e.target?.tagName || '') && e.target.id !== 'haptic-surface') return;
      if ((e.key === 'Enter' || e.key === 't') && ws && !chat.classList.contains('typing')) { e.preventDefault(); chat.classList.add('typing'); inp.focus(); }
    });
    function closeChat() { chat.classList.remove('typing'); inp.blur(); }

    function chatLine(m, text) {
      const l = el('div', 'l' + (m ? '' : ' sys'));
      if (m) {
        const b = el('b', null, m.name); b.style.color = '#' + hue(m.id).toString(16).padStart(6, '0');
        if (m.id !== sess?.account.id) b.onclick = (e) => openMenu(e, m);
        l.append(b, document.createTextNode(text));
      } else l.textContent = text;
      log.appendChild(l);
      while (log.children.length > 8) log.firstChild.remove();
      setTimeout(() => { l.style.opacity = '0'; }, 12000);
      setTimeout(() => l.remove(), 14000);
    }
    function openMenu(e, m) {
      menu.replaceChildren();
      const add = (label, fn) => { const b = el('button', null, label); b.onclick = async () => { menu.style.display = 'none'; await fn(); }; menu.appendChild(b); };
      add(`Add ${m.name} as a friend`, async () => { await api('/friends/request', { name: m.name, tag: m.tag }); chatLine(null, 'Friend request sent.'); });
      add('Block', async () => { await api('/block', { id: m.id }); blocked.add(m.id); dropPeer(m.id); chatLine(null, `${m.name} is blocked. You won't see or hear them.`); });
      add('Report', async () => { await api('/report', { id: m.id, reason: 'chat' }); chatLine(null, 'Thanks. A person will look at it.'); });
      menu.style.left = e.clientX + 'px'; menu.style.top = (e.clientY - 110) + 'px'; menu.style.display = 'block';
    }
    function status() {
      const on = conn === 'open';
      dot.classList.toggle('on', on);
      const others = peers.size;
      chipTxt.textContent = !SERVER ? 'Play together' : !sess ? 'Play together' : !on ? (conn === 'reconnecting' || conn === 'connecting' ? (everOpen.size ? 'Reconnecting…' : 'Connecting…') : (closedWhy || (conn === 'solo' ? 'Playing solo' : 'Not in a shared world'))) : others ? `${others + 0} here with you` : 'Online';
    }
    async function render() {
      status();
      if (!panel.classList.contains('open')) return;
      panel.replaceChildren();
      if (!sess) return renderSignIn();
      const me = el('div', 'muted', `Signed in as ${sess.account.name}#${sess.account.tag}`); panel.appendChild(me);
      panel.appendChild(el('h4', null, 'Friends'));
      const f = await api('/friends');
      for (const r of f.incoming || []) {
        const row = el('div', 'row'); row.append(el('span', 'n', `${r.name}#${r.tag} wants to be friends`));
        const y = el('button', null, 'Yes'); y.onclick = async () => { await api('/friends/respond', { id: r.id, accept: true }); render(); };
        const n = el('button', 'ghost', 'No'); n.onclick = async () => { await api('/friends/respond', { id: r.id, accept: false }); render(); };
        row.append(y, n); panel.appendChild(row);
      }
      if (!(f.friends || []).length && !(f.incoming || []).length) panel.appendChild(el('div', 'muted', 'No friends yet. Add one by name and number.'));
      for (const r of f.friends || []) {
        const row = el('div', 'row'); const d = el('span', 'dot' + (r.online ? ' on' : ''));
        row.append(d, el('span', 'n', `${r.name}` + (r.online && r.where ? ` · ${r.where === 'home' ? 'on Earth' : r.where === 'moon' ? 'on the moon' : 'exploring'}` : '')));
        if (r.online) { const j = el('button', null, 'Join'); j.onclick = async () => { const res = await api('/join-friend', { id: r.id }); if (res.world) await visit(res.world, res.host, res.near); else chatLine(null, res.error === 'closed' ? `Can't join ${r.name} right now.` : `${r.name} isn't playing right now.`); }; row.appendChild(j); }
        panel.appendChild(row);
      }
      for (const r of f.outgoing || []) panel.appendChild(el('div', 'muted', `Waiting for ${r.name}#${r.tag}…`));
      // search players by name (3+ letters), then add them
      const sq = el('input'); sq.placeholder = 'Find a player by name'; const res = el('div');
      let sqT = null; sq.oninput = () => { clearTimeout(sqT); sqT = setTimeout(async () => {
        res.replaceChildren(); if (sq.value.trim().length < 3) return;
        const r = await api('/search', { q: sq.value.trim() });
        for (const p of r.players || []) { const row = el('div', 'row'); row.append(el('span', 'dot' + (p.online ? ' on' : '')), el('span', 'n', `${p.name}#${p.tag}`)); const b = el('button', 'ghost', 'Add'); b.onclick = async () => { await api('/friends/request', { name: p.name, tag: p.tag }); b.textContent = 'Sent'; b.disabled = true; }; row.appendChild(b); res.appendChild(row); }
      }, 350); };
      panel.append(sq, res);
      const add = el('input'); add.placeholder = 'Or exact Name#1234';
      const addB = el('button', 'ghost', 'Add friend'); addB.onclick = async () => { const m = /^(.+)#(\d{4})$/.exec(add.value.trim()); if (!m) return; await api('/friends/request', { name: m[1], tag: m[2] }); add.value = ''; render(); };
      panel.append(add, addB);
      panel.appendChild(el('h4', null, 'Invite'));
      const code = el('div', 'code'); const link = el('div', 'muted');
      const inv = el('button', null, 'Invite to the server'); inv.onclick = async () => {
        const r = await api('/invite', {}); if (!r.code) return;
        code.textContent = r.code.slice(0, 4) + '-' + r.code.slice(4);
        const href = `${SERVER}/j/${r.code}`; link.textContent = href + ' · one click to join the server next to you · works for 24 h';
        try { await navigator.clipboard.writeText(href); link.textContent += ' · link copied'; } catch { /* */ }
      };
      const ci = el('input'); ci.placeholder = 'Have a code? XXXX-XXXX';
      const cb = el('button', 'ghost', 'Join with code'); cb.onclick = async () => { await redeem(joinCode(ci.value) || ci.value); ci.value = ''; };
      panel.append(inv, code, link, ci, cb);
      const out = el('button', 'ghost', 'Sign out'); out.onclick = async () => { await api('/auth/logout', {}).catch(() => {}); sess = null; store(); connect(null); render(); };
      panel.appendChild(out);
    }
    function renderSignIn() {
      panel.appendChild(el('h4', null, 'Play together'));
      if (!SERVER) { panel.appendChild(el('div', 'muted', 'Online play is not set up in this build. You can still play on your own.')); return; }
      if (invited) panel.appendChild(el('div', null, 'You\'re invited! Sign in once and you\'ll go straight to your friend\'s world. Next time it\'s one click.'));
      panel.appendChild(el('div', 'muted', 'We email you a 6-digit code. No password, and you stay signed in on this device.'));
      const em = el('input'); em.type = 'email'; em.placeholder = 'Email'; em.autocomplete = 'email';
      try { em.value = localStorage.getItem('zen-mp-email') || ''; } catch { /* */ }
      const ts = el('div'); const go = el('button', null, 'Send code');
      const step2 = el('div'); const note = el('div', 'muted');
      panel.append(em, ts, go, step2, note);
      turnstile(ts).catch(() => { note.textContent = 'Could not load the human check.'; });
      go.onclick = async () => {
        const r = await startSignIn(em.value.trim());
        if (r.ok) try { localStorage.setItem('zen-mp-email', em.value.trim()); } catch { /* */ }
        if (!r.ok) { note.textContent = r.error === 'turnstile' ? 'Please finish the human check first.' : r.error === 'slow_down' ? 'Too many tries. Wait a bit.' : 'Check the email address.'; return; }
        go.style.display = 'none'; ts.style.display = 'none'; step2.replaceChildren();
        const code = el('input'); code.inputMode = 'numeric'; code.placeholder = '6-digit code'; code.autocomplete = 'one-time-code';
        if (r.devCode) code.value = r.devCode; // local dev server only
        const name = el('input'); name.placeholder = 'Your name in the game'; name.maxLength = 16;
        const v = el('button', null, r.newAccount ? 'Create my account' : 'Sign in');
        step2.append(code); if (r.newAccount) step2.append(name); step2.append(v);
        let busy = false;
        v.onclick = async () => { if (busy) return; busy = true; const x = await verify(em.value.trim(), code.value.trim(), name.value).finally(() => { busy = false; }); if (!x.token) note.textContent = x.error === 'name' ? 'Pick another name.' : 'That code didn\'t work.'; };
        // returning players: typing (or pasting) the 6th digit signs in, no extra click
        code.oninput = () => { if (!r.newAccount && /^\d{6}$/.test(code.value.trim())) v.onclick(); };
        (r.newAccount ? name : code).focus();
      };
    }
    const open = () => { panel.classList.add('open'); render(); };
    return { render, status, chatLine, overlay, net, open };
  }

  if (sess) afterSignIn(); else if (joinCode(params.get('join'))) { stashJoin(joinCode(params.get('join'))); invited = joinCode(params.get('join')); ui.open(); }
  // desktop app: links opened while the app runs (or that launched it) arrive from the Rust side
  if (window.__TAURI_INTERNALS__) {
    const pull = () => window.__TAURI_INTERNALS__.invoke('zen_take_links').then((l) => { for (const u of l || []) joinFromLink(u); }).catch(() => {});
    window.__zenDeepLink = pull; pull();
  }
  function sendFire(dir) {
    if (!ws || ws.readyState !== 1 || conn !== 'open') return;
    const ago = Math.max(0, Math.min(1000, dir.ago || 0));
    ws.send(JSON.stringify({ t: 'f', dx: dir.dx, dy: dir.dy, dz: dir.dz, ago }));
  }
  function refreshDevTicket() {
    if (!sess || !SERVER || !want) return;
    connect(want, { resume: true });
  }
  bindDevNet({ fire: sendFire, refresh: refreshDevTicket, rtt: () => rtt });

  const api_ = {
    trace, fire: sendFire,
    get state() { return { signedIn: !!sess, me: sess?.account, world: wsKey, conn, hold: !!engine.hold, tries, rtt: Math.round(rtt), seq, fixAck, open: conn === 'open', n: peersN, peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name, at: p.group.visible ? p.group.position.toArray().map((v) => +v.toFixed(2)) : null, body: p.av ? { ready: !!p.avReady, shown: p.av.group.visible, st: p.av.anim ? p.av.anim.state : null } : null })), host } },
    signInDev: async (email, name) => { turnstileToken = 'XXXX.DUMMY.TOKEN.XXXX'; const s = await startSignIn(email); return verify(email, s.devCode, name); },
    get games() { return games; }, api, visit, redeem, joinFromLink, dropLink: () => { if (ws) ws.close(4000, 'test drop'); }, say: (text) => ws && ws.send(JSON.stringify({ t: 'c', text })), ui,
  };
  if (params.has('debug')) window.__net = api_;
  return api_;
}
