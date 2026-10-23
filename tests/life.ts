// LIFE (MyLife) core: state machine, schedule + late penalties, needs, GPA math, probation, draft eligibility/stock,
// save/load round trip, the procedural question generator + bank, and Hoopr (templates, event -> posts, follower
// math, moderation, AI screening). DOM-free: imports src/life directly.
import * as S from "../src/life/state";
import { quiz, genMath, validQ, bankSize, screenAI, aiQuizPrompt } from "../src/life/questions";
import { BANK } from "../src/life/qbank";
import { postsFor, myPost, clean, scrub, screenPosts, trending, suggestions, aiFeedPrompt } from "../src/life/social";
import { mkRng } from "../src/life/rng";

const fails: string[] = [];
const ok = (c: any, m: string) => {
  if (!c) fails.push(m);
};
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

// ---- creation + schedule
const L = S.newLife({ seed: 42, p: { n: "TEST GUY" } });
ok(L.stage === "hs" && L.courses.length === 4, "new life: HS with 4 courses");
ok(L.cal.some((e) => e.k === "class") && L.cal.some((e) => e.k === "game") && L.cal.some((e) => e.k === "practice") && L.cal.some((e) => e.k === "exam"), "calendar has classes, games, practices, finals");
ok(L.cal.filter((e) => e.k === "game").length === 5, "HS: 5 games");
ok(L.cal.every((e) => e.k !== "class" || S.wdOf(e.day) < 5), "classes only on weekdays");
ok(L.cal.some((e) => e.big === "state"), "HS state final scheduled");
ok(S.unread(L) >= 3, "opening texts unread");
const first = S.nextEv(L)!;
ok(first && first.k === "class" && first.st === 9 * 60 && first.day === 0, "first event = 9:00 class on day 0");

// ---- needs decay
const e0 = L.energy,
  h0 = L.hunger;
S.advance(L, 60, "walk");
ok(L.energy < e0 && L.hunger < h0, "needs decay over an hour");
ok(Math.abs(e0 - L.energy - 3.5) < 0.01 && Math.abs(h0 - L.hunger - 6) < 0.01, "walk drains 3.5 energy/h, hunger 6/h");
const e1 = L.energy;
S.advance(L, 30, "sprint");
ok(e1 - L.energy > 4.9, "sprinting drains faster");

// ---- class on time / late / missed
const c0 = L.cal.find((e) => e.k === "class" && e.day === 0 && e.st === 9 * 60)!;
L.t = c0.day * S.DAY + c0.st - 10; // 8:50
ok(S.evAt(L, c0.place) === c0, "class joinable 10 min early at its room");
ok(S.evAt(L, "arena") !== c0, "not at another place");
let lt = S.attend(L, c0);
ok(lt.mul === 1, "on time = no penalty");
const v0 = S.finishClass(L, c0, 0.8);
ok(v0 === 80, "on-time quiz 4/5 = 80 (" + v0 + ")");
ok(S.minOf(L.t) === 10 * 60, "class ends at 10:00");
ok(L.courses[c0.c!].hw >= 0, "homework assigned");
const c1 = L.cal.find((e) => e.k === "class" && e.day === 0 && e.st === 10 * 60 + 30)!;
L.t = S.evStart(c1) + 12;
lt = S.attend(L, c1);
ok(lt.mul === 0.9 && lt.tag === "late", "12 min late = x0.9");
ok(S.finishClass(L, c1, 1) === 90, "late perfect quiz = 90");
ok(S.lateness(c1, S.evStart(c1) + 25).mul === 0.75, "25 min late = x0.75");
const c2 = L.cal.find((e) => e.k === "class" && e.day === 0 && e.st === 13 * 60)!;
L.t = S.evStart(c2) + 31;
S.resolve(L);
ok(c2.s === 2 && L.courses[c2.c!].sc.some((s) => s.v === 0), "missed class = absent 0");
ok(S.evAt(L, c2.place) == null, "can't join after 30 min");

// ---- GPA math
ok(S.letter(95)[0] === "A" && S.letter(91)[1] === 3.7 && S.letter(84)[1] === 3 && S.letter(72)[0] === "C-" && S.letter(10)[1] === 0, "letter grades");
const cc: S.Course = { n: "x", sj: "math", room: "hs", sc: [{ k: "q", v: 100, d: 0 }, { k: "q", v: 80, d: 1 }, { k: "h", v: 50, d: 1 }, { k: "e", v: 70, d: 2 }], hw: -1, study: 0 };
ok(Math.abs(S.coursePct(cc)! - (0.5 * 90 + 0.2 * 50 + 0.3 * 70)) < 1e-9, "course pct weights q50/h20/e30");
cc.sc = [{ k: "q", v: 80, d: 0 }];
ok(S.coursePct(cc) === 80, "renormalised with only quizzes");
const G = S.newLife({ seed: 7 });
G.courses.forEach((c, i) => c.sc.push({ k: "q", v: [95, 85, 75, 55][i], d: 0 }));
ok(S.gpa(G) === Math.round(((4 + 3 + 2 + 0) / 4) * 100) / 100, "GPA = mean grade points (" + S.gpa(G) + ")");
ok(!S.probation(G), "GPA 2.25 not on probation");
G.courses.forEach((c) => c.sc.push({ k: "q", v: 40, d: 1 }));
ok(S.probation(G) && S.canPlay(G) != null, "GPA < 2 = probation, can't play");
const G2 = S.newLife({ seed: 8 });
G2.courses[0].sc.push({ k: "q", v: 0, d: 0 });
ok(!S.probation(G2), "no probation from a single grade");

// ---- sleep + day advance
const D = S.newLife({ seed: 9 });
D.t = 23 * 60;
D.energy = 20;
const hrs = S.sleep(D);
ok(S.dayOf(D.t) === 1 && S.minOf(D.t) === 7 * 60, "sleep at 11 PM wakes at 7:00 next day");
ok(Math.abs(hrs - 8) < 1e-9 && D.energy > 90, "8 h sleep restores energy (" + D.energy.toFixed(1) + ")");
D.set.alarm = 6 * 60 + 30;
D.t = 1 * S.DAY + 22 * 60;
S.sleep(D);
ok(S.minOf(D.t) === 6 * 60 + 30, "alarm time respected");
ok(D.cal.filter((e) => e.day <= 1 && e.k === "class").every((e) => e.s === 2), "classes slept through are missed");

// ---- food / workout diminishing returns / injuries
const F = S.newLife({ seed: 10 });
F.hunger = 20;
ok(S.eat(F, "burrito") == null && F.hunger >= 70 && F.money === 141, "burrito: hunger up, $9 spent");
ok(S.eat(F, "nope") != null, "unknown food rejected");
F.money = 0;
ok(S.eat(F, "bowl") === "Not enough money", "no money no bowl");
ok(S.gainOf(50) > S.gainOf(80) && S.gainOf(80) > S.gainOf(95), "workout gains diminish with rating");
F.energy = 100;
const c00 = F.p.c,
  w1 = S.workout(F, "shoot");
ok(!w1.err && F.p.c > c00 && F.energy < 100, "shooting workout raises 3PT and costs energy");
F.energy = 5;
ok(S.workout(F, "shoot").err, "too tired to work out");
F.inj = { k: "x", days: 2 };
ok(/Injured/.test(S.workout(F, "shoot").err || ""), "injured: no workouts");
const FF = S.newLife({ seed: 11 });
for (let i = 0; i < 5; i++) S.eat(FF, "slice");
ok(FF.notes.some((n) => /fast food/.test(n.x)), "fast-food streak noticed");

// ---- games, followers, deals
const H = S.newLife({ seed: 12 });
const g = H.cal.find((e) => e.k === "game")!;
const res: S.GameRes = { us: 30, them: 22, won: true, pts: 14, reb: 5, ast: 3, blk: 1, fgm: 6, fga: 9, tpm: 2, tpa: 3, hl: ["dunk"], played: true };
const f0 = H.followers;
S.recordGame(H, g, res);
ok(H.team.w === 1 && H.line.gp === 1 && H.line.pts === 14 && H.career.pts === 14, "game booked to team + lines");
ok(H.followers > f0, "good game gains followers");
ok(S.followerGain(H, -4) < 0, "bad game loses followers");
ok(S.followerGain(H, 8) > S.followerGain(H, 2), "better game, more followers");
const H2 = S.newLife({ seed: 13 });
H2.stage = "college";
H2.followers = 12000;
S.checkDeals(H2);
ok(H2.deals.length === 2 && H2.deals.some((d) => d.b === "Apex Kicks"), "college NIL deals at 2K/10K followers");
H.followers = 50000;
S.checkDeals(H);
ok(H.deals.length === 0, "no deals in high school");
const gm = H.cal.filter((e) => e.k === "game")[1];
H.t = S.evWin(gm)[1] + 1;
S.resolve(H);
ok(gm.s === 2 && gm.res && !gm.res.played, "missed game simulated without the player");

// ---- year end -> signing -> college -> draft
const Y = S.newLife({ seed: 14 });
Y.courses.forEach((c) => c.sc.push({ k: "q", v: 90, d: 0 }));
Y.t = (Y.y0 + Y.ylen) * S.DAY + 8 * 60;
S.resolve(Y);
ok(Y.pend === "signing" && Y.offers.length === 3 && Y.hist.length === 1 && Y.done.length === 4, "HS year end -> signing day with 3 offers");
ok(!S.draftEligible(Y), "HS senior not draft eligible");
S.sign(Y, Y.offers[0]);
ok(Y.stage === "college" && Y.yr === 1 && Y.school === Y.offers[0] && Y.courses.length === 4 && Y.cal.length > 20, "signed: college year 1");
ok(Y.cal.some((e) => /MIDTERM/.test(e.title)) && Y.cal.some((e) => /FINAL/.test(e.title)), "college has midterms + finals");
ok(Y.courses.every((c) => c.room !== "hs"), "college classes in campus halls");
ok(!S.draftEligible(Y), "freshman not eligible mid-year");
Y.t = (Y.y0 + Y.ylen) * S.DAY + 8 * 60;
S.resolve(Y);
ok(Y.pend === "declare" && S.draftEligible(Y), "after year 1: may declare");
const st = S.draftStock(Y);
ok(st >= 0 && st <= 100, "draft stock in range");
const Y2 = JSON.parse(JSON.stringify(Y)) as S.Life;
Y2.p.c = Y2.p.i = Y2.p.s = Y2.p.d = Y2.p.j = 95;
ok(S.draftStock(Y2) > st, "better ratings, better stock");
const Y3 = JSON.parse(JSON.stringify(Y)) as S.Life;
Y3.done.forEach((d) => (d.pts = 4));
const Y4 = JSON.parse(JSON.stringify(Y)) as S.Life;
Y4.done.forEach((d) => (d.pts = 1));
ok(S.draftStock(Y3) > S.draftStock(Y4), "GPA affects draft stock");
ok(S.projPick(90) < S.projPick(40), "higher stock, earlier pick");
S.declare(Y);
const dr = S.runDraft(Y);
ok(dr.board.length === 30 && dr.pick >= 1 && dr.pick <= 60, "draft board");
ok(dr.pick > 30 || dr.board[dr.pick - 1].me === 1, "player on the board at his pick");
S.joinNBA(Y, dr.pick, dr.team);
ok(Y.stage === "nba" && Y.contract && Y.contract.sal > 1e6 && Y.courses.length === 0 && Y.cal.some((e) => e.k === "game"), "NBA: contract, no classes, games");
ok(S.rookieSal(1) > S.rookieSal(20), "rookie scale by pick");
const m0 = Y.money;
const dd = S.dayOf(Y.t);
while (S.dayOf(Y.t) < dd + 8) S.sleep(Y);
ok(Y.money > m0, "NBA paycheck arrives");

// ---- save / load
const s1 = mem();
ok(S.saveLife(Y, s1), "save ok");
const Z = S.loadLife(s1, Y.slot)!;
ok(Z && JSON.stringify(Z) === JSON.stringify(Y), "save/load round trip identical");
ok(S.deserialize("{bad json") === null && S.deserialize('{"x":1}') === null, "corrupt saves rejected");
const old = JSON.parse(S.serialize(Y));
delete old.set;
delete old.diet;
old.v = 1;
const M = S.deserialize(JSON.stringify(old))!;
ok(M && M.set && M.set.alarm === 420 && Array.isArray(M.diet) && M.v === S.LIFE_VER, "older save migrated");
ok(S.slotInfo(Z)!.includes("NBA"), "slot info");

// ---- questions
let bad = 0;
for (let lv = 0; lv <= 4; lv++)
  for (let i = 0; i < 400; i++) {
    const q = genMath(lv, mkRng(i * 31 + lv));
    if (!validQ(q)) {
      bad++;
      if (bad < 4) console.log("bad gen", lv, JSON.stringify(q));
    }
  }
ok(bad === 0, "generated math always valid (" + bad + " bad)");
for (const [sj, rows] of Object.entries(BANK))
  for (const r of rows) {
    const set = new Set([r[2], r[3], r[4], r[5]].map((x) => x.toLowerCase()));
    ok(set.size === 4 && r[1].length > 8 && r[6].length > 3 && r[0] >= 0 && r[0] <= 2, "bank row " + sj + ": " + r[1]);
  }
ok(bankSize() >= 200, "bank has 200+ handwritten questions (" + bankSize() + ")");
for (const sj of ["math", "english", "history", "science", "econ", "psych", "art", "cs"])
  for (const lv of [0, 2, 4]) {
    const qs = quiz(sj, lv, 5, 99);
    ok(qs.length === 5 && qs.every(validQ), "quiz " + sj + " lv" + lv);
    ok(sj === "math" || new Set(qs.map((q) => q.question)).size === 5, "no repeats " + sj);
    ok(JSON.stringify(quiz(sj, lv, 5, 99)) === JSON.stringify(qs), "quiz deterministic " + sj);
  }
const derivs = Array.from({ length: 50 }, (_, i) => genMath(1, mkRng(i)));
ok(derivs.some((q) => /derivative/.test(q.question)), "calc questions at level 1");
// answer correctness spot checks: linear equations
for (let i = 0; i < 200; i++) {
  const q = genMath(0, mkRng(1000 + i));
  const m = q.question.match(/^Solve for x: (\d+)x ([+-]) (\d+) = (-?\d+)$/);
  if (m) {
    const x = (+m[4] - (m[2] === "+" ? +m[3] : -+m[3])) / +m[1];
    ok(+q.choices[q.answer] === x, "linear eq answer " + q.question);
  }
}
ok(screenAI({ lesson: "x", questions: [{ question: "What is 2+2?", choices: ["4", "3", "5", "6"], answer: 0, explain: "" }] }, 5) === null, "AI quiz with < 3 valid questions rejected");
const okAI = screenAI({ lesson: "L", questions: Array.from({ length: 5 }, (_, i) => ({ question: "Q" + i + " what?", choices: ["a", "b", "c", "d"], answer: i % 4, explain: "e" })) }, 5);
ok(okAI && okAI.qs.length === 5 && okAI.qs[0].src === "ai", "valid AI quiz accepted");
ok(!validQ({ question: "dup?", choices: ["a", "a", "b", "c"], answer: 0 }) && !validQ({ question: "idx?", choices: ["a", "b", "c", "d"], answer: 4 }), "validator rejects dupes / bad index");
ok(/ONLY JSON/.test(aiQuizPrompt("Calculus I", "math", 1, 5)), "quiz prompt asks for JSON");

// ---- Hoopr
const P = S.newLife({ seed: 20, p: { n: "ZED" } });
const big: S.GameRes = { us: 40, them: 38, won: true, pts: 22, reb: 7, ast: 5, blk: 2, fgm: 9, fga: 14, tpm: 2, tpa: 4, hl: ["gamewinner", "dunk"], played: true };
const ps = postsFor(P, { k: "game", res: big, opp: "Westbrook Wolves" });
ok(ps.length >= 3 && ps.every((p) => p.x.length > 5 && !/\{\w+\}/.test(p.x)), "game -> several filled posts");
ok(ps.some((p) => /WINNER|ICE|buzzer|game-winner|wins it/i.test(p.x)), "game-winner gets its own posts");
ok(ps.some((p) => p.k === "reporter" && p.x.includes("22")), "reporter posts the line");
const badG: S.GameRes = { ...big, pts: 2, reb: 1, ast: 0, blk: 0, fgm: 1, fga: 9, hl: ["airball"], won: false };
const pb = postsFor(P, { k: "game", res: badG, opp: "X" });
ok(pb.some((p) => p.k === "hater") && pb.some((p) => p.k === "meme"), "bad game: haters + airball meme");
for (const k of ["workout", "late", "skip", "outfit", "eat", "deal", "signing", "declare", "draft", "injury", "rumor", "rank"] as const) {
  const ev: any = { k, what: "x", course: "Calculus I", name: "Gold Chain Drip", place: "Burrito Barn", brand: "Apex Kicks", school: "Northvale University Owls", pick: 7, team: "Lakers" };
  let n = 0;
  for (let s = 0; s < 10; s++) n += postsFor(P, ev, s).length;
  ok(n > 0, "event " + k + " produces posts");
}
ok(postsFor(P, { k: "probation", gpa: 1.7 }).some((p) => /1\.70/.test(p.x)), "probation posts the GPA");
ok(trending(P).length >= 3 && trending(P).every((t) => t.startsWith("#")), "trending tags");
ok(suggestions(P).length >= 3, "suggested posts");
const fl0 = P.followers,
  mp = myPost(P, "Grateful for the team win tonight 🙏 #ZedSzn")!;
ok(mp && mp.post.me && P.followers > fl0 && mp.post.re!.length >= 2 && P.feed[0] === mp.post, "my post: followers + replies + top of feed");
ok(myPost(P, "   ") === null, "empty post rejected");
ok(clean("you are a f4gg0t").hit && !clean("you are a f4gg0t").x.includes("4gg"), "slur masked (leetspeak)");
ok(!clean("spicy burrito at the raccoon tycoon").hit, "no false positives (spicy, raccoon, tycoon)");
const fl = myPost(P, "kys idiot")!;
ok(fl.post.re!.length === 1 && /guidelines/.test(fl.post.re![0].x), "flagged post limited");
ok(scrub("mail me a@b.com or 555-123-4567 http://x.y").indexOf("@b.com") < 0 && !/555/.test(scrub("call 555-123-4567")), "personal data scrubbed");
const ai = screenPosts(P, [
  { handle: "fan_one", name: "Fan", text: "Great game!", likes: 1e9, reposts: 5, kind: "fan" },
  { handle: "nike_guy", name: "x", text: "hi", likes: 1, reposts: 1, kind: "fan" },
  { handle: "abc", name: "y", text: "drinking Gatorade", likes: 1, reposts: 1, kind: "fan" },
  { handle: "def", name: "z", text: "you f4ggot", likes: 1, reposts: 1, kind: "fan" },
  { bad: 1 },
]);
ok(ai.length === 1 && ai[0].lk <= Math.max(50, P.followers * 0.5) && ai[0].ai === 1, "AI posts screened (real brands, slurs, shape, likes capped)");
ok(/PG-13/.test(aiFeedPrompt(P, S.aiSummary(P))) && !/@/.test(JSON.stringify(S.aiSummary(P))), "feed prompt PG-13, summary has no emails");

console.log(fails.length ? "LIFE FAIL\n" + fails.join("\n") : "LIFE OK (" + bankSize() + " bank questions)");
process.exit(fails.length ? 1 : 0);
