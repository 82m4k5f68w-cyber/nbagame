// A full AI-vs-AI game: screens must actually connect, shooting fouls and and-ones must happen.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
G.cfg.NP = 5;
G.setCtrls([]);
G.start(1, { j: 2 });
for (let i = 0; i < 60 * 240 && G.S !== "over"; i++) G.upd(1 / 60);
const fga = G.P.reduce((a, p) => a + p.stt.fga, 0);
console.log("plays", JSON.stringify({ ...G.STAT, fga, score: G.sc }));
if (G.STAT.screens < 15) (console.log("FAIL: screens"), process.exit(1));
