"""Procedural props -> GLB (Blender headless). Units: metres, Y up in the GLB (glTF convention), origin on the floor.

  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- bleachers assets/models/props/bleachers.glb [--rows 6] [--width 8]
  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- scorer_table out.glb
  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- corner_store out.glb [--floors 2]   (LIFE building)
Optionally compress afterwards: npx gltf-transform meshopt out.glb out.glb
"""
import sys
import bpy
import bmesh

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    sys.exit(__doc__)
kind, dst = argv[0], argv[1]
opt = {argv[i][2:]: float(argv[i + 1]) for i in range(2, len(argv) - 1, 2) if argv[i].startswith("--")}
bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}


def mat(name, rgb, rough=0.6, metal=0.0):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        MATS[name] = m
    return MATS[name]


def box(name, size, loc, m):
    """Axis-aligned box (Blender Z up): size (x, y, z) in metres, loc = centre of the bottom face."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z = (v.co.z + 0.5) * size[2]
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    me.materials.append(m)
    bpy.context.scene.collection.objects.link(o)
    return o


def bleachers():
    rows, width = int(opt.get("rows", 6)), opt.get("width", 8.0)
    seat, steel, plank = mat("seat", (0.12, 0.2, 0.55), 0.5), mat("steel", (0.55, 0.57, 0.6), 0.35, 0.8), mat("plank", (0.62, 0.46, 0.3), 0.7)
    for r in range(rows):
        y, z = r * 0.8, r * 0.42
        box(f"riser{r}", (width, 0.8, z + 0.42 - 0.04), (0, y, 0), steel if r % 2 else plank)
        box(f"seat{r}", (width - 0.2, 0.36, 0.06), (0, y - 0.1, z + 0.42), seat)
    for s in (-1, 1):
        box(f"rail{s}", (0.06, rows * 0.8, 1.0), (s * width / 2, (rows - 1) * 0.4, rows * 0.42), steel)


def scorer_table():
    top, front, steel = mat("top", (0.08, 0.08, 0.1), 0.3), mat("led", (0.9, 0.35, 0.05), 0.4), mat("steel", (0.3, 0.3, 0.32), 0.3, 0.8)
    box("top", (7.0, 0.9, 0.06), (0, 0, 0.76), top)
    box("front", (7.0, 0.05, 0.72), (0, -0.43, 0.02), front)
    for x in (-3.3, 0, 3.3):
        box(f"leg{x}", (0.08, 0.7, 0.76), (x, 0.05, 0), steel)
    for i in range(10):
        box(f"chair{i}", (0.5, 0.5, 0.45), (-3.0 + i * 0.66, 0.85, 0), mat("chair", (0.1, 0.1, 0.12), 0.6))


def corner_store():
    floors = int(opt.get("floors", 2))
    brick, glass, trim, awn = mat("brick", (0.55, 0.22, 0.16), 0.85), mat("glass", (0.2, 0.3, 0.38), 0.05, 0.2), mat("trim", (0.85, 0.82, 0.75), 0.6), mat("awning", (0.1, 0.45, 0.25), 0.7)
    W, D, H = 10.0, 8.0, 3.4
    box("body", (W, D, H * floors), (0, 0, 0), brick)
    box("roof", (W + 0.3, D + 0.3, 0.25), (0, 0, H * floors), trim)
    box("shopfront", (W * 0.8, 0.1, 2.4), (0, -D / 2 - 0.02, 0.4), glass)
    box("door", (1.1, 0.12, 2.3), (W * 0.3, -D / 2 - 0.05, 0), trim)
    box("awning", (W * 0.85, 1.2, 0.12), (0, -D / 2 - 0.6, 2.9), awn)
    for f in range(1, floors):
        for i in range(4):
            box(f"win{f}_{i}", (1.3, 0.1, 1.5), (-3.6 + i * 2.4, -D / 2 - 0.02, f * H + 0.9), glass)


{"bleachers": bleachers, "scorer_table": scorer_table, "corner_store": corner_store}[kind]()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_apply=True)
print(f"build_prop: {kind} -> {dst} ({len(bpy.context.scene.objects)} parts)")
