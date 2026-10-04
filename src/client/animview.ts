// Animation Studio: plays any animation of the Pro Play engine on one player, in place, so each move can be
// checked (and screenshotted) without a game around it. Pause menu -> Animation Studio, or ?anim in the URL.
import * as G from "../core/sim";
import { P, B, stepLen, CEL_T } from "../core/sim";
import { pose3 } from "../core/pose";
import { V } from "./view";

type Setup = (p: any, t: number, dt: number) => void;
const stand = (p: any) => {
  for (const o of P) if (o !== p) (o.x = 120), (o.y = 470), (o.z = 0), (o.vx = o.vy = 0), (o.f = 0), (o.mode = "i"), pose3(o);
  p.x = 470;
  p.y = 250;
  p.z = 0;
  p.vx = p.vy = p.vz = 0;
  p.mode = "i";
  p.hupT = p.plantT = p.engT = p.dcl = p.pk = 0;
  p.mvT = 0;
  p.celT = 0;
  p.setT = 0;
  p.postA = 0;
  p.hitT = 0;
  p.frT = 0;
  if (p.sg && p.sg._o) p.sg = p.sg._o; // undo the studio's left-handed override
  p.landT = 0;
  p.pT = 0;
  p.en = 1;
  p.brk = 0;
  p.acc = 0;
  p.act = 0;
  p.actT = 0;
  p.ttT = 0;
  p.ftT = 0;
  G.setInb(0);
  G.setScalars({ rs: 0, ftq: null, pos: p.tm });
  B.owner = null;
  B.mode = "air";
  B.x = p.x + Math.cos(p.f) * 70;
  B.y = p.y + Math.sin(p.f) * 70 + 30;
  B.z = 30;
};
/** Treadmill: velocity along a direction relative to facing, gait phase advances, position stays put. */
const move = (p: any, dt: number, v: number, rel: number) => {
  p.vx = Math.cos(p.f + rel) * v;
  p.vy = Math.sin(p.f + rel) * v;
  p.ph += ((v * dt) / stepLen(v)) * Math.PI;
};
const dribble = (p: any, dt: number) => {
  B.owner = p;
  B.mode = "held";
  G.bstep(dt / 2);
  G.bstep(dt / 2);
};
/** A defender d px in front of the handler (angle off the facing in radians). */
const guard = (p: any, d: number, a = 0) => {
  const o = P.find((q) => q.tm !== p.tm)!;
  o.x = p.x + Math.cos(p.f + a) * d;
  o.y = p.y + Math.sin(p.f + a) * d;
  o.f = p.f + Math.PI;
  pose3(o);
};
/** Trigger dribble move k (1 hesi->cross path, 2 spin, 3 behind the back) every `per` seconds. */
const moveEvery = (p: any, t: number, k: number, per: number) => {
  const e = t % per;
  if (e < 0.5) {
    p.mvk = k === 1 ? 0 : k; // the plain crossover is the "other" move kind
    p.mvT = 0.5 - e;
    p.mvE = e;
    p.mvS = 1;
  }
};
const CELN = ["", "Shimmy", "Night night", "Flex", "Three up", "Chest thump", "Roar", "Shh", "Point to the sky", "Dap", "Held follow-through", "Hands on head (missed)", "Arguing the call", "Clapping (hype)", "Swat hold", "Jersey tug (dead ball)"];

export const ANIMS: [string, Setup][] = [
  ["Idle (breathing)", (p) => stand(p)],
  ["Walk", (p, t, dt) => (stand(p), move(p, dt, 60, 0))],
  ["Jog", (p, t, dt) => (stand(p), move(p, dt, 150, 0))],
  ["Sprint", (p, t, dt) => (stand(p), move(p, dt, 270, 0))],
  ["Backpedal", (p, t, dt) => (stand(p), move(p, dt, 110, Math.PI))],
  [
    "Defensive slide",
    (p, t, dt) => {
      stand(p);
      const o = P.find((q) => q.tm !== p.tm)!;
      G.setScalars({ pos: o.tm });
      B.owner = o;
      move(p, dt, 120, Math.sin(t * 1.2) > 0 ? Math.PI / 2 : -Math.PI / 2);
    },
  ],
  ["Dribble (standing)", (p, t, dt) => (stand(p), dribble(p, dt))],
  ["Dribble (driving)", (p, t, dt) => (stand(p), move(p, dt, 230, 0), dribble(p, dt))],
  ["Hard cut (bank + plant)", (p, t, dt) => (stand(p), move(p, dt, 230, t * 4.5))],
  ["Drive start (first steps)", (p, t, dt) => (stand(p), (p.acc = 1900), move(p, dt, 90, 0))],
  ["Stride stop", (p, t, dt) => (stand(p), (p.brk = 1), move(p, dt, 110, 0))],
  [
    "Defender: active hands",
    (p, t, dt) => {
      stand(p);
      const o = P.find((q) => q.tm !== p.tm)!;
      G.setScalars({ pos: o.tm });
      o.x = p.x + Math.cos(p.f) * 42;
      o.y = p.y + Math.sin(p.f) * 42;
      o.f = p.f + Math.PI;
      o.mode = "i";
      B.owner = o;
      B.mode = "held";
      G.bstep(dt / 2);
      G.bstep(dt / 2);
      pose3(o);
    },
  ],
  [
    "Rebound reach",
    (p, t) => {
      stand(p);
      const k = t % 1.2;
      p.z = Math.max(0, Math.sin((k / 0.8) * Math.PI) * 30) * (k < 0.8 ? 1 : 0);
      p.vz = k < 0.8 ? ((30 * Math.PI) / 0.8) * Math.cos((k / 0.8) * Math.PI) : 0;
      B.owner = null;
      B.mode = "air";
      B.x = p.x + Math.cos(p.f) * 10 + 6;
      B.y = p.y + Math.sin(p.f) * 10;
      B.z = 112 - k * 10;
    },
  ],
  [
    "Closeout (hand up, chop steps)",
    (p, t, dt) => {
      stand(p);
      guard(p, 60);
      const o = P.find((q) => q.tm !== p.tm)!;
      o.f = p.f + Math.PI;
      B.owner = o;
      B.mode = "held";
      move(p, dt, 150, 0);
    },
  ],
  [
    "Vertical jump (motion capture)",
    (p, t) => {
      stand(p);
      const k = (t % 1.5) - 0.3; // airborne for 0.94 s (vz 150 px/s, g 320)
      p.z = k > 0 && k < 0.94 ? 150 * k - 160 * k * k : 0;
      p.vz = k > 0 && k < 0.94 ? 150 - 320 * k : 0;
      B.owner = null;
      B.mode = "air";
      B.x = p.x + Math.cos(p.f) * 400;
      B.y = p.y + Math.sin(p.f) * 400;
      B.z = 60;
    },
  ],
  [
    "Hard bump (stumble + recover)",
    (p, t) => {
      stand(p);
      const k = t % 1.6;
      if (k < 1 / 60) {
        p.hitT = 0.35;
        p.hitX = -Math.sin(p.f);
        p.hitY = Math.cos(p.f);
      } else p.hitT = Math.max(0, (p.hitT || 0) - 1 / 60);
    },
  ],
  ["Sudden stop (body weight)", (p, t, dt) => (stand(p), move(p, dt, 260 * Math.max(0, Math.min(1, 1 - ((t % 1.4) - 0.8) / 0.15)), 0))],
  [
    "Box-out",
    (p, t) => {
      stand(p);
      const hx = G.hoop(1 - p.tm),
        dir = hx > 470 ? 1 : -1;
      p.x = hx - dir * 60;
      p.y = 250;
      p.f = dir > 0 ? 0 : Math.PI;
      const o = P.find((q) => q.tm !== p.tm)!;
      o.x = p.x - dir * 15;
      o.y = 250 + Math.sin(t * 3) * 4;
      o.f = p.f;
      pose3(o);
      B.owner = null;
      B.mode = "air";
      B.sh = 1;
      B.x = hx;
      B.y = 250;
      B.z = 112;
    },
  ],
  ...([
    [0, "Chest pass"],
    [1, "Bounce pass"],
    [2, "Lob pass"],
  ] as [number, string][]).map(
    ([ty, name]) =>
      [
        name,
        (p: any, t: number) => {
          stand(p);
          const k = t % 0.9;
          p.pT = Math.max(0, 0.25 - k);
          B.ptype = ty;
          B.owner = null;
          B.mode = "pass";
          B.x = p.x + Math.cos(p.f) * (14 + k * 120);
          B.y = p.y + Math.sin(p.f) * (14 + k * 120);
          B.z = ty === 2 ? 70 + k * 40 : ty === 1 ? Math.max(4, 40 - k * 120) : 48;
        },
      ] as [string, Setup],
  ),
  ["Contest: hand up, no jump", (p) => (stand(p), (p.hupT = 0.6))],
  ["Behind-the-back pass", (p, t) => (stand(p), (B.ptype = 0), (p.pk = 2), (p.pT = Math.max(0, 0.25 - (t % 1) * 0.45)))],
  ["No-look pass", (p, t, dt) => (stand(p), move(p, dt, 140, 0), (B.ptype = 0), (p.pk = 1), (p.pT = Math.max(0, 0.25 - (t % 1) * 0.45)))],
  ["Wraparound bounce pass", (p, t) => (stand(p), (B.ptype = 1), (p.pk = 3), (p.pT = Math.max(0, 0.25 - (t % 1) * 0.45)))],
  ["Plant step (hard cut)", (p, t, dt) => (stand(p), move(p, dt, 200, 0), (p.plantT = (t % 1) < 0.3 ? 0.2 : 0))],
  ["Body english (ball on the rim)", (p, t) => (stand(p), (p.engT = 0.25), (p.eng = Math.sin(t * 2.5)))],
  [
    "Double clutch",
    (p, t) => {
      stand(p);
      B.owner = p;
      B.mode = "held";
      p.mode = "s";
      p.sv = 22;
      p.rl = 0;
      p.dcl = 0.1;
      p.t = (t % 1.1) * 0.5;
      p.z = Math.sin(Math.min(1, p.t / 0.55) * Math.PI) * 40;
    },
  ],
  [
    "Shot block attempt",
    (p, t) => {
      stand(p);
      const o = P.find((q) => q.tm !== p.tm)!;
      G.setScalars({ pos: o.tm });
      o.x = p.x + Math.cos(p.f) * 18;
      o.y = p.y + Math.sin(p.f) * 18;
      o.f = p.f + Math.PI;
      o.mode = "s";
      o.t = 0.3;
      o.sv = 0;
      o.z = 14;
      pose3(o);
      B.owner = o;
      B.mode = "held";
      B.x = o.x + Math.cos(o.f) * 3;
      B.y = o.y + Math.sin(o.f) * 3;
      B.z = o.z + 92;
      const k = t % 1.1;
      p.z = k < 0.8 ? Math.sin((k / 0.8) * Math.PI) * 34 : 0;
    },
  ],
  [
    "Inbound (ball overhead)",
    (p, t, dt) => {
      stand(p);
      G.setInb(1); // stays set through the pose (stand() clears it next frame)
      dribble(p, dt);
    },
  ],
  ...([
    [1, 0.42, "Pump fake"],
    [2, 0.38, "Jab step"],
    [3, 1.2, "Taking a charge (fall)"],
    [4, 0.75, "Loose-ball dive"],
    [5, 0.5, "Fumbled catch"],
    [6, 0.45, "Shot gets blocked"],
  ] as [number, number, string][]).map(
    ([a, T0, name]) =>
      [
        name,
        (p: any, t: number) => {
          stand(p);
          const k = t % (T0 + 0.6);
          p.act = a;
          p.actT = Math.max(0, T0 - k);
          if (a === 1 || a === 2) (p.ttT = 0.5), dribble(p, 1 / 60);
          if (a === 2) (p.jabX = 1), (p.jabY = 0);
        },
      ] as [string, Setup],
  ),
  ["Triple threat", (p, t, dt) => (stand(p), (p.ttT = 1), dribble(p, dt))],
  [
    "Shoulder fake (post)",
    (p, t) => {
      stand(p);
      p.postA = 1;
      const k = t % 1;
      p.act = 8;
      p.actT = Math.max(0, 0.4 - k);
      dribble(p, 1 / 60);
    },
  ],
  [
    "Free-throw routine",
    (p, t, dt) => {
      stand(p);
      G.setScalars({ ftq: { s: p, i: 0, n: 2, next: 0, w: 9, fired: 0 } });
      p.ftT = t % 3.4;
      dribble(p, dt);
    },
  ],
  [
    "Chop steps vs defender",
    (p, t, dt) => (stand(p), guard(p, 34), dribble(p, dt)),
  ],
  ["Size-up vs defender", (p, t, dt) => (stand(p), guard(p, 40), dribble(p, dt))],
  ["Arm-bar drive", (p, t, dt) => (stand(p), guard(p, 30, 1.2), move(p, dt, 160, 0), dribble(p, dt))],
  ["Crossover", (p, t, dt) => (stand(p), moveEvery(p, t, 1, 1.1), move(p, dt, 120, 0), dribble(p, dt))],
  ["Behind the back", (p, t, dt) => (stand(p), moveEvery(p, t, 3, 1.1), move(p, dt, 120, 0), dribble(p, dt))],
  ["Spin move", (p, t, dt) => (stand(p), moveEvery(p, t, 2, 1.3), dribble(p, dt))],
  [
    "Jump shot",
    (p, t) => {
      stand(p);
      const k = t % 1.4;
      B.owner = p;
      B.mode = "held";
      p.mode = k < 0.12 ? "c" : k < 0.95 ? "s" : "i";
      p.t = k < 0.12 ? k : k - 0.12;
      p.st = 1;
      p.z = p.mode === "s" ? Math.max(0, Math.sin(Math.min(1, p.t / 0.6) * Math.PI) * 24) : 0;
    },
  ],
  [
    "Jump shot (left-handed)",
    (p, t) => {
      stand(p);
      p.sg = { ...(p.sg || {}), lh: 1, _o: p.sg || {} };
      const k = t % 1.4;
      B.owner = p;
      B.mode = "held";
      p.mode = k < 0.12 ? "c" : k < 0.95 ? "s" : "i";
      p.t = k < 0.12 ? k : k - 0.12;
      p.st = 1;
      p.z = p.mode === "s" ? Math.max(0, Math.sin(Math.min(1, p.t / 0.6) * Math.PI) * 24) : 0;
    },
  ],
  ...["classic", "thumb flick", "early drop", "elbow out", "rides high", "two-hand push"].map(
    (nm, gs) =>
      [
        "Guide hand: " + nm,
        (p: any, t: number) => {
          stand(p);
          p.sg = { ...(p.sg || {}), gs, _o: p.sg || {} };
          const k = t % 1.4;
          B.owner = p;
          B.mode = "held";
          p.mode = k < 0.12 ? "c" : k < 0.95 ? "s" : "i";
          p.t = k < 0.12 ? k : k - 0.12;
          p.st = 1;
          p.sv = 0;
          p.z = p.mode === "s" ? Math.max(0, Math.sin(Math.min(1, p.t / 0.6) * Math.PI) * 24) : 0;
        },
      ] as [string, Setup],
  ),
  [
    "Jump shot (motion capture)",
    (p, t) => {
      stand(p);
      const k = t % 1.4;
      B.owner = p;
      B.mode = "held";
      p.mode = k < 0.12 ? "c" : k < 0.95 ? "s" : "i";
      p.t = k < 0.12 ? k : k - 0.12;
      p.st = 0;
      p.sv = 22;
      p.z = p.mode === "s" ? Math.max(0, Math.sin(Math.min(1, p.t / 0.6) * Math.PI) * 24) : 0;
    },
  ],
  ...(
    [
      [6, "Dunk: one hand"],
      [11, "Dunk: two-hand power"],
      [12, "Dunk: tomahawk"],
      [13, "Dunk: windmill"],
      [14, "Dunk: reverse"],
      [15, "Dunk: 360"],
      [19, "Hanging on the rim"],
      [5, "Layup"],
      [16, "Finger roll"],
      [17, "Reverse layup"],
      [18, "Contact layup"],
      [7, "Euro step"],
      [4, "Floater"],
      [20, "Leaner"],
      [21, "Runner"],
    ] as [number, string][]
  ).map(
    ([sv, name]) =>
      [
        name,
        (p: any, t: number) => {
          stand(p);
          // a few feet from the rim, facing it
          const hx = G.hoop(p.tm),
            dir = hx > 470 ? 1 : -1;
          p.x = hx - dir * (sv === 19 ? 9 : 34);
          p.y = 250;
          p.f = dir > 0 ? 0 : Math.PI;
          const k = t % 1.3;
          p.mode = k < 0.95 ? "s" : "i";
          p.sv = sv;
          p.t = Math.min(k, 0.95);
          p.z = sv === 19 ? 100 - (75 * p.ht) / 6.4 : p.mode === "s" ? Math.max(0, Math.sin(Math.min(1, p.t / 0.7) * Math.PI) * 40) : 0;
          B.owner = p.t < 0.28 && sv !== 19 ? p : null;
          B.mode = B.owner ? "held" : "air";
          if (!B.owner) (B.x = hx), (B.y = 250), (B.z = 96 - k * 30);
        },
      ] as [string, Setup],
  ),
  [
    "Hands on knees",
    (p) => {
      stand(p);
      p.en = 0.4;
      G.setScalars({ rs: 1 });
    },
  ],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(
    (k) =>
      [
        "Celebration: " + CELN[k],
        (p: any, t: number) => {
          stand(p);
          p.cel = k;
          p.celT = CEL_T - (t % (CEL_T + 0.4));
          if (p.celT < 0) p.celT = 0;
        },
      ] as [string, Setup],
  ),
  // faces: close-up camera on the head (eyes follow the ball, blinks keep running)
  ...(
    [
      ["calm (blinks, eyes on the ball)", (p: any, t: number) => ((B.x = p.x + Math.cos(p.f) * 60 + Math.sin(t * 1.3) * 40), (B.y = p.y + Math.sin(p.f) * 60 + Math.cos(t * 1.3) * 60), (B.z = 60))],
      ["grin", (p: any) => ((p.cel = 1), (p.celT = 1))],
      ["yell", (p: any) => ((p.cel = 6), (p.celT = 1))],
      ["gritted teeth (contact)", (p: any) => (p.hitT = 0.2)],
      ["frustrated (missed)", (p: any) => (p.frT = 1)],
      ["wince (open miss)", (p: any) => ((p.cel = 11), (p.celT = 1))],
      ["arguing", (p: any) => ((p.cel = 12), (p.celT = 1))],
      ["dunk face", (p: any) => ((p.mode = "s"), (p.sv = 13), (p.z = 30), (p.t = 0.1))],
    ] as [string, (p: any, t: number) => void][]
  ).map(
    ([n, f]) =>
      [
        "Face: " + n,
        (p: any, t: number) => {
          stand(p);
          (B.x = p.x + Math.cos(p.f) * 300), (B.y = p.y + Math.sin(p.f) * 300), (B.z = 55); // ball out front: he faces the camera
          f(p, t);
          Object.assign((V as any).studio, { d: 3.4, h: (p.ht / 6.4) * 5.9 + p.z * 0.1, dy: 0.15 });
        },
      ] as [string, Setup],
  ),
];

let cur = 0,
  hold = false, // frozen by studioPose (screenshots)
  t = 0,
  el: HTMLElement | null = null;
/** Open the studio. `setTick` installs the per-frame driver in the game loop (null removes it). */
export function openStudio(setTick: (f: ((dt: number) => void) | null) => void, at = 0) {
  cur = at;
  t = 0;
  G.setS("studio");
  const p = P[V.focus] || P[0];
  for (const o of P) if (o !== p) (o.x = 60), (o.y = 480), (o.vx = o.vy = 0), (o.f = 0);
  (V as any).studio = { a: 0.6, d: 17 };
  el?.remove();
  el = document.createElement("div");
  el.id = "studio";
  el.style.cssText =
    "position:fixed;left:12px;top:56px;z-index:30;background:rgba(10,12,28,.88);border:1px solid #ffffff22;border-radius:12px;padding:10px;color:#fff;font:600 13px system-ui;max-height:80vh;overflow:auto;width:220px";
  const draw = () => {
    el!.innerHTML =
      `<div style="font:900 15px system-ui;margin-bottom:6px">🎬 ANIMATION STUDIO</div>` +
      ANIMS.map((a, i) => `<button data-i="${i}" style="display:block;width:100%;text-align:left;margin:2px 0;padding:5px 8px;border-radius:7px;border:0;cursor:pointer;background:${i === cur ? "#ffd23f" : "#ffffff14"};color:${i === cur ? "#111" : "#fff"};font:600 12px system-ui">${a[0]}</button>`).join("") +
      `<div style="margin-top:8px;opacity:.7;font-size:11px">↑/↓ pick · ←/→ turn camera · R auto-orbit · Esc close</div>`;
    el!.querySelectorAll<HTMLElement>("button").forEach((b) => (b.onclick = () => ((cur = +b.dataset.i!), (t = 0), draw())));
  };
  draw();
  document.body.appendChild(el);
  let spin = 1;
  const key = (e: KeyboardEvent) => {
    if (e.code === "ArrowDown") (cur = (cur + 1) % ANIMS.length), (t = 0), draw();
    else if (e.code === "ArrowUp") (cur = (cur + ANIMS.length - 1) % ANIMS.length), (t = 0), draw();
    else if (e.code === "KeyR") spin = 1 - spin;
    else if (e.code === "ArrowLeft") (V as any).studio.a -= 0.3;
    else if (e.code === "ArrowRight") (V as any).studio.a += 0.3;
    else if (e.code === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  addEventListener("keydown", key, true);
  const close = () => {
    removeEventListener("keydown", key, true);
    el?.remove();
    el = null;
    setTick(null);
    location.reload();
  };
  setTick((dt) => {
    if (hold) return;
    t += dt;
    p.f = 0.3;
    if (spin) (V as any).studio.a += dt * 0.35; // orbit the camera, not the player (keeps treadmill moves readable)
    (V as any).studio = { a: (V as any).studio.a, d: 17 }; // face entries zoom in
    ANIMS[cur][1](p, t, dt);
    if (p.celT > 0) p.celT = Math.max(0, p.celT); // driven by the setup, not the sim clock
    pose3(p);
  });
}
/** Screenshot helper for tests: show animation i at time tt (no UI timing). */
export function studioPose(i: number, tt: number, a = 0.6) {
  const p = P[V.focus] || P[0],
    f = 0.3;
  (V as any).studio = { a, d: 17 };
  cur = i;
  hold = true;
  for (let k = 0; k < 40; k++) {
    t = tt - (39 - k) / 60;
    p.f = f;
    (V as any).studio = { a, d: 17 };
    ANIMS[i][1](p, Math.max(0, t), 1 / 60);
    pose3(p);
  }
}
