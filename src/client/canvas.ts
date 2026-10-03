// @ts-nocheck -- renderer ported verbatim from the legacy modes
// Canvas renderers: the 2D broadcast-style court (2D modes) and the software-3D fallback used when WebGL is unavailable.
// They draw from the shared sim state onto the HUD canvas context.
import { P, B, T, pos, PC, HXs, HY, RR, W3, isH, NETS, cfg } from "../core/sim";
import { skeleton } from "../core/pose";
import { pr } from "./view";
let X: CanvasRenderingContext2D = null as any;
export const setCanvasCtx = (x: CanvasRenderingContext2D) => (X = x);
// ---------------- 2D court ----------------
export function court2d() {
  const street = !!cfg.HALF;
  let gr = X.createLinearGradient(0, 0, 0, 110);
  gr.addColorStop(0, street ? "#5d7fae" : "#0b0d1c");
  gr.addColorStop(1, street ? "#9db4cf" : "#2a1d45");
  X.fillStyle = gr;
  X.fillRect(0, 0, 960, 540);
  for (let k = 0; k < (street ? 0 : 200); k++) {
    X.fillStyle = [
      "#6a4c93",
      "#c9184a",
      "#f4a261",
      "#2a9d8f",
      "#e9c46a",
      "#4361ee",
    ][k % 6];
    X.fillRect(
      (k * 53) % 950,
      12 + ((k * 29) % 80) + Math.sin(T * 3 + k) * 0.8,
      4,
      5,
    );
  }
  X.fillStyle = street ? "#44464c" : "#c98f4d";
  X.fillRect(10, 110, 940, 390);
  X.strokeStyle = "rgba(0,0,0,.07)";
  for (let x = 10; x < 950; x += 47) {
    X.beginPath();
    X.moveTo(x, 110);
    X.lineTo(x, 500);
    X.stroke();
  }
  X.strokeStyle = "rgba(255,255,255,.9)";
  X.lineWidth = 2.5;
  X.strokeRect(10, 110, 940, 390);
  X.beginPath();
  X.moveTo(480, 110);
  X.lineTo(480, 500);
  X.stroke();
  const E = (x, y, rx, ry, a, b) => {
    X.beginPath();
    X.ellipse(x + 10, 110 + y * 0.78, rx, ry * 0.78, 0, a, b);
    X.stroke();
  };
  E(470, 250, 60, 60, 0, 6.3);
  for (const b of [0, 1]) {
    const hx = HXs[b],
      s = b ? -1 : 1,
      e = b ? 0 : 940;
    X.strokeRect(b ? 10 + 940 - 190 : 10, 110 + 170 * 0.78, 190, 160 * 0.78);
    E(e + s * 190, 250, 60, 60, b ? 1.57 : -1.57, b ? 4.71 : 1.57);
    E(hx, 250, 237, 237, b ? Math.PI - 1.19 : -1.19, b ? Math.PI + 1.19 : 1.19);
    X.beginPath();
    for (const y of [30, 470]) {
      X.moveTo(e + 10, 110 + y * 0.78);
      X.lineTo(hx + s * 88 + 10, 110 + y * 0.78);
    }
    X.stroke();
  }
  X.fillStyle = "rgba(255,255,255,.13)";
  X.font = "900 56px system-ui";
  X.textAlign = "center";
  X.fillText("HOOPS 2K27", 480, 330);
}
export function hoop2d(b: number) {
  const hx = HXs[b],
    bx = b ? 900 : 40,
    pl = b ? 912 : 28,
    a = pr(pl, 250, 0),
    c = pr(pl, 250, 110);
  X.strokeStyle = "#333";
  X.lineWidth = 5;
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(c[0], c[1]);
  X.stroke();
  X.fillStyle = "rgba(235,240,255,.85)";
  X.beginPath();
  [
    [220, 96],
    [280, 96],
    [280, 136],
    [220, 136],
  ].forEach((v, k) => {
    const p = pr(bx, v[0], v[1]);
    k ? X.lineTo(p[0], p[1]) : X.moveTo(p[0], p[1]);
  });
  X.fill();
  X.strokeStyle = "#fff";
  X.stroke();
}
export function net2d(b: number) {
  // back half of the rim, net strands (shadowed), then the front of the rim on top
  const c = pr(HXs[b], HY, 100);
  X.lineWidth = 2.6;
  X.strokeStyle = "#b8340f";
  X.beginPath();
  X.ellipse(c[0], c[1], RR, RR * 0.78, 0, Math.PI, 2 * Math.PI);
  X.stroke();
  X.lineCap = "round";
  for (const [col, w, dy] of [
    ["rgba(0,0,0,.25)", 1.6, 1],
    ["rgba(255,255,255,.92)", 1.1, 0],
  ] as const) {
    X.strokeStyle = col;
    X.lineWidth = w;
    X.beginPath();
    for (const cn of NETS[b].c) {
      if (!cn[4]) continue;
      const u = pr(cn[0].x, cn[0].y, cn[0].z),
        v = pr(cn[1].x, cn[1].y, cn[1].z);
      X.moveTo(u[0], u[1] + dy);
      X.lineTo(v[0], v[1] + dy);
    }
    X.stroke();
  }
  X.strokeStyle = "#ff5a1f";
  X.lineWidth = 2.8;
  X.beginPath();
  X.ellipse(c[0], c[1], RR, RR * 0.78, 0, 0, Math.PI);
  X.stroke();
}
const SK = new Float32Array(60);
/** 2D player drawn from the same 20-joint skeleton the 3D rig uses (same shooting forms, moves and contact). */
export function player2d(p: any) {
  const fy = pr(p.x, p.y, 0),
    ctl = isH(p),
    sh = Math.max(0.4, 1 - p.z * 0.01);
  X.fillStyle = "rgba(0,0,0,.28)";
  X.beginPath();
  X.ellipse(fy[0], fy[1], 11 * sh, 5 * sh, 0, 0, 6.3);
  X.fill();
  if (ctl) {
    X.strokeStyle = p.tm ? "#4fd1ff" : "#ffd23f";
    X.lineWidth = 2;
    X.beginPath();
    X.ellipse(fy[0], fy[1], 15, 7, 0, 0, 6.3);
    X.stroke();
  }
  if (!p.q) return;
  skeleton(p, SK);
  const P2 = (i: number) => pr(SK[i * 3], SK[i * 3 + 1], SK[i * 3 + 2]),
    J = Array.from({ length: 20 }, (_, i) => P2(i)),
    depth = (i: number) => SK[i * 3 + 1], // larger game y = nearer the camera
    skin = p.skin,
    dark = "#1b1b22";
  const seg = (a: number, b: number, w: number, col: string) => {
    X.strokeStyle = col;
    X.lineWidth = w;
    X.beginPath();
    X.moveTo(J[a][0], J[a][1]);
    X.lineTo(J[b][0], J[b][1]);
    X.stroke();
  };
  X.lineCap = X.lineJoin = "round";
  const legL = () => {
      seg(5, 6, 4.2, skin);
      seg(6, 7, 4.6, "#f4f4f4");
      seg(4, 5, 5.4, skin);
    },
    legR = () => {
      seg(9, 10, 4.2, skin);
      seg(10, 11, 4.6, "#f4f4f4");
      seg(8, 9, 5.4, skin);
    },
    armL = () => {
      seg(12, 13, 3.6, skin);
      seg(13, 14, 3.2, skin);
      seg(14, 15, 3.4, skin);
    },
    armR = () => {
      seg(16, 17, 3.6, skin);
      seg(17, 18, 3.2, skin);
      seg(18, 19, 3.4, skin);
    },
    body = () => {
      // shorts: hips to mid-thigh
      X.fillStyle = p.col;
      X.beginPath();
      const mL = [(J[4][0] + J[5][0]) / 2, (J[4][1] + J[5][1]) / 2],
        mR = [(J[8][0] + J[9][0]) / 2, (J[8][1] + J[9][1]) / 2];
      X.moveTo(J[4][0] - 2, J[4][1] - 2);
      X.lineTo(J[8][0] + 2, J[8][1] - 2);
      X.lineTo(mR[0] + 3, mR[1]);
      X.lineTo(mL[0] - 3, mL[1]);
      X.closePath();
      X.fill();
      // jersey: a solid trunk, then the tapered outline from hips to shoulders
      seg(0, 1, 12, p.col);
      seg(1, 2, 10, p.col);
      X.beginPath();
      X.moveTo(J[4][0] - 1, J[4][1]);
      X.lineTo(J[8][0] + 1, J[8][1]);
      X.lineTo(J[16][0] + 1, J[16][1] + 1);
      X.lineTo(J[2][0], J[2][1] + 2);
      X.lineTo(J[12][0] - 1, J[12][1] + 1);
      X.closePath();
      X.fill();
      X.strokeStyle = "rgba(0,0,0,.25)";
      X.lineWidth = 1;
      X.stroke();
      if (p.no != null) {
        X.fillStyle = "rgba(255,255,255,.9)";
        X.font = "900 7px system-ui";
        X.textAlign = "center";
        X.fillText(String(p.no), J[1][0], J[1][1] + 3);
      }
      seg(2, 3, 3, skin); // neck
      X.fillStyle = skin;
      X.beginPath();
      X.arc(J[3][0], J[3][1], 5.2, 0, 6.3);
      X.fill();
      X.fillStyle = p.hr ? dark : "rgba(0,0,0,.15)";
      X.beginPath();
      X.arc(J[3][0], J[3][1] - 1.2, p.hr === 3 ? 6.6 : 5.4, Math.PI * 1.05, Math.PI * 1.95);
      X.fill();
    };
  // painter's order: far leg/arm, body, near leg/arm
  const lFar = depth(6) < depth(10),
    aFar = depth(14) < depth(18);
  (lFar ? legL : legR)();
  (aFar ? armL : armR)();
  body();
  (lFar ? legR : legL)();
  (aFar ? armR : armL)();
}
export function ball2d() {
  const f = pr(B.x, B.y, 0),
    b = pr(B.x, B.y, B.z),
    k = Math.max(0.35, 1 - B.z * 0.006);
  X.fillStyle = `rgba(0,0,0,${0.32 * k})`;
  X.beginPath();
  X.ellipse(f[0], f[1], 6 * k, 3 * k, 0, 0, 6.3);
  X.fill();
  X.save();
  X.translate(b[0], b[1]);
  const g = X.createRadialGradient(-1.8, -1.8, 0.5, 0, 0, 5.6);
  g.addColorStop(0, "#ffa357");
  g.addColorStop(1, "#b9470f");
  X.fillStyle = g;
  X.beginPath();
  X.arc(0, 0, 5.6, 0, 6.3);
  X.fill();
  X.rotate(B.a);
  X.strokeStyle = "rgba(40,14,3,.85)";
  X.lineWidth = 0.9;
  X.beginPath();
  X.moveTo(-5.6, 0);
  X.lineTo(5.6, 0);
  X.moveTo(0, -5.6);
  X.lineTo(0, 5.6);
  X.stroke();
  X.beginPath();
  X.ellipse(0, 0, 2.6, 5.6, 0, 0, 6.3);
  X.stroke();
  X.restore();
}
// ---------------- software 3D fallback ----------------
export const CP = [0, 22, 36];
const FOC = 742,
  FY = -0.554,
  FZ = -0.831,
  UY = 0.831,
  UZ = -0.554;
export function pj(x: number, y: number, z: number) {
  const dx = x - CP[0],
    dy = y - CP[1],
    dz = z - CP[2],
    zc = dy * FY + dz * FZ;
  if (zc < 1) return [480, 270, 1, 1];
  const s = FOC / zc;
  return [480 + dx * s, 270 - (dy * UY + dz * UZ) * s, s, zc];
}
const fl = (x, y) => {
    const w = W3(x, 0, y);
    return pj(w[0], 0, w[2]);
  },
  gp = (a) => a.map((p) => fl(p[0], p[1]));
function poly(a, fill, st, lw) {
  X.beginPath();
  a.forEach((q, i) => (i ? X.lineTo(q[0], q[1]) : X.moveTo(q[0], q[1])));
  if (fill) {
    X.fillStyle = fill;
    X.fill();
  }
  if (st) {
    X.strokeStyle = st;
    X.lineWidth = lw;
    X.stroke();
  }
}
export function gar(x, y, r, a0, a1) {
  const o = [];
  for (let k = 0; k <= 36; k++) {
    const a = a0 + ((a1 - a0) * k) / 36;
    o.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return o;
}
const CRW = Array.from({ length: 600 }, (_, i) => [
  Math.random() * 150 - 75,
  0.3 + Math.random() * 4,
  ["#6a4c93", "#c9184a", "#f4a261", "#2a9d8f", "#e9c46a", "#4361ee"][i % 6],
]);
function hoop3c(b: number) {
  const hx = (HXs[b] - 470) * 0.1,
    sg = b ? 1 : -1,
    bx = sg * 43;
  let a = pj(sg * 44.5, 0, 0),
    c = pj(sg * 44.5, 12, 0);
  X.lineCap = "round";
  X.strokeStyle = "#2b2b33";
  X.lineWidth = 0.45 * a[2];
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(c[0], c[1]);
  X.stroke();
  a = pj(sg * 44.5, 10.8, 0);
  c = pj(bx, 10.8, 0);
  X.lineWidth = 0.3 * a[2];
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(c[0], c[1]);
  X.stroke();
  poly(
    [pj(bx, 9.6, -3), pj(bx, 9.6, 3), pj(bx, 13.6, 3), pj(bx, 13.6, -3)],
    "rgba(225,235,255,.85)",
    "#fff",
    1.5,
  );
  const rim = [],
    net = [];
  for (let k = 0; k <= 16; k++) {
    const t = (k / 16) * 6.283;
    rim.push(pj(hx + Math.cos(t) * 0.75, 10, Math.sin(t) * 0.75));
    net.push(pj(hx + Math.cos(t) * 0.45, 8.6, Math.sin(t) * 0.45));
  }
  drawNet(b, (x, y, z) => {
    const w = W3(x, y, z);
    return pj(w[0], w[1], w[2]);
  });
  poly(rim, 0, "#ff4d1a", 3.2);
}
export function scene3c() {
  X.fillStyle = "#07081a";
  X.fillRect(0, 0, 960, 540);
  const a = pj(-80, 0, -34),
    c = pj(80, 24, -34),
    g1 = X.createLinearGradient(0, Math.min(c[1], a[1]), 0, a[1]);
  g1.addColorStop(0, "#1a1e44");
  g1.addColorStop(1, "#0c0e24");
  poly([a, pj(80, 0, -34), c, pj(-80, 24, -34)], g1);
  for (const q of CRW) {
    const p = pj(q[0], q[1] + Math.sin(T * 3 + q[0]) * 0.08, -33.9);
    X.fillStyle = q[2];
    X.fillRect(p[0], p[1], 0.4 * p[2], 0.5 * p[2]);
  }
  poly(
    [pj(-80, 0, -34), pj(80, 0, -34), pj(80, 0, 40), pj(-80, 0, 40)],
    "#14162e",
  );
  poly(
    gp([
      [0, 0],
      [940, 0],
      [940, 500],
      [0, 500],
    ]),
    "#c98f4d",
  );
  X.strokeStyle = "rgba(0,0,0,.09)";
  X.lineWidth = 1;
  for (let x = 0; x <= 940; x += 24) {
    const u = fl(x, 0),
      v = fl(x, 500);
    X.beginPath();
    X.moveTo(u[0], u[1]);
    X.lineTo(v[0], v[1]);
    X.stroke();
  }
  X.globalAlpha = 0.6;
  poly(
    gp([
      [0, 170],
      [190, 170],
      [190, 330],
      [0, 330],
    ]),
    PC[0],
  );
  poly(
    gp([
      [750, 170],
      [940, 170],
      [940, 330],
      [750, 330],
    ]),
    PC[1],
  );
  X.globalAlpha = 1;
  const W = "rgba(255,255,255,.92)",
    L = 2.5;
  poly(
    gp([
      [0, 0],
      [940, 0],
      [940, 500],
      [0, 500],
      [0, 0],
    ]),
    0,
    W,
    L,
  );
  poly(
    gp([
      [470, 0],
      [470, 500],
    ]),
    0,
    W,
    L,
  );
  poly(gp(gar(470, 250, 60, 0, 6.3)), 0, W, L);
  for (const b of [0, 1]) {
    const hx = HXs[b],
      e = b ? 940 : 0,
      sg = b ? -1 : 1;
    poly(
      gp([
        [b ? 750 : 0, 170],
        [b ? 940 : 190, 170],
        [b ? 940 : 190, 330],
        [b ? 750 : 0, 330],
        [b ? 750 : 0, 170],
      ]),
      0,
      W,
      L,
    );
    poly(
      gp(gar(e + sg * 190, 250, 60, b ? 1.57 : -1.57, b ? 4.71 : 1.57)),
      0,
      W,
      L,
    );
    poly(
      gp(
        gar(
          hx,
          250,
          237,
          b ? Math.PI - 1.19 : -1.19,
          b ? Math.PI + 1.19 : 1.19,
        ),
      ),
      0,
      W,
      L,
    );
    poly(
      gp([
        [e, 30],
        [hx + sg * 88, 30],
      ]),
      0,
      W,
      L,
    );
    poly(
      gp([
        [e, 470],
        [hx + sg * 88, 470],
      ]),
      0,
      W,
      L,
    );
  }
  hoop3c(0);
  hoop3c(1);
}
export function segs3c(p: any, out: any[]) {
  const q = p.q,
    S = p.ht / 6.4,
    th = Math.PI / 2 - p.f,
    cs = Math.cos(th),
    sn = Math.sin(th),
    w = W3(p.x, p.y, p.z),
    k = p.bk;
  const bp = (a) => {
    const x = a[0],
      y = a[1],
      z = a[2],
      X1 = x * Math.cos(q.rz) - y * Math.sin(q.rz),
      Y1 = x * Math.sin(q.rz) + y * Math.cos(q.rz),
      Y2 = Y1 * Math.cos(q.ln) - z * Math.sin(q.ln),
      Z2 = Y1 * Math.sin(q.ln) + z * Math.cos(q.ln);
    return [
      X1 * Math.cos(q.ty) + Z2 * Math.sin(q.ty),
      Y2 + 3.2,
      -X1 * Math.sin(q.ty) + Z2 * Math.cos(q.ty),
    ];
  };
  const W = (l) => [
    w[0] + (l[0] * cs + l[2] * sn) * S,
    w[1] - q.cr * 0.4 + l[1] * S,
    w[2] + (-l[0] * sn + l[2] * cs) * S,
  ];
  const add = (a, b, wd, col, n) => {
    const A = pj(...W(a)),
      B2 = pj(...W(b));
    B2[0] += 0.01;
    out.push({ z: (A[3] + B2[3]) / 2, A, B: B2, w: wd * S, c: col, n });
  };
  const dk = "#0b0b12",
    hc = p.skin === "#e8b88f" ? "#4a3320" : "#141414",
    back = Math.cos(p.f) * (CP[0] - w[0]) + Math.sin(p.f) * (CP[2] - w[2]) < 0;
  for (const sd of [-1, 1]) {
    const tl = sd < 0 ? q.tL : q.tR,
      kl = sd < 0 ? q.kL : q.kR,
      hj = [sd * 0.3, 3.2, 0],
      kn = [hj[0], hj[1] - 1.6 * Math.cos(tl), hj[2] + 1.6 * Math.sin(tl)],
      a2 = tl - kl,
      an = [kn[0], kn[1] - 1.6 * Math.cos(a2), kn[2] + 1.6 * Math.sin(a2)];
    add(hj, kn, 0.44, p.skin);
    add(kn, an, 0.34, p.skin);
    add(an, [an[0], an[1] - 0.12, an[2] + 0.55], 0.32, "#f2f2f2");
    add(
      hj,
      [(hj[0] + kn[0]) / 2, (hj[1] + kn[1]) / 2, (hj[2] + kn[2]) / 2],
      0.62 * k,
      p.col,
    );
    const sh = [sd * 0.9 * k, 1.95, 0],
      aF = sd < 0 ? q.aL : q.aR,
      eF = sd < 0 ? q.eL : q.eR,
      sa = sd < 0 ? q.zL : q.sz,
      wF = sd < 0 ? q.wL : q.wR,
      sp = Math.sin(sa) * sd,
      c2 = Math.cos(sa),
      el = [
        sh[0] + sp * 1.05,
        sh[1] - Math.cos(aF) * c2 * 1.05,
        sh[2] + Math.sin(aF) * 1.05,
      ],
      a3 = aF + eF,
      wr = [el[0] + sp * 0.5, el[1] - Math.cos(a3) * c2, el[2] + Math.sin(a3)],
      bs = bp(sh),
      be = bp(el),
      bw = bp(wr);
    out.push(0);
    out.pop();
    const A1 = pj(...W(bs)),
      A2 = pj(...W(be)),
      A3 = pj(...W(bw)),
      A4 = pj(
        ...W(
          bp([
            wr[0] + sp * 0.1,
            wr[1] - Math.cos(a3 + wF) * 0.38,
            wr[2] + Math.sin(a3 + wF) * 0.38,
          ]),
        ),
      );
    [
      [A1, A2, 0.34 * k, p.skin],
      [
        A1,
        [
          A1[0] + (A2[0] - A1[0]) * 0.3,
          A1[1] + (A2[1] - A1[1]) * 0.3,
          A1[2],
          A1[3],
        ],
        0.48 * k,
        p.col,
      ],
      [A2, A3, 0.28, p.skin],
      [A3, A4, 0.3, p.skin],
    ].forEach((o) => {
      const B2 = [o[1][0] + 0.01, o[1][1], o[1][2], o[1][3]];
      out.push({
        z: (o[0][3] + B2[3]) / 2,
        A: o[0],
        B: B2,
        w: o[2] * S,
        c: o[3],
      });
    });
  }
  const t = (a, b, wd, col, n) => add(bp(a), bp(b), wd, col, n);
  t([0, 0, 0], [0, 0.7, 0], 1.15 * k, p.col);
  t([0, 0.5, 0], [0, 2, 0], 1.4 * k, p.col, back ? p.no : null);
  t([0, 2, 0], [0, 2.35, 0], 0.3, p.skin);
  t([0, 2.75, 0], [0, 2.75, 0], 0.88, p.skin);
  if (p.hr === 1) t([0, 2.92, -0.08], [0, 2.92, -0.08], 0.86, hc);
  if (p.hr === 2) {
    t([0, 2.9, -0.06], [0, 2.9, -0.06], 0.88, hc);
    t([0, 2.8, -0.35], [0, 2.1, -0.6], 0.3, hc);
  }
  if (p.hr === 3) t([0, 2.95, -0.05], [0, 2.95, -0.05], 1.25, hc);
  if (p.bd) t([0, 2.52, 0.28], [0, 2.52, 0.28], 0.42, hc);
}
export function paint3c(g: any) {
  const a = g.A,
    b = g.B,
    wp = Math.max(1.5, (g.w * (a[2] + b[2])) / 2);
  X.lineCap = "round";
  X.lineWidth = wp + 2;
  X.strokeStyle = "rgba(0,0,0,.4)";
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(b[0], b[1]);
  X.stroke();
  X.lineWidth = wp;
  X.strokeStyle = g.c;
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(b[0], b[1]);
  X.stroke();
  if (g.n != null) {
    X.fillStyle = "#fff";
    X.font = "900 " + ((wp * 0.5) | 0) + "px system-ui";
    X.textAlign = "center";
    X.fillText(g.n, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + wp * 0.15);
  }
}
export function ball3c(q: number[]) {
  const r = Math.max(2, 0.39 * q[2]);
  X.save();
  X.translate(q[0], q[1]);
  X.rotate(B.a);
  const g = X.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#ff9a4a");
  g.addColorStop(1, "#c4500f");
  X.fillStyle = g;
  X.beginPath();
  X.arc(0, 0, r, 0, 6.3);
  X.fill();
  X.strokeStyle = "#2a1004";
  X.lineWidth = Math.max(1, r * 0.1);
  X.beginPath();
  X.moveTo(-r, 0);
  X.lineTo(r, 0);
  X.moveTo(0, -r);
  X.lineTo(0, r);
  X.stroke();
  X.beginPath();
  X.arc(0, 0, r, 0, 6.3);
  X.stroke();
  X.restore();
}
// ---------------- net (shared) ----------------
export function drawNet(b: number, pf: (x: number, y: number, z: number) => number[]) {
  X.strokeStyle = "rgba(255,255,255,.8)";
  X.lineWidth = 1.1;
  X.beginPath();
  for (const c of NETS[b].c) {
    const u = pf(c[0].x, c[0].y, c[0].z),
      v = pf(c[1].x, c[1].y, c[1].z);
    X.moveTo(u[0], u[1]);
    X.lineTo(v[0], v[1]);
  }
  X.stroke();
}
