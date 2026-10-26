// LIFE quiz questions: a procedural math generator (difficulty by level 0 = HS .. 4 = college senior), the handwritten
// bank (qbank.ts) for every other subject, and the validator that also screens AI-generated questions. DOM-free.
import { mkRng, hashStr, pick, rint, shuffle, type Rng } from "./rng";
import { BANK, LESSONS, type QRow } from "./qbank";

export interface Q {
  question: string;
  choices: string[]; // exactly 4, distinct
  answer: number; // index into choices
  explain: string;
  src?: "gen" | "bank" | "ai";
}
/** A question is usable when it has a prompt, 4 distinct non-empty choices and a valid answer index. */
export function validQ(q: any): q is Q {
  if (!q || typeof q.question !== "string" || q.question.trim().length < 4 || q.question.length > 400) return false;
  if (!Array.isArray(q.choices) || q.choices.length !== 4) return false;
  const cs = q.choices.map((c: any) => String(c ?? "").trim());
  if (cs.some((c: string) => !c || c.length > 160)) return false;
  if (new Set(cs.map((c: string) => c.toLowerCase())).size !== 4) return false;
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) return false;
  return true;
}
/** Build a Q from a correct answer + three distractors (shuffled deterministically). */
function mk(r: Rng, question: string, right: string | number, wrong: (string | number)[], explain: string, src: Q["src"] = "gen"): Q {
  const all = [String(right), ...wrong.map(String)];
  // de-duplicate distractors (a generator can collide): nudge numeric ones
  const FILL = ["None of these", "Cannot be determined", "All of these"];
  for (let i = 1; i < all.length; i++) {
    let g = 0;
    while (all.indexOf(all[i]) !== i && g++ < 20) {
      const n = parseFloat(all[i]);
      all[i] = isFinite(n) && String(n) === all[i] ? String(n + i + g) : FILL[(i + g) % 3];
    }
  }
  const order = shuffle(r, [0, 1, 2, 3]);
  return { question, choices: order.map((k) => all[k].trim()), answer: order.indexOf(0), explain, src };
}
const near = (r: Rng, v: number, spread: number) => {
  const s = new Set<number>([v]),
    out: number[] = [];
  let guard = 0;
  while (out.length < 3 && guard++ < 50) {
    const d = rint(r, 1, spread) * (r() < 0.5 ? -1 : 1),
      x = v + d;
    if (!s.has(x)) s.add(x), out.push(x);
  }
  while (out.length < 3) out.push(v + out.length + 7);
  return out;
};
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const poly = (a: number, b: number, c: number) => {
  let s = "";
  const t = (k: number, v: string) => (k === 0 ? "" : (k < 0 ? " - " : s ? " + " : "") + (Math.abs(k) === 1 && v ? "" : Math.abs(k)) + v);
  s += t(a, "x²");
  s += t(b, "x");
  s += c ? (c < 0 ? " - " : s ? " + " : "") + Math.abs(c) : "";
  return (s || "0").replace(/^ \+ /, "").replace(/^ - /, "-");
};

/** One generated math question at level lv (0..4). Every kind's answer is computed, never typed. */
export function genMath(lv: number, r: Rng): Q {
  const kinds: number[][] = [
    [0, 1, 2, 3, 4, 5], // HS: arithmetic %, linear eq, slope, exponents, area, averages
    [1, 3, 6, 7, 8], // Calc I: linear, exponents, derivative, limit-ish, quadratics
    [5, 9, 10, 11, 12], // Stats: mean, median, probability, combinations, expected value
    [6, 13, 14, 8, 7], // Calc II: derivatives, integrals, logs
    [15, 16, 17, 13, 10], // Linear algebra: det, dot product, matrix-vector, integrals
  ];
  const k = pick(r, kinds[Math.max(0, Math.min(4, lv))]);
  switch (k) {
    case 0: {
      const p = pick(r, [10, 20, 25, 30, 40, 50, 60, 75]),
        n = rint(r, 2, 12) * 20,
        v = (p * n) / 100;
      return mk(r, `What is ${p}% of ${n}?`, v, near(r, v, Math.max(3, v / 4 | 0)), `${p}% of ${n} = ${p}/100 x ${n} = ${v}.`);
    }
    case 1: {
      const a = rint(r, 2, 9),
        x = rint(r, -9, 12),
        b = rint(r, -20, 20),
        c = a * x + b;
      return mk(r, `Solve for x: ${a}x ${b < 0 ? "- " + -b : "+ " + b} = ${c}`, x, near(r, x, 4), `Subtract ${b} from both sides, then divide by ${a}: x = (${c} - ${b}) / ${a} = ${x}.`);
    }
    case 2: {
      const x1 = rint(r, -5, 5),
        y1 = rint(r, -5, 5),
        m = rint(r, -4, 4) || 2,
        dx = rint(r, 1, 4),
        x2 = x1 + dx,
        y2 = y1 + m * dx;
      return mk(r, `What is the slope of the line through (${x1}, ${y1}) and (${x2}, ${y2})?`, m, near(r, m, 3), `Slope = (y2 - y1)/(x2 - x1) = ${y2 - y1}/${dx} = ${m}.`);
    }
    case 3: {
      const b = rint(r, 2, 5),
        e1 = rint(r, 2, 5),
        e2 = rint(r, 1, 4);
      return mk(r, `Simplify: ${b}^${e1} x ${b}^${e2}`, `${b}^${e1 + e2}`, [`${b}^${e1 * e2}`, `${b * b}^${e1 + e2}`, `${b}^${Math.abs(e1 - e2) || e1 + e2 + 1}`], `Same base: add the exponents, ${e1} + ${e2} = ${e1 + e2}.`);
    }
    case 4: {
      const rr = rint(r, 2, 9);
      return mk(r, `A circle has radius ${rr}. Its area is:`, `${rr * rr}π`, [`${2 * rr}π`, `${rr}π`, `${rr * rr * 2}π`], `Area = πr² = π x ${rr}² = ${rr * rr}π.`);
    }
    case 5: {
      const n = rint(r, 4, 6),
        xs = Array.from({ length: n }, () => rint(r, 8, 30));
      const s = xs.reduce((a, b) => a + b, 0);
      xs[n - 1] += (n - (s % n)) % n; // make the mean an integer
      const m = xs.reduce((a, b) => a + b, 0) / n;
      return mk(r, `A player scores ${xs.join(", ")} points in ${n} games. What is the mean?`, m, near(r, m, 3), `Sum ${xs.reduce((a, b) => a + b, 0)} divided by ${n} games = ${m}.`);
    }
    case 6: {
      const a = rint(r, 1, 6),
        n = rint(r, 2, 5),
        b = rint(r, -6, 6);
      const right = `${a * n === 1 ? "" : a * n}x${n - 1 === 1 ? "" : "^" + (n - 1)}${b ? (b < 0 ? " - " : " + ") + Math.abs(b) : ""}`;
      return mk(r, `Find the derivative of f(x) = ${a === 1 ? "" : a}x^${n} + ${b}x`.replace("+ -", "- "), right, [`${a}x^${n - 1}${b ? (b < 0 ? " - " : " + ") + Math.abs(b) : ""}`, `${a * n}x^${n}${b ? (b < 0 ? " - " : " + ") + Math.abs(b) : ""}`, `${a * n}x^${n - 1}`], `Power rule: d/dx ax^n = n·a·x^(n-1); the derivative of ${b}x is ${b}.`);
    }
    case 7: {
      const a = rint(r, 1, 9),
        b = rint(r, 1, 9);
      return mk(r, `What is the limit as x → ∞ of (${a}x + ${b}) / x?`, a, near(r, a, 3).map((v) => Math.abs(v) + (v === 0 ? 10 : 0)), `Divide through by x: ${a} + ${b}/x → ${a}.`);
    }
    case 8: {
      const p = rint(r, -6, 6),
        q = rint(r, -6, 6);
      const b = -(p + q),
        c = p * q;
      const lo = Math.min(p, q),
        hi = Math.max(p, q);
      return mk(r, `Find the roots of ${poly(1, b, c)} = 0`, lo === hi ? `x = ${lo}` : `x = ${lo}, ${hi}`, [`x = ${-hi}, ${-lo}`, `x = ${lo + 1}, ${hi + 1}`, `x = ${lo * 2}, ${hi}`], `It factors as (x ${-p < 0 ? "- " + p : "+ " + -p})(x ${-q < 0 ? "- " + q : "+ " + -q}).`);
    }
    case 9: {
      const n = 5,
        xs = Array.from({ length: n }, () => rint(r, 1, 40)),
        so = xs.slice().sort((a, b) => a - b);
      return mk(r, `What is the median of ${xs.join(", ")}?`, so[2], [so[1], so[3], Math.round(xs.reduce((a, b) => a + b, 0) / n)], `Sorted: ${so.join(", ")}. The middle value is ${so[2]}.`);
    }
    case 10: {
      const mk2 = rint(r, 3, 9),
        tot = 10;
      const right = `${mk2 * mk2}/100`;
      return mk(r, `A ${mk2 * 10}% free-throw shooter takes two independent shots. What's P(both go in)?`, right, [`${mk2 * 2}/10`, `${mk2}/10`, `${mk2 * mk2 + tot}/100`], `Independent events multiply: ${mk2}/10 x ${mk2}/10 = ${mk2 * mk2}/100.`);
    }
    case 11: {
      const n = rint(r, 5, 9),
        kk = rint(r, 2, 3);
      const c = kk === 2 ? (n * (n - 1)) / 2 : (n * (n - 1) * (n - 2)) / 6;
      return mk(r, `How many ways can a coach choose ${kk} captains from ${n} players (order doesn't matter)?`, c, near(r, c, 6).map((v) => Math.max(1, v)), `C(${n}, ${kk}) = ${c}.`);
    }
    case 12: {
      const p = pick(r, [0.3, 0.35, 0.4, 0.45, 0.5]),
        n = rint(r, 4, 10),
        e = +(3 * p * n).toFixed(2);
      return mk(r, `A ${Math.round(p * 100)}% three-point shooter takes ${n} threes. Expected points from them?`, fmtN(e), [fmtN(+(p * n).toFixed(2)), fmtN(+(2 * p * n).toFixed(2)), fmtN(3 * n)], `Expected value = 3 points x ${p} x ${n} = ${fmtN(e)}.`);
    }
    case 13: {
      const a = rint(r, 1, 4),
        n = rint(r, 1, 3),
        up = rint(r, 1, 3);
      // ∫0..up (n+1)·a x^n dx = a·up^(n+1)
      const coef = a * (n + 1),
        v = a * Math.pow(up, n + 1);
      return mk(r, `Evaluate the integral of ${coef}x${n > 1 ? "^" + n : ""} dx from 0 to ${up}.`, v, near(r, v, Math.max(2, v / 3 | 0)).map((x) => Math.max(0, x)), `Antiderivative ${a}x^${n + 1}; at ${up}: ${a} x ${up}^${n + 1} = ${v}.`);
    }
    case 14: {
      const b = pick(r, [2, 3, 10]),
        e = rint(r, 1, 5),
        v = Math.pow(b, e);
      return mk(r, `What is log base ${b} of ${v}?`, e, near(r, e, 2).map((x) => Math.abs(x) + (x === 0 ? e + 2 : 0)), `${b}^${e} = ${v}, so the log is ${e}.`);
    }
    case 15: {
      const a = rint(r, -5, 6),
        b = rint(r, -5, 6),
        c = rint(r, -5, 6),
        d = rint(r, -5, 6),
        det = a * d - b * c;
      return mk(r, `Find the determinant of [[${a}, ${b}], [${c}, ${d}]].`, det, [a * d + b * c, a * b - c * d, det + rint(r, 1, 4)], `det = ad - bc = ${a}·${d} - ${b}·${c} = ${det}.`);
    }
    case 16: {
      const u = [rint(r, -4, 5), rint(r, -4, 5), rint(r, -4, 5)],
        w = [rint(r, -4, 5), rint(r, -4, 5), rint(r, -4, 5)],
        dt = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
      return mk(r, `Compute the dot product of (${u.join(", ")}) and (${w.join(", ")}).`, dt, near(r, dt, 5), `Multiply matching parts and add: ${u.map((x, i) => x + "·" + w[i]).join(" + ")} = ${dt}.`);
    }
    default: {
      const a = rint(r, 1, 4),
        b = rint(r, -3, 3),
        c = rint(r, -3, 3),
        d = rint(r, 1, 4),
        x = rint(r, -3, 3),
        y = rint(r, -3, 3);
      const v1 = a * x + b * y,
        v2 = c * x + d * y;
      return mk(r, `Multiply [[${a}, ${b}], [${c}, ${d}]] by the vector (${x}, ${y}).`, `(${v1}, ${v2})`, [`(${v2}, ${v1})`, `(${a * x + c * y}, ${b * x + d * y})`, `(${v1 + 1}, ${v2 - 1})`], `Row times vector: (${a}·${x} + ${b}·${y}, ${c}·${x} + ${d}·${y}) = (${v1}, ${v2}).`);
    }
  }
}
/** Bank rows for subject at a level band (0 HS, 1 = years 1-2, 2 = years 3-4); falls back to neighbouring bands. */
function rowsFor(subj: string, lv: number): QRow[] {
  const all = BANK[subj] || BANK.history,
    band = lv <= 0 ? 0 : lv <= 2 ? 1 : 2;
  let rows = all.filter((q) => q[0] === band);
  if (rows.length < 6) rows = all.filter((q) => Math.abs(q[0] - band) <= 1);
  if (rows.length < 6) rows = all;
  return rows;
}
export function bankQ(row: QRow, r: Rng): Q {
  return mk(r, row[1], row[2], [row[3], row[4], row[5]], row[6], "bank");
}
/** n quiz questions for a class (math mixes generated + bank word problems; others draw from the bank without
 *  repeats). Deterministic for a seed so a class re-opened shows the same quiz. */
export function quiz(subj: string, lv: number, n: number, seed: number): Q[] {
  const r = mkRng(seed),
    out: Q[] = [];
  if (subj === "math") {
    const rows = rowsFor("math", lv);
    for (let i = 0; i < n; i++) out.push(i === n - 1 && rows.length ? bankQ(pick(r, rows), r) : genMath(lv, r));
    return out;
  }
  const rows = shuffle(r, rowsFor(subj, lv).slice());
  for (let i = 0; i < n; i++) out.push(bankQ(rows[i % rows.length], r));
  return out;
}
/** Lesson blurb for a class: LESSONS rows run from easy to hard, so the level picks the window (HS = first two). */
export function lessonOf(subj: string, seed: number, lv = 0): string {
  const l = LESSONS[subj] || LESSONS.history,
    lo = Math.min(l.length - 1, Math.floor((Math.max(0, Math.min(4, lv)) / 4) * (l.length - 1)) - (lv <= 0 ? 0 : 1)),
    i = Math.max(0, lo) + (hashStr(subj + seed) % 2);
  return l[Math.min(l.length - 1, i)];
}
/** Total handwritten questions (for the record / tests). */
export const bankSize = () => Object.values(BANK).reduce((a, b) => a + b.length, 0);
/** The AI prompt for a class quiz (sample.json). PG, no personal data, strict JSON shape. */
export function aiQuizPrompt(course: string, subj: string, lv: number, n: number) {
  const yr = ["high-school senior", "college freshman", "college sophomore", "college junior", "college senior"][Math.max(0, Math.min(4, lv))];
  return `You write short classroom quizzes for a family-friendly basketball life-sim video game.
Course: "${course}" (subject: ${subj}), student level: ${yr}.
Write a 2-3 sentence lesson for today's class and ${n} multiple-choice questions on that lesson's topic, at that level.
Rules: factually correct; exactly 4 distinct answer choices each; exactly one correct; keep each question under 200 characters; PG content only; no real people's private details.
Reply with ONLY JSON, no prose: {"lesson":"...","questions":[{"question":"...","choices":["a","b","c","d"],"answer":0,"explain":"one sentence"}]}`;
}
/** Screen an AI reply: keep only valid questions (and the lesson if it's a sane string). */
export function screenAI(x: any, n: number): { lesson: string; qs: Q[] } | null {
  if (!x || typeof x !== "object") return null;
  const qs = (Array.isArray(x.questions) ? x.questions : []).filter(validQ).slice(0, n).map((q: any) => ({ question: String(q.question), choices: q.choices.map(String), answer: q.answer, explain: String(q.explain || ""), src: "ai" as const }));
  if (qs.length < Math.min(3, n)) return null;
  return { lesson: typeof x.lesson === "string" && x.lesson.length < 600 ? x.lesson : "", qs };
}
