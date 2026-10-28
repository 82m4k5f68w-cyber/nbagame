// Asset pipeline outputs: voice bank index + coverage, texture module + KTX2 files, model kits (meshopt GLBs).
//   npx tsx tests/assets.ts        (browser side: node tests/browser_assets.mjs)
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { TM } from "../src/core/data";
import { parseBank, matchLine, vnorm } from "../src/client/voicekey";
import { commentaryPieces } from "../scripts/assets/lines";

let bad = 0;
const ok = (c: any, m: string) => (c ? 0 : (bad++, console.log("FAIL " + m)));

// ---------- voice bank ----------
const raw = fs.readFileSync("assets/voice/bank.bin");
ok(raw.length <= 3 * 1024 * 1024, `voice bank ${raw.length} B > 3 MB`);
const { ix, data } = parseBank(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
ok(ix.v === 1 && /opus/.test(ix.mime), "voice index header");
let span = 0;
for (const ns of ["c", "p"] as const)
  for (const [k, [o, n, ms]] of Object.entries(ix[ns])) {
    ok(o >= 0 && n > 40 && o + n <= data.length, `clip ${ns}:${k} out of range`);
    ok(data[o] === 0x1a && data[o + 1] === 0x45 && data[o + 2] === 0xdf && data[o + 3] === 0xa3, `clip ${ns}:${k} not WebM (EBML)`);
    ok(ms > 80 && ms < 9000, `clip ${ns}:${k} duration ${ms} ms`);
    span = Math.max(span, o + n);
  }
ok(span === data.length, "clip data has trailing / missing bytes");
const players = TM.flatMap((t) => t[2].map((p) => p[0]));
for (const n of players) ok(ix.c[vnorm(n)] && ix.p[vnorm(n)], `name ${n} missing from the bank`);
for (const t of TM) ok(ix.c[vnorm(t[0])], `team ${t[0]} missing`);
for (let k = 0; k < 100; k++) ok(ix.p[String(k)] && ix.c[String(k)], `number ${k} missing`);
for (const k of ["threeeee", "and one", "from downtown", "number", "your starting lineup"]) ok(ix.p[k], `PA ${k} missing`);
// real commentary lines must be fully covered (no browser fallback mid-game for the common calls)
const lines = [
  "Curry from downtown... BANG!",
  "Doncic knocks down the three!",
  "SPLASH! Curry doesn't even touch the rim!",
  "Reaves to Doncic — SLAM!",
  "Curry for three... GOT IT!",
  "That's six — Green has fouled out.",
  "The Warriors call time to talk it over.",
  "Lakers are on a run — somebody call timeout!",
  "Here's the set from the Lakers — horns.",
  "Whistle — 3 seconds. Turnover.",
];
for (const s of lines) ok(matchLine(s, ix.c, ix.mw), `no bank match: "${s}"`);
// every template piece in broadcast.ts is in the bank (re-run scripts/assets/voice.ts after adding commentary)
const bc = fs.readFileSync("src/client/broadcast.ts", "utf8");
const lit = commentaryPieces(bc).map(vnorm).filter(Boolean);
const miss = lit.filter((k) => !ix.c[k]);
ok(miss.length === 0, `broadcast.ts lines not in the voice bank (re-run voice.ts): ${miss.slice(0, 5).join(" | ")}`);
console.log(`voice: ${Object.keys(ix.c).length} commentary + ${Object.keys(ix.p).length} PA clips, ${(raw.length / 1048576).toFixed(2)} MB`);

// ---------- textures ----------
const gen = fs.readFileSync("src/client/tex/manifest.gen.ts", "utf8");
const files = [...gen.matchAll(/assets\/textures\/([^"?]+)\?inline/g)].map((m) => m[1]);
ok(files.length >= 36, `texture module lists ${files.length} files`);
let b64 = 0;
for (const f of files) {
  const b = fs.readFileSync("assets/textures/" + f);
  b64 += Math.ceil(b.length / 3) * 4;
  if (f.endsWith(".ktx2")) ok(b.subarray(1, 7).toString("latin1") === "KTX 20", `${f} not KTX2`);
  else ok(b.subarray(8, 12).toString("latin1") === "WEBP", `${f} not WebP`);
}
ok(b64 <= 4 * 1024 * 1024, `textures ${b64} B base64 > 4 MB`);
const sets = [...gen.matchAll(/^  (\w+): \{ id: "(\w+)"/gm)].map((m) => m[1]);
ok(sets.length >= 9 && ["woodMaple", "asphalt", "brick", "rubber"].every((s) => sets.includes(s)), "texture sets: " + sets.join(","));
console.log(`textures: ${sets.length} sets, ${files.length} files, ${(b64 / 1048576).toFixed(2)} MB base64`);

// ---------- models ----------
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const rep = JSON.parse(fs.readFileSync("assets/models/models.json", "utf8"));
let mb = 0;
for (const [kit, r] of Object.entries<any>(rep)) {
  const doc = await io.read(r.file),
    roots = doc.getRoot().getDefaultScene()!.listChildren().map((n) => n.getName());
  mb += Math.ceil(fs.statSync(r.file).size / 3) * 4;
  ok(JSON.stringify(roots) === JSON.stringify(r.models), `${kit}: root nodes != models.json`);
  ok(doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "EXT_meshopt_compression"), `${kit}: not meshopt-compressed`);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  ok(tris > 100, `${kit}: ${tris} triangles`);
}
const ml = fs.readFileSync("src/client/models.ts", "utf8");
for (const k of Object.keys(rep)) ok(ml.includes(`assets/models/${k}.glb?inline`), `models.ts does not import ${k}`);
ok(mb <= 2 * 1024 * 1024, `models ${mb} B base64 > 2 MB`);
console.log(`models: ${Object.keys(rep).length} kits, ${Object.values<any>(rep).reduce((a, r) => a + r.models.length, 0)} models, ${(mb / 1048576).toFixed(2)} MB base64`);

// ---------- procedural props (Blender -> xatlas lightmap UVs -> meshopt) ----------
for (const f of fs.existsSync("assets/models/props") ? fs.readdirSync("assets/models/props") : []) {
  const d = await io.read("assets/models/props/" + f);
  const ps = d.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  ok(ps.length > 0 && ps.every((p) => p.getAttribute("TEXCOORD_1")), `props/${f}: missing lightmap UVs (TEXCOORD_1)`);
}

// ---------- device probe -> preset ----------
const { pickPreset } = await import("../src/client/probepick");
ok(pickPreset(0.6, 3, false) === 3 && pickPreset(1.0, 3, false) === 2 && pickPreset(0.6, 2, false) === 2, "pickPreset fast desktop");
ok(pickPreset(1.8, 3, false) === 1 && pickPreset(3, 3, false) === 0 && pickPreset(0.6, 3, true) === 1, "pickPreset slow cpu / mobile caps");
ok(pickPreset(0.5, 0, false) === -1 && pickPreset(0.5, 1, false) === 0, "pickPreset unknown gpu keeps the default, tier 1 = Chromebook");

// ---------- three-mesh-bvh: accelerated raycasts on a dense mesh ----------
{
  const THREE = await import("three");
  const { computeBoundsTree, acceleratedRaycast } = await import("three-mesh-bvh");
  (THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
  const g = new THREE.TorusKnotGeometry(1, 0.3, 400, 64),
    mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial()),
    rc = new THREE.Raycaster(),
    rays = 300;
  const cast = () => {
    let hits = 0;
    const t0 = performance.now();
    for (let i = 0; i < rays; i++) {
      rc.set(new THREE.Vector3(Math.sin(i) * 4, Math.cos(i * 1.3) * 4, 4), new THREE.Vector3(-Math.sin(i) * 0.9, -Math.cos(i * 1.3) * 0.9, -1).normalize());
      hits += rc.intersectObject(mesh).length ? 1 : 0;
    }
    return [performance.now() - t0, hits];
  };
  const [slow, h0] = cast();
  (g as any).computeBoundsTree();
  mesh.raycast = acceleratedRaycast as any;
  const [fast, h1] = cast();
  ok(h0 === h1 && h1 > 0, `bvh hits differ ${h0} vs ${h1}`);
  ok(fast * 5 < slow, `bvh not faster: ${fast.toFixed(1)} vs ${slow.toFixed(1)} ms`);
  console.log(`three-mesh-bvh: ${g.index!.count / 3} tris, ${rays} rays ${slow.toFixed(0)} -> ${fast.toFixed(1)} ms`);
}

// ---------- recast-navigation: LIFE town navmesh, paths stay off buildings ----------
{
  const { buildTownNav } = await import("../src/client/nav");
  const { PLACES, WORLD, blocked } = await import("../src/life/places");
  const N = await buildTownNav(PLACES as any, WORLD);
  let paths = 0,
    inside = 0;
  const ids = PLACES.filter((p) => p.k !== "court").slice(0, 8);
  for (let i = 0; i + 1 < ids.length; i++) {
    const a: any = ids[i], b: any = ids[i + 1];
    const s = N.snap({ x: a.x, z: a.z + a.d / 2 + 4 }), e = N.snap({ x: b.x, z: b.z + b.d / 2 + 4 });
    if (!s || !e) continue;
    const P = N.path(s, e);
    if (P.length >= 2) paths++;
    for (let k = 1; k < P.length; k++) for (let j = 0; j <= 16; j++) if (blocked(P[k - 1].x + ((P[k].x - P[k - 1].x) * j) / 16, P[k - 1].z + ((P[k].z - P[k - 1].z) * j) / 16, 0.2)) inside++;
  }
  ok(paths >= 5, `navmesh paths found: ${paths}`);
  ok(inside === 0, `navmesh path samples inside buildings: ${inside}`);
  console.log(`recast-navigation: ${paths} door-to-door paths, ${inside} samples inside buildings`);
}

console.log(bad ? `assets: ${bad} FAILED` : "assets OK");
process.exit(bad ? 1 : 0);
