// Online session (filled in by Phase 1). Phase 0 stub: offline only.
import type { Ctrl, Input } from "../../core/sim";
export const NET = {
  role: null as null | "host" | "guest",
  openLobby() {},
  remoteInput(_c: Ctrl): Input {
    return { dx: 0, dy: 0 };
  },
  requestSkip() {},
  guestFrame(_dt: number) {},
  hostTick() {},
  hud(_X: CanvasRenderingContext2D) {},
  backToLobby() {},
};
