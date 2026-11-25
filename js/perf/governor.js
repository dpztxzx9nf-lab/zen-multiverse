// Adaptive quality governor. One ladder of levels, cheapest-looking cuts first. Presets pin a level;
// Auto walks the ladder from frame times (and GPU time when the browser can measure it), with
// hysteresis: quick to step down, slow and probing to step back up, and backs off from levels that
// failed before. Worlds apply what they can through world.applyQuality(Q); pixel ratio is the engine's.
//
//   Q = { level, pr, ao: 2 full | 1 half | 0 off, bloom: 1 | 0.5 | 0, rays, refl (0 off .. 1),
//         shadow (map size scale 1 | 0.5 | 0.25), foliage (0..1), lod (planet flora budget cap) }
export const LADDER = [
  // measured on an RTX 4060 laptop at 2544x1305 (Earth, game): half-res AO costs ~1.2 ms less than full;
  // AO off is NOT cheaper on PC (the scene then needs 4x MSAA, which costs more than AO), so AO stays to
  // the last rung; resolution is the big lever, with a sharpen pass so lower rungs stay crisp.
  { pr: 1.00, ao: 2, bloom: 1, rays: 1, refl: 1, shadow: 1, foliage: 1.0, lod: 1.15 }, // 0 ultra: the tier's full look
  { pr: 1.00, ao: 1, bloom: 1, rays: 1, refl: 1, shadow: 1, foliage: 1.0, lod: 1.1 }, // 1
  { pr: 0.90, ao: 1, bloom: 1, rays: 1, refl: 1, shadow: 1, foliage: 1.0, lod: 1.0 }, // 2 high
  { pr: 0.85, ao: 1, bloom: 1, rays: 1, refl: 1, shadow: 1, foliage: 0.9, lod: 0.95 }, // 3
  { pr: 0.80, ao: 1, bloom: 0.5, rays: 1, refl: 1, shadow: 1, foliage: 0.85, lod: 0.9 }, // 4 medium
  { pr: 0.75, ao: 1, bloom: 0.5, rays: 0, refl: 1, shadow: 1, foliage: 0.8, lod: 0.85 }, // 5
  { pr: 0.72, ao: 1, bloom: 0.5, rays: 0, refl: 0, shadow: 1, foliage: 0.75, lod: 0.75 }, // 6
  { pr: 0.68, ao: 1, bloom: 0.5, rays: 0, refl: 0, shadow: 0.5, foliage: 0.6, lod: 0.65 }, // 7
  { pr: 0.62, ao: 1, bloom: 0, rays: 0, refl: 0, shadow: 0.5, foliage: 0.55, lod: 0.6 }, // 8 low
  { pr: 0.55, ao: 0, bloom: 0, rays: 0, refl: 0, shadow: 0.25, foliage: 0.45, lod: 0.5 }, // 9
];
export const PRESETS = { ultra: 0, high: 2, medium: 4, low: 8 };
// chasing frames beyond 60 never goes uglier than this; only falling under 60 may go further
const FLOOR_ABOVE_60 = 7;

export function createGovernor({ perf, onApply, start = 0, params }) {
  let preset = 'auto';
  let level = start, applied = -1;
  let winT = 0, winN = 0, winSum = 0, cool = 4, stableT = 0, probe = null;
  const block = new Float64Array(LADDER.length); const backoff = new Float32Array(LADDER.length).fill(15);
  let clock = 0, goal = 60, cpuBound = false;
  const pinned = params && params.has('noadapt');
  function apply(force) {
    if (!force && applied === level) return;
    applied = level; onApply({ level, preset, ...LADDER[level] });
  }
  function step(d, why) {
    const nl = Math.max(0, Math.min(LADDER.length - 1, level + d));
    if (nl === level) return false;
    level = nl; apply(); gov.last = { t: +clock.toFixed(1), level, why }; gov.history.push(gov.last); if (gov.history.length > 40) gov.history.shift();
    winT = 0; winN = 0; winSum = 0; cool = d > 0 ? 0.8 : 1.2; stableT = 0;
    return true;
  }
  const gov = {
    history: [], last: null,
    get level() { return level; }, get preset() { return preset; }, get goal() { return goal; }, get cpuBound() { return cpuBound; },
    setPreset(p) {
      preset = PRESETS[p] != null || p === 'auto' ? p : 'auto';
      if (preset !== 'auto') level = PRESETS[preset];
      probe = null; block.fill(0); apply(true);
    },
    reapply() { apply(true); },
    // tests: pin one rung of the ladder
    setLevel(l) { preset = 'manual'; level = Math.max(0, Math.min(LADDER.length - 1, l | 0)); probe = null; apply(true); },
    // a world switch or load hitch: forget the current window
    settle(s = 2) { winT = 0; winN = 0; winSum = 0; cool = Math.max(cool, s); probe = null; },
    // dt in seconds (raw interval), target fps for this frame
    update(raw, target) {
      clock += raw; goal = target;
      if (preset !== 'auto' || pinned) return;
      if (raw > 0.25) return; // a hitch (tab switch, load), not a steady cost
      if (cool > 0) { cool -= raw; return; }
      winT += raw; winN++; winSum += raw;
      if (winT < 0.75 || winN < 12) return;
      const fps = winN / winSum; winT = 0; winN = 0; winSum = 0;
      if (fps <= 8) return; // software renderer (headless tests): leave the look alone
      const budget = 1000 / target;
      const gpu = perf.gpuOK ? perf.mean('gpu', 60) : 0, cpu = perf.mean('cpu', 60);
      // CPU-bound frames don't get faster by blurring the picture; only drop if the GPU is the wall too
      cpuBound = cpu > budget * 0.85 && (!perf.gpuOK || gpu < budget * 0.7);
      const floor = fps < Math.min(60, target) * 0.92 ? LADDER.length - 1 : FLOOR_ABOVE_60;
      const t60 = Math.min(60, target);
      if (probe && fps < probe.need) { // the step up did not hold: go back and stay away a while
        const failed = level; step(1, 'probe failed'); block[failed] = clock + backoff[failed]; backoff[failed] = Math.min(240, backoff[failed] * 2); probe = null; return;
      }
      if (fps < target * 0.9 && !cpuBound && level < floor) { step(fps < target * 0.6 && level + 2 <= floor ? 2 : 1, `fps ${fps.toFixed(0)}<${target}`); probe = null; return; }
      // room to look better: at the goal, or (deep below the 60-floor) comfortably over 60 again
      const atGoal = fps >= target * 0.96, deep = level > FLOOR_ABOVE_60 && fps >= t60 * 1.12;
      if (atGoal || deep) {
        stableT += 0.75;
        if (probe && stableT > 2.5) { backoff[level] = 15; probe = null; }
        const up = level - 1;
        // the timer query spans queue waits too (ANGLE/D3D11): a reading above the frame budget at full
        // speed is not busy time, so it can't veto a probe
        const roomy = !perf.gpuOK || gpu < budget * 0.72 || gpu > budget * 1.05 || deep;
        if (!probe && up >= 0 && stableT > 4 && clock > block[up] && roomy) { step(-1, `steady ${fps.toFixed(0)}`); probe = { t: clock, need: atGoal ? target * 0.9 : t60 * 0.95 }; }
      } else stableT = 0;
    },
    Q() { return { level, preset, ...LADDER[level] }; },
  };
  apply(true);
  return gov;
}
