// Same output as unity/CoreTests/FormParity.cs, from the TypeScript build.
import { TM, formOf, ov2, CL, CK } from "../../src/core/data";
for (const [, , ps] of TM)
  for (const p of ps) {
    const f: any = formOf(p[0]);
    console.log([p[0], f.a, f.f, f.l, f.k, f.g, f.w, f.dp, f.ft, f.lk, f.tw, f.gh, f.ce.join(","), f.dk, f.gs, f.fr, "ovr " + ov2(p)].join("|"));
  }
console.log(`clips ${Object.keys(CL).length} mshot ${Object.keys(CL.mshot).length} ck ${CK.length}`);
