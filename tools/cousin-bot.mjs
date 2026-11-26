// A light second player for tools/compete-shoot.py: no browser, just the WebSocket protocol.
// Reads JSON lines {id, js} on stdin, evaluates js against a tiny __w / __net shim (same names the
// browser helper uses), writes {id, r} or {id, err}. Walks at a legal pace like the real client.
import readline from 'node:readline';
const BASE = process.env.MP || 'http://127.0.0.1:8787', WS = BASE.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = null, me = null, ws = null, pos = { x: 0, z: 0, yaw: 0 }, seq = 0, acked = 0, started = false;
const msgs = [];
async function api(path, body) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
function pose(x, z, yaw = pos.yaw) { if (!ws || ws.readyState !== 1) return; seq++; const m = { t: 'p', x: +x.toFixed(3), y: 0, z: +z.toFixed(3), yaw, s: seq }; if (acked) m.r = acked; ws.send(JSON.stringify(m)); pos = { x: m.x, z: m.z, yaw }; }
async function connect(world) {
  const t = await api('/ticket', { world });
  ws = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(t.ticket)}`);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); msgs.push(m); if (msgs.length > 400) msgs.shift(); if (m.t === 'fix') { pos = { ...pos, x: m.x, z: m.z }; acked = m.id; } };
  ws.onclose = (e) => { process.stderr.write(`[bot] closed ${e.code} ${e.reason}\n`); ws = null; };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 4000);
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"hb"}'); }, 45000);
  await sleep(300); ws.send(JSON.stringify({ t: 'g', k: 'v' })); pose(pos.x, pos.z); started = true;
}
globalThis.__net = {
  async signInDev(email, name) { const s = await api('/auth/start', { email, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }); const v = await api('/auth/verify', { email, code: s.devCode, name }); token = v.token; me = v.account; return v; },
  async redeem(code) { const r = await api('/invite/redeem', { code }); if (r.world) await connect(r.world); return r; },
  get state() { return { open: !!ws && ws.readyState === 1, me, peers: [] }; },
};
globalThis.__w = {
  P: () => ({ position: pos, teleport(x, z, yaw = 0) { pos = { x, z, yaw }; if (started) pose(x, z, yaw); }, snapCamera() {} }),
  async walk(x, z, sp = 6) {
    for (let i = 0; i < 900; i++) {
      const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz); if (d < 0.05) return 1;
      const s = Math.min(d, sp * 0.1); pose(pos.x + dx / d * s, pos.z + dz / d * s, Math.atan2(dx, dz) + Math.PI); await sleep(100);
    }
    return 0;
  },
  look() { return 1; },
  g: (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'g', ...o })); },
  S: () => ({}),
};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let q; try { q = JSON.parse(line); } catch { return; }
  try { const r = await (0, eval)(`(async () => (${q.js}))()`); process.stdout.write(JSON.stringify({ id: q.id, r: r === undefined ? null : r }) + '\n'); }
  catch (e) { process.stdout.write(JSON.stringify({ id: q.id, err: String(e && e.message || e) }) + '\n'); }
});
rl.on('close', () => { try { ws && ws.close(); } catch { /* */ } process.exit(0); });
