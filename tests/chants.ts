// Crowd chants (src/client/chantdir.ts + chantsyn.ts + the sim's "air" FX):
//  1. scripted game situations -> the director starts the right chant (airball, M-V-P, boos, hush, overtime, DE-FENSE,
//     LET'S GO / ROCK YOU / WE WANT, CHARGE! answer to the organ), nothing in replays / with chants off
//  2. a long random game: chants never overlap, cooldowns hold, a loud building chants more than a quiet one
//  3. every chant renders: finite, non-silent, peak <= .9, the length the director expects (+ reverb tail)
//  4. the sim emits "air" for a shot that never touched iron or glass, "ooh"/nothing otherwise
//  CS=<file> also writes the random game as a script + the expected log for unity/CoreTests/ChantCheck.cs (parity).
//   npx tsx tests/chants.ts
import { writeFileSync } from "node:fs";
import { ChantDir, CH, isReact, CHARGE_AT, type CCtx, type CReq } from "../src/client/chantdir";
import { ChantJob, CSR, rng32, sylls } from "../src/client/chantsyn";
import * as G from "../src/core/sim";

let fails = 0;
const ok = (c: boolean, m: string) => {
  if (!c) (fails++, console.log("FAIL", m));
};
const ROSTER: Record<string, number> = { H1: 0, H2: 0, H3: 0, A1: 1, A2: 1, A3: 1 };
const mk = (): CCtx => ({
  live: true, over: false, home: 0, pos: 0, sc: [0, 0], q: 1, clutch: false, mom: 0, run: [0, 0], dead: false,
  ft: 0, ftTm: 0, ftN: "", ftStar: false, bench: "", names: ["Lakers", "Thunder"], speaking: false,
  tmOf: (n) => (n in ROSTER ? ROSTER[n] : -1),
});
const OUT: CReq[] = [];
/** Run the director for `sec` seconds at 60 Hz; returns the ids started. */
function run(d: ChantDir, c: CCtx, sec: number, fx: any[] = []) {
  const got: string[] = [];
  for (const f of fx) d.fx(f, c);
  for (let i = 0; i < sec * 60; i++) for (const r of d.tick(1 / 60, c, OUT)) got.push(r.id + (r.word ? ":" + r.word : ""));
  return got;
}
const has = (a: string[], s: string) => a.some((x) => x === s || x.startsWith(s + ":"));

// ---------------- 1. situations ----------------
{
  let d = new ChantDir(rng32(1)), c = mk();
  run(d, c, 1);
  ok(has(run(d, c, 1, [{ k: "air", v: 1, tm: 1, n: "A1" }]), "airball"), "away airball -> AIR BALL");
  d = new ChantDir(rng32(1)); c = mk();
  const g = run(d, c, 1, [{ k: "air", v: 0 }]); // (guest-relayed form: team in v)
  ok(has(g, "aww") && !has(g, "airball"), "home airball -> aww, no chant");
  d = new ChantDir(rng32(1)); c = mk(); c.dead = true; c.ft = 0;
  const f = run(d, c, 8, [{ k: "cm", e: "fire", n: "H1" }]);
  ok(f[0] === "roar" && has(f, "mvp:H1"), "home player ON FIRE -> roar then M-V-P " + f);
  d = new ChantDir(rng32(1)); c = mk(); c.pos = 1;
  ok(!has(run(d, c, 2, [{ k: "cm", e: "fire", n: "A1" }]), "mvp"), "away on fire: no M-V-P");
  // free throws
  d = new ChantDir(rng32(1)); c = mk(); c.dead = true; c.ft = 1; c.ftTm = 1; c.ftN = "A1";
  ok(has(run(d, c, 1), "boo"), "road shooter at the line -> boo");
  d = new ChantDir(rng32(1)); c = mk(); c.dead = true; c.clutch = true; c.q = 4; c.ft = 1; c.ftTm = 0; c.ftN = "H1";
  ok(has(run(d, c, 1), "shh") && d.hush === 1 && d.duck() === 0.25, "clutch home FT -> hush (shh, bed + music down)");
  c.ft = 0; c.dead = false; run(d, c, 0.1);
  ok(d.hush === 0, "hush released after the FT");
  d = new ChantDir(rng32(1)); c = mk(); c.dead = true; c.ft = 1; c.ftTm = 0; c.ftN = "H1"; c.ftStar = true;
  ok(has(run(d, c, 2), "mvp:H1"), "home star at the line -> M-V-P");
  // calls against the home team
  for (const e of ["flagrant", "goaltend", "tech"]) {
    d = new ChantDir(rng32(1)); c = mk();
    ok(has(run(d, c, 1, [{ k: "cm", e, n: "H2", n2: "A1" }]), "boo"), e + " on a home player -> boo");
    d = new ChantDir(rng32(1)); c = mk();
    ok(!has(run(d, c, 1, [{ k: "cm", e, n: "A2", n2: "H1" }]), "boo"), e + " on the visitors -> no boo");
  }
  // big plays
  d = new ChantDir(rng32(1)); c = mk();
  ok(has(run(d, c, 1, [{ k: "cm", e: "dunk", n: "H3" }]), "roar"), "home dunk -> roar");
  d = new ChantDir(rng32(1)); c = mk(); c.sc = [80, 79];
  run(d, c, 0.1); c.sc = [82, 79];
  ok(has(run(d, c, 1, [{ k: "t", s: "GAME WINNER!" }]), "roar"), "home game winner -> roar");
  d = new ChantDir(rng32(1)); c = mk(); c.sc = [80, 79]; run(d, c, 0.1); c.sc = [80, 81];
  ok(has(run(d, c, 1, [{ k: "t", s: "BUZZER BEATER!" }]), "aww"), "road buzzer beater -> aww");
  // overtime
  d = new ChantDir(rng32(1)); c = mk(); c.q = 4; run(d, c, 1); c.q = 5; c.dead = true;
  ok(has(run(d, c, 3), "overtime"), "start of OT -> OVERTIME");
  // the sim's late-game cue while the home team defends
  d = new ChantDir(rng32(1)); c = mk(); c.q = 4; c.pos = 1; c.dead = true;
  ok(has(run(d, c, 1, [{ k: "chant", tm: 0 }]), "defense"), "sim chant cue -> DE-FENSE");
  d = new ChantDir(rng32(1)); c = mk(); c.pos = 0; c.dead = true;
  ok(!has(run(d, c, 1, [{ k: "chant", tm: 1 }]), "defense"), "away defending: no home DE-FENSE");
  // organ call-and-response
  d = new ChantDir(rng32(3)); c = mk(); c.pos = 0; c.mom = 1; run(d, c, 0.1);
  const r = d.riff("charge", c);
  ok(!!r && r.id === "charge" && r.delay === CHARGE_AT, "organ CHARGE riff -> crowd answers on the beat");
  d = new ChantDir(rng32(3)); c = mk(); c.pos = 1; run(d, c, 0.1);
  ok(!d.riff("charge", c), "no CHARGE! while the visitors have it");
  let dfn = 0;
  for (let s = 0; s < 20; s++) {
    const d2 = new ChantDir(rng32(50 + s)), c2 = mk();
    c2.pos = 1;
    run(d2, c2, 0.1);
    if (d2.riff("defense", c2)?.id === "defense") dfn++;
  }
  ok(dfn >= 5 && dfn < 20, "organ DE-FENSE riff: the crowd joins in on the bar (" + dfn + "/20)");
  // dead-ball fillers: LET'S GO <home>, ROCK YOU, WE WANT <bench favourite>, visitors' LET'S GO on a road run
  const seen = new Set<string>();
  for (let s = 0; s < 80; s++) {
    d = new ChantDir(rng32(100 + s)); c = mk(); c.q = 3; c.mom = 0.8; c.bench = s % 2 ? "H2" : ""; c.run = s % 3 ? [0, 0] : [0, 10];
    c.dead = false; run(d, c, 0.5); c.dead = true;
    for (const x of run(d, c, 3)) seen.add(x + (d.log.length && d.log[d.log.length - 1].side ? "@away" : ""));
  }
  for (const k of ["letsgo:Lakers", "rockyou", "wewant:H2", "letsgo:Thunder@away"]) ok(seen.has(k), "dead-ball filler " + k + " (" + [...seen].join(" ") + ")");
  // nothing while not live (replay / menu), nothing with chants off
  d = new ChantDir(rng32(1)); c = mk(); c.live = false;
  ok(run(d, c, 3, [{ k: "air", tm: 1 }, { k: "cm", e: "dunk", n: "H1" }]).length === 0, "replay: no chants");
  d = new ChantDir(rng32(1)); d.on = false; c = mk();
  ok(run(d, c, 3, [{ k: "air", tm: 1 }]).length === 0, "chants off: silent");
  // commentary voice holds a normal chant back (priority < 8)
  d = new ChantDir(rng32(1)); c = mk(); c.q = 4; c.pos = 1; c.dead = true; c.speaking = true;
  ok(!has(run(d, c, 1, [{ k: "chant", tm: 0 }]), "defense"), "commentary speaking: DE-FENSE waits");
  c.speaking = false;
  ok(has(run(d, c, 1, [{ k: "chant", tm: 0 }]), "defense"), "...and starts once the voice stops");
}

// ---------------- 2. a long random game ----------------
/** Random game script (also replayed by ChantCheck.cs): one line per frame. */
function script(seed: number, frames: number, mom: number) {
  const r = rng32(seed),
    L: string[] = [];
  let pos = 0, dead = 0, ft = 0, ftN = 0, q = 1, s0 = 0, s1 = 0, clutch = 0, run0 = 0, run1 = 0, bench = "";
  for (let i = 0; i < frames; i++) {
    const fx: string[] = [];
    if (i % 3600 === 3599 && q < 6) q++;
    if (dead > 0) dead--;
    if (ft > 0 && r() < 0.01) ft = 0;
    const x = r();
    if (x < 0.004) {
      // a basket: the other team inbounds
      const t = pos;
      if (t === 0) (s0 += 2), run0 += 2, (run1 = 0);
      else (s1 += 2), run1 += 2, (run0 = 0);
      fx.push("cm," + (r() < 0.3 ? "dunk" : "two") + "," + (t ? "A1" : "H1"));
      pos = 1 - pos;
      dead = 90;
    } else if (x < 0.006) (fx.push("cm,miss," + (pos ? "A2" : "H2") + "," + (pos ? "H3" : "A3"))), (pos = 1 - pos);
    else if (x < 0.0068) fx.push("air," + pos);
    else if (x < 0.0072) (ft = ++ftN), (dead = 200), fx.push("x,0.6");
    else if (x < 0.0075) fx.push("cm,fire," + (r() < 0.5 ? "H1" : "A1"));
    else if (x < 0.0078) fx.push("cm," + ["flagrant", "goaltend", "tech"][Math.floor(r() * 3)] + "," + (r() < 0.5 ? "H2" : "A2"));
    else if (x < 0.0085 && q >= 4) fx.push("chant," + (1 - pos));
    else if (x < 0.0088) fx.push("R," + (r() < 0.5 ? "charge" : "defense"));
    else if (x < 0.0090) (bench = bench ? "" : "H2");
    clutch = q >= 4 && Math.abs(s0 - s1) <= 5 ? 1 : 0;
    const live = i % 5000 < 4800 ? 1 : 0, // a replay now and then
      sp = i % 700 < 90 ? 1 : 0;
    L.push([live, 0, pos, s0, s1, q, clutch, mom, run0, run1, dead || ft ? 1 : 0, ft, ft ? (ftN % 2) : 0, ft ? (ftN % 2 ? "A1" : "H1") : "-", ft && ftN % 3 === 0 ? 1 : 0, bench || "-", sp].join(" ") + (fx.length ? " | " + fx.join(" ") : ""));
  }
  return L;
}
/** Replay a script through a director; returns the log lines (same format as ChantCheck.cs). */
function play(lines: string[], seed: number) {
  const d = new ChantDir(rng32(seed)),
    c = mk(),
    log: string[] = [],
    starts: CReq[] = [],
    emit = (r: CReq) => (starts.push(r), log.push(Math.round(r.t * 1e6) + " " + r.id + " " + (r.word || "-") + " " + r.side + " " + Math.round(r.gain * 1e6) + " " + Math.round(r.delay * 1e6)));
  for (const ln of lines) {
    const [st, fxs] = ln.split(" | "),
      a = st.split(" ");
    c.live = a[0] === "1"; c.over = a[1] === "1"; c.pos = +a[2]; c.sc[0] = +a[3]; c.sc[1] = +a[4]; c.q = +a[5]; c.clutch = a[6] === "1";
    c.mom = +a[7]; c.run[0] = +a[8]; c.run[1] = +a[9]; c.dead = a[10] === "1"; c.ft = +a[11]; c.ftTm = +a[12]; c.ftN = a[13] === "-" ? "" : a[13];
    c.ftStar = a[14] === "1"; c.bench = a[15] === "-" ? "" : a[15]; c.speaking = a[16] === "1";
    for (const f of fxs ? fxs.split(" ") : []) {
      const p = f.split(",");
      if (p[0] === "R") {
        const r = d.riff(p[1], c);
        if (r) emit(r);
      } else if (p[0] === "air" || p[0] === "chant") d.fx({ k: p[0], v: +p[1], tm: +p[1] }, c);
      else if (p[0] === "x") d.fx({ k: "x", v: +p[1] }, c);
      else d.fx({ k: "cm", e: p[1], n: p[2], n2: p[3] }, c);
    }
    for (const r of d.tick(1 / 60, c, OUT)) emit(r);
  }
  return { log, starts };
}
{
  const frames = 60 * 60 * 6,
    loud = play(script(7, frames, 0.9), 7),
    quiet = play(script(7, frames, -0.9), 7);
  // no two chants (non-reactions) overlap: each starts after the previous one's end (+ its delay)
  let end = -1, overl = 0;
  const lastAt: Record<string, number> = {};
  let cdBad = 0;
  for (const r of loud.starts) {
    const at = r.t + r.delay;
    if (lastAt[r.id] != null && at - lastAt[r.id] < CH[r.id][1] - 1e-6) cdBad++;
    lastAt[r.id] = at;
    if (isReact(r.id)) continue;
    if (at < end - 1e-6) overl++;
    end = at + CH[r.id][0];
  }
  ok(overl === 0, "chants overlapped " + overl + " times");
  ok(cdBad === 0, "cooldowns broken " + cdBad + " times");
  const el = (s: CReq[]) => s.filter((r) => r.id === "letsgo" || r.id === "rockyou" || r.id === "defense").length;
  ok(el(loud.starts) > el(quiet.starts), `a loud building chants more (${el(loud.starts)} vs ${el(quiet.starts)})`);
  const kinds = new Set(loud.starts.map((r) => r.id));
  console.log("random game:", loud.starts.length, "starts", [...kinds].join(" "), "| quiet building:", quiet.starts.length);
  ok(kinds.size >= 8, "random game used " + kinds.size + " kinds");
  if (process.env.CS) {
    writeFileSync(process.env.CS, script(7, frames, 0.9).join("\n") + "\n");
    writeFileSync(process.env.CS + ".expect", loud.log.join("\n") + "\n");
    console.log("wrote", process.env.CS, "+ .expect (" + loud.log.length + " starts)");
  }
}

// ---------------- 3. synthesis ----------------
{
  let ms = 0;
  const RMS: string[] = [];
  for (const id of Object.keys(CH)) {
    const j = new ChantJob(id, id === "letsgo" ? "Timberwolves" : id === "wewant" ? "Gilgeous-Alexander" : "");
    let n = 0;
    while (!j.step(4)) n++;
    let s = 0, pk = 0, bad = 0;
    for (const A of [j.L, j.R]) for (let k = 0; k < A.length; k++) {
      const v = A[k];
      if (!Number.isFinite(v)) bad++;
      s += v * v;
      pk = Math.max(pk, Math.abs(v));
    }
    const rms = Math.sqrt(s / (2 * j.L.length)), sec = j.L.length / CSR;
    ms += j.ms;
    RMS.push(id + " " + rms.toFixed(5) + " " + j.L.length);
    ok(bad === 0 && pk <= 0.9001 && rms > 0.03 && Math.abs(sec - CH[id][0] - 1.2) < 0.01 && n >= 2, `${id}: bad ${bad} peak ${pk.toFixed(3)} rms ${rms.toFixed(3)} ${sec.toFixed(2)} s, ${n + 1} slices`);
  }
  if (process.env.CS) writeFileSync(process.env.CS + ".rms", RMS.join("\n") + "\n");
  console.log("rendered", Object.keys(CH).length, "chants in", Math.round(ms), "ms (Node, sliced <= ~4 ms units)");
  for (const t of ["Lakers", "Warriors", "Nuggets", "Thunder", "Spurs", "Timberwolves", "Knicks", "Celtics", "Bucks", "Mavericks", "Cavaliers", "Rockets", "Pistons", "Magic"]) {
    const s = sylls(t);
    ok(s.length >= 1 && s.length <= 3, t + " -> " + JSON.stringify(s));
  }
}

// ---------------- 4. the sim's AIR BALL FX ----------------
{
  Object.assign(G.cfg, { NP: 5, physics: "legacy", MYM: 0 });
  G.setCtrls([]);
  const shot = (rim: number, glass: boolean) => {
    G.start(0, { j: 3 });
    G.setS("play");
    G.setJB(null);
    G.setInb(0);
    G.setRs(0);
    const sh = G.P.find((p) => p.tm === 1)!,
      rb = G.P.find((p) => p.tm === 0)!,
      B = G.B;
    rb.z = 0;
    Object.assign(B, { owner: null, mode: "air", sh: 1, sc: 0, ft: 0, last: sh, age: 1.2, rim, x: rb.x, y: rb.y, z: 40, vx: 0, vy: 0, vz: -30, to: null, gl: glass ? G.T - 0.5 : null, d0: 300 });
    G.FX.length = 0;
    for (let i = 0; i < 3 && B.mode === "air"; i++) G.upd(1 / 60);
    return G.FX.filter((f) => f.k === "air" || f.k === "ooh").map((f) => f.k + (f.k === "air" ? f.tm : "")).join(",");
  };
  ok(shot(99, false) === "air1", "missed everything -> air FX (team 1): " + shot(99, false));
  ok(shot(5, false) === "ooh", "in and out -> ooh: " + shot(5, false));
  ok(shot(7, false) === "", "off the iron -> nothing: " + shot(7, false));
  ok(shot(99, true) === "", "off the glass only -> not an airball: " + shot(99, true));
}

console.log(fails ? fails + " FAILED" : "chants OK");
process.exit(fails ? 1 : 0);
