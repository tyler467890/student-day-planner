"""Procedural 3D vinyl-toy pets for Dayli. Run with Blender (bpy).

Each animal is a bipedal toy with its own body proportions and the features
that make the silhouette readable at phone size. Objects are tagged with a
`part` custom property so export_glb.py can join them onto the animation rig:

  body, belly, wing_L, wing_R  -> body
  arm_L/R, foot_L/R, tail      -> those pivots
  head and everything else     -> head

`fuse` True marks same-material pieces that should be voxel-remeshed into one
smooth volume (head + ears, body + fins). Curls, whiskers, stripes and other
thin details stay fuse False so they keep their shape.

Usage: blender --background --python pets.py -- <name|all|emotes|lineup> [samples]
"""
import bpy, math, sys
from mathutils import Vector

OUT = "/workspace/pet-avatars"
BG = (246, 242, 252)

def hexlin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple((x/12.92) if x <= 0.04045 else ((x+0.055)/1.055)**2.4 for x in c)

_mats = {}
def M(hexcol, rough=0.34, coat=0.55, emit=0.0):
    key = (hexcol, rough, coat, emit)
    if key in _mats: return _mats[key]
    m = bpy.data.materials.new(hexcol); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*hexlin(hexcol), 1)
    b.inputs["Roughness"].default_value = rough
    try:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.25
    except KeyError: pass
    if emit:
        b.inputs["Emission Color"].default_value = (*hexlin(hexcol), 1)
        b.inputs["Emission Strength"].default_value = emit
    _mats[key] = m; return m

PARENT = [None]
PART = ['accent']
FUSE = [True]
ONLY = [None]
STYLE = {'eye': 'open', 'mouth': None, 'arms': 'down'}
RIG = {}

def tag(o):
    o['part'] = PART[0] or 'accent'
    o['fuse'] = bool(FUSE[0])
    return o

def use_part(name, fuse=True):
    PART[0] = name
    FUSE[0] = fuse

def attach(o, parent=None):
    tag(o)
    p = parent or PARENT[0]
    if p is not None:
        bpy.context.view_layer.update()
        o.parent = p
        o.matrix_parent_inverse = p.matrix_world.inverted()
    return o

def finish(o, mat, subsurf=0, smooth=True):
    if smooth and o.type == 'MESH':
        for poly in o.data.polygons: poly.use_smooth = True
    if mat is not None and (not o.data.materials or o.data.materials[-1] != mat):
        o.data.materials.append(mat)
    if subsurf:
        s = o.modifiers.new("s", 'SUBSURF'); s.levels = subsurf; s.render_levels = subsurf
    tag(o)
    return attach(o)

def quat_to(d, axis='Z', up='Y'):
    return Vector(d).normalized().to_track_quat(axis, up)

def sphere(loc, scale, mat, rot=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=loc)
    o = bpy.context.active_object; o.scale = scale
    if rot is not None: o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    return finish(o, mat)

def cone(loc, r1, r2, depth, mat, rot=None, verts=24, subsurf=0, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object; o.scale = scale
    if rot is not None: o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    return finish(o, mat, subsurf)

def cyl(loc, r, depth, mat, rot=None, verts=48, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    o = bpy.context.active_object; o.scale = scale
    if rot is not None: o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    bev = o.modifiers.new("b", 'BEVEL'); bev.width = min(r, depth)*0.35; bev.segments = 4
    return finish(o, mat)

def curve(points, bevel, mat, taper_end=None):
    return tube(points, bevel, mat, 'AUTO')

def tube(points, bevel, mat, handles='AUTO'):
    cu = bpy.data.curves.new("c", 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = bevel; cu.bevel_resolution = 4; cu.use_fill_caps = True
    cu.resolution_u = 8
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = Vector(p); bp.handle_left_type = bp.handle_right_type = handles
    o = bpy.data.objects.new("curve", cu); bpy.context.collection.objects.link(o)
    cu.materials.append(mat)
    tag(o)
    return attach(o)

def text(s, loc, size, mat, rot=(math.radians(90), 0, 0)):
    cu = bpy.data.curves.new("t", 'FONT'); cu.body = s; cu.size = size
    cu.extrude = 0.03; cu.bevel_depth = 0.012; cu.align_x = 'CENTER'
    o = bpy.data.objects.new("text", cu); bpy.context.collection.objects.link(o)
    o.location = loc; o.rotation_euler = rot; cu.materials.append(mat)
    return attach(o)

def star(loc, r, mat, depth=0.35):
    verts = [(0, -depth*r, 0), (0, depth*r, 0)]
    for i in range(10):
        a = math.pi/2 + i*math.pi/5; rr = r if i % 2 == 0 else r*0.45
        verts.append((rr*math.cos(a), 0, rr*math.sin(a)))
    faces = []
    for i in range(10):
        a, b = 2 + i, 2 + (i+1) % 10
        faces.append((0, b, a)); faces.append((1, a, b))
    me = bpy.data.meshes.new("star"); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new("star", me); bpy.context.collection.objects.link(o); o.location = loc
    bev = o.modifiers.new("b", 'BEVEL'); bev.width = r*0.08; bev.segments = 3
    return finish(o, mat, smooth=False)

def empty(loc=(0, 0, 0)):
    o = bpy.data.objects.new("root", None); bpy.context.collection.objects.link(o)
    o.location = loc; return o

def torus(loc, major, minor, mat, rot=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=28, minor_segments=12, location=loc)
    o = bpy.context.active_object
    if rot is not None:
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    return finish(o, mat)

def softbox(loc, size, mat, bevel=0.1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    b = o.modifiers.new('b', 'BEVEL')
    b.width = bevel
    b.segments = 4
    return finish(o, mat)

# Kept so older notes and the hat fallback still have a head size to read.
HEAD = Vector((0, 0, 1.5)); HS = Vector((0.58, 0.52, 0.54))
BODY = Vector((0, 0, 0.62)); BS = Vector((0.48, 0.44, 0.46))

BLACK = lambda: M('#1d1a2b', rough=0.08, coat=1.0)
NOSE = lambda hexcol='#3a2a28': M(hexcol, rough=0.32, coat=0.45)
PINK = lambda hexcol='#ffb7c8': M(hexcol, rough=0.5, coat=0.15)

def begin(animal, **kw):
    """Store rig/face anchors. Return False when only a face alternate is needed."""
    RIG.clear()
    shoulder = kw.pop('shoulder')
    foot = kw.pop('foot')
    RIG['animal'] = animal
    RIG['shoulder_L'] = shoulder
    RIG['shoulder_R'] = (-shoulder[0], shoulder[1], shoulder[2])
    RIG['foot_L'] = foot
    RIG['foot_R'] = (-foot[0], foot[1], foot[2])
    RIG.update(kw)
    if ONLY[0] in ('eyes', 'mouth', 'cheeks'):
        place_face(ONLY[0])
        return False
    return True

def place_face(kind):
    eye = STYLE['eye']
    mouth = STYLE['mouth'] or RIG.get('mouth_kind', 'smile')
    if kind == 'eyes':
        use_part('eyes', False)
        p = Vector(RIG['eye']); spread = RIG['spread']
        for sgn in (-1, 1):
            loc = p + Vector((spread * sgn, 0, 0))
            if eye == 'open':
                sphere(loc, (0.05, 0.032, 0.06), BLACK())
            else:
                pts = []
                for i in range(7):
                    t = -1 + 2 * i / 6
                    lift = 0.035 * (1 - t * t) if eye == 'happy' else -0.028 * (1 - t * t)
                    pts.append(loc + Vector((t * 0.07, -0.02, lift)))
                tube(pts, 0.012, BLACK(), 'AUTO')
        return
    if kind == 'mouth':
        use_part('mouth', False)
        mp = Vector(RIG['mouth'])
        w = RIG.get('mouth_w', 0.12)
        bow = RIG.get('mouth_bow', 0.04)
        if mouth in ('open', 'o'):
            sphere(mp, (0.07, 0.04, 0.05), M('#5a1e32', rough=0.4))
            sphere(mp + Vector((0, -0.015, -0.025)), (0.04, 0.025, 0.02), M('#ff7d9a', rough=0.5))
        elif mouth in ('w', 'cat'):
            pts = []
            for i in range(9):
                t = -1 + 2 * i / 8
                pts.append(mp + Vector((t * w, -0.012, -bow * abs(math.sin(t * math.pi)))))
            tube(pts, 0.012, BLACK(), 'AUTO')
        else:
            pts = []
            for i in range(9):
                t = -1 + 2 * i / 8
                pts.append(mp + Vector((t * w, -0.012, -bow * (1 - t * t))))
            tube(pts, 0.014, BLACK(), 'AUTO')
        return
    if kind == 'cheeks':
        use_part('cheeks', False)
        c = Vector(RIG.get('cheeks', (0.28, RIG['eye'][1] - 0.08, RIG['eye'][2] - 0.12)))
        for sgn in (-1, 1):
            sphere((abs(c.x) * sgn, c.y, c.z), (0.055, 0.02, 0.032), M('#ff9fb6', rough=0.7, coat=0))

def add_face():
    place_face('eyes')
    place_face('mouth')
    place_face('cheeks')

def torso(col, belly, center, scale, belly_s, neck=True):
    use_part('body', True)
    mat = M(col)
    c = Vector(center)
    sphere(c, scale, mat)
    if neck:
        # Neck reaches up into the head so the two volumes overlap after the runtime scale.
        sphere((0, c.y - 0.03, c.z + scale[2] * 0.95), (scale[0] * 0.5, scale[1] * 0.46, scale[2] * 0.82), mat)
    if belly_s:
        use_part('belly', False)
        depth = max(belly_s[1], 0.18)
        front = c.y - scale[1]
        sphere((0, front - 0.1 + depth, c.z - scale[2] * 0.02), (belly_s[0], depth, belly_s[2]), M(belly))

def skull(col, center, scale):
    use_part('head', True)
    mat = M(col)
    c = Vector(center)
    sphere(c, scale, mat)
    # Plug that sinks into the neck, so the join reads as one toy.
    sphere((c.x, c.y + 0.03, c.z - scale[2] * 0.75), (scale[0] * 0.64, scale[1] * 0.58, scale[2] * 0.6), mat)

def stand(col, feet_col, mode='arm', arm_r=0.105, arm_len=0.50, foot_s=(0.16, 0.18, 0.11)):
    """Soft limbs. The shoulder ball stays on the arm pivot; the leg reaches into the body."""
    arms = STYLE['arms']
    mat = M(col)
    for sgn in (1, -1):
        side = 'L' if sgn > 0 else 'R'
        sh = Vector(RIG['shoulder_L']); sh.x *= sgn
        use_part('arm_' + side, True)
        if mode == 'flipper':
            socket = sh + Vector((0.03 * sgn, -0.02, 0.02))
            if arms == 'up':
                mid = sh + Vector((0.12 * sgn, -0.06, 0.16))
                tip = sh + Vector((0.16 * sgn, -0.1, 0.34))
            else:
                mid = sh + Vector((0.14 * sgn, -0.06, -0.06))
                tip = sh + Vector((0.2 * sgn, -0.1, -0.26))
            sphere(socket, (arm_r * 1.45, arm_r * 1.2, arm_r * 1.35), mat)
            sphere(mid, (arm_r * 0.9, arm_r * 1.55, arm_r * 1.2), mat)
            sphere(tip, (arm_r * 0.55, arm_r * 1.05, arm_r * 0.75), mat)
        elif mode == 'fin':
            sphere(sh + Vector((0.05 * sgn, 0.0, 0.0)), (0.14, 0.12, 0.13), mat)
            sphere(sh + Vector((0.26 * sgn, 0.0, -0.02)), (0.2, 0.075, 0.13), mat)
        else:
            if arms == 'up':
                hand = sh + Vector((0.24 * sgn, -0.1, 0.26))
            else:
                hand = sh + Vector((0.04 * sgn, -0.03, -arm_len))
            mid = sh.lerp(hand, 0.55)
            sphere(sh, (arm_r * 1.55, arm_r * 1.25, arm_r * 1.4), mat)
            sphere(mid, (arm_r * 1.15, arm_r * 1.0, arm_r * 1.2), mat)
            sphere(hand, (arm_r * 1.25, arm_r * 1.05, arm_r * 1.05), mat)
        ft = Vector(RIG['foot_L']); ft.x *= sgn
        knee = Vector((ft.x * 0.72, ft.y * 0.35, ft.z + 0.2))
        hip = Vector((ft.x * 0.5, ft.y * 0.12, max(0.5, ft.z + 0.36)))
        if mode == 'hoof':
            use_part('foot_' + side, True)
            sphere(hip, (0.13, 0.12, 0.14), mat)
            sphere(knee, (0.11, 0.11, 0.15), mat)
            use_part('foot_' + side, False)
            hoof = M(feet_col, rough=0.4, coat=0.35)
            sphere(ft + Vector((0, -0.02, 0.03)), (0.11, 0.13, 0.08), hoof)
            sphere(ft + Vector((0, -0.015, 0.07)), (0.105, 0.12, 0.06), hoof)
        elif mode == 'flipper':
            use_part('foot_' + side, True)
            foot_mat = M(feet_col, rough=0.35, coat=0.45)
            sphere(hip, (0.11, 0.12, 0.12), foot_mat)
            sphere(knee, (0.12, 0.15, 0.1), foot_mat)
            sphere(ft + Vector((0, -0.05, 0.03)), (max(foot_s[0], 0.15), max(foot_s[1], 0.2), 0.07), foot_mat)
        else:
            use_part('foot_' + side, True)
            sphere(hip, (0.145, 0.13, 0.14), mat)
            sphere(knee, (0.125, 0.13, 0.16), mat)
            sphere(ft + Vector((0, -0.02, 0.02)), (foot_s[0], foot_s[1], max(foot_s[2], 0.1)), mat)

def floppy_ear(sgn, col, inner, base, tip, radius=0.14, part='ears', fuse=False):
    use_part(part, fuse)
    base, tip = Vector(base), Vector(tip)
    base.x *= sgn; tip.x *= sgn
    mid = (base + tip) * 0.5
    rot = quat_to(tip - base, 'Z', 'Y')
    sphere(mid, (radius, radius * 0.55, (tip - base).length * 0.48), M(col), rot)
    sphere(mid + Vector((0, -0.045, 0)), (radius * 0.62, radius * 0.28, (tip - base).length * 0.34), PINK(inner), rot)

def pointy_ear(sgn, col, inner, base, height=0.42, radius=0.16, lean=0.12):
    use_part('head', True)
    base = Vector(base); base.x *= sgn
    d = Vector((lean * sgn, 0.02, 1)).normalized()
    cone(base + d * height * 0.48, radius, 0.035, height, M(col), quat_to(d, 'Z', 'Y'), verts=16, subsurf=1, scale=(1, 0.62, 1))
    use_part('head', False)
    cone(base + d * height * 0.5 + Vector((0, -0.03, 0)), radius * 0.55, 0.02, height * 0.72, PINK(inner), quat_to(d, 'Z', 'Y'), verts=12, subsurf=1, scale=(0.7, 0.35, 1))

def whiskers(origin, length, col, spread=0.08):
    use_part('head', False)
    o = Vector(origin)
    mat = M(col, rough=0.4, coat=0.1)
    for sgn in (-1, 1):
        for dz, pitch in ((0.045, 0.05), (0.0, 0.0), (-0.04, -0.04)):
            a = o + Vector((spread * sgn, 0, dz))
            b = a + Vector((length * sgn, -0.05, pitch + dz))
            tube([a, b], 0.018, mat, 'VECTOR')

def nose(loc, scale, col='#3a2a28'):
    use_part('head', False)
    sphere(loc, scale, NOSE(col))

def tail_curve(pts, radius, col, fuse=False):
    use_part('tail', fuse)
    tube(pts, radius, M(col), 'AUTO')

# ---------- animals ----------
def dog():
    if not begin('dog', neck=(0, 0.0, 1.08), hat=(0, -0.1, 1.98),
                 shoulder=(0.44, -0.04, 0.98), foot=(0.24, -0.12, 0.14), tail=(0, 0.34, 0.64),
                 eye=(0, -0.39, 1.645), spread=0.196, eye_scale=1.04,
                 mouth=(0, -0.68, 1.24), mouth_w=0.13, mouth_bow=0.045, mouth_kind='smile',
                 cheeks=(0.306, -0.45, 1.465)):
        return
    col, cream, ear = '#f2b66d', '#fff1dc', '#c4844a'
    torso(col, cream, (0, 0.02, 0.58), (0.5, 0.46, 0.44), (0.32, 0.16, 0.28))
    stand(col, col, arm_r=0.11, arm_len=0.48, foot_s=(0.17, 0.2, 0.11))
    skull(col, (0, -0.04, 1.52), (0.56, 0.5, 0.52))
    use_part('muzzle', True)
    sphere((0, -0.5, 1.36), (0.28, 0.24, 0.2), M(cream))
    sphere((0, -0.66, 1.3), (0.22, 0.2, 0.17), M(cream))
    nose((0, -0.78, 1.32), (0.09, 0.07, 0.065))
    floppy_ear(1, ear, '#f3b7c6', (0.34, 0.0, 1.66), (0.58, -0.04, 0.98), 0.16)
    floppy_ear(-1, ear, '#f3b7c6', (0.34, 0.0, 1.66), (0.58, -0.04, 0.98), 0.16)
    tail_curve([(0, 0.34, 0.64), (0, 0.52, 0.98), (0.16, 0.4, 1.22)], 0.085, col, fuse=True)
    use_part('tail', True)
    sphere((0.18, 0.36, 1.26), (0.11, 0.1, 0.11), M(col))
    add_face()

def cat():
    if not begin('cat', neck=(0, 0, 1.1), hat=(0, -0.08, 1.9),
                 shoulder=(0.38, -0.02, 0.96), foot=(0.2, -0.1, 0.13), tail=(0.02, 0.3, 0.5),
                 eye=(0, -0.332, 1.595), spread=0.17, eye_scale=1.08,
                 mouth=(0, -0.52, 1.32), mouth_w=0.07, mouth_bow=0.03, mouth_kind='w',
                 cheeks=(0.28, -0.392, 1.415)):
        return
    col, cream = '#b9a6ec', '#fbf5ff'
    torso(col, cream, (0, 0.0, 0.56), (0.42, 0.38, 0.4), (0.26, 0.14, 0.24))
    stand(col, col, arm_r=0.095, arm_len=0.46, foot_s=(0.14, 0.16, 0.1))
    skull(col, (0, -0.02, 1.48), (0.5, 0.46, 0.48))
    pointy_ear(1, col, '#ffb3c8', (0.24, 0.0, 1.78), height=0.5, radius=0.16, lean=0.22)
    pointy_ear(-1, col, '#ffb3c8', (0.24, 0.0, 1.78), height=0.5, radius=0.16, lean=0.22)
    nose((0, -0.52, 1.4), (0.05, 0.035, 0.04), '#ff8fb0')
    whiskers((0, -0.5, 1.36), 0.4, '#6d5aa8', spread=0.1)
    tail_curve([(0.02, 0.3, 0.5), (0.32, 0.5, 0.66), (0.46, 0.38, 1.12), (0.16, 0.26, 1.38)], 0.07, col, fuse=False)
    add_face()

def bunny():
    if not begin('bunny', neck=(0, 0, 1.08), hat=(0, -0.12, 1.9),
                 shoulder=(0.4, -0.02, 0.96), foot=(0.22, -0.16, 0.12), tail=(0, 0.42, 0.58),
                 eye=(0, -0.4, 1.58), spread=0.17, eye_scale=1.06,
                 mouth=(0, -0.56, 1.3), mouth_w=0.06, mouth_bow=0.028, mouth_kind='w',
                 cheeks=(0.28, -0.46, 1.4)):
        return
    col, inner = '#fdeaf1', '#ffa9c1'
    torso(col, '#ffe3ec', (0, 0.0, 0.58), (0.48, 0.44, 0.44), (0.3, 0.16, 0.28))
    stand(col, col, arm_r=0.1, arm_len=0.46, foot_s=(0.16, 0.24, 0.1))
    skull(col, (0, -0.04, 1.48), (0.52, 0.48, 0.5))
    # Tall ears, leaned out so a hat can sit between them.
    use_part('head', True)
    for sgn in (-1, 1):
        tube([(0.28 * sgn, 0.0, 1.78), (0.4 * sgn, 0.02, 2.15), (0.5 * sgn, 0.0, 2.52)], 0.11, M(col), 'AUTO')
    use_part('head', False)
    for sgn in (-1, 1):
        tube([(0.3 * sgn, -0.06, 1.84), (0.42 * sgn, -0.05, 2.16), (0.5 * sgn, -0.04, 2.42)], 0.055, PINK(inner), 'AUTO')
    nose((0, -0.55, 1.4), (0.045, 0.03, 0.035), '#ff7fa3')
    use_part('head', False)
    for sgn in (-1, 1):
        sphere((0.035 * sgn, -0.58, 1.22), (0.035, 0.03, 0.055), M('#fffaf8', rough=0.35, coat=0.2))
    use_part('tail', False)
    sphere((0, 0.46, 0.58), (0.16, 0.16, 0.16), M('#ffffff', rough=0.85, coat=0.05))
    add_face()

def penguin():
    if not begin('penguin', neck=(0, 0, 1.12), hat=(0, -0.08, 1.78),
                 shoulder=(0.4, -0.02, 1.05), foot=(0.18, -0.2, 0.08), tail=(0, 0.32, 0.48),
                 eye=(0, -0.43, 1.459), spread=0.136, eye_scale=0.98,
                 mouth=(0, -0.5, 1.18), mouth_w=0.08, mouth_bow=0.02, mouth_kind='closed',
                 cheeks=(0.246, -0.49, 1.279)):
        return
    col, white, beak = '#3d5a9e', '#ffffff', '#ffa23a'
    use_part('body', True)
    sphere((0, 0.0, 0.78), (0.5, 0.46, 0.58), M(col))  # egg body
    sphere((0, -0.02, 1.2), (0.3, 0.28, 0.32), M(col))  # neck into the head
    use_part('belly', False)
    sphere((0, -0.42, 0.74), (0.28, 0.2, 0.34), M(white))
    skull(col, (0, -0.02, 1.38), (0.4, 0.38, 0.36))
    use_part('head', False)
    sphere((0, -0.42, 1.36), (0.24, 0.16, 0.2), M(white))  # clean face oval
    use_part('head', False)
    bk = Vector((0, -0.48, 1.24))
    cone(bk, 0.12, 0.02, 0.22, M(beak, rough=0.35, coat=0.45), quat_to((0, -1, -0.15), 'Z', 'Y'), verts=16, subsurf=2, scale=(1.25, 0.7, 1))
    stand(col, beak, mode='flipper', foot_s=(0.16, 0.26, 0.06))
    use_part('tail', False)
    sphere((0, 0.4, 0.5), (0.1, 0.12, 0.08), M(col))
    add_face()

def horse():
    if not begin('horse', neck=(0, 0.02, 1.16), hat=(0, -0.16, 1.92),
                 shoulder=(0.4, -0.02, 0.98), foot=(0.22, -0.1, 0.12), tail=(0, 0.4, 0.7),
                 eye=(0, -0.354, 1.644), spread=0.136, eye_scale=0.96,
                 mouth=(0, -0.78, 1.28), mouth_w=0.1, mouth_bow=0.035, mouth_kind='smile',
                 cheeks=(0.246, -0.414, 1.464)):
        return
    col, mane, muz = '#f7c9a0', '#9b7bea', '#fde7d3'
    torso(col, muz, (0, 0.02, 0.58), (0.44, 0.4, 0.46), (0.26, 0.14, 0.24), neck=False)
    use_part('body', True)
    sphere((0, 0.02, 1.08), (0.26, 0.24, 0.4), M(col))  # longer neck into the head
    stand(col, '#8a6a55', mode='hoof', arm_r=0.1, arm_len=0.5)
    skull(col, (0, -0.06, 1.56), (0.4, 0.36, 0.38))
    use_part('muzzle', True)
    sphere((0, -0.36, 1.5), (0.24, 0.22, 0.2), M(muz))
    sphere((0, -0.56, 1.4), (0.22, 0.22, 0.18), M(muz))
    sphere((0, -0.72, 1.32), (0.18, 0.18, 0.16), M(muz))
    nose((0.06, -0.84, 1.32), (0.04, 0.03, 0.028), '#8a5a4a')
    nose((-0.06, -0.84, 1.32), (0.04, 0.03, 0.028), '#8a5a4a')
    pointy_ear(1, col, '#ffb3a8', (0.16, 0.02, 1.82), height=0.36, radius=0.12, lean=0.18)
    pointy_ear(-1, col, '#ffb3a8', (0.16, 0.02, 1.82), height=0.36, radius=0.12, lean=0.18)
    use_part('mane', True)
    for i in range(6):
        t = i / 5
        sphere((0.0, -0.02 + t * 0.32, 1.9 - t * 0.72), (0.11, 0.16, 0.13), M(mane))
    sphere((0, -0.2, 1.78), (0.12, 0.12, 0.11), M(mane))  # forelock
    tail_curve([(0, 0.4, 0.7), (0.02, 0.58, 0.4), (0.04, 0.6, 0.14)], 0.1, mane, fuse=False)
    add_face()

def monkey():
    if not begin('monkey', neck=(0, 0, 1.08), hat=(0, -0.08, 1.96),
                 shoulder=(0.44, -0.02, 0.98), foot=(0.22, -0.1, 0.13), tail=(0.05, 0.36, 0.58),
                 eye=(0, -0.469, 1.606), spread=0.17, eye_scale=1.0,
                 mouth=(0, -0.62, 1.32), mouth_w=0.12, mouth_bow=0.05, mouth_kind='smile',
                 cheeks=(0.28, -0.529, 1.426)):
        return
    col, face = '#a8704a', '#ffd9b0'
    torso(col, face, (0, 0.0, 0.58), (0.46, 0.42, 0.44), (0.28, 0.16, 0.26))
    stand(col, col, arm_r=0.1, arm_len=0.56, foot_s=(0.15, 0.17, 0.1))
    skull(col, (0, -0.02, 1.5), (0.5, 0.44, 0.48))
    # Heart-shaped face: wide cheeks narrowing to a chin, one smooth volume.
    use_part('muzzle', True)
    sphere((0, -0.42, 1.48), (0.36, 0.2, 0.26), M(face))
    sphere((0, -0.52, 1.3), (0.18, 0.16, 0.15), M(face))
    use_part('ears', False)
    for sgn in (-1, 1):
        sphere((0.58 * sgn, -0.02, 1.52), (0.16, 0.1, 0.16), M(col))
        sphere((0.6 * sgn, -0.08, 1.52), (0.09, 0.05, 0.09), M(face))
    nose((0, -0.55, 1.4), (0.06, 0.04, 0.045), '#c4896a')
    pts = [(0.05, 0.36, 0.58)]
    for i in range(22):
        t = i / 21
        a = t * math.tau * 1.35
        rad = 0.05 + t * 0.16
        pts.append((0.18 + rad * math.sin(a), 0.46, 0.78 + rad * math.cos(a)))
    tail_curve(pts, 0.04, col, fuse=False)
    add_face()

def tiger():
    if not begin('tiger', neck=(0, 0, 1.08), hat=(0, -0.08, 1.98),
                 shoulder=(0.46, -0.02, 1.0), foot=(0.24, -0.1, 0.14), tail=(0, 0.36, 0.62),
                 eye=(0, -0.375, 1.645), spread=0.19, eye_scale=1.02,
                 mouth=(0, -0.64, 1.28), mouth_w=0.12, mouth_bow=0.04, mouth_kind='w',
                 cheeks=(0.3, -0.435, 1.465)):
        return
    col, white, stripe = '#ff9a3c', '#fff6ea', '#3b2a3f'
    torso(col, white, (0, 0.0, 0.6), (0.5, 0.46, 0.46), (0.32, 0.16, 0.3))
    stand(col, col, arm_r=0.115, arm_len=0.48, foot_s=(0.17, 0.2, 0.11))
    use_part('body', False)
    band = M(stripe, rough=0.5, coat=0.1)
    for z, rad in ((0.42, 0.4), (0.62, 0.46), (0.82, 0.4)):
        torus((0, 0.0, z), rad, 0.05, band)
    skull(col, (0, -0.02, 1.52), (0.56, 0.5, 0.52))
    use_part('muzzle', True)
    sphere((0, -0.52, 1.38), (0.28, 0.2, 0.18), M(white))
    sphere((0, -0.64, 1.32), (0.2, 0.16, 0.14), M(white))
    for sgn in (-1, 1):
        sphere((0.42 * sgn, 0.02, 1.78), (0.16, 0.1, 0.16), M(col))
        sphere((0.42 * sgn, -0.04, 1.78), (0.09, 0.045, 0.09), M(white))
    use_part('head', False)
    for x, z, s in ((-0.1, 1.78, (0.045, 0.03, 0.16)), (0.1, 1.78, (0.045, 0.03, 0.16)), (0, 1.86, (0.04, 0.03, 0.18))):
        sphere((x, -0.08, z), s, band)
    for sgn in (-1, 1):
        sphere((0.4 * sgn, -0.2, 1.5), (0.14, 0.03, 0.045), band, quat_to((sgn, -0.4, 0), 'X', 'Z'))
        sphere((0.36 * sgn, -0.28, 1.4), (0.12, 0.03, 0.04), band, quat_to((sgn, -0.5, -0.2), 'X', 'Z'))
    nose((0, -0.62, 1.42), (0.07, 0.045, 0.04), '#ff7a9a')
    whiskers((0, -0.55, 1.36), 0.38, '#5c4a58', spread=0.12)
    tail_curve([(0, 0.36, 0.6), (0.18, 0.55, 0.72), (0.32, 0.5, 1.05)], 0.075, col, fuse=False)
    use_part('tail', False)
    for p in ((0.12, 0.5, 0.7), (0.24, 0.52, 0.9)):
        sphere(p, (0.09, 0.09, 0.07), band)
    sphere((0.34, 0.48, 1.1), (0.1, 0.1, 0.1), band)
    add_face()

def shark():
    if not begin('shark', neck=(0, -0.02, 1.05), hat=(0, -0.18, 1.7),
                 shoulder=(0.4, 0.0, 0.95), foot=(0.2, -0.06, 0.12), tail=(0, 0.4, 0.62),
                 eye=(0, -0.462, 1.368), spread=0.173, eye_scale=1.02,
                 mouth=(0, -0.7, 1.16), mouth_w=0.13, mouth_bow=0.04, mouth_kind='smile',
                 cheeks=(0.283, -0.522, 1.188)):
        return
    col, white = '#5fa8e8', '#f4fbff'
    use_part('body', True)
    sphere((0, 0.02, 0.7), (0.46, 0.52, 0.4), M(col))
    sphere((0, -0.05, 1.0), (0.38, 0.4, 0.28), M(col))
    # Dorsal fin, thick enough to survive remesh and read in silhouette.
    base = Vector((0, 0.22, 1.15))
    d = Vector((0, 0.45, 1)).normalized()
    cone(base + d * 0.24, 0.22, 0.05, 0.52, M(col), quat_to(d, 'Z', 'Y'), verts=14, subsurf=1, scale=(0.55, 1, 1))
    use_part('belly', False)
    sphere((0, -0.48, 0.66), (0.26, 0.18, 0.24), M(white))
    skull(col, (0, -0.12, 1.28), (0.54, 0.48, 0.4))
    use_part('head', False)
    sphere((0, -0.58, 1.18), (0.26, 0.16, 0.14), M(white))  # smooth chin oval
    stand(col, col, mode='fin', foot_s=(0.14, 0.16, 0.09))
    use_part('tail', True)
    tube([(0, 0.4, 0.62), (0, 0.62, 0.66)], 0.1, M(col), 'VECTOR')
    cone((0, 0.7, 0.82), 0.16, 0.03, 0.36, M(col), quat_to((0, 0.45, 1), 'Z', 'Y'), verts=12, subsurf=1, scale=(0.4, 1, 1))
    cone((0, 0.68, 0.5), 0.12, 0.03, 0.26, M(col), quat_to((0, 0.5, -0.8), 'Z', 'Y'), verts=12, subsurf=1, scale=(0.4, 1, 1))
    use_part('head', False)
    tooth = M('#fffef8', rough=0.22, coat=0.5)
    for t in (-1.0, -0.5, 0.0, 0.5, 1.0):
        sphere((t * 0.1, -0.74, 1.14 - 0.04 * t * t), (0.034, 0.024, 0.042), tooth)
    add_face()

def pig():
    if not begin('pig', neck=(0, 0, 1.06), hat=(0, -0.1, 1.98),
                 shoulder=(0.46, -0.02, 0.98), foot=(0.24, -0.1, 0.13), tail=(0, 0.4, 0.58),
                 eye=(0, -0.376, 1.625), spread=0.184, eye_scale=1.0,
                 mouth=(0, -0.62, 1.16), mouth_w=0.1, mouth_bow=0.03, mouth_kind='smile',
                 cheeks=(0.294, -0.436, 1.445)):
        return
    col, snout = '#ffb3c6', '#ff94b0'
    torso(col, '#ffd1dd', (0, 0.0, 0.58), (0.52, 0.5, 0.5), (0.32, 0.16, 0.3))
    stand(col, '#e07090', mode='hoof', arm_r=0.11, arm_len=0.46, foot_s=(0.14, 0.16, 0.1))
    skull(col, (0, -0.02, 1.5), (0.54, 0.5, 0.52))
    floppy_ear(1, col, '#ff8eae', (0.32, 0.02, 1.72), (0.55, -0.08, 1.22), 0.15, part='head', fuse=True)
    floppy_ear(-1, col, '#ff8eae', (0.32, 0.02, 1.72), (0.55, -0.08, 1.22), 0.15, part='head', fuse=True)
    use_part('muzzle', True)
    sn = M(snout, rough=0.38, coat=0.4)
    sphere((0, -0.46, 1.4), (0.26, 0.18, 0.2), sn)
    sphere((0, -0.62, 1.36), (0.2, 0.14, 0.15), sn)
    nose((0.07, -0.7, 1.38), (0.035, 0.025, 0.04), '#c85a78')
    nose((-0.07, -0.7, 1.38), (0.035, 0.025, 0.04), '#c85a78')
    pts = [(0, 0.4, 0.58)]
    for i in range(18):
        t = i / 17
        a = t * math.tau * 1.5
        rad = 0.04 + t * 0.1
        pts.append((0.2 + rad * math.sin(a), 0.48, 0.66 + rad * math.cos(a)))
    tail_curve(pts, 0.032, col, fuse=False)
    add_face()

def axolotl():
    if not begin('axolotl', neck=(0, 0, 1.02), hat=(0, -0.06, 1.68),
                 shoulder=(0.4, -0.02, 0.9), foot=(0.22, -0.08, 0.12), tail=(0, 0.36, 0.55),
                 eye=(0, -0.32, 1.42), spread=0.26, eye_scale=0.86,
                 mouth=(0, -0.5, 1.22), mouth_w=0.16, mouth_bow=0.035, mouth_kind='smile',
                 cheeks=(0.36, -0.36, 1.28)):
        return
    col, gill = '#ffb0d4', '#ff5fa2'
    torso(col, '#ffe0ee', (0, 0.02, 0.55), (0.42, 0.4, 0.36), (0.26, 0.14, 0.22))
    stand(col, col, arm_r=0.09, arm_len=0.42, foot_s=(0.13, 0.15, 0.09))
    skull(col, (0, -0.06, 1.32), (0.66, 0.46, 0.36))  # wide flat head
    use_part('gills', False)
    gmat = M(gill, rough=0.45, coat=0.2)
    for sgn in (-1, 1):
        for el, length in ((0.2, 0.46), (0.02, 0.52), (-0.16, 0.44)):
            base = Vector((0.5 * sgn, 0.0, 1.34 + el))
            mid = base + Vector((0.24 * sgn, 0.1, 0.08))
            tip = base + Vector((0.46 * sgn, 0.18, 0.02))
            tube([base, mid, tip], 0.05, gmat, 'AUTO')
            sphere(tip, (0.1, 0.1, 0.1), gmat)
            for t in (0.45, 0.7, 0.9):
                p = base * (1 - t) + tip * t
                sphere(p + Vector((0, -0.02, 0.07)), (0.07, 0.055, 0.07), gmat)
                sphere(p + Vector((0.04 * sgn, 0.04, -0.05)), (0.06, 0.05, 0.06), gmat)
    use_part('tail', True)
    sphere((0, 0.48, 0.48), (0.08, 0.28, 0.22), M(col))  # paddle
    add_face()

def capybara():
    if not begin('capybara', neck=(0, 0, 1.02), hat=(0, -0.06, 1.78),
                 shoulder=(0.48, -0.02, 0.9), foot=(0.26, -0.08, 0.13), tail=None,
                 eye=(0, -0.41, 1.452), spread=0.209, eye_scale=0.86,
                 mouth=(0, -0.62, 1.16), mouth_w=0.14, mouth_bow=0.03, mouth_kind='smile',
                 cheeks=(0.319, -0.47, 1.272)):
        return
    col, belly, snout = '#c88f5a', '#e2b183', '#a87442'
    torso(col, belly, (0, 0.02, 0.55), (0.56, 0.48, 0.4), (0.36, 0.16, 0.24), neck=False)
    use_part('body', True)
    sphere((0, -0.02, 0.9), (0.4, 0.36, 0.22), M(col))
    stand(col, col, arm_r=0.12, arm_len=0.4, foot_s=(0.16, 0.18, 0.1))
    skull(col, (0, -0.04, 1.36), (0.58, 0.5, 0.42))
    use_part('head', True)
    for sgn in (-1, 1):
        sphere((0.34 * sgn, 0.1, 1.7), (0.1, 0.08, 0.1), M(col))  # tiny ears
    use_part('head', False)
    softbox((0, -0.5, 1.24), (0.5, 0.32, 0.26), M(snout, rough=0.48, coat=0.2), bevel=0.08)
    use_part('head', False)
    sphere((0, -0.68, 1.28), (0.16, 0.04, 0.06), M('#5c3a28', rough=0.5, coat=0.1))  # nostril pad
    nose((0.06, -0.72, 1.3), (0.035, 0.025, 0.03), '#3a2418')
    nose((-0.06, -0.72, 1.3), (0.035, 0.025, 0.03), '#3a2418')
    use_part('head', False)
    sphere((0.32, 0.02, 1.62), (0.16, 0.15, 0.14), M('#ff9a2e', rough=0.5, coat=0.15))
    cone((0.36, 0.02, 1.76), 0.05, 0.0, 0.08, M('#4caf50'), quat_to((0.4, 0, 1), 'Z', 'Y'), verts=8, subsurf=1, scale=(1, 0.35, 1))
    add_face()

def dragon():
    if not begin('dragon', neck=(0, 0, 1.08), hat=(0, -0.14, 1.92),
                 shoulder=(0.42, -0.02, 0.98), foot=(0.22, -0.1, 0.13), tail=(0, 0.36, 0.58),
                 eye=(0, -0.358, 1.615), spread=0.17, eye_scale=1.02,
                 mouth=(0, -0.58, 1.28), mouth_w=0.08, mouth_bow=0.03, mouth_kind='smile',
                 cheeks=(0.28, -0.418, 1.435)):
        return
    col, belly, wing = '#6fd6a6', '#fff0a8', '#b18cff'
    torso(col, belly, (0, 0.0, 0.58), (0.48, 0.44, 0.46), (0.3, 0.16, 0.3))
    stand(col, col, arm_r=0.105, arm_len=0.48, foot_s=(0.15, 0.17, 0.1))
    skull(col, (0, -0.04, 1.5), (0.5, 0.46, 0.48))
    use_part('head', True)
    sphere((0, -0.46, 1.4), (0.2, 0.18, 0.15), M(col))  # short blunt snout, fused into the head
    nose((0.05, -0.58, 1.42), (0.028, 0.02, 0.02), '#2e8b64')
    nose((-0.05, -0.58, 1.42), (0.028, 0.02, 0.02), '#2e8b64')
    use_part('horns', False)
    horn = M('#fff3c4', rough=0.35, coat=0.4)
    for sgn in (-1, 1):
        base = Vector((0.22 * sgn, 0.06, 1.82))
        d = Vector((0.28 * sgn, 0.35, 0.85)).normalized()
        cone(base + d * 0.2, 0.1, 0.04, 0.42, horn, quat_to(d, 'Z', 'Y'), verts=14, subsurf=1)
    wmat = M(wing, rough=0.42, coat=0.25)
    for sgn, part in ((1, 'wing_L'), (-1, 'wing_R')):
        use_part(part, True)
        root = Vector((0.22 * sgn, 0.14, 1.02))
        tip = Vector((1.05 * sgn, 0.34, 1.38))
        mid = (root + tip) * 0.5
        sphere(mid, (0.4, 0.12, 0.22), wmat, quat_to(tip - root, 'X', 'Z'))
        sphere(mid + Vector((0.06 * sgn, 0.06, -0.16)), (0.26, 0.1, 0.16), wmat)
        sphere(root + Vector((0.12 * sgn, 0.02, 0.04)), (0.14, 0.1, 0.12), wmat)
    tail_curve([(0, 0.36, 0.58), (0.22, 0.55, 0.5), (0.42, 0.62, 0.72)], 0.08, col, fuse=False)
    use_part('tail', False)
    spike = M(wing, rough=0.4, coat=0.2)
    for p, d in (((0.12, 0.48, 0.62), (0.1, 0.2, 1)), ((0.28, 0.56, 0.62), (0.15, 0.15, 1)), ((0.4, 0.6, 0.78), (0.2, 0.1, 1))):
        dv = Vector(d).normalized()
        cone(Vector(p) + dv * 0.08, 0.08, 0.03, 0.2, spike, quat_to(dv, 'Z', 'Y'), verts=10, subsurf=1, scale=(0.75, 1, 1))
    cone((0.52, 0.68, 0.86), 0.12, 0.045, 0.22, spike, quat_to((0.35, 0.15, 0.85), 'Z', 'Y'), verts=10, subsurf=1, scale=(1.5, 0.5, 1))
    add_face()

ANIMALS = ['dog', 'cat', 'bunny', 'penguin', 'horse', 'monkey', 'tiger', 'shark', 'pig', 'axolotl', 'capybara', 'dragon']
GEO = {n: globals()[n] for n in ANIMALS}

def build(name, eye='open', mth=None, arms='down', extras=True, only=None):
    STYLE['eye'] = eye
    STYLE['mouth'] = mth
    STYLE['arms'] = arms
    ONLY[0] = only
    if name not in GEO:
        raise ValueError(name)
    GEO[name]()

def scene_setup(res=(900, 900), samples=96):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.95, 0.93, 1.0, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    bpy.context.active_object.is_shadow_catcher = True
    def area(loc, energy, size, color=(1, 1, 1)):
        ld = bpy.data.lights.new("a", 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
        o = bpy.data.objects.new("a", ld); bpy.context.collection.objects.link(o); o.location = loc
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = quat_to(Vector((0, 0, 1.0)) - Vector(loc), '-Z', 'Y')
    area((-4, -5, 6), 650, 5)
    area((5, -3, 3), 220, 4, (1, 0.95, 1))
    area((2, 6, 7), 300, 3, (0.95, 0.97, 1))
    return sc

def camera(loc, target, lens=50, ortho=None):
    cd = bpy.data.cameras.new("cam"); cd.lens = lens
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    o = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(o)
    o.location = loc; o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = quat_to(Vector(target) - Vector(loc), '-Z', 'Y')
    bpy.context.scene.camera = o

def composite(path):
    from PIL import Image
    im = Image.open(path).convert('RGBA')
    bg = Image.new('RGBA', im.size, BG + (255,))
    bg.alpha_composite(im); bg.convert('RGB').save(path, optimize=True)

def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    composite(path)

def make_character(name, loc=(0, 0, 0), yaw=-28, eye='open', mth=None, arms='down', head_tilt=0.0):
    root = empty(); PARENT[0] = root
    build(name, eye=eye, mth=mth, arms=arms)
    root.location = loc; root.rotation_euler = (0, 0, math.radians(yaw))
    PARENT[0] = None
    return root

def single(name, samples):
    scene_setup(samples=samples)
    make_character(name)
    camera((0, -7.2, 1.9), (-0.05, 0, 1.2), lens=72)
    render(f"{OUT}/{name}.png")

def emotes(samples):
    scene_setup(res=(1800, 620), samples=samples)
    xs = [-3.3, -1.1, 1.1, 3.3]
    make_character('penguin', (xs[0], 0, 0), yaw=-15, eye='open', mth='open')
    make_character('penguin', (xs[1], 0, 0), yaw=-5, eye='happy', mth='open', arms='up')
    for (dx, dz, s) in ((-0.85, 2.35, 0.2), (0.9, 2.25, 0.16), (-0.95, 1.55, 0.12), (0.95, 1.6, 0.13)):
        star((xs[1] + dx, -0.4, dz), s, M('#ffd23f', rough=0.2, coat=1, emit=0.4))
    r = make_character('penguin', (xs[2], 0, 0), yaw=0, eye='sleepy', mth='o')
    r.rotation_euler = (0, math.radians(8), 0)
    nightcap = M('#8f7cf0')
    cone((xs[2] - 0.05, 0, 2.15), 0.45, 0.02, 0.8, nightcap, quat_to((-0.5, 0.1, 1), 'Z', 'Y'), verts=32)
    sphere((xs[2] - 0.3, 0.05, 2.55), (0.11, 0.11, 0.11), M('#ffffff', rough=0.9, coat=0))
    zm = M('#8f7cf0', rough=0.3)
    for (dx, dz, s) in ((0.7, 2.0, 0.28), (0.95, 2.35, 0.36), (1.2, 2.75, 0.44)):
        text('z', (xs[2] + dx, -0.2, dz), s, zm)
    make_character('penguin', (xs[3], 0, 0), yaw=5, eye='happy', mth='smile')
    cyl((xs[3], -0.52, 0.72), 0.14, 0.05, M('#ffc83d', rough=0.2, coat=1), quat_to((0, -1, 0.1), 'Z', 'X'))
    curve([Vector((xs[3] - 0.22, -0.4, 1.05)), Vector((xs[3], -0.53, 0.8)), Vector((xs[3] + 0.22, -0.4, 1.05))], 0.03, M('#ff5f7e'))
    cone((xs[3], -0.56, 0.72), 0.08, 0, 0.02, M('#fff3b0', rough=0.2), quat_to((0, -1, 0), 'Z', 'Y'), verts=5)
    camera((0, -14.5, 1.8), (0, 0, 1.25), lens=50)
    render(f"{OUT}/penguin-emotes.png")

def lineup(samples):
    scene_setup(res=(2000, 1050), samples=samples)
    row1 = ANIMALS[:6]; row2 = ANIMALS[6:]
    for i, n in enumerate(row1):
        make_character(n, (-4.95 + i*2.2, 2.2, 0), yaw=-8)
    for i, n in enumerate(row2):
        make_character(n, (-6.05 + i*2.2, -1.0, 0), yaw=-8)
    camera((0, -19, 8.5), (0, 0.6, 1.25), lens=46)
    render(f"{OUT}/lineup.png")

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    what = args[0]; samples = int(args[1]) if len(args) > 1 else 96
    if what == 'all':
        for n in ANIMALS: single(n, samples)
    elif what == 'emotes': emotes(samples)
    elif what == 'lineup': lineup(samples)
    else:
        for n in what.split(','): single(n, samples)
