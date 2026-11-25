// Debug FPS counter (?fps=1, or the settings toggle through __perf.setOverlay(true)).
// Updates 4x a second with textContent only, so it costs nothing measurable. Tap it to list errors.
import { errors, errorCount } from './errlog.js';
export function createOverlay(perf, getState) {
  let el = null, timer = 0, open = false;
  function build() {
    el = document.createElement('div');
    el.id = 'zm-fps';
    el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e9f0e4;background:rgba(10,14,12,.62);padding:4px 7px;border-radius:6px;white-space:pre;pointer-events:auto;max-width:96vw;max-height:80vh;overflow:auto;user-select:text';
    el.addEventListener('click', () => { open = !open; draw(); });
    document.body.appendChild(el);
  }
  function draw() {
    if (!el) return;
    const s = perf.snapshot(), g = getState();
    const m = s.mem || {};
    let t = `${s.fps.toFixed(0)} fps / ${s.refresh} Hz  goal ${g.goal}${g.cap ? ' cap ' + g.cap : ''}${g.throttle ? ' · ' + g.throttle : ''}\n` +
      `frame p50 ${s.frame.p50} p99 ${s.frame.p99} ms\n` +
      `cpu ${s.cpu.mean} (draw ${s.cpu.render}) p99 ${s.cpu.p99}${s.gpu ? `  gpu ${s.gpu.mean} p90 ${s.gpu.p90}` : '  gpu n/a'}\n` +
      `${s.calls} calls  ${(s.tris / 1e6).toFixed(2)}M tris  pr ${g.pr.toFixed(2)}\n` +
      `quality ${g.preset} L${g.level}${g.cpuBound ? ' cpu-bound' : ''}  geo ${m.geo} tex ${m.tex} prog ${m.prog}${m.heap != null ? ` heap ${m.heap}MB` : ''}  err ${errorCount()}`;
    if (s.passes) t += '\n' + Object.entries(s.passes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k} ${v}`).join('\n');
    if (open) t += '\n— errors —\n' + (errors().slice(-12).map((e) => `${e.t.slice(11, 19)} ${e.kind}${e.n ? ' x' + e.n : ''}: ${e.msg}`).join('\n') || '(none)');
    el.textContent = t;
  }
  return {
    set(on) {
      if (on && !el) { build(); timer = setInterval(draw, 250); }
      else if (!on && el) { clearInterval(timer); el.remove(); el = null; }
    },
    get on() { return !!el; },
  };
}
