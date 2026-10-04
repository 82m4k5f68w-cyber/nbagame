// The core's analytic hand FK must match the three.js rig hierarchy (release point parity with the old GL.hand).
import * as THREE from "three";
import { handPos } from "../src/core/pose";
import { W3 } from "../src/core/sim";
import { makeRig, applyPose } from "../src/client/rig3d";
import { skeleton as skel0 } from "../src/core/pose";
import { QK } from "../src/core/sim";
let worst = 0;
for (let n = 0; n < 300; n++) {
  const r = () => (Math.random() - 0.5) * 4;
  const q: any = {};
  for (const k of QK) q[k] = r() / 2;
  q.cr = Math.random();
  q.mir = n % 2; // every other pose: a lefty's mirrored shot (handPos follows the left hand)
  const p: any = { n: "Test " + n, x: 100 + Math.random() * 700, y: 50 + Math.random() * 400, z: Math.random() * 40, f: r(), ht: 6 + Math.random() * 1.4, bk: 0.85 + Math.random() * 0.5, col: "#552583", skin: "#8d5524", hr: 1, bd: 0, no: 23, q, ry: n % 3 ? 0 : r() }; // (every third: mid-spin root yaw)
  // the REAL 3D rig (same code the browser draws), posed with applyPose
  const m = makeRig(p, null as any);
  m.G.scale.setScalar(p.ht / 6.4);
  applyPose(m, p);
  m.G.updateMatrixWorld(true);
  const v = (q.mir ? m.wL : m.wR).localToWorld(new THREE.Vector3(0, -0.62, 0.1)), ref = [v.x * 10 + 470, v.z * 10 + 250, v.y * 10];
  const h = handPos(p)!;
  worst = Math.max(worst, Math.hypot(h[0] - ref[0], h[1] - ref[1], h[2] - ref[2]));
  // 2D skeleton joints vs rig bones: head, both ankles, left knee
  const SK = new Float32Array(60);
  skel0(p, SK);
  for (const [j, b, off] of [[3, m.hd, [0, 0.44, 0]], [6, m.al, [0, 0, 0]], [10, m.ar, [0, 0, 0]], [5, m.kl, [0, 0, 0]], [7, m.al, [0, -0.06, 0.52]]] as [number, any, number[]][]) {
    const w = b.localToWorld(new THREE.Vector3(off[0], off[1], off[2]));
    worst = Math.max(worst, Math.hypot(SK[j * 3] - (w.x * 10 + 470), SK[j * 3 + 1] - (w.z * 10 + 250), SK[j * 3 + 2] - w.y * 10));
  }
}
console.log("FK max error (game units):", worst.toExponential(2), worst < 1e-3 ? "OK" : "MISMATCH");
if (worst >= 1e-3) process.exitCode = 1;
// skeleton(): its right hand must agree with handPos (same chain), on random poses
import { skeleton } from "../src/core/pose";
{
  let worst2 = 0;
  const out = new Float32Array(60);
  for (let n = 0; n < 300; n++) {
    const r = () => (Math.random() - 0.5) * 3;
    const q: any = { cr: 0.3, hz: 0.1 };
    for (const k of QK) if (q[k] == null) q[k] = r() / 2;
    const p: any = { x: 400, y: 250, z: 10, f: r(), ht: 6.6, bk: 1.1, q, ry: n % 3 ? 0 : r() };
    skeleton(p, out);
    const h = handPos(p, [0, -0.32, 0.05])!;
    worst2 = Math.max(worst2, Math.hypot(out[57] - h[0], out[58] - h[1], out[59] - h[2]));
  }
  console.log("skeleton vs handPos max error:", worst2.toExponential(2), worst2 < 1e-3 ? "OK" : "MISMATCH");
  if (worst2 >= 1e-3) process.exitCode = 1;
}
