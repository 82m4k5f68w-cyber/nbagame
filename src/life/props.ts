// LIFE town dressing (Medium+): CC0 Kenney street furniture + cars (assets/models/town.glb, meshopt) and the
// Blender-built playground + driveway hoops (assets/models/props/*.glb, lightmap UVs), all INSTANCED (one draw per
// mesh part per model), plus the CC0 ambientCG concrete / asphalt KTX2 detail on sidewalks and roads (client/gfxtex.ts).
// Everything is optional: if a GLB or KTX2 fails, the procedural town stays as it was.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import townUrl from "../../assets/models/town.glb?inline";
import playUrl from "../../assets/models/props/playground.glb?inline";
import hoopUrl from "../../assets/models/props/hoop.glb?inline";
import { gfxTex } from "../client/gfxtex";
import { PLACES, ROADS, blocked, doorOf } from "./places";
import { mkRng } from "./rng";

export type Spot = { x: number; z: number; a: number }; // a = yaw (radians, three.js rotation.y)
export type TownCtx = {
  QL: number;
  lampP: [number, number][];
  parked: [number, number, number][]; // the box cars' lot spots [x, z, angle]
  hideParked: () => void;
  walkM: THREE.MeshStandardMaterial;
  roads: { m: THREE.Mesh; len: number }[];
  boxes: { x0: number; x1: number; z0: number; z1: number; y1: number }[];
};
let loader: GLTFLoader | null = null;
async function glb(url: string): Promise<THREE.Group> {
  if (!loader) (loader = new GLTFLoader()), loader.setMeshoptDecoder(MeshoptDecoder);
  await (MeshoptDecoder as any).ready;
  const buf = await (await fetch(url)).arrayBuffer();
  return (await loader.parseAsync(buf, "")).scene;
}
/** One model at many spots: an InstancedMesh per mesh part. size = target length of the longest horizontal side (ft). */
function instance(S: THREE.Scene, root: THREE.Object3D, spots: Spot[], size: number, shadows: boolean) {
  if (!spots.length) return [];
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root),
    dim = bb.getSize(new THREE.Vector3()),
    s = size / Math.max(dim.x, dim.z, 1e-3),
    norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
  const out: THREE.InstancedMesh[] = [],
    M = new THREE.Matrix4(),
    P = new THREE.Matrix4(),
    Q = new THREE.Quaternion(),
    Y = new THREE.Vector3(0, 1, 0);
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
    spots.forEach((p, i) => {
      P.compose(new THREE.Vector3(p.x, 0, p.z), Q.setFromAxisAngle(Y, p.a), new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, M.copy(P).multiply(norm).multiply(o.matrixWorld));
    });
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    S.add(im);
    out.push(im);
  });
  return out;
}
const near = (x: number, z: number, r: number) => ROADS.some((q) => x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r);
/** Benches / bins between the street lamps, on the outer sidewalk edge, facing the road. */
export function streetSpots(lampP: [number, number][]) {
  const bench: Spot[] = [],
    bin: Spot[] = [];
  lampP.forEach(([x, z], i) => {
    // which road is this lamp on: horizontal (lamp z beyond the road z) or vertical
    const r = ROADS.find((q) => (x >= q.x0 && x <= q.x1 && (Math.abs(z - q.z0) < 12 || Math.abs(z - q.z1) < 12)) || (z >= q.z0 && z <= q.z1 && (Math.abs(x - q.x0) < 12 || Math.abs(x - q.x1) < 12)));
    if (!r) return;
    const horiz = r.x1 - r.x0 > r.z1 - r.z0,
      side = horiz ? Math.sign(z - (r.z0 + r.z1) / 2) : Math.sign(x - (r.x0 + r.x1) / 2),
      bx = horiz ? x + 30 : x + side * 3.2,
      bz = horiz ? z + side * 3.2 : z + 30;
    if ((Math.abs(bx) < 34 && Math.abs(bz) < 34) || blocked(bx, bz, 2)) return; // keep crossings and doors clear
    // face the road: rotation.y so the model's front (+z) points at it
    const a = horiz ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
    (i % 2 ? bin : bench).push({ x: bx, z: bz, a });
  });
  return { bench, bin };
}
export async function addTownProps(S: THREE.Scene, R: THREE.WebGLRenderer, c: TownCtx) {
  const sh = c.QL >= 1,
    stats = { parts: 0, bench: 0, bin: 0, cars: 0, dump: 0, planter: 0, hoops: 0, playground: 0, tex: 0 };
  // ---- KTX2 detail: concrete sidewalks, asphalt normal / roughness on the painted roads
  const texP = (async () => {
    const [con, asp] = await Promise.all([gfxTex(R, "concrete"), gfxTex(R, "asphalt")]);
    if (con) {
      const t = (x: THREE.Texture) => ((x = x.clone()), x.repeat.set(0.12, 0.12), (x.needsUpdate = true), x);
      Object.assign(c.walkM, { map: t(con.map), normalMap: t(con.normalMap), roughnessMap: t(con.roughnessMap), roughness: 1 });
      c.walkM.color.set(0xd8d4cc);
      c.walkM.needsUpdate = true;
      stats.tex++;
    }
    if (asp)
      for (const { m, len } of c.roads) {
        const mm = m.material as THREE.MeshStandardMaterial,
          t = (x: THREE.Texture) => ((x = x.clone()), x.repeat.set(36 / 20, len / 20), (x.needsUpdate = true), x);
        Object.assign(mm, { normalMap: t(asp.normalMap), roughnessMap: t(asp.roughnessMap), roughness: 1 });
        mm.normalScale.setScalar(0.6);
        mm.needsUpdate = true;
        stats.tex++;
      }
  })().catch(() => {});
  // ---- models
  try {
    const [town, play, hoop] = await Promise.all([glb(townUrl), glb(playUrl), glb(hoopUrl)]);
    const part = (n: string) => town.children.find((o) => o.name === n) || null;
    const put = (o: THREE.Object3D | null, spots: Spot[], size: number) => (o ? (stats.parts += instance(S, o, spots, size, sh).length) : 0);
    const { bench, bin } = streetSpots(c.lampP);
    put(part("bench"), bench, 6), (stats.bench = bench.length);
    put(part("trashcan"), bin, 2.4), (stats.bin = bin.length);
    // dumpsters behind the restaurants, planters either side of shop / food doors
    const dump: Spot[] = [],
      plant: Spot[] = [];
    for (const p of PLACES) {
      if (p.k !== "food" && p.k !== "shop" && p.k !== "service") continue;
      const d = doorOf(p),
        bx = p.x + Math.cos(d.f) * (p.d / 2 + 5),
        bz = p.z + Math.sin(d.f) * (p.d / 2 + 5);
      if (p.k === "food" && !blocked(bx, bz, 3) && !near(bx, bz, 4)) dump.push({ x: bx, z: bz, a: -d.f + Math.PI / 2 });
      for (const sd of [-1, 1]) {
        const px = d.x - Math.cos(d.f) * 2.5 + -Math.sin(d.f) * sd * 6,
          pz = d.z - Math.sin(d.f) * 2.5 + Math.cos(d.f) * sd * 6;
        if (!blocked(px, pz, 1)) plant.push({ x: px, z: pz, a: 0 });
      }
    }
    put(part("dumpster"), dump, 7), (stats.dump = dump.length);
    put(part("planter"), plant, 3.6), (stats.planter = plant.length);
    // parked cars: Kenney models (5 kinds) on the lot spots instead of the procedural boxes
    const kinds = ["sedan", "suv", "hatchback-sports", "van", "delivery"],
      byKind: Spot[][] = kinds.map(() => []),
      r = mkRng(41);
    for (const [x, z, a] of c.parked) byKind[Math.floor(r() * kinds.length)].push({ x, z, a: a + Math.PI / 2 });
    let carParts = 0;
    kinds.forEach((k, i) => (carParts += put(part(k), byKind[i], k === "van" || k === "delivery" ? 16 : 14.5)));
    if (carParts) c.hideParked(), (stats.cars = c.parked.length);
    // driveway hoops next to every house (facing the house) + one playground on open grass near The Cage
    const hoops: Spot[] = [];
    for (const p of PLACES) {
      if (p.k !== "home" && p.k !== "house") continue;
      const d = doorOf(p),
        sx = -Math.sin(d.f),
        sz = Math.cos(d.f),
        hx = d.x - Math.cos(d.f) * 14 + sx * 12,
        hz = d.z - Math.sin(d.f) * 14 + sz * 12;
      if (!blocked(hx, hz, 2) && !near(hx, hz, 6)) hoops.push({ x: hx, z: hz, a: -d.f - Math.PI / 2 });
    }
    put(hoop, hoops, 6), (stats.hoops = hoops.length);
    const cage = PLACES.find((p) => p.k === "court")!;
    let best: Spot | null = null;
    for (let k = 0; k < 400 && !best; k++) {
      const a = k * 2.399,
        rr = 50 + k * 0.6,
        x = cage.x + Math.cos(a) * rr,
        z = cage.z + Math.sin(a) * rr;
      if (Math.abs(x) < 320 && Math.abs(z) < 320 && !blocked(x, z, 14) && !near(x, z, 16) && Math.hypot(x - cage.x, z - cage.z) > cage.w) best = { x, z, a: a + Math.PI };
    }
    if (best) put(play, [best], 20), (stats.playground = 1), c.boxes.push({ x0: best.x - 8, x1: best.x + 8, z0: best.z - 8, z1: best.z + 8, y1: 8 });
  } catch (e) {
    console.warn("LIFE props unavailable", e);
  }
  await texP;
  return stats;
}
