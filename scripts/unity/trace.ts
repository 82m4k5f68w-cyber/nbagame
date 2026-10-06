// Lockstep parity: the same xorshift128+ generator as unity Core/Types.cs Rng, legacy physics, one CPU game; prints
// one line per tick (players x/y/z, ball x/y/z, score) for N ticks. Compare with unity/CoreTests/Trace.cs.
//   npx tsx scripts/unity/trace.ts [ticks]
import * as G from "../../src/core/sim";
const M64 = (1n << 64n) - 1n;
let s0 = 0n, s1 = 0n;
function seed(seed: bigint) {
  s0 = (seed ^ 0x9e3779b97f4a7c15n) & M64;
  s1 = ((seed * 0xbf58476d1ce4e5b9n) & M64) ^ 0x94d049bb133111ebn;
  for (let i = 0; i < 8; i++) R();
}
function R() {
  let x = s0;
  const y = s1;
  s0 = y;
  x = (x ^ (x << 23n)) & M64;
  s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n);
  return Number(((s1 + y) & M64) >> 11n) * (1 / 9007199254740992);
}
seed(2024n);
Math.random = R;
const N = +(process.argv[2] || 3000);
Object.assign(G.cfg, { NP: 5, physics: "legacy", MYM: 0, DIFF: 2 });
G.cfg.input = () => ({ dx: 0, dy: 0 });
G.setQtrLen(180);
G.setCtrls([]);
G.start(0, { j: 3 });
const f = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);
for (let t = 0; t < N && G.S !== "over"; t++) {
  G.upd(1 / 60);
  if (G.RPL) G.skipReplay();
  G.FX.length = 0;
  if (G.S === "half") G.setS("play");
  if (process.env.DBG && t >= 178 && t <= 181) { const o: any = G.B.owner; console.error(t, o && o.n, o && o.mode, o && G.heldBall(o), G.inb, o && o.q && o.q.wR, o && o.act, o && o.actT, G.B.z, G.B.tgz); }
  console.log(t + " " + G.P.map((p) => f(p.x) + "," + f(p.y) + "," + f(p.z)).join(" ") + " | " + f(G.B.x) + "," + f(G.B.y) + "," + f(G.B.z) + " " + G.B.mode + " " + G.sc.join("-"));
}
