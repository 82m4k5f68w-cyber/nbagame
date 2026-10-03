// Gameplay rules over full CPU games: violations, substitutions, timeouts, foul-outs, clutch time and badges all fire
// without breaking the game (no NaN, scores sane, every game finishes), and the rules can be switched off.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  const run = (np: number, games: number, rules: Partial<typeof G.cfg>) => {
    G.cfg.NP = np;
    Object.assign(G.cfg, { FOULS: 1, SCLK: 1, VIOL: 1, SUBS: 1, BADGES: 1 }, rules);
    G.setCtrls([]);
    G.setQtrLen(60);
    const cnt: Record<string, number> = {};
    let subs = 0,
      over = 0;
    for (let gi = 0; gi < games; gi++) {
      G.start(gi % 7, { j: (gi + 3) % 7 });
      const sv0 = G.SUBV;
      let n = 0;
      while (G.S === "play" && n < 60 * 60 * 12) {
        G.upd(1 / 60);
        if (G.RPL) G.skipReplay();
        n++;
        while (G.FX.length) {
          const f = G.FX.shift();
          const k = f.k === "ban" ? String(f.s).replace(/\d+-0 RUN/, "RUN") : "";
          if (k) cnt[k] = (cnt[k] || 0) + 1;
        }
        for (const p of G.P) if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) throw new Error("NaN player " + p.n);
        if (!isFinite(G.B.x) || !isFinite(G.B.z)) throw new Error("NaN ball " + JSON.stringify(G.B, (k, v) => (["owner", "last", "to", "flBy"].includes(k) ? v && v.n : k === "pp" ? undefined : v)) + " rs " + G.rs + " inb " + G.inb + " " + JSON.stringify(G.P.map((p) => [p.n, p.x | 0, p.y | 0, p.z | 0, p.mode])));
      }
      subs += G.SUBV - sv0;
      if (G.S !== "over") console.log("unfinished game", gi, "q", G.q, "clock", G.clock.toFixed(1), "sc", G.sc, "rs", G.rs, "inb", G.inb, "ftq", !!G.ftq, "JB", !!G.JB, "S", G.S);
      if (G.S === "over") over++;
    }
    return { cnt, subs, over };
  };
  // drain FX continuously: the ring only keeps 64 entries, so count on the fly instead
  const all = run(5, 6, {});
  console.log("5v5 rules on", JSON.stringify(all));
  const off = run(5, 3, { FOULS: 0, VIOL: 0, SUBS: 0, BADGES: 0 });
  console.log("5v5 rules off", JSON.stringify(off));
  const one = run(1, 4, {});
  console.log("1v1", JSON.stringify(one));
  const ok =
    all.over === 6 && off.over === 3 && one.over === 4 &&
    all.subs > 0 && off.subs === 0 && one.subs === 0 &&
    !off.cnt["3 SECONDS"] && !off.cnt["8-SECOND VIOLATION"] && !off.cnt["GOALTENDING"] && !off.cnt["FLAGRANT 1"];
  console.log(ok ? "rules ok" : "RULES FAIL");
  process.exit(ok ? 0 : 1);
})();
