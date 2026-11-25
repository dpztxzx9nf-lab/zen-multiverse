// Multiplayer client (behind ?mp=1 until the server is live; then on by default for the whole game).
// Talks to the Zen Multiverse server (Cloudflare Worker + one Durable Object per world):
//   sign in with an emailed 6-digit code (Turnstile on the request), keep a session token,
//   get a one-minute signed ticket for the world she's in, open a WebSocket to that world.
// Shows other players as simple avatars with names, presence count, chat, friends (add by Name#1234,
// join a friend), invites (code + link) and block / report.
// Netcode: the server is authoritative. Her own player is predicted locally (moves at once); every move is
// numbered, the server acks the newest it accepted and answers a refused one with a correction, which we
// reconcile (ease back if small, snap if big) and confirm. Other players are interpolated ~100–300 ms behind
// (adaptive to jitter), with a short extrapolation if packets are late.
// Online-only: if the connection drops, the world holds still under a calm "Reconnecting…" card, we retry with
// backoff and resume the same world at the spot the server last accepted. No offline/single-player fallback.
import * as THREE from 'three';

const LS = 'zen-mp';
// production endpoint: set when ThinkCore puts the Worker on the game's domain (see notes/multiplayer.md)
const PROD_SERVER = 'https://mp.zenmultiverse.app';
const EYE = 1.6;
const SEND_HZ = 10, BUF_MIN = 100, BUF_MAX = 300, EXTRAP_MS = 150;
const PING_MS = 4000, DEAD_MS = 9000, HOLD_AFTER_MS = 2500;

export async function startNet({ worlds, params, engine = {} }) {
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const SERVER = (params.get('mpserver') || (local ? 'http://127.0.0.1:8787' : PROD_SERVER)).replace(/\/$/, '');
  let sess = load();
  let host = null;            // whose home/moon she is visiting (null = her own)
  let ws = null, wsKey = null, want = null, peersN = 1, closedWhy = '';
  // connection state: 'idle' (no shared world) | 'connecting' | 'open' | 'reconnecting' | 'stopped'
  let conn = 'idle', tries = 0, retryT = null, connectStart = 0, lastRx = 0, rtt = 0, everOpen = new Set(), stopKey = null;
  const trace = []; const tr = (...a) => { trace.push(Math.round(performance.now()) + ' ' + a.join(' ')); if (trace.length > 80) trace.shift(); };
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
    const owner = host?.id || sess.account.id;
    if (id === 'earth') return `home:${owner}`;
    if (id === 'moon') return `moon:${owner}`;
    if (id === 'planet') { const q = w.where && w.where(); return q && q.seed != null ? `planet:${q.dim || 'prime'}:${q.seed >>> 0}` : null; }
    return null; // space flight is solo
  }
  function pose() {
    const w = worlds.current; const q = w && w.where && w.where();
    if (!q || !w.camera) return null;
    return { x: q.x, y: +(w.camera.position.y - EYE).toFixed(2), z: q.z, yaw: q.yaw };
  }

  // ---- connection (auto-reconnect with backoff + session resume)
  async function connect(key, { resume = false } = {}) {
    clearTimeout(retryT); retryT = null;
    if (key !== want) { tries = 0; stopKey = null; }
    want = key;
    if (ws) { const old = ws; ws = null; try { old.close(1000, 'moving'); } catch { /* */ } }
    clearPeers(); wsKey = null; peersN = 1;
    if (!key) { conn = 'idle'; hold(false); ui.render(); return; }
    if (stopKey === key) return;
    tr('connect', key, 'resume=' + resume, 'tries=' + tries);
    conn = tries ? 'reconnecting' : 'connecting'; connectStart = performance.now(); ui.status();
    let t;
    try { t = await api('/ticket', { world: key, resume }); } catch { t = { error: 'network' }; }
    if (want !== key) return;
    if (!t.ticket) {
      if (t.status === 403 || t.status === 400) { // not allowed there (garden closed / blocked): go home calmly
        closedWhy = 'That garden is closed to visitors.'; ui.chatLine(null, closedWhy);
        if (host) { host = null; want = null; return connect(worldKey()); }
        conn = 'stopped'; stopKey = key; hold(false); ui.render(); return;
      }
      if (t.status === 401) { conn = 'idle'; hold(false); ui.render(); return; } // signed out
      return retry(key);
    }
    const s = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws?ticket=' + encodeURIComponent(t.ticket));
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
      ws = null; clearPeers();
      if ([4001, 4003, 4004].includes(e.code)) {
        // signed in elsewhere / failed checks / removed: don't loop; offer one calm button
        closedWhy = e.code === 4001 ? 'You joined from another device.' : (e.reason || 'Disconnected.');
        conn = 'stopped'; stopKey = key; hold(true, closedWhy, true); ui.render(); return;
      }
      if (want === key) retry(key);
    };
  }
  function retry(key) {
    tr('retry', key, tries);
    conn = 'reconnecting'; tries++;
    if (everOpen.has(key) || performance.now() - connectStart > HOLD_AFTER_MS) hold(true);
    // 0.5 s, 1, 2, 4, 8, then every 10 s, with jitter so a server restart isn't hit by everyone at once
    const d = Math.min(10000, 500 * 2 ** Math.min(tries - 1, 5)) * (0.75 + Math.random() * 0.5);
    clearTimeout(retryT);
    retryT = setTimeout(() => { if (want === key && !ws) connect(key, { resume: everOpen.has(key) }); }, d);
    ui.status();
  }
  // retry right away when the network comes back or the tab returns
  addEventListener('online', () => { if (conn === 'reconnecting' && want) connect(want, { resume: everOpen.has(want) }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn === 'reconnecting' && want && !ws) connect(want, { resume: everOpen.has(want) }); });
  function hold(on, text, button) {
    engine.hold = !!on;
    ui.overlay(on, text || (tries > 3 ? 'Reconnecting… your world is safe, just waiting for the connection.' : 'Reconnecting…'), button);
  }
  function opened(m) {
    const key = wsKey;
    conn = 'open'; tries = 0; closedWhy = ''; everOpen.add(key);
    // resume: the server put her back at the last spot it accepted; match it if we drifted
    if (m.resume) {
      const w = worlds.current, q = w.where && w.where();
      if (q && w.restoreWhere && Math.hypot(q.x - m.resume.x, q.z - m.resume.z) > 0.5) w.restoreWhere({ ...q, x: m.resume.x, z: m.resume.z });
    }
    lastSent = null; fixAck = 0; sentAt.clear();
    hold(false); ui.render();
  }

  function onMsg(m) {
    switch (m.t) {
      case 'hi': tr('hi', m.n, JSON.stringify(m.resume)); peersN = m.n; for (const p of m.others) addPeer(p); for (const p of m.peers) sample(p); opened(m); break;
      case 'a': { const t0 = sentAt.get(m.s); if (t0) { const r = performance.now() - t0; rtt = rtt ? rtt * 0.8 + r * 0.2 : r; } for (const k of sentAt.keys()) if (k <= m.s) sentAt.delete(k); break; }
      case 'n': peersN = m.n; ui.status(); break;
      case 'join': addPeer(m); ui.chatLine(null, `${m.name} arrived`); break;
      case 'leave': { const p = peers.get(m.id); if (p) { ui.chatLine(null, `${p.name} left`); dropPeer(m.id); } break; }
      case 'p': sample(m); break;
      case 'c': if (!blocked.has(m.id)) ui.chatLine(m, m.text); break;
      case 'sys': ui.chatLine(null, m.text); break;
      case 'fix': { // reconciliation: the server refused a move, so return to the spot it holds
        if (m.id <= fixAck) break;
        fixAck = m.id; lastSent = null; sentAt.clear();
        const w = worlds.current, q = w.where && w.where();
        if (q && w.restoreWhere && m.x != null) {
          const d = Math.hypot(q.x - m.x, q.z - m.z);
          if (d < 1.5) ease = { x: m.x, z: m.z, k: 0 }; // small: ease back over ~150 ms (no visible pop)
          else w.restoreWhere({ ...q, x: m.x, z: m.z });
        }
        break;
      }
      case 'blocked': blocked.add(m.id); dropPeer(m.id); break;
      case 'unblocked': blocked.delete(m.id); break;
    }
  }

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
  function addPeer(p) {
    if (peers.has(p.id) || p.id === sess?.account.id || blocked.has(p.id)) return;
    const group = avatar(p.name, hue(p.id)); group.visible = false;
    worlds.current?.scene?.add(group);
    peers.set(p.id, { id: p.id, name: p.name, tag: p.tag, group, scene: worlds.current?.scene, samples: [] });
    ui.status();
  }
  function sample(m) {
    const p = peers.get(m.id); if (!p) return;
    const t = performance.now(), last = p.samples[p.samples.length - 1];
    if (last) { const gap = t - last.t; p.gap = p.gap ? p.gap * 0.9 + gap * 0.1 : gap; p.jit = (p.jit || 0) * 0.9 + Math.abs(gap - p.gap) * 0.1; }
    p.samples.push({ t, x: m.x, y: m.y, z: m.z, yaw: m.yaw });
    if (p.samples.length > 30) p.samples.splice(0, p.samples.length - 30);
  }
  function dropPeer(id) { const p = peers.get(id); if (!p) return; p.scene?.remove(p.group); p.group.userData.dispose(); peers.delete(id); ui.status(); }
  function clearPeers() { for (const id of [...peers.keys()]) dropPeer(id); }
  const lerpAng = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
  function drawPeers() {
    const now = performance.now();
    for (const p of peers.values()) {
      const s = p.samples; if (!s.length) continue;
      // buffer = one update interval + 2x jitter, 100..300 ms: smooth on wobbly Wi-Fi, still close to live
      const buf = Math.min(BUF_MAX, Math.max(BUF_MIN, (p.gap || 100) + 2 * (p.jit || 0)));
      const t = now - buf;
      if (p.scene !== worlds.current?.scene) { p.scene?.remove(p.group); worlds.current?.scene?.add(p.group); p.scene = worlds.current?.scene; }
      let a = s[0], b = s[s.length - 1];
      for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= t) { a = s[i - 1]; b = s[i]; break; }
      // late packets: keep gliding along the last direction for up to 150 ms, then wait (no rubber band)
      const k = b.t > a.t ? Math.min(1 + EXTRAP_MS / Math.max(50, b.t - a.t), Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      p.group.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      p.group.rotation.y = -lerpAng(a.yaw, b.yaw, k);
      p.group.visible = true;
    }
  }

  // ---- connection supervision on a timer (not the frame loop: a slow or held frame loop must not stall it)
  let lastSent = null, sendAcc = 0, hbT = 0, pingSent = 0, lastPing = 0, lastT = performance.now();
  setInterval(() => {
    const now = performance.now();
    const k = worldKey(); if (k !== want) connect(k);
    // still waiting on a fresh connection after a while: hold still rather than wander unsynced
    if (conn === 'connecting' && !engine.hold && now - connectStart > HOLD_AFTER_MS) hold(true);
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

  // ---- frame loop: send her predicted pose (10 Hz while moving and someone else is here), draw the others
  function tick() {
    const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
    if (ease) { // small reconciliation: ease her back to the server's spot
      const w = worlds.current, q = w.where && w.where(); ease.k += dt / 0.15;
      if (!q || !w.restoreWhere || ease.k >= 1) { if (q && w.restoreWhere) w.restoreWhere({ ...q, x: ease.x, z: ease.z }); ease = null; }
      else w.restoreWhere({ ...q, x: q.x + (ease.x - q.x) * Math.min(1, ease.k), z: q.z + (ease.z - q.z) * Math.min(1, ease.k) });
    }
    if (ws && ws.readyState === 1 && conn === 'open' && !ease && !engine.hold) {
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ) {
        sendAcc = 0;
        const q = pose();
        if (q && peersN > 1 && (!lastSent || Math.hypot(q.x - lastSent.x, q.z - lastSent.z) > 0.02 || Math.abs(q.y - lastSent.y) > 0.03 || Math.abs(q.yaw - lastSent.yaw) > 0.02)) {
          seq++; const m = { t: 'p', ...q, s: seq }; if (fixAck) m.r = fixAck;
          ws.send(JSON.stringify(m)); lastSent = q; sentAt.set(seq, now);
          if (sentAt.size > 64) sentAt.delete(sentAt.keys().next().value);
        }
      }
    }
    drawPeers();
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
  async function afterSignIn() {
    ui.render();
    const join = params.get('join');
    if (join) await redeem(join);
  }
  async function redeem(code) {
    const r = await api('/invite/redeem', { code });
    if (!r.world) { ui.chatLine(null, 'That invite has expired.'); return r; }
    await visit(r.world, r.host); return r;
  }
  async function visit(world, who) {
    const [kind, owner] = world.split(':');
    host = owner === sess.account.id ? null : { id: owner, name: who?.name };
    if (kind === 'home' && worlds.currentId !== 'earth') await worlds.go('earth', { from: 'visit' });
    if (kind === 'moon' && worlds.currentId !== 'moon') await worlds.go('moon', { from: 'visit' });
    ui.chatLine(null, host ? `Visiting ${host.name}'s ${kind === 'moon' ? 'moon base' : 'garden'}` : 'Back home');
    connect(worldKey()); ui.render();
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
    function overlay(on, text, button) { holdEl.classList.toggle('on', !!on); holdTxt.textContent = text || ''; holdBtn.style.display = button ? '' : 'none'; }
    const weak = el('span', 'weak'); chip.appendChild(weak);
    function net(c, r) { const t = c === 'open' && r > 350 ? 'slow link' : ''; if (weak.textContent !== t) weak.textContent = t; }
    addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) menu.style.display = 'none'; }, true);
    addEventListener('keydown', (e) => {
      if (e.target === inp) {
        if (e.key === 'Enter') { const t = inp.value.trim(); if (t && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'c', text: t })); inp.value = ''; closeChat(); }
        else if (e.key === 'Escape') closeChat();
        e.stopPropagation(); return;
      }
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
      chipTxt.textContent = !sess ? 'Play together' : !on ? (conn === 'reconnecting' || conn === 'connecting' ? 'Connecting…' : closedWhy || 'Not in a shared world') : others ? `${others + 0} here with you` : (host ? `${host.name}'s garden` : 'Online');
    }
    async function render() {
      status();
      if (!panel.classList.contains('open')) return;
      panel.replaceChildren();
      if (!sess) return renderSignIn();
      const me = el('div', 'muted', `Signed in as ${sess.account.name}#${sess.account.tag}`); panel.appendChild(me);
      if (host) { const b = el('button', 'ghost', 'Go back home'); b.onclick = () => visit(`home:${sess.account.id}`); panel.appendChild(b); }
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
        row.append(d, el('span', 'n', `${r.name}` + (r.online && r.where ? ` · ${r.where === 'home' ? 'in a garden' : r.where === 'moon' ? 'on the moon' : 'exploring'}` : '')));
        if (r.online) { const j = el('button', null, 'Join'); j.onclick = async () => { const res = await api('/join-friend', { id: r.id }); if (res.world) await visit(res.world, res.host); else chatLine(null, res.error === 'closed' ? `${r.name}'s garden is closed right now.` : `${r.name} isn't in a shared world.`); }; row.appendChild(j); }
        panel.appendChild(row);
      }
      for (const r of f.outgoing || []) panel.appendChild(el('div', 'muted', `Waiting for ${r.name}#${r.tag}…`));
      const add = el('input'); add.placeholder = 'Name#1234';
      const addB = el('button', 'ghost', 'Add friend'); addB.onclick = async () => { const m = /^(.+)#(\d{4})$/.exec(add.value.trim()); if (!m) return; await api('/friends/request', { name: m[1], tag: m[2] }); add.value = ''; render(); };
      panel.append(add, addB);
      panel.appendChild(el('h4', null, 'Invite'));
      const code = el('div', 'code'); const link = el('div', 'muted');
      const inv = el('button', null, 'Invite to my garden'); inv.onclick = async () => {
        const r = await api('/invite', {}); if (!r.code) return;
        code.textContent = r.code.slice(0, 4) + '-' + r.code.slice(4);
        const u = new URL(location.href); u.search = `?game=1&mp=1&join=${r.code}`; link.textContent = u.href + ' · works for 24 h';
        try { await navigator.clipboard.writeText(u.href); link.textContent += ' · link copied'; } catch { /* */ }
      };
      const ci = el('input'); ci.placeholder = 'Have a code? XXXX-XXXX';
      const cb = el('button', 'ghost', 'Join with code'); cb.onclick = async () => { await redeem(ci.value); ci.value = ''; };
      panel.append(inv, code, link, ci, cb);
      const out = el('button', 'ghost', 'Sign out'); out.onclick = async () => { await api('/auth/logout', {}).catch(() => {}); sess = null; store(); connect(null); render(); };
      panel.appendChild(out);
    }
    function renderSignIn() {
      panel.appendChild(el('h4', null, 'Play together'));
      panel.appendChild(el('div', 'muted', 'We email you a 6-digit code. No password to remember.'));
      const em = el('input'); em.type = 'email'; em.placeholder = 'Email'; em.autocomplete = 'email';
      const ts = el('div'); const go = el('button', null, 'Send code');
      const step2 = el('div'); const note = el('div', 'muted');
      panel.append(em, ts, go, step2, note);
      turnstile(ts).catch(() => { note.textContent = 'Could not load the human check.'; });
      go.onclick = async () => {
        const r = await startSignIn(em.value.trim());
        if (!r.ok) { note.textContent = r.error === 'turnstile' ? 'Please finish the human check first.' : r.error === 'slow_down' ? 'Too many tries. Wait a bit.' : 'Check the email address.'; return; }
        go.style.display = 'none'; ts.style.display = 'none'; step2.replaceChildren();
        const code = el('input'); code.inputMode = 'numeric'; code.placeholder = '6-digit code'; code.autocomplete = 'one-time-code';
        if (r.devCode) code.value = r.devCode; // local dev server only
        const name = el('input'); name.placeholder = 'Your name in the game'; name.maxLength = 16;
        const v = el('button', null, r.newAccount ? 'Create my account' : 'Sign in');
        step2.append(code); if (r.newAccount) step2.append(name); step2.append(v);
        v.onclick = async () => { const x = await verify(em.value.trim(), code.value.trim(), name.value); if (!x.token) note.textContent = x.error === 'name' ? 'Pick another name.' : 'That code didn\'t work.'; };
      };
    }
    return { render, status, chatLine, overlay, net };
  }

  if (sess) afterSignIn();
  const api_ = {
    trace,
    get state() { return { signedIn: !!sess, me: sess?.account, world: wsKey, conn, hold: !!engine.hold, tries, rtt: Math.round(rtt), seq, fixAck, open: conn === 'open', n: peersN, peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name, at: p.group.visible ? p.group.position.toArray().map((v) => +v.toFixed(2)) : null })), host } },
    signInDev: async (email, name) => { turnstileToken = 'XXXX.DUMMY.TOKEN.XXXX'; const s = await startSignIn(email); return verify(email, s.devCode, name); },
    api, visit, redeem, dropLink: () => { if (ws) ws.close(4000, 'test drop'); }, say: (text) => ws && ws.send(JSON.stringify({ t: 'c', text })), ui,
  };
  if (params.has('debug')) window.__net = api_;
  return api_;
}
