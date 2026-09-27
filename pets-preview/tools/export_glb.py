"""Export the Planner Designer pets (pets.py) to compact, animatable .glb files.

Usage:  python export_glb.py [out_dir] [animal,animal,...|all]
Needs the bpy module and pets.py in the same folder. Does not modify pets.py:
it imports it, lowers segment counts, records which helper created each object,
then groups/joins the parts into separately named nodes:

  pet_<animal>                  root (extras: animal, baseColor, bellyColor)
    body        pivot at the bottom of the body  -> body_mesh, belly [, wings]
    foot_L/R    pivot at foot centre              -> foot_L_mesh / foot_R_mesh
    arm_L/R     pivot at shoulder                 -> arm_L_mesh / arm_R_mesh
    tail        pivot where the tail meets body   -> tail_mesh           (if any)
    head        pivot at the neck                 -> head_mesh, ears, eyes_open,
                eyes_happy, eyes_sleepy, cheeks, mouth, mouth_open, hat_anchor
  (_L = the pet's own left = +X in Blender. glTF is Y-up; the pet faces +Z.)

Materials: 'base' = the animal's main colour, 'belly' = belly/face patch colour
(re-tint these at runtime); everything else is named c_<hex>.
eyes_happy, eyes_sleepy and mouth_open are alternates: hide them by default.
"""
import bpy, sys, os, math, functools
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pets

OUT = sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'models'))
WHICH = (sys.argv[2] if len(sys.argv) > 2 else 'all')
os.makedirs(OUT, exist_ok=True)

COLS = {  # (base, belly/face patch) as used in pets.build
    'dog': ('#f2b66d', '#fff1dc'), 'cat': ('#b9a6ec', '#fbf5ff'), 'bunny': ('#fdeaf1', '#ffe3ec'),
    'penguin': ('#3d5a9e', '#ffffff'), 'horse': ('#f7c9a0', '#fde7d3'), 'monkey': ('#a8704a', '#ffd9b0'),
    'tiger': ('#ff9a3c', '#fff6ea'), 'shark': ('#5fa8e8', '#f4fbff'), 'pig': ('#ffb3c6', '#ffd1dd'),
    'axolotl': ('#ffb0d4', '#ffe0ee'), 'capybara': ('#c88f5a', '#e2b183'), 'dragon': ('#6fd6a6', '#fff0a8'),
}

# ---------- lighter geometry (same shapes, fewer segments) ----------
def sphere(loc, scale, mat, rot=None):
    m = max(scale)
    seg, ring = (48, 24) if m >= 0.3 else (24, 12) if m >= 0.1 else (12, 6)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=loc)
    o = bpy.context.active_object; o.scale = scale
    if rot is not None: o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    return pets.finish(o, mat)
pets.sphere = sphere

_orig_cyl = pets.cyl
def cyl(loc, r, depth, mat, rot=None, verts=48, scale=(1, 1, 1)):
    return _orig_cyl(loc, r, depth, mat, rot, verts=24, scale=scale)
pets.cyl = cyl

_orig_curve = pets.curve
def curve(points, bevel, mat, taper_end=None):
    o = _orig_curve(points, bevel, mat, taper_end)
    o.data.bevel_resolution = 2; o.data.resolution_u = 6
    return o
pets.curve = curve

_orig_M = pets.M
def M(hexcol, rough=0.45, coat=0.25, emit=0.0):
    m = _orig_M(hexcol, rough, coat, emit)
    m['key'] = repr((hexcol.lower(), rough, coat, emit))
    return m
pets.M = M
pets.BLACK = lambda: M('#1d1a2b', rough=0.08, coat=1.0)
pets.WHITE_EMIT = lambda: M('#ffffff', rough=0.2, coat=0, emit=2.5)

# ---------- record which helper made each object ----------
TAGS = []; REC = []
_orig_attach = pets.attach
def attach(o, parent=None):
    REC.append((o, TAGS[-1] if TAGS else None))
    return o
pets.attach = attach

def tagged(fn, tag):
    @functools.wraps(fn)
    def w(*a, **k):
        TAGS.append(tag)
        try: return fn(*a, **k)
        finally: TAGS.pop()
    return w
for fname, tag in (('base_body', 'base_body'), ('head', 'head'), ('ears_round', 'ears'), ('ears_pointy', 'ears'),
                   ('eyes', 'eyes'), ('blush', 'cheeks'), ('mouth', 'mouth'), ('tail_curve', 'tail')):
    setattr(pets, fname, tagged(getattr(pets, fname), tag))

def center(o):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(pts, Vector()) / 8

def mat_key(o):
    ms = o.data.materials if hasattr(o.data, 'materials') else []
    return eval(ms[0]['key']) if ms and 'key' in ms[0] else None

def build(name, eye='open', mth=None):
    REC.clear(); pets.PARENT[0] = None
    pets.build(name, eye=eye, mth=mth)
    return list(REC)

def classify(name, rec):
    """-> list of (obj, group) ; group is the joined-mesh name."""
    out = []; bb = [o for o, t in rec if t == 'base_body']
    has_belly = len(bb) == 6
    roles = ['body_mesh'] + (['belly'] if has_belly else []) + ['foot_R_mesh', 'arm_R_mesh', 'foot_L_mesh', 'arm_L_mesh']
    for o, r in zip(bb, roles): out.append((o, r))
    simple = {'head': 'head_mesh', 'ears': 'ears', 'eyes': 'eyes_open', 'cheeks': 'cheeks', 'mouth': 'mouth', 'tail': 'tail_mesh'}
    for o, t in rec:
        if t == 'base_body': continue
        if t in simple: out.append((o, simple[t])); continue
        c = center(o); k = mat_key(o); hexc = k[0] if k else ''
        if name == 'shark' and hexc == '#ffffff': g = 'mouth'            # little teeth
        elif name == 'bunny' and hexc == '#ffe3ec': g = 'belly'
        elif name == 'dragon' and hexc == '#b18cff' and abs(c.x) > 0.3 and c.z < 1.4 and c.y > 0.3 and c.z > 0.8: g = 'wings'
        elif c.z < 1.0 and c.y > 0.35: g = 'tail_mesh'
        elif c.z >= 1.05: g = 'head_mesh'
        else: g = 'body_mesh'
        out.append((o, g))
    return out

PARENT_OF = {'body_mesh': 'body', 'belly': 'body', 'wings': 'body', 'foot_L_mesh': 'foot_L', 'foot_R_mesh': 'foot_R',
             'arm_L_mesh': 'arm_L', 'arm_R_mesh': 'arm_R', 'tail_mesh': 'tail'}  # everything else -> head
PIVOT = {'body': (0, 0, 0.10), 'foot_L': (0.23, -0.12, 0.1), 'foot_R': (-0.23, -0.12, 0.1),
         'arm_L': (0.38, -0.04, 0.86), 'arm_R': (-0.38, -0.04, 0.86), 'tail': (0, 0.42, 0.45), 'head': (0, 0, 1.0)}

def to_mesh(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')          # applies subsurf/bevel, curves -> mesh
    return [o for o in bpy.context.selected_objects]

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name; o.data.name = name
    return o

def set_origin(o, p):
    bpy.context.scene.cursor.location = p
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

def export(name):
    bpy.ops.wm.read_factory_settings(use_empty=True); pets._mats.clear()
    main = classify(name, build(name))
    extra = []
    for eye_style, grp in (('happy', 'eyes_happy'), ('sleepy', 'eyes_sleepy')):
        rec = build(name, eye=eye_style)
        extra += [(o, grp) for o, t in rec if t == 'eyes']
        bpy.data.batch_remove([o for o, t in rec if t != 'eyes'])
    rec = build(name, mth='open')
    extra += [(o, 'mouth_open') for o, t in rec if t == 'mouth']
    bpy.data.batch_remove([o for o, t in rec if t != 'mouth'])
    groups = {}
    for o, g in main + extra: groups.setdefault(g, []).append(o)

    base, belly = COLS[name]
    for m in bpy.data.materials:
        k = eval(m['key']) if 'key' in m else None
        if not k: continue
        if k == (base, 0.45, 0.25, 0.0): m.name = 'base'
        elif k == (belly, 0.45, 0.25, 0.0): m.name = 'belly'
        else: m.name = 'c_' + k[0].lstrip('#') + ('_glow' if k[3] else '') + ('' if k[1] == 0.45 else f'_r{int(k[1]*100)}')

    root = bpy.data.objects.new('pet_' + name, None); bpy.context.collection.objects.link(root)
    root['animal'] = name; root['baseColor'] = base; root['bellyColor'] = belly
    empties = {}
    for pname, p in PIVOT.items():
        if pname == 'tail' and 'tail_mesh' not in groups: continue
        e = bpy.data.objects.new(pname, None); bpy.context.collection.objects.link(e)
        e.location = p; e.parent = root; empties[pname] = e
    head = empties['head']
    ha = bpy.data.objects.new('hat_anchor', None); bpy.context.collection.objects.link(ha)
    top = pets.HEAD.z + (0.56 if name == 'capybara' else pets.HS.z)
    ha.location = (0, 0, top - 1.0); ha.parent = head
    bpy.context.view_layer.update()

    for g, objs in groups.items():
        objs = to_mesh(objs)
        o = join(objs, g)
        par = empties[PARENT_OF.get(g, 'head')]
        if g in PIVOT or g.endswith('_mesh') and g[:-5] in PIVOT:
            piv = Vector(PIVOT[g[:-5]])
        else:  # eyes/cheeks/mouth/ears/belly: pivot at own centre (for blink scale etc.)
            piv = center(o)
        set_origin(o, piv)
        bpy.context.view_layer.update()
        wm = o.matrix_world.copy(); o.parent = par; o.matrix_world = wm
        for poly in o.data.polygons: poly.use_smooth = True
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_texcoords=False, export_normals=True,
                              export_apply=True, export_extras=True, export_yup=True, export_animations=False,
                              export_cameras=False, export_lights=False, export_materials='EXPORT')
    return path

if __name__ == '__main__':
    names = pets.ANIMALS if WHICH == 'all' else WHICH.split(',')
    for n in names:
        p = export(n); print('EXPORTED', p, os.path.getsize(p))
