# Performance, one line per release

Measured on the build box with `tools/perf-pass.py` (cold load, frame cost at the same three views, download
size, JS heap after the views) and `tools/leak-probe.py` (JS heap over a session, standing on the home planet,
GC before each sample). The box renders with SwiftShader, a CPU rasterizer, so the ms are far slower than any
real phone or PC. Compare releases with each other; don't read them as device numbers. Two passes per preset
(pass 1 cold, pass 2 warm cache); load s is the range. Phone preset 844x390, PC preset 1280x720.
The RTX 4060 laptop isn't measured: Python isn't installed there.

| version | date (MT) | preset | load s | download MB | garden / trees / camp ms per frame (pass 2) | heap after views MB | session heap (f0 / f300, growth per 1000 f) | box load |
|---|---|---|---|---|---|---|---|---|
| 0.2.17 | 2026-11-26 | phone | 17.4-30.8 | 32.1 | 1499 / 1549 / 294 | 177 | 42.8 / 43.8, +3.3 MB | 12-14 (busy) |
| 0.2.17 | 2026-11-26 | pc | 21.7-29.0 | 59.9 | 2058 / 2471 / 720 | 313 | (same session) | 12-14 (busy) |
| 0.2.18 | 2026-11-26 | phone | 19.4-28.0 | 32.1 | 1317 / 1413 / 310 | 177 | 42.8 / 43.2, +1.3 MB | 12-14 (busy) |
| 0.2.18 | 2026-11-26 | pc | 21.0-30.5 | 60.0 | 2196 / 2546 / 962 | 313 | (same session) | 12-14 (busy) |
| 0.2.19 | | | not measured | | | | | |
| 0.2.20 | | | not measured | | | | | |
| 0.2.21 | | | not measured | | | | | |
| 0.2.22 | | | not measured | | | | | |
| 0.2.23 | | | not measured | | | | | |
| 0.2.24 | | | not measured | | | | | |
| 0.2.25 | 2026-11-26 | phone | 23.5-28.4 | 32.3 | 1682 / 2987 / 475 | 178 | 43.9 / 44.5, +2.0 MB | under 1 (quiet) |
| 0.2.25 | 2026-11-26 | pc | 24.8-27.4 | 60.2 | 2036 / 2269 / 737 | 316 | (same session) | under 1 (quiet) |
| 0.2.26 | 2026-11-26 | phone | 19.5-23.0 | 32.3 | 1332 / 1338 / 286 | 178 | 43.5 / 44.6, +3.7 MB | about 1 (quiet) |
| 0.2.26 | 2026-11-26 | pc | 23.2-24.9 | 60.2 | 1967 / 2050 / 704 | 314 | (same session) | about 1 (quiet) |

Notes
- 0.2.17 / 0.2.18: from the side-by-side run in the notes (perf-0218); the box was busy, so the passes vary a lot.
- 0.2.25: perf-pass on its own on a quiet box. Pass 1 (cold) frame times: phone 1338 / 1702 / 365, PC 2375 / 2402 / 1619.
  The downloads grow by 0.2 MB, from the generated server wall shapes (js/solids-data.js, 138 KB) used by the
  animals and placement rules. Renderer object counts stay flat over the session (585 geometries, 267 textures,
  303 programs, 1312 objects). Renderer RSS grows, as in earlier releases (SwiftShader buffers).
- 0.2.26: perf-pass and leak-probe on their own on a quiet box. Same download and heap as 0.2.25 (its change is in the
  desktop updater, not the game). Renderer object counts flat over the session (604 geometries, 267 textures,
  305 programs, 1258 objects); renderer RSS flat this time (1173 MB).
