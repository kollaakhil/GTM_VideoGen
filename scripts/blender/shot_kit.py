"""
Shot kit: generic Blender (5.x, EEVEE) hero-shot templates driven by one shot-sheet row. Free and local.

  Blender -b --factory-startup -P scripts/blender/shot_kit.py -- --spec shot.json --out /tmp/frames [--still]

Templates (spec["template"]):
  glow_word     neon tube lettering (spec["word"]) on a dark brushed backer; strikes on at spec["ignite"] seconds
  macro_label   extreme macro of engraved text (spec["label"]) on scratched brushed metal, raking light
  product_hero  the real product photo (spec["image"]) as a standing cut-out card on a glossy black floor, rim lit
  glb_turntable a 3D-generated mesh (spec["glb"], e.g. Hunyuan3D) on the black floor, slow orbit

The craft rules are built in, not prompted (PLAYBOOK 14.4): a black void, light from the practicals plus a cool rim,
shallow depth of field on macro lenses, micro-scratches on metal, and a slow continuous camera move:
  spec["camera"] = {"move": "push|pull|orbit|static", "amount": 0.15, "lens": 85, "fstop": 2.0, "angle": "eye|low|high|top"}
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
MODE = SPEC.get("mode", "final")
FPS = int(SPEC.get("fps", 24))
SECONDS = float(SPEC.get("seconds", 2))
FRAMES = max(2, round(SECONDS * FPS))
W, H = int(SPEC.get("width", 1280)), int(SPEC.get("height", 720))
T = SPEC.get("template", "glow_word")


def hex_rgb(h):
    h = h.lstrip("#")
    c = tuple(int(h[k:k + 2], 16) / 255 for k in (0, 2, 4))
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def f(t):
    return max(1, round(float(t) * FPS) + 1)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, (1 if args["--still"] else FRAMES)
scene.render.use_overwrite = False
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
samples = int(SPEC.get("samples", 16 if MODE == "final" else 8))
use_raytracing = MODE == "final"
for k, v in (("taa_render_samples", samples), ("use_raytracing", use_raytracing), ("use_shadows", True)):
    try:
        setattr(scene.eevee, k, v)
    except Exception:
        pass
scene.view_settings.view_transform = "AgX"
grade = SPEC.get("grade", "AgX - Medium High Contrast")
grade_fallbacks = [grade, "Medium High Contrast", "AgX - Punchy", "Punchy", "AgX - Base Contrast", "None"]
for look in grade_fallbacks:
    try:
        scene.view_settings.look = look
        break
    except TypeError:
        continue
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = f"{OUT}/f_"
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"

world = bpy.data.worlds.new("void")
scene.world = world
world.use_nodes = True
bg_color = SPEC.get("background") or (0.0004, 0.0004, 0.0006, 1)
if isinstance(bg_color, str):
    bg_color = (*hex_rgb(bg_color), 1)
world.node_tree.nodes["Background"].inputs["Color"].default_value = bg_color


def mat(name, **p):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    for k, v in p.items():
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m, b


def scratches(m, b, scale=(260.0, 5.0, 5.0), base=0.3, amount=0.1):
    nt = m.node_tree
    tc, mp, nz = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeMapping"), nt.nodes.new("ShaderNodeTexNoise")
    mp.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 8.0
    rmp, bump = nt.nodes.new("ShaderNodeMapRange"), nt.nodes.new("ShaderNodeBump")
    rmp.inputs["To Min"].default_value, rmp.inputs["To Max"].default_value = base - amount, base + amount
    bump.inputs["Strength"].default_value = 0.06
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], rmp.inputs["Value"])
    nt.links.new(rmp.outputs[0], b.inputs["Roughness"])
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])


def light(kind, name, loc, energy, color, target, size=0.3, angle=40):
    ld = bpy.data.lights.new(name, kind)
    ld.energy, ld.color = energy, color
    if kind == "AREA":
        ld.size = size
    if kind == "SPOT":
        ld.spot_size, ld.spot_blend = math.radians(angle), 0.6
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    scene.collection.objects.link(o)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ld


def text_obj(name, body, size, loc, m, font, extrude=0.0, rot=(90, 0, 0)):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.extrude = body, size, extrude
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    try:
        cu.font = bpy.data.fonts.load(font)
    except Exception:
        pass
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    o.rotation_euler = tuple(math.radians(a) for a in rot)
    o.location = loc
    cu.materials.append(m)
    return o


floor_m, floor_b = mat("floor", **{"Base Color": (0.005, 0.005, 0.006, 1), "Roughness": 0.12})
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
bpy.context.object.data.materials.append(floor_m)

col = hex_rgb(SPEC.get("color", "#ff3b1a"))
target = Vector((0, 0, 0.25))
macro = False

if T == "glow_word":
    backer_m, backer_b = mat("backer", **{"Base Color": (0.02, 0.02, 0.022, 1), "Metallic": 1.0, "Roughness": 0.35})
    scratches(backer_m, backer_b)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.06, 0.3))
    bk = bpy.context.object
    bk.scale = (1.4, 0.02, 0.55)
    bk.data.materials.append(backer_m)
    word = SPEC.get("word", "neon")[:24]
    size = min(0.32, 1.1 / max(3, len(word)) * 1.6)
    glass_m, _ = mat("tube_glass", **{"Base Color": (0.9, 0.9, 0.9, 1), "Roughness": 0.05, "Transmission Weight": 1.0})
    core_m, core_b = mat("core", **{"Base Color": (0.2, 0.2, 0.2, 1), "Emission Color": (*col, 1), "Emission Strength": 0.0})
    font_path = SPEC.get("fontPath", "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf")
    for nm, m, rad in (("tube", glass_m, 0.007), ("core", core_m, 0.0045)):
        o = text_obj(nm, word, size, (0, 0.0, 0.3), m, font_path)
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.convert(target="CURVE")
        o = bpy.context.object
        o.data.dimensions, o.data.bevel_depth, o.data.fill_mode = "3D", rad, "FULL"
        o.data.bevel_resolution = 4
        o.select_set(False)
    em = core_b.inputs["Emission Strength"]
    lamps = []
    for k in range(4):
        ld = bpy.data.lights.new(f"gas{k}", "POINT")
        ld.color, ld.shadow_soft_size = col, 0.15
        lo = bpy.data.objects.new(f"gas{k}", ld)
        lo.location = (-0.45 + k * 0.3, -0.05, 0.3)
        scene.collection.objects.link(lo)
        lamps.append(ld)
    ign, strength = SPEC.get("ignite", -1), 60.0
    if ign is None or float(ign) < 0:
        em.default_value = strength
        for ld in lamps:
            ld.energy = 1.2
    else:
        for fr, v in ((f(ign) - 1, 0.0), (f(ign), strength * 1.6), (f(ign) + 1, strength * 0.2), (f(ign) + 2, strength * 1.3), (f(ign) + 4, strength)):
            em.default_value = v
            em.keyframe_insert("default_value", frame=fr)
            for ld in lamps:
                ld.energy = 1.2 * v / strength
                ld.keyframe_insert("energy", frame=fr)
    target = Vector((0, 0, 0.3))
elif T == "macro_label":
    macro = True
    metal_color = SPEC.get("materialColor") or (0.42, 0.33, 0.2, 1)
    if isinstance(metal_color, str):
        metal_color = (*hex_rgb(metal_color), 1)
    metal_m, metal_b = mat("brushed", **{"Base Color": metal_color, "Metallic": 1.0, "Roughness": 0.3})
    scratches(metal_m, metal_b, scale=(500.0, 6.0, 6.0), base=0.28, amount=0.08)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.004, 0.25))
    pl = bpy.context.object
    pl.scale = (0.3, 0.006, 0.12)
    pl.data.materials.append(metal_m)
    ink_m, _ = mat("engrave", **{"Base Color": (0.01, 0.009, 0.008, 1), "Roughness": 0.7})
    font_path = SPEC.get("fontPath", "/System/Library/Fonts/Supplemental/Courier New Bold.ttf")
    text_obj("label", SPEC.get("label", "LABEL")[:40], 0.022, (0, -0.0003, 0.25), ink_m, font_path, 0.0002)
    light("AREA", "rake", (-0.35, -0.12, 0.3), 4, (1.0, 0.95, 0.88), (0, 0, 0.25), 0.15)
    target = Vector((0, 0, 0.25))
elif T == "product_hero":
    img = SPEC.get("image")
    card_m, card_b = mat("product", **{"Roughness": 0.35})
    aspect = 0.5
    if img:
        im = bpy.data.images.load(img)
        aspect = im.size[0] / max(1, im.size[1])
        nt = card_m.node_tree
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = im
        nt.links.new(tx.outputs["Color"], card_b.inputs["Base Color"])
        nt.links.new(tx.outputs["Alpha"], card_b.inputs["Alpha"])
        try:
            card_m.blend_method = "HASHED"
        except Exception:
            pass
    else:
        card_b.inputs["Base Color"].default_value = (0.05, 0.05, 0.06, 1)
    hgt = 0.5
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, hgt / 2), rotation=(math.radians(90), 0, 0))
    cd = bpy.context.object
    cd.scale = (hgt * aspect, hgt, 1)
    cd.data.materials.append(card_m)
    light("AREA", "key", (-0.6, -0.9, 0.7), 40, (1.0, 0.97, 0.94), (0, 0, hgt / 2), 0.8)
    target = Vector((0, 0, hgt / 2))
elif T == "glb_turntable":
    bpy.ops.import_scene.gltf(filepath=SPEC["glb"])
    objs = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if objs:
        mn = Vector((min(min((o.matrix_world @ Vector(c))[k] for c in o.bound_box) for o in objs) for k in range(3)))
        mx = Vector((max(max((o.matrix_world @ Vector(c))[k] for c in o.bound_box) for o in objs) for k in range(3)))
        s = 0.5 / max(1e-6, max(mx - mn))
        root = bpy.data.objects.new("root", None)
        scene.collection.objects.link(root)
        for o in objs:
            if o.parent is None:
                o.parent = root
        root.scale = (s, s, s)
        root.location = (-(mn.x + mx.x) / 2 * s, -(mn.y + mx.y) / 2 * s, -mn.z * s)
    light("AREA", "key", (-0.6, -0.9, 0.7), 40, (1.0, 0.97, 0.94), (0, 0, 0.25), 0.8)
    target = Vector((0, 0, 0.25))

# Cool rim from behind on both sides: the edge light that separates the subject from the void.
rim = float(SPEC.get("rim", 60))
rim_color = SPEC.get("rimColor") or (0.78, 0.86, 1.0)
if isinstance(rim_color, str):
    rim_color = hex_rgb(rim_color)
light("SPOT", "rim_l", (-1.0, 0.9, 0.8), rim, rim_color, target)
light("SPOT", "rim_r", (1.0, 0.8, 0.6), rim * 0.7, rim_color, target)

cs = SPEC.get("camera", {})
lens = float(cs.get("lens", 100 if macro else 50))
cd = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
cd.lens, cd.sensor_width, cd.clip_start = lens, 36, 0.005
cd.dof.use_dof = True
cd.dof.aperture_fstop = float(cs.get("fstop", 2.0 if lens >= 85 else 4.0))
focus = bpy.data.objects.new("focus", None)
scene.collection.objects.link(focus)
focus.location = target
cd.dof.focus_object = focus
# Distance that fits the subject box in frame for this lens and aspect (sensor 36 mm on the long side).
box_w, box_h = {"glow_word": (1.1, 0.4), "macro_label": (0.16, 0.06)}.get(T, (0.6, 0.6))
if T == "product_hero":
    box_w, box_h = hgt * aspect * 1.2, hgt * 1.15
sw, sh = (36.0, 36.0 * H / W) if W >= H else (36.0 * W / H, 36.0)
dist = max(box_w / (sw / lens), box_h / (sh / lens)) * 1.12 * float(cs.get("frame", 1.0))
ang = cs.get("angle", "eye")
elev = {"low": -0.18, "high": 0.35, "top": 0.9}.get(ang, 0.05)
start = target + Vector((0.12 * dist, -dist, elev * dist))
move, amount = cs.get("move", "push"), float(cs.get("amount", 0.15))
ends = []
if "orbit" in move or "arc" in move or "turntable" in move:
    for k in range(5):
        a = math.radians(-14 + 28 * k / 4)
        v = start - target
        ends.append(target + Vector((v.x * math.cos(a) - v.y * math.sin(a), v.x * math.sin(a) + v.y * math.cos(a), v.z)))
elif "pull" in move or "dolly out" in move.lower():
    ends = [start.lerp(target, amount), start]
elif "truck" in move.lower():
    # Lateral movement perpendicular to camera direction
    direction = (target - start).normalized()
    right = Vector((direction.y, -direction.x, 0)).normalized()
    lateral_offset = right * amount * dist * 0.5
    ends = [start - lateral_offset, start + lateral_offset]
elif "crane" in move.lower():
    # Vertical movement (up/down)
    vertical_offset = Vector((0, 0, amount * dist * 0.3))
    ends = [start - vertical_offset, start + vertical_offset]
elif "rack" in move.lower():
    # Rack focus simulated with slight dolly
    ends = [start, start.lerp(target, amount * 0.5)]
elif "handheld" in move.lower() or "drift" in move.lower():
    # Handheld drift: slight irregular movement
    drift_x = math.sin(math.pi * 0.3) * amount * dist * 0.08
    drift_y = math.cos(math.pi * 0.5) * amount * dist * 0.05
    drift_z = math.sin(math.pi * 0.7) * amount * dist * 0.04
    ends = [start, start.lerp(target, amount * 0.3) + Vector((drift_x, drift_y, drift_z))]
elif "whip" in move.lower():
    # Whip pan: fast horizontal rotation
    v = start - target
    angle = math.radians(amount * 90)
    ends = [start, target + Vector((v.x * math.cos(angle) - v.y * math.sin(angle), v.x * math.sin(angle) + v.y * math.cos(angle), v.z))]
elif "static" in move or "locked" in move:
    ends = [start, start]
else:
    # Default push/dolly in
    ends = [start, start.lerp(target, amount)]
for k, pos in enumerate(ends):
    fr = 1 + round((FRAMES - 1) * k / (len(ends) - 1))
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert("location", frame=fr)
    cam.keyframe_insert("rotation_euler", frame=fr)

if args["--still"]:
    scene.frame_set(int(f(float(SPEC.get("still_at", SECONDS * 0.8)))))
    scene.render.filepath = f"{OUT}/still.png"
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print("SHOT_KIT_OK")
