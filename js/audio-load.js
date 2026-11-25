// Lazy-load compressed game audio. Prefers Opus (.ogg); falls back to AAC (.m4a) on iOS
// and anything else that cannot decode Opus. Manifest: assets/audio/manifest.json.
export function preferredExt() {
  try {
    const a = document.createElement('audio');
    if (a.canPlayType('audio/ogg; codecs=opus') || a.canPlayType('audio/webm; codecs=opus')) return '.ogg';
  } catch (e) { /* */ }
  return '.m4a';
}

export function createLoader(base = './assets/audio/') {
  let man = null, ext = null;
  const cache = new Map(); // url -> Promise<AudioBuffer>
  function href(file) { return base + file + (ext || (ext = preferredExt())); }
  async function manifest() {
    if (man) return man;
    const r = await fetch(base + 'manifest.json');
    if (!r.ok) throw new Error('audio manifest ' + r.status);
    man = await r.json();
    ext = preferredExt();
    return man;
  }
  function decode(ctx, file) {
    const u = href(file);
    if (cache.has(u)) return cache.get(u);
    const p = fetch(u).then((r) => {
      if (!r.ok) throw new Error('audio ' + u + ' ' + r.status);
      return r.arrayBuffer();
    }).then((b) => {
      // decodeAudioData may take a callback on older webkit; always copy the buffer
      const copy = b.slice(0);
      return new Promise((res, rej) => {
        const ok = (buf) => res(buf);
        const err = (e) => rej(e || new Error('decode ' + u));
        try {
          const ret = ctx.decodeAudioData(copy, ok, err);
          if (ret && typeof ret.then === 'function') ret.then(ok, err);
        } catch (e) { err(e); }
      });
    });
    cache.set(u, p);
    p.catch(() => cache.delete(u));
    return p;
  }
  function rec(kind, id) {
    if (!man) return null;
    return (man[kind] && man[kind][id]) || man.sfx?.[id] || man.amb?.[id] || man.music?.[id] || null;
  }
  // cached buffer only (no fetch). used so a footstep can synth this time and play a sample next time
  function peek(kind, id) {
    const r = rec(kind, id); if (!r || !ext) return null;
    const p = cache.get(href(r.file));
    return p && p.settled ? p.settled : null;
  }
  async function get(ctx, kind, id) {
    await manifest();
    const r = rec(kind, id); if (!r) return null;
    const buf = await decode(ctx, r.file);
    const packed = { buf, ...r };
    const u = href(r.file);
    const p = cache.get(u); if (p) p.settled = packed.buf;
    return packed;
  }
  function warmup(ctx, kind, ids) {
    return Promise.all(ids.map((id) => get(ctx, kind, id).catch(() => null)));
  }
  return { manifest, get, peek, decode, warmup, preferredExt, rec: () => man };
}
