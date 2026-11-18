"""Render a camera plate from an equirectangular set panorama.

Run: Blender -b --python scripts/blender-plate.py -- <pano> <out.png> <lens_mm> <yaw_deg> <pitch_deg> <width> <height>
The panorama (a World Labs world's pano) becomes the world background, so every shot looks into the same set.
"""
import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
pano, out, lens, yaw, pitch, width, height = argv[0], argv[1], float(argv[2]), float(argv[3]), float(argv[4]), int(argv[5]), int(argv[6])

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
scene.cycles.device = "CPU"
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out
scene.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("Set")
scene.world = world
world.use_nodes = True
nodes = world.node_tree.nodes
links = world.node_tree.links
nodes.clear()
env = nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(pano)
bg = nodes.new("ShaderNodeBackground")
output = nodes.new("ShaderNodeOutputWorld")
links.new(env.outputs["Color"], bg.inputs["Color"])
links.new(bg.outputs["Background"], output.inputs["Surface"])

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = lens
cam_data.sensor_fit = "VERTICAL"
cam_data.sensor_height = 24
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (0, 0, 0)
cam.rotation_euler = (math.radians(90 + pitch), 0, math.radians(yaw))

bpy.ops.render.render(write_still=True)
