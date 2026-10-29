// My Player career: XP from every game he plays (offline, vs the CPU), levels that raise the attribute cap of the
// builder (more points to spend), and badge progress (badges come from ratings: the builder shows what the next one
// needs). Saved with the player in localStorage h2k_myp (MYP.d.xp / MYP.d.lv / MYP.d.gp / MYP.d.car).
import * as SV from "./save";
import { MYP, BADGE, QTRLEN, type Player } from "../core/sim";

export const LV_MAX = 30;
/** XP needed to go from level lv to lv + 1. */
export const xpNeed = (lv: number) => 300 + lv * 60;
/** Attribute points the builder allows at a level (380 at level 0, +3 a level). */
export const capOf = (d: any) => 380 + 3 * Math.min(LV_MAX, d.lv || 0);
/** Badge requirements as the builder shows them (the badges themselves are rating rules in sim.ts BADGE). */
export const BREQ: Record<string, string> = {
  DR: "3PT 88",
  PZ: "INSIDE 82 + JUMP 72",
  AB: "SPEED 84",
  LD: "DEFENSE 86",
  CL: "(3PT + INSIDE) / 2 ≥ 85",
  GC: "6'11\"+ and INSIDE 80 or DEFENSE 86",
};
/** Badges this build has (rating rules; the builder's own fields mapped onto a player-like object). */
export function myBadges(d: any) {
  const p = { n: d.n, c: d.c, i: d.i, s: d.s, d: d.d, j: d.j, ht: d.ht };
  return Object.keys(BADGE).filter((k) => BADGE[k][1](p as Player));
}
/** XP for one game: a base for playing, a win bonus, the stat line (scaled up for short quarters so a 1-minute-quarter
 *  game still pays) and shooting efficiency. Pure (tests call it). */
export function gameXP(s: any, won: boolean, pf = 0, ql = QTRLEN) {
  const k = Math.min(2, Math.max(0.75, 120 / Math.max(30, ql))),
    line = 4 * s.pts + 3 * s.reb + 5 * s.ast + 6 * s.blk + 6 * ((s.chg || 0) + (s.dv || 0) + (s.sa || 0)),
    eff = s.fga >= 4 ? Math.round((s.fgm / s.fga - 0.45) * 120) : 0;
  return Math.max(25, Math.round(60 + (won ? 80 : 0) + line * k + eff - pf * 4));
}
/** Add a game's XP to My Player (levels up as far as it goes) and keep a short career line. Returns what happened. */
export function awardXP(p: Player, won: boolean) {
  const d = MYP.d,
    xp = gameXP(p.stt, won, p.pf || 0),
    lv0 = d.lv || 0;
  d.xp = (d.xp || 0) + xp;
  d.lv = lv0;
  while (d.lv < LV_MAX && d.xp >= xpNeed(d.lv)) (d.xp -= xpNeed(d.lv)), d.lv++;
  if (d.lv >= LV_MAX) d.xp = Math.min(d.xp, xpNeed(LV_MAX));
  const c = (d.car = d.car || { gp: 0, w: 0, pts: 0, reb: 0, ast: 0, hi: 0 });
  c.gp++;
  if (won) c.w++;
  c.pts += p.stt.pts;
  c.reb += p.stt.reb;
  c.ast += p.stt.ast;
  c.hi = Math.max(c.hi, p.stt.pts);
  try {
    SV.set("h2k_myp", d);
  } catch (e) {}
  return { xp, lv0, lv1: d.lv, pts: 3 * (d.lv - lv0) };
}
/** Level / XP bar markup for the builder and the final screen. */
export function xpBar(d: any) {
  const lv = d.lv || 0,
    need = xpNeed(lv),
    f = lv >= LV_MAX ? 1 : Math.min(1, (d.xp || 0) / need);
  return `<div class="xpb" title="${lv >= LV_MAX ? "Max level" : (d.xp || 0) + " / " + need + " XP"}"><b>LEVEL ${lv}</b><span><i style="width:${(f * 100).toFixed(1)}%"></i></span><small>${lv >= LV_MAX ? "MAX" : (d.xp || 0) + " / " + need + " XP"}</small></div>`;
}
