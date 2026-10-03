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
  p.mvT = 0;
  p.celT = 0;
  p.setT = 0;
  p.postA = 0;
  p.hitT = 0;
  p.landT = 0;
  p.pT = 0;
  p.en = 1;
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
const CELN = ["", "Shimmy", "Night night", "Flex", "Three up", "Chest thump", "Roar", "Shh", "Point to the sky", "Dap"];

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
    "Hands on knees",
    (p) => {
      stand(p);
      p.en = 0.4;
      G.setScalars({ rs: 1 });
    },
  ],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
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
    ANIMS[cur][1](p, t, dt);
    p.x = 470;
    p.y = 250;
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
    ANIMS[i][1](p, Math.max(0, t), 1 / 60);
    p.x = 470;
    p.y = 250;
    pose3(p);
  }
}
