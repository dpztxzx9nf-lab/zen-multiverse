// Game-only styles (injected by gameui.js). Scoped to #hud.zen / #zen-* so mom's garden is untouched.
export const MAKER_CSS = `
#hud .xh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
#hud .xh-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px 8px;border-radius:14px;background:rgba(255,255,255,.06);cursor:pointer;pointer-events:auto;font-size:13px}
#hud .xh-tile.on{background:rgba(255,236,200,.16);box-shadow:inset 0 0 0 1px rgba(255,230,190,.45)}
#hud .xh-pv{height:42px;width:42px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:radial-gradient(circle,#56636a,#2a3236)}
#hud .xh-del{position:absolute;top:2px;right:8px;opacity:.6;font-size:16px}
#hud .xh-maker{display:grid;grid-template-columns:150px 1fr;gap:14px;align-items:start}
#hud .xh-preview{display:flex;flex-direction:column;gap:8px;align-items:center}
#hud .xh-big{width:140px;height:84px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#9fb8c4 0%,#c9d6cf 52%,#5f7556 53%,#3f5240 100%)}
#hud .xh-big svg{transform:scale(1.6)}
#hud .xh-big.hot svg{transform:scale(1.95);filter:drop-shadow(0 0 3px rgba(255,226,170,.85))}
#hud .xh-row{display:flex;align-items:center;gap:10px;margin:6px 0;pointer-events:auto}
#hud .xh-row>span:first-child{width:84px;opacity:.75;font-size:13px}
#hud .xh-row input[type=range]{flex:1;accent-color:#e9d2a8}
#hud .xh-row .v{width:34px;text-align:right;opacity:.7;font-variant-numeric:tabular-nums;font-size:13px}
#hud .xh-shapes{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
#hud .pill{pointer-events:auto;cursor:pointer;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.08);font-size:13px;text-transform:capitalize}
#hud .pill.on{background:rgba(255,236,200,.22);box-shadow:inset 0 0 0 1px rgba(255,230,190,.5)}
#hud .sw-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#hud .swatch{width:18px;height:18px;border-radius:50%;cursor:pointer;pointer-events:auto;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
#hud .swatch.on{box-shadow:0 0 0 2px #f4e3c2}
#hud input[type=color]{width:26px;height:22px;border:0;padding:0;background:none;pointer-events:auto}
#hud .xh-code{flex:1;font:13px ui-monospace,Menlo,monospace;color:#f4f1ea;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:7px 9px;pointer-events:auto;user-select:text;-webkit-user-select:text}
#hud button.b.ghost{background:rgba(255,255,255,.12);color:#f4f1ea}
@media (max-width:560px){#hud .xh-maker{grid-template-columns:1fr}}
`;
