"""Mesh cleanup + decimation with PyMeshLab (scans, photogrammetry, Blender sculpts -> game-ready).

  h2kpy scripts/assets/mesh_clean.py in.(obj|ply|stl|glb|off) out.(ply|stl|off) [--ratio 0.25] [--faces N] [--merge 0.0005]
(OBJ output is refused: pymeshlab 2025.7's OBJ writer throws bad_alloc after a decimation; Blender imports PLY.)
Steps: merge all meshes -> remove duplicate / unreferenced vertices and null faces -> merge close vertices (relative
to the bounding box) -> repair non-manifold edges -> quadric edge-collapse decimation (keeps normals / boundaries /
topology) -> recompute normals. Prints faces before / after and the Hausdorff distance (mean / max, % of the bbox)
so a too-aggressive ratio is visible. Then: Blender (scripts/assets/blender) or gltf-transform for GLB + meshopt.
"""
import argparse
import pymeshlab as ml

ap = argparse.ArgumentParser()
ap.add_argument("inp")
ap.add_argument("out")
ap.add_argument("--ratio", type=float, default=0.25, help="target fraction of faces (ignored with --faces)")
ap.add_argument("--faces", type=int, default=0)
ap.add_argument("--merge", type=float, default=0.0005, help="merge-close threshold, fraction of the bbox diagonal")
a = ap.parse_args()
if a.out.lower().endswith(".obj"):
    raise SystemExit("mesh_clean: write .ply / .stl / .off (the OBJ writer crashes after decimation in pymeshlab 2025.7)")

ms = ml.MeshSet()
ms.load_new_mesh(a.inp)
if ms.mesh_number() > 1:
    ms.generate_by_merging_visible_meshes()
f0 = ms.current_mesh().face_number()
ms.meshing_remove_duplicate_vertices()
ms.meshing_remove_unreferenced_vertices()
ms.meshing_remove_null_faces()
ms.meshing_merge_close_vertices(threshold=ml.PercentageValue(a.merge * 100))
ms.meshing_repair_non_manifold_edges()
target = a.faces or max(4, int(ms.current_mesh().face_number() * a.ratio))
ms.meshing_decimation_quadric_edge_collapse(targetfacenum=target, preservenormal=True, preserveboundary=True, preservetopology=True, qualitythr=0.3, optimalplacement=True, planarquadric=True)
ms.compute_normal_per_vertex()
f1 = ms.current_mesh().face_number()
diag = ms.current_mesh().bounding_box().diagonal()
ms.save_current_mesh(a.out)
lo = ms.current_mesh_id()
# error check against a fresh load of the input (an add_mesh copy breaks save_current_mesh in pymeshlab 2025.7)
ms.load_new_mesh(a.inp)
hd = ms.get_hausdorff_distance(sampledmesh=ms.current_mesh_id(), targetmesh=lo, samplevert=True)
print(f"mesh_clean: {a.inp} faces {f0} -> {f1} ({100 * f1 / max(1, f0):.0f}%), hausdorff mean {100 * hd['mean'] / diag:.3f}% max {100 * hd['max'] / diag:.3f}% of the bbox -> {a.out}")
