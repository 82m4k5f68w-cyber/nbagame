// Gameplay realism: CPU vs CPU 5v5 games with every rule on; per-team per-48-minute box score compared with NBA
// 2024-25 league averages. Possessions = possession changes; FTA = free-throw launches; TOV from the standard
// possession estimate (poss - FGA + ORB - 0.44 FTA). N=games, QL=quarter length (s).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
const NBA = { astr: 63.5, ftr: 0.216, pace: 98.5, pts: 113.8, fga: 89.2, fgp: 47.0, tpa: 37.5, tpp: 36.0, fta: 21.3, ast: 26.7, tov: 14.2, reb: 44.0, orbp: 24.0, blk: 4.9 };
(async () => {
  await rapInit(); (globalThis as any).WHY = {};
  const N = +(process.env.N || 4), QL = +(process.env.QL || 180);
  let s = +(process.env.SEED || 2024);
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, DIFF: 2 });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  const CTX: Record<string, number[]> = {};
  const KS: Record<string, number[]> = {}; // kind: [att, made, cw sum]
  let pend: any[] = [];
  let clkSum = 0, clkN = 0, passes = 0;
  const T = { min: 0, poss: 0, pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ast: 0, reb: 0, orb: 0, blk: 0, teams: 0 };
  for (let g = 0; g < N; g++) {
    G.setQtrLen(QL);
    G.setCtrls([]);
    G.start(g % 7, { j: (g + 3) % 7 });
    let lastPP: any = G.B.pp, lastPos = G.pos, poss = 1, fta = 0, lastLc = new Map<any, number>(), ticks = 0;
    while (G.S !== "over" && ticks < 60 * QL * 6) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
      ticks++;
      if (G.S === "half") G.setS("play");
      if (G.pos !== lastPos) (poss++, (lastPos = G.pos));
      pend = pend.filter((s) => {
        if (ticks - s.t0 < 150) return true;
        const k = (KS[s.kind] = KS[s.kind] || [0, 0, 0]);
        k[0]++, (k[2] += Math.max(0, s.cw));
        if (s.p.stt && G.sc[s.p.tm] > s.sc) k[1]++;
        return false;
      });
      if (G.B.pp && G.B.pp !== lastPP) (passes++, (lastPP = G.B.pp));
      for (const p of G.P) {
        const lc = p.lc || 0;
        if (lc !== (lastLc.get(p) ?? lc)) {
          if (G.B.ft) fta++;
          else {
            (clkSum += 24 - G.shot), clkN++;
            const D = Math.hypot(G.hoop(p.tm) - p.x, G.HY - p.y), el = 24 - G.shot;
            const kind = D < 70 ? "rim" : D < 237 ? "mid" : "three";
            const ctx = G.B.pp && G.B.pp.p !== p && G.T - G.B.pp.t < 1.2 ? "catch" : el < 3 && (!G.B.pp || G.T - G.B.pp.t > 3) ? "early/orb" : "dribble";
            const key = kind + "/" + ctx;
            (CTX[key] = CTX[key] || [0, 0]), CTX[key][0]++, (CTX[key][1] += el);
            pend.push({ p, kind, cw: p.cw ?? -1, sc: G.sc[p.tm], t0: ticks });
          }
        }
        lastLc.set(p, lc);
      }
    }
    const mins = (G.q * QL) / 60;
    T.min += mins;
    T.poss += poss / 2; // per team
    T.fta += fta / 2;
    T.teams += 2;
    for (const p of [...G.ROST[0], ...G.ROST[1]]) {
      const t = p.stt;
      T.pts += t.pts; T.fga += t.fga; T.fgm += t.fgm; T.tpa += t.tpa; T.tpm += t.tpm; T.ast += t.ast; T.reb += t.reb; T.orb += t.orb; T.blk += t.blk;
    }
    console.log(`game ${g}: ${G.sc.join("-")} q${G.q} poss/team ${(poss / 2).toFixed(0)}`);
  }
  const per48 = (v: number) => ((v / (T.teams / 2)) * 48) / (T.min) / 2 * 2; // per team per 48
  const k = 48 / (T.min / (T.teams / 2)); // scale a per-team-per-game total to 48 minutes
  const pt = (v: number) => (v / T.teams) * k * 2 * (T.teams / 2) / (T.teams / 2) / 2; // per team per 48
  const NG = T.teams / 2,
    tov = T.poss / NG - T.fga / T.teams + T.orb / T.teams - (0.44 * T.fta) / NG; // per team per game
  const row = {
    pace: (T.poss / (T.teams / 2)) * k,
    pts: (T.pts / T.teams) * k,
    fga: (T.fga / T.teams) * k,
    fgp: (100 * T.fgm) / T.fga,
    tpa: (T.tpa / T.teams) * k,
    tpp: (100 * T.tpm) / Math.max(1, T.tpa),
    fta: (T.fta / (T.teams / 2)) * k,
    ast: (T.ast / T.teams) * k,
    tov: tov * k,
    astr: (100 * T.ast) / Math.max(1, T.fgm),
    ftr: T.fta / NG / (T.poss / NG),
    reb: (T.reb / T.teams) * k,
    orbp: (100 * T.orb) / Math.max(1, T.reb),
    blk: (T.blk / T.teams) * k,
  } as Record<string, number>;
  void per48; void pt;
  console.log("stat      sim    NBA");
  for (const key of Object.keys(NBA)) console.log(key.padEnd(6), row[key].toFixed(1).padStart(7), String((NBA as any)[key]).padStart(6));
  console.log("shot clock used at FGA (s):", (clkSum / clkN).toFixed(1), "(NBA ~12-14)  passes/poss:", (passes / (2 * T.poss)).toFixed(2), "(NBA ~3)");
  console.log(Object.entries(CTX).sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, e]]) => `${k}:${n} (${(e / n).toFixed(1)}s)`).join("  "));
  console.log(Object.entries(KS).map(([k, [n, m, c]]) => `${k}: ${n} att ${((100 * m) / n).toFixed(0)}% cw ${(c / n).toFixed(2)}`).join("  "));
  console.log("STAT", JSON.stringify(G.STAT), "FTA total", T.fta * 2);
  console.log("ORtg (pts/100 poss):", ((100 * T.pts) / T.teams / (T.poss / (T.teams / 2))).toFixed(1), "NBA 114.5");
})();
