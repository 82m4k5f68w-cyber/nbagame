// LIFE (MyLife) state machine - DOM-free so tests/life.ts can drive it in Node.
// Time is absolute game minutes since the life began (day = floor(t / 1440), weekday 0 = Monday).
// Stages: high-school senior -> college (4 years, or declare early) -> NBA Draft -> NBA seasons.
// Everything a save needs lives in one plain JSON object (Life); localStorage keys h2k_life_<slot>.
import { hashStr, mkRng, pick, clamp, rint, type Rng } from "./rng";
import { makeLeague, simGame, COLLEGES, HS_TEAMS, type Club } from "./teams";

export const LIFE_VER = 3;
export const DAY = 1440;
export type Stage = "hs" | "college" | "draft" | "nba";
export type Subj = "math" | "english" | "history" | "science" | "econ" | "psych" | "art" | "cs";
export const STAGE_N: Record<Stage, string> = { hs: "HS Senior", college: "College", draft: "Draft", nba: "NBA" };
export const STAGE_LEN: Record<"hs" | "college" | "nba", number> = { hs: 12, college: 14, nba: 14 };
export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const SLOT_T = [9 * 60, 10 * 60 + 30, 13 * 60]; // class start times
export const CLASS_LEN = 60;

/** Courses per level: [name, subject]; slot 2 alternates (Mon/Wed/Fri vs Tue/Thu). */
export const COURSES: [string, Subj][][] = [
  [["Algebra II", "math"], ["English 12", "english"], ["U.S. Government", "history"], ["Physics", "science"]],
  [["Calculus I", "math"], ["Composition 101", "english"], ["World History", "history"], ["Biology 101", "science"]],
  [["Statistics", "math"], ["Intro to Psychology", "psych"], ["Microeconomics", "econ"], ["Chemistry", "science"]],
  [["Calculus II", "math"], ["American Literature", "english"], ["Intro to Programming", "cs"], ["Art History", "art"]],
  [["Linear Algebra", "math"], ["Public Speaking", "english"], ["Sports Economics", "econ"], ["Kinesiology", "science"]],
];
/** Classroom building per subject (college); every high-school class is at Central High. */
export const ROOM_OF: Record<Subj, string> = { math: "hale", english: "wren", history: "hale", science: "lab", econ: "wren", psych: "lab", art: "wren", cs: "lab" };

export interface Score {
  k: "q" | "h" | "e"; // quiz (class), homework, exam
  v: number; // 0..100
  d: number; // day
}
export interface Course {
  n: string;
  sj: Subj;
  room: string;
  sc: Score[];
  hw: number; // homework due: day index of the next class, -1 none
  study: number; // library / tutor boost for the next quiz (0..1)
}
export type EvK = "class" | "exam" | "practice" | "game" | "draft" | "signing" | "visit" | "allstar";
export interface Ev {
  id: string;
  day: number;
  st: number; // start minute of day
  en: number;
  k: EvK;
  place: string;
  title: string;
  c?: number; // course index
  opp?: number; // league index (college / hs) or TM index (nba)
  home?: number;
  s: 0 | 1 | 2 | 3; // 0 upcoming, 1 done, 2 missed, 3 in progress
  arr?: number; // arrival (absolute minute)
  res?: GameRes;
  big?: string; // story tag: "state" (HS state playoffs), "mm" (March Madness), "rival"
  rd?: number; // tournament round (1 = first); a loss removes the later rounds
}
export interface GameRes {
  us: number;
  them: number;
  won: boolean;
  pts: number;
  reb: number;
  ast: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  hl: string[]; // highlight tags: dunk, gamewinner, airball, block, three, tech, foulout
  played: boolean;
  grade?: string;
}
export interface Contact {
  id: string;
  n: string;
  role: string;
  aff: number; // 0..100
  c: string; // avatar colour
}
export interface Msg {
  f: string; // contact id or "me"
  t: number;
  x: string;
  rep?: [string, string, number][]; // reply options: [text, reaction text, affinity change]
  rd?: number;
}
export interface Post {
  id: string;
  t: number;
  h: string; // handle (without @)
  n: string; // display name
  x: string;
  lk: number;
  rp: number;
  k: string; // kind: fan, hater, reporter, teammate, coach, brand, rival, analyst, meme, news, me
  me?: number;
  ai?: number;
  re?: Post[]; // replies
  v?: number; // verified
}
export interface Txn {
  t: number;
  x: string;
  a: number; // + income, - spending
}
export interface Line {
  gp: number;
  w: number;
  pts: number;
  reb: number;
  ast: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
}
export interface YearRec {
  stage: Stage;
  yr: number;
  team: string;
  line: Line;
  gpa: number | null;
  rec: string; // team record "W-L"
  aw: string[]; // awards
}
export interface LifeP {
  n: string;
  c: number;
  i: number;
  s: number;
  d: number;
  j: number;
  st: number;
  sk: string;
  hr: number;
  hs: number; // hair style override (look.ts sg.hs, -1 none)
  bd: number;
  ht: number;
  bk: number;
  no: number;
  col: string;
  pos: string; // PG..C
  xp: number;
  lv: number;
  sp: number; // unspent skill points
}
export interface Life {
  v: number;
  seed: number;
  slot: number;
  t: number;
  stage: Stage;
  yr: number; // stage year: hs 1, college 1..4, nba season 1..
  y0: number; // first day of this stage-year
  ylen: number;
  energy: number;
  hunger: number;
  mood: number;
  health: number; // 0..100 (injury below 40)
  money: number;
  followers: number;
  rep: number; // 0..100 public reputation
  fame: number;
  town: number; // hometown 0..2
  p: LifeP;
  courses: Course[];
  done: { n: string; pct: number; pts: number; yr: string }[]; // finished courses (transcript)
  cal: Ev[];
  contacts: Contact[];
  msgs: Record<string, Msg[]>;
  feed: Post[];
  tags: string[];
  txn: Txn[];
  inv: { outfits: string[]; items: Record<string, number> };
  outfit: string;
  school: string; // HS / college name
  team: { name: string; short: string; col: string; tm: number; w: number; l: number }; // tm: TM index in the NBA
  league: Club[];
  line: Line; // this stage-year
  career: Line;
  hist: YearRec[];
  log: { t: number; k: string; d: string }[]; // recent events (social / AI context)
  pend: string; // pending decision: "" | signing | declare | draft | grad
  flags: Record<string, number>;
  deals: { b: string; pay: number; t: number }[];
  visited: string[];
  pos: { x: number; z: number; f: number };
  offers: string[]; // college offers (names)
  draft: { pick: number; team: number; sal: number } | null;
  contract: { sal: number; yrs: number; team: number } | null;
  diet: string[]; // last meals (fast food streak)
  inj: { k: string; days: number } | null;
  notes: { t: number; x: string; ic: string }[]; // notification queue (drained by the UI)
  set: { spd: number; ql: number; diff: number; alarm: number; ai: number; big: number; cb: number; rm: number };
  major: string; // college major ("" = undeclared)
  agent: string; // NBA agent (AGENTS key, "" = none yet)
  story: string[]; // queued story cards (UI shows them when the player is free)
  fav: number; // team (TM index) that loved your pre-draft interview, -1 none
}

export const TOWNS = [
  { n: "Riverton", st: "the river city", c: "#2a7de1" },
  { n: "Ashgrove", st: "the old mill town", c: "#c0392b" },
  { n: "Bayport", st: "the harbor town", c: "#16a085" },
];
export const OUTFITS: Record<string, { n: string; col: string; $: number }> = {
  tee: { n: "Plain Tee", col: "#d9dde3", $: 0 },
  hoodie: { n: "Grey Hoodie", col: "#6b7078", $: 45 },
  black: { n: "All Black Fit", col: "#1a1a1f", $: 80 },
  sunset: { n: "Sunset Orange", col: "#e8541e", $: 60 },
  royal: { n: "Royal Blue Track", col: "#1f4fd1", $: 95 },
  mint: { n: "Mint Summer", col: "#3fbf8f", $: 70 },
  gold: { n: "Gold Chain Drip", col: "#d4a017", $: 220 },
  suit: { n: "Draft Night Suit", col: "#20263a", $: 450 },
};
export const FOODS: Record<string, { n: string; $: number; hu: number; en: number; mo: number; fast: number; place: string }> = {
  burrito: { n: "Barn Burrito", $: 9, hu: 55, en: 8, mo: 6, fast: 1, place: "burrito" },
  bowl: { n: "Protein Bowl", $: 12, hu: 60, en: 12, mo: 4, fast: 0, place: "burrito" },
  chips: { n: "Chips & Salsa", $: 4, hu: 15, en: 2, mo: 3, fast: 1, place: "burrito" },
  slice: { n: "Two Slices", $: 7, hu: 45, en: 5, mo: 7, fast: 1, place: "pizza" },
  pie: { n: "Whole Pie (share)", $: 18, hu: 70, en: 6, mo: 12, fast: 1, place: "pizza" },
  coffee: { n: "Cold Brew", $: 5, hu: 5, en: 22, mo: 4, fast: 0, place: "cafe" },
  bagel: { n: "Egg Bagel", $: 6, hu: 35, en: 8, mo: 3, fast: 0, place: "cafe" },
  smoothie: { n: "Berry Smoothie", $: 7, hu: 30, en: 14, mo: 5, fast: 0, place: "cafe" },
  salad: { n: "Grain Salad", $: 10, hu: 45, en: 14, mo: 2, fast: 0, place: "green" },
  wrap: { n: "Chicken Wrap", $: 9, hu: 50, en: 12, mo: 3, fast: 0, place: "green" },
  home: { n: "Home-cooked Dinner", $: 0, hu: 65, en: 10, mo: 8, fast: 0, place: "home" },
  dining: { n: "Dining Hall Plate", $: 0, hu: 60, en: 10, mo: 3, fast: 0, place: "dining" },
  drink: { n: "Volt Energy Drink", $: 4, hu: 0, en: 25, mo: 2, fast: 1, place: "mart" },
  bar: { n: "Protein Bar", $: 3, hu: 18, en: 6, mo: 1, fast: 0, place: "mart" },
};
export const WORKOUTS: Record<string, { n: string; k: keyof LifeP | "bk"; en: number; min: number }> = {
  shoot: { n: "Shooting reps", k: "c", en: 18, min: 60 },
  finish: { n: "Finishing & touch", k: "i", en: 20, min: 60 },
  speed: { n: "Speed & agility", k: "s", en: 24, min: 60 },
  defense: { n: "Defensive slides", k: "d", en: 22, min: 60 },
  jump: { n: "Plyometrics (vertical)", k: "j", en: 24, min: 60 },
  strength: { n: "Weight room (strength)", k: "bk", en: 22, min: 75 },
};

// ---------------------------------------------------------------- creation
export function newPlayer(o: Partial<LifeP> = {}): LifeP {
  return { n: "ROOKIE", c: 60, i: 58, s: 62, d: 54, j: 52, st: 0, sk: "#c68642", hr: 1, hs: -1, bd: 0, ht: 6.5, bk: 1, no: 1, col: "#d9dde3", pos: "SG", xp: 0, lv: 0, sp: 0, ...o };
}
/** Starting ratings for an archetype at high-school level. */
export const ARCH: Record<string, [string, number, number, number, number, number, number, number]> = {
  // name: [pos, c, i, s, d, j, st, height]
  Sharpshooter: ["SG", 68, 54, 62, 50, 50, 1, 6.4],
  Slasher: ["SF", 54, 66, 66, 52, 60, 0, 6.6],
  Playmaker: ["PG", 60, 58, 68, 54, 52, 3, 6.2],
  "Two-Way Wing": ["SF", 58, 58, 60, 62, 56, 0, 6.7],
  "Rim Protector": ["C", 44, 66, 50, 64, 62, 4, 6.95],
};
export function newLife(o: { seed?: number; slot?: number; p?: Partial<LifeP>; town?: number } = {}): Life {
  const seed = (o.seed ?? (Date.now() & 0x7fffffff)) >>> 0,
    town = o.town ?? 0;
  const school = TOWNS[town].n + " Central";
  const L: Life = {
    v: LIFE_VER,
    seed,
    slot: o.slot ?? 0,
    t: 7 * 60 + 30,
    stage: "hs",
    yr: 1,
    y0: 0,
    ylen: STAGE_LEN.hs,
    energy: 90,
    hunger: 70,
    mood: 70,
    health: 100,
    money: 150,
    followers: 120,
    rep: 30,
    fame: 0,
    town,
    p: newPlayer(o.p),
    courses: [],
    done: [],
    cal: [],
    contacts: [],
    msgs: {},
    feed: [],
    tags: [],
    txn: [{ t: 0, x: "Birthday money from Grandma", a: 150 }],
    inv: { outfits: ["tee"], items: {} },
    outfit: "tee",
    school,
    team: { name: HS_TEAMS[0][0], short: HS_TEAMS[0][1], col: HS_TEAMS[0][2], tm: -1, w: 0, l: 0 },
    league: [],
    line: zl(),
    career: zl(),
    hist: [],
    log: [],
    pend: "",
    flags: { tut: 0 },
    deals: [],
    visited: ["home", "hs", "arena"],
    pos: { x: 0, z: 0, f: 0 },
    offers: [],
    draft: null,
    contract: null,
    diet: [],
    inj: null,
    notes: [],
    set: { spd: 1, ql: 60, diff: -1, alarm: 7 * 60, ai: 1, big: 0, cb: 0, rm: 0 },
    major: "",
    agent: "",
    story: [],
    fav: -1,
  };
  L.p.col = OUTFITS.tee.col;
  L.contacts = [
    { id: "mom", n: "Mom", role: "Family", aff: 80, c: "#e86a9a" },
    { id: "coach", n: "Coach Rivera", role: "HS Coach", aff: 60, c: "#3a7bd5" },
    { id: "dre", n: "Dre Mills", role: "Best friend", aff: 75, c: "#f39c12" },
    { id: "tm1", n: "Kofi Banks", role: "Teammate", aff: 55, c: "#16a085" },
    { id: "prof", n: "Ms. Okafor", role: "Counselor", aff: 50, c: "#8e44ad" },
    { id: "rival", n: "Jace Holloway", role: "Rival", aff: 20, c: "#c0392b" },
  ];
  beginYear(L);
  msg(L, "mom", "Morning sweetheart! First day of senior year. Breakfast is on the counter. Love you ❤️", [["Love you too!", "😘", 3], ["Running late, thanks Mom", "Don't forget your lunch!", 1]]);
  msg(L, "coach", "Big year. Classes first, then practice at 3:30 in the arena. Grades below a 2.0 and you sit. No exceptions.", [["Yes coach.", "Good.", 3], ["I'll be there 💪", "Show me.", 2]]);
  msg(L, "dre", "yo you hooping at The Cage later? 🏀", [["bet, after practice", "say less", 3], ["can't, homework", "nerd 😂", 0]]);
  logE(L, "start", "senior year begins at " + school);
  return L;
}
export const zl = (): Line => ({ gp: 0, w: 0, pts: 0, reb: 0, ast: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 });

// ---------------------------------------------------------------- clock helpers
export const dayOf = (t: number) => Math.floor(t / DAY);
export const minOf = (t: number) => ((t % DAY) + DAY) % DAY;
export const wdOf = (d: number) => ((d % 7) + 7) % 7;
export const hhmm = (m: number) => {
  m = ((Math.round(m) % DAY) + DAY) % DAY;
  const h = Math.floor(m / 60),
    mm = m % 60,
    h12 = h % 12 || 12;
  return h12 + ":" + String(mm).padStart(2, "0") + (h < 12 ? " AM" : " PM");
};
export const dateStr = (L: Life, d = dayOf(L.t)) => `${WD[wdOf(d)]} · Day ${d - L.y0 + 1}/${L.ylen}`;
/** Course level (question difficulty / course list): HS 0, college years 1..4. */
export const level = (L: Life) => (L.stage === "hs" ? 0 : L.stage === "college" ? clamp(L.yr, 1, 4) : 4);
export const ovrOf = (p: { c: number; i: number; s: number; d: number; j: number }) => Math.round(p.c * 0.26 + p.i * 0.26 + p.s * 0.18 + p.d * 0.18 + p.j * 0.12);

export function logE(L: Life, k: string, d: string) {
  L.log.push({ t: L.t, k, d });
  if (L.log.length > 40) L.log.splice(0, L.log.length - 40);
}
export function note(L: Life, x: string, ic = "🔔") {
  L.notes.push({ t: L.t, x, ic });
  if (L.notes.length > 20) L.notes.shift();
}
export function msg(L: Life, from: string, x: string, rep?: [string, string, number][]) {
  const th = (L.msgs[from] = L.msgs[from] || []);
  th.push({ f: from, t: L.t, x, rep });
  if (th.length > 60) th.splice(0, th.length - 60);
  const c = L.contacts.find((c) => c.id === from);
  note(L, (c ? c.n : from) + ": " + x, "💬");
}
/** Answer a message's reply option k: my text + their reaction; affinity moves. */
export function reply(L: Life, from: string, k: number) {
  const th = L.msgs[from] || [],
    m = [...th].reverse().find((m) => m.rep && m.rep.length);
  if (!m || !m.rep || !m.rep[k]) return false;
  const [mine, back, da] = m.rep[k];
  m.rep = undefined;
  th.push({ f: "me", t: L.t, x: mine, rd: 1 });
  th.push({ f: from, t: L.t + 1, x: back, rd: 1 });
  const c = L.contacts.find((c) => c.id === from);
  if (c) c.aff = clamp(c.aff + da, 0, 100);
  return true;
}
export const unread = (L: Life) => Object.values(L.msgs).reduce((a, th) => a + th.filter((m) => m.f !== "me" && !m.rd).length, 0);
export function money(L: Life, a: number, x: string) {
  L.money = Math.round((L.money + a) * 100) / 100;
  L.txn.push({ t: L.t, x, a });
  if (L.txn.length > 120) L.txn.splice(0, L.txn.length - 120);
}

// ---------------------------------------------------------------- schedule
const GAME_DAYS: Record<string, number[]> = { hs: [1, 3, 5, 8, 10], college: [1, 3, 5, 8, 10, 12], nba: [1, 3, 5, 8, 10, 12] };
/** Tournament rounds at the end of a season: HS state playoffs (2), college March Madness (3). */
export const ROUNDS: Record<string, string[]> = { state: ["STATE SEMIFINAL", "STATE FINAL"], mm: ["ELITE EIGHT", "FINAL FOUR", "NATIONAL TITLE"], po: ["CONFERENCE SEMIFINALS", "CONFERENCE FINALS", "NBA FINALS"] };
/** Fictional agents: fee (share of salary), contract and endorsement multipliers, reputation effect. */
export const AGENTS: Record<string, { style: string; fee: number; con: number; deal: number; rep: number; c: string }> = {
  "Dana Cole": { style: "Steady: fair deals, no drama", fee: 0.03, con: 1, deal: 1, rep: 1, c: "#2c3e50" },
  "Max Sterling": { style: "Shark: squeezes every dollar out of contracts", fee: 0.05, con: 1.12, deal: 1, rep: -2, c: "#8e1b1b" },
  "Priya Vance": { style: "Brand builder: endorsements, magazine covers", fee: 0.05, con: 1, deal: 1.25, rep: 2, c: "#7d3c98" },
};
export const TAX = 0.3;
export const MAJORS: Record<string, string> = {
  Business: "Endorsement deals pay 10% more",
  Kinesiology: "Workouts build 10% more",
  Communications: "Games earn 10% more followers",
  Education: "+3% on every class quiz",
  "Computer Science": "+5 on every homework",
};
/** Build this stage-year's courses + calendar (deterministic from the seed, stage and year). */
export function beginYear(L: Life) {
  const r = mkRng(hashStr(L.seed + ":" + L.stage + ":" + L.yr));
  L.cal = [];
  L.line = zl();
  L.team.w = L.team.l = 0;
  const lvl = level(L),
    y0 = L.y0,
    n = (L.ylen = L.stage === "nba" ? STAGE_LEN.nba : L.stage === "college" ? STAGE_LEN.college : STAGE_LEN.hs);
  if (L.stage === "hs" || L.stage === "college") {
    L.courses = COURSES[lvl].map(([nm, sj]) => ({ n: nm, sj, room: L.stage === "hs" ? "hs" : ROOM_OF[sj], sc: [], hw: -1, study: 0 }));
    L.league = makeLeague(L.stage, L.team.name, hashStr(L.seed + "lg" + L.yr));
  } else {
    L.courses = [];
    // NBA table: your team first, the rest of the league after it
    const nr = mkRng(hashStr(L.seed + "nba" + L.yr));
    L.league = NBA_NAMES.map((n, i) => ({ name: n, short: n.slice(0, 3).toUpperCase(), col: "#1d428a", rt: 60 + Math.round(nr() * 6), w: 0, l: 0, i })).sort((a, b) => (a.i === L.team.tm ? -1 : b.i === L.team.tm ? 1 : 0)).map(({ i, ...c }) => c);
  }
  const gd = GAME_DAYS[L.stage === "nba" ? "nba" : L.stage === "college" ? "college" : "hs"];
  // finals: the last weekday at least 3 days before the year wraps; midterms (college): first weekday past halfway
  let examDay = n - 3;
  while (examDay > 0 && wdOf(y0 + examDay) >= 5) examDay--;
  let midDay = Math.floor(n / 2);
  while (midDay < examDay - 1 && wdOf(y0 + midDay) >= 5) midDay++;
  if (L.stage !== "college") midDay = -1;
  for (let d = 0; d < n; d++) {
    const day = y0 + d,
      wd = wdOf(day),
      game = gd.includes(d);
    if (L.courses.length && wd < 5) {
      const ex = d === examDay || d === midDay;
      for (let s = 0; s < 3; s++) {
        const ci = s < 2 ? s : wd % 2 === 0 ? 2 : 3,
          c = L.courses[ci];
        L.cal.push({ id: `c${day}_${s}`, day, st: SLOT_T[s], en: SLOT_T[s] + CLASS_LEN, k: ex ? "exam" : "class", place: c.room, title: (d === examDay ? "FINAL: " : d === midDay ? "MIDTERM: " : "") + c.n, c: ci, s: 0 });
      }
    }
    if (!game && wd < 6 && L.stage !== "draft")
      L.cal.push(
        L.stage === "nba"
          ? { id: `p${day}`, day, st: 10 * 60, en: 11 * 60 + 30, k: "practice", place: "arena", title: "Team practice", s: 0 }
          : { id: `p${day}`, day, st: 15 * 60 + 30, en: 17 * 60, k: "practice", place: "arena", title: "Team practice", s: 0 },
      );
    if (game) {
      const gi = gd.indexOf(d),
        nOpp = L.stage === "nba" ? 14 : L.league.length;
      let opp = L.stage === "nba" ? (L.team.tm + 1 + rint(r, 0, 12)) % 14 : 1 + ((gi + rint(r, 0, nOpp - 2)) % (nOpp - 1));
      if (L.stage === "nba" && opp === L.team.tm) opp = (opp + 1) % 14;
      const big = L.stage === "hs" ? "state" : L.stage === "college" ? "mm" : L.stage === "nba" ? "po" : "",
        nr = big ? ROUNDS[big].length : 0,
        rd = big && gi >= gd.length - nr ? gi - (gd.length - nr) + 1 : 0;
      L.cal.push({ id: `g${day}`, day, st: wd >= 5 ? 14 * 60 : 19 * 60, en: (wd >= 5 ? 14 : 19) * 60 + 120, k: "game", place: "arena", title: rd ? ROUNDS[big][rd - 1] : "Game", opp, home: gi % 2 === 0 ? 1 : 0, s: 0, big: rd ? big : undefined, rd: rd || undefined });
    }
  }
  if (L.stage === "nba") {
    let asd = y0 + 6;
    while (gd.includes(asd - y0)) asd++;
    L.cal.push({ id: `as${asd}`, day: asd, st: 20 * 60, en: 22 * 60, k: "allstar", place: "arena", title: "ALL-STAR GAME", s: 0 });
    L.story.push("role");
    const last = L.hist[L.hist.length - 1];
    if (last && last.stage === "nba" && last.aw.includes("NBA Champions")) L.story.unshift("ring");
  }
  L.cal.sort((a, b) => a.day - b.day || a.st - b.st);
}
/** Window in which an event can be joined at its place: [open, close) absolute minutes. */
export function evWin(e: Ev): [number, number] {
  const s = e.day * DAY + e.st;
  if (e.k === "game" || e.k === "allstar") return [s - 120, s + 30];
  if (e.k === "practice") return [s - 30, s + 45];
  if (e.k === "draft") return [s - 240, s + 600];
  return [s - 20, s + 30];
}
/** The event that can be joined at this place right now. */
export function evAt(L: Life, place: string): Ev | null {
  for (const e of L.cal) {
    if (e.s !== 0 || e.place !== place) continue;
    const [a, b] = evWin(e);
    if (L.t >= a && L.t < b) return e;
  }
  return null;
}
/** Next upcoming (not finished) event. */
export function nextEv(L: Life): Ev | null {
  for (const e of L.cal) if (e.s === 0 && evWin(e)[1] > L.t) return e;
  return null;
}
export const evStart = (e: Ev) => e.day * DAY + e.st;
/** Lateness: minutes after the start and the multiplier it costs a class quiz. */
export function lateness(e: Ev, at: number): { min: number; mul: number; tag: string } {
  const m = Math.max(0, at - evStart(e));
  if (m <= 5) return { min: m, mul: 1, tag: m > 0 ? "just in time" : "on time" };
  if (m <= 15) return { min: m, mul: 0.9, tag: "late" };
  return { min: m, mul: 0.75, tag: "very late" };
}

// ---------------------------------------------------------------- time + needs
export type Act = "idle" | "walk" | "sprint" | "class" | "game" | "workout" | "sleep" | "drive";
const DRAIN: Record<Act, number> = { idle: 2.5, walk: 3.5, sprint: 10, class: 3, game: 0, workout: 0, sleep: -12.5, drive: 2 };
/** Advance the clock by `min` game minutes doing `act`: needs drift, missed events are resolved. */
export function advance(L: Life, min: number, act: Act = "idle") {
  if (min <= 0) return;
  const h = min / 60,
    starving = L.hunger < 15;
  L.t += min;
  L.hunger = clamp(L.hunger - (act === "sleep" ? 2 : 6) * h, 0, 100);
  L.energy = clamp(L.energy - DRAIN[act] * h * (starving && act !== "sleep" ? 1.5 : 1), 0, 100);
  const tgt = 60 + (L.hunger < 25 ? -20 : 0) + (L.energy < 20 ? -15 : 0) + (L.inj ? -10 : 0) + clamp((L.followers > 1e4 ? 5 : 0), 0, 5);
  L.mood = clamp(L.mood + (tgt - L.mood) * Math.min(1, h * 0.08), 0, 100);
  if (act !== "sleep" && L.health < 100 && !L.inj) L.health = clamp(L.health + 1.5 * h, 0, 100);
  resolve(L);
}
/** Mark events whose window closed as missed (with consequences); roll the year over when it ends. */
export function resolve(L: Life) {
  for (const e of L.cal) {
    if (e.s !== 0) continue;
    if (L.t < evWin(e)[1]) continue;
    e.s = 2;
    miss(L, e);
  }
  if (!L.pend && dayOf(L.t) >= L.y0 + L.ylen) endYear(L);
}
function miss(L: Life, e: Ev) {
  if (e.k === "class" || e.k === "exam") {
    const c = L.courses[e.c!];
    if (c) c.sc.push({ k: e.k === "exam" ? "e" : "q", v: 0, d: e.day });
    logE(L, "skip", "skipped " + e.title);
    note(L, "Absent: " + e.title + " (0 recorded)", "📕");
    if (L.stage !== "nba" && Math.random() < 0.5) {
      const co = L.contacts.find((c) => c.id === "coach");
      if (co) co.aff = clamp(co.aff - 4, 0, 100);
      msg(L, "coach", "Heard you skipped " + e.title + ". You represent this team in the classroom too.", [["My bad coach, won't happen again", "It better not.", 2], ["I was tired", "So is everybody.", -2]]);
    }
  } else if (e.k === "practice") {
    const co = L.contacts.find((c) => c.id === "coach");
    if (co) co.aff = clamp(co.aff - 8, 0, 100);
    logE(L, "skip", "missed practice");
    msg(L, "coach", "Where were you at practice? Minutes are earned.", [["Sorry coach, lost track of time", "Be early next time.", 2], ["Had stuff to do", "Then don't expect to start.", -4]]);
  } else if (e.k === "game") {
    simTeamGame(L, e, null);
    L.rep = clamp(L.rep - 4, 0, 100);
    logE(L, "dnp", "missed the game vs " + oppName(L, e));
    msg(L, "coach", "You missed the game. We'll talk tomorrow.", [["I'm sorry coach", "We'll talk.", 1], ["...", "...", -2]]);
  }
}
/** Coach trust -> role: starter (55+), sixth man (35+), bench. Simulated lines scale with it. */
export function role(L: Life): { n: string; k: number } {
  const a = (L.contacts.find((c) => c.id === "coach") || { aff: 50 }).aff;
  return a >= 55 ? { n: "Starter", k: 1 } : a >= 35 ? { n: "Sixth man", k: 0.8 } : { n: "Bench", k: 0.55 };
}
/** The opponent's row in the league table. */
export function oppClub(L: Life, e: Ev): Club | null {
  if (L.stage === "nba") return L.league.find((c) => c.name === NBA_NAMES[e.opp ?? 0]) || null;
  return L.league[e.opp ?? 1] || null;
}
/** League table sorted by win% (ties: wins), with your rank. */
export function standings(L: Life): { rows: Club[]; me: number } {
  const rows = L.league.slice().sort((a, b) => b.w / Math.max(1, b.w + b.l) - a.w / Math.max(1, a.w + a.l) || b.w - a.w || b.rt - a.rt);
  return { rows, me: rows.indexOf(L.league[0]) + 1 };
}
/** Opponent display name of a game event. */
export function oppName(L: Life, e: Ev): string {
  if (L.stage === "nba") return NBA_NAMES[e.opp ?? 0] || "Opponent";
  return (L.league[e.opp ?? 1] || { name: "Opponent" }).name;
}
/** NBA team names (index = TM index in core/data.ts; filled by the client from TM, tests use the defaults). */
export const NBA_NAMES: string[] = ["Lakers", "Warriors", "Nuggets", "Thunder", "Spurs", "Celtics", "Knicks", "Bucks", "Mavericks", "Cavaliers", "Rockets", "Pistons", "Magic", "Timberwolves"];

/** Sleep from now until the alarm (next morning; or `hrs` for a nap). Returns hours slept. */
export function sleep(L: Life, hrs?: number): number {
  const m = minOf(L.t);
  let mins: number;
  if (hrs != null) mins = hrs * 60;
  else {
    const alarm = L.set.alarm || 7 * 60;
    mins = (alarm - m + DAY) % DAY;
    if (mins < 180) mins += DAY; // a sleep is at least ~3 h; otherwise the next alarm
    if (mins > 12 * 60) mins = 8 * 60; // going to bed in the morning / afternoon: an 8-hour sleep, not a 20-hour one
  }
  const e0 = L.energy;
  // quality: late nights and an empty stomach sleep worse
  const q = (m >= 22 * 60 || m < 60 ? 1 : 0.9) * (L.hunger < 20 ? 0.85 : 1);
  advance(L, mins, "sleep");
  L.energy = clamp(e0 + (mins / 60) * 12.5 * q, 0, 100);
  L.mood = clamp(L.mood + 5, 0, 100);
  if (L.inj) {
    L.inj.days -= Math.max(1, Math.round(mins / DAY + 0.4));
    if (L.inj.days <= 0) {
      note(L, "Cleared to play: " + L.inj.k + " healed", "💚");
      L.inj = null;
      L.health = Math.max(L.health, 80);
    }
  }
  dailyTick(L);
  return mins / 60;
}
/** Things that happen once a morning: payday, endorsement checks, league results, scripted texts. */
export function dailyTick(L: Life) {
  const d = dayOf(L.t);
  if (L.flags.lastDay === d) return;
  L.flags.lastDay = d;
  // salary (NBA: weekly on Fridays), endorsement deals (weekly on Mondays)
  if (L.stage === "nba" && L.contract && wdOf(d) === 4) {
    const gross = L.contract.sal / 26,
      fee = (AGENTS[L.agent] || { fee: 0 }).fee;
    money(L, Math.round(gross * (1 - TAX - fee)), `Paycheck · ${NBA_NAMES[L.contract.team] || "team"} (after ${Math.round(TAX * 100)}% tax${fee ? " + " + Math.round(fee * 100) + "% agent" : ""})`);
  }
  if (wdOf(d) === 0) for (const dl of L.deals) money(L, dl.pay, "Endorsement · " + dl.b);
  // trade-deadline chatter (NBA): rumours feed Hoopr
  if (L.stage === "nba" && (d - L.y0) % 5 === 2) logE(L, "rumor", pick(mkRng(d + L.seed), ["trade rumours swirl around the " + L.team.name, "scouts from three teams at practice", "front office 'listening to offers'"]));
  // trade request: the front office finds a deal a few days later
  if (L.stage === "nba" && L.flags.treq && d >= L.y0 + 3) {
    const r = mkRng(hashStr("trade" + d + L.seed));
    let tm = rint(r, 0, 13);
    if (tm === L.team.tm) tm = (tm + 5) % 14;
    tradeTo(L, tm);
  }
  // All-Star selection (NBA, the morning of the All-Star game): your numbers or your fans get you in
  const asg = L.cal.find((e) => e.k === "allstar" && e.day === d && e.s === 0);
  if (asg) {
    const ppg = L.line.gp ? L.line.pts / L.line.gp : 0;
    if (ppg >= 12 || L.followers >= 60000) {
      L.story.push("allstar");
      logE(L, "allstar", "named an All-Star");
      msg(L, "agent", "You're an ALL-STAR. Tonight, 8 PM, Summit Arena. Wear something nice. 🌟");
    } else {
      L.cal = L.cal.filter((e) => e !== asg);
      note(L, "All-Star rosters are out. Not this year.", "⭐");
    }
  }
  simLeagueDay(L, d - 1);
  let ev = L.cal.filter((e) => e.day === d && e.s === 0);
  // tournament qualification: a losing record misses the playoffs / March Madness
  const r1 = ev.find((e) => e.k === "game" && e.rd === 1);
  if (r1 && L.team.w < L.team.l) {
    L.cal = L.cal.filter((e) => !(e.big === r1.big && e.s === 0));
    ev = ev.filter((e) => e !== r1);
    msg(L, "coach", r1.big === "mm" ? "We didn't make the tournament. That one stings. Use it." : "We missed the state playoffs. Next year starts today.");
    logE(L, "elim", "missed the " + (r1.big === "mm" ? "tournament" : "state playoffs"));
  }
  const g = ev.find((e) => e.k === "game");
  if (g) msg(L, "coach", `Game day. ${oppName(L, g)} at ${hhmm(g.st)}. Be at the arena early.${probation(L) ? " ...if you were eligible." : ""}`, [["Locked in 🔒", "That's what I like to hear.", 2], ["Ready coach", "Let's go.", 1]]);
  else if (ev.some((e) => e.k === "exam")) msg(L, "prof", "Finals today. Eat breakfast, get there early, breathe. You've got this.", [["Thanks!", "Good luck!", 2]]);
  if (d % 4 === 2 && L.stage !== "nba") msg(L, "mom", pick(mkRng(d * 7 + L.seed), ["Are you eating vegetables or just burritos? 😅", "Proud of you. Call me this weekend!", "Don't stay up too late, okay?", "Your aunt saw you on Hoopr! 😂"]), [["Love you Mom", "❤️", 2], ["Yes Mom 🙄", "Don't you roll your eyes at me", 0]]);
  if (d % 5 === 3) msg(L, "dre", pick(mkRng(d * 13 + L.seed), ["pickup at The Cage tonight? 🏀", "you see that dunk on Hoopr last night lol", "Burrito Barn after? I'm starving", "bro you're getting famous fr"]), [["I'm down", "bet 🤝", 3], ["maybe later", "aight", 0]]);
}
/** Other teams' results for one day (league table + news log). */
export function simLeagueDay(L: Life, d: number) {
  if (!L.league.length) return;
  const r = mkRng(hashStr(L.seed + "lday" + d));
  if (r() < 0.45) return;
  const idx = L.league.map((_, i) => i).slice(1);
  for (let k = 0; k + 1 < idx.length; k += 2) {
    const a = L.league[idx[(k + d) % idx.length]],
      b = L.league[idx[(k + 1 + d) % idx.length]];
    if (a === b) continue;
    const [sa, sb] = simGame(a, b, r);
    if (sa > sb) a.w++, b.l++;
    else b.w++, a.l++;
    if (k === 0) logE(L, "news", `${a.name} ${sa}, ${b.name} ${sb}`);
  }
}

// ---------------------------------------------------------------- actions
export function eat(L: Life, id: string): string | null {
  const f = FOODS[id];
  if (!f) return "Unknown item";
  if (L.money < f.$) return "Not enough money";
  if (f.$) money(L, -f.$, f.n);
  // eating the same fast food again and again: less energy from it (diet)
  const streak = L.diet.slice(-4).filter((x) => FOODS[x] && FOODS[x].fast).length;
  L.hunger = clamp(L.hunger + f.hu, 0, 100);
  L.energy = clamp(L.energy + f.en * (f.fast && streak >= 3 ? 0.4 : 1), 0, 100);
  L.mood = clamp(L.mood + f.mo, 0, 100);
  L.diet.push(id);
  if (L.diet.length > 12) L.diet.shift();
  if (f.fast && streak >= 3) note(L, "Too much fast food lately: you feel sluggish", "🍔");
  advance(L, id === "drink" || id === "bar" || id === "coffee" ? 5 : 25, "idle");
  logE(L, "eat", f.n);
  return null;
}
/** Gym workout: ratings rise with diminishing returns (harder the higher it is), costs energy and time. */
export const gainOf = (v: number, rt = 1) => Math.max(0.15, 2.4 * Math.pow(Math.max(0, (99 - v) / 60), 1.6) * rt);
export function workout(L: Life, id: string): { err?: string; k?: string; g?: number; inj?: string } {
  const w = WORKOUTS[id];
  if (!w) return { err: "Unknown workout" };
  if (L.inj) return { err: "Injured: rehab only (" + L.inj.k + ")" };
  if (L.energy < w.en * 0.6) return { err: "Too tired - eat or sleep first" };
  const d = dayOf(L.t),
    key = "wo" + d + id;
  const reps = (L.flags[key] = (L.flags[key] || 0) + 1);
  const rt = (L.energy < 35 ? 0.6 : 1) * (reps > 2 ? 0.3 : 1) * (L.major === "Kinesiology" ? 1.1 : 1);
  let g = 0;
  if (w.k === "bk") {
    g = +(0.01 * rt).toFixed(3);
    L.p.bk = clamp(+(L.p.bk + g).toFixed(3), 0.9, 1.35);
  } else {
    const k = w.k as "c" | "i" | "s" | "d" | "j",
      v = L.p[k] as number;
    g = +gainOf(v, rt).toFixed(2);
    (L.p as any)[k] = Math.min(99, +(v + g).toFixed(2));
  }
  L.energy = clamp(L.energy - w.en, 0, 100);
  L.mood = clamp(L.mood + 3, 0, 100);
  advance(L, w.min, "idle");
  // overtraining: a third session in a day on low energy can tweak something
  const sess = Object.keys(L.flags).filter((k) => k.startsWith("wo" + d)).reduce((a, k) => a + L.flags[k], 0);
  if (sess >= 3 && L.energy < 30 && mkRng(hashStr(key + reps + L.seed))() < 0.35) {
    injure(L, pick(mkRng(L.t), ["Sprained ankle", "Tight hamstring", "Sore back"]), 2);
    return { k: w.k as string, g, inj: L.inj!.k };
  }
  logE(L, "workout", w.n);
  return { k: w.k as string, g };
}
export function injure(L: Life, k: string, days: number) {
  L.inj = { k, days };
  L.health = 35;
  note(L, "Injured: " + k + " (" + days + " days)", "🩹");
  logE(L, "injury", k);
}
export function buyOutfit(L: Life, id: string): string | null {
  const o = OUTFITS[id];
  if (!o) return "Unknown";
  if (L.inv.outfits.includes(id)) return null;
  if (L.money < o.$) return "Not enough money";
  money(L, -o.$, "Threads · " + o.n);
  L.inv.outfits.push(id);
  logE(L, "outfit", "bought the " + o.n);
  advance(L, 15);
  return null;
}
export function wear(L: Life, id: string) {
  if (!L.inv.outfits.includes(id)) return false;
  L.outfit = id;
  L.p.col = OUTFITS[id].col;
  return true;
}

// ---------------------------------------------------------------- classes, grades, GPA
/** Join a class / exam: marks arrival; returns lateness. */
export function attend(L: Life, e: Ev) {
  e.s = 3;
  e.arr = L.t;
  return lateness(e, L.t);
}
/** Finish a class with the quiz fraction correct (0..1); late arrival scales it. Returns the recorded score. */
export function finishClass(L: Life, e: Ev, frac: number): number {
  const c = L.courses[e.c!],
    lt = lateness(e, e.arr ?? L.t);
  const v = Math.round(clamp(frac + (L.major === "Education" ? 0.03 : 0), 0, 1) * 100 * lt.mul);
  if (c) {
    c.sc.push({ k: e.k === "exam" ? "e" : "q", v, d: e.day });
    c.study = 0;
    // homework for the next class of this course
    const nx = L.cal.find((x) => x.c === e.c && x.day > e.day && (x.k === "class" || x.k === "exam"));
    if (nx && e.k === "class") {
      if (c.hw >= 0 && c.hw <= e.day) c.sc.push({ k: "h", v: 0, d: e.day }); // the last one was never turned in
      c.hw = nx.day;
    }
  }
  e.s = 1;
  advance(L, Math.max(0, evStart(e) + CLASS_LEN - L.t), "class");
  logE(L, e.k === "exam" ? "exam" : "class", `${e.title}: ${v}%${lt.tag !== "on time" && lt.tag !== "just in time" ? " (" + lt.tag + ")" : ""}`);
  return v;
}
export function doHomework(L: Life, ci: number, frac: number): number {
  const c = L.courses[ci];
  if (!c || c.hw < 0) return -1;
  const v = Math.round(clamp(frac * 100 + (L.major === "Computer Science" ? 5 : 0), 0, 100));
  c.sc.push({ k: "h", v, d: dayOf(L.t) });
  c.hw = -1;
  advance(L, 45, "idle");
  return v;
}
/** Study at the library / with a tutor: +boost for the next quiz of that course. */
export function study(L: Life, ci: number, tutor = false): string | null {
  const c = L.courses[ci];
  if (!c) return "No course";
  if (tutor) {
    if (L.money < 25) return "A tutor costs $25";
    money(L, -25, "Tutor session · " + c.n);
  }
  c.study = clamp(c.study + (tutor ? 0.5 : 0.3), 0, 1);
  advance(L, tutor ? 60 : 90, "idle");
  L.energy = clamp(L.energy - 6, 0, 100);
  return null;
}
/** Group study with a friend: every course gets a smaller boost, the friendship grows. */
export function groupStudy(L: Life, friend: string): string | null {
  if (!L.courses.length) return "No classes";
  const c = L.contacts.find((x) => x.id === friend);
  if (!c) return "Nobody to study with";
  for (const k of L.courses) k.study = clamp(k.study + 0.2, 0, 1);
  c.aff = clamp(c.aff + 3, 0, 100);
  L.mood = clamp(L.mood + 4, 0, 100);
  L.energy = clamp(L.energy - 5, 0, 100);
  advance(L, 90, "idle");
  logE(L, "study", "group study with " + c.n);
  return null;
}
export function chooseMajor(L: Life, m: string) {
  if (!MAJORS[m]) return false;
  L.major = m;
  logE(L, "major", "declared a " + m + " major");
  return true;
}
const W: Record<string, number> = { q: 0.5, h: 0.2, e: 0.3 };
/** Course percentage: category averages weighted quiz 50 / homework 20 / exam 30, renormalised over present ones. */
export function coursePct(c: Course): number | null {
  let s = 0,
    w = 0;
  for (const k of ["q", "h", "e"]) {
    const a = c.sc.filter((x) => x.k === k);
    if (!a.length) continue;
    s += (W[k] * a.reduce((t, x) => t + x.v, 0)) / a.length;
    w += W[k];
  }
  return w ? s / w : null;
}
const LETTERS: [number, string, number][] = [
  [93, "A", 4],
  [90, "A-", 3.7],
  [87, "B+", 3.3],
  [83, "B", 3],
  [80, "B-", 2.7],
  [77, "C+", 2.3],
  [73, "C", 2],
  [70, "C-", 1.7],
  [67, "D+", 1.3],
  [63, "D", 1],
  [60, "D-", 0.7],
  [0, "F", 0],
];
export function letter(pct: number): [string, number] {
  for (const [m, l, p] of LETTERS) if (pct >= m) return [l, p];
  return ["F", 0];
}
/** Cumulative GPA over finished courses + the current term's graded courses (equal credits). null = nothing graded. */
export function gpa(L: Life, termOnly = false): number | null {
  const pts: number[] = termOnly ? [] : L.done.map((d) => d.pts);
  for (const c of L.courses) {
    const p = coursePct(c);
    if (p != null) pts.push(letter(p)[1]);
  }
  if (!pts.length) return null;
  return Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100) / 100;
}
/** Academic probation: GPA below 2.0 once at least 3 grades are in this term (no day-one probation). */
export function probation(L: Life): boolean {
  if (L.stage === "nba" || L.stage === "draft") return false;
  const n = L.courses.reduce((a, c) => a + c.sc.length, 0);
  if (n < 3 && !L.done.length) return false;
  const g = gpa(L);
  return g != null && g < 2;
}

// ---------------------------------------------------------------- games
export const DIFF_OF: Record<Stage, number> = { hs: 0, college: 1, draft: 1, nba: 2 };
/** Can the player suit up? Returns the reason if not. */
export function canPlay(L: Life): string | null {
  if (probation(L)) return "Academic probation: GPA " + (gpa(L) ?? 0).toFixed(2) + " (need 2.00)";
  if (L.inj) return "Injured: " + L.inj.k + " (" + L.inj.days + " days)";
  return null;
}
/** Team strength for simulated games (the player's OVR helps). */
const myRt = (L: Life, played: boolean) => (L.league[0] ? L.league[0].rt : 60) + (played ? (ovrOf(L.p) - 60) * 0.25 : -2);
/** Simulate the player's team's game (missed / ineligible / sim-to-next): result without the player's line. */
export function simTeamGame(L: Life, e: Ev, line: Partial<GameRes> | null): GameRes {
  const r = mkRng(hashStr(e.id + L.seed));
  const opp = L.stage === "nba" ? { rt: 62 + ((e.opp ?? 0) % 5) } : L.league[e.opp ?? 1] || { rt: 60 };
  const [a, b] = simGame({ rt: L.stage === "nba" ? 63 + (line ? (ovrOf(L.p) - 70) * 0.2 : 0) : myRt(L, !!line) }, opp, r);
  const res: GameRes = { us: a, them: b, won: a > b, pts: 0, reb: 0, ast: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, hl: [], played: false, ...(line || {}) };
  recordGame(L, e, res);
  return res;
}
/** Book a finished game: team record, the player's line, followers, mood, coach trust. */
/** Tournament bookkeeping after a result: a loss ends the run (later rounds removed), winning the last round = title. */
function bracket(L: Life, e: Ev, res: GameRes) {
  if (!e.rd || !e.big || !ROUNDS[e.big]) return;
  if (!res.won) {
    L.cal = L.cal.filter((x) => !(x.big === e.big && x.s === 0 && x !== e));
    note(L, (e.big === "mm" ? "Eliminated in the " : "Out in the ") + e.title.toLowerCase(), "💔");
    logE(L, "elim", "eliminated in the " + e.title.toLowerCase());
  } else if (e.rd === ROUNDS[e.big].length) {
    L.flags.champ = 1;
    if (e.big === "po") L.story.push("parade");
    note(L, e.big === "mm" ? "NATIONAL CHAMPIONS! 🏆" : "STATE CHAMPIONS! 🏆", "🏆");
    logE(L, "title", e.big === "mm" ? "won the national title" : "won the state title");
  }
}
export function recordGame(L: Life, e: Ev, res: GameRes) {
  bracketQ.push(() => bracket(L, e, res));
  e.res = res;
  e.s = res.played ? 1 : e.s || 2;
  if (res.won) L.team.w++;
  else L.team.l++;
  if (L.league[0]) res.won ? L.league[0].w++ : L.league[0].l++;
  const oc = oppClub(L, e);
  if (oc) res.won ? oc.l++ : oc.w++;
  if (res.played) {
    for (const ln of [L.line, L.career]) {
      ln.gp++;
      if (res.won) ln.w++;
      ln.pts += res.pts;
      ln.reb += res.reb;
      ln.ast += res.ast;
      ln.blk += res.blk;
      ln.fgm += res.fgm;
      ln.fga += res.fga;
      ln.tpm += res.tpm;
      ln.tpa += res.tpa;
    }
    const perf = perfOf(res),
      gain = followerGain(L, perf, res);
    L.followers = Math.max(0, L.followers + gain);
    L.rep = clamp(L.rep + perf * 0.6 + (res.won ? 1 : -0.5), 0, 100);
    L.mood = clamp(L.mood + (res.won ? 10 : -6) + perf, 0, 100);
    L.energy = clamp(L.energy - 30, 0, 100);
    res.grade = gradeOf(perf);
    const co = L.contacts.find((c) => c.id === "coach");
    if (co) co.aff = clamp(co.aff + (perf > 2 ? 3 : perf < -2 ? -2 : 1), 0, 100);
    logE(L, "game", `${res.won ? "W" : "L"} ${res.us}-${res.them} vs ${oppName(L, e)}: ${res.pts} pts ${res.reb} reb ${res.ast} ast${res.hl.length ? " (" + res.hl.join(", ") + ")" : ""}`);
    checkDeals(L);
  } else logE(L, "teamgame", `${res.won ? "W" : "L"} ${res.us}-${res.them} vs ${oppName(L, e)} (did not play)`);
  while (bracketQ.length) bracketQ.shift()!();
}
const bracketQ: (() => void)[] = [];
/** Performance index (about -5 .. +10) from a stat line (short arcade games: per-game numbers are small). */
export function perfOf(r: GameRes): number {
  const eff = r.fga ? (r.fgm / r.fga - 0.45) * 8 : 0;
  return clamp(r.pts * 0.45 + r.reb * 0.25 + r.ast * 0.35 + r.blk * 0.5 + eff + (r.won ? 1 : -1) + (r.hl.includes("gamewinner") ? 3 : 0) + (r.hl.includes("airball") ? -1 : 0) - 3, -5, 10);
}
export const gradeOf = (perf: number) => (perf >= 7 ? "A+" : perf >= 5 ? "A" : perf >= 3 ? "B+" : perf >= 1.5 ? "B" : perf >= 0 ? "C" : perf >= -2 ? "D" : "F");
/** Followers gained (or lost) for a game: grows with fame, performance and highlight plays; bad games cost a few. */
export function followerGain(L: Life, perf: number, r?: GameRes): number {
  const base = L.stage === "hs" ? 40 : L.stage === "college" ? 220 : 1500,
    fame = 1 + Math.log10(1 + L.followers / 1000),
    hl = r ? r.hl.reduce((a, h) => a + (h === "dunk" ? 0.25 : h === "gamewinner" ? 1.5 : h === "block" ? 0.15 : h === "three" ? 0.08 : 0), 0) : 0;
  if (perf < -1) return -Math.round(base * 0.15 * -perf * 0.5);
  const mj = L.major === "Communications" ? 1.1 : 1;
  return Math.round(base * fame * (0.5 + perf * 0.25 + hl) * (r && r.won ? 1.15 : 1) * mj);
}
/** Endorsements unlock at follower milestones (college: NIL deals; HS: none - amateur rules). */
export const DEALS: [number, string, number][] = [
  [2000, "Burrito Barn (local ad)", 60],
  [10000, "Apex Kicks", 400],
  [40000, "Glacier Sports Drink", 900],
  [150000, "Apex Kicks Signature Line", 4000],
  [500000, "Vantage Motors", 9000],
];
export function checkDeals(L: Life) {
  if (L.stage === "hs") return;
  for (const [n, b, pay] of DEALS) {
    if (L.followers < n || L.deals.some((d) => d.b === b)) continue;
    const p = Math.round((L.stage === "nba" ? pay * 6 : pay) * (L.major === "Business" ? 1.1 : 1));
    L.deals.push({ b, pay: p, t: L.t });
    msg(L, "agent" in L.msgs ? "agent" : "coach", `${b} reached out: ${L.stage === "college" ? "NIL deal" : "endorsement"} worth $${p.toLocaleString()} a week. Signed it for you to review in the Bank app.`);
    note(L, "New deal: " + b + " · $" + p + "/wk", "🤝");
    logE(L, "deal", "signed with " + b);
  }
}

// ---------------------------------------------------------------- year end, recruiting, draft
export function endYear(L: Life) {
  const g = gpa(L, true);
  for (const c of L.courses) {
    const p = coursePct(c);
    if (p != null) L.done.push({ n: c.n, pct: Math.round(p), pts: letter(p)[1], yr: STAGE_N[L.stage] + " " + L.yr });
  }
  const aw: string[] = [];
  if (g != null && g >= 3.5 && L.stage !== "nba") aw.push("Dean's List");
  if (L.flags.champ) aw.push(L.stage === "hs" ? "State Champions" : L.stage === "college" ? "National Champions" : "NBA Champions");
  if (L.flags.champ && L.stage === "nba" && L.line.gp && L.line.pts / L.line.gp >= 15) aw.push("Finals MVP");
  L.flags.champ = 0;
  const ppg = L.line.gp ? L.line.pts / L.line.gp : 0,
    wp = L.team.w / Math.max(1, L.team.w + L.team.l);
  if (L.stage !== "nba" && ppg >= 14) aw.push(L.stage === "hs" ? "All-State" : "All-Conference");
  if (L.stage === "nba" && L.line.gp) {
    const prev = L.hist.filter((h) => h.stage === "nba").pop(),
      pp = prev && prev.line.gp ? prev.line.pts / prev.line.gp : 0;
    if (L.yr === 1 && ppg >= 10) aw.push("Rookie of the Year");
    if (ppg >= 22 && wp >= 0.6) aw.push("MVP");
    else if (ppg >= 18) aw.push("All-NBA");
    if (L.line.blk / L.line.gp >= 1.5) aw.push("Defensive Player of the Year");
    if (prev && ppg - pp >= 5) aw.push("Most Improved Player");
  }
  for (const a of aw) if (/MVP|Rookie|Champions|Defensive|Improved/.test(a)) L.story.push("award:" + a);
  if (g != null && g >= 3.2 && L.line.gp && L.line.pts / L.line.gp >= 10 && L.stage === "college") aw.push("Academic All-American");
  L.hist.push({ stage: L.stage, yr: L.yr, team: L.team.name, line: { ...L.line }, gpa: g, rec: L.team.w + "-" + L.team.l, aw });
  L.courses = [];
  if (L.stage === "hs") {
    L.offers = recruit(L);
    L.pend = "signing";
  } else if (L.stage === "college") L.pend = L.yr >= 4 ? "draft" : "declare";
  else if (L.stage === "nba") {
    L.yr++;
    L.y0 = dayOf(L.t) + 1;
    L.flags.treq = 0;
    if (L.contract) {
      L.contract.yrs--;
      if (L.contract.yrs <= 0) {
        L.pend = "fa"; // free agency: offers + negotiation (the season starts after signing)
        msg(L, "agent", "Your contract is up. Free agency opens now - let's see who wants you. 📞");
      }
    }
    if (!L.pend) beginYear(L);
  }
  logE(L, "year", "season over" + (aw.length ? ": " + aw.join(", ") : ""));
}
/** College offers after the senior year: better players / students get better programs. */
export function recruit(L: Life): string[] {
  const ln = L.line,
    ppg = ln.gp ? ln.pts / ln.gp : 0,
    g = gpa(L) ?? 2.5,
    score = ovrOf(L.p) + ppg * 1.2 + (g - 2.5) * 4 + L.followers / 2000;
  const sorted = COLLEGES.slice().sort((a, b) => b[3] - a[3]);
  const top = clamp(Math.floor((80 - score) / 4), 0, sorted.length - 3);
  return sorted.slice(top, top + 3).map((c) => c[0]);
}
/** Signing Day: commit to college `name`; the college years begin the next morning. */
export function sign(L: Life, name: string) {
  const c = COLLEGES.find((c) => c[0] === name) || COLLEGES[0];
  L.school = c[0];
  L.team = { name: c[0], short: c[1], col: c[2], tm: -1, w: 0, l: 0 };
  L.stage = "college";
  L.yr = 1;
  L.pend = "";
  L.y0 = dayOf(L.t) + 1;
  const co = L.contacts.find((x) => x.id === "coach")!;
  co.n = "Coach Hart";
  co.role = "College Coach";
  co.aff = 55;
  const pr = L.contacts.find((x) => x.id === "prof")!;
  pr.n = "Prof. Lindqvist";
  pr.role = "Academic advisor";
  L.visited = Array.from(new Set([...L.visited, "dorm", "hale", "wren", "lab", "dining", "library"]));
  beginYear(L);
  logE(L, "signing", "committed to " + c[0]);
  msg(L, "coach", `Welcome to ${c[0]}! Your dorm is on campus. Freshman year starts tomorrow: class at 9, practice at 3:30.`);
  msg(L, "mom", "I'm crying 😭 so proud of you!! Call me when you're moved in!", [["Love you Mom ❤️", "❤️❤️❤️", 3]]);
}
/** Back for another college year (or after declaring: draft). */
export function nextCollegeYear(L: Life) {
  L.yr++;
  L.pend = "";
  L.y0 = dayOf(L.t) + 1;
  beginYear(L);
}
export function draftEligible(L: Life): boolean {
  return L.stage === "college" && L.hist.filter((h) => h.stage === "college").length >= 1;
}
/** Draft stock 0..100 from ratings, production, winning, grades and buzz. */
export function draftStock(L: Life): number {
  const col = L.hist.filter((h) => h.stage === "college"),
    all = col.reduce((a, h) => ({ gp: a.gp + h.line.gp, pts: a.pts + h.line.pts, reb: a.reb + h.line.reb, ast: a.ast + h.line.ast, w: a.w + h.line.w }), { gp: L.line.gp, pts: L.line.pts, reb: L.line.reb, ast: L.line.ast, w: L.line.w });
  const pg = (k: number) => (all.gp ? k / all.gp : 0);
  const g = gpa(L);
  const gb = g == null ? 0 : g >= 3.5 ? 4 : g >= 3 ? 2 : g < 2 ? -6 : 0;
  const s = (L.flags.combo || 0) + (ovrOf(L.p) - 55) * 1.6 + pg(all.pts) * 1.5 + pg(all.reb) * 0.6 + pg(all.ast) * 0.8 + (all.gp ? (all.w / all.gp) * 8 : 0) + gb + Math.log10(1 + L.followers) * 2;
  return clamp(Math.round(s), 0, 100);
}
export const projPick = (stock: number) => clamp(Math.round(61 - stock * 0.62), 1, 61); // 61 = undrafted
/** Draft night: the order is built around the player's stock; returns the picks (team TM index, prospect name). */
export function runDraft(L: Life, r: Rng = mkRng(hashStr("draft" + L.seed + L.yr))): { pick: number; team: number; board: { pk: number; tm: number; n: string; me?: number }[] } {
  const stock = draftStock(L),
    mine = clamp(projPick(stock) + rint(r, -3, 3), 1, 60);
  const order = Array.from({ length: 14 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const board: { pk: number; tm: number; n: string; me?: number }[] = [];
  const FN = "Bryce Owen Malik Theo Cole Isaiah Rowan Darius Silas Jonah Felix Nolan".split(" "),
    LN = "Ashby Kincaid Moreau Galloway Pemberton Okoro Vance Redding Langford Ibarra Dunleavy Sorensen".split(" ");
  for (let pk = 1; pk <= 30; pk++) {
    const tm = order[(pk - 1) % 14];
    board.push(pk === mine ? { pk, tm, n: L.p.n, me: 1 } : { pk, tm, n: pick(r, FN) + " " + pick(r, LN) });
  }
  // a team that loved the interview trades into your range (within 5 picks) to take you
  if (L.fav >= 0 && mine <= 30) {
    const k = board.findIndex((b) => b.tm === L.fav && Math.abs(b.pk - mine) <= 5 && !b.me);
    if (k >= 0) {
      const me = board[mine - 1];
      const tm = board[k].tm;
      board[k].tm = me.tm;
      me.tm = tm;
    }
  }
  const team = mine <= 30 ? board[mine - 1].tm : L.fav >= 0 ? L.fav : order[rint(r, 0, 13)];
  return { pick: mine, team, board };
}
/** Rookie scale: salary by pick (fictional numbers in the real ballpark). */
export const rookieSal = (pk: number) => (pk > 60 ? 1_100_000 : Math.round(12_500_000 * Math.pow(0.93, pk - 1) + 1_200_000));
export function joinNBA(L: Life, pick: number, team: number) {
  L.draft = { pick, team, sal: rookieSal(pick) };
  L.contract = { sal: rookieSal(pick), yrs: pick <= 30 ? 4 : 2, team };
  L.stage = "nba";
  L.yr = 1;
  L.pend = "";
  L.team = { name: NBA_NAMES[team] || "NBA", short: (NBA_NAMES[team] || "NBA").slice(0, 3).toUpperCase(), col: "#1d428a", tm: team, w: 0, l: 0 };
  L.y0 = dayOf(L.t) + 1;
  L.p.lv = L.p.lv || 0;
  const co = L.contacts.find((x) => x.id === "coach")!;
  co.n = "Coach Bellamy";
  co.role = "Head Coach · " + L.team.name;
  co.aff = 50;
  if (!L.agent) L.agent = "Dana Cole";
  if (!L.contacts.some((c) => c.id === "agent")) L.contacts.push({ id: "agent", n: L.agent, role: "Agent", aff: 60, c: AGENTS[L.agent].c });
  L.story.push("rookie");
  money(L, Math.round(L.contract.sal * 0.1), "Signing bonus · " + L.team.name);
  beginYear(L);
  logE(L, "draft", `drafted #${pick} by the ${L.team.name}`);
  msg(L, "agent", `Congrats, rookie. ${L.contract.yrs}-year deal, $${L.contract.sal.toLocaleString()} a year. Paychecks every Friday.`);
}
// ---------------------------------------------------------------- pre-draft: combine, interviews, agent
export interface Combine {
  ht: number; // height in shoes (ft)
  wing: number; // wingspan (ft)
  vert: number; // max vertical (in)
  lane: number; // lane agility (s)
  sprint: number; // 3/4-court sprint (s)
  bench: number; // 185 lb reps
  d: number; // draft stock change
}
/** Draft combine: measurements and athletic tests from the ratings (+ a little noise); good numbers move the stock. */
export function combine(L: Life, r: Rng = mkRng(hashStr("combine" + L.seed + L.yr))): Combine {
  const p = L.p,
    n = () => (r() - 0.5) * 2;
  const c: Combine = {
    ht: +(p.ht + 0.08).toFixed(2),
    wing: +(p.ht * 1.05 + n() * 0.15).toFixed(2),
    vert: Math.round(26 + (p.j - 40) * 0.28 + n() * 2),
    lane: +(12.4 - (p.s - 40) * 0.032 + n() * 0.15).toFixed(2),
    sprint: +(3.6 - (p.s - 40) * 0.0085 + n() * 0.04).toFixed(2),
    bench: Math.max(0, Math.round((p.bk - 0.9) * 40 + n() * 3)),
    d: 0,
  };
  c.d = Math.round(clamp((c.vert - 32) * 0.4 + (11 - c.lane) * 2 + (c.wing - c.ht) * 6 + (c.bench - 8) * 0.15, -6, 8));
  L.flags.combo = c.d;
  logE(L, "combine", `combine: ${c.vert}" vertical, ${c.lane}s lane agility`);
  return c;
}
/** Pre-draft interview with a team: score 0..1 from the answers; a great one makes it your favourite suitor. */
export function interview(L: Life, team: number, score: number) {
  L.flags["iv" + team] = Math.round(score * 100);
  if (score >= 0.66 && (L.fav < 0 || (L.flags["iv" + L.fav] || 0) <= score * 100)) L.fav = team;
}
export function chooseAgent(L: Life, n: string) {
  if (!AGENTS[n]) return false;
  L.agent = n;
  const c = L.contacts.find((x) => x.id === "agent");
  if (c) (c.n = n), (c.c = AGENTS[n].c);
  else L.contacts.push({ id: "agent", n, role: "Agent", aff: 60, c: AGENTS[n].c });
  L.rep = clamp(L.rep + AGENTS[n].rep, 0, 100);
  return true;
}
// ---------------------------------------------------------------- NBA: free agency, negotiation, trades, legacy
export interface Offer {
  tm: number;
  sal: number;
  yrs: number;
}
/** Market value per year from ratings, production and fame (fictional scale, max ~$55M). */
export function marketValue(L: Life): number {
  const ppg = L.line.gp ? L.line.pts / L.line.gp : L.career.gp ? L.career.pts / L.career.gp : 0;
  return Math.round(clamp(2_000_000 + (ovrOf(L.p) - 60) * 900_000 + ppg * 1_100_000 + Math.log10(1 + L.followers) * 400_000, 1_100_000, 55_000_000) / 10000) * 10000;
}
export function faOffers(L: Life, r: Rng = mkRng(hashStr("fa" + L.seed + L.yr))): Offer[] {
  const mv = marketValue(L) * (AGENTS[L.agent] || { con: 1 }).con,
    out: Offer[] = [{ tm: L.team.tm, sal: Math.round((mv * (1 + r() * 0.08)) / 1e4) * 1e4, yrs: 3 + Math.floor(r() * 2) }];
  const used = new Set([L.team.tm]);
  while (out.length < 4) {
    const tm = rint(r, 0, 13);
    if (used.has(tm)) continue;
    used.add(tm);
    out.push({ tm, sal: Math.round((mv * (0.85 + r() * 0.3)) / 1e4) * 1e4, yrs: 2 + Math.floor(r() * 3) });
  }
  return out;
}
/** Chance a team accepts an ask: 100% at or below the offer, falling to 0 at +40%. */
export const acceptChance = (o: Offer, ask: number) => clamp(1 - (ask / o.sal - 1) * 2.5, 0, 1);
/** Counter-offer: one roll; accepted = new contract at the ask, refused = the team holds at its offer (once). */
export function negotiate(L: Life, o: Offer, ask: number, r: Rng = Math.random): boolean {
  const ok = r() < acceptChance(o, ask);
  if (ok) o.sal = Math.round(ask / 1e4) * 1e4;
  return ok;
}
export function signFA(L: Life, o: Offer) {
  const moved = o.tm !== L.team.tm;
  L.contract = { sal: o.sal, yrs: o.yrs, team: o.tm };
  if (moved) setTeam(L, o.tm);
  L.pend = "";
  money(L, Math.round(o.sal * 0.05), "Signing bonus · " + NBA_NAMES[o.tm]);
  logE(L, "fa", `signed ${o.yrs} years / $${(o.sal / 1e6).toFixed(1)}M with the ${NBA_NAMES[o.tm]}`);
  if (L.contract.sal >= 45_000_000) note(L, "MAX CONTRACT 💰", "💰");
  beginYear(L);
}
function setTeam(L: Life, tm: number) {
  L.team = { ...L.team, name: NBA_NAMES[tm], short: NBA_NAMES[tm].slice(0, 3).toUpperCase(), tm };
  const co = L.contacts.find((x) => x.id === "coach");
  if (co) (co.role = "Head Coach · " + L.team.name), (co.aff = 50);
  if (L.contract) L.contract.team = tm;
}
/** Mid-season trade: new team, the rest of the schedule keeps its dates (games vs your new team become vs your old one). */
export function tradeTo(L: Life, tm: number) {
  const old = L.team.tm;
  setTeam(L, tm);
  for (const e of L.cal) if (e.k === "game" && e.s === 0 && e.opp === tm) e.opp = old;
  const me = L.league.findIndex((c) => c.name === NBA_NAMES[tm]);
  if (me > 0) {
    const [c] = L.league.splice(me, 1);
    L.league.unshift(c);
  }
  L.flags.treq = 0;
  L.story.push("trade");
  logE(L, "trade", `traded to the ${L.team.name}`);
  msg(L, "agent", `It's done: you've been traded to the ${L.team.name}. New city, fresh start. ✈️`);
}
export function requestTrade(L: Life) {
  if (L.stage !== "nba") return false;
  L.flags.treq = 1;
  L.rep = clamp(L.rep - 3, 0, 100);
  const co = L.contacts.find((x) => x.id === "coach");
  if (co) co.aff = clamp(co.aff - 10, 0, 100);
  logE(L, "treq", "requested a trade");
  return true;
}
/** Road games: after an away game the team flies home overnight (hotel, morning flight). */
export function roadReturn(L: Life) {
  const d = dayOf(L.t) + 1,
    to = d * DAY + 9 * 60;
  if (L.t < to) advance(L, to - L.t, "sleep");
  L.energy = clamp(L.energy + 25, 0, 100);
  note(L, "Hotel night, morning flight home ✈️", "🏨");
}
/** Legacy score toward the Hall of Fame (shown in Stats): points, awards, titles, seasons. */
export function legacy(L: Life): number {
  const aw = L.hist.flatMap((h) => h.aw);
  const w = (re: RegExp, k: number) => aw.filter((a) => re.test(a)).length * k;
  return Math.round(L.career.pts / 8 + w(/NBA Champions/, 120) + w(/MVP/, 150) + w(/All-NBA/, 40) + w(/Defensive/, 60) + w(/Rookie/, 30) + w(/Improved/, 20) + w(/National Champions/, 40) + L.hist.filter((h) => h.stage === "nba").length * 10);
}
export const HOF = 1000;
export function declare(L: Life) {
  L.pend = "draft";
  logE(L, "declare", "declared for the NBA Draft");
}

// ---------------------------------------------------------------- level-ups (engine XP comes from career.ts)
export function addXP(L: Life, xp: number) {
  L.p.xp += xp;
  let lv = 0;
  while (L.p.xp >= 300 + L.p.lv * 60 && L.p.lv < 60) {
    L.p.xp -= 300 + L.p.lv * 60;
    L.p.lv++;
    L.p.sp += 2;
    lv++;
  }
  return lv;
}
export function spend(L: Life, k: "c" | "i" | "s" | "d" | "j") {
  if (L.p.sp <= 0 || L.p[k] >= 99) return false;
  L.p.sp--;
  L.p[k] = Math.min(99, Math.round(L.p[k] + 1));
  return true;
}

// ---------------------------------------------------------------- save / load
export const SAVE_KEY = (slot: number) => "h2k_life_" + slot;
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void };
export function serialize(L: Life): string {
  return JSON.stringify(L);
}
export function deserialize(s: string): Life | null {
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== "object" || typeof o.t !== "number" || !o.p || !Array.isArray(o.cal)) return null;
    return migrate(o);
  } catch (e) {
    return null;
  }
}
/** Fill fields added after a save was written (older versions load with defaults). */
export function migrate(o: any): Life {
  const d = newLife({ seed: o.seed || 1, slot: o.slot || 0 });
  for (const k of Object.keys(d)) if (o[k] === undefined) o[k] = (d as any)[k];
  o.set = { ...d.set, ...(o.set || {}) };
  o.p = { ...newPlayer(), ...o.p };
  o.v = LIFE_VER;
  return o as Life;
}
export function saveLife(L: Life, st: Store) {
  try {
    st.setItem(SAVE_KEY(L.slot), serialize(L));
    st.setItem("h2k_life", String(L.slot));
    return true;
  } catch (e) {
    return false;
  }
}
export function loadLife(st: Store, slot: number): Life | null {
  try {
    const s = st.getItem(SAVE_KEY(slot));
    return s ? deserialize(s) : null;
  } catch (e) {
    return null;
  }
}
/** One-line summary of a save slot for the menu. */
export function slotInfo(L: Life | null) {
  if (!L) return null;
  return `${L.p.n} · ${STAGE_N[L.stage]}${L.stage === "college" ? " Y" + L.yr : L.stage === "nba" ? " S" + L.yr : ""} · ${L.team.short || ""} ${L.team.w}-${L.team.l} · ${L.followers.toLocaleString()} followers`;
}
/** Compact JSON summary of recent events for AI prompts (no personal data: in-game names only). */
export function aiSummary(L: Life) {
  return {
    player: L.p.n,
    stage: STAGE_N[L.stage] + (L.stage === "college" ? " year " + L.yr : ""),
    team: L.team.name,
    record: L.team.w + "-" + L.team.l,
    followers: L.followers,
    gpa: gpa(L),
    events: L.log.slice(-10).map((e) => e.k + ": " + e.d),
  };
}
