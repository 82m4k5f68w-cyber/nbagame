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
let RN = 0;
function R() {
  RN++;
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
// "hum" (3rd arg): a scripted human on team 0 (arithmetic-only pattern, same in Trace.cs) covers the human-only paths
// (move buffer / cancel window, stance, sprint burst, release feedback, passes, fakes, step-backs).
// "my": the same scripted human as My Player (Pro Play v2 off-ball paths: call for the ball / a screen, flick cuts)
const MY = process.argv[3] === "my",
  HUM = process.argv[3] === "hum" || MY;
if (MY) G.cfg.MYM = 1;
let TK = 0;
const hin = (t: number) => {
  const ph = t % 240,
    i: any = { dx: ph < 60 ? 1 : ph < 120 ? -0.6 : ph < 180 ? 0.3 : -1, dy: ((Math.floor(t / 37) % 3) - 1) * 0.7 };
  if (Math.floor(t / 100) % 2 === 0) i.sp = 1;
  if (t % 53 === 0) i.mv = 1 + (Math.floor(t / 53) % 3);
  else if (t % 53 === 20) i.mv = 3;
  if (t % 131 === 0) i.sd = 1;
  if (t % 131 === 22) i.su = 1;
  if (t % 173 === 90) i.pf = 1;
  if (t % 97 === 40) i.e = 1;
  if (t % 211 === 150) i.sb = 1;
  if (MY && t % 300 >= 200 && t % 300 < 230) i.post = 1; // (Pro Play v2: post key - screens / post-ups)
  return i;
};
G.cfg.input = HUM ? () => hin(TK) : () => ({ dx: 0, dy: 0 });
G.setQtrLen(180);
G.setCtrls(HUM ? [G.mkCtrl("h", 0)] : []);
G.start(0, { j: 3 });
const f = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);
for (let t = 0; t < N && G.S !== "over"; t++) {
  TK = t;
  G.upd(1 / 60);
  if (G.RPL) G.skipReplay();
  G.FX.length = 0;
  if (G.S === "half") G.setS("play");
  if (process.env.DBG && t >= 178 && t <= 181) { const o: any = G.B.owner; console.error(t, o && o.n, o && o.mode, o && G.heldBall(o), G.inb, o && o.q && o.q.wR, o && o.act, o && o.actT, G.B.z, G.B.tgz); }
  // POSE=1: + a per-player pose checksum (every joint channel, weighted by its index) - pose parity, not just positions
  const qs = process.env.POSE ? " q" + G.P.map((p) => { let s = 0; const q: any = p.q || {}; for (let j = 0; j < G.QK.length; j++) s += (q[G.QK[j]] || 0) * (j + 1); return f(s); }).join(",") : "";
  console.log(t + " " + G.P.map((p) => f(p.x) + "," + f(p.y) + "," + f(p.z)).join(" ") + " | " + f(G.B.x) + "," + f(G.B.y) + "," + f(G.B.z) + " " + G.B.mode + " " + G.sc.join("-") + " r" + RN + qs);
}
