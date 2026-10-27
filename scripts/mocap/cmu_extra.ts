// Stage extra CMU mocap clips (mirror: github.com/una-dinosauria/cmu-mocap, cgspeed BVH conversion; CMU: "free for
// research and commercial use") as retargeted joint curves in assets/mocap/cmu/*.json + an index with a motion summary.
// src/core/mocap.ts / pose.ts are NOT touched (pose parity with the Unity port stays intact); see docs/ASSETS.md.
//   npx tsx scripts/mocap/cmu_extra.ts [ids...]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SRC = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data",
  CACHE = path.resolve("scripts/mocap/.cache"),
  OUT = path.resolve("assets/mocap/cmu");
// subject 06 = basketball (dribbles, shots), 16 = run / jump, 13 = misc. jumps & reactions, 02 = various
const IDS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["06_01", "06_03", "06_04", "06_05", "06_07", "06_09", "06_10", "06_11", "06_12", "06_14", "16_01", "16_08", "16_11", "16_35", "16_45", "13_11", "13_13", "13_17", "02_04", "02_05"];
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const index: Record<string, any> = {};
for (const id of IDS) {
  const f = path.join(CACHE, id + ".bvh");
  try {
    if (!fs.existsSync(f)) execFileSync("curl", ["-fsSL", "--max-time", "120", "-o", f, `${SRC}/0${id.slice(0, 2)}/${id}.bvh`]);
    const dst = path.join(OUT, id + ".json");
    execFileSync("npx", ["tsx", "scripts/mocap/retarget.ts", "--bvh", f, "--out", dst, "--kind", "raw", "--every", "4"], { stdio: "ignore" });
    const d = JSON.parse(fs.readFileSync(dst, "utf8")),
      h = d.hipFt as number[][],
      n = h.length,
      dur = n * d.dt;
    let dist = 0;
    for (let i = 1; i < n; i++) dist += Math.hypot(h[i][0] - h[i - 1][0], h[i][2] - h[i - 1][2]);
    const ys = h.map((v) => v[1]),
      lift = Math.max(...ys) - ys.slice().sort((a, b) => a - b)[Math.floor(n / 2)];
    index[id] = { file: `assets/mocap/cmu/${id}.json`, seconds: +dur.toFixed(1), fps: Math.round(1 / d.dt), speedFtS: +(dist / dur).toFixed(1), hipLiftFt: +lift.toFixed(2), kind: lift > 0.9 ? "jump" : dist / dur > 9 ? "run" : dist / dur > 2.5 ? "walk/drive" : "in place" };
    console.log(id, JSON.stringify(index[id]));
  } catch (e: any) {
    console.log(id, "FAILED", e.message.split("\n")[0]);
  }
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
