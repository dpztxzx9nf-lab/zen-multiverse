# lodkit: one glTF in -> glTF LOD0/1/2 out, headless.  Free: Blender 4.5 LTS only, no add-ons, no API keys.
# Patterned on the bpy calls mcp-for-blender (github.com/ahujasid/mcp-for-blender) sends to Blender, but run
# directly with `blender -b` (no MCP server, no third-party service).
#
#   blender -b --python lodkit.py -- IN.glb OUT_PREFIX [options]
# options:
#   --lods 1,0.35,0.12     per-LOD keep ratio (<= 1) or a triangle target (> 1); LOD0 = first entry
#   --mode collapse        collapse (quadric, default) | planar (flat areas, angle --planar-deg) | remesh (voxel, --voxel m)
#   --uv keep              keep (default) | smart (Smart UV Project, new UVs) | none (drop UVs)
#   --bake none            none | ao  (Cycles CPU AO bake into a --bake-size PNG per LOD, wired as occlusion)
#   --bake-size 1024 --samples 32
#   --normals keep         keep | drop (positions only, e.g. when the game recomputes normals)
#   --weld 0               merge vertices closer than this (metres) before decimating
# Writes OUT_PREFIX_lod0.glb, _lod1.glb, _lod2.glb (+ _lodN_ao.png) and prints a JSON summary line "LODKIT {...}".
import bpy, sys, os, json, math

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, PREFIX = argv[0], argv[1]
opt = {'lods': '1,0.35,0.12', 'mode': 'collapse', 'uv': 'keep', 'bake': 'none', 'bake-size': '1024', 'samples': '32',
       'normals': 'keep', 'weld': '0', 'planar-deg': '5', 'voxel': '0.05'}
i = 2
while i < len(argv):
    k = argv[i].lstrip('-'); opt[k] = argv[i + 1]; i += 2
LODS = [float(x) for x in opt['lods'].split(',')]

def tris(objs): return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
src = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not src: raise SystemExit('no meshes in ' + SRC)
T0 = tris(src)
os.makedirs(os.path.dirname(os.path.abspath(PREFIX)), exist_ok=True)
summary = {'src': SRC, 'tris_in': T0, 'lods': []}

def make_lod(li, keep):
    objs = []
    for o in src:
        c = o.copy(); c.data = o.data.copy(); c.name = f'{o.name}_lod{li}'; bpy.context.collection.objects.link(c); objs.append(c)
    w = float(opt['weld'])
    for o in objs:
        if w > 0:
            select_only([o]); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=w); bpy.ops.object.mode_set(mode='OBJECT')
        # a triangle target is shared across the meshes in proportion to their size
        ratio = keep if keep <= 1 else min(1.0, keep / max(1, T0))
        if opt['mode'] == 'remesh' and li > 0:
            m = o.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = float(opt['voxel']) * (1 / max(ratio, 0.05)) ** 0.5
            select_only([o]); bpy.ops.object.modifier_apply(modifier='rm')
        elif ratio < 0.999:
            m = o.modifiers.new('dec', 'DECIMATE')
            if opt['mode'] == 'planar': m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(float(opt['planar-deg']) / max(ratio, 0.05))
            else: m.decimate_type = 'COLLAPSE'; m.ratio = max(0.002, ratio); m.use_collapse_triangulate = True
            select_only([o]); bpy.ops.object.modifier_apply(modifier='dec')
        if opt['uv'] == 'smart':
            select_only([o]); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02); bpy.ops.object.mode_set(mode='OBJECT')
        elif opt['uv'] == 'none':
            while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
    ao = None
    if opt['bake'] == 'ao':
        ao = bake_ao(objs, li)
    return objs, ao

def bake_ao(objs, li):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(opt['samples'])
    size = int(opt['bake-size']); img = bpy.data.images.new(f'ao{li}', size, size); img.generated_color = (1, 1, 1, 1)
    for o in objs:
        if not o.data.uv_layers:
            select_only([o]); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02); bpy.ops.object.mode_set(mode='OBJECT')
        for ms in o.material_slots:
            if not ms.material: continue
            ms.material.use_nodes = True; nt = ms.material.node_tree
            n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; n.name = 'AOBAKE'; nt.nodes.active = n
    select_only(objs)
    bpy.ops.object.bake(type='AO', margin=4, use_clear=True)
    path = f'{PREFIX}_lod{li}_ao.png'; img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    # wire as glTF occlusion (the exporter reads a glTF Material Output group's Occlusion socket)
    for o in objs:
        for ms in o.material_slots:
            m = ms.material
            if not m: continue
            nt = m.node_tree; n = nt.nodes.get('AOBAKE')
            g = bpy.data.node_groups.get('glTF Material Output') or make_gltf_group()
            gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g
            sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(n.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    return path

def make_gltf_group():
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return g

for li, keep in enumerate(LODS):
    objs, ao = make_lod(li, keep)
    select_only(objs)
    out = f'{PREFIX}_lod{li}.glb'
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_normals=opt['normals'] == 'keep',
                              export_texcoords=opt['uv'] != 'none', export_apply=True, export_yup=True)
    summary['lods'].append({'file': out, 'tris': tris(objs), 'ao': ao})
    for o in objs: bpy.data.objects.remove(o, do_unlink=True)
print('LODKIT ' + json.dumps(summary))
