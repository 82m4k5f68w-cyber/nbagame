// Developer overlay (dev server only: `npm run dev` then open /?dev). main.ts imports this behind
// `import.meta.env.DEV`, so production builds drop it entirely (no bytes in the single HTML).
//   stats-gl  - FPS / CPU frame time graph (top-left)
//   lil-gui   - live V.* tweaks (graphics level, HSR, AO, grade, camera, FPS counter) + sim cfg toggles
//   spectorjs - WebGL frame capture (button in the GUI -> Spector UI, records the next frame of #c)
import Stats from "stats-gl";
import GUI from "lil-gui";
import { V, QLN, GRADES } from "./view";
import { cfg } from "../core/sim";

export async function initDevtools() {
  const st = new Stats({ trackGPU: false, horizontal: true, minimal: false } as any);
  document.body.appendChild(st.dom);
  Object.assign(st.dom.style, { position: "fixed", left: "0", top: "0", zIndex: "9999" });
  const tick = () => {
    st.update();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const gui = new GUI({ title: "H2K dev" });
  gui.domElement.style.zIndex = "9999";
  const g = gui.addFolder("Graphics");
  g.add(V, "QL", Object.fromEntries(QLN.map((n, i) => [n, i])));
  g.add(V, "HSR", { Off: 0, Auto: 1, Quality: 2, Balanced: 3, Performance: 4, Ultra: 5 });
  g.add(V, "AO", { auto: -1, off: 0, half: 1, full: 2 });
  g.add(V, "GRADE", Object.fromEntries(GRADES.map((x, i) => [x[0], i])));
  g.add(V, "FX");
  g.add(V, "FPSC").name("FPS counter");
  g.add(V, "CAMM", { Broadcast: 0, Low: 1, Player: 2, Overhead: 3 });
  const s = gui.addFolder("Sim cfg");
  for (const k of ["PP", "AP", "TP", "DIFF"]) if (k in cfg) s.add(cfg as any, k, 0, 3, 1);
  const tools = {
    spector: async () => {
      const { Spector } = await import("spectorjs");
      const sp = new Spector();
      sp.displayUI();
      const c = document.getElementById("c") as HTMLCanvasElement | null;
      if (c) sp.captureCanvas(c);
    },
    dev: () => console.log("V.DEV", (V as any).DEV, "GL stats", V.GL?.stats?.()),
  };
  gui.add(tools, "spector").name("Spector: capture a frame");
  gui.add(tools, "dev").name("Log probe + GL stats");
  (window as any).__DEVTOOLS = { stats: st, gui };
  return { stats: st, gui };
}
