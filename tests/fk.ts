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
// Arms are drawn: every rig carries a real arm surface skinned to the arm bones (shoulder/elbow/wrist/fingers), with
// finite positions, weights summing to 1 and an athletic girth (bug report "arms don't show"). Also at the Low LOD.
{
  const fails: string[] = [];
  for (const lod of [1, 0])
    for (const [n, bk, ht] of [["Arm Check", 1, 6.4], ["Big Man", 1.3, 7.2], ["Little Guard", 0.85, 6.0]] as [string, number, number][]) {
      const p: any = { n, x: 470, y: 250, z: 0, f: 0, ht, bk, col: "#1d428a", skin: "#8d5524", hr: 1, bd: 0, no: 7, tm: 0, q: null };
      const m = makeRig(p, null as any, lod),
        g = m.mesh.geometry,
        pos = g.attributes.position,
        si = g.attributes.skinIndex,
        sw = g.attributes.skinWeight,
        bones = m.mesh.skeleton.bones,
        arm = new Set([m.sL, m.sR, m.eL, m.eR, m.wL, m.wR, m.gL, m.gR].map((b) => bones.indexOf(b)));
      let armV = 0,
        bad = 0,
        girth = 0;
      const sh = new THREE.Vector3().setFromMatrixPosition(m.sR.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        const w = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        if (!isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)) || Math.abs(w - 1) > 1e-4) bad++;
        if (arm.has(si.getX(i)) && sw.getX(i) > 0.5) {
          armV++;
          // right upper arm, mid-way to the elbow: distance from the bone axis
          const dy = sh.y - pos.getY(i);
          if (pos.getX(i) > 0 && dy > 0.4 && dy < 0.6) girth = Math.max(girth, Math.hypot(pos.getX(i) - sh.x, pos.getZ(i) - sh.z));
        }
      }
      if (armV < 300) fails.push(`${n} lod ${lod}: only ${armV} arm vertices`);
      if (bad) fails.push(`${n} lod ${lod}: ${bad} vertices with bad position/weights`);
      if (girth < 0.15) fails.push(`${n} lod ${lod}: upper arm radius ${girth.toFixed(3)} (too thin)`);
    }
  console.log(fails.length ? "ARMS FAIL\n" + fails.join("\n") : "arms: present, weighted, athletic girth OK");
  if (fails.length) process.exitCode = 1;
}
