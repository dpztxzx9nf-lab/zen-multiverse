# Performance, one line per release

Measured on the build box with `tools/perf-pass.py` (cold load, frame cost at the same three views, download
size, JS heap after the views) and `tools/leak-probe.py` (JS heap over a session, standing on the home planet,
GC before each sample). The box renders with SwiftShader, a CPU rasterizer, so the ms are far slower than any
real phone or PC. Compare releases with each other; don't read them as device numbers. Two passes per preset
(pass 1 cold, pass 2 warm cache); load s is the range. Phone preset 844x390, PC preset 1280x720.
RTX 4060 laptop (real GPU FPS): first read on 0.2.37 from the in-app Performance overlay (Settings, Video, FPS + frame time).
tools/perf-pass.py is not used there (Python is a Store stub, and we don't install things on Brock's laptop).

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
| 0.2.27 | 2026-11-26 | phone | 16.0-21.6 | 32.3 | 1293 / 1378 / 301 | 179 | 43.1 / 43.6, +1.7 MB | about 1 (quiet) |
| 0.2.27 | 2026-11-26 | pc | 24.4-26.2 | 60.2 | 2365 / 2254 / 903 | 316 | (same session) | about 1 (quiet) |
| 0.2.34 | 2026-11-27 | phone | 7.9-9.0 | 35.7 | 538 / 613 / 723 | 234 | not measured | ~6.7 (busy) |
| 0.2.34 | 2026-11-27 | pc | 15.6-17.2 | 50.3 | 1259 / 2027 / 2776 | 301 | not measured | ~6.7 (busy) |
| 0.2.35 | 2026-11-27 | | not re-measured after the HUD and city change | | | | | |
| 0.2.36 | 2026-11-27 | | laptop FPS not measured (overlay was off) | | | | | |
| 0.2.37 | 2026-11-27 | RTX 4060 laptop | 142–160 FPS (6.2–6.8 ms avg); 60 FPS pointer-locked (Smart cap) | | | | | |
| 0.2.38 | 2026-11-27 | RTX 4060 laptop | 160–173 FPS at camp (4.8–5.5 ms avg); 54–60 FPS pointer-locked (Smart cap) | | | | | |
| 0.2.39-hotfix.1 | 2026-11-27 | | pending laptop verify | | | | | |

Notes
- 0.2.17 / 0.2.18: from the side-by-side run in the notes (perf-0218); the box was busy, so the passes vary a lot.
- 0.2.25: perf-pass on its own on a quiet box. Pass 1 (cold) frame times: phone 1338 / 1702 / 365, PC 2375 / 2402 / 1619.
  The downloads grow by 0.2 MB, from the generated server wall shapes (js/solids-data.js, 138 KB) used by the
  animals and placement rules. Renderer object counts stay flat over the session (585 geometries, 267 textures,
  303 programs, 1312 objects). Renderer RSS grows, as in earlier releases (SwiftShader buffers).
- 0.2.26: perf-pass and leak-probe on their own on a quiet box. Same download and heap as 0.2.25 (its change is in the
  desktop updater, not the game). Renderer object counts flat over the session (604 geometries, 267 textures,
  305 programs, 1258 objects); renderer RSS flat this time (1173 MB).
- 0.2.27: same as 0.2.26 within noise (its change is how animals step round obstacles). Object counts flat over the
  session (556 geometries, 265 textures, 298 programs, 1249 objects), renderer RSS flat (1167-1168 MB).

- 0.2.34: world reset (new biomes, caves, ores). The three views on this row are the city plaza (294.21, 222.02), a forest point (181.07, 108.89), and a look at the starter Rattler camp (from 108.29, 50.56 toward 126.3, 68.6), seed 307651, tile 1:1:1 — not the old painted garden used in 0.2.27 and earlier. Pass 1 (cold) frame times: phone 541 / 645 / 936, PC 1274 / 2088 / 2765. JS heap after the views is higher than 0.2.27 because the globe is denser (phone ~746k tris, PC ~1.98M tris). Session heap / leak-probe was not run. The box was busy (~6.7 load), and it still uses SwiftShader, so these ms are not device FPS.
  RTX 4060 laptop: FPS and load time were not read. The Performance overlay was off, and Python is a 0-byte Windows Store stub we do not install over. At the city, the running 0.2.34 app used about 90 MB for the shell and about 729 MB for the largest WebView2 process.
  Real iPhone: not connected, not measured. The "phone" row is the box preset at 844x390 only.
- 0.2.35: leftover Ula greeting and toast removed, leftover Zen Multiverse install cleanup, one sci-fi HUD, shared hotbar, third-person over-the-shoulder by default with a first-person viewmodel only while aiming or toggled, greybox city removed, spawn in a frontier biome. The box pass above was taken on the 0.2.34 world (city still present) during this work and was not re-run after the HUD and city change.
- 0.2.36: small hotfix (hotbar items, M4 held in third person, Character studio only on first run). Box SwiftShader not re-run. RTX 4060 laptop FPS was not measured; the Performance overlay was off during that verify.
- 0.2.37: two-handed third-person M4 hold and a darker space-suit shell so the character does not blow out. Box SwiftShader not re-run. RTX 4060 laptop, installed 0.2.37, windowed 1296×839 (internal 870×544, render scale 100%, frame rate limit Smart, Performance overlay on FPS + frame time), third person on the frontier with the M4 equipped: 142–160 FPS (6.2–6.8 ms avg, 13 ms max, 1043 draws, 740k tris) before the window was clicked; 60 FPS once pointer-locked (4.4–6.3 ms avg, 8–13 ms max). Frame times of 4.4–6.8 ms avg are about 147–227 FPS uncapped. Firing worked (ammo 30/30 down to 25/30).
- 0.2.38: Rattler camp combat, gun loot (parts, makers, rarity, perks), a starter pistol, a wider right-shoulder camera and a darker suit. Box SwiftShader not re-run. RTX 4060 laptop, installed 0.2.38, windowed 1296×839 (render scale 100%, frame rate limit Smart, Performance overlay on FPS + frame time). At a camp, unlocked: 160–173 FPS (4.8–5.5 ms avg, 8–13 ms max, internal 870×544). Pointer-locked walking: 54–60 FPS (4.4 ms avg). Map open: 144 FPS (6.6 ms avg, 13 ms max). Launch before pointer lock, internal 1280×800: 60 FPS, 4.4 ms avg, 12 ms max, 1223 draws, 931k tris.
- 0.2.39-hotfix.1: camp spawn when you load already nearby, pistol in the right hand, thicker camera pull-in, and the map canvas is dropped on Resume. Box SwiftShader not re-run. RTX 4060 laptop FPS will be filled from the in-app Performance overlay after verify; otherwise it will be marked not measured.
