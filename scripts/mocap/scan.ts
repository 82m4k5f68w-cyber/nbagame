// Exploration: list jumps / overhead hand events in every cached CMU clip (no outputs written).
//   npx tsx scripts/mocap/scan.ts [ids...]
import fs from "node:fs";
import path from "node:path";
import { retarget31 } from "./bvh31";

const DIR = process.env.MOCAP_DIR || "/home/user/tools/mocap/cmu";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter((f) => f.endsWith(".bvh")).map((f) => f.slice(0, -4)).sort();
for (const id of ids) {
  try {
    const c = retarget31(id, path.join(DIR, id + ".bvh"), true);
    const n = c.q.length,
      dt = c.dt;
    const air = c.foot.map((f) => Math.min(f.L, f.R) > 0.35);
    const ev: string[] = [];
    for (let i = 0; i < n; i++)
      if (air[i]) {
        let j = i;
        while (j + 1 < n && air[j + 1]) j++;
        if ((j - i) * dt > 0.12) {
          // overhead hand during the flight?
          let best = -9,
            side = "";
          for (let k = Math.max(0, i - 20); k <= Math.min(n - 1, j + 10); k++) {
            const r = c.hand[k].R.y - c.headTop[k],
              l = c.hand[k].L.y - c.headTop[k];
            if (r > best) (best = r), (side = "R");
            if (l > best) (best = l), (side = "L");
          }
          const v = c.hip[j].clone().sub(c.hip[i]).divideScalar((j - i) * dt);
          const h = c.head[i],
            fw = v.x * h.x + v.z * h.z,
            sd = v.x * h.z - v.z * h.x;
          let top = 0;
          for (let k = i; k <= j; k++) top = Math.max(top, c.hip[k].y - c.hip[i].y);
          ev.push(`[${(i * dt).toFixed(2)}s ${((j - i) * dt).toFixed(2)}s rise ${top.toFixed(2)} hand ${side}${best.toFixed(2)} fw ${fw.toFixed(1)} sd ${sd.toFixed(1)}]`);
        }
        i = j;
      }
    let sp = 0;
    for (let i = 1; i < n; i++) sp += Math.hypot(c.hip[i].x - c.hip[i - 1].x, c.hip[i].z - c.hip[i - 1].z);
    console.log(id, (n * dt).toFixed(1) + "s", "speed", (sp / (n * dt)).toFixed(1), ev.join(" "));
  } catch (e: any) {
    console.log(id, "ERR", e.message);
  }
}
