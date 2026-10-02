// The core's analytic hand FK must match the three.js rig hierarchy (release point parity with the old GL.hand).
import * as THREE from "three";
import { handPos } from "../src/core/pose";
import { W3 } from "../src/core/sim";
let worst = 0;
for (let n = 0; n < 500; n++) {
  const r = () => (Math.random() - 0.5) * 4;
  const p: any = { x: 100 + Math.random() * 700, y: 50 + Math.random() * 400, z: Math.random() * 40, f: r(), ht: 6 + Math.random() * 1.4, bk: 0.85 + Math.random() * 0.5,
    q: { cr: Math.random(), ln: r() / 3, ty: r(), rz: r() / 4, aR: r(), sz: r() / 2, eR: r(), wR: r() } };
  const q = p.q, k = p.bk;
  const G = new THREE.Group(), bd = new THREE.Group(), sh = new THREE.Group(), el = new THREE.Group(), wr = new THREE.Group();
  bd.position.y = 3.2; G.add(bd); sh.position.set(0.88 * k * 0.95, 1.9, 0); bd.add(sh); el.position.y = -1.02; sh.add(el); wr.position.y = -1; el.add(wr);
  G.scale.setScalar(p.ht / 6.4);
  const w = W3(p.x, p.y, p.z);
  G.position.set(w[0], w[1] - q.cr * 0.4, w[2]); G.rotation.y = Math.PI / 2 - p.f;
  sh.rotation.x = -q.aR; sh.rotation.z = q.sz; el.rotation.x = -q.eR; wr.rotation.x = -q.wR; bd.rotation.set(q.ln, q.ty, q.rz, "YXZ");
  G.updateMatrixWorld(true);
  const v = wr.localToWorld(new THREE.Vector3(0, -0.62, 0.1)), ref = [v.x * 10 + 470, v.z * 10 + 250, v.y * 10];
  const h = handPos(p)!;
  worst = Math.max(worst, Math.hypot(h[0] - ref[0], h[1] - ref[1], h[2] - ref[2]));
}
console.log("FK max error (game units):", worst.toExponential(2), worst < 1e-3 ? "OK" : "MISMATCH");
