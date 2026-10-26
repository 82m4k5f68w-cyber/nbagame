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

console.log(bad ? `assets: ${bad} FAILED` : "assets OK");
process.exit(bad ? 1 : 0);
