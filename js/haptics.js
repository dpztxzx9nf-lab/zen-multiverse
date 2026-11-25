// One soft tick for tending taps. Android: navigator.vibrate. iPhone Safari has no vibrate, but a real
// tap that toggles a native <input type=checkbox switch> plays a system tick (iOS 17.4+). iOS 26.5+
// ignores scripted clicks, so on iPhone an invisible switch lies over the canvas and takes her real
// finger; input listeners go on surface(). tick() during the tap arms it; the switch's click then
// toggles (tick) or is cancelled (no tick), so only water, prune, collect, chomp and stones tick.
const N = typeof navigator !== 'undefined' ? navigator : {};
const VIB = typeof N.vibrate === 'function';
const IOS = !VIB && (/iP(hone|ad|od)/.test(N.userAgent || '') || (N.platform === 'MacIntel' && N.maxTouchPoints > 1));
let sw = null, armed = -1e9;

export function surface(canvas) {
  if (!IOS) return canvas;
  if (sw) return sw;
  sw = document.createElement('input');
  sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.setAttribute('aria-hidden', 'true'); sw.tabIndex = -1;
  sw.id = 'haptic-surface';
  sw.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;-webkit-appearance:switch;appearance:auto;opacity:0;touch-action:none;outline:none;-webkit-tap-highlight-color:transparent';
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    if (performance.now() - armed > 1500) e.preventDefault();
    armed = -1e9;
    sw.blur();
  }, true);
  canvas.after(sw);
  return sw;
}

export function tick(ms = 10) {
  if (VIB) { try { N.vibrate(ms); } catch (e) { /* optional */ } } else armed = performance.now();
}
export const hapticsMode = VIB ? 'vibrate' : IOS ? 'ios-switch' : 'none';
