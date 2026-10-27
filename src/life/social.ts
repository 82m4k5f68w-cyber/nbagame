// LIFE "Hoopr": a fictional social network. Procedural feed posts from what happens (games, school, life, league
// news), the player's own posts + replies, trending hashtags, follower math, moderation (slur blocklist, personal-data
// scrub, real-brand filter for AI text) and the prompts/screens for AI-written posts. DOM-free (tests/life.ts).
import { mkRng, hashStr, pick, rint, clamp, kfmt, type Rng } from "./rng";
import type { Life, Post, GameRes } from "./state";
import { gpa, STAGE_N, DAY } from "./state";

export type SEv =
  | { k: "game"; res: GameRes; opp: string; big?: string }
  | { k: "dnp"; opp: string; won: boolean; why: string }
  | { k: "workout"; what: string }
  | { k: "class"; course: string; score: number; late?: string }
  | { k: "late"; course: string }
  | { k: "skip"; course: string }
  | { k: "probation"; gpa: number }
  | { k: "grades"; gpa: number }
  | { k: "outfit"; name: string }
  | { k: "eat"; place: string }
  | { k: "deal"; brand: string }
  | { k: "signing"; school: string }
  | { k: "declare" }
  | { k: "draft"; pick: number; team: string }
  | { k: "injury"; what: string }
  | { k: "news"; text: string }
  | { k: "rumor" }
  | { k: "mock"; pick: number }
  | { k: "rank" };

interface Acct {
  h: string;
  n: string;
  k: string;
  v?: number;
}
/** Account pool by voice. Handles are fictional. */
function accts(L: Life): Record<string, Acct[]> {
  const t = L.team.short || "TEAM",
    town = ["Riverton", "Ashgrove", "Bayport"][L.town] || "Riverton",
    nm = (L.p.n || "Rookie").split(" ")[0];
  return {
    fan: [
      { h: "courtside_carl", n: "Courtside Carl", k: "fan" },
      { h: town.toLowerCase() + "_hoops", n: town + " Hoops", k: "fan" },
      { h: t.toLowerCase() + "nation", n: t + " Nation", k: "fan" },
      { h: "buckets4days", n: "Buckets 4 Days", k: "fan" },
      { h: "ballislife_bri", n: "Bri 🏀", k: "fan" },
      { h: "auntie_dee", n: "Auntie Dee", k: "fan" },
    ],
    hater: [
      { h: "fraudwatch", n: "Fraud Watch 🚨", k: "hater" },
      { h: "overrated_ollie", n: "Ollie", k: "hater" },
      { h: "bench_mob_ben", n: "Ben from the Bench", k: "hater" },
    ],
    reporter: [
      { h: "the_beat_" + t.toLowerCase(), n: "The " + t + " Beat", k: "reporter", v: 1 },
      { h: "hoopr_wire", n: "Hoopr Wire", k: "reporter", v: 1 },
      { h: town.toLowerCase() + "_gazette", n: town + " Gazette Sports", k: "reporter", v: 1 },
    ],
    analyst: [
      { h: "draftguru", n: "Draft Guru", k: "analyst", v: 1 },
      { h: "statsheet_sam", n: "Stat Sheet Sam", k: "analyst" },
    ],
    teammate: [{ h: "kofi_buckets", n: "Kofi Banks", k: "teammate" }],
    coach: [{ h: "coach_" + (L.contacts.find((c) => c.id === "coach")?.n.split(" ").pop() || "hart").toLowerCase(), n: L.contacts.find((c) => c.id === "coach")?.n || "Coach", k: "coach", v: 1 }],
    rival: [{ h: "jace_holloway", n: "Jace Holloway", k: "rival" }],
    brand: [
      { h: "apexkicks", n: "Apex Kicks", k: "brand", v: 1 },
      { h: "burritobarn", n: "Burrito Barn", k: "brand", v: 1 },
      { h: "glacierdrink", n: "Glacier Sports Drink", k: "brand", v: 1 },
    ],
    meme: [
      { h: "courtmemes", n: "Court Memes", k: "meme" },
      { h: "airball_archive", n: "Airball Archive", k: "meme" },
    ],
    friend: [{ h: "dre_mills", n: "Dre Mills", k: "friend" }],
    news: [{ h: "hoopr_news", n: "Hoopr News", k: "news", v: 1 }],
  };
}
/** Template lines by voice; {n} name, {t} team, {o} opponent, {p} pts, {r} reb, {a} ast, {s} school, {x} extra. */
const T: Record<string, string[]> = {
  fan_bigwin: ["{n} went OFF tonight 🔥 {p} points and the dub!", "{p} for {n}?? somebody check on {o} 😭", "I was THERE. {n} is different. {t} wins!", "Put {n} on a poster. {p}/{r}/{a}. That's a bucket.", "{n} said 'my house' tonight 🏠🔥", "we not talking about anything else today. {n}. {p}. W.", "{t} fans eating GOOD tonight 🍽️ {n} cooked"],
  fan_win: ["Big W for the {t}! {n} with {p} 👏", "Solid night from {n}. {p} pts, {r} boards. On to the next.", "{t} get it done vs {o} ✅", "Love how {n} plays the right way. Team win."],
  fan_loss: ["Tough one vs {o}. {n} still gave us {p}. Heads up 🙏", "We'll bounce back. {n} keep shooting 🏀", "Can't win them all. Proud of the {t}."],
  hater_bad: ["{p} points?? and they call {n} a prospect 💀", "{n} fans real quiet right now 🤫", "Exposed. {o} figured {n} out in one game.", "Somebody tell {n} the rim is the orange thing 🎯", "This is your future star? {p} points? ok buddy"],
  hater_good: ["{p} vs {o}? they're terrible, relax 🙄", "Stat padding in a {x} game. Wake me up when it's a real opponent.", "Ok {n} had a night. Do it again and I'll talk.", "{n} cooking a bad defense isn't news lol"],
  reporter_game: ["FINAL: {t} {us}, {o} {them}. {n}: {p} PTS, {r} REB, {a} AST ({fg} FG).", "{n} led {t} with {p} points in a {us}-{them} {wl} over {o}.", "Postgame: {n} finished {p}/{r}/{a}. {t} move to {rec}."],
  analyst_good: ["{n}'s stock is RISING. {p} pts on {fg}. Scouts noticed.", "Efficiency check: {n} {fg} FG tonight. That plays at the next level.", "{n} keeps checking boxes: scoring, rebounding ({r}), playmaking ({a})."],
  analyst_bad: ["Concern: {n} {fg} FG tonight. Shot selection needs work.", "One game doesn't define a prospect, but {n} looked rushed vs {o}."],
  teammate_win: ["my guy {n} 💪💪 dub", "{n} told me before the game he was gonna cook. he cooked 🍳", "team dinner on {n} after that one 😂"],
  teammate_loss: ["we'll get it back. locked in for the next one 🔒", "film tomorrow. heads up fellas"],
  rival_any: ["{p} points? cute. see you soon {n} 😴", "they hype anybody these days fr", "{n} ain't ready for me. mark my words", "all that and still not top 5 in the conference 🥱"],
  meme_air: ["AIRBALL of the night goes to... {n} 😭😭", "the rim filed a missing person report on that {n} shot", "{n} shooting like the hoop owes him money (it doesn't)"],
  meme_dunk: ["{o}'s defender needs a moment of silence after that {n} dunk 🪦", "{n} put somebody on a T-shirt tonight 👕💥"],
  fan_gw: ["GAME WINNER!!! {n}!!!!!! 🤯🤯🤯", "{n} ICE IN THE VEINS 🧊 GAME OVER", "I'm screaming. {n} at the buzzer. {t} WIN!!!"],
  news_gw: ["{n} hits the game-winner as {t} edge {o} {us}-{them}. #ClutchGene", "Clutch: {n} wins it late for {t}."],
  coach_win: ["Proud of the fight tonight. {n} set the tone. Back to work tomorrow.", "Team win. Defense travels. 👊"],
  dnp: ["{n} not with {t} tonight ({x}). {t} {wl} vs {o}.", "No {n} for {t} vs {o} ({x})."],
  workout: ["early mornings > excuses 💪 #grind", "{n} spotted at the gym again. the work never stops", "Iron Temple regular {n} back at it 🏋️"],
  class_good: ["{n} aced a {x} quiz?? student-athlete for real 📚", "{n} in the front row of {x}. scholar szn 🤓"],
  class_late: ["{n} sprinting across campus to {x} 😂 late again", "spotted {n} walking into {x} 15 mins late lmao"],
  skip: ["Hearing {n} skipped {x}... coach won't love that 👀"],
  probation: ["REPORT: {n} academically ineligible (GPA {x}). {t} will be without their star.", "{n} on academic probation?! hit the books my guy 📚"],
  grades: ["{n} made the Dean's List ({x} GPA). Student first 👏"],
  outfit: ["{n} pulled up in the {x} fit 🔥 drip check passed", "the fit tho 👀 {n} in that {x}", "{n} best dressed on campus, not close"],
  eat: ["{n} at {x} again lol. bro lives there 🌯", "spotted: {n} at {x}. ordered the usual"],
  deal: ["{n} x {x} 🤝 OFFICIAL", "Big news: {n} signs with {x}. The bag is secured 💰"],
  brand_deal: ["Welcome to the family, {n}. #{x}Fam 👟", "{n} joins {x}. Let's go 🔥"],
  signing: ["{n} commits to {s}! 🎓🏀", "OFFICIAL: {n} picks {s}. The recruiting saga is over."],
  declare: ["{n} declares for the Draft! 🚀", "It's official: {n} is going pro."],
  draft: ["With the #{x} pick, the {s} select... {n}! 🧢", "{n} goes #{x} to the {s}. Dream come true."],
  injury: ["Injury update: {n} ({x}) is day-to-day.", "Prayers up for {n} 🙏 {x}"],
  rumor: ["Sources: multiple teams have scouts at {t} games to watch {n}.", "Rumor: {n} is on a lot of draft boards. Stock watch 📈", "Hearing {n} has been working on his jumper every morning at 6 AM."],
  mock: ["MOCK DRAFT 3.0: {n} goes #{x}. Upside is real.", "Big board update: {n} at #{x}. Combine numbers turned heads.", "Hearing {n} could go as high as #{x}. Workouts went well 👀", "My mock has {n} at #{x}. Don't sleep on the motor."],
  rank: ["Power rankings this week: {t} at #{x}. {n} the reason why.", "Hoopr Top 25 prospects: {n} checks in at #{x}."],
};
/** Recent big performance flags from a stat line. */
const tier = (r: GameRes) => {
  const sc = r.pts + r.reb * 0.7 + r.ast * 0.9 + r.blk;
  return sc >= 22 ? "big" : sc >= 10 ? "ok" : "bad";
};
function fill(s: string, d: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (d[k] != null ? String(d[k]) : ""));
}
let PID = 0;
function post(L: Life, a: Acct, x: string, r: Rng, boost = 1): Post {
  const reach = Math.max(30, L.followers) * (a.v ? 0.12 : 0.03) * boost,
    lk = Math.round(reach * (0.3 + r() * 0.9)) + rint(r, 0, 20);
  return { id: "p" + L.t + "_" + PID++ + "_" + (hashStr(x) % 997), t: L.t, h: a.h, n: a.n, x, lk, rp: Math.round(lk * (0.05 + r() * 0.15)), k: a.k, v: a.v };
}
/** Posts for one event (1-4, mixed voices). Deterministic for a seed. */
export function postsFor(L: Life, ev: SEv, seed = L.t + L.seed): Post[] {
  const r = mkRng(hashStr(ev.k + seed)),
    A = accts(L),
    n = L.p.n,
    t = L.team.short,
    out: Post[] = [];
  const add = (voice: string, key: string, d: Record<string, string | number> = {}, boost = 1) => {
    const lines = T[key];
    if (!lines) return;
    const a = pick(r, A[voice] || A.fan);
    out.push(post(L, a, fill(pick(r, lines), { n, t, ...d }), r, boost));
  };
  switch (ev.k) {
    case "game": {
      const g = ev.res,
        d = { o: ev.opp, p: g.pts, r: g.reb, a: g.ast, us: g.us, them: g.them, wl: g.won ? "win" : "loss", rec: L.team.w + "-" + L.team.l, fg: g.fgm + "/" + g.fga, x: g.won ? "blowout" : "loss" },
        tr = tier(g);
      if (g.hl.includes("gamewinner")) add("fan", "fan_gw", d, 3), add("news", "news_gw", d, 2);
      add("reporter", "reporter_game", d, 1.4);
      if (tr === "big") add("fan", g.won ? "fan_bigwin" : "fan_loss", d, 1.6), add("analyst", "analyst_good", d), r() < 0.7 && add("hater", "hater_good", d);
      else if (tr === "ok") add("fan", g.won ? "fan_win" : "fan_loss", d);
      else add("hater", "hater_bad", d, 1.2), r() < 0.5 && add("analyst", "analyst_bad", d);
      if (g.hl.includes("airball")) add("meme", "meme_air", d, 1.5);
      if (g.hl.includes("dunk")) add("meme", "meme_dunk", d, 1.3);
      if (r() < 0.5) add("teammate", g.won ? "teammate_win" : "teammate_loss", d);
      if (g.won && r() < 0.3) add("coach", "coach_win", d);
      if (r() < 0.25 || ev.big) add("rival", "rival_any", d);
      break;
    }
    case "dnp":
      add("reporter", "dnp", { o: ev.opp, wl: ev.won ? "win" : "lose", x: ev.why });
      break;
    case "workout":
      if (r() < 0.6) add(r() < 0.5 ? "fan" : "friend", "workout");
      break;
    case "class":
      if (ev.score >= 90 && r() < 0.6) add("fan", "class_good", { x: ev.course });
      else if (ev.late && r() < 0.6) add("meme", "class_late", { x: ev.course });
      break;
    case "late":
      add("meme", "class_late", { x: ev.course });
      break;
    case "skip":
      add("hater", "skip", { x: ev.course });
      break;
    case "probation":
      add("reporter", "probation", { x: ev.gpa.toFixed(2) }, 1.5), add("hater", "probation", { x: ev.gpa.toFixed(2) });
      break;
    case "grades":
      add("reporter", "grades", { x: ev.gpa.toFixed(2) });
      break;
    case "outfit":
      add(r() < 0.6 ? "fan" : "friend", "outfit", { x: ev.name });
      break;
    case "eat":
      if (r() < 0.45) add("fan", "eat", { x: ev.place });
      if (/Burrito Barn/.test(ev.place) && r() < 0.3) out.push(post(L, A.brand[1], `Spotted: ${n} at the Barn 🌯 Order what ${n.split(" ")[0]} orders.`, r));
      break;
    case "deal":
      add("reporter", "deal", { x: ev.brand }, 1.5);
      out.push(post(L, A.brand.find((b) => ev.brand.startsWith(b.n.split(" ")[0])) || A.brand[0], fill(pick(r, T.brand_deal), { n, x: ev.brand.split(" ")[0] }), r, 2));
      break;
    case "signing":
      add("reporter", "signing", { s: ev.school }, 2), add("fan", "signing", { s: ev.school });
      break;
    case "declare":
      add("news", "declare", {}, 2), add("analyst", "rumor");
      break;
    case "draft":
      add("news", "draft", { x: ev.pick, s: ev.team }, 3), add("fan", "draft", { x: ev.pick, s: ev.team }, 2);
      break;
    case "injury":
      add("reporter", "injury", { x: ev.what });
      break;
    case "news":
      out.push(post(L, A.news[0], ev.text, r, 0.8));
      break;
    case "rumor":
      add("analyst", "rumor");
      break;
    case "mock":
      add("analyst", "mock", { x: ev.pick > 60 ? 45 : ev.pick }, 1.5), add("reporter", "mock", { x: Math.max(1, ev.pick - 2) });
      break;
    case "rank":
      add("analyst", "rank", { x: clamp(26 - Math.round(L.rep / 4), 1, 25) });
      break;
  }
  return out;
}
/** Hashtags trending for this state (most relevant first). */
export function trending(L: Life): string[] {
  const nm = (L.p.n || "Rookie").replace(/[^A-Za-z]/g, ""),
    t = (L.team.name.split(" ").pop() || "Team").replace(/[^A-Za-z]/g, "");
  const out = ["#" + t + "Nation", "#" + nm + "Szn"];
  const last = L.log.slice(-6).map((e) => e.k);
  if (last.includes("game")) out.unshift("#" + nm);
  if (L.stage === "college") out.push(L.yr >= 1 ? "#DraftWatch" : "#Freshman", "#MarchMadness");
  if (L.stage === "hs") out.push("#SigningDay", "#StateChamps");
  if (L.stage === "nba") out.push("#RookieWatch", "#RookieSzn");
  if (probation_(L)) out.unshift("#HitTheBooks");
  if (L.deals.length) out.push("#" + L.deals[L.deals.length - 1].b.split(" ")[0] + "Fam");
  return Array.from(new Set(out)).slice(0, 6);
}
const probation_ = (L: Life) => {
  const g = gpa(L);
  return g != null && g < 2 && L.courses.reduce((a, c) => a + c.sc.length, 0) >= 3;
};
/** Add posts to the feed (newest first, capped). */
export function pushPosts(L: Life, ps: Post[]) {
  if (!ps.length) return;
  L.feed.unshift(...ps);
  if (L.feed.length > 150) L.feed.length = 150;
  L.tags = trending(L);
}

// ---------------------------------------------------------------- the player's own posts
/** Slur / hate blocklist (lowercase stems, leetspeak-folded before matching). Masked, never shown or sent. */
const BLOCK = ["nigg", "fagg", "retard", "tranny", "wetback", "raghead", "towelhead", "cunt", "whore", "killyourself"],
  BLOCKW = new Set(["fag", "fags", "kike", "kikes", "spic", "spics", "chink", "chinks", "gook", "gooks", "coon", "coons", "dyke", "dykes", "beaner", "beaners", "slut", "sluts", "nazi", "nazis", "kys"]);
const fold = (s: string) => s.toLowerCase().replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4@]/g, "a").replace(/0/g, "o").replace(/[5$]/g, "s").replace(/7/g, "t");
/** Mask blocklisted words (whole tokens containing a blocked stem). Returns the cleaned text and whether it hit. */
export function clean(text: string): { x: string; hit: boolean } {
  let hit = false;
  const x = String(text).replace(/[^\s]+/g, (w) => {
    const f = fold(w).replace(/[^a-z]/g, "");
    if (BLOCKW.has(f) || BLOCK.some((b) => f.includes(b))) {
      hit = true;
      return "*".repeat(Math.min(8, w.length));
    }
    return w;
  });
  return { x, hit };
}
/** Strip personal data before anything leaves the device: emails, phone numbers, URLs, @mentions of real handles. */
export function scrub(text: string): string {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .slice(0, 280);
}
/** Real brands / platforms that must never appear in AI-written posts (the game only uses fictional ones). */
const REAL = /\b(nike|adidas|jordan brand|puma|under ?armour|reebok|new balance|gatorade|powerade|espn|twitter|tweet|instagram|tiktok|snapchat|facebook|youtube|chipotle|mcdonald|starbucks|subway|pepsi|coca[- ]?cola|sprite|red ?bull|apple|samsung|google|amazon|bleacher report|sportscenter)\b/i;
/** Suggested posts for the compose sheet. */
export function suggestions(L: Life): string[] {
  const g = [...L.log].reverse().find((e) => e.k === "game");
  const s = ["Locked in. 🔒", "Grateful for every rep 🙏", "Back in the gym tomorrow. Same time. 💪"];
  if (g && /^W/.test(g.d)) s.unshift("Big team win tonight! Thank you for the love 🏀❤️");
  else if (g) s.unshift("We'll be back. Learn and move forward. 💯");
  if (L.stage !== "nba") s.push("Student-athlete. Emphasis on student 📚");
  s.push(pick(mkRng(L.t), ["Burrito Barn after practice is a lifestyle 🌯", "Fit check before the game 👀", "Shoutout to my mom for everything ❤️"]));
  return s.slice(0, 5);
}
/** Score a post the player wrote: engagement multiplier from length, hashtags, mood of the text and current fame. */
export function postValue(L: Life, x: string): number {
  const len = x.trim().length,
    tags = (x.match(/#\w+/g) || []).length,
    pos = /(thank|grate|love|team|work|grind|family|proud|bless|🙏|❤️|💪)/i.test(x) ? 1.2 : 1,
    neg = /(ref|trash|hate|fraud|whatever|🤡)/i.test(x) ? 0.8 : 1,
    recent = L.log.slice(-4).some((e) => e.k === "game") ? 1.3 : 1;
  return clamp((len < 6 ? 0.4 : len > 200 ? 0.8 : 1) * (1 + Math.min(2, tags) * 0.1) * pos * neg * recent, 0.2, 2.5);
}
/** Publish the player's post locally: likes, new followers and procedural replies. */
export function myPost(L: Life, text: string, seed = L.t): { post: Post; gain: number } | null {
  const c = clean(String(text).slice(0, 280));
  if (!c.x.trim()) return null;
  const r = mkRng(hashStr(c.x + seed)),
    v = postValue(L, c.x) * (c.hit ? 0.2 : 1);
  const lk = Math.round(Math.max(3, L.followers) * 0.08 * v * (0.6 + r() * 0.8)),
    gain = Math.round(Math.max(1, L.followers * 0.004 * v * (0.5 + r())) + (r() < 0.1 ? L.followers * 0.02 : 0));
  const p: Post = { id: "me" + L.t + "_" + PID++, t: L.t, h: handleOf(L), n: L.p.n, x: c.x, lk, rp: Math.round(lk * 0.1), k: "me", me: 1, re: replies(L, c.x, r, c.hit) };
  L.followers += gain;
  pushPosts(L, [p]);
  return { post: p, gain };
}
export const handleOf = (L: Life) => (L.p.n || "rookie").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "rookie";
/** Procedural replies to the player's post (tone follows the text and the recent games). */
export function replies(L: Life, x: string, r: Rng, flagged = false): Post[] {
  const A = accts(L),
    n = L.p.n.split(" ")[0],
    out: Post[] = [];
  if (flagged) {
    out.push(post(L, A.news[0], "This post was limited for violating Hoopr community guidelines.", r));
    return out;
  }
  const win = L.log.slice(-4).some((e) => e.k === "game" && /^W/.test(e.d)),
    loss = L.log.slice(-4).some((e) => e.k === "game" && /^L/.test(e.d));
  const F = ["🔥🔥🔥", "LETS GOOO " + n.toUpperCase(), "we ride with you " + n + " 🙌", "this is the one", "real ones been here since day 1", "🐐🐐", "my favorite player fr", "can't wait for the next game!!"],
    H = ["ratio", "say less, play more", "post less, practice more 🤡", "who asked lol", "we'll see"],
    M = ["the caption 😭", "posting through it", "bro wrote an essay", "admin is cooking"],
    S = ["sign my jersey pls 🙏", "can you follow back? 🥺", "shoutout plz!!", "you inspired me to try out for my team"];
  const k = 2 + Math.floor(r() * 3);
  for (let i = 0; i < k; i++) {
    const u = r();
    if (u < 0.45) out.push(post(L, pick(r, A.fan), pick(r, F), r, 0.4));
    else if (u < (loss ? 0.75 : 0.6)) out.push(post(L, pick(r, A.hater), pick(r, H), r, 0.3));
    else if (u < 0.8) out.push(post(L, pick(r, A.meme), pick(r, M), r, 0.3));
    else out.push(post(L, pick(r, A.fan), pick(r, S), r, 0.2));
  }
  if (win && r() < 0.6) out.push(post(L, A.teammate[0], "my guy 🤝", r, 0.5));
  if (/burrito/i.test(x)) out.push(post(L, A.brand[1], "We'll have your order ready 🌯😉", r, 0.6));
  return out;
}

// ---------------------------------------------------------------- AI-written posts (artifact `sample` capability)
export function aiFeedPrompt(L: Life, sum: any, n = 6) {
  return `You write posts for "Hoopr", a FICTIONAL social network inside a family-friendly basketball life-sim game.
Write ${n} short posts reacting to the player's recent events below, from varied fictional accounts: fans, a hater (playful, never hateful), a beat reporter, a draft analyst, a teammate, a meme account.
Rules: PG-13; no slurs, no profanity, no threats, no real people, no real companies, brands, apps or platforms (only the fictional ones named in the data); handles are lowercase, fictional, 3-20 chars; each text under 200 characters; emojis OK.
Game data (JSON): ${JSON.stringify(sum)}
Reply with ONLY a JSON array: [{"handle":"...","name":"...","text":"...","likes":123,"reposts":12,"kind":"fan|hater|reporter|analyst|teammate|meme"}]`;
}
export function aiReplyPrompt(L: Life, sum: any, text: string) {
  return `You write replies on "Hoopr", a FICTIONAL social network in a family-friendly basketball life-sim game.
The player "${L.p.n}" just posted: ${JSON.stringify(scrub(clean(text).x))}
Context (JSON): ${JSON.stringify(sum)}
Write 3 short replies from varied fictional accounts (fans, a playful hater, a teammate or a meme account) that react to the post and the context.
Rules: PG-13; no slurs, profanity, threats, real people, real companies/brands/apps; handles lowercase fictional 3-20 chars; each text under 160 characters.
Reply with ONLY a JSON array: [{"handle":"...","name":"...","text":"...","likes":12,"reposts":1,"kind":"fan|hater|teammate|meme"}]`;
}
/** Validate + moderate AI posts: shape, lengths, blocklist, real-brand filter; numbers clamped to the player's reach. */
export function screenPosts(L: Life, arr: any, max = 8): Post[] {
  if (!Array.isArray(arr)) return [];
  const out: Post[] = [];
  for (const a of arr.slice(0, max)) {
    if (!a || typeof a.text !== "string" || typeof a.handle !== "string") continue;
    const h = a.handle.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "").slice(0, 20),
      nm = String(a.name || h).slice(0, 30);
    if (h.length < 3 || !a.text.trim() || a.text.length > 280) continue;
    if (REAL.test(a.text) || REAL.test(h.replace(/_/g, " ")) || REAL.test(nm)) continue;
    const c = clean(a.text);
    if (c.hit || clean(nm).hit || clean(h).hit) continue;
    const cap = Math.max(50, L.followers * 0.5),
      lk = clamp(Math.round(+a.likes || 0), 0, cap);
    out.push({ id: "ai" + L.t + "_" + PID++, t: L.t, h, n: nm, x: c.x, lk, rp: clamp(Math.round(+a.reposts || 0), 0, lk), k: /^(fan|hater|reporter|analyst|teammate|meme|coach|rival|news|friend)$/.test(a.kind) ? a.kind : "fan", ai: 1 });
  }
  return out;
}
/** Followers -> fame tier label. */
export const fameTier = (f: number) => (f >= 1e6 ? "Global icon" : f >= 1e5 ? "National star" : f >= 1e4 ? "Regional name" : f >= 1e3 ? "Local buzz" : "Unknown");
export const ago = (now: number, t: number) => {
  const m = Math.max(0, now - t);
  return m < 1 ? "now" : m < 60 ? m + "m" : m < DAY ? Math.floor(m / 60) + "h" : Math.floor(m / DAY) + "d";
};
export { kfmt, STAGE_N };
