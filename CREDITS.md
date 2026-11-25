# Credits
- Earth day map: "Whole world - land and oceans" (NASA Visible Earth / Blue Marble), public domain, via Wikimedia Commons.
- Earth city lights: "Earthlights dmsp" (NASA/NOAA DMSP), public domain, via Wikimedia Commons.
- Moon map: "Moon texture" (NASA LRO / SVS), public domain, via Wikimedia Commons.
- Three.js (MIT), vendored in /vendor.

## Realism pass (CC0, Poly Haven — https://polyhaven.com, no attribution required, credited anyway)
- Ground scans (assets/pbr): moon_dusted_02, moon_01, rock_boulder_dry, dark_rock, forest_ground_04, coast_sand_01,
  dry_ground_01, snow_02, cracked_red_ground, grass_ground, farm_soil, sand_01, bark_brown_02, gravel_floor.
- Models (assets/models, decimated and re-baked in Blender): moon_rock_02/04/05.
- Habitat, greenhouse and antenna modelled in Blender for this project (after ESA Moon Village and the
  University of Arizona / NASA lunar greenhouse prototype).

Planet plants and rocks (Poly Haven, CC0, reduced to two LODs in Blender): Quiver Tree 01 and 02, Dead Quiver Trunk, Fern 02,
Othonna cerarioides, Crystalline Iceplant, Cheiridopsis Succulent, Shrub 03, Wild Rooibos Bush, Namaqualand Boulder 04 and 05, Rock Moss Set 01.
Planet creatures: made for this game in Blender (creatures_build.py), no third-party assets.

Garden, realism round 2 (Poly Haven, CC0):
- HDRI skies (photo sky + lighting): Kloofendal 48d Partly Cloudy (Pure Sky), Rustig Koppie (Pure Sky), Table Mountain 1 (Pure Sky),
  Qwantani Sunset (Pure Sky), Qwantani Dusk 2 (Pure Sky).
- Rocks: Rock Moss Set 02, Namaqualand Boulder 02 and 03, Namaqualand Stones 01, Stone 01.
- Trees (rebuilt as leaf cards with two LODs in Blender): Jacaranda Tree (garden maples), Island Tree 02 (pruned niwaki), Fir Sapling Medium (backdrop conifers).

Garden, realism round 3 (Poly Haven textures, CC0): Clay Plaster (wall), Japanese Stone Wall (wall footing), Gravelly Sand (raked-sand grain),
Rock Boulder Dry and Dark Rock reused for the stone kerb and kawara tiles. Bamboo and clipped azaleas are procedural (no third-party assets).
- Lightmaps: bounce and AO baked in Blender (Cycles) from the unclamped Kloofendal 48d Pure Sky HDRI; atlases in assets/lightmap.
- N8AO (N8AOPass, MIT) by n8python, vendored in /vendor/n8ao, used with three.js EffectComposer on PC.
- Rapier 3D physics (@dimforge/rapier3d-compat, Apache-2.0) by Dimforge, vendored in /vendor/rapier, lazy-loaded on PC.

Planet forests (Poly Haven models, CC0, rebuilt as leaf cards with two LODs in Blender, plus runtime impostors): Fir Tree 01, Island Tree 01.

## Audio

Original music stems (D-major pentatonic pads, koto-like plucks, shakuhachi-like tones,
handpan modes) and the garden's generative bed are made for this game. No third-party
music samples. Files live in `assets/audio/` as Opus with an AAC fallback; they are
lazy-loaded and not precached. Full notes: the project's `audio-credits` log.

Footsteps, CC0:
- Fantozzi — grass/sand and stone steps, via [OpenGameArt](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone), originally [Freesound pack 10338](https://freesound.org/people/Fantozzi/packs/10338/).
- TinyWorlds — wood, gravel and leaf steps, via [OpenGameArt](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud).
- qubodup (Iwan Gabovitch) — wet snow steps, [CC0](https://opengameart.org/content/9-wet-snow-steps).
- Thimras — metal footsteps on concrete, [CC0](https://opengameart.org/content/metal-footsteps-on-concrete).

Weather, CC0:
- Ylmir — [loopable rain](https://opengameart.org/content/rain-loopable).
- WuxiaScrub — [rain + long thunder](https://opengameart.org/content/rain-long-thunder).

Pond water, wind loops, impact/break hits, UI plucks, creature calls and the rocket
rumble are original (procedural or short synthesized files).

