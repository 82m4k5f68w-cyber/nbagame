// Lightmap UVs (xatlas via xatlas-three, Node worker): every mesh of a GLB gets a non-overlapping atlas layout in
// TEXCOORD_1 (three.js `uv1`: aoMap / lightMap), all meshes packed into ONE atlas so a single baked lightmap covers
// the whole prop / building. TEXCOORD_0 (colour UVs) is kept. Optional meshopt compression afterwards.
//   npx tsx scripts/assets/uv_unwrap.ts in.glb out.glb [--meshopt]
// xatlas may split vertices along new seams, so every attribute is rewritten from the unwrapped geometry.
import path from "node:path";
import { createRequire } from "node:module";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { UVUnwrapper } from "xatlas-three/src/unwrapperNodeWorker";

const [inp, out] = process.argv.slice(2).filter((a) => !a.startsWith("--")),
  MO = process.argv.includes("--meshopt");
if (!inp || !out) throw new Error("usage: uv_unwrap.ts in.glb out.glb [--meshopt]");
const req = createRequire(import.meta.url),
  XD = path.dirname(req.resolve("xatlasjs/package.json"));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(inp);
await doc.transform(weld()); // xatlas needs indexed geometry
const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getMode() === 4 && p.getIndices());
const geos = prims.map((p) => {
  const g = new THREE.BufferGeometry();
  const a = (n: string) => p.getAttribute(n);
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a("POSITION")!.getArray()!), 3));
  if (a("NORMAL")) g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(a("NORMAL")!.getArray()!), 3));
  if (a("TEXCOORD_0")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(a("TEXCOORD_0")!.getArray()!), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(p.getIndices()!.getArray()!), 1));
  return g;
});
const un = new UVUnwrapper({ BufferAttribute: THREE.BufferAttribute } as any);
(un as any).packOptions = { ...(un as any).packOptions, padding: 2, resolution: 1024, bilinear: true };
await un.loadLibrary(() => {}, path.join(XD, "dist/node/xatlas.wasm"), path.join(XD, "dist/node/worker.mjs"));
const atlas: any = await un.packAtlas(geos, "uv2", "uv");
const buf = doc.getRoot().listBuffers()[0] || doc.createBuffer();
prims.forEach((p, i) => {
  const g = (atlas.geometries || geos)[i] as THREE.BufferGeometry;
  const acc = (arr: Float32Array | Uint32Array, type: "VEC3" | "VEC2" | "SCALAR") => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  for (const n of p.listSemantics()) p.setAttribute(n, null);
  p.setAttribute("POSITION", acc(g.getAttribute("position").array as Float32Array, "VEC3"));
  if (g.getAttribute("normal")) p.setAttribute("NORMAL", acc(g.getAttribute("normal").array as Float32Array, "VEC3"));
  if (g.getAttribute("uv")) p.setAttribute("TEXCOORD_0", acc(g.getAttribute("uv").array as Float32Array, "VEC2"));
  p.setAttribute("TEXCOORD_1", acc(g.getAttribute("uv2").array as Float32Array, "VEC2"));
  p.setIndices(acc(new Uint32Array(g.getIndex()!.array), "SCALAR"));
});
void un.exit(); // (its promise never settles in Node; process.exit below ends the worker)
if (MO) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(out, doc);
console.log(`uv_unwrap: ${prims.length} primitives packed into one ${atlas.width || "?"}x${atlas.height || "?"} atlas -> ${out}`);
process.exit(0);
