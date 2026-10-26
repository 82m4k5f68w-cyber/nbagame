// Rapier ball world: floor, walls, glass backboards, 24-capsule rims, and (optionally) kinematic player capsules.
// Units are game units (10 = 1 ft), z up, g = 320. Initialised asynchronously; RAP is null until ready.
import RAPIER from "@dimforge/rapier3d-compat";
import { HXs, HY, RR, BR, g, cfg, SURF, surf, AV, airAcc, airV3, AIR_WD, ph3RimHit, type Player, type Ball } from "./sim";

/** fl floor, rims [collider, back iron?], gl glass colliders (Physics v3 swaps their materials by surface), mk = the
 *  material set now in use (-1 = v5.4). */
export let RAP: null | { w: any; bb: any; bc: any; R: typeof RAPIER; pl: any[]; fl: any; rims: [any, boolean][]; gl: any[]; mk: number } = null;
let initP: Promise<void> | null = null;

export function rapInit(): Promise<void> {
  if (initP) return initP;
  initP = RAPIER.init()
    .then(() => {
      const R2 = RAPIER,
        w = new R2.World({ x: 0, y: 0, z: -g }),
        fix = (d: any) => w.createCollider(d);
      const fl = fix(R2.ColliderDesc.cuboid(700, 500, 10).setTranslation(470, 250, -10).setRestitution(0.8).setFriction(0.6)),
        rims: [any, boolean][] = [],
        gl: any[] = [];
      for (const [x, y, hx, hy] of [
        [-5, 250, 5, 500],
        [945, 250, 5, 500],
        [470, -5, 700, 5],
        [470, 505, 700, 5],
      ])
        fix(R2.ColliderDesc.cuboid(hx, hy, 300).setTranslation(x, y, 300).setRestitution(0.5));
      for (const b of [0, 1]) {
        const hx = HXs[b],
          bx = b ? 900 : 40,
          sd = b ? 1 : -1,
          gx = bx + sd * 0.6;
        // glass (lively) inside the frame strip round its edge (duller), padding wrapped round the bottom edge (dead)
        gl.push(fix(R2.ColliderDesc.cuboid(0.6, 28.6, 19.3).setTranslation(gx, HY, 115.3).setRestitution(0.62).setFriction(0.3)));
        fix(R2.ColliderDesc.cuboid(0.6, 30, 0.7).setTranslation(gx, HY, 135.3).setRestitution(0.42).setFriction(0.5));
        for (const sy of [-1, 1]) fix(R2.ColliderDesc.cuboid(0.6, 0.7, 20).setTranslation(gx, HY + sy * 29.3, 116).setRestitution(0.42).setFriction(0.5));
        fix(R2.ColliderDesc.cuboid(1.4, 30.5, 1.7).setTranslation(bx + sd * 0.4, HY, 94.3).setRestitution(0.08).setFriction(0.9));
        // the bracket from the back iron to the glass (fills the gap a ball used to wedge in)
        {
          const x0 = hx + sd * (RR + 0.9),
            x1 = bx - sd * 0.3;
          fix(R2.ColliderDesc.capsule(Math.abs(x1 - x0) / 2, 0.9).setTranslation((x0 + x1) / 2, HY, 99.2).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setRestitution(0.3).setFriction(0.5));
        }
        for (let k = 0; k < 24; k++) {
          const a0 = (k / 24) * 6.283,
            a1 = ((k + 1) / 24) * 6.283,
            x0 = hx + Math.cos(a0) * RR,
            y0 = HY + Math.sin(a0) * RR,
            x1 = hx + Math.cos(a1) * RR,
            y1 = HY + Math.sin(a1) * RR,
            ang = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
          // the back quarter of the ring (toward the glass) sits on the bracket: deader iron (soft back-rim bounces drop)
          const back = (sd * ((x0 + x1) / 2 - hx)) / RR > 0.82;
          const rc = fix(
            R2.ColliderDesc.capsule(Math.hypot(x1 - x0, y1 - y0) / 2, 0.55)
              .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, 100)
              .setRotation({ x: 0, y: 0, z: Math.sin(ang / 2), w: Math.cos(ang / 2) })
              .setRestitution(back ? 0.4 : 0.55)
              .setFriction(back ? 0.45 : 0.4),
          );
          rims.push([rc, back]);
        }
      }
      const bb = w.createRigidBody(R2.RigidBodyDesc.dynamic().setTranslation(470, 250, 50).setLinearDamping(0).setAngularDamping(0.3).setCcdEnabled(true));
      const bc = w.createCollider(R2.ColliderDesc.ball(BR).setRestitution(0.72).setFriction(0.55).setDensity(0.02), bb);
      RAP = { w, bb, bc, R: R2, pl: [], fl, rims, gl, mk: -1 };
    })
    .catch((e) => console.error("rapier off", e));
  return initP;
}

/** Advance the airborne ball through Rapier with drag and Magnus lift from its spin (B.wv). */
export function rapStep(dt: number, B: Ball) {
  const { w, bb } = RAP!,
    W = B.wv || [0, 0, 0],
    k = 0.0032;
  rapMat();
  if (airV3()) {
    // Physics v3: launch's pre-sim air step (quadratic drag + Magnus k (w x v)); Rapier adds gravity and decays the spin
    AV[0] = B.vx;
    AV[1] = B.vy;
    AV[2] = B.vz;
    AV[3] = W[0];
    AV[4] = W[1];
    AV[5] = W[2];
    airAcc(dt);
    B.vx = AV[0];
    B.vy = AV[1];
    B.vz = AV[2];
  } else {
    B.vx *= 1 - 0.1 * dt;
    B.vy *= 1 - 0.1 * dt;
    B.vz += k * (W[0] * B.vy - W[1] * B.vx) * dt;
  }
  bb.setTranslation({ x: B.x, y: B.y, z: B.z }, true);
  bb.setLinvel({ x: B.vx, y: B.vy, z: B.vz }, true);
  bb.setAngvel({ x: W[0], y: W[1], z: W[2] }, true);
  const ux = B.vx,
    uy = B.vy,
    uz = B.vz;
  w.timestep = dt;
  w.step();
  const t = bb.translation(),
    v = bb.linvel(),
    a = bb.angvel();
  B.x = t.x;
  B.y = t.y;
  B.z = t.z;
  B.vx = v.x;
  B.vy = v.y;
  B.vz = v.z;
  B.wv = [a.x, a.y, a.z];
  rimSoak(B, ux, uy, uz, dt);
  floorRoll(B, dt);
  B.a += Math.hypot(a.x, a.y, a.z) * dt * 0.5;
}

/** Physics v3 materials by surface (hardwood / street asphalt): floor bounce + grip (Average combine with the ball's
 *  .72 / .55), rim iron (street stiffer), glass; the ball's air spin decay. Swapped only when the set changes. */
function rapMat() {
  const R = RAP!,
    k = cfg.PH3 ? surf() : -1;
  if (k === R.mk) return;
  R.mk = k;
  const s = k < 0 ? null : SURF[k];
  R.fl.setRestitution(s ? 2 * s[0] - 0.72 : 0.8);
  R.fl.setFriction(s ? 2 * s[1] - 0.55 : 0.6);
  for (const [c, back] of R.rims) c.setRestitution(Math.min(0.9, (back ? 0.4 : 0.55) * (s ? s[3] : 1)));
  for (const c of R.gl) c.setRestitution(s ? 0.62 - 2 * (0.6 - s[5]) : 0.62); // (wood: the v5.4 glass; a street board is deader)
  R.bb.setAngularDamping(s ? AIR_WD : 0.3);
}
/** A hard hit bends the iron: the rim flex soaks up part of the rebound (restitution falls with the impact speed, up to
 *  -30% at 950 px/s), so a hard-thrown brick dies off the rim instead of flying; soft touches are unchanged. */
function rimSoak(B: Ball, ux: number, uy: number, uz: number, dt: number) {
  for (const hx of HXs) {
    const rx = B.x - hx,
      ry = B.y - HY,
      d = Math.hypot(rx, ry);
    if (d > RR + BR + 2 || Math.abs(B.z - 100) > BR + 2) continue;
    const cx = d > 0 ? hx + (rx / d) * RR : hx + RR,
      cy = d > 0 ? HY + (ry / d) * RR : HY,
      nx0 = B.x - cx,
      ny0 = B.y - cy,
      nz0 = B.z - 100,
      nl = Math.hypot(nx0, ny0, nz0);
    if (nl > BR + 0.55 + 0.6 || nl === 0) continue;
    const nx = nx0 / nl,
      ny = ny0 / nl,
      nz = nz0 / nl,
      vin = ux * nx + uy * ny + (uz - g * dt) * nz, // approach speed along the contact normal (< 0)
      vout = B.vx * nx + B.vy * ny + B.vz * nz;
    if (cfg.PH3 && vin < 0 && vout > 0) {
      // Physics v3: count the touch (make captions) and the shooter's touch takes some bounce out of his shot
      ph3RimHit();
      if (B.sh && B.tch) {
        B.vx -= nx * vout * B.tch;
        B.vy -= ny * vout * B.tch;
        B.vz -= nz * vout * B.tch;
        RAP!.bb.setLinvel({ x: B.vx, y: B.vy, z: B.vz }, true);
      }
    }
    if (vin > -250 || vout <= 0) continue;
    const k = 0.3 * Math.min(1, (-vin - 250) / 700) * (cfg.PH3 ? SURF[surf()][4] : 1);
    B.vx -= nx * vout * k;
    B.vy -= ny * vout * k;
    B.vz -= nz * vout * k;
    RAP!.bb.setLinvel({ x: B.vx, y: B.vy, z: B.vz }, true);
  }
}
/** Rolling on the wood: rolling resistance (42 px/s^2; Rapier has none, a loose ball rolled forever), the spin about
 *  the vertical dies on the floor, and a ball that has all but stopped stops. */
function floorRoll(B: Ball, dt: number) {
  if (B.z > BR + 0.6 || Math.abs(B.vz) > 30) return;
  const W = B.wv!,
    vh = Math.hypot(B.vx, B.vy);
  let k = 1;
  if (vh > 1e-9) {
    k = Math.max(0, vh - (cfg.PH3 ? SURF[surf()][2] : 42) * dt) / vh; // (Physics v3: asphalt rolls out sooner)
    B.vx *= k;
    B.vy *= k;
  }
  W[0] *= k;
  W[1] *= k;
  W[2] /= 1 + dt * 3;
  if (vh * k < 1.5) B.vx = B.vy = W[0] = W[1] = 0;
}

/** Kinematic torso capsules so a loose/shot ball can bounce off bodies. The shooter is ghosted right after release. */
export function rapSyncPlayers(P: Player[], B: Ball) {
  if (!RAP) return;
  const { w, R, pl } = RAP;
  const rot = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // capsule axis Y -> world Z
  for (let k = 0; k < P.length; k++) {
    const p = P[k],
      H = p.ht * 10,
      r = 8.5 * p.bk,
      hh = Math.max(4, (H * 0.78 - 2 * r) / 2);
    let e = pl[k];
    if (!e || e.H !== H || e.r !== r) {
      if (e) w.removeRigidBody(e.b);
      const b = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z + hh + r).setRotation(rot));
      const c = w.createCollider(R.ColliderDesc.capsule(hh, r).setRestitution(0.35).setFriction(0.5), b);
      e = pl[k] = { b, c, H, r, hh };
    }
    const tz = p.z + e.hh + e.r,
      cur = e.b.translation(),
      far = Math.hypot(cur.x - p.x, cur.y - p.y, cur.z - tz) > 30;
    if (far) e.b.setTranslation({ x: p.x, y: p.y, z: tz }, true);
    else e.b.setNextKinematicTranslation({ x: p.x, y: p.y, z: tz });
    // Only the airborne ball interacts; the shooter is ignored for 0.35 s after release.
    const nearRim = B.z > 55 && (Math.hypot(B.x - HXs[0], B.y - HY) < 30 || Math.hypot(B.x - HXs[1], B.y - HY) < 30);
    e.c.setEnabled(B.mode === "air" && !B.owner && !nearRim && !(B.last === p && B.age < 0.35) && B.age >= 0.12);
  }
  for (let k = P.length; k < pl.length; k++) if (pl[k]) e2(k);
  function e2(k: number) {
    w.removeRigidBody(pl[k].b);
    pl[k] = null;
  }
}
