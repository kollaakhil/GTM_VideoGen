"""
Scene kit: photoreal hero shots built in Blender (5.x, EEVEE), driven by a JSON shot spec. Free and local.

  Blender -b --factory-startup -P scripts/blender/scene_kit.py -- --spec shot.json --out /tmp/frames [--still]

The kit is one "lab" world in a black void: a smoked-glass panel standing on a brushed-metal plinth, with glass
gas-discharge traces inlaid in its face, etched (diegetic) text, and a brass toggle that closes the circuit. Shots pick a
camera preset, which traces are lit or ignite (and when), the toggle timing and the haze. The craft rules from the
Neon reference (PLAYBOOK "What makes a great video") are built into the kit, not left to prompts: every camera is a
slow continuous push-in, macro presets use a long lens at a wide aperture (shallow depth of field), the world is a void
that falls to black, light comes from the practicals (the glowing gas) plus a cool rim, the scene is neutral so only
the gas colour pops, glass carries droplets and the metal carries micro-scratches, and a volumetric haze catches the glow.

Spec (all optional except camera):
  {"seconds": 2, "fps": 24, "width": 960, "height": 540, "samples": 32,
   "camera": {"preset": "macro_text|macro_contact|macro_trace|wide|top", "fstop": 2.0, "push": 0.12, "trace": 0, "at": 0.5},
   "labels": [{"text": "Ne", "x": -0.3, "z": 0.38, "size": 0.09}],
   "traces": [{"preset": "depth|speed|ring|signal", "color": "#ff3b1a", "ignite": 0.4, "fill": 0.9}],   # ignite < 0 = lit from the start, null = unlit
   "toggle": {"close": 0.35}, "haze": 0.03, "exposure": 0.0}
"""
import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
args = {"--still": False}
i = 0
while i < len(argv):
    if argv[i] == "--still":
        args["--still"] = True; i += 1
    else:
        args[argv[i]] = argv[i + 1]; i += 2
SPEC = json.load(open(args["--spec"]))
OUT = args["--out"]
FPS = int(SPEC.get("fps", 24))
SECONDS = float(SPEC.get("seconds", 2))
FRAMES = max(2, round(SECONDS * FPS))
W, H = int(SPEC.get("width", 960)), int(SPEC.get("height", 540))

PANEL_W, PANEL_H, PANEL_D = 0.8, 0.5, 0.03
PANEL_Z0 = 0.06  # plinth height
FACE_Y = -PANEL_D / 2
TUBE_Y = FACE_Y - 0.03  # tubes float on standoffs in front of the backer, like a real neon sign
TUBE_R = 0.007


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[k:k + 2], 16) / 255 for k in (0, 2, 4))


def lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, (1 if args["--still"] else FRAMES)
scene.render.use_overwrite = False  # resume: frames already on disk are kept (the caller wipes the dir when the spec changes)
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
ee = scene.eevee
for k, v in (("taa_render_samples", int(SPEC.get("samples", 32))), ("use_raytracing", True), ("volumetric_tile_size", "4"),
             ("volumetric_samples", 48), ("volumetric_end", 6.0), ("use_shadows", True), ("fast_gi_method", "GLOBAL_ILLUMINATION")):
    try:
        setattr(ee, k, v)
    except Exception:
        pass
scene.render.use_motion_blur = bool(SPEC.get("motion_blur", True))
try:
    scene.render.motion_blur_shutter = 0.5
except Exception:
    pass
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "Medium High Contrast", "AgX - Punchy", "Punchy"):
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        continue
scene.view_settings.exposure = float(SPEC.get("exposure", 0.0))
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = f"{OUT}/f_"
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"

# ---------- world: a void that falls off to black, with haze that catches the glow ----------
world = bpy.data.worlds.new("void")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wn["Background"].inputs["Color"].default_value = (0.0005, 0.0005, 0.0007, 1)
wn["Background"].inputs["Strength"].default_value = 1.0
haze = float(SPEC.get("haze", 0.03))


def mat(name, **p):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    for k, v in p.items():
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m, b


def add_scratches(m, b, scale=(220.0, 6.0, 6.0), amount=0.12, base_rough=0.3):
    """Micro-scratches: stretched noise into roughness plus a faint bump (tactile imperfection)."""
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 8.0
    rmp = nt.nodes.new("ShaderNodeMapRange")
    rmp.inputs["To Min"].default_value = base_rough - amount
    rmp.inputs["To Max"].default_value = base_rough + amount
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.05
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], rmp.inputs["Value"])
    nt.links.new(rmp.outputs[0], b.inputs["Roughness"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])


def add_droplets(m, b, scale=180.0):
    """Condensation droplets on glass: voronoi cells into bump and roughness."""
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vo = nt.nodes.new("ShaderNodeTexVoronoi")
    vo.inputs["Scale"].default_value = scale
    try:
        vo.inputs["Randomness"].default_value = 1.0
    except Exception:
        pass
    vo.feature = "F1"
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].position = 0.12
    cr.color_ramp.elements[1].position = 0.28
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.invert = True
    nt.links.new(tc.outputs["Object"], vo.inputs["Vector"])
    nt.links.new(vo.outputs["Distance"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = 0.02
    mr.inputs["To Max"].default_value = 0.18
    nt.links.new(cr.outputs["Color"], mr.inputs["Value"])
    nt.links.new(mr.outputs[0], b.inputs["Roughness"])


def box(name, size, loc, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bev = o.modifiers.new("bevel", "BEVEL")
    bev.width = 0.002
    bev.segments = 3
    o.data.materials.append(m)
    return o


# ---------- set ----------
if haze > 0:
    hm = bpy.data.materials.new("haze")
    hm.use_nodes = True
    hn = hm.node_tree.nodes
    hn.remove(hn["Principled BSDF"])
    vs = hn.new("ShaderNodeVolumeScatter")
    vs.inputs["Density"].default_value = haze
    vs.inputs["Anisotropy"].default_value = 0.6
    hm.node_tree.links.new(vs.outputs[0], hn["Material Output"].inputs["Volume"])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.1, -0.25, 0.4))
    hb = bpy.context.object
    hb.name = "haze"
    hb.scale = (1.6, 0.9, 0.8)
    hb.data.materials.append(hm)

floor_m, floor_b = mat("floor", **{"Base Color": (0.006, 0.006, 0.007, 1), "Roughness": 0.16})
add_scratches(floor_m, floor_b, scale=(30.0, 30.0, 30.0), amount=0.025, base_rough=0.14)
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
bpy.context.object.data.materials.append(floor_m)

plinth_m, plinth_b = mat("plinth", **{"Base Color": (0.05, 0.05, 0.055, 1), "Metallic": 1.0, "Roughness": 0.32})
add_scratches(plinth_m, plinth_b, base_rough=0.32)
box("plinth", (PANEL_W + 0.24, 0.16, PANEL_Z0), (0, 0, PANEL_Z0 / 2), plinth_m)

glass_m, glass_b = mat("smoked_glass", **{"Base Color": (0.012, 0.012, 0.014, 1), "Roughness": 0.05, "Specular IOR Level": 0.6, "Coat Weight": 1.0, "Coat Roughness": 0.03})
add_scratches(glass_m, glass_b, scale=(60.0, 60.0, 60.0), amount=0.03, base_rough=0.06)
panel = box("panel", (PANEL_W, PANEL_D, PANEL_H), (0, 0, PANEL_Z0 + PANEL_H / 2), glass_m)

# Etched (diegetic) text: frosted glass catching the rim light.
etch_m, _ = mat("etch", **{"Base Color": (0.55, 0.56, 0.58, 1), "Roughness": 0.55})
for lab in SPEC.get("labels", []):
    cu = bpy.data.curves.new("label", "FONT")
    cu.body = lab["text"]
    cu.size = float(lab.get("size", 0.05))
    cu.extrude = 0.0003
    cu.align_x = lab.get("align", "LEFT")
    try:
        cu.font = bpy.data.fonts.load(lab.get("font", "/System/Library/Fonts/Helvetica.ttc"))
    except Exception:
        pass
    o = bpy.data.objects.new("label", cu)
    scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = (float(lab.get("x", 0)), FACE_Y - 0.0004, PANEL_Z0 + float(lab.get("z", 0.4)))
    cu.materials.append(etch_m)

# ---------- traces: glass tubes inlaid in the face, a gas core that fills from the contact ----------
X0, X1, Z0, Z1 = -PANEL_W / 2 + 0.05, PANEL_W / 2 - 0.05, 0.05, PANEL_H - 0.05


def preset(name):
    if name == "speed":   # one fast, nearly straight run
        return [(X0, 0.30), (-0.05, 0.30), (0.0, 0.25), (X1, 0.25)]
    if name == "depth":   # a long serpentine: depth
        pts, z, left = [(X0, 0.12)], 0.12, True
        for k in range(4):
            x = X1 - 0.02 if left else X0 + 0.12
            pts.append((x, z))
            z += 0.07
            pts.append((x, z))
            left = not left
        pts.append((0.05, z))
        return pts
    if name == "ring":    # a frame around the element mark (upper left)
        return [(X0 - 0.01, 0.44), (X0 - 0.01, 0.30), (X0 + 0.19, 0.30), (X0 + 0.19, 0.46), (X0, 0.46)]
    if name == "signal":  # a waveform across the middle
        return [(X0 + k * (X1 - X0) / 40, 0.22 + 0.05 * math.sin(k * 0.7) * math.exp(-((k - 20) / 12) ** 2)) for k in range(41)]
    raise ValueError(name)


def path_points(t):
    pts = t.get("points") or preset(t.get("preset", "speed"))
    return [Vector((x, TUBE_Y, PANEL_Z0 + z)) for x, z in pts]


tube_m, tube_b = mat("tube_glass", **{"Base Color": (0.9, 0.92, 0.95, 1), "Roughness": 0.03, "Alpha": 0.22, "Coat Weight": 1.0})
try:
    tube_m.surface_render_method = "BLENDED"
except Exception:
    pass
add_droplets(tube_m, tube_b, scale=900.0)


def curve_obj(name, pts, radius, m):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts):
        p.co = (v.x, v.y, v.z, 1)
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    cu.materials.append(m)
    return o, cu


def sample(pts, n):
    segs = [(a, b, (b - a).length) for a, b in zip(pts, pts[1:])]
    L = sum(s[2] for s in segs)
    out = []
    for k in range(n):
        d = L * (k + 0.5) / n
        for a, b, l in segs:
            if d <= l:
                out.append((a.lerp(b, d / l), (k + 0.5) / n))
                break
            d -= l
    return out, L


boot_m, _ = mat("boot", **{"Base Color": (0.01, 0.01, 0.01, 1), "Roughness": 0.45})
standoff_m, standoff_b = mat("standoff", **{"Base Color": (0.9, 0.9, 0.9, 1), "Roughness": 0.08, "Alpha": 0.35})
try:
    standoff_m.surface_render_method = "BLENDED"
except Exception:
    pass


def cyl(a, b, r, m):
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=24)
    o = bpy.context.object
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    o.data.materials.append(m)
    bev = o.modifiers.new("bevel", "BEVEL")
    bev.width = r * 0.3
    bev.segments = 2
    return o


def hardware(pts):
    """Real sign hardware: black rubber electrode boots on both ends, clear standoffs to the backer."""
    for a, b in ((pts[0], pts[1]), (pts[-1], pts[-2])):
        d = (b - a).normalized()
        cyl(a - d * 0.035, a + d * 0.004, TUBE_R * 1.9, boot_m)
        cyl(a - d * 0.03 + Vector((0, 0.0, 0)), a - d * 0.03 + Vector((0, -TUBE_Y + FACE_Y, 0)), TUBE_R * 0.5, boot_m)
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += (b - a).length
        if acc > 0.18:
            acc = 0.0
            cyl(b + Vector((0, TUBE_R, 0)), Vector((b.x, FACE_Y, b.z)), 0.004, standoff_m)


def f(t):  # seconds -> frame
    return 1 + t * FPS


def word_tube(name, text, x, z, size, radius, m):
    """Outline neon lettering: the word's glyph outlines become bent glass tube (real block-letter neon)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    try:
        cu.font = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf")
    except Exception:
        pass
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target="CURVE")
    o = bpy.context.object
    o.data.dimensions = "3D"
    o.data.bevel_depth = radius
    o.data.bevel_resolution = 6
    o.data.fill_mode = "FULL"
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = (x, TUBE_Y, PANEL_Z0 + z)
    o.data.materials.clear()
    o.data.materials.append(m)
    o.select_set(False)
    return o


trace_pts = []
for ti, t in enumerate(SPEC.get("traces", [])):
    if t.get("word"):
        col = lin(hex_rgb(t.get("color", "#ff3b1a")))
        word_tube(f"wtube{ti}", t["word"], t.get("x", 0.0), t.get("z", 0.18), t.get("size", 0.2), TUBE_R, tube_m)
        core_m, core_b = mat(f"wcore{ti}", **{"Base Color": (0.2, 0.2, 0.2, 1), "Emission Color": (*col, 1), "Emission Strength": 0.0})
        word_tube(f"wcore{ti}", t["word"], t.get("x", 0.0), t.get("z", 0.18), t.get("size", 0.2), TUBE_R * 0.55, core_m)
        x, z, sz = t.get("x", 0.0), t.get("z", 0.18), t.get("size", 0.2)
        pts = [Vector((x - sz * 0.9 + k * sz * 0.45, TUBE_Y, PANEL_Z0 + z + sz * 0.35)) for k in range(5)]
        trace_pts.append(pts)
        em = core_b.inputs["Emission Strength"]
        ign, strength = t.get("ignite", None), float(t.get("strength", 30.0))
        lamps = []
        for k, p in enumerate(pts):
            ld = bpy.data.lights.new(f"wgas{ti}_{k}", "POINT")
            ld.color, ld.shadow_soft_size = col, 0.12
            try:
                ld.use_shadow = False
                ld.volume_factor = 0.12
                ld.specular_factor = 0.0
            except Exception:
                pass
            lo = bpy.data.objects.new(f"wgas{ti}_{k}", ld)
            lo.location = p + Vector((0, -0.09, 0))
            scene.collection.objects.link(lo)
            lamps.append(ld)
        lw = float(t.get("lamp", 0.8))
        if ign is None:
            for ld in lamps:
                ld.energy = 0
        elif ign < 0:
            em.default_value = strength
            for ld in lamps:
                ld.energy = lw
        else:
            for fr, v in ((f(ign) - 1, 0.0), (f(ign), strength * 1.6), (f(ign) + 1, strength * 0.25), (f(ign) + 2, strength * 1.3), (f(ign) + 3, strength * 0.5), (f(ign) + 4, strength)):
                em.default_value = v
                em.keyframe_insert("default_value", frame=fr)
                for ld in lamps:
                    ld.energy = lw * v / strength
                    ld.keyframe_insert("energy", frame=fr)
        continue
    pts = path_points(t)
    trace_pts.append(pts)
    col = lin(hex_rgb(t.get("color", "#ff3b1a")))
    curve_obj(f"tube{ti}", pts, TUBE_R, tube_m)
    hardware(pts)
    core_m, core_b = mat(f"core{ti}", **{"Base Color": (0.2, 0.2, 0.2, 1), "Emission Color": (*col, 1), "Emission Strength": 0.0})
    core, cu = curve_obj(f"core{ti}", pts, TUBE_R * 0.55, core_m)
    cu.bevel_factor_mapping_end = "SPLINE"
    ign = t.get("ignite", None)
    fill = float(t.get("fill", 0.0))
    strength = float(t.get("strength", 30.0))
    em = core_b.inputs["Emission Strength"]
    lights, L = sample(pts, int(t.get("lamps", 4)))
    lamp_objs = []
    for k, (p, u) in enumerate(lights):
        ld = bpy.data.lights.new(f"gas{ti}_{k}", "POINT")
        ld.color = col
        ld.shadow_soft_size = 0.12
        try:
            ld.use_shadow = False
            ld.volume_factor = 0.12
            ld.specular_factor = 0.0
        except Exception:
            pass
        lo = bpy.data.objects.new(f"gas{ti}_{k}", ld)
        lo.location = p + Vector((0, -0.09, 0))
        scene.collection.objects.link(lo)
        lamp_objs.append((ld, u))
    lamp_w = float(t.get("lamp", 0.8))
    if ign is None:
        cu.bevel_factor_end = 0.0
        for ld, _ in lamp_objs:
            ld.energy = 0
    elif ign < 0:
        cu.bevel_factor_end = 1.0
        em.default_value = strength
        for ld, _ in lamp_objs:
            ld.energy = lamp_w
    else:
        # Striking: the gas flickers at the electrode, then the glow front runs down the tube.
        if "fill" in t:
            cu.bevel_factor_end = 0.0
            cu.keyframe_insert("bevel_factor_end", frame=f(ign))
            cu.bevel_factor_end = 1.0
            cu.keyframe_insert("bevel_factor_end", frame=f(ign + fill))
        else:
            fill = 0.0
            cu.bevel_factor_end = 1.0
        for fr, v in ((f(ign) - 1, 0.0), (f(ign), strength * 1.6), (f(ign) + 1, strength * 0.25), (f(ign) + 2, strength * 1.3), (f(ign) + 3, strength * 0.5), (f(ign) + 4, strength)):
            em.default_value = v
            em.keyframe_insert("default_value", frame=fr)
        for ld, u in lamp_objs:
            on = f(ign + fill * u)
            ld.energy = 0
            ld.keyframe_insert("energy", frame=on - 1)
            ld.energy = lamp_w * 1.5
            ld.keyframe_insert("energy", frame=on)
            ld.energy = lamp_w
            ld.keyframe_insert("energy", frame=on + 3)

# ---------- toggle: brass lever that closes the circuit (the trigger) ----------
brass_m, brass_b = mat("brass", **{"Base Color": (0.78, 0.55, 0.26, 1), "Metallic": 1.0, "Roughness": 0.22})
add_scratches(brass_m, brass_b, scale=(400.0, 8.0, 8.0), base_rough=0.24, amount=0.05)
XF = Vector((-PANEL_W / 2 - 0.2, -0.06, 0.0))  # transformer box on the floor, left of the sign
xf_m, xf_b = mat("crinkle", **{"Base Color": (0.035, 0.036, 0.04, 1), "Metallic": 0.6, "Roughness": 0.5})
add_scratches(xf_m, xf_b, scale=(40.0, 40.0, 40.0), amount=0.12, base_rough=0.5)
box("transformer", (0.2, 0.13, 0.11), XF + Vector((0, 0, 0.055)), xf_m)
PLATE_C = XF + Vector((0, -0.066, 0.055))
box("nameplate", (0.15, 0.002, 0.07), PLATE_C, brass_m)
ink_m, _ = mat("engrave_fill", **{"Base Color": (0.012, 0.01, 0.008, 1), "Roughness": 0.6})
for k, line in enumerate(SPEC.get("plate", ["NE 10", "15 kV  30 mA"])):
    cu = bpy.data.curves.new("plate_text", "FONT")
    cu.body = line
    cu.size = 0.022 if k == 0 else 0.013
    cu.extrude = 0.0002
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    try:
        cu.font = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/Courier New Bold.ttf")
    except Exception:
        pass
    o = bpy.data.objects.new("plate_text", cu)
    scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = PLATE_C + Vector((0, -0.0013, 0.014 - k * 0.026))
    cu.materials.append(ink_m)
TOG = XF + Vector((0.04, 0.0, 0.11))
box("toggle_base", (0.05, 0.07, 0.008), TOG + Vector((0, 0, 0.004)), brass_m)
bpy.ops.mesh.primitive_cylinder_add(radius=0.006, depth=0.016, location=TOG + Vector((0, 0, 0.012)), rotation=(0, math.radians(90), 0))
bpy.context.object.data.materials.append(brass_m)
pivot = bpy.data.objects.new("lever_pivot", None)
scene.collection.objects.link(pivot)
pivot.location = TOG + Vector((0, 0, 0.012))
bpy.ops.mesh.primitive_cylinder_add(radius=0.0032, depth=0.05, location=(0, 0, 0.025))
lever = bpy.context.object
lever.data.materials.append(brass_m)
lever.parent = pivot
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0065, location=(0, 0, 0.05))
knob = bpy.context.object
blk_m, _ = mat("bakelite", **{"Base Color": (0.015, 0.012, 0.01, 1), "Roughness": 0.18, "Coat Weight": 1.0})
knob.data.materials.append(blk_m)
knob.parent = pivot
tg = SPEC.get("toggle")
OPEN, CLOSED = math.radians(-38), math.radians(38)
pivot.rotation_euler = (OPEN if tg else CLOSED, 0, 0)
spark_l = bpy.data.lights.new("spark", "POINT")
spark_l.color = (0.75, 0.85, 1.0)
spark_l.shadow_soft_size = 0.002
spark_l.energy = 0
spark = bpy.data.objects.new("spark", spark_l)
spark.location = TOG + Vector((0.0, 0.0, 0.03))
scene.collection.objects.link(spark)
if tg:
    c = float(tg.get("close", 0.4))
    pivot.keyframe_insert("rotation_euler", frame=f(c) - 3)
    pivot.rotation_euler = (CLOSED + math.radians(4), 0, 0)
    pivot.keyframe_insert("rotation_euler", frame=f(c))
    pivot.rotation_euler = (CLOSED, 0, 0)
    pivot.keyframe_insert("rotation_euler", frame=f(c) + 2)
    for fr, v in ((f(c) - 1, 0), (f(c), 60), (f(c) + 1, 15), (f(c) + 2, 40), (f(c) + 4, 0)):
        spark_l.energy = v
        spark_l.keyframe_insert("energy", frame=fr)

# ---------- light: cool rim from behind, a whisper of top light for the etching ----------
def area(name, loc, energy, size, color, target):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.size, ld.color = energy, size, color
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    scene.collection.objects.link(o)
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o


def spot(name, loc, energy, angle, color, target, soft=0.05):
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy, ld.spot_size, ld.spot_blend, ld.color, ld.shadow_soft_size = energy, math.radians(angle), 0.6, color, soft
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    scene.collection.objects.link(o)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o


rim = float(SPEC.get("rim", 70))
spot("rim_l", (-1.1, 0.9, 0.9), rim, 35, (0.78, 0.86, 1.0), (-0.3, 0, 0.3))
spot("rim_r", (1.1, 0.8, 0.7), rim * 0.7, 35, (0.78, 0.86, 1.0), (0.3, 0, 0.3))
area("top", (0, -0.4, 1.3), float(SPEC.get("top", 2)), 0.8, (1.0, 0.97, 0.94), (0, 0, 0.3))

# ---------- camera: every shot is a slow continuous push-in ----------
cam_spec = SPEC["camera"]
cd = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
p = cam_spec.get("preset", "wide")
mid = Vector((0, FACE_Y, PANEL_Z0 + PANEL_H / 2))
if p == "macro_plate":
    tgt = PLATE_C + Vector((0, 0, 0.004))
    start, lens = tgt + Vector((-0.2, -0.24, 0.05)), 100
elif p == "macro_text":
    lab = (SPEC.get("labels") or [{"x": -0.3, "z": 0.38, "size": 0.09}])[int(cam_spec.get("label", 0))]
    tgt = Vector((float(lab["x"]) + float(lab.get("size", 0.05)) * 0.6, FACE_Y, PANEL_Z0 + float(lab["z"]) + float(lab.get("size", 0.05)) * 0.35))
    start, lens = tgt + Vector((-0.07, -0.2, 0.02)), 100
elif p == "macro_contact":
    tgt = TOG + Vector((0, 0, 0.025))
    start, lens = tgt + Vector((0.12, -0.16, 0.05)), 100
elif p == "macro_trace":
    pts = trace_pts[int(cam_spec.get("trace", 0))]
    tgt = sample(pts, 50)[0][min(49, int(float(cam_spec.get("at", 0.3)) * 50))][0]
    start, lens = tgt + Vector((-0.2, -0.24, 0.06)), 100
elif p == "top":
    tgt = mid
    start, lens = mid + Vector((0.0, -0.9, 0.9)), 50
else:  # wide
    tgt = mid + Vector((0, 0, -0.04))
    start, lens = mid + Vector((0.25, -2.3, -0.05)), 50
if p.startswith("macro") or cam_spec.get("kicker"):
    # Placed near the mirror direction of the camera so metal and glass catch a broad highlight that slides as we push in.
    view = (start - tgt).normalized()
    area("kicker", tgt + view * 0.32 + Vector((0.06, 0.0, 0.16)), float(cam_spec.get("kicker", 1.2 if p == "macro_trace" else 6.0)), 0.3, (1.0, 0.96, 0.9), tgt)
cd.lens = float(cam_spec.get("lens", lens))
cd.sensor_width = 36
cd.clip_start = 0.005
cd.dof.use_dof = True
cd.dof.aperture_fstop = float(cam_spec.get("fstop", 4.5 if p == "macro_plate" else 2.0 if p.startswith("macro") else 4.0))
focus = bpy.data.objects.new("focus", None)
scene.collection.objects.link(focus)
focus.location = tgt
cd.dof.focus_object = focus
start = Vector(cam_spec["from"]) if "from" in cam_spec else start
push = float(cam_spec.get("push", 0.12))
end = start.lerp(tgt, push)
drift = Vector(cam_spec.get("drift", (0.0, 0.0, 0.0)))
for fr, pos in ((1, start), (FRAMES, end + drift)):
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert("location", frame=fr)
    cam.keyframe_insert("rotation_euler", frame=fr)

if args["--still"]:
    scene.frame_set(int(f(float(SPEC.get("still_at", SECONDS * 0.8)))))
    scene.render.filepath = f"{OUT}/still.png"
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
