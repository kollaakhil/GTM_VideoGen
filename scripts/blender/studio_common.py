"""
Shared Blender helpers for scene.py, extracted from packshot.py (PR #28): label unwrap, can model, metal.
packshot.py is left as it was so the proven end shot cannot regress; new scene templates import from here.
"""
import math

import bpy
import numpy as np

THETA = math.radians(74)  # beyond ~70 degrees the photo is the dark shaded edge of the can


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[k:k + 2], 16) / 255 for k in (0, 2, 4))


def unwrap_label(image_path, tw=1024):
    """Straight-on can photo -> flat label texture (cylindrical unwrap, per-row edges). Returns (rgba array, aspect)."""
    src = bpy.data.images.load(image_path)
    sw, sh = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(sh, sw, 4)
    lum = px[..., :3].mean(axis=2) * px[..., 3]
    mask = lum > 0.06
    cols = np.where(mask.mean(axis=0) > 0.35)[0]
    rows = np.where(mask.mean(axis=1) > 0.35)[0]
    if len(cols) < 10 or len(rows) < 10:
        raise SystemExit("could not find the product in the photo")
    x0, x1, y0, y1 = cols.min(), cols.max(), rows.min(), rows.max()
    trim = int((y1 - y0) * 0.05)
    y0b, y1b = y0 + trim, y1 - trim
    cx, R = (x0 + x1) / 2, (x1 - x0) / 2
    thetas = np.linspace(-THETA, THETA, tw)
    edges = []
    for y in range(y0b, y1b + 1):
        xs_on = np.where(mask[y])[0]
        edges.append((xs_on.min(), xs_on.max()) if len(xs_on) > 10 and (xs_on.max() - xs_on.min()) > R else (x0, x1))
    edges = np.array(edges, dtype=np.float32)
    k = max(5, (len(edges) // 16) | 1)
    pad = np.pad(edges, ((k // 2, k // 2), (0, 0)), mode="edge")
    edges = np.stack([np.median(pad[j:j + k], axis=0) for j in range(len(edges))])
    out = []
    for j, y in enumerate(range(y0b, y1b + 1)):
        rc, rr = edges[j].mean(), (edges[j][1] - edges[j][0]) / 2
        xs = np.clip(np.round(rc + rr * 0.985 * np.sin(thetas)).astype(int), 0, sw - 1)
        out.append(px[y, xs, :])
    label = np.stack(out).copy()
    label[..., 3] = 1.0
    return label, (y1b - y0b) / (2 * R)


def procedural_label(accent, tw=1024, th=1400):
    """No photo: a plain two-band label in the accent colour so templates still render (marked in the log)."""
    img = np.zeros((th, tw, 4), dtype=np.float32)
    img[..., 3] = 1.0
    img[..., :3] = (0.05, 0.05, 0.06)
    band = slice(int(th * 0.38), int(th * 0.62))
    img[band, :, :3] = accent
    return img, th / tw


def label_material(label):
    lh, tw = label.shape[0], label.shape[1]
    tex = bpy.data.images.new("label", tw, lh, alpha=False)
    tex.pixels.foreach_set(label.ravel())
    tex.pack()
    m = bpy.data.materials.new("label")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = tex
    img.extension = "EXTEND"
    nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.32
    bsdf.inputs["Metallic"].default_value = 0.15
    for name in ("Coat Weight", "Clearcoat"):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.25
    return m


def scuffed(mat, scale=30.0, amount=0.08, bump=0.03):
    """Subtle imperfection: noise-driven roughness smudges plus a faint micro-bump, so nothing looks CG-perfect."""
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    base = bsdf.inputs["Roughness"].default_value
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["To Min"].default_value = max(0.0, base - amount)
    rng.inputs["To Max"].default_value = min(1.0, base + amount * 2)
    nt.links.new(noise.outputs["Fac"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Result"], bsdf.inputs["Roughness"])
    bm = nt.nodes.new("ShaderNodeBump")
    bm.inputs["Strength"].default_value = bump
    nt.links.new(noise.outputs["Fac"], bm.inputs["Height"])
    nt.links.new(bm.outputs["Normal"], bsdf.inputs["Normal"])


def metal_material():
    metal = bpy.data.materials.new("metal")
    metal.use_nodes = True
    mb = metal.node_tree.nodes["Principled BSDF"]
    mb.inputs["Base Color"].default_value = (0.91, 0.92, 0.93, 1)
    mb.inputs["Metallic"].default_value = 1.0
    mb.inputs["Roughness"].default_value = 0.16
    scuffed(metal, scale=60.0, amount=0.05, bump=0.02)
    return metal


def build_can(label, aspect, z0=0.12):
    """The can used by packshot.py: label body, tapered neck, rolled rim, tapered base. Returns (body, height)."""
    r = 1.0
    h = 2 * r * aspect
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=r, depth=h, end_fill_type="NOTHING", location=(0, 0, h / 2 + z0))
    body = bpy.context.object
    body.name = "can"
    bpy.ops.object.shade_smooth()
    mesh = body.data
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uv = mesh.uv_layers.new(name="UV")
    uv.active = uv.active_render = True
    for loop in mesh.loops:
        v = mesh.vertices[loop.vertex_index].co
        ang = math.atan2(v.x, -v.y)
        uv.data[loop.index].uv = ((ang / THETA + 1) / 2, (v.z + h / 2) / h)
    lm = label_material(label)
    scuffed(lm, scale=18.0, amount=0.06, bump=0.015)
    body.data.materials.append(lm)
    metal = metal_material()

    def cone(z, rb, rt, depth):
        bpy.ops.mesh.primitive_cone_add(vertices=128, radius1=rb, radius2=rt, depth=depth, location=(0, 0, z))
        o = bpy.context.object
        bpy.ops.object.shade_smooth()
        o.data.materials.append(metal)

    top = z0 + h
    cone(top + 0.11, r, r * 0.84, 0.22)
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=r * 0.85, depth=0.07, location=(0, 0, top + 0.25))
    rim = bpy.context.object
    bpy.ops.object.shade_smooth()
    bev = rim.modifiers.new("b", "BEVEL")
    bev.width, bev.segments = 0.07 * 0.45, 4
    rim.data.materials.append(metal)
    cone(z0 / 2, r * 0.82, r, z0)
    return body, h
