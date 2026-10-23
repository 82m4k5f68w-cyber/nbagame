// Texture pipeline: ambientCG (CC0) PBR sets -> power-of-two crops -> KTX2 (ETC1S colour / roughness, UASTC normals)
// + a small WebP colour fallback -> assets/textures/ + the generated module src/client/tex/manifest.gen.ts.
//   PATH=/home/user/tools/bin:$PATH npx tsx scripts/assets/textures.ts [--force]
// Needs: toktx (KTX-Software, scripts/assets/setup.sh ktx), ffmpeg, unzip. Downloads cache in scripts/assets/.cache/tex.
// Budget: everything the module inlines (base64) <= 4 MB.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CACHE = path.join(ROOT, "scripts/assets/.cache/tex"),
  OUT = path.join(ROOT, "assets/textures"),
  GEN = path.join(ROOT, "src/client/tex/manifest.gen.ts");
const FORCE = process.argv.includes("--force"),
  BUDGET = 4 * 1024 * 1024;
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

/** name, ambientCG id, colour size, normal size, roughness size, metalness, suggested repeat in world feet per tile */
type Mat = { name: string; id: string; c: number; n: number; r: number; metal: number; tile: number; use: string };
const MATS: Mat[] = [
  { name: "woodMaple", id: "WoodFloor051", c: 1024, n: 512, r: 256, metal: 0, tile: 8, use: "arena floor (light maple strips)" },
  { name: "woodOak", id: "WoodFloor041", c: 512, n: 512, r: 256, metal: 0, tile: 8, use: "arena floor alt / practice gym (wide planks)" },
  { name: "woodParquet", id: "WoodFloor064", c: 512, n: 256, r: 256, metal: 0, tile: 6, use: "LIFE interiors / retro gym" },
  { name: "asphalt", id: "Asphalt031", c: 512, n: 512, r: 256, metal: 0, tile: 10, use: "street court, LIFE roads" },
  { name: "concrete", id: "Concrete034", c: 512, n: 256, r: 256, metal: 0, tile: 10, use: "concourse, sidewalks, tunnel" },
  { name: "brick", id: "Bricks076C", c: 512, n: 512, r: 256, metal: 0, tile: 8, use: "street court walls, LIFE buildings" },
  { name: "paintedMetal", id: "PaintedMetal004", c: 512, n: 256, r: 256, metal: 0.6, tile: 6, use: "stanchion, bleacher frames, railings" },
  { name: "fabric", id: "Fabric061", c: 512, n: 256, r: 256, metal: 0, tile: 3, use: "seats, banners, jerseys (knit-like)" },
  { name: "rubber", id: "Rubber004", c: 256, n: 256, r: 256, metal: 0, tile: 4, use: "outdoor court surface, mats, ball grip" },
];

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
function fetchZip(id: string) {
  const zip = path.join(CACHE, id + "_1K-JPG.zip"),
    dir = path.join(CACHE, id);
  if (!fs.existsSync(zip)) sh("curl", ["-fsSL", "--retry", "3", "-o", zip, `https://ambientcg.com/get?file=${id}_1K-JPG.zip`]);
  if (!fs.existsSync(dir)) (fs.mkdirSync(dir), sh("unzip", ["-q", "-o", zip, "-d", dir]));
  const f = fs.readdirSync(dir),
    pick = (re: RegExp) => {
      const x = f.find((n) => re.test(n));
      return x ? path.join(dir, x) : null;
    };
  return { color: pick(/_Color\.(jpg|png)$/i), normal: pick(/_NormalGL\.(jpg|png)$/i), rough: pick(/_Roughness\.(jpg|png)$/i) };
}
/** centre-crop to a square and scale to s x s (png, lossless intermediate) */
function square(src: string, s: number, dst: string, gray = false) {
  sh("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", `crop='min(iw,ih)':'min(iw,ih)',scale=${s}:${s}:flags=lanczos${gray ? ",format=gray" : ""}`, dst]);
}
const out: { name: string; id: string; files: Record<string, string>; m: Mat }[] = [];
let total = 0;
for (const m of MATS) {
  const src = fetchZip(m.id),
    files: Record<string, string> = {};
  if (!src.color || !src.normal || !src.rough) throw new Error(m.id + ": missing maps in the zip");
  const tmp = (k: string) => path.join(CACHE, `${m.name}_${k}.png`);
  const job = (k: string, file: string, run: () => void) => {
    const f = path.join(OUT, file);
    if (FORCE || !fs.existsSync(f)) run();
    files[k] = file;
    total += Math.ceil(fs.statSync(f).size / 3) * 4; // base64 size in the build
  };
  job("c", `${m.name}_c.ktx2`, () => {
    square(src.color!, m.c, tmp("c"));
    sh("toktx", ["--t2", "--encode", "etc1s", "--clevel", "4", "--qlevel", "200", "--genmipmap", "--assign_oetf", "srgb", path.join(OUT, `${m.name}_c.ktx2`), tmp("c")]);
  });
  job("n", `${m.name}_n.ktx2`, () => {
    square(src.normal!, m.n, tmp("n"));
    sh("toktx", ["--t2", "--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "1.5", "--zcmp", "19", "--genmipmap", "--assign_oetf", "linear", "--normalize", path.join(OUT, `${m.name}_n.ktx2`), tmp("n")]);
  });
  job("r", `${m.name}_r.ktx2`, () => {
    square(src.rough!, m.r, tmp("r"), true);
    sh("toktx", ["--t2", "--encode", "etc1s", "--clevel", "4", "--qlevel", "160", "--genmipmap", "--assign_oetf", "linear", path.join(OUT, `${m.name}_r.ktx2`), tmp("r")]);
  });
  job("fb", `${m.name}_fb.webp`, () => {
    sh("ffmpeg", ["-y", "-v", "error", "-i", src.color!, "-vf", "crop='min(iw,ih)':'min(iw,ih)',scale=256:256:flags=lanczos", "-c:v", "libwebp", "-quality", "72", path.join(OUT, `${m.name}_fb.webp`)]);
  });
  out.push({ name: m.name, id: m.id, files, m });
  console.log(`  ${m.name.padEnd(13)} ${m.id.padEnd(16)} ` + Object.values(files).map((f) => `${f.split("_").pop()} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)}K`).join("  "));
}
// generated module: ?inline imports = base64 data URLs in the single HTML, only when something imports the module
const v = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_");
let ts = `// GENERATED by scripts/assets/textures.ts - do not edit. ambientCG CC0 materials (assets/LICENSES.md).\n// Inlined as base64 data URLs only when imported (src/client/tex/index.ts). Total ~${(total / 1048576).toFixed(2)} MB base64.\n`;
for (const o of out) for (const f of Object.values(o.files)) ts += `import ${v(f)} from "../../../assets/textures/${f}?inline";\n`;
ts += `export type TexSet = { id: string; c: string; n: string; r: string; fb: string; size: [number, number, number]; metal: number; tile: number; use: string };\n`;
ts += `export const TEXSETS = {\n`;
for (const o of out)
  ts += `  ${o.name}: { id: "${o.id}", c: ${v(o.files.c)}, n: ${v(o.files.n)}, r: ${v(o.files.r)}, fb: ${v(o.files.fb)}, size: [${o.m.c}, ${o.m.n}, ${o.m.r}], metal: ${o.m.metal}, tile: ${o.m.tile}, use: ${JSON.stringify(o.m.use)} },\n`;
ts += `} satisfies Record<string, TexSet>;\nexport type TexName = keyof typeof TEXSETS;\nexport const TEX_BYTES_B64 = ${total};\n`;
fs.mkdirSync(path.dirname(GEN), { recursive: true });
fs.writeFileSync(GEN, ts);
console.log(`textures: ${out.length} materials, ${(total / 1048576).toFixed(2)} MB base64 (budget ${BUDGET / 1048576} MB) -> ${path.relative(ROOT, GEN)}`);
if (total > BUDGET) (console.error("over budget: lower sizes in MATS"), process.exit(1));
