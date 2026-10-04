// Facial expressions (pose.ts face()): each trigger drives the expected channels, blinks happen, eyes follow the ball,
// and the values stay finite and in range over a full simulated game.
import * as G from "../src/core/sim";
import { pose3 } from "../src/core/pose";
G.cfg.NP = 5; G.cfg.MYM = 0;
G.setCtrls([]);
G.start(1); G.setup(0); G.setInb(0);
const p = G.P[0];
const run = (n: number, f?: () => void) => { for (let i = 0; i < n; i++) (f && f(), pose3(p)); return p.fc; };
const fail: string[] = [];
const ok = (c: boolean, m: string) => c || fail.push(m);
const calm = { ...run(60, () => ((p.celT = 0), (p.hitT = 0), (p.frT = 0))) };
ok(Math.abs(calm.jw) < 0.25 && Math.abs(calm.an) < 0.5, "calm face " + JSON.stringify(calm));
let c = run(30, () => ((p.cel = 6), (p.celT = 1)));
ok(c.jw > 0.8 && c.an > 0.7 && c.wd > 0.6, "yell " + JSON.stringify(c));
c = run(30, () => ((p.cel = 1), (p.celT = 1)));
ok(c.sm > 0.9, "grin " + JSON.stringify(c));
c = run(30, () => ((p.celT = 0), (p.hitT = 0.2)));
ok(c.sq > 0.9 && c.wd > 0.9, "grimace " + JSON.stringify(c));
c = run(30, () => ((p.hitT = 0), (p.frT = 1)));
ok(c.sm < -0.7 && c.br > 0.6, "frustration " + JSON.stringify(c));
// blinks: within 6 s every player closes his eyes at least once
let bl = 0;
for (let i = 0; i < 360; i++) {
  G.upd(1 / 60);
  for (const o of G.P) if (o.fc && o.fc.bl > 0.9) bl |= 1 << G.P.indexOf(o);
}
ok(bl === (1 << G.P.length) - 1, "every player blinks: " + bl.toString(2));
// a whole game: everything finite and bounded
G.cfg.input = () => ({ dx: 0, dy: 0 });
let bad = 0;
for (let i = 0; i < 60 * 240; i++) {
  G.upd(1 / 60);
  for (const o of G.P) if (o.fc) for (const k in o.fc) if (!isFinite(o.fc[k]) || Math.abs(o.fc[k]) > 1.01) bad++;
}
ok(!bad, "face values out of range: " + bad);
console.log(fail.length ? "FACES FAIL\n" + fail.join("\n") : "FACES OK");
process.exit(fail.length ? 1 : 0);
