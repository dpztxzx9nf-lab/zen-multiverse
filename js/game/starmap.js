// The star / universe map is retired: Xenia is one globe.
import { rng } from './names.js';

export function openStarMap({ onClose = null } = {}) {
  if (typeof onClose === 'function') try { onClose(); } catch (e) { /* */ }
  return null;
}

// a calm warp: the stars stretch into soft streaks and fade to white-blue
export function warpFx(ms = 2200) {
  const c = document.createElement('canvas'); c.id = 'warpfx'; document.body.appendChild(c);
  const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const R = rng(9), st = Array.from({ length: 260 }, () => ({ a: R() * 6.283, d: R() * 0.2 + 0.02, s: R() * 0.6 + 0.4 }));
  const t0 = performance.now();
  requestAnimationFrame(() => (c.style.opacity = 1));
  return new Promise((res) => {
    function f() {
      const t = (performance.now() - t0) / ms, W = c.width, H = c.height, M = Math.max(W, H);
      ctx.fillStyle = `rgba(6,8,22,${0.35})`; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,220,255,.8)'; ctx.lineCap = 'round';
      for (const s of st) {
        s.d += s.s * 0.012 * (0.4 + t * 3);
        const r0 = s.d * M, r1 = r0 * (1 + 0.08 + t * 0.5);
        ctx.lineWidth = 1 + t * 2; ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(s.a) * r0, H / 2 + Math.sin(s.a) * r0); ctx.lineTo(W / 2 + Math.cos(s.a) * r1, H / 2 + Math.sin(s.a) * r1); ctx.stroke();
        if (s.d > 0.9) s.d = 0.02;
      }
      if (t > 0.7) { ctx.fillStyle = `rgba(225,235,255,${(t - 0.7) / 0.3})`; ctx.fillRect(0, 0, W, H); }
      if (t < 1) requestAnimationFrame(f); else { res(); setTimeout(() => { c.style.opacity = 0; setTimeout(() => c.remove(), 700); }, 400); }
    }
    f();
  });
}
