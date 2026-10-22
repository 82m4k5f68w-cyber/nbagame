// Crowd chant director: decides WHICH chant the crowd starts and WHEN. Pure logic (no DOM, no audio): the browser
// player (crowd.ts) and tests/chants.ts drive it with the sim's FX + a per-frame context; Unity mirrors it line for
// line in Game/ChantDir.cs (same rules, same order, same random draws - tests/chants.ts checks both on one script).
//  - one chant at a time: `busy` until the chant ends + a gap that shrinks as the building gets louder; per-chant
//    cooldowns; reactions (roar, boo, aww, shh) may cut in over a chant (the player fades the chant out)
//  - home crowd = team `home` (0); its energy (momentum, runs, score margin, clutch, overtime, excitement) scales how
//    often the elective chants start and how loud they are; the visiting section only answers a road run, quietly
//  - commentary speaking holds back everything below priority 8 (pending chants expire instead of piling up)
/** id: [length s (as rendered, before the reverb tail), cooldown s, priority] - chantsyn.ts renders exactly these lengths. */
export const CH: Record<string, number[]> = {
  defense: [5, 14, 6],
  letsgo: [5, 22, 3],
  mvp: [4.8, 30, 8],
  airball: [3.75, 25, 9],
  overtime: [5, 60, 7],
  wewant: [5, 90, 2],
  rockyou: [6, 45, 3],
  charge: [0.8, 20, 4],
  boo: [3, 8, 10],
  roar: [3.5, 2, 10],
  aww: [1.8, 4, 10],
  shh: [1.4, 6, 10],
};
export const CHIDS = Object.keys(CH);
export const isReact = (id: string) => id === "boo" || id === "roar" || id === "aww" || id === "shh";
/** music.ts "charge" riff: the crowd shouts CHARGE! after its last note (12 sixteenths at 96 BPM). */
export const CHARGE_AT = 1.875;
const BIGP = ["dunk", "dunkAnd1", "splash", "block", "and1"];

/** What the director needs to know each frame (the shell fills ONE object and mutates it - no per-frame garbage). */
export interface CCtx {
  live: boolean; // a game-like game is being played (S "play", no replay / reel)
  over: boolean; // final buzzer
  home: number; // the home team (0)
  pos: number; // team with the ball
  sc: number[];
  q: number;
  clutch: boolean;
  mom: number; // TS.mom (+ = team 0)
  run: number[]; // TS.run (points in the current run per team)
  dead: boolean; // dead ball (inbound, after a score, timeout, FTs)
  ft: number; // free-throw trip id (0 = none; a new id = a new trip)
  ftTm: number; // shooter's team
  ftN: string; // shooter's name
  ftStar: boolean; // the shooter is his team's go-to scorer (M-V-P at the line)
  bench: string; // the home crowd's favourite, sitting on the bench ("" = none)
  names: string[]; // team names [team 0, team 1]
  speaking: boolean; // the commentary voice is talking
  tmOf: (n: string) => number; // a player's team by name (-1 unknown)
}
export interface CReq {
  id: string;
  word: string; // team / player name for letsgo / wewant / mvp ("" = none)
  side: number; // which crowd: the home team's or the visitors'
  gain: number; // 0..1.2
  delay: number; // seconds from now (riff call-and-response)
  t: number; // director time when it was decided
}
interface Pend {
  id: string;
  word: string;
  side: number;
  gain: number;
  prio: number;
  exp: number;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class ChantDir {
  on = true;
  now = 0;
  busy = 0; // no new chant before this
  act = 0; // something is sounding until (music duck)
  hush = 0; // 0..1: the building goes quiet (clutch free throws at home)
  exc = 0.3;
  cool: Record<string, number> = {};
  pend: Pend[] = [];
  log: CReq[] = [];
  lastQ = 0;
  ftId = 0;
  posN = 0;
  lastPos = -1;
  posTried = -1;
  deadTried = false;
  stopT = -99;
  prev = [0, 0];
  wasOver = false;
  constructor(public rnd: () => number = Math.random) {}

  reset() {
    this.now = this.busy = this.act = this.hush = 0;
    this.exc = 0.3;
    this.cool = {};
    this.pend.length = 0;
    this.lastQ = this.ftId = this.posN = 0;
    this.lastPos = this.posTried = -1;
    this.deadTried = false;
    this.stopT = -99;
    this.prev[0] = this.prev[1] = 0;
    this.wasOver = false;
  }

  /** Home crowd energy 0..1. */
  energy(c: CCtx) {
    const h = c.home,
      a = 1 - h,
      m = h === 0 ? c.mom : -c.mom,
      mg = c.sc[h] - c.sc[a];
    let e = 0.3 + 0.3 * m + 0.03 * Math.min(c.run[h], 12) - 0.02 * Math.min(c.run[a], 12) + 0.15 * this.exc;
    if (Math.abs(mg) <= 6) e += c.q >= 4 ? 0.2 : 0.08;
    else if (mg < -15) e -= 0.15; // a blowout loss: a quiet building
    if (c.clutch) e += 0.2;
    if (c.q > 4) e += 0.1;
    return clamp(e, 0.05, 1);
  }

  private add(id: string, word: string, side: number, gain: number, prio: number, life: number) {
    for (const p of this.pend)
      if (p.id === id) {
        p.word = word;
        p.side = side;
        p.gain = Math.max(p.gain, gain);
        p.prio = Math.max(p.prio, prio);
        p.exp = Math.max(p.exp, this.now + life);
        return;
      }
    this.pend.push({ id, word, side, gain, prio, exp: this.now + life });
  }
  private react(id: string, gain: number, c: CCtx) {
    this.add(id, "", c.home, gain, 10, 0.6);
  }

  /** One sim FX (after it was drained by the shell). */
  fx(f: any, c: CCtx) {
    if (!this.on) return;
    const h = c.home,
      e = this.energy(c);
    switch (f.k) {
      case "x":
        this.exc = Math.max(this.exc, f.v || 0);
        break;
      case "air": {
        const t = f.tm != null ? f.tm : f.v;
        if (t !== h) this.add("airball", "", h, 0.7 + 0.3 * e, 9, 2.5);
        else this.react("aww", 0.6, c);
        break;
      }
      case "chant": // the sim's late-game "DE-FENSE!" cue (tm = the defending team)
        if (f.tm === h || (f.tm == null && c.pos !== h)) this.add("defense", "", h, 0.6 + 0.4 * e, 6, 3);
        break;
      case "cm": {
        const t = c.tmOf(f.n || "");
        if (BIGP.indexOf(f.e) >= 0) {
          if (t === h) this.react("roar", 0.6 + 0.4 * e, c);
        } else if (f.e === "three") {
          if (t === h) this.react("roar", 0.45 + 0.3 * e, c);
        } else if (f.e === "fire") {
          if (t === h) (this.react("roar", 0.8, c), this.add("mvp", f.n || "", h, 0.7 + 0.3 * e, 8, 8));
        } else if (f.e === "flagrant" || f.e === "tech" || f.e === "goaltend") {
          if (t === h) this.react("boo", 0.7 + 0.3 * e, c); // the call went against the home team
        } else if (f.e === "miss") {
          if (c.tmOf(f.n2 || "") === h && t !== h) this.stopT = this.now; // a stop: the crowd wants another one
        } else if (f.e === "timeout") this.deadTried = false; // a fresh dead ball to fill
        break;
      }
      case "t":
        if (f.s === "GAME WINNER!" || f.s === "BUZZER BEATER!") this.react(c.sc[h] > this.prev[h] ? "roar" : "aww", 1, c);
        break;
    }
  }

  /** music.ts started an organ riff: the crowd answers it (CHARGE!) or chants along on the bar (DE-FENSE). */
  riff(name: string, c: CCtx): CReq | null {
    if (!this.on || !c.live || this.now < this.busy || c.speaking) return null;
    const h = c.home,
      e = this.energy(c);
    if (name === "charge" && c.pos === h && (this.cool.charge || 0) <= this.now && this.rnd() < 0.5 + 0.5 * e) return this.start({ id: "charge", word: "", side: h, gain: 0.6 + 0.4 * e, prio: 4, exp: 0 }, CHARGE_AT, e);
    if (name === "defense" && c.pos !== h && (this.cool.defense || 0) <= this.now && this.rnd() < 0.3 + 0.6 * e) return this.start({ id: "defense", word: "", side: h, gain: 0.55 + 0.45 * e, prio: 6, exp: 0 }, 0, e);
    return null;
  }

  private start(p: Pend, delay: number, e: number): CReq {
    const d = CH[p.id][0];
    this.cool[p.id] = this.now + delay + CH[p.id][1];
    if (isReact(p.id)) {
      this.act = Math.max(this.act, this.now + d);
      this.busy = Math.max(this.busy, this.now + Math.min(d, 2) + 1);
    } else {
      this.act = this.now + delay + d;
      this.busy = this.now + delay + d + 2 + 5 * (1 - e);
    }
    const r: CReq = { id: p.id, word: p.word, side: p.side, gain: clamp(p.gain, 0, 1.2), delay, t: this.now };
    this.log.push(r);
    if (this.log.length > 64) this.log.shift();
    return r;
  }

  /** Per frame (after the frame's FX): returns the chants / reactions to start now (at most one). */
  tick(dt: number, c: CCtx, out: CReq[]) {
    out.length = 0;
    this.now += dt;
    this.exc = Math.max(0.2, this.exc - dt * 0.25);
    if (!this.on) {
      this.pend.length = 0;
      this.hush = 0;
      return out;
    }
    const h = c.home,
      a = 1 - h,
      e = this.energy(c);
    if (c.over && !this.wasOver) {
      this.wasOver = true;
      this.react(c.sc[h] > c.sc[a] ? "roar" : "aww", 1, c);
    } else if (!c.over) this.wasOver = false;
    if (!c.live && !c.over) {
      // menus, pause, replays, halftime: nothing new starts
      this.pend.length = 0;
      this.hush = 0;
      this.prev[0] = c.sc[0];
      this.prev[1] = c.sc[1];
      this.lastQ = c.q;
      return out;
    }
    if (c.live) {
      if (c.q > 4 && c.q !== this.lastQ) this.add("overtime", "", h, 0.7 + 0.3 * e, 7, 10);
      this.lastQ = c.q;
      // free throws: boo the road shooter, hush for a clutch home shooter, M-V-P for the star
      if (c.ft && c.ft !== this.ftId) {
        this.ftId = c.ft;
        if (c.ftTm !== h) this.react("boo", (0.5 + 0.5 * e) * (c.clutch ? 1.2 : 1), c);
        else if (c.clutch) this.react("shh", 0.7, c);
        else if (c.ftStar) this.add("mvp", c.ftN, h, 0.6 + 0.4 * e, 7, 4);
      }
      this.hush = c.ft && c.ftTm === h && c.clutch ? 1 : 0;
      // possessions: DE-FENSE while the visitors have it (late in a close game, after a stop, or a loud building)
      if (c.pos !== this.lastPos) (this.lastPos = c.pos), this.posN++;
      if (c.pos !== h && !c.dead && this.posTried !== this.posN) {
        this.posTried = this.posN;
        const want = this.now - this.stopT < 8 || (c.q >= 3 && Math.abs(c.sc[h] - c.sc[a]) <= 8) || e > 0.65;
        if (want && this.rnd() < 0.3 + 0.6 * e) this.add("defense", "", h, 0.55 + 0.45 * e, 5, 4);
      }
      // dead balls (not free throws): the crowd fills the gap
      if (c.dead && !c.ft) {
        if (!this.deadTried) {
          this.deadTried = true;
          if (c.bench && c.q >= 2 && this.rnd() < 0.2) this.add("wewant", c.bench, h, 0.5 + 0.4 * e, 2, 4);
          else if (c.run[a] >= 8 && this.rnd() < 0.5) this.add("letsgo", c.names[a], a, 0.35, 2, 4); // the visiting section
          else if (this.rnd() < 0.25 + 0.6 * e) {
            if (this.rnd() < 0.6) this.add("letsgo", c.names[h], h, 0.5 + 0.5 * e, 3, 4);
            else this.add("rockyou", "", h, 0.5 + 0.5 * e, 3, 4);
          }
        }
      } else if (!c.dead) this.deadTried = false;
    }
    // drop expired, then start the best one that may start now
    for (let i = this.pend.length - 1; i >= 0; i--) if (this.pend[i].exp < this.now) this.pend.splice(i, 1);
    let best = -1;
    for (let i = 0; i < this.pend.length; i++) {
      const p = this.pend[i],
        r = isReact(p.id);
      if ((this.cool[p.id] || 0) > this.now) continue;
      if (!r && (this.now < this.busy || (c.speaking && p.prio < 8))) continue;
      if (best < 0 || p.prio > this.pend[best].prio) best = i;
    }
    if (best >= 0) {
      const p = this.pend[best];
      this.pend.splice(best, 1);
      out.push(this.start(p, 0, e));
    }
    this.prev[0] = c.sc[0];
    this.prev[1] = c.sc[1];
    return out;
  }

  /** Music level while the crowd chants / reacts (the organ backs off), and lower still for a hush. */
  duck() {
    return this.hush ? 0.25 : this.now < this.act ? 0.45 : 1;
  }
}
