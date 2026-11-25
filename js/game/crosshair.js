// Crosshair: a quiet focal point at the centre of her view (game only).
//   spec = { shape: dot|cross|circle|t|none, size, thick, gap, color, opacity, outline, dot }
// svg(spec) draws it; encode/decode give a short share code (like 'ZEN1-c.6.2.3.f4f1ea.85.1.0').
export const PRESETS = {
  dot: { name: 'Dot', shape: 'dot', size: 5, thick: 1, gap: 0, color: '#f4f1ea', opacity: 0.8, outline: 1, dot: false },
  cross: { name: 'Cross', shape: 'cross', size: 6, thick: 2, gap: 3, color: '#f4f1ea', opacity: 0.85, outline: 1, dot: false },
  circle: { name: 'Ensō', shape: 'circle', size: 9, thick: 1.5, gap: 0, color: '#f4f1ea', opacity: 0.75, outline: 1, dot: true },
  t: { name: 'T', shape: 't', size: 6, thick: 2, gap: 3, color: '#f4f1ea', opacity: 0.85, outline: 1, dot: false },
  none: { name: 'None', shape: 'none', size: 5, thick: 1, gap: 0, color: '#f4f1ea', opacity: 0.8, outline: 0, dot: false },
};
export const SHAPES = ['dot', 'cross', 'circle', 't', 'none'];
const LIM = { size: [1, 24], thick: [0.5, 6], gap: [0, 14], opacity: [0.1, 1], outline: [0, 3] };
const clamp = (v, [a, b]) => Math.min(b, Math.max(a, +v || 0));
export function clean(s) {
  const p = { ...PRESETS.dot, name: undefined, ...(s || {}) };
  const o = { shape: SHAPES.includes(p.shape) ? p.shape : 'dot', color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : '#f4f1ea', dot: !!p.dot };
  for (const k of Object.keys(LIM)) o[k] = Math.round(clamp(p[k], LIM[k]) * 100) / 100;
  if (p.name) o.name = String(p.name).slice(0, 24);
  return o;
}
export function svg(spec, px = null) {
  const s = clean(spec);
  const ext = s.gap + s.size + s.thick + s.outline + 2;
  const W = Math.ceil(ext * 2), c = W / 2;
  const lines = [];
  const arm = (dx, dy) => lines.push([c + dx * s.gap, c + dy * s.gap, c + dx * (s.gap + s.size), c + dy * (s.gap + s.size)]);
  let body = '';
  const draw = (stroke, extra) => {
    let g = '';
    const sw = s.thick + extra * 2;
    for (const [x1, y1, x2, y2] of lines) g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${extra ? 'round' : 'butt'}"/>`;
    if (s.shape === 'dot') g += `<circle cx="${c}" cy="${c}" r="${s.size / 2 + extra}" fill="${stroke}"/>`;
    if (s.shape === 'circle') g += `<circle cx="${c}" cy="${c}" r="${s.size}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (s.dot && s.shape !== 'dot') g += `<circle cx="${c}" cy="${c}" r="${Math.max(0.8, s.thick * 0.75) + extra}" fill="${stroke}"/>`;
    return g;
  };
  if (s.shape === 'cross' || s.shape === 't') { arm(-1, 0); arm(1, 0); arm(0, 1); if (s.shape === 'cross') arm(0, -1); }
  if (s.outline > 0) body += `<g opacity="0.55">${draw('#0b0e10', s.outline)}</g>`;
  body += draw(s.color, 0);
  const sz = px ? `width="${px}" height="${px}"` : `width="${W}" height="${W}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" ${sz} style="opacity:${s.opacity};overflow:visible">${body}</svg>`;
}
const SH = { dot: 'd', cross: 'c', circle: 'o', t: 't', none: 'n' };
export function encode(spec) {
  const s = clean(spec);
  return `ZEN1-${SH[s.shape]}.${s.size}.${s.thick}.${s.gap}.${s.color.slice(1)}.${Math.round(s.opacity * 100)}.${s.outline}.${s.dot ? 1 : 0}`;
}
export function decode(code) {
  const m = String(code || '').trim().match(/^ZEN1-([dcotn])\.([\d.]+)\.([\d.]+)\.([\d.]+)\.([0-9a-fA-F]{6})\.(\d{1,3})\.([\d.]+)\.([01])$/);
  if (!m) return null;
  const shape = Object.keys(SH).find((k) => SH[k] === m[1]);
  return clean({ shape, size: +m[2], thick: +m[3], gap: +m[4], color: '#' + m[5], opacity: +m[6] / 100, outline: +m[7], dot: m[8] === '1' });
}
// the spec for the chosen id: a preset name, or 'custom:<index>'
export function resolve(id, customs = []) {
  if (PRESETS[id]) return clean(PRESETS[id]);
  const m = /^custom:(\d+)$/.exec(id || ''); if (m && customs[+m[1]]) return clean(customs[+m[1]]);
  return clean(PRESETS.dot);
}
