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

// ---- the game's own look: ink on rice paper, river stones, a brush stroke for what is chosen.
const brush = (c = '%23eadcbf') => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 12' preserveAspectRatio='none'%3E%3Cpath d='M3 7.5C18 4 44 4.5 66 6.2S104 9 117 5.2' stroke='${c}' stroke-width='3.4' fill='none' stroke-linecap='round' opacity='.9'/%3E%3Cpath d='M10 8.6C30 6.8 58 7.4 90 8.2' stroke='${c}' stroke-width='1.2' fill='none' stroke-linecap='round' opacity='.45'/%3E%3C/svg%3E")`;
const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 .94 0 0 0 0 .84 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;
export const CAIRN = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" opacity=".85"><ellipse cx="12" cy="19.5" rx="8" ry="2.6"/><ellipse cx="12.4" cy="14.3" rx="5.6" ry="2.2"/><ellipse cx="11.8" cy="9.9" rx="3.7" ry="1.8"/><ellipse cx="12.2" cy="6.3" rx="2.1" ry="1.3"/></svg>`;
export const ZEN_CSS = `
#hud.zen{--paper:#efe6d2;--ink:#141816;--moss:#a9c49a;--seal:#c8553d;--glass:rgba(20,23,21,.62);--line:rgba(236,222,196,.17);
 --serif:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;color:var(--paper);font-size:calc(15px * var(--ts,1))}
#hud.zen .glass{background:${grain},linear-gradient(162deg,rgba(34,37,33,.66),rgba(14,17,17,.74));border:1px solid var(--line);
 border-radius:30px 24px 32px 26px / 26px 32px 24px 30px;box-shadow:0 18px 50px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,246,226,.07)}
#hud.zen #hud-top{gap:6px;opacity:.55}
#hud.zen #hud-top .btn{width:40px;height:36px;border-radius:52% 48% 46% 54% / 58% 50% 50% 42%;background:rgba(22,25,23,.34);box-shadow:inset 0 1px 0 rgba(255,246,226,.1),0 2px 8px rgba(0,0,0,.25);color:var(--paper)}
#hud.zen #hud-top .btn:nth-child(2){border-radius:46% 54% 56% 44% / 50% 44% 56% 50%}
#hud.zen #hud-top .btn:nth-child(3){border-radius:56% 44% 50% 50% / 44% 56% 44% 56%}
#hud.zen #hud-panel{width:min(620px,94vw);height:min(600px,82vh)}
#hud.zen #hud-panel .tabs{padding:16px 16px 8px;gap:2px;align-items:center;border-bottom:1px solid rgba(236,222,196,.08)}
#hud.zen #hud-panel .tabs::before{content:"";width:22px;height:22px;margin:0 8px 0 4px;flex:none;opacity:.8;background:var(--cairn) center/contain no-repeat}
#hud.zen #hud-panel .tab{border-radius:0;padding:8px 10px 10px;opacity:.6;font-family:var(--serif);font-size:15px;letter-spacing:.02em;background:none!important}
#hud.zen #hud-panel .tab svg{display:none}
#hud.zen #hud-panel .tab.on{opacity:1;background:${brush()} center bottom/88% 9px no-repeat!important}
#hud.zen #hud-panel .x{width:34px;height:34px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(236,222,196,.45);clip-path:polygon(0 0,100% 0,100% 72%,78% 100%,0 100%)}
#hud.zen #hud-panel h3{font-family:var(--serif);font-weight:400;text-transform:none;letter-spacing:.03em;font-size:15px;opacity:.8;margin:18px 0 10px;display:flex;align-items:center;gap:10px}
#hud.zen #hud-panel h3::after{content:"";flex:1;height:8px;background:${brush('%23eadcbf')} left center/100% 8px no-repeat;opacity:.25}
#hud.zen #hud-panel .item,#hud.zen #hud-panel .row,#hud.zen #hud-panel .set,#hud.zen .xh-tile{background:rgba(239,230,210,.055);border-radius:18px 14px 20px 15px / 15px 20px 14px 18px;box-shadow:inset 0 1px 0 rgba(255,246,226,.05)}
#hud.zen #hud-panel .item .ic{background:rgba(0,0,0,.25);border-radius:52% 48% 46% 54% / 58% 50% 50% 42%}
#hud.zen #hud-panel .item .n{opacity:1;min-width:24px;height:22px;padding:0 6px;border-radius:7px;background:rgba(200,85,61,.22);color:#f6d9cf;font-size:12px;display:flex;align-items:center;justify-content:center}
#hud.zen #hud-panel .next{font-family:var(--serif);font-size:16px;opacity:.92;padding:2px 0 8px 14px;border-left:2px solid rgba(169,196,154,.55)}
#hud.zen #hud-panel button.b{background:var(--paper);color:var(--ink);border-radius:16px 13px 17px 12px / 12px 17px 13px 16px;font-family:var(--serif);font-size:15px;padding:7px 16px}
#hud.zen #hud-panel button.b.ghost{background:rgba(239,230,210,.1);color:var(--paper);box-shadow:inset 0 0 0 1px rgba(236,222,196,.2)}
#hud.zen #hud-msg .t{font-family:var(--serif);font-size:calc(18px * var(--ts,1));letter-spacing:.01em;padding:0 14px 10px;background:${brush('%23efe6d2')} center bottom/70% 7px no-repeat;
 text-shadow:0 1px 2px rgba(0,0,0,.65),0 0 18px rgba(0,0,0,.45)}
#hud.zen #hud-dialog{border-radius:26px 20px 28px 22px / 22px 28px 20px 26px;padding:18px 22px 16px 26px}
#hud.zen #hud-dialog .who{font-family:var(--serif);text-transform:none;letter-spacing:.04em;font-size:14px;opacity:.9;display:flex;align-items:center;gap:8px}
#hud.zen #hud-dialog .who::before{content:"";width:10px;height:10px;border-radius:2px;background:var(--seal);transform:rotate(8deg);opacity:.85}
#hud.zen #hud-dialog .txt{font-family:var(--serif);font-size:calc(17px * var(--ts,1));line-height:1.45}
#hud.zen #hud-word{font-family:var(--serif);text-transform:none;font-size:calc(15px * var(--ts,1));letter-spacing:.03em}
#hud.zen #hud-word .k{font-family:ui-sans-serif,system-ui,sans-serif;font-size:10px;padding:1px 5px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(236,222,196,.45);opacity:.7}
#hud.zen #hud-tool{font-family:var(--serif);text-transform:none;font-size:14px}
#hud.zen #hud-joy{border:1.5px solid rgba(236,222,196,.3);border-radius:48% 52% 50% 50% / 52% 48% 52% 48%}
#hud.zen #hud-joy .knob{background:rgba(236,222,196,.2);border-color:rgba(236,222,196,.45);border-radius:52% 48% 46% 54% / 58% 50% 50% 42%}
#hud.zen #hud-saved{color:var(--moss)}
`;
