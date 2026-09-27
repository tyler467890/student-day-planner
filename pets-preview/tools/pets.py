"""Procedural 3D 'vinyl toy' pet concepts for Dayli. Run with the bpy venv.
Usage: python pets.py <name|all|emotes|lineup> [samples]
"""
import bpy, math, sys, os
from mathutils import Vector, Quaternion, Matrix

OUT = "/workspace/pet-avatars"
BG = (246, 242, 252)  # plain light lavender-white background

def hexlin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple((x/12.92) if x <= 0.04045 else ((x+0.055)/1.055)**2.4 for x in c)

_mats = {}
def M(hexcol, rough=0.45, coat=0.25, emit=0.0):
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
def attach(o, parent=None):
    p = parent or PARENT[0]
    if p is not None:
        bpy.context.view_layer.update()
        o.parent = p
        o.matrix_parent_inverse = p.matrix_world.inverted()
    return o

def finish(o, mat, subsurf=0, smooth=True):
    if smooth and o.type == 'MESH':
        for poly in o.data.polygons: poly.use_smooth = True
    o.data.materials.append(mat)
    if subsurf:
        s = o.modifiers.new("s", 'SUBSURF'); s.levels = subsurf; s.render_levels = subsurf
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
    cu = bpy.data.curves.new("c", 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = bevel; cu.bevel_resolution = 6; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points)-1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
        if taper_end is not None: pass
    o = bpy.data.objects.new("curve", cu); bpy.context.collection.objects.link(o)
    cu.materials.append(mat)
    return attach(o)

def text(s, loc, size, mat, rot=(math.radians(90), 0, 0)):
    cu = bpy.data.curves.new("t", 'FONT'); cu.body = s; cu.size = size
    cu.extrude = 0.03; cu.bevel_depth = 0.012; cu.align_x = 'CENTER'
    o = bpy.data.objects.new("text", cu); bpy.context.collection.objects.link(o)
    o.location = loc; o.rotation_euler = rot; cu.materials.append(mat)
    return attach(o)

def star(loc, r, mat, depth=0.35):
    import math as _m
    verts = [(0, -depth*r, 0), (0, depth*r, 0)]
    for i in range(10):
        a = _m.pi/2 + i*_m.pi/5; rr = r if i % 2 == 0 else r*0.45
        verts.append((rr*_m.cos(a), 0, rr*_m.sin(a)))
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

# ---------- body plan ----------
HEAD = Vector((0, 0, 1.5)); HS = Vector((0.70, 0.62, 0.60))
BODY = Vector((0, 0, 0.62)); BS = Vector((0.50, 0.44, 0.52))

def dirv(az, el):
    return Vector((math.sin(az)*math.cos(el), -math.cos(az)*math.cos(el), math.sin(el)))

def surf(C, S, az, el, k=1.0):
    d = dirv(az, el); return C + Vector((d.x*S.x, d.y*S.y, d.z*S.z))*k

def face_rot(az, el):
    return quat_to(dirv(az, el), '-Y', 'Z')

BLACK = lambda: M('#1d1a2b', rough=0.08, coat=1.0)
WHITE_EMIT = lambda: M('#ffffff', rough=0.2, coat=0, emit=2.5)

def eyes(style='open', az=0.34, el=0.02, size=1.0, C=None, S=None, lashes=False):
    C = C or HEAD; S = S or HS
    for sgn in (-1, 1):
        a = az*sgn
        if style == 'open':
            p = surf(C, S, a, el, 0.965)
            sphere(p, (0.115*size, 0.06, 0.14*size), BLACK(), face_rot(a, el))
            sphere(surf(C, S, a-0.045, el+0.06, 1.0), (0.034*size,)*3, WHITE_EMIT())
            sphere(surf(C, S, a+0.04, el-0.05, 1.0), (0.017*size,)*3, WHITE_EMIT())
            if lashes:
                for i, t in enumerate((-0.5, 0.0, 0.5)):
                    base = surf(C, S, a + sgn*0.07 + t*0.02, el+0.13, 1.0)
                    tip = base + Vector((sgn*0.05, -0.03, 0.05))
                    curve([base, tip], 0.012, BLACK())
        else:
            pts = []
            for i in range(7):
                t = -1 + 2*i/6
                if style == 'happy':   # bows upward  ^
                    e = el - 0.02 + 0.055*(1 - t*t)
                else:                  # sleepy, bows downward
                    e = el + 0.01 - 0.04*(1 - t*t)
                pts.append(surf(C, S, a + t*0.1, e, 1.005))
            curve(pts, 0.02, BLACK())

def blush(az=0.6, el=-0.16, C=None, S=None, col='#ff9fb6'):
    C = C or HEAD; S = S or HS
    for sgn in (-1, 1):
        sphere(surf(C, S, az*sgn, el, 0.99), (0.085, 0.02, 0.05), M(col, rough=0.7, coat=0), face_rot(az*sgn, el))

def mouth(style='smile', C=None, S=None, el=-0.24, width=0.12, bow=0.05):
    C = C or HEAD; S = S or HS
    if style == 'smile':
        pts = [surf(C, S, t*width, el - bow*(1 - t*t), 1.005) for t in [-1 + 2*i/8 for i in range(9)]]
        curve(pts, 0.018, BLACK())
    elif style == 'cat':  # w-shape
        pts = []
        for i in range(11):
            t = -1 + 2*i/10
            pts.append(surf(C, S, t*width, el - bow*0.8*abs(math.sin(t*math.pi)), 1.005))
        curve(pts, 0.016, BLACK())
    elif style == 'open':
        p = surf(C, S, 0, el-0.02, 0.975)
        sphere(p, (0.095, 0.05, 0.075), M('#5a1e32', rough=0.4), face_rot(0, el-0.02))
        sphere(surf(C, S, 0, el-0.055, 0.99), (0.055, 0.03, 0.03), M('#ff7d9a', rough=0.5), face_rot(0, el-0.055))
    elif style == 'o':
        p = surf(C, S, 0, el, 0.99)
        sphere(p, (0.035, 0.03, 0.035), M('#5a1e32', rough=0.4), face_rot(0, el))

def base_body(col, belly=None, arms='down', feet_col=None, arm_col=None):
    sphere(BODY, BS, M(col))
    if belly:
        sphere(BODY + Vector((0, -0.24, -0.04)), (0.34, 0.22, 0.38), M(belly))
    fc = M(feet_col or col)
    for sgn in (-1, 1):
        sphere((0.23*sgn, -0.12, 0.1), (0.16, 0.21, 0.11), fc)
        sh = Vector((0.38*sgn, -0.04, 0.86))
        d = Vector((0.45*sgn, -0.1, -0.9)) if arms == 'down' else Vector((0.95*sgn, -0.25, 0.55))
        d.normalize()
        sphere(sh + d*0.2, (0.12, 0.12, 0.22), M(arm_col or col), quat_to(d, 'Z', 'Y'))

def head(col):
    sphere(HEAD, HS, M(col))

def ears_round(col, inner, az=0.62, el=0.75, r=0.2):
    for sgn in (-1, 1):
        p = surf(HEAD, HS, az*sgn, el, 0.95); d = dirv(az*sgn, el)
        sphere(p, (r, r*0.45, r), M(col), quat_to(d, '-Y', 'Z') if False else face_rot(az*sgn*0.2, 0.1))
        sphere(p + Vector((0, -0.05, 0)), (r*0.6, r*0.3, r*0.6), M(inner), face_rot(az*sgn*0.2, 0.1))

def ears_pointy(col, inner, az=0.55, el=0.9, h=0.42, r=0.21, tilt=0.0):
    for sgn in (-1, 1):
        base = surf(HEAD, HS, az*sgn, el, 0.85)
        d = (dirv(az*sgn, el) + Vector((0, tilt, 0.6))).normalized()
        cone(base + d*h*0.5, r, 0.0, h, M(col), quat_to(d, 'Z', 'Y'), verts=10, subsurf=2, scale=(1, 0.55, 1))
        cone(base + d*h*0.5 + Vector((0, -0.07, -0.02)), r*0.62, 0.0, h*0.75, M(inner), quat_to(d, 'Z', 'Y'), verts=10, subsurf=2, scale=(1, 0.3, 1))

def tail_curve(pts, r, col):
    curve([Vector(p) for p in pts], r, M(col))

# ---------- animals ----------
def build(name, eye='open', mth=None, arms='down', extras=True):
    A = {}
    if name == 'dog':
        col, cream = '#f2b66d', '#fff1dc'
        base_body(col, cream, arms); head(col)
        M_C = HEAD + Vector((0, -0.5, -0.2)); M_S = Vector((0.3, 0.2, 0.2))
        sphere(M_C, M_S, M(cream))
        sphere(surf(M_C, M_S, 0, 0.45, 0.98), (0.09, 0.06, 0.065), BLACK())
        sphere(surf(HEAD, HS, -0.35, 0.1, 0.95), (0.2, 0.05, 0.19), M('#c98848'), face_rot(-0.35, 0.1))  # eye patch
        eyes(eye, el=0.1); blush(az=0.66, el=-0.08)
        mouth(mth or 'smile', M_C, M_S, el=-0.1, width=0.4, bow=0.28)
        for sgn in (-1, 1):  # floppy ears
            p = HEAD + Vector((0.62*sgn, 0.02, 0.12))
            d = Vector((0.45*sgn, 0, -1)).normalized()
            sphere(p + d*0.12, (0.15, 0.09, 0.3), M('#b8763d'), quat_to(d, 'Z', 'Y'))
        tail_curve([(0, 0.4, 0.45), (0, 0.6, 0.6), (0.05, 0.7, 0.85)], 0.06, col)
        sphere(BODY + Vector((0, -0.37, 0.33)), (0.06, 0.04, 0.06), M('#ffd23f', rough=0.25, coat=1))
    elif name == 'cat':
        col, cream = '#b9a6ec', '#fbf5ff'
        base_body(col, cream, arms); head(col)
        ears_pointy(col, '#ffb3c8', az=0.5, el=0.72, h=0.52, r=0.27)
        eyes(eye, lashes=False); blush()
        sphere(surf(HEAD, HS, 0, -0.14, 1.0), (0.055, 0.035, 0.04), M('#ff8fb0', rough=0.3, coat=1), face_rot(0, -0.14))
        mouth(mth or 'cat', el=-0.21, width=0.11)
        for sgn in (-1, 1):
            for k, de in enumerate((-0.04, 0.04)):
                a = surf(HEAD, HS, 0.33*sgn, -0.15+de, 1.0)
                curve([a, a + Vector((0.28*sgn, -0.04, de*2))], 0.008, M('#6d5aa8'))
        tail_curve([(0.1, 0.4, 0.3), (0.35, 0.6, 0.4), (0.4, 0.55, 0.85), (0.25, 0.5, 1.05)], 0.07, col)
        for z in (0.15, 0.28):  # stripes on forehead
            pass
    elif name == 'bunny':
        col, inner = '#fdeaf1', '#ffa9c1'
        base_body(col, None, arms); head(col)
        for sgn in (-1, 1):
            base = HEAD + Vector((0.26*sgn, 0.02, 0.5)); d = Vector((0.18*sgn, 0.05, 1)).normalized()
            sphere(base + d*0.4, (0.14, 0.08, 0.42), M(col), quat_to(d, 'Z', 'Y'))
            sphere(base + d*0.42 + Vector((0, -0.05, 0)), (0.08, 0.04, 0.32), M(inner), quat_to(d, 'Z', 'Y'))
        eyes(eye); blush(col='#ff8fae')
        sphere(surf(HEAD, HS, 0, -0.13, 1.0), (0.05, 0.035, 0.035), M('#ff7fa3', rough=0.3, coat=1), face_rot(0, -0.13))
        mouth(mth or 'cat', el=-0.2, width=0.09)
        sphere(surf(HEAD, HS, 0, -0.3, 0.995), (0.05, 0.02, 0.05), M('#ffffff', rough=0.3), face_rot(0, -0.3))  # tooth
        sphere((0, 0.45, 0.42), (0.15, 0.15, 0.15), M('#ffffff', rough=0.9, coat=0))
        sphere(BODY + Vector((0, -0.25, -0.05)), (0.3, 0.2, 0.34), M('#ffe3ec'))
    elif name == 'penguin':
        col, white = '#3d5a9e', '#ffffff'
        base_body(col, white, arms, feet_col='#ffa23a'); head(col)
        FC = HEAD + Vector((0, -0.2, -0.05)); FS = Vector((0.58, 0.46, 0.46))
        sphere(FC, FS, M(white))  # face mask
        eyes(eye, el=0.1, az=0.36, C=FC, S=FS); blush(az=0.62, el=-0.1, C=FC, S=FS)
        bk = surf(FC, FS, 0, -0.05, 0.93)
        cone(bk + Vector((0, -0.08, 0)), 0.11, 0.0, 0.18, M('#ffa23a', rough=0.35, coat=0.6), quat_to((0, -1, -0.15), 'Z', 'Y'), verts=12, subsurf=2, scale=(1.2, 0.8, 1))
        if (mth or 'smile') in ('open', 'o'):
            mouth(mth, C=FC, S=FS, el=-0.33)
        elif mth == 'smile':
            mouth('smile', C=FC, S=FS, el=-0.3, width=0.14, bow=0.07)
        sphere(HEAD + Vector((0, 0, 0.6)), (0.07, 0.07, 0.1), M(col))  # tuft
    elif name == 'horse':
        col, mane, muz = '#f7c9a0', '#9b7bea', '#fde7d3'
        base_body(col, None, arms, feet_col='#8a6a55'); head(col)
        M_C = HEAD + Vector((0, -0.52, -0.26)); M_S = Vector((0.36, 0.32, 0.25))
        sphere(M_C, M_S, M(muz))
        for sgn in (-1, 1):
            sphere(surf(M_C, M_S, 0.3*sgn, 0.35, 0.98), (0.035, 0.03, 0.025), M('#8a5a4a'), face_rot(0.3*sgn, 0.35))
        eyes(eye, el=0.12, az=0.4); blush(az=0.7, el=-0.02)
        mouth(mth or 'smile', M_C, M_S, el=-0.15, width=0.35, bow=0.25)
        ears_pointy(col, '#ffb3a8', az=0.5, el=0.8, h=0.4, r=0.17)
        for i in range(8):  # mane along the top of the head and down the neck
            t = i/7; a = math.radians(-35 + 150*t)
            p = HEAD + Vector((0.04, 0.66*math.sin(a), 0.62*math.cos(a)))
            sphere(p, (0.2, 0.17, 0.17), M(mane))
        sphere(surf(HEAD, HS, 0.08, 0.72, 1.02), (0.2, 0.14, 0.15), M(mane))  # forelock
        tail_curve([(0, 0.42, 0.55), (0.05, 0.65, 0.45), (0.1, 0.72, 0.2)], 0.1, mane)
    elif name == 'monkey':
        col, face = '#a8704a', '#ffd9b0'
        base_body(col, face, arms); head(col)
        sphere(HEAD + Vector((0, -0.3, -0.08)), (0.52, 0.36, 0.42), M(face))
        sphere(HEAD + Vector((0, -0.42, -0.22)), (0.3, 0.2, 0.17), M(face))
        ears_round(col, face, az=1.45, el=0.05, r=0.2)
        eyes(eye, el=0.05, az=0.28); blush(az=0.5, el=-0.15)
        MZ_C = HEAD + Vector((0, -0.42, -0.22)); MZ_S = Vector((0.3, 0.2, 0.17))
        for sgn in (-1, 1):
            sphere(surf(MZ_C, MZ_S, 0.12*sgn, 0.45, 1.0), (0.02, 0.02, 0.02), M('#6b3f26'))
        mouth(mth or 'smile', MZ_C, MZ_S, el=-0.05, width=0.45, bow=0.3)
        pts = [(0, 0.42, 0.35), (0.2, 0.7, 0.4)]
        for i in range(12):
            a = i/11*math.pi*1.6; r = 0.2*(1 - i/16)
            pts.append((0.2 + r*math.sin(a), 0.72, 0.62 + r*(-math.cos(a))))
        tail_curve(pts, 0.05, col)
    elif name == 'tiger':
        col, white, stripe = '#ff9a3c', '#fff6ea', '#3b2a3f'
        base_body(col, white, arms); head(col)
        M_C = HEAD + Vector((0, -0.45, -0.2)); M_S = Vector((0.32, 0.2, 0.2))
        sphere(M_C, M_S, M(white))
        sphere(surf(M_C, M_S, 0, 0.45, 0.98), (0.08, 0.05, 0.05), M('#ff7a9a', rough=0.3, coat=1))
        ears_round(col, white, az=0.6, el=0.8, r=0.18)
        eyes(eye, el=0.12); blush(az=0.7, el=-0.05)
        mouth(mth or 'cat', M_C, M_S, el=-0.12, width=0.35, bow=0.3)
        for az in (-0.18, 0.0, 0.18):  # forehead stripes
            sphere(surf(HEAD, HS, az, 0.62 + (0.06 if az == 0 else 0), 0.99), (0.05, 0.02, 0.14), M(stripe), face_rot(az, 0.62))
        for sgn in (-1, 1):
            for el in (0.2, 0.0):
                sphere(surf(HEAD, HS, 1.2*sgn, el, 0.99), (0.14, 0.03, 0.04), M(stripe), face_rot(1.2*sgn, el))
            for z in (0.72, 0.52):
                sphere(surf(BODY, BS, 1.3*sgn, (z-0.62)*2, 0.99), (0.14, 0.03, 0.035), M(stripe), face_rot(1.3*sgn, 0))
        tail_curve([(0, 0.4, 0.35), (0.2, 0.65, 0.4), (0.3, 0.7, 0.75)], 0.07, col)
        sphere((0.3, 0.7, 0.8), (0.08, 0.08, 0.08), M(stripe))
    elif name == 'shark':
        col, white = '#5fa8e8', '#f4fbff'
        base_body(col, white, arms); head(col)
        sphere(HEAD + Vector((0, -0.22, -0.2)), (0.56, 0.44, 0.36), M(white))
        eyes(eye, el=0.14, az=0.36); blush(az=0.62, el=0.0)
        mouth(mth or 'smile', el=-0.12, width=0.22)
        if (mth or 'smile') == 'smile':
            for az in (-0.14, -0.05, 0.05, 0.14):  # tiny friendly teeth
                p = surf(HEAD, HS, az, -0.155 - 0.03*(1 - (az/0.22)**2), 1.0)
                cone(p + Vector((0, -0.01, -0.02)), 0.022, 0, 0.045, M('#ffffff'), quat_to((0, -0.3, -1), 'Z', 'Y'), verts=8)
        cone(HEAD + Vector((0, 0.12, 0.72)), 0.28, 0.02, 0.45, M(col), quat_to((0, 0.35, 1), 'Z', 'Y'), verts=12, subsurf=2, scale=(0.35, 1, 1))
        for sgn in (-1, 1):
            cone(HEAD + Vector((0.66*sgn, 0.05, -0.05)), 0.12, 0.01, 0.25, M(col), quat_to((sgn, 0.2, -0.2), 'Z', 'Y'), verts=10, subsurf=2, scale=(1, 0.35, 1))
        for sgn in (-1, 1):  # tail fin
            cone(Vector((0, 0.62, 0.45)) + Vector((0, 0.1, 0.15*sgn)), 0.14, 0.01, 0.3, M(col), quat_to((0, 0.6, sgn), 'Z', 'Y'), verts=10, subsurf=2, scale=(0.35, 1, 1))
        cyl((0, 0.47, 0.45), 0.12, 0.25, M(col), quat_to((0, 1, 0), 'Z', 'X'))
    elif name == 'pig':
        col, snout = '#ffb3c6', '#ff94b0'
        base_body(col, '#ffd1dd', arms, feet_col='#e9829c'); head(col)
        sn = surf(HEAD, HS, 0, -0.12, 0.93)
        cyl(sn + Vector((0, -0.07, 0)), 0.17, 0.14, M(snout), quat_to((0, -1, 0), 'Z', 'X'), scale=(1.15, 1, 1))
        for sgn in (-1, 1):
            sphere(sn + Vector((0.06*sgn, -0.145, 0)), (0.03, 0.02, 0.045), M('#c85a78'))
        eyes(eye, el=0.14, az=0.34); blush(az=0.6, el=-0.08, col='#ff7fa0')
        mouth(mth or 'smile', el=-0.34, width=0.1)
        for sgn in (-1, 1):
            base = surf(HEAD, HS, 0.55*sgn, 0.8, 0.9); d = Vector((0.5*sgn, -0.55, 0.65)).normalized()
            cone(base + d*0.14, 0.17, 0.0, 0.3, M(col), quat_to(d, 'Z', 'Y'), verts=8, subsurf=2, scale=(1, 0.45, 1))
        pts = [(0, 0.42, 0.45)]
        for i in range(14):
            a = i/13*math.pi*3; pts.append((0.08*math.sin(a), 0.5 + i*0.012, 0.52 + 0.08*math.cos(a)))
        tail_curve(pts, 0.03, col)
    elif name == 'axolotl':
        col, gill = '#ffb0d4', '#ff5fa2'
        base_body(col, '#ffe0ee', arms); head(col)
        HS_save = None
        eyes(eye, el=0.06, az=0.42, size=0.85); blush(az=0.7, el=-0.1)
        mouth(mth or 'smile', el=-0.12, width=0.3)
        for sgn in (-1, 1):
            for k, (el, ln) in enumerate(((0.45, 0.42), (0.1, 0.46), (-0.25, 0.38))):
                base = surf(HEAD, HS, 1.35*sgn, el, 0.92)
                d = Vector((sgn, 0.25, el*1.2 + 0.25)).normalized()
                curve([base, base + d*ln*0.55, base + d*ln], 0.045, M(gill))
                for j in range(3):
                    sphere(base + d*(ln*0.45 + j*0.18*ln), (0.07, 0.07, 0.07), M(gill, rough=0.6))
        cone((0, 0.62, 0.35), 0.25, 0.02, 0.55, M(col), quat_to((0, 1, -0.2), 'Z', 'X'), verts=12, subsurf=2, scale=(0.35, 1, 1))
        for i in range(4):
            sphere(HEAD + Vector((0, 0.35 - 0.25*i, 0.55 + (0.02 if i else 0))), (0.03, 0.03, 0.03), M('#ff8cc0'))
    elif name == 'capybara':
        col, dark = '#c88f5a', '#6a4632'
        base_body(col, '#e2b183', arms); 
        sphere(HEAD, Vector((0.66, 0.66, 0.56)), M(col))
        M_C = HEAD + Vector((0, -0.46, -0.1)); M_S = Vector((0.42, 0.3, 0.32))
        sphere(M_C, M_S, M('#d59f6a'))
        sphere(surf(M_C, M_S, 0, 0.3, 0.99), (0.18, 0.06, 0.08), M(dark))
        ears_round(col, dark, az=0.62, el=1.0, r=0.1)
        eyes(eye if eye != 'open' else 'open', el=0.22, az=0.4, size=0.7)
        blush(az=0.6, el=-0.05)
        mouth(mth or 'smile', M_C, M_S, el=-0.2, width=0.25, bow=0.2)
        sphere(HEAD + Vector((0.05, 0.05, 0.6)), (0.19, 0.19, 0.16), M('#ffa21f', rough=0.55))  # mandarin on head
        cone(HEAD + Vector((0.08, 0.05, 0.78)), 0.07, 0.0, 0.06, M('#4caf50'), quat_to((0.5, 0, 1), 'Z', 'Y'), verts=8, subsurf=1, scale=(1, 0.3, 1))
    elif name == 'dragon':
        col, belly, wing = '#6fd6a6', '#fff0a8', '#b18cff'
        base_body(col, belly, arms); head(col)
        eyes(eye, el=0.06); blush(az=0.64, el=-0.12)
        for sgn in (-1, 1):
            sphere(surf(HEAD, HS, 0.08*sgn, -0.18, 1.0), (0.02, 0.02, 0.02), M('#2e8b64'))
        mouth(mth or 'smile', el=-0.27, width=0.14)
        for sgn in (-1, 1):
            base = surf(HEAD, HS, 0.4*sgn, 0.85, 0.9); d = Vector((0.4*sgn, 0.2, 1)).normalized()
            cone(base + d*0.15, 0.09, 0.0, 0.3, M('#fff3c4'), quat_to(d, 'Z', 'Y'), verts=12, subsurf=1)
            w = Vector((0.35*sgn, 0.4, 0.95)); dw = Vector((sgn, 0.6, 0.5)).normalized()
            sphere(w + dw*0.2, (0.08, 0.3, 0.2), M(wing), quat_to(dw, 'Y', 'Z'))
            sphere(w + dw*0.32 + Vector((0, 0, 0.1)), (0.06, 0.2, 0.14), M(wing), quat_to(dw, 'Y', 'Z'))
        for i, t in enumerate((0.0, 0.3, 0.6)):
            p = surf(HEAD, HS, 0, 0.9 - t*1.3, 1.0) + Vector((0, 0.12 + t*0.1, 0)) if False else None
        for (y, z) in ((0.25, 2.03), (0.5, 1.8), (0.62, 1.52)):
            cone((0, y, z), 0.08, 0.0, 0.16, M(wing), quat_to((0, y, z-1.5), 'Z', 'Y'), verts=10, subsurf=1, scale=(0.5, 1, 1))
        tail_curve([(0, 0.4, 0.35), (0.25, 0.7, 0.3), (0.45, 0.8, 0.5)], 0.08, col)
        cone((0.5, 0.82, 0.58), 0.1, 0.0, 0.18, M(wing), quat_to((0.3, 0.2, 1), 'Z', 'Y'), verts=10, subsurf=1, scale=(0.5, 1, 1))
    else:
        raise ValueError(name)

ANIMALS = ['dog', 'cat', 'bunny', 'penguin', 'horse', 'monkey', 'tiger', 'shark', 'pig', 'axolotl', 'capybara', 'dragon']

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
    # happy
    make_character('penguin', (xs[0], 0, 0), yaw=-15, eye='open', mth='open')
    # cheering: arms up, happy eyes, open mouth, sparkles
    make_character('penguin', (xs[1], 0, 0), yaw=-5, eye='happy', mth='open', arms='up')
    for (dx, dz, s) in ((-0.85, 2.35, 0.2), (0.9, 2.25, 0.16), (-0.95, 1.55, 0.12), (0.95, 1.6, 0.13)):
        star((xs[1] + dx, -0.4, dz), s, M('#ffd23f', rough=0.2, coat=1, emit=0.4))
    # sleepy
    r = make_character('penguin', (xs[2], 0, 0), yaw=0, eye='sleepy', mth='o')
    r.rotation_euler = (0, math.radians(8), 0)
    nightcap = M('#8f7cf0')
    cone((xs[2] - 0.05, 0, 2.15), 0.45, 0.02, 0.8, nightcap, quat_to((-0.5, 0.1, 1), 'Z', 'Y'), verts=32)
    sphere((xs[2] - 0.3, 0.05, 2.55), (0.11, 0.11, 0.11), M('#ffffff', rough=0.9, coat=0))
    zm = M('#8f7cf0', rough=0.3)
    for (dx, dz, s) in ((0.7, 2.0, 0.28), (0.95, 2.35, 0.36), (1.2, 2.75, 0.44)):
        text('z', (xs[2] + dx, -0.2, dz), s, zm)
    # proud: happy eyes, smile, medal
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
