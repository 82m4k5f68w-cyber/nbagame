// LIFE: fictional high-school and college programs (names, colours, deterministic rosters in the engine's roster
// tuple format), and a tiny league simulator for everybody else's results. DOM-free.
import { hashStr, mkRng, pick, rint, clamp, type Rng } from "./rng";
import type { Tuple } from "../core/data";

export interface Club {
  name: string; // "Northvale Owls"
  short: string; // "NVU"
  col: string;
  rt: number; // team strength (roster ratings centre)
  w: number;
  l: number;
}
/** High-school opponents (fictional towns). */
export const HS_TEAMS: [string, string, string][] = [
  ["Central High Comets", "CHS", "#1f6fd1"],
  ["Westbrook Wolves", "WBK", "#5b6270"],
  ["Pine Ridge Panthers", "PRP", "#1e7a46"],
  ["St. Albion Knights", "SAK", "#7a1f2b"],
  ["Harbor City Sharks", "HCS", "#0f7f8f"],
  ["Mesa Verde Coyotes", "MVC", "#c46a1c"],
];
/** College programs (fictional). The player's school is picked on Signing Day. */
export const COLLEGES: [string, string, string, number][] = [
  ["Northvale University Owls", "NVU", "#5a2d91", 88],
  ["Coastline State Mariners", "CSU", "#0c6fa8", 80],
  ["Redwood Tech Rangers", "RTR", "#2f6b2f", 74],
  ["Bayford College Herons", "BAY", "#c0392b", 70],
  ["Granite Peak Mountaineers", "GPU", "#6b7078", 78],
  ["Lakeshore A&M Lions", "LAM", "#d4a017", 84],
  ["Summit Valley Hawks", "SVH", "#0e2a5c", 76],
  ["Desert Sun Scorpions", "DSS", "#e06a1a", 72],
];
const FIRST = "Jalen Marcus Andre Tyrell Devin Isaiah Malik Cole Bryce Darius Jaylen Trey Xavier Owen Rashad Elijah Caleb Mason Zion Quentin Nolan Terrence Reggie Luca Mateo Kofi Emeka Theo Silas Jamal Kendrick Avery Dominic Rowan Ezra Felix Grady Hollis Ivan Jonah".split(" ");
const LAST = "Whitfield Okafor Brennan Castillo Hayes Mercer Pruitt Lindqvist Danvers Oyelaran Kincaid Ashby Delacroix Fontaine Graves Hollins Ibarra Jessup Kowalski Langford Moreau Nakamura Ortega Pemberton Quarles Redding Sorensen Thibodeaux Underwood Vance Wexler Yarbrough Zeller Abernathy Bellweather Crowder Dunleavy Eckhart Fairbanks Galloway".split(" ");
const SKINS = ["#f1c27d", "#c68642", "#8d5524", "#6b4226", "#e8b88f"];

/** A deterministic fictional player name. */
export function fakeName(r: Rng) {
  return pick(r, FIRST) + " " + pick(r, LAST);
}
/** Five starters (engine roster tuples) around rating centre rt, from the team name (same team = same roster). */
export function roster(name: string, rt: number): Tuple[] {
  const r = mkRng(hashStr("roster:" + name));
  const out: Tuple[] = [];
  const POSH = [6.2, 6.4, 6.6, 6.8, 6.95];
  for (let k = 0; k < 5; k++) {
    const big = k >= 3,
      v = () => clamp(Math.round(rt + (r() - 0.5) * 14), 40, 97),
      nm = fakeName(r).split(" ")[1];
    const c = big ? v() - 10 : v() + 2,
      i = big ? v() + 6 : v() - 2,
      s = big ? v() - 8 : v() + 4,
      d = v(),
      j = clamp(Math.round(rt - 15 + r() * 25 + (big ? 6 : 0)), 35, 90);
    out.push([nm, clamp(c, 35, 97), clamp(i, 35, 97), clamp(s, 35, 97), d, j, rint(r, 0, 4), pick(r, SKINS), rint(r, 0, 3), r() < 0.3 ? 1 : 0, +(POSH[k] + (r() - 0.5) * 0.25).toFixed(2), +(0.95 + r() * 0.25).toFixed(2), rint(r, 0, 55)]);
  }
  return out;
}
/** League table for a stage-year: the HS conference or the college conference, with the player's club first. */
export function makeLeague(stage: "hs" | "college", mine: string, seed: number): Club[] {
  const r = mkRng(seed);
  if (stage === "hs")
    return HS_TEAMS.map(([n, s, c], k) => ({ name: n, short: s, col: c, rt: n === mine ? 58 : 52 + Math.round(r() * 10), w: 0, l: 0 })).sort((a, b) => (a.name === mine ? -1 : b.name === mine ? 1 : 0));
  return COLLEGES.map(([n, s, c, p]) => ({ name: n, short: s, col: c, rt: Math.round(60 + (p - 70) * 0.5 + r() * 6), w: 0, l: 0 })).sort((a, b) => (a.name === mine ? -1 : b.name === mine ? 1 : 0));
}
/** One simulated game between two clubs: higher rating wins more often; returns [score a, score b]. */
export function simGame(a: { rt: number }, b: { rt: number }, r: Rng): [number, number] {
  const pa = 1 / (1 + Math.exp(-(a.rt - b.rt) / 6));
  const base = 58 + Math.floor(r() * 25),
    m = 1 + Math.floor(r() * 14);
  return r() < pa ? [base + m, base] : [base, base + m];
}
/** Points-per-game scale: the engine's arcade games are short, so lines are reported as they happened. */
export const shortOf = (name: string) => name.split(" ").slice(-1)[0];
