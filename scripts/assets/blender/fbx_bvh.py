"""FBX <-> BVH conversion (Blender headless).

  blender -b --factory-startup -P scripts/assets/blender/fbx_bvh.py -- in.fbx out.bvh [--fps 30] [--scale 1]
  blender -b --factory-startup -P scripts/assets/blender/fbx_bvh.py -- in.bvh out.fbx [--scale 1]
  blender -b --factory-startup -P scripts/assets/blender/fbx_bvh.py -- in.bvh out.glb      (preview / three.js)
FBX -> BVH exports the first armature's action over the scene frame range (Mixamo / Rokoko / Unity FBX clips).
BVH -> FBX/GLB builds an armature from the BVH (video2bvh.py output, CMU clips) for Unity / three.js / Blender.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    sys.exit(__doc__)
src, dst = argv[0], argv[1]
opt = {argv[i][2:]: argv[i + 1] for i in range(2, len(argv) - 1, 2) if argv[i].startswith("--")}
scale = float(opt.get("scale", 1))
bpy.ops.wm.read_factory_settings(use_empty=True)
ext_in, ext_out = src.lower().rsplit(".", 1)[-1], dst.lower().rsplit(".", 1)[-1]

if ext_in == "fbx":
    bpy.ops.import_scene.fbx(filepath=src, global_scale=scale, automatic_bone_orientation=True)
elif ext_in == "bvh":
    bpy.ops.import_anim.bvh(filepath=src, global_scale=scale, update_scene_fps=True, update_scene_duration=True, rotate_mode="NATIVE")
elif ext_in in ("glb", "gltf"):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    sys.exit("unsupported input " + src)

arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
if arm is None:
    sys.exit("no armature in " + src)
sc = bpy.context.scene
act = (arm.animation_data and arm.animation_data.action) or (bpy.data.actions[0] if bpy.data.actions else None)
if act:
    if arm.animation_data is None:
        arm.animation_data_create()
    if arm.animation_data.action is None:
        arm.animation_data.action = act
    a, b = act.frame_range  # FBX imports keep the clip's keyed range; never fall back to the 1..250 default
    sc.frame_start, sc.frame_end = int(round(a)), int(round(b))
if "fps" in opt:
    sc.render.fps = int(float(opt["fps"]))
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.context.view_layer.objects.active = arm

if ext_out == "bvh":
    bpy.ops.export_anim.bvh(filepath=dst, frame_start=sc.frame_start, frame_end=sc.frame_end, global_scale=1 / scale if scale else 1, rotate_mode="NATIVE", root_transform_only=False)
elif ext_out == "fbx":
    bpy.ops.export_scene.fbx(filepath=dst, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False, bake_anim=True)  # (use_selection + single-action bake exported no animation in 4.5)
elif ext_out in ("glb", "gltf"):
    bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB" if ext_out == "glb" else "GLTF_SEPARATE", export_animations=True, use_selection=True)
else:
    sys.exit("unsupported output " + dst)
print(f"fbx_bvh: {src} -> {dst} ({sc.frame_end - sc.frame_start + 1} frames @ {sc.render.fps} fps, {len(arm.data.bones)} bones)")
