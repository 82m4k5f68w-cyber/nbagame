"""Render a model to a sprite sheet (Blender headless, Cycles CPU: no GPU / display needed).

  blender -b --factory-startup -P scripts/assets/blender/sprites.py -- model.glb sheet.png [--angles 8] [--size 128] [--elev 30] [--samples 16]
Orthographic camera orbiting the model (angles evenly spaced, starting at the front), transparent background,
sheet = one row per elevation, `angles` columns. A JSON sidecar (sheet.json) lists the cell size and angles.
Works with .glb/.gltf/.fbx/.obj; for an animated model add --frames 0,10,20 (one row per frame).
"""
import json
import math
import os
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    sys.exit(__doc__)
src, dst = argv[0], argv[1]
opt = {argv[i][2:]: argv[i + 1] for i in range(2, len(argv) - 1, 2) if argv[i].startswith("--")}
N, S, EL, SPP = int(opt.get("angles", 8)), int(opt.get("size", 128)), float(opt.get("elev", 30)), int(opt.get("samples", 16))
frames = [int(f) for f in opt.get("frames", "").split(",") if f.strip()] or [None]
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = src.lower().rsplit(".", 1)[-1]
{"glb": lambda: bpy.ops.import_scene.gltf(filepath=src), "gltf": lambda: bpy.ops.import_scene.gltf(filepath=src),
 "fbx": lambda: bpy.ops.import_scene.fbx(filepath=src), "obj": lambda: bpy.ops.wm.obj_import(filepath=src)}[ext]()
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
if not meshes:
    sys.exit("no meshes in " + src)
lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
ctr, rad = (lo + hi) / 2, (hi - lo).length / 2
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SPP
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = S
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
world = bpy.data.worlds.new("w")
world.color = (0.6, 0.6, 0.65)
sc.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = rad * 2.1
sc.collection.objects.link(cam)
sc.camera = cam
tmp = os.path.splitext(dst)[0] + "_cells"
os.makedirs(tmp, exist_ok=True)
cells = []
for r, fr in enumerate(frames):
    if fr is not None:
        sc.frame_set(fr)
    for k in range(N):
        a = 2 * math.pi * k / N
        d = Vector((math.sin(a) * math.cos(math.radians(EL)), -math.cos(a) * math.cos(math.radians(EL)), math.sin(math.radians(EL))))
        cam.location = ctr + d * rad * 4
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(tmp, f"r{r}_a{k}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        cells.append((r, k, f))
sheet = bpy.data.images.new("sheet", N * S, len(frames) * S, alpha=True)
px = [0.0] * (N * S * len(frames) * S * 4)
for r, k, f in cells:
    im = bpy.data.images.load(f)
    p = list(im.pixels)
    row0 = (len(frames) - 1 - r) * S  # Blender images are bottom-up
    for y in range(S):
        o = ((row0 + y) * N * S + k * S) * 4
        px[o:o + S * 4] = p[y * S * 4:(y + 1) * S * 4]
sheet.pixels = px
sheet.filepath_raw = dst
sheet.file_format = "PNG"
sheet.save()
for _, _, f in cells:
    os.remove(f)
os.rmdir(tmp)
json.dump({"cell": S, "angles": N, "elev": EL, "rows": len(frames), "frames": frames}, open(os.path.splitext(dst)[0] + ".json", "w"))
print(f"sprites: {src} -> {dst} ({N} x {len(frames)} cells of {S}px)")
