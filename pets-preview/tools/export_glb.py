"""Export the Dayli pets (pets.py) to compact, animatable .glb files.

Usage: blender --background --python export_glb.py -- <out_dir> [animal,animal,...|all]

Does not modify pets.py. It imports it, builds each animal, voxel-remeshes the
parts that are meant to be one smooth volume, and groups the rest onto the rig:

  pet_<animal>                  root (extras: animal, baseColor, bellyColor, eyeSpread, eyeScale)
    body        pivot near the ground     -> body_mesh, belly, wing_L, wing_R
    foot_L/R    pivot at the foot         -> foot_L_mesh / foot_R_mesh
    arm_L/R     pivot at the shoulder     -> arm_L_mesh / arm_R_mesh
    tail        pivot where it meets body -> tail_mesh
    head        pivot at the neck         -> head_mesh, ears, eyes_*, cheeks, mouth*, hat_anchor, ...

(_L = the pet's own left = +X in Blender. glTF is Y-up; the pet faces +Z.)
"""
import bpy, sys, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pets

def cli():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    out = args[0] if args else os.path.join(HERE, '..', 'models')
    which = args[1] if len(args) > 1 else 'all'
    return out, which

OUT, WHICH = cli()
os.makedirs(OUT, exist_ok=True)

COLS = {
    'dog': ('#f2b66d', '#fff1dc'), 'cat': ('#b9a6ec', '#fbf5ff'), 'bunny': ('#fdeaf1', '#ffe3ec'),
    'penguin': ('#3d5a9e', '#ffffff'), 'horse': ('#f7c9a0', '#fde7d3'), 'monkey': ('#a8704a', '#ffd9b0'),
    'tiger': ('#ff9a3c', '#fff6ea'), 'shark': ('#5fa8e8', '#f4fbff'), 'pig': ('#ffb3c6', '#ffd1dd'),
    'axolotl': ('#ffb0d4', '#ffe0ee'), 'capybara': ('#c88f5a', '#e2b183'), 'dragon': ('#6fd6a6', '#fff0a8'),
}

VOXEL = {
    'body': 0.03, 'head': 0.026, 'tail': 0.032, 'mane': 0.032,
    'wing_L': 0.032, 'wing_R': 0.032, 'muzzle': 0.024,
    'arm_L': 0.026, 'arm_R': 0.026, 'foot_L': 0.026, 'foot_R': 0.026,
}
FACE_CAP = {
    'body': 7000, 'head': 9000, 'tail': 2800, 'mane': 2200,
    'wing_L': 2200, 'wing_R': 2200, 'muzzle': 2800,
    'arm_L': 1800, 'arm_R': 1800, 'foot_L': 1800, 'foot_R': 1800,
}
BODY_PARTS = {'body', 'belly', 'wing_L', 'wing_R'}
LIMB_PARTS = {'arm_L', 'arm_R', 'foot_L', 'foot_R', 'tail'}
MESH_NAME = {
    'body': 'body_mesh', 'tail': 'tail_mesh',
    'arm_L': 'arm_L_mesh', 'arm_R': 'arm_R_mesh', 'foot_L': 'foot_L_mesh', 'foot_R': 'foot_R_mesh',
    'eyes': 'eyes_open', 'head': 'head_mesh',
}

# ---------- lighter source meshes; remesh rebuilds the silhouette ----------
def sphere(loc, scale, mat, rot=None):
    m = max(scale)
    seg, ring = (40, 20) if m >= 0.25 else (28, 14) if m >= 0.08 else (12, 6)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    if rot is not None:
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = rot
    return pets.finish(o, mat)
pets.sphere = sphere

_tube = pets.tube
def tube(points, bevel, mat, handles='AUTO'):
    o = _tube(points, bevel, mat, handles)
    if hasattr(o.data, 'bevel_resolution'):
        o.data.bevel_resolution = 4
        o.data.resolution_u = 8
    return o
pets.tube = tube
pets.curve = lambda points, bevel, mat, taper_end=None: tube(points, bevel, mat, 'AUTO')

def attach(o, parent=None):
    return o
pets.attach = attach

_orig_M = pets.M
def M(hexcol, rough=0.34, coat=0.55, emit=0.0):
    m = _orig_M(hexcol, rough, coat, emit)
    m['key'] = repr((hexcol.lower(), float(rough), float(coat), float(emit)))
    return m
pets.M = M
pets.BLACK = lambda: M('#1d1a2b', rough=0.08, coat=1.0)

def mat_key(o):
    mats = getattr(o.data, 'materials', None)
    if mats and 'key' in mats[0]:
        return mats[0]['key']
    return None

def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='OBJECT')

def shade(o):
    if o.type != 'MESH':
        return
    for poly in o.data.polygons:
        poly.use_smooth = True

def to_mesh_one(o):
    activate(o)
    if o.type != 'MESH' or len(o.modifiers):
        bpy.ops.object.convert(target='MESH')
        o = bpy.context.view_layer.objects.active
    shade(o)
    return o

def join(objs, name):
    objs = [o for o in objs if o is not None and o.name in bpy.data.objects]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name
    o.data.name = name
    shade(o)
    return o

def remesh(o, voxel):
    activate(o)
    before = len(o.data.vertices)
    bpy.ops.object.duplicate()
    dup = bpy.context.view_layer.objects.active
    mod = dup.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except RuntimeError as exc:
        print('remesh failed', exc)
        bpy.data.objects.remove(dup, do_unlink=True)
        return o
    if len(dup.data.vertices) < max(30, before * 0.05):
        bpy.data.objects.remove(dup, do_unlink=True)
        return o
    sm = dup.modifiers.new('smooth', 'SMOOTH')
    sm.iterations = 5
    sm.factor = 0.4
    bpy.ops.object.modifier_apply(modifier=sm.name)
    shade(dup)
    dup['part'] = o.get('part', '')
    bpy.data.objects.remove(o, do_unlink=True)
    return dup

def limit_faces(o, cap):
    if o is None or o.type != 'MESH':
        return o
    n = len(o.data.polygons)
    if n <= cap:
        return o
    activate(o)
    dec = o.modifiers.new('dec', 'DECIMATE')
    dec.ratio = max(0.15, min(1.0, cap / float(n)))
    bpy.ops.object.modifier_apply(modifier=dec.name)
    shade(o)
    return o

def fuse_part(objs, part):
    meshes = []
    for o in objs:
        meshes.append(to_mesh_one(o))
    buckets = {}
    order = []
    keep = []
    for o in meshes:
        fuse = bool(o.get('fuse', True))
        if fuse:
            key = mat_key(o) or o.name
            if key not in buckets:
                order.append(key)
                buckets[key] = []
            buckets[key].append(o)
        else:
            keep.append(o)
    fused = []
    voxel = VOXEL.get(part, 0.042)
    for key in order:
        group = buckets[key]
        if len(group) < 2:
            fused.extend(group)
            continue
        joined = join(group, 'fuse_' + part)
        fused.append(remesh(joined, voxel))
    merged = join(fused + keep, MESH_NAME.get(part, part))
    return limit_faces(merged, FACE_CAP.get(part, 2200))

def snapshot():
    return {o.name for o in bpy.data.objects}

def fresh(before):
    return [o for o in bpy.data.objects if o.name not in before and o.get('part')]

def parent_keep(child, parent):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world

def bounds_center(o):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(corner) for corner in o.bound_box]
    return sum(pts, Vector()) / 8

def set_origin(o, point):
    bpy.context.scene.cursor.location = point
    activate(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

# Face nodes are hidden and reused as anchors for the cartoon eyes and mouth.
ANCHORS = {'eyes', 'eyes_happy', 'eyes_sleepy', 'mouth', 'mouth_open', 'cheeks'}

def rename_materials(name):
    base, belly = COLS[name]
    for m in list(bpy.data.materials):
        if 'key' not in m:
            continue
        hexcol, rough, coat, emit = eval(m['key'])
        plain = abs(rough - 0.34) < 1e-6 and abs(coat - 0.55) < 1e-6 and not emit
        if plain and hexcol == base:
            m.name = 'base'
        elif plain and hexcol == belly:
            m.name = 'belly'
        else:
            suffix = ''
            if emit:
                suffix += '_glow'
            if abs(rough - 0.45) > 1e-6:
                suffix += f'_r{int(round(rough * 100))}'
            m.name = 'c_' + hexcol.lstrip('#') + suffix

def export(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pets._mats.clear()
    pets.build(name)
    rig = dict(pets.RIG)
    main = [o for o in bpy.data.objects if o.get('part')]
    groups = {}
    for o in main:
        groups.setdefault(o['part'], []).append(o)

    def adopt(eye=None, mouth=None, label=None):
        before = snapshot()
        pets.build(name, eye=eye or 'open', mth=mouth, only='eyes' if eye else 'mouth')
        for o in fresh(before):
            if o.get('part') in ('eyes', 'mouth'):
                groups.setdefault(label, []).append(o)

    adopt(eye='happy', label='eyes_happy')
    adopt(eye='sleepy', label='eyes_sleepy')
    adopt(mouth='open', label='mouth_open')
    rename_materials(name)

    root = bpy.data.objects.new('pet_' + name, None)
    bpy.context.collection.objects.link(root)
    root['animal'] = name
    root['baseColor'] = COLS[name][0]
    root['bellyColor'] = COLS[name][1]
    root['eyeSpread'] = float(rig.get('spread', 0.19))
    root['eyeScale'] = float(rig.get('eye_scale', 1.0))

    pivots = {
        'body': (0.0, 0.0, 0.10),
        'head': tuple(rig['neck']),
        'arm_L': tuple(rig['shoulder_L']),
        'arm_R': tuple(rig['shoulder_R']),
        'foot_L': tuple(rig['foot_L']),
        'foot_R': tuple(rig['foot_R']),
    }
    if rig.get('tail') and 'tail' in groups:
        pivots['tail'] = tuple(rig['tail'])
    empties = {}
    for pname, loc in pivots.items():
        e = bpy.data.objects.new(pname, None)
        bpy.context.collection.objects.link(e)
        e.location = loc
        e.parent = root
        empties[pname] = e
    head = empties['head']
    hat = bpy.data.objects.new('hat_anchor', None)
    bpy.context.collection.objects.link(hat)
    hat.location = tuple(rig['hat'])
    parent_keep(hat, head)

    made = []
    for part, objs in groups.items():
        mesh = fuse_part(objs, part)
        if mesh is None:
            continue
        if part in LIMB_PARTS:
            parent = empties.get(part)
        elif part in BODY_PARTS:
            parent = empties['body']
        else:
            parent = head
        if parent is None:
            continue
        if part in ANCHORS:
            set_origin(mesh, bounds_center(mesh))
        parent_keep(mesh, parent)
        made.append(mesh)
        print(f'  {mesh.name}: {len(mesh.data.polygons)} faces')

    # Drop anything that was not parented into the rig (alternate leftovers).
    keep = {root, hat, *empties.values(), *made}
    for o in list(bpy.data.objects):
        if o not in keep and o.parent not in keep:
            bpy.data.objects.remove(o, do_unlink=True)

    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_texcoords=False, export_normals=True,
        export_apply=True, export_extras=True, export_yup=True, export_animations=False,
        export_cameras=False, export_lights=False, export_materials='EXPORT')
    return path

if __name__ == '__main__':
    names = pets.ANIMALS if WHICH == 'all' else [n.strip() for n in WHICH.split(',') if n.strip()]
    for n in names:
        p = export(n)
        print('EXPORTED', p, os.path.getsize(p))
