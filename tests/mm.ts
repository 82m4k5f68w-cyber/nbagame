// Shot motion matching (v5.6, cfg.MM): the learned jump-shot tables are sane, release on the sim's release (RELK)
// with the classic shooting-arm pose, stay smooth, and in a seeded 5v5 stretch (MM 1 vs 0) the release point moves
// little, shots really use the tables, and the run is deterministic.  npx tsx tests/mm.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { CL } from "../src/core/data";
import { MM_T, MM_DLOAD, MM_CH, MM_KB, MM_TYPES } from "../src/core/mmshot";
import { handPos, mmType, mmLoad, clip } from "../src/core/pose";
import { execFileSync } from "node:child_process";

let fail = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? "ok   " : "FAIL ") + m);
  if (!c) fail++;
};
// ---- 1. tables ----
{
  let fin = true,
    maxStep = 0,
    where = "";
  for (const t of MM_TYPES)
    MM_T[t].forEach((r, j) => {
      if (r.length !== MM_KB || r.some((v) => !Number.isFinite(v))) fin = false;
      for (let i = 1; i < r.length; i++) {
        const d = Math.abs(r[i] - r[i - 1]);
        // (the shooting arm is anchored to the classic release - its elbow extension / wrist flick are snaps by design
        // - and cr only counts on the floor)
        if (!["aR", "eR", "sz", "wR", "cr"].includes(MM_CH[j]) && d > maxStep) (maxStep = d), (where = `${t}.${MM_CH[j]}@${i}`);
      }
    });
  ok(fin && MM_DLOAD.every((r) => r.length === MM_KB && r.every(Number.isFinite)), "tables finite, " + MM_TYPES.length + " types x " + MM_CH.length + " channels x " + MM_KB + " keys");
  ok(maxStep < 0.25, `largest key-to-key step (learned channels) ${maxStep.toFixed(3)} rad < .25 (${where})`);
}
// ---- 2. release pose = classic shooting arm at RELK, per type (clip() through a fake player) ----
{
  const smp = (a: number[] | undefined, k: number): number | null => {
    if (!a) return null;
    if (k <= a[0]) return a[1];
    for (let i = 2; i < a.length; i += 2)
      if (k <= a[i]) {
        const u = (k - a[i - 2]) / (a[i] - a[i - 2]);
        return a[i - 1] + (a[i + 1] - a[i - 1]) * u * u * (3 - 2 * u);
      }
    return a[a.length - 1];
  };
  const kinds: [number, string, number, string][] = [
    [22, "cs", 0.7, "jump"],
    [1, "quick", 0.46, "quick"],
    [2, "fade", 0.7, "fade"],
    [3, "step", 0.7, "step"],
  ];
  let worst = 0;
  for (const [sv, , rk, ck] of kinds) {
    const p: any = { sv, sg: { dp: 0.225, k: 0.08 }, ht: 6.6, tm: 0, x: 600, y: 250, sqn: 0 };
    const o = clip(p, rk);
    for (const ch of ["aR", "eR", "sz", "wR"]) {
      const c = smp(CL[ck][ch], rk) ?? smp(CL.jump[ch], rk)!;
      worst = Math.max(worst, Math.abs(o[ch] - c));
    }
    worst = Math.max(worst, Math.abs(o.hR));
  }
  ok(worst < 0.06, `shooting arm at the release key = the classic release pose (max |diff| ${worst.toFixed(3)} rad)`);
  const p: any = { sv: 22, sg: {}, ht: 6.6, tm: 0, x: 470, y: 250, sqn: 0 };
  ok(mmType(p) === MM_TYPES.indexOf("deep"), "a jumper from 41 ft uses the deep-three table");
  p.x = 700;
  ok(mmType(p) === MM_TYPES.indexOf("cs"), "a set jumper at 19 ft uses catch-and-shoot");
  p.sqn = 3;
  ok(mmType(p) === MM_TYPES.indexOf("pull"), "on the move (Pro Play v2 sqn 3) uses the pull-up table");
  for (const sv of [5, 6, 9, 10, 20, 21, 24]) p.sv = sv, ok(mmType(p) === -1, `clip ${sv} (${["lay", "dunk", "curry", "hook", "leaner", "runner", "floater"][[5, 6, 9, 10, 20, 21, 24].indexOf(sv)]}) keeps its classic clip`);
  ok(Math.abs(mmLoad({ sg: { dp: 0.225, k: 0.08 }, ht: 6.6 } as any)) < 1e-9 && mmLoad({ sg: { dp: 0.45, k: 0.3 }, ht: 6.2 } as any) > 1, "load axis: average form 0, deep dip + leg load > 1");
}
// ---- 3. seeded 5v5 A/B ----
type Res = { rel: number[]; relX: number[]; mmTicks: number; shotJerk: number[]; sum: number };
function run(mm: number): Res {
  let s = 777;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, PRO: 1, MM: mm });
  G.cfg.input = () => ({ dx: 0, dy: 0 }) as any;
  G.setCtrls([]);
  G.setQtrLen(180);
  G.start(0);
  G.setup(0);
  G.setInb(0);
  const r: Res = { rel: [], relX: [], mmTicks: 0, shotJerk: [], sum: 0 };
  const lc = new Map<any, number>(),
    prev = new Map<any, number[][]>();
  for (let i = 0; i < 60 * 150 && G.S !== "over"; i++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    if (G.S === "half") G.setS("play");
    for (const p of G.P) {
      if ((p.lc || 0) !== (lc.get(p) || 0)) {
        lc.set(p, p.lc || 0);
        const h = handPos(p);
        if (h && !G.ftq && p.sv !== 5 && p.sv !== 7 && !(p.sv >= 11 && p.sv <= 19) && p.sv !== 6) {
          r.rel.push(h[2] - p.z);
          r.relX.push(Math.hypot(h[0] - p.x, h[1] - p.y));
        }
      }
      if (p.mode === "s" && mmType(p) >= 0) r.mmTicks++;
      const q: any = p.q || {},
        v = G.QK.map((k) => q[k] || 0);
      for (let j = 0; j < v.length; j++) r.sum += v[j] * (j + 1);
      const h = prev.get(p) || [];
      if (p.mode === "s" && h.length === 2 && !(p.hitT > 0))
        for (let j = 0; j < v.length; j++) if (G.QK[j] !== "wR" && G.QK[j] !== "wL" && G.QK[j] !== "gL" && G.QK[j] !== "gR") r.shotJerk.push(Math.abs(v[j] - 2 * h[1][j] + h[0][j]));
      prev.set(p, p.mode === "s" ? [h[1] || v, v] : []);
    }
  }
  return r;
}
if (process.argv[2] === "--run") {
  // (child process: one fresh run - the sim keeps global state across start(), so determinism is checked per process)
  rapInit().then(() => {
    const r = run(+process.argv[3]);
    console.log("RUN " + r.sum + " " + r.rel.join(","));
    process.exit(0);
  });
} else (async () => {
  await rapInit();
  const a = run(0),
    b = run(1),
    one = () => execFileSync("npx", ["tsx", "tests/mm.ts", "--run", "1"], { encoding: "utf8" }).split("\n").find((l) => l.startsWith("RUN ")),
    r1 = one(),
    r2 = one();
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length),
    pct = (x: number[], q: number) => x.slice().sort((u, v) => u - v)[Math.floor(x.length * q)] || 0;
  console.log(`jumpers launched: classic ${a.rel.length}, MM ${b.rel.length}; MM shot ticks ${b.mmTicks}`);
  console.log(`release height over the root (px): classic ${mean(a.rel).toFixed(1)}, MM ${mean(b.rel).toFixed(1)}; reach from the body: classic ${mean(a.relX).toFixed(1)}, MM ${mean(b.relX).toFixed(1)}`);
  console.log(`shot jerk p99 / max (rad/tick^2): classic ${pct(a.shotJerk, 0.99).toFixed(3)} / ${Math.max(...a.shotJerk).toFixed(2)}, MM ${pct(b.shotJerk, 0.99).toFixed(3)} / ${Math.max(...b.shotJerk).toFixed(2)}`);
  ok(b.mmTicks > 100 && a.mmTicks === 0, "MM=1 shots sample the learned tables, MM=0 never");
  ok(Math.abs(mean(a.rel) - mean(b.rel)) < 6 && Math.abs(mean(a.relX) - mean(b.relX)) < 4, "release point within 6 px height / 4 px reach of the classic clips on average");
  ok(pct(b.shotJerk, 0.99) <= pct(a.shotJerk, 0.99) * 1.3 + 0.01 && Math.max(...b.shotJerk) <= Math.max(Math.max(...a.shotJerk) * 1.3, 1.3), "shots stay as smooth as the classic clips (jerk p99 / max within 1.3x)");
  ok(!!r1 && r1 === r2, "deterministic (same seed, fresh process -> same poses and release points)");
  ok(a.sum !== b.sum, "MM changes the poses (A/B differs)");
  console.log(fail ? `MM: ${fail} FAILED` : "MM OK");
  process.exit(fail ? 1 : 0);
})();
