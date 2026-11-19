"""
Headless Blender scene templates for hero/product shots (GTM Engine render pipeline, PR 2).

  blender -b --factory-startup -P scripts/blender/scene.py -- \
      --template push-in|orbit|macro|rack-focus --mode preview|final --out DIR \
      [--image can.png] [--seconds 3] [--width 720] [--height 1280] [--lens 85] [--light rim|practical|both] \
      [--accent "#ff2bd6"] [--at 0.5] [--seed 7]

Look: pitch-black void, light only from a rim strip and/or a visible practical (a glowing tube), shallow depth of
field, motion blur, and subtle imperfections (scuffed roughness, micro-bump, dust motes, handheld drift). The real
label is unwrapped from the product photo exactly as packshot.py does it. `--at T` renders one still at T in 0..1.
preview = EEVEE; final = Cycles (Metal GPU when present). Prints SCENE_OK <frames> <engine> when done.
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import studio_common as sc  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"--template": "push-in", "--mode": "preview", "--seconds": "3", "--width": "720", "--height": "1280", "--lens": "85",
       "--light": "both", "--accent": "#ff2bd6", "--fps": "30", "--seed": "7", "--image": "", "--at": "", "--samples": ""}
for k in range(0, len(argv), 2):
    opt[argv[k]] = argv[k + 1]
TEMPLATE, MODE = opt["--template"], opt["--mode"]
if TEMPLATE not in ("push-in", "orbit", "macro", "rack-focus"):
    raise SystemExit(f"unknown template {TEMPLATE}")
W, H, FPS, LENS = int(opt["--width"]), int(opt["--height"]), int(opt["--fps"]), float(opt["--lens"])
AT = float(opt["--at"]) if opt["--at"] != "" else None
FRAMES = 1 if AT is not None else max(2, round(float(opt["--seconds"]) * FPS))
ACCENT = sc.hex_rgb(opt["--accent"])
random.seed(int(opt["--seed"]))
OUT = opt["--out"]

# ---------- product ----------
if opt["--image"]:
    label, aspect = sc.unwrap_label(opt["--image"])
else:
    label, aspect = sc.procedural_label(ACCENT)
    print("SCENE_NOTE no product photo, procedural label")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
body, h = sc.build_can(label, aspect)
z_mid = 0.12 + h * 0.5

# ---------- black void ----------
world = bpy.data.worlds.new("void")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
floor = bpy.context.object
fm = bpy.data.materials.new("floor")
fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.012, 0.012, 0.014, 1)
fb.inputs["Roughness"].default_value = 0.22  # near-black glossy: only a faint reflection of the can and glow
floor.data.materials.append(fm)
sc.scuffed(fm, scale=40.0, amount=0.05, bump=0.004)


def track(o, target):
    c = o.constraints.new("TRACK_TO")
    c.target, c.track_axis, c.up_axis = target, "TRACK_NEGATIVE_Z", "UP_Y"


def area(name, loc, energy, size_x, size_y, color):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy, ld.shape, ld.size, ld.size_y, ld.color = energy, "RECTANGLE", size_x, size_y, color
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = loc
    track(o, body)
    return o


LIGHT = opt["--light"]
if LIGHT in ("rim", "both"):  # a thin cool strip behind-left and a warm one behind-right: edge light, no fill
    area("rim_l", (-3.2, 2.6, 3.0), 700, 0.6, 5.0, (0.8, 0.9, 1.0))
    area("rim_r", (3.4, 2.2, 2.6), 380, 0.5, 4.5, (1.0, 0.85, 0.7))
# A faint, wide kicker from the camera side keeps the real label readable without lighting the void.
area("kicker", (-1.8, -5.5, z_mid + 0.6), 90, 3.5, 3.5, (1.0, 0.93, 0.85))
if LIGHT in ("practical", "both"):  # a visible glowing tube in the void: the light comes from a thing in the shot
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.07, depth=3.2, location=(-2.6, 3.4, 1.9), rotation=(0, math.radians(8), 0))
    tube = bpy.context.object
    tm = bpy.data.materials.new("tube")
    tm.use_nodes = True
    tn = tm.node_tree.nodes
    tn.remove(tn["Principled BSDF"])
    em = tn.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*ACCENT, 1)
    em.inputs["Strength"].default_value = 18.0
    tm.node_tree.links.new(em.outputs["Emission"], tn["Material Output"].inputs["Surface"])
    tube.data.materials.append(tm)
    area("tube_light", (-2.4, 1.2, 1.9), 420, 0.5, 3.0, ACCENT)

# ---------- dust motes and (macro) condensation: imperfections that sell realism ----------
mote = bpy.data.materials.new("mote")
mote.use_nodes = True
mn = mote.node_tree.nodes
mn.remove(mn["Principled BSDF"])
me = mn.new("ShaderNodeEmission")
me.inputs["Strength"].default_value = 1.6
me.inputs["Color"].default_value = (1, 0.95, 0.9, 1)
mote.node_tree.links.new(me.outputs["Emission"], mn["Material Output"].inputs["Surface"])
for i in range(22):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=random.uniform(0.004, 0.011),
                                          location=(random.uniform(-2.2, 2.2), random.uniform(-2.0, 2.4), random.uniform(0.2, 3.6)))
    o = bpy.context.object
    o.data.materials.append(mote)
    o.keyframe_insert("location", frame=1)
    o.location = (o.location.x + random.uniform(-0.25, 0.25), o.location.y, o.location.z + random.uniform(0.1, 0.4))
    o.keyframe_insert("location", frame=max(2, FRAMES))

if TEMPLATE in ("macro", "rack-focus"):
    gm = bpy.data.materials.new("drop")
    gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (1, 1, 1, 1)
    gb.inputs["Roughness"].default_value = 0.02
    for name in ("Transmission Weight", "Transmission"):
        if name in gb.inputs:
            gb.inputs[name].default_value = 1.0
    gb.inputs["IOR"].default_value = 1.33
    for i in range(70):
        ang = random.uniform(-0.9, 0.9)
        zz = random.uniform(0.2, h)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=random.uniform(0.012, 0.045),
                                             location=(math.sin(ang) * 1.012, -math.cos(ang) * 1.012, 0.12 + zz))
        d = bpy.context.object
        d.scale = (1, 0.55, 1.15)
        d.rotation_euler = (0, 0, math.atan2(d.location.y, d.location.x) + math.pi / 2)
        bpy.ops.object.shade_smooth()
        d.data.materials.append(gm)

# ---------- camera: lens and move from the shot row ----------
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = LENS
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("target", None)
scene.collection.objects.link(target)
target.location = (0, 0, z_mid)
track(cam, target)
half = (cam_d.sensor_width / 2) / cam_d.lens
fov_v = 2 * math.atan(half if H >= W else half * H / W)
# distance at which the whole can fills ~62% of the frame height (hero) or ~30% of the height shows (macro)
fill = 0.3 if TEMPLATE == "macro" else 0.62
visible = (h + 0.45) / fill if TEMPLATE != "macro" else h * 0.5
dist0 = visible / (2 * math.tan(fov_v / 2))
if TEMPLATE == "macro":
    target.location = (0, 0, 0.12 + h * 0.62)

# Focus on the label's front surface (the can axis is a full radius behind it), not on the tracking target.
focus_pt = bpy.data.objects.new("focus_label", None)
scene.collection.objects.link(focus_pt)
focus_pt.location = (0, -1.0, target.location.z)
cam_d.dof.use_dof = True
cam_d.dof.focus_object = focus_pt
cam_d.dof.aperture_fstop = 2.8 if TEMPLATE == "macro" else 2.2
if hasattr(cam_d.dof, "aperture_blades"):
    cam_d.dof.aperture_blades = 7

far = bpy.data.objects.new("focus_far", None)  # rack focus: from the glowing tube in the back to the label
scene.collection.objects.link(far)
far.location = (-2.6, 3.4, 1.9)

# a hand-held tremor: tiny, slow, deterministic, never more than ~0.4% of the distance
rng = random.Random(int(opt["--seed"]))
phase = [rng.uniform(0, 6.28) for _ in range(4)]


def shake(t, d):
    a = d * 0.004
    return (a * math.sin(t * 9 + phase[0]) + a * 0.5 * math.sin(t * 23 + phase[1]), 0.0, a * math.sin(t * 7 + phase[2]))


def place(f):
    t = 0.0 if FRAMES == 1 else (f - 1) / (FRAMES - 1)
    if AT is not None:
        t = AT
    e = 0.5 - 0.5 * math.cos(math.pi * t)
    if TEMPLATE == "push-in":
        a, d, lift = 0.0, dist0 * (1.28 - 0.38 * e), 0.06
    elif TEMPLATE == "orbit":
        a, d, lift = math.radians(-38 + 76 * e), dist0 * (1.08 - 0.06 * e), 0.05
    elif TEMPLATE == "macro":  # locked off: the camera does not move; only the shake and the dust do
        a, d, lift = math.radians(-6), dist0, 0.0
    else:  # rack-focus: a barely perceptible drift, the story is the focus pull
        a, d, lift = math.radians(10 - 14 * e), dist0 * (1.06 - 0.03 * e), 0.04
    sx, sy, sz = shake(t * FRAMES / FPS, d)
    cam.location = (d * math.sin(a) + sx, -d * math.cos(a) + sy, target.location.z + d * lift + sz)
    cam.keyframe_insert("location", frame=f)
    if TEMPLATE == "rack-focus":
        cam_d.dof.focus_object = None
        dist_label = (cam.location - focus_pt.location).length
        dist_far = (cam.location - far.location).length
        k = min(1.0, max(0.0, (t - 0.25) / 0.5))  # hold on the glow, pull to the label through the middle, hold
        k = 0.5 - 0.5 * math.cos(math.pi * k)
        cam_d.dof.focus_distance = dist_far * (1 - k) + dist_label * k
        cam_d.dof.keyframe_insert("focus_distance", frame=f)


if AT is not None:
    scene.frame_set(1)
    place(1)
else:
    for f in range(1, FRAMES + 1):
        place(f)

# ---------- render settings ----------
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, FRAMES
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.render.use_motion_blur = True
if hasattr(scene.render, "motion_blur_shutter"):
    scene.render.motion_blur_shutter = 0.5

engine = "CYCLES" if MODE == "final" else "BLENDER_EEVEE"
for eng in ([engine] if engine == "CYCLES" else ["BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"]):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
if scene.render.engine == "CYCLES":
    cy = scene.cycles
    cy.samples = int(opt["--samples"] or 96)
    cy.use_denoising = True
    cy.device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        if any(d.type == "METAL" for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == "METAL"
            cy.device = "GPU"
    except Exception as e:  # no Metal: stay on CPU
        print("SCENE_NOTE cycles on cpu:", e)
else:
    ee = scene.eevee
    for attr, val in (("taa_render_samples", 32), ("use_raytracing", False), ("use_shadows", True), ("motion_blur_shutter", 0.5)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    if hasattr(ee, "use_motion_blur"):
        ee.use_motion_blur = True

os.makedirs(OUT, exist_ok=True)
if FRAMES == 1:
    scene.render.filepath = os.path.join(OUT, "still.png")
    bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(OUT, "f_")
    bpy.ops.render.render(animation=True)
print("SCENE_OK", FRAMES, scene.render.engine)
