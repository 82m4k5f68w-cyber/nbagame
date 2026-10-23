// Kenney (CC0) model pipeline: download packs -> pick a curated set -> one GLB per kit (each model = a named root node)
// -> dedup / prune / weld -> meshopt compression (EXT_meshopt_compression + quantization) -> assets/models/*.glb.
//   npx tsx scripts/assets/models.ts            (zips cached in scripts/assets/.cache/kenney)
// Runtime: src/client/models.ts (GLTFLoader + MeshoptDecoder). Budget: all kits <= 2 MB once base64-inlined.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { NodeIO, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mergeDocuments, dedup, prune, weld, meshopt, unpartition } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CACHE = path.join(ROOT, "scripts/assets/.cache/kenney"),
  OUT = path.join(ROOT, "assets/models"),
  BUDGET = 2 * 1024 * 1024;
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const PACKS: Record<string, string> = {
  "city-kit-commercial": "City Kit Commercial 2.1",
  "city-kit-suburban": "City Kit Suburban 2.0",
  "city-kit-roads": "City Kit Roads 2.2",
  "car-kit": "Car Kit 3.1",
  "furniture-kit": "Furniture Kit 2.0",
};
/** kit name -> [pack, model file names] (one output GLB per kit) */
const KITS: Record<string, [string, string[]][]> = {
  city: [
    ["city-kit-commercial", ["building-a", "building-b", "building-c", "building-d", "building-e", "building-g", "building-h", "building-k", "building-skyscraper-a", "building-skyscraper-c", "low-detail-building-a", "low-detail-building-b", "low-detail-building-wide-a", "detail-awning", "detail-parasol-a"]],
    ["city-kit-suburban", ["building-type-a", "building-type-c", "building-type-b", "building-type-e", "building-type-h", "building-type-o", "building-type-t", "fence-1x3", "fence-low", "planter", "tree-large", "tree-small", "driveway-short", "path-long"]],
  ],
  roads: [["city-kit-roads", ["road-straight", "road-bend", "road-crossroad", "road-intersection", "road-end", "road-side", "construction-cone", "construction-barrier", "dumpster", "light-square", "light-curved", "traffic-light", "road-sign-stop", "electricity-pole", "tile-low"]]],
  cars: [["car-kit", ["sedan", "suv", "taxi", "police", "van", "truck", "hatchback-sports", "ambulance", "delivery", "garbage-truck", "firetruck", "race", "cone", "box"]]],
  furniture: [["furniture-kit", ["bench", "benchCushion", "chair", "chairCushion", "chairModernCushion", "stoolBar", "table", "tableRound", "tableCoffee", "loungeSofa", "loungeChair", "trashcan", "speaker", "televisionModern", "pottedPlant", "plantSmall1", "lampSquareFloor", "bookcaseOpen", "bedSingle", "bedDouble", "desk", "kitchenFridge", "kitchenStove", "kitchenSink", "rugRectangle", "cardboardBoxClosed", "doorway", "wall", "wallWindow", "floorFull", "stairs", "ceilingFan", "laptop", "computerScreen", "radio", "kitchenBar", "stoolBarSquare"]]],
};

function pack(name: string) {
  const dir = path.join(CACHE, name),
    zip = dir + ".zip";
  if (!fs.existsSync(dir)) {
    if (!fs.existsSync(zip)) {
      const page = execFileSync("curl", ["-fsSL", `https://kenney.nl/assets/${name}`]).toString();
      const url = (page.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"]*\.zip/) || [])[0];
      if (!url) throw new Error("no download link on kenney.nl/assets/" + name);
      execFileSync("curl", ["-fsSL", "-o", zip, url]);
    }
    fs.mkdirSync(dir);
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  }
  const sub = ["Models/GLB format", "Models/GLTF format"].map((s) => path.join(dir, s)).find((s) => fs.existsSync(s));
  if (!sub) throw new Error(name + ": no GLB folder");
  return sub;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const report: Record<string, { file: string; bytes: number; models: string[]; source: string[] }> = {};
let total = 0;
for (const [kit, list] of Object.entries(KITS)) {
  const doc = new Document(),
    root = doc.getRoot();
  doc.createBuffer();
  const scene = doc.createScene(kit);
  const names: string[] = [];
  for (const [pk, models] of list) {
    const dir = pack(pk);
    for (const m of models) {
      const f = path.join(dir, m + ".glb");
      if (!fs.existsSync(f)) throw new Error(`${pk}/${m}.glb missing`);
      const before = new Set(root.listScenes());
      mergeDocuments(doc, await io.read(f));
      for (const s of root.listScenes()) {
        if (before.has(s)) continue;
        const n = doc.createNode(m);
        for (const c of s.listChildren()) n.addChild(c);
        scene.addChild(n);
        s.dispose();
      }
      names.push(m);
    }
  }
  root.setDefaultScene(scene);
  await doc.transform(unpartition(), dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const file = path.join(OUT, kit + ".glb");
  await io.write(file, doc);
  const bytes = fs.statSync(file).size;
  total += Math.ceil(bytes / 3) * 4;
  report[kit] = { file: `assets/models/${kit}.glb`, bytes, models: names, source: list.map(([p]) => PACKS[p]) };
  console.log(`  ${kit.padEnd(10)} ${names.length} models  ${(bytes / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(OUT, "models.json"), JSON.stringify(report, null, 1));
console.log(`models: ${(total / 1048576).toFixed(2)} MB base64 (budget ${BUDGET / 1048576} MB)`);
if (total > BUDGET) (console.error("over budget: drop models from KITS"), process.exit(1));
