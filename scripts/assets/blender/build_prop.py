"""Procedural props -> GLB (Blender headless). Units: metres, Y up in the GLB (glTF convention), origin on the floor.

  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- bleachers assets/models/props/bleachers.glb [--rows 6] [--width 8]
  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- scorer_table out.glb
  blender -b --factory-startup -P scripts/assets/blender/build_prop.py -- corner_store out.glb [--floors 2]   (LIFE building)
  ... -- playground out.glb   /   ... -- hoop out.glb   (LIFE park + driveway hoops)
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


def playground():
    """Swing set + slide + sandbox (LIFE park), ~6 x 5 m."""
    steel, red, blue, sand, wood = mat("steel", (0.55, 0.57, 0.6), 0.35, 0.8), mat("red", (0.75, 0.12, 0.1), 0.5), mat("blue", (0.1, 0.35, 0.75), 0.5), mat("sand", (0.85, 0.75, 0.5), 0.95), mat("wood", (0.55, 0.38, 0.22), 0.8)
    for x in (-2.4, -0.2):  # swing A-frames
        for z in (-0.6, 0.6):
            box(f"leg{x}{z}", (0.08, 0.08, 2.4), (x, z, 0), steel)
    box("beam", (2.4, 0.1, 0.1), (-1.3, 0, 2.35), steel)
    for i, x in enumerate((-1.8, -0.8)):
        box(f"seat{i}", (0.45, 0.2, 0.05), (x, 0, 0.5), red)
        for dx in (-0.2, 0.2):
            box(f"chain{i}{dx}", (0.02, 0.02, 1.8), (x + dx, 0, 0.55), steel)
    box("deck", (1.0, 1.0, 0.1), (1.8, 0, 1.2), wood)
    for dx in (-0.45, 0.45):
        for dz in (-0.45, 0.45):
            box(f"post{dx}{dz}", (0.08, 0.08, 1.9), (1.8 + dx, dz, 0), wood)
    slide = box("slide", (0.6, 2.2, 0.06), (1.8, 1.55, 0.6), blue)  # deck edge (z 1.2) down to the ground
    slide.rotation_euler = (-0.53, 0, 0)
    box("ladder", (0.5, 0.06, 1.2), (1.8, -0.55, 0), steel)
    box("sandbox", (1.6, 1.6, 0.15), (-1.2, 2.4, 0), wood)
    box("sand", (1.45, 1.45, 0.16), (-1.2, 2.4, 0), sand)


def hoop():
    """Driveway / park hoop: pole, backboard, rim (10 ft = 3.05 m)."""
    steel, board, orange = mat("steel", (0.25, 0.27, 0.3), 0.4, 0.8), mat("board", (0.92, 0.92, 0.95), 0.3), mat("rim", (0.95, 0.35, 0.05), 0.4, 0.6)
    box("base", (0.6, 0.6, 0.12), (0, 0, 0), steel)
    box("pole", (0.11, 0.11, 3.25), (0, 0, 0), steel)
    box("arm", (0.08, 0.6, 0.08), (0, 0.3, 3.05), steel)
    box("board", (1.8, 0.04, 1.05), (0, 0.62, 2.85), board)
    box("square", (0.6, 0.045, 0.45), (0, 0.615, 3.05), orange)
    for i in range(12):  # rim as a 12-gon of bars
        import math
        a = i / 12 * math.tau
        r = box(f"rim{i}", (0.13, 0.02, 0.02), (math.cos(a) * 0.23, 0.87 + math.sin(a) * 0.23, 3.05), orange)
        r.rotation_euler = (0, 0, a + math.pi / 2)


{"bleachers": bleachers, "scorer_table": scorer_table, "corner_store": corner_store, "playground": playground, "hoop": hoop}[kind]()
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_apply=True)
print(f"build_prop: {kind} -> {dst} ({len(bpy.context.scene.objects)} parts)")
