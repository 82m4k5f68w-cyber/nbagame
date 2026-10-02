// Authoritative host: runs the real sim (browser tab or headless Node), turns guests' presence into controller
// inputs, and publishes delta-compressed snapshots + events + acks. DOM-free.
import * as G from "../core/sim";
import { cfg, type Ctrl, type Input } from "../core/sim";
import { PROTO, PRESENCE_MAX, type Peer, type Transport } from "./transport";
import { encodeSnap, deltaEnc, encodeBox, encodeFx, unpackInput, EDGES, type WireInput } from "./protocol";

export interface Slot {
  id: string; // peer id ("host" for the local host player)
  tok: string; // reconnect token
  n: string;
  tm: number;
  rdy: number;
  on: number; // currently connected
}
export interface Lobby {
  st: "lobby" | "game" | "over";
  gid: number;
  np: number;
  pro: number;
  ql: number; // quarter length (s)
  teams: [number, number];
  slots: Slot[];
  code: string;
  ded: number; // dedicated (headless) host
}
interface GuestRec {
  id: string;
  st: any;
  w: WireInput | null;
  last: number[] | null; // counters already consumed
  pend: string[];
  ack: number;
  acks: number[]; // snapshot ticks this guest has confirmed
  ping: number;
  D: number;
}
export class HostSession {
  L: Lobby;
  guests = new Map<string, GuestRec>();
  hist = new Map<number, number[]>();
  k = 0;
  sent = 0;
  lastBox = 0;
  onChange: (() => void) | null = null;
  private unsub: () => void;
  constructor(
    public t: Transport,
    public me: { n: string; tok: string; tm: number; play: boolean },
    o: { np: number; pro: number; ql: number; code: string; ded?: boolean },
  ) {
    this.L = {
      st: "lobby",
      gid: 0,
      np: o.np,
      pro: o.pro,
      ql: o.ql,
      teams: [0, 1],
      slots: me.play ? [{ id: "host", tok: me.tok, n: me.n, tm: me.tm, rdy: 1, on: 1 }] : [],
      code: o.code,
      ded: o.ded ? 1 : 0,
    };
    this.unsub = t.onPeers((ps) => this.peers(ps));
    this.pub(true);
  }
  cap() {
    return this.L.np === 1 ? 1 : 2;
  }
  sideCount(tm: number, ex?: string) {
    return this.L.slots.filter((s) => s.tm === tm && s.id !== ex).length;
  }
  /** Presence of everyone: register guests, consume inputs/acks, handle joins, side requests and reconnects. */
  peers(ps: Peer[]) {
    let changed = false;
    const seen = new Set<string>();
    for (const p of ps) {
      if (p.me || !p.state || p.state.v !== PROTO || p.state.H) continue;
      if (p.state.code && p.state.code !== this.L.code) continue;
      seen.add(p.id);
      let g = this.guests.get(p.id);
      if (!g) {
        g = { id: p.id, st: p.state, w: null, last: null, pend: [], ack: -1, acks: [], ping: 0, D: 6 };
        this.guests.set(p.id, g);
        changed = true;
      }
      g.st = p.state;
      g.ping = +p.state.rt || 0;
      g.D = +p.state.D || 6;
      if (typeof p.state.zk === "number" && g.acks[g.acks.length - 1] !== p.state.zk) {
        g.acks.push(p.state.zk);
        if (g.acks.length > 48) g.acks.shift();
      }
      // Reconnect: a known token re-attaches to its slot under the new peer id.
      let s = this.L.slots.find((s) => s.id === p.id) || this.L.slots.find((s) => s.tok && s.tok === p.state.tok && s.id !== "host");
      if (s && s.id !== p.id) {
        s.id = p.id;
        changed = true;
      }
      if (s && !s.on) {
        s.on = 1;
        changed = true;
        if (this.L.st === "game") this.rebuildCtrls();
      }
      // Side request (lobby only): tm 0/1 to sit, -1 to spectate.
      const want = p.state.tm;
      if (this.L.st === "lobby") {
        if (s && want === -1) {
          this.L.slots = this.L.slots.filter((x) => x !== s);
          s = undefined;
          changed = true;
        } else if (want === 0 || want === 1) {
          if (!s && this.sideCount(want) < this.cap()) {
            this.L.slots.push((s = { id: p.id, tok: p.state.tok || "", n: clean(p.state.n), tm: want, rdy: 0, on: 1 }));
            changed = true;
          } else if (s && s.tm !== want && this.sideCount(want, s.id) < this.cap()) {
            s.tm = want;
            changed = true;
          }
        }
        if (s) {
          const r = p.state.rdy ? 1 : 0,
            n = clean(p.state.n);
          if (s.rdy !== r || s.n !== n) {
            s.rdy = r;
            s.n = n;
            changed = true;
          }
        }
      }
      // Inputs: edge counters -> pending one-shot events.
      if (p.state.I && s) {
        const w = unpackInput(p.state.I);
        if (!g.last || p.state.gid !== this.L.gid) g.last = w.c.slice();
        else
          EDGES.forEach((e, j) => {
            if (w.c[j] > g!.last![j]) {
              g!.pend.push(e);
              g!.last![j] = w.c[j];
            }
          });
        g.w = w;
        const c = G.CT.find((c) => c.id === p.id);
        if (c) {
          c.tempo = p.state.tmp ? 1 : 0;
          c.lag = Math.min(0.3, g.ping / 2000 + g.D / 60);
        }
      }
    }
    for (const [id] of this.guests)
      if (!seen.has(id)) {
        this.guests.delete(id);
        const s = this.L.slots.find((s) => s.id === id);
        if (s) {
          if (this.L.st === "lobby") this.L.slots = this.L.slots.filter((x) => x !== s);
          else {
            s.on = 0; // keep the seat for a reconnect; the AI plays it meanwhile
            this.rebuildCtrls();
          }
        }
        changed = true;
      }
    if (changed) {
      this.pub(true);
      this.onChange && this.onChange();
    }
  }
  setSide(tm: number) {
    const s = this.L.slots.find((s) => s.id === "host");
    if (s && s.tm !== tm && this.sideCount(tm, "host") < this.cap()) s.tm = tm;
    this.me.tm = tm;
    this.pub(true);
  }
  setTeams(i: number, j: number) {
    this.L.teams = [i, j];
    this.pub(true);
  }
  setOpt(k: "pro" | "ql", v: number) {
    this.L[k] = v;
    this.pub(true);
  }
  canStart() {
    return this.L.slots.every((s) => s.rdy || s.id === "host");
  }
  /** Seat every connected human as a controller; disconnected seats are played by the AI. */
  rebuildCtrls() {
    const cs: Ctrl[] = [];
    for (const s of this.L.slots) {
      if (!s.on) continue;
      if (s.id === "host") cs.push(G.CT.find((c) => c.id === "p1") || G.mkCtrl("p1", s.tm, false, 0));
      else {
        const c: any = G.CT.find((c) => c.id === s.id) || G.mkCtrl(s.id, s.tm, false, 0);
        c.remote = true;
        cs.push(c);
      }
    }
    G.setCtrls(cs);
  }
  start(tempo = 0) {
    cfg.NP = this.L.np;
    cfg.PRO = this.L.pro;
    cfg.MYM = 0;
    G.setQtrLen(this.L.ql);
    G.setCtrls([]);
    this.rebuildCtrls();
    const p1 = G.CT.find((c) => c.id === "p1");
    if (p1) p1.tempo = tempo;
    this.L.st = "game";
    this.L.gid++;
    for (const g of this.guests.values()) {
      g.last = null;
      g.pend = [];
      g.acks = [];
    }
    this.hist.clear();
    G.start(this.L.teams[0], { j: this.L.teams[1] });
    this.k = 0;
    this.pub(true);
  }
  backToLobby() {
    this.L.st = "lobby";
    for (const s of this.L.slots) if (s.id !== "host") s.rdy = 0;
    G.setS("menu");
    this.pub(true);
  }
  /** Build one controller input from a guest's latest presence. Called by the sim (cfg.input). */
  remoteInput(c: Ctrl): Input {
    const g = this.guests.get(c.id);
    const i: Input = { dx: 0, dy: 0 };
    if (!g || !g.w) return i;
    const w = g.w;
    i.dx = w.dx;
    i.dy = w.dy;
    i.sp = w.sp;
    i.post = w.post;
    g.ack = w.n;
    const keep: string[] = [];
    let fired = false;
    for (const e of g.pend) {
      if (e === "su" && fired) {
        keep.push(e); // press and release in the same frame: release next tick
        continue;
      }
      if (e === "sd") {
        i.sd = 1;
        fired = true;
        if (w.tp >= 0) i.tp = w.tp / 1000;
      } else if (e === "su") {
        i.su = 1;
        if (w.mt > 0) i.mt = w.mt / 1000;
      } else if (e === "mv1") i.mv = 1;
      else if (e === "mv2") i.mv = 2;
      else if (e === "mv3") i.mv = 3;
      else if (e === "skip") G.skipReplay();
      else (i as any)[e] = 1;
    }
    g.pend = keep;
    return i;
  }
  /** After every sim tick: publish a snapshot every 2nd tick (30 Hz). */
  tick() {
    this.k++;
    if (this.k % 2) return;
    this.pub(false);
  }
  /** Delta baseline = newest snapshot every watching guest has confirmed; else a full snapshot. */
  private base(): number {
    let best = -1;
    if (!this.guests.size) return -1;
    for (const [t] of this.hist) {
      if (t <= best) continue;
      let ok = true;
      for (const g of this.guests.values())
        if (g.st.nf || !g.acks.includes(t)) {
          ok = false;
          break;
        }
      if (ok) best = t;
    }
    return best;
  }
  pub(lobbyChanged: boolean) {
    const o: any = { v: PROTO, H: 1, n: this.me.n, tok: this.me.tok, code: this.L.code };
    if (lobbyChanged || this.k % 60 === 0) o.L = this.L;
    if (this.L.st === "game" || this.L.st === "over") {
      if (G.S === "over" && this.L.st === "game") this.L.st = "over";
      const full = encodeSnap(this.k);
      this.hist.set(this.k, full);
      for (const t of this.hist.keys()) if (t < this.k - 120) this.hist.delete(t);
      const b = this.base(),
        d = b >= 0 ? deltaEnc(full, this.hist.get(b)!) : null;
      o.Z = d && d.length < full.length ? { k: this.k, b, d } : { k: this.k, f: full };
      o.A = {};
      o.Pg = {};
      for (const g of this.guests.values()) {
        o.A[g.id] = g.ack;
        o.Pg[g.id] = g.st.t || 0;
      }
      o.gid = this.L.gid;
      o.C = G.CT.map((c) => [c.id === "p1" ? "host" : c.id, c.tm, c.idx]);
      if (this.k - this.lastBox >= 30 || G.S === "over") {
        this.lastBox = this.k;
        o.X = encodeBox();
      }
      // The merged presence (including the lobby object kept from earlier patches) must fit the 4 KiB limit.
      let n = 14;
      o.E = encodeFx(n);
      const size = () => JSON.stringify(o).length + (o.L ? 0 : JSON.stringify(this.L).length + 6);
      while (size() > PRESENCE_MAX && n > 0) {
        if (o.X && n < 8) delete o.X;
        o.E = encodeFx((n -= 3));
      }
    }
    this.t.presence(o);
  }
  close() {
    this.unsub();
  }
}
export const clean = (s: any) =>
  String(s || "Player")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, 14) || "Player";
