# Asset pipeline (offline, free tools, no API keys)

Run heavy jobs one at a time. None of this ships in the app (copy-dist.mjs bundles only the web files).

| Tool | Get it | License |
|---|---|---|
| Blender 4.5 LTS (portable tarball) | blender.org Linux tarball, run `blender -b` | GPL (tool only, output is ours) |
| Real-ESRGAN ncnn-vulkan v0.2.5.0 (+ mesa lavapipe for CPU Vulkan) | GitHub release zip; set `REALESRGAN` to the binary | BSD-3-Clause |
| Impeccable (UI critique guidance + detector) | github.com/pbakaus/impeccable | Apache-2.0 |
| KTX-Software (`ktx`, `toktx`) | `/usr/bin` | Apache-2.0 |

## lodkit.py (Blender, headless)
Decimate, UV, optionally bake AO, export glTF LOD0/1/2. bpy calls follow the patterns in
ahujasid/mcp-for-blender, but it runs plain `blender -b`: no MCP server, no hosted model.

    blender -b --python lodkit.py -- IN.glb OUT_PREFIX [--lods 1,0.35,0.12] [--mode collapse|planar|remesh]
        [--uv keep|smart|none] [--bake none|ao] [--bake-size 1024] [--samples 32] [--normals keep|drop]

Writes `OUT_PREFIX_lod{0,1,2}.glb` and prints `LODKIT {json}` with triangle counts.
A value <= 1 in `--lods` is a keep ratio; > 1 is a triangle target.

## front_range_glb.py
Turns `assets/terrain/front-range-<tier>.bin` into a grid glb (same maths as js/mountains.js) for lodkit:

    python3 -P front_range_glb.py REPO OUT.glb pc
    blender -b --python lodkit.py -- OUT.glb front-range --lods 1,0.3,0.12 --normals drop --uv none

LOD1 -> `assets/terrain/front-range-lod1.glb` (PC), LOD2 -> `front-range-lod2.glb` (phones).

## finalize-glb.mjs
Blender exports are big (PNG/JPEG): `node finalize-glb.mjs in.glb out.glb [1024]` (dedup, prune, WebP, meshopt),
then the KTX2 `.k.glb` as usual.

## upscale_space.py (Real-ESRGAN)
Only for textures that look blurry when seen large (Earth day map, Moon map). x4plus model, Lanczos down to the
target size, flipped, KTX2 ETC1S sRGB, added to `assets/ktx2.json`. Not for normal/ARM maps, lightmaps or sky photos.

    python3 -P upscale_space.py REPO

## decode-glb.mjs
Game GLBs are meshopt-compressed and Blender's importer can't read them. lodkit.py runs this first automatically
(`node decode-glb.mjs in.glb out.glb`; needs @gltf-transform/core, extensions, functions and meshoptimizer installed).
If the input already carries LODs (`*_lod1`, `*_lod2` meshes), lodkit starts from its LOD0 only.
Checked on moonrock_a: 1199 -> 419 -> 143 tris, smart UVs, 512 px AO per LOD wired as the glTF occlusion map.
