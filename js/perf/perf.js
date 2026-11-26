// Frame profiler + memory watch. Pure observer: measures, never changes quality (governor.js does that).
//   frame interval (rAF), CPU time of the frame (update vs render submit), GPU time via
//   EXT_disjoint_timer_query_webgl2 (Chrome/Edge/WebView2; not Safari), renderer.info draws/tris,
//   renderer.info.memory + performance.memory sampled every 10 s.
// ?prof=1 also splits GPU time per labelled segment (perf.mark('reflection') etc.); costs a little.
const RING = 600;
function ring() { return { a: new Float32Array(RING), i: 0, n: 0 }; }
function push(r, v) { r.a[r.i] = v; r.i = (r.i + 1) % RING; if (r.n < RING) r.n++; }
// percentile over the last `last` entries (no allocation: reuses one scratch buffer)
const scratch = new Float32Array(RING);
function pct(r, p, last = RING) {
  const n = Math.min(r.n, last); if (!n) return 0;
  for (let k = 0; k < n; k++) scratch[k] = r.a[(r.i - 1 - k + RING) % RING];
  const s = scratch.subarray(0, n).sort();
  return s[Math.min(n - 1, Math.floor(n * p))];
}
function mean(r, last = RING) { const n = Math.min(r.n, last); if (!n) return 0; let s = 0; for (let k = 0; k < n; k++) s += r.a[(r.i - 1 - k + RING) % RING]; return s / n; }

export function createPerf({ renderer, params }) {
  const gl = renderer.getContext();
  const prof = params.get('prof') === '1';
  const S = {
    interval: ring(), cpu: ring(), render: ring(), gpu: ring(),
    calls: 0, tris: 0, frames: 0, gpuOK: false, passes: {}, mem: [], refresh: 60, gpuName: '',
  };
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); S.gpuName = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { /* */ }
  // ---- GPU timer: one TIME_ELAPSED query active at a time; segments chain end->begin
  let ext = null;
  try { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) { ext = null; }
  if (params.get('gputimer') === '0') ext = null;
  S.gpuOK = !!ext;
  const pool = []; const inflight = []; // {q, label, frame}
  let active = null, frameGpu = {}, frameN = 0;
  function begin(label) {
    if (!ext) return;
    const q = pool.pop() || gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = { q, label, frame: frameN };
  }
  function end() { if (!ext || !active) return; gl.endQuery(ext.TIME_ELAPSED_EXT); inflight.push(active); active = null; }
  const sums = new Map(); // frame -> {total, labels}
  function poll() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (inflight.length) {
      const it = inflight[0];
      if (!gl.getQueryParameter(it.q, gl.QUERY_RESULT_AVAILABLE)) break;
      inflight.shift();
      const ns = gl.getQueryParameter(it.q, gl.QUERY_RESULT); pool.push(it.q);
      if (disjoint) { sums.delete(it.frame); continue; }
      let f = sums.get(it.frame); if (!f) { f = { t: 0, l: prof ? {} : null }; sums.set(it.frame, f); }
      f.t += ns / 1e6; if (f.l) f.l[it.label] = (f.l[it.label] || 0) + ns / 1e6;
    }
    // frames older than every in-flight query are complete
    const oldest = inflight.length ? inflight[0].frame : frameN;
    for (const [fn, f] of sums) if (fn < oldest) {
      push(S.gpu, f.t);
      if (f.l) for (const k in f.l) S.passes[k] = (S.passes[k] || f.l[k]) * 0.95 + f.l[k] * 0.05;
      sums.delete(fn);
    }
    if (inflight.length > 600 || (inflight.length && frameN - inflight[0].frame > 120)) { // driver stopped answering: give up quietly rather than leak
      for (const it of inflight) gl.deleteQuery(it.q); inflight.length = 0; ext = null; S.gpuOK = false;
    }
  }
  // ---- CPU: time spent submitting draws (inside renderer.render), the rest of the frame is update
  let renderMs = 0, inRender = 0;
  const origRender = renderer.render.bind(renderer);
  renderer.render = function (scene, camera) {
    const t0 = performance.now(); inRender++;
    try { origRender(scene, camera); } finally { inRender--; if (!inRender) renderMs += performance.now() - t0; }
  };
  if (prof && ext) {
    const sm = renderer.shadowMap, origShadow = sm.render.bind(sm);
    sm.render = function (...a) {
      const prev = active ? active.label : 'frame';
      if (sm.enabled && (sm.autoUpdate || sm.needsUpdate)) { end(); begin('shadow'); origShadow(...a); end(); begin(prev); } else origShadow(...a);
    };
  }
  let frameT0 = 0, fitN = 0, calTries = 0, lastCal = -1e9; const cal = [];
  const perf = {
    S, prof,
    get gpuOK() { return S.gpuOK; },
    mark(label) { if (prof && active) { end(); begin(label); } },
    frameStart(interval) {
      frameN++; S.frames++;
      if (interval > 0 && interval < 1000) push(S.interval, interval);
      poll();
      renderMs = 0; frameT0 = performance.now();
      begin('scene');
    },
    frameEnd() {
      end();
      const cpu = performance.now() - frameT0;
      push(S.cpu, cpu); push(S.render, renderMs);
      S.calls = renderer.info.render.calls; S.tris = renderer.info.render.triangles;
    },
    // Display refresh. rAF timestamps are vsync-aligned, but a GPU-bound frame spans several vsyncs and
    // 20.8 ms is both 5 x 240 Hz and 3 x 144 Hz, so frame times alone can't tell. Instead the loop skips
    // drawing for ~16 vsyncs (at load under the veil, and again if the cadence stops matching, e.g. the
    // window moved to another screen) and times the bare rAF ticks.
    calibrating: true,
    calibSample(ms) {
      if (ms > 0 && ms < 200) cal.push(ms);
      if (cal.length < 16) return;
      cal.sort((x, y) => x - y);
      const med = cal[cal.length >> 1], hz = 1000 / med;
      const rates = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 360];
      let best = rates[0]; for (const r of rates) if (Math.abs(r - hz) < Math.abs(best - hz)) best = r;
      cal.length = 0; calTries++;
      if (Math.abs(best - hz) / best < 0.06 || calTries > 2) { S.refresh = Math.abs(best - hz) / best < 0.06 ? best : Math.round(hz); perf.calibrating = false; calTries = 0; lastCal = performance.now(); }
    },
    recalibrate() { if (performance.now() - lastCal > 30000) { perf.calibrating = true; cal.length = 0; } },
    // every ~2 s: do recent intervals still sit on whole vsyncs of the refresh we believe in?
    refresh() {
      if (++fitN < 240 || S.interval.n < 120) return S.refresh;
      fitN = 0;
      const q = 1000 / S.refresh; let fit = 0;
      for (let k = 0; k < 120; k++) { const d = S.interval.a[(S.interval.i - 1 - k + RING) % RING], m = Math.round(d / q); if (m >= 1 && Math.abs(d - m * q) < Math.min(1.2, q * 0.2)) fit++; }
      if (fit < 60) perf.recalibrate();
      return S.refresh;
    },
    fps(last = 120) { const m = mean(S.interval, last); return m ? 1000 / m : 0; },
    p(ring, p, last) { return pct(S[ring], p, last); },
    mean(ring, last) { return mean(S[ring], last); },
    memSample() {
      const m = renderer.info.memory, pm = performance.memory;
      const s = { t: Math.round(performance.now() / 1000), geo: m.geometries, tex: m.textures, prog: (renderer.info.programs || []).length, heap: pm ? Math.round(pm.usedJSHeapSize / 1048576) : null };
      S.mem.push(s); if (S.mem.length > 400) S.mem.shift();
      return s;
    },
    snapshot() {
      return {
        fps: +perf.fps(240).toFixed(1), refresh: S.refresh,
        frame: { p50: +pct(S.interval, 0.5, 240).toFixed(2), p90: +pct(S.interval, 0.9, 240).toFixed(2), p99: +pct(S.interval, 0.99, 600).toFixed(2) },
        cpu: { mean: +mean(S.cpu, 240).toFixed(2), p99: +pct(S.cpu, 0.99, 600).toFixed(2), render: +mean(S.render, 240).toFixed(2) },
        gpu: S.gpuOK ? { mean: +mean(S.gpu, 240).toFixed(2), p90: +pct(S.gpu, 0.9, 240).toFixed(2) } : null,
        passes: prof ? Object.fromEntries(Object.entries(S.passes).map(([k, v]) => [k, +v.toFixed(2)])) : undefined,
        calibrating: perf.calibrating, calls: S.calls, tris: S.tris, mem: S.mem[S.mem.length - 1] || perf.memSample(), gpuName: S.gpuName,
      };
    },
  };
  return perf;
}
