// Dedicated authoritative host: runs the shared sim at a fixed 60 Hz in Node (with Rapier), no local player.
// Guests join room code CODE; the game starts when every seated player is ready. Exits when the room is empty.
//   tsx server/headless-host.ts CODE ws://127.0.0.1:8787/ws [room] [--np=1|5] [--ql=60]
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { WsTransport } from "../src/net/ws";
import { HostSession } from "../src/net/host";

const [code = "TEST", url = "ws://127.0.0.1:8787/ws", room = "h2k-" + code.toLowerCase()] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (k: string, d: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? +a.split("=")[1] : d;
};
await rapInit();
Object.assign(G.cfg, { physics: "rapier", hand: true, replays: true });
const t = await new WsTransport(url, room).connect();
const H = new HostSession(t, { n: "Server", tok: "", tm: 0, play: false }, { np: flag("np", 5), pro: 1, ql: flag("ql", 60), code, ded: true });
G.cfg.input = (c) => H.remoteInput(c);
console.log(`[host ${code}] dedicated host ready in room ${room}`);

let empty = 0,
  next = performance.now(),
  ticks = 0;
const STEP = 1000 / 60;
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 6) {
    if (H.L.st === "lobby" && H.L.slots.length && H.L.slots.every((s) => s.rdy)) H.start();
    if (H.L.st !== "lobby") {
      G.upd(1 / 60);
      H.tick();
      if (G.S === "over" && H.L.st === "over" && ++ticks > 60 * 20) {
        ticks = 0;
        H.backToLobby();
      }
    } else H.pub(false);
    next += STEP;
    n++;
  }
  if (now - next > 250) next = now; // never spiral after a stall
  empty = t.peers().length <= 1 || !t.connected() ? empty + 1 : 0;
  if (empty > 60 * (t.connected() ? 60 : 10)) {
    console.log(`[host ${code}] room empty, exiting`);
    t.leave();
    process.exit(0);
  }
  setTimeout(loop, Math.max(1, next - performance.now()));
}
loop();
