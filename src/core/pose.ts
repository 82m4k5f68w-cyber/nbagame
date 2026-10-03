// Pro Play pose solver: joint angles per player (p.q), shot clips, and analytic hand forward kinematics.
// Runs inside the fixed-step sim (so the release point is the same on every machine and on the server).
import { CL, CK } from "./data";
import { P, B, pos, T, DT, cfg, W3, clamp, CEL_T, QK, stepLen, ftq, rs, hoop, HY, type Player } from "./sim";

function smp(a: number[] | undefined, k: number) {
  if (!a) return null;
  if (k <= a[0]) return a[1];
  for (let i = 2; i < a.length; i += 2)
    if (k <= a[i]) {
      const u = (k - a[i - 2]) / (a[i] - a[i - 2]),
        s = u * u * (3 - 2 * u);
      return a[i - 1] + (a[i + 1] - a[i - 1]) * s;
    }
  return a[a.length - 1];
}
const CLIPK = ["aR", "eR", "aL", "eL", "tL", "tR", "kL", "kR", "ln", "sz", "cr", "rz", "ty", "wR", "wL", "zL"];
const CO: Record<string, number> = {};
/** Sample the player's shot clip at phase k (0..1), with signature tweaks. Returns a shared object. */
export function clip(p: Player, k: number) {
  const c = CL[CK[p.sv]] || CL.jump,
    o = CO;
  for (const n of CLIPK) {
    const v = smp(c[n], k);
    o[n] = v == null ? (smp(CL.jump[n], k) as number) : v;
  }
  const g = p.sg || {},
    up = Math.min(1, k / 0.7);
  o.aR += (g.a || 0) * up;
  o.sz += (g.f || 0) * up;
  o.ln += (g.l || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.tL += (g.k || 0) * (k > 0.5 ? 1 : 0);
  o.aL -= (g.g || 0) * 0.4 * (k > 0.7 ? (k - 0.7) / 0.3 : 0);
  o.wR *= 1 + (g.w || 0);
  // personal touches
  const rel = k > 0.72 ? Math.min(1, (k - 0.72) / 0.28) : 0;
  o.aR += (g.ft || 0) * 0.25 * rel; // holds the follow-through up high
  o.wR += (g.ft || 0) * 0.35 * rel;
  o.tR += (g.lk || 0) * (k > 0.6 ? 1 : 0); // leg kick
  o.kR += (g.lk || 0) * 0.9 * (k > 0.6 ? 1 : 0);
  o.ty += (g.tw || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.aL += (g.gh || 0) * 0.35 * up;
  o.zL += (g.gh || 0) * 0.25 * up;
  if (k < 0.3) o.aR -= (g.dp || 0) * Math.sin((k / 0.3) * 3.14) * 0.6; // dip before the rise
  if (CK[p.sv] === "curry" && p.sbw > 0) {
    o.ln -= 0.22;
    o.tR -= 0.2;
  }
  return o;
}

/** Write this tick's joint angles into p.q (in place, smoothed when Pro Play is on). */
export function pose3(p: Player) {
  const PRO = cfg.PRO,
    has = B.owner === p,
    air = p.z > 2,
    sp = Math.hypot(p.vx, p.vy),
    spd = Math.min(1, sp / 200),
    s = Math.sin(p.ph),
    c = Math.cos(p.ph),
    md = p.mode,
    // stride-matched gait: thigh swing sized so the planted foot travels exactly one step (see sim stepLen)
    legF = (3.18 * p.ht) / 6.4,
    A = Math.asin(Math.min(0.9, (stepLen(sp) / 10 / (2 * legF)) * 0.92)) * Math.min(1, sp / 30),
    ksw = 0.45 + 0.95 * spd; // swing-knee flex: heel kick grows with speed
  let tL = s * A,
    tR = -s * A,
    kL = 0.07 + Math.pow(Math.max(0, c), 1.5) * ksw * Math.min(1, sp / 30),
    kR = 0.07 + Math.pow(Math.max(0, -c), 1.5) * ksw * Math.min(1, sp / 30),
    aL = -s * (0.2 + 0.65 * spd),
    aR = s * (0.2 + 0.65 * spd),
    eL = 0.45 + spd * 1.0,
    eR = 0.45 + spd * 1.0,
    sz = 0.1,
    cr = 0.07 * spd * (1 - Math.abs(s)), // the body is lowest at mid-stance
    ln = 0.07 * spd - (p.brk || 0) * 0.3,
    rz = 0,
    ty = s * 0.18 * spd, // pelvis turns with the forward leg...
    wR = 0,
    wL = 0,
    zL: number | null = null,
    // new joints (animation engine v2)
    cx = 0.07 * spd, // chest pitch on top of the pelvis lean
    cy = -s * 0.3 * spd, // ...and the chest counter-rotates (real running)
    gL = 0.25, // finger curl 0 open .. 1 fist
    gR = 0.25,
    hs = 0, // asymmetric hip abduction (defensive shuffle)
    toe = 0, // extra plantar flex (toe-off / pointed in the air), both feet
    st = ST.idle;
  if (sp > 30) st = ST.run;
  if (air && md !== "s" && md !== "c") {
    tL = 0.6;
    tR = 0.1;
    kL = 1;
    kR = 0.7;
    toe = 0.45;
    st = ST.air;
  }
  if (md === "c" || md === "s") {
    st = ST.shot;
    gR = 0.55;
    gL = 0.45;
    cy = 0;
    if (p.z > 2) toe = 0.5;
  }
  if (md === "c") {
    wR = -0.5;
    wL = -0.2;
    zL = -0.08;
    aL = aR = 1;
    eL = eR = 1.7;
    cr = 0.5;
    if (PRO && p.sg) {
      // personal load: ball height at the gather and elbow flare
      aR -= (p.sg.dp || 0) * 0.5;
      aL -= (p.sg.dp || 0) * 0.4;
      sz += p.sg.f || 0;
      cr += (p.sg.k || 0) * 0.6;
    }
    if (PRO && p.sg && p.sg.cl) {
      aR = 0.6;
      eR = 1.3;
      aL = 0.7;
      eL = 1.4;
      cr = 0.3;
    }
    tL = 0.3;
    tR = -0.2;
    kL = kR = 0.8;
    sz = 0.05;
    ty = 0;
  } else if (md === "s" && PRO) {
    const k = Math.min(1, p.t / 0.4),
      o = clip(p, k);
    aR = o.aR;
    eR = o.eR;
    aL = o.aL;
    eL = o.eL;
    tL = o.tL;
    tR = o.tR;
    kL = o.kL;
    kR = o.kR;
    ln = o.ln;
    sz = o.sz;
    cr = p.z < 2 ? o.cr : 0;
    rz = o.rz;
    ty = o.ty;
    wR = o.wR;
    wL = o.wL;
    zL = o.zL;
  } else if (md === "s") {
    const k = Math.min(1, p.t / 0.4),
      v = p.sv,
      e = Math.min(1, k / 0.55),
      se = e * e * (3 - 2 * e),
      rel = k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.15),
      fo = k < 0.7 ? 0 : (k - 0.7) / 0.3;
    aR = k < 0.55 ? 1 + se * 1.25 : k < 0.7 ? 2.25 + ((k - 0.55) / 0.15) * 0.7 : 2.95 - fo * 0.35;
    eR = k < 0.55 ? 1.7 - se * 0.45 : k < 0.7 ? 1.25 - ((k - 0.55) / 0.15) * 1.1 : 0.15 + fo * 0.35;
    aL = k < 0.55 ? 1 + se * 0.95 : Math.max(1.1, 1.95 - rel * 0.8);
    eL = k < 0.55 ? 1.5 : 1.3;
    sz = 0.03 + rel * 0.1;
    ln = -0.05;
    tL = 0.5 - rel * 0.3;
    tR = -0.1;
    kL = 0.9 - rel * 0.7;
    kR = 0.6 - rel * 0.5;
    ty = 0;
    cr = p.z < 2 && k > 0.7 ? 0.5 * Math.min(1, (k - 0.7) / 0.15) : 0;
    if (v === 1) {
      aR = k < 0.4 ? 1 + (k / 0.4) * 1.9 : 2.9 - fo * 0.3;
      eR = k < 0.4 ? 1.7 - (k / 0.4) * 1.5 : 0.2;
      kL = 0.4;
      tL = 0.25;
    }
    if (v === 2) {
      ln = -0.5 * Math.sin(Math.min(1, k * 1.1) * 3.14);
      tL = 1.1;
      kL = 0.2;
      tR = -0.4;
      kR = 0.5;
    }
    if (v === 3) {
      ln = -0.35;
      tL = 0.2;
      tR = -0.5;
      kR = 0.9;
      kL = 0.6;
    }
    if (v === 4) {
      aR = 2.7;
      eR = 0.3;
      aL = 0.5;
      eL = 1;
      ln = 0.15;
      rz = 0.25;
      tL = 0.3;
    }
    if (v === 5) {
      aR = 3;
      eR = 0.2;
      aL = 0.5;
      eL = 1.3;
      ln = 0.3;
      tL = 1.5;
      kL = 1.5;
      tR = -0.4;
      kR = 0.3;
    }
    if (v === 6) {
      aR = aL = k < 0.7 ? 3 : 1.7;
      eR = eL = 0.2;
      ln = 0.1;
      tL = 0.7;
      tR = 0.2;
      kL = kR = 0.8;
      sz = 0.2;
    }
  } else if (md === "b") {
    ln = -0.38;
    tL = Math.sin(p.t * 28) * 0.7;
    tR = -tL;
    kL = Math.max(0, -tL) + 0.4;
    kR = Math.max(0, tL) + 0.4;
    aR = 0.7 + Math.sin(p.t * 22) * 0.5;
    eR = 1.2;
    aL = 0.5;
    eL = 1;
    cr = 0.3;
    ty = Math.sin(p.t * 22) * 0.3;
  } else if (has) {
    st = ST.drib;
    gR = 0.1;
    gL = 0.3;
    cy *= 0.3; // keep the dribbling shoulder square so the hand IK lands on the ball
    {
      const u = clamp((B.z - 6) / 30, 0, 1);
      aR = PRO ? 0.5 + u * 0.45 : 0.55 + u * 0.8;
      eR = PRO ? 0.25 + u * 1.1 : 0.9;
      if (PRO) wR = 0.8 - u * 1.2;
    }
    aL = 0.4 + spd * 0.3;
    eL = 1;
    cr = 0.2;
    ln = 0.08 + spd * 0.2;
    ty = 0;
  } else if (air) {
    aL = aR = 3;
    eL = eR = 0.1;
    sz = 0.12;
    gL = gR = 0.1;
  } else if (pos !== p.tm) {
    st = ST.def;
    gL = gR = 0.05; // active hands
    cy = 0;
    aL = aR = 0.6;
    eL = eR = 0.9;
    sz = 1.1 + Math.sin(T * 8 + p.k) * 0.1;
    cr = 0.4;
    tL = s * 0.5 * spd + 0.35;
    tR = -s * 0.5 * spd + 0.35;
    kL = kR = 0.8;
    ln = 0.18;
  }
  let hz = 0;
  {
    const sv = Math.hypot(p.vx, p.vy),
      def = pos !== p.tm && B.owner;
    if (md === "i" && !air && sv > 25) {
      const cf = Math.cos(p.f),
        sf = Math.sin(p.f),
        fw = (p.vx * cf + p.vy * sf) / sv,
        sd2 = (-p.vx * sf + p.vy * cf) / sv;
      if (!def && !(p.mvT > 0)) {
        tL *= fw;
        tR *= fw;
        kL = Math.max(0.05, kL * Math.abs(fw));
        kR = Math.max(0.05, kR * Math.abs(fw));
        if (fw < -0.3) (ln -= 0.12), (cx -= 0.06); // backpedal: sit back, short steps
      }
      hz = Math.abs(sd2) * (0.16 + 0.14 * Math.abs(s)) * spd + (def ? 0.12 : 0);
      // lateral shuffle: the lead leg opens, the trail leg closes (never crossing) - defenders and side steps
      hs = s * Math.abs(sd2) * (def ? 0.24 : 0.14) * spd * Math.sign(sd2 || 1);
      cr += Math.abs(sd2) * 0.15 * spd;
      if (def) (tL *= 0.35), (tR *= 0.35); // slides stay low and wide instead of running
    } else if (def && !air) hz = 0.14;
    if (PRO && has && md === "i" && !(p.mvT > 0) && !p.postA) {
      // Dribble hand IK: reach the real ball position.
      const S2 = p.ht / 6.4,
        w = W3(p.x, p.y, p.z),
        // the hand follows the push down a little, then waits at the hip for the ball to come back up
        b = W3(B.x, B.y, Math.max(B.z, (B.dtop ?? p.z + p.ht * 5) - 8)),
        th = Math.PI / 2 - p.f,
        X1 = b[0] - w[0],
        Y1 = b[1] - (w[1] - cr * 0.4),
        Z1 = b[2] - w[2],
        lx = (X1 * Math.cos(th) - Z1 * Math.sin(th)) / S2,
        lz = (X1 * Math.sin(th) + Z1 * Math.cos(th)) / S2,
        tx = lx - 0.82 * p.bk,
        ty2 = Y1 / S2 - 5.1,
        tz = lz,
        L1 = 1.02,
        L2 = 1.15,
        d = Math.min(L1 + L2 - 0.02, Math.max(0.3, Math.hypot(tx, ty2, tz))),
        ph2 = Math.atan2(tz, -ty2),
        al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      aR = ph2 - al;
      eR = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      sz = clamp(Math.atan2(tx, Math.max(0.2, -ty2)), -0.4, 0.6);
    }
    if (def && !air && (B.owner.mode === "c" || B.owner.mode === "s") && Math.hypot(B.owner.x - p.x, B.owner.y - p.y) < 70) {
      aR = 2.9;
      eR = 0.15;
      aL = 1.3;
      eL = 0.6;
    }
    if (p.pT > 0) {
      aL = aR = 1.5;
      eL = eR = 0.25;
      ln += 0.1;
      gL = gR = 0.15;
    }
    if (B.mode === "pass" && B.to === p && !air) {
      aL = aR = 1.35;
      eL = eR = 0.5;
      zL = 0.15;
      gL = gR = 0.2; // target hands
      st = ST.cat;
    }
  }
  if (p.mvT > 0) {
    st = ST.move;
    const e = p.mvE || 0,
      sd = p.mvS || 1;
    if (p.mvk === 2) {
      ty += (e / 0.45) * 6.283 * sd;
      ln = 0.25;
      cr = 0.2;
    } else if (p.mvk === 1) {
      cr = e < 0.22 ? 0.55 : 0.1;
      ln = e < 0.22 ? -0.12 : 0.35;
    } else if (p.mvk === 3) {
      ty += Math.sin(e * 10) * 0.9 * sd;
      ln = 0.2;
      aR = 0.3;
      eR = 0.4;
    } else {
      ln = 0.3;
      cr = 0.2;
    }
  }
  // Planted screener: wide base, knees bent, arms folded across the chest.
  if (p.setT > 0 && md === "i" && !air && !has) {
    st = ST.scr;
    gL = gR = 0.9;
    hs = 0;
    hz = 0.32;
    cr = 0.3;
    kL = kR = 0.55;
    tL = tR = 0.25;
    aL = aR = 0.95;
    eL = eR = 2.1;
    sz = -0.25;
    zL = -0.25;
    ln = 0.08;
  }
  // Pro Play contact + weight: bumps rock the torso away from the hit, landings sink into the knees,
  // and players lean into acceleration.
  if (PRO) {
    if (p.hitT > 0) {
      const k = Math.min(1, p.hitT / 0.3),
        cf = Math.cos(p.f),
        sf = Math.sin(p.f),
        fw = (p.hitX || 0) * cf + (p.hitY || 0) * sf,
        sd = -(p.hitX || 0) * sf + (p.hitY || 0) * cf;
      ln += fw * 0.38 * k;
      rz -= sd * 0.32 * k;
      ty += sd * 0.25 * k;
      if (md === "i" && !has) {
        aL += 0.5 * k;
        aR += 0.35 * k;
      }
    }
    if (p.landT > 0 && md !== "s") {
      const k = p.landT / 0.28;
      cr += 0.4 * k;
      kL += 0.55 * k;
      kR += 0.55 * k;
      tL += 0.3 * k;
      tR += 0.3 * k;
      ln += 0.12 * k;
    }
    if (md === "i" && !air) ln += clamp((p.acc || 0) / 2600, -0.14, 0.2);
  }
  if (p.postA) {
    st = ST.post;
    cr = 0.45;
    ln = 0.25;
    sz = 0.8;
    aL = 1.2;
  }
  // Signature celebration (CEL): arms and torso blend into the move while the legs keep running.
  // Hands on knees: catching a breath at dead balls (free throws, after makes) when tired or lined up.
  if (md === "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && (ftq ? ftq.s !== p : rs > 0.3 && (p.en ?? 1) < 0.75)) {
    st = ST.rest;
    ln = 0.55;
    cx = 0.22;
    cr = 0.32;
    tL = tR = 0.55;
    kL = kR = 0.62;
    aL = aR = 0.62;
    eL = eR = 0.35;
    sz = 0.22;
    zL = 0.22;
    hz = 0.14;
    gL = gR = 0.35;
  }
  if (p.celT > 0 && p.cel && md === "i" && !has && !air && !p.postA && !(p.setT > 0)) {
    st = ST.cel;
    const e = CEL_T - p.celT,
      k = Math.min(1, e / 0.2, p.celT / 0.35),
      m = (a: number, b: number) => a + (b - a) * k,
      zl = zL == null ? sz : zL;
    switch (p.cel) {
      case 1: // shimmy: elbows tucked, shoulders shake (the chest shakes over still hips)
        cy += Math.sin(e * 50) * 0.25 * k;
        gL = gR = m(gR, 0.6);
        aL = m(aL, 0.45);
        aR = m(aR, 0.45);
        eL = m(eL, 1.75);
        eR = m(eR, 1.75);
        sz = m(sz, 0.3);
        zL = m(zl, 0.3);
        ty += Math.sin(e * 50) * 0.08 * k;
        rz += Math.sin(e * 50) * 0.07 * k;
        ln = m(ln, -0.05);
        break;
      case 2: // night night: hands together beside the cheek, head tilted onto them
        HEADX = 0.35 * k;
        aR = m(aR, 2.45);
        eR = m(eR, 2.5);
        aL = m(aL, 2.25);
        eL = m(eL, 2.45);
        sz = m(sz, -0.15);
        zL = m(zl, -0.6);
        rz = m(rz, 0.24);
        ty = m(ty, 0.2);
        break;
      case 3: // double-bicep flex with a pump
        gL = gR = m(gR, 1);
        aL = aR = m((aL + aR) / 2, 1.45);
        eL = eR = m((eL + eR) / 2, 1.95 + Math.sin(e * 12) * 0.18);
        sz = m(sz, 1.3);
        zL = m(zl, 1.3);
        ln = m(ln, -0.14);
        cr = m(cr, 0.15);
        break;
      case 4: // both arms up, three fingers to the crowd, pumping
        gL = gR = m(gR, 0.4);
        HEADX = -0.35 * k;
        aL = m(aL, 2.7 + Math.sin(e * 10) * 0.15);
        aR = m(aR, 2.7 + Math.sin(e * 10 + 1) * 0.15);
        eL = m(eL, 0.35);
        eR = m(eR, 0.35);
        sz = m(sz, 0.35);
        zL = m(zl, 0.35);
        ln = m(ln, -0.16);
        break;
      case 5: // chest thump, chin up
        gR = m(gR, 1);
        aR = m(aR, 1.25);
        eR = m(eR, 2.25 + Math.max(0, Math.sin(e * 15)) * 0.35);
        sz = m(sz, -0.45);
        aL = m(aL, 0.35);
        zL = m(zl, 0.6);
        ln = m(ln, -0.16);
        break;
      case 6: // power roar: crouched, arms flexed down and out
        gL = gR = m(gR, 1);
        aL = m(aL, 0.45);
        aR = m(aR, 0.45);
        eL = m(eL, 1.0);
        eR = m(eR, 1.0);
        sz = m(sz, 0.95);
        zL = m(zl, 0.95);
        ln = m(ln, 0.28);
        cr = m(cr, 0.35);
        break;
      case 7: // shh: finger to the lips, looking around the arena
        aR = m(aR, 2.2);
        eR = m(eR, 2.55);
        sz = m(sz, -0.3);
        aL = m(aL, 0.2);
        eL = m(eL, 0.35);
        ty += Math.sin(e * 2.2) * 0.35 * k;
        break;
      case 9: {
        // dap / low five with the nearest teammate (after a made free throw)
        let mate: Player | null = null,
          bd2 = 1e9;
        for (const o of P)
          if (o !== p && o.tm === p.tm) {
            const d = Math.hypot(o.x - p.x, o.y - p.y);
            if (d < bd2) (bd2 = d), (mate = o);
          }
        const reach = e < 0.7 ? Math.sin((e / 0.7) * Math.PI) : 0;
        aR = m(aR, 0.5 + reach * 0.9);
        eR = m(eR, 0.9 - reach * 0.6);
        sz = m(sz, -0.15);
        gR = m(gR, 0.1);
        if (mate) LOOK.x = mate.x, LOOK.y = mate.y, LOOK.z = mate.z + mate.ht * 9, LOOK.on = 1;
        break;
      }
      case 8: // point to the sky
        aR = m(aR, 2.95);
        eR = m(eR, 0.12);
        aL = m(aL, e > 0.6 ? 2.7 : 0.3);
        eL = m(eL, e > 0.6 ? 0.2 : 0.8);
        sz = m(sz, 0.15);
        zL = m(zl, 0.15);
        ln = m(ln, -0.22);
        gL = gR = m(gR, 0.8);
        HEADX = -0.5 * k; // eyes to the sky
        break;
    }
  }
  // ---- additive layer: breathing (deeper when tired) ----
  {
    const tired = 1 - (p.en ?? 1);
    cx += Math.sin(T * (2.1 + tired * 3) + p.k * 1.7) * (0.012 + tired * 0.05);
  }
  // ---- feet: flat on the floor through stance, toe-off behind the body, pointed in the air ----
  let fL = tL - kL + toe + (st === ST.run || st === ST.drib ? Math.max(0, -tL - 0.12) * 0.9 * spd : 0),
    fR = tR - kR + toe + (st === ST.run || st === ST.drib ? Math.max(0, -tR - 0.12) * 0.9 * spd : 0);
  // ---- head tracking: everyone follows the ball; the handler and shooters read the rim ----
  let hy = 0,
    hp = 0;
  const nk = -(ln + cx) * 0.35;
  {
    if (!LOOK.on) {
      if ((has && (md === "c" || md === "s")) || (has && md === "i" && !p.postA)) {
        const hx = hoop(p.tm);
        (LOOK.x = hx), (LOOK.y = HY), (LOOK.z = 100);
        if (B.mode === "pass" && B.to) (LOOK.x = B.to.x), (LOOK.y = B.to.y), (LOOK.z = 60);
      } else (LOOK.x = B.x), (LOOK.y = B.y), (LOOK.z = B.z);
    }
    const dx = LOOK.x - p.x,
      dy = LOOK.y - p.y,
      dist = Math.hypot(dx, dy);
    if (dist > 6) {
      const d = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.f), Math.cos(Math.atan2(dy, dx) - p.f)),
        hz2 = p.z + p.ht * 9.3;
      hy = clamp(-d - ty - cy, -1.25, 1.25);
      hp = clamp(Math.atan2(hz2 - LOOK.z, dist) - (ln + cx) * 0.9 - nk, -0.75, 0.8);
      if (Math.abs(-d - ty - cy) > 2.2) hy *= 0.4; // target behind: don't owl-turn
    }
    hp += HEADX;
    LOOK.on = 0;
    HEADX = 0;
  }
  // ---- blend: each animation state has its own transition time (snappy into a shot, slow into a rest) ----
  if (st !== p.anS) p.anS = st;
  const q = p.q,
    sm = PRO && q && q.wR != null,
    f = sm ? 1 - Math.exp((-DT * 3) / BLEND[st]) : 1,
    o = q || (p.q = {});
  VALS[0] = tL;
  VALS[1] = tR;
  VALS[2] = kL;
  VALS[3] = kR;
  VALS[4] = aL;
  VALS[5] = aR;
  VALS[6] = eL;
  VALS[7] = eR;
  VALS[8] = sz;
  VALS[9] = cr;
  VALS[10] = ln;
  VALS[11] = rz;
  VALS[12] = ty;
  VALS[13] = wR;
  VALS[14] = wL;
  VALS[15] = zL == null ? sz : zL;
  VALS[16] = hz;
  VALS[17] = cx;
  VALS[18] = cy;
  VALS[19] = nk;
  VALS[20] = hy;
  VALS[21] = hp;
  VALS[22] = fL;
  VALS[23] = fR;
  VALS[24] = gL;
  VALS[25] = gR;
  VALS[26] = hs;
  for (let j = 0; j < NQ; j++) {
    const k = QK[j],
      v = VALS[j];
    // wR is never smoothed (the wrist flick at release must be crisp); the head turns a bit quicker than the body
    o[k] = sm && j !== 13 && o[k] != null ? o[k] + (v - o[k]) * (j === 20 || j === 21 ? Math.min(1, f * 1.6) : f) : v;
  }
}
const NQ = 27,
  VALS = new Float64Array(NQ),
  LOOK = { x: 0, y: 0, z: 0, on: 0 };
let HEADX = 0;
/** Animation states (blend times in seconds when entering / tracking each one). */
const ST = { idle: 0, run: 1, def: 2, drib: 3, shot: 4, air: 5, move: 6, post: 7, scr: 8, cel: 9, rest: 10, cat: 11 },
  BLEND = [0.16, 0.12, 0.15, 0.1, 0.05, 0.08, 0.07, 0.2, 0.22, 0.18, 0.4, 0.09];

// ---- forward kinematics (mirrors the three.js rig hierarchy exactly; rig3d builds its bones from RIG) ----
// G: pos(w0, w1 - cr*0.4, w2), rotY(PI/2 - f), scale ht/6.4 -> pelvis bd: pos(0,3.2,0) Euler(ln,ty,rz,'YXZ')
// -> chest: pos(0,1,0) Euler(cx,cy,0,'YXZ') -> R shoulder: pos(0.88*0.95*bk, 0.9, 0) Euler(-aR, 0, sz,'XYZ')
// -> elbow: pos(0,-1.02,0) rotX(-eR) -> wrist: pos(0,-1,0) rotX(-wR) -> palm point (0,-0.62,0.1).
// chest -> neck pos(0,1.02,0) rotX(nk) -> head pos(0,0.28,0) Euler(hp,hy,0,'YXZ'). hips pos(+-0.32,3.2,0)
// Euler(-t,0,+-(hz+-hs)) -> knee pos(0,-1.58,0) rotX(k) -> ankle pos(0,-1.6,0) rotX(f). wrist -> fingers pos(0,-0.22,0) rotX(-g*1.4).
export const RIG = { hip: 3.2, hipX: 0.32, chest: 1.0, sh: 0.9, shX: 0.88 * 0.95, neck: 1.02, head: 0.28, L1: 1.58, L2: 1.6, ua: 1.02, fa: 1.0, fing: 0.22 };
/** Left/right hip abduction (wide stance hz plus the shuffle asymmetry hs). */
export const hipAb = (q: any, sd: number) => sd * ((q.hz || 0) + sd * (q.hs || 0));
type V = [number, number, number];
const rx = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const ry = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};
const rz = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** World position (game coords) of a point in the right wrist frame; default = palm. */
export function handPos(p: Player, pt: V = [0, -0.62, 0.1]): number[] | null {
  const q = p.q;
  if (!q) return null;
  let v: V = rx(pt, -(q.wR || 0));
  v = add(v, [0, -RIG.fa, 0]);
  v = rx(v, -q.eR);
  v = add(v, [0, -RIG.ua, 0]);
  // XYZ Euler: R = Rx * Ry * Rz (applied to the vector right-to-left)
  v = rx(rz(v, q.sz), -q.aR);
  v = add(v, [RIG.shX * p.bk, RIG.sh, 0]);
  // YXZ Euler: R = Ry * Rx * Rz
  v = ry(rx(v, q.cx || 0), q.cy || 0);
  v = add(v, [0, RIG.chest, 0]);
  v = ry(rx(rz(v, q.rz), q.ln), q.ty);
  v = add(v, [0, RIG.hip, 0]);
  const s = p.ht / 6.4;
  v = [v[0] * s, v[1] * s, v[2] * s];
  v = ry(v, Math.PI / 2 - p.f);
  const w = W3(p.x, p.y, p.z);
  v = add(v, [w[0], w[1] - q.cr * 0.4, w[2]]);
  return [v[0] * 10 + 470, v[2] * 10 + 250, v[1] * 10];
}

// ---- full-body forward kinematics (2D renderer, effects): 20 joints in game coordinates ----
// 0 pelvis 1 chest 2 neck 3 head | 4-7 L hip/knee/ankle/toe | 8-11 R hip/knee/ankle/toe
// 12-15 L shoulder/elbow/wrist/hand | 16-19 R shoulder/elbow/wrist/hand
type M3 = Float64Array; // row-major 3x3
const mm = (a: M3, b: M3, o: M3) => {
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rot = (ax: 0 | 1 | 2, t: number, o: M3) => {
  const c = Math.cos(t),
    s = Math.sin(t);
  o.fill(0);
  if (ax === 0) o.set([1, 0, 0, 0, c, -s, 0, s, c]);
  else if (ax === 1) o.set([c, 0, s, 0, 1, 0, -s, 0, c]);
  else o.set([c, -s, 0, s, c, 0, 0, 0, 1]);
  return o;
};
const euler = (x: number, y: number, z: number, order: "XYZ" | "YXZ", o: M3) => {
  const A = rot(0, x, new Float64Array(9)),
    Bm = rot(1, y, new Float64Array(9)),
    Cm = rot(2, z, new Float64Array(9)),
    t = new Float64Array(9);
  return order === "XYZ" ? mm(mm(A, Bm, t), Cm, o) : mm(mm(Bm, A, t), Cm, o);
};
interface Fr {
  R: M3;
  t: number[];
}
const child = (f: Fr, off: number[], R: M3 | null): Fr => {
  const t = [0, 1, 2].map((r) => f.R[r * 3] * off[0] + f.R[r * 3 + 1] * off[1] + f.R[r * 3 + 2] * off[2] + f.t[r]);
  return { R: R ? mm(f.R, R, new Float64Array(9)) : f.R, t };
};
const pt = (f: Fr, off: number[]) => child(f, off, null).t;
/** Joint positions in game coords (x, y, z up), written into out[0..59]. */
export function skeleton(p: Player, out: Float32Array) {
  const q = p.q || {},
    s = p.ht / 6.4,
    k = p.bk,
    w = W3(p.x, p.y, p.z);
  const RG = rot(1, Math.PI / 2 - p.f, new Float64Array(9));
  for (let i = 0; i < 9; i++) RG[i] *= s;
  const G: Fr = { R: RG, t: [w[0], w[1] - (q.cr || 0) * 0.4, w[2]] };
  const bd = child(G, [0, RIG.hip, 0], euler(q.ln || 0, q.ty || 0, q.rz || 0, "YXZ", new Float64Array(9))),
    ch = child(bd, [0, RIG.chest, 0], euler(q.cx || 0, q.cy || 0, 0, "YXZ", new Float64Array(9))),
    nk = child(ch, [0, RIG.neck, 0], rot(0, q.nk || 0, new Float64Array(9))),
    hd = child(nk, [0, RIG.head, 0], euler(q.hp || 0, q.hy || 0, 0, "YXZ", new Float64Array(9)));
  const J: number[][] = [pt(bd, [0, 0, 0]), pt(ch, [0, 0.5, 0]), nk.t, pt(hd, [0, 0.44, 0])];
  for (const sd of [-1, 1]) {
    const tq = sd < 0 ? q.tL || 0 : q.tR || 0,
      kq = sd < 0 ? q.kL || 0 : q.kR || 0,
      fq = sd < 0 ? q.fL || 0 : q.fR || 0,
      th = child(G, [sd * RIG.hipX, RIG.hip, 0], euler(-tq, 0, hipAb(q, sd), "XYZ", new Float64Array(9))),
      kn = child(th, [0, -RIG.L1, 0], rot(0, kq, new Float64Array(9))),
      an = child(kn, [0, -RIG.L2, 0], rot(0, fq, new Float64Array(9)));
    J.push(th.t, kn.t, an.t, pt(an, [0, -0.06, 0.52]));
  }
  for (const sd of [-1, 1]) {
    const a = sd < 0 ? q.aL || 0 : q.aR || 0,
      e = sd < 0 ? q.eL || 0 : q.eR || 0,
      wq = sd < 0 ? q.wL || 0 : q.wR || 0,
      zz = sd < 0 ? -(q.zL == null ? q.sz || 0 : q.zL) : q.sz || 0,
      sh = child(ch, [sd * RIG.shX * k, RIG.sh, 0], euler(-a, 0, zz, "XYZ", new Float64Array(9))),
      el = child(sh, [0, -RIG.ua, 0], rot(0, -e, new Float64Array(9))),
      wr = child(el, [0, -RIG.fa, 0], rot(0, -wq, new Float64Array(9)));
    J.push(sh.t, el.t, wr.t, pt(wr, [0, -0.32, 0.05]));
  }
  J.forEach((v, i) => {
    out[i * 3] = v[0] * 10 + 470;
    out[i * 3 + 1] = v[2] * 10 + 250;
    out[i * 3 + 2] = v[1] * 10;
  });
  return out;
}
