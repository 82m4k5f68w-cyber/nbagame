// Guest: renders everyone else ~100 ms in the past from interpolated snapshots, predicts its own player
// with its own inputs (reconciled against the host's acked state), measures ping, and sends input state.
// DOM-free (used by the browser client and the headless network test).
import * as G from "../core/sim";
import { cfg, P, B, type Input } from "../core/sim";
import { pose3 } from "../core/pose";
import { PROTO, type Peer, type Transport } from "./transport";
import { applySnap, applyPlayer, deltaDec, packInput, applyBox, decodeFx, EDGES } from "./protocol";
import type { Lobby } from "./host";

const STEP = 1 / 60;
const PFIELDS = ["x", "y", "z", "vx", "vy", "vz", "f", "mode", "t", "ph", "sv", "mvT", "mvE", "mvk", "mvS", "brk", "postA", "pT", "sbw", "en", "hk", "slow", "cw", "cd", "li", "bn", "bx", "by", "rl", "mt", "tp", "setT", "manT", "scr", "bmp", "fsv"];

export class GuestSession {
  host: Peer | null = null;
  L: Lobby | null = null;
  gid = -1;
  snaps: number[][] = []; // reconstructed snapshots, ascending tick
  ack = -1; // newest input tick the host has applied
  myIdx = -1;
  mySlot = -1;
  n = 0; // input tick counter
  cnt = EDGES.map(() => 0);
  inbuf: { n: number; i: Input }[] = [];
  acc = 0;
  off: number | null = null; // host tick - local tick estimate (max-filtered)
  jit = 2;
  D = 6; // interpolation delay in ticks (~100 ms)
  rtt = 0;
  lastPg = 0;
  lastFx = 0;
  stall = 0;
  nf = 0;
  lastSnapAt = 0;
  hostGoneAt = 0;
  side = -2; // -2 undecided (the host waits), -1 watching, 0/1 playing
  rdy = 0;
  tempo = 0;
  stats: any = { full: 0, delta: 0, bytes: 0, corr: 0, recon: 0, resync: 0 };
  onLobby: ((L: Lobby) => void) | null = null;
  onStart: (() => void) | null = null;
  onFx: ((f: any) => void) | null = null;
  onChat: ((who: string, k: number) => void) | null = null;
  qn = 0; // my quick-chat sequence
  lastQ = -1; // newest relayed chat I've shown
  rm = -1; // game id I asked a rematch of
  private unsub: () => void;
  constructor(
    public t: Transport,
    public me: { n: string; tok: string; code: string; elo?: number },
    public now: () => number = () => performance.now(),
  ) {
    this.unsub = t.onPeers((ps) => this.peers(ps));
    this.pub();
  }
  pub(extra: any = {}) {
    this.t.presence({
      v: PROTO,
      n: this.me.n,
      tok: this.me.tok,
      code: this.me.code,
      tm: this.side,
      rdy: this.rdy,
      tmp: this.tempo,
      gid: this.gid,
      zk: this.snaps.length ? this.snaps[this.snaps.length - 1][0] : -1,
      nf: this.nf,
      t: Math.round(this.now()),
      rt: Math.round(this.rtt),
      D: Math.round(this.D),
      elo: this.me.elo || 1000,
      rm: this.rm,
      ...extra,
    });
  }
  setSide(tm: number) {
    this.side = tm;
    this.pub();
  }
  chat(k: number) {
    this.qn = Math.max(this.qn + 1, Date.now() % 1e9); // monotonic across reconnects
    this.pub({ q: [this.qn, k] });
  }
  wantRematch() {
    this.rm = this.gid;
    this.pub();
  }
  setReady(r: number) {
    this.rdy = r;
    this.pub();
  }
  peers(ps: Peer[]) {
    const h = ps.find((p) => !p.me && p.state && p.state.v === PROTO && p.state.H && p.state.code === this.me.code) || null;
    if (!h) {
      if (this.host && !this.hostGoneAt) this.hostGoneAt = this.now();
      return;
    }
    this.hostGoneAt = 0;
    const fresh = h.state !== (this.host && this.host.state);
    this.host = h;
    if (!fresh) return;
    const s = h.state;
    if (s.L) {
      const prevSt = this.L && this.L.st,
        L = (this.L = s.L as Lobby);
      this.mySlot = L.slots.findIndex((x) => x.id === this.t.me || (x.tok && x.tok === this.me.tok && x.id !== "host"));
      if ((L.st === "game" || L.st === "over") && L.gid !== this.gid) this.beginGame(L);
      else if (L.st === "lobby" && prevSt !== "lobby") G.setS("menu");
      this.onLobby && this.onLobby(L);
    }
    if (Array.isArray(s.Q))
      for (const q of s.Q) {
        if (this.lastQ < 0) this.lastQ = q[0] - 1; // joined late: only new messages
        if (q[0] > this.lastQ) {
          this.lastQ = q[0];
          this.onChat && this.onChat(q[1], q[2]);
        }
      }
    if (s.Pg && s.Pg[this.t.me] && s.Pg[this.t.me] !== this.lastPg) {
      this.lastPg = s.Pg[this.t.me];
      const r = this.now() - this.lastPg;
      if (r >= 0 && r < 5000) this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
    }
    if (this.gid < 0 || s.gid !== this.gid || !s.Z) return;
    if (s.A && typeof s.A[this.t.me] === "number") this.ack = s.A[this.t.me];
    if (s.C) this.applyCtrls(s.C);
    this.recv(s.Z);
    if (s.X) applyBox(s.X);
    if (s.E)
      for (const e of s.E) {
        if (e[0] <= this.lastFx) continue;
        this.lastFx = e[0];
        const f = decodeFx(e);
        if (f && this.onFx) this.onFx(f);
      }
  }
  /** Rebuild the local roster exactly like the host did, then follow snapshots. */
  beginGame(L: Lobby) {
    this.gid = L.gid;
    cfg.ONLINE = 1;
    cfg.GM = "game";
    cfg.NP = L.np;
    cfg.PRO = L.pro;
    cfg.MYM = 0;
    G.setQtrLen(L.ql);
    const cs = L.slots.filter((s) => s.on && s.tm >= 0).map((s) => G.mkCtrl(s.id === "host" ? "p1" : s.id, s.tm));
    G.setCtrls(cs);
    G.start(L.teams[0], { j: L.teams[1] });
    G.FX.length = 0;
    this.snaps = [];
    this.inbuf = [];
    this.off = null;
    this.ack = -1;
    this.lastFx = 0;
    this.nf = 0;
    this.myIdx = -1;
    this.onStart && this.onStart();
  }
  recv(Z: any) {
    const last = this.snaps.length ? this.snaps[this.snaps.length - 1][0] : -1;
    if (Z.k <= last) return;
    let a: number[] | null = null;
    if (Z.f) {
      a = Z.f;
      this.stats.full++;
    } else {
      const base = this.snaps.find((s) => s[0] === Z.b);
      if (!base) {
        this.nf = 1; // lost our baseline: ask for a full snapshot
        return;
      }
      a = deltaDec(Z.d, base, Z.k);
      this.stats.delta++;
    }
    this.nf = 0;
    if (this.lastSnapAt && this.now() - this.lastSnapAt > 1000) {
      // back from a stall: resync the clock and start the interpolation buffer fresh (no slow-motion catch-up)
      this.off = null;
      this.snaps = this.snaps.filter((s) => s === a);
      this.stats.resync = (this.stats.resync || 0) + 1;
    }
    this.stats.bytes += JSON.stringify(Z).length;
    this.snaps.push(a!);
    while (this.snaps.length > 90) this.snaps.shift();
    // Clock: host tick ~= local tick + off (max filter = least-delayed arrival), jitter tracks spread.
    const lt = (this.now() / 1000) * 60,
      sample = a![0] - lt;
    if (this.off == null) this.off = sample;
    this.jit = this.jit * 0.95 + Math.max(0, this.off - sample) * 0.05;
    if (sample > this.off) this.off = sample;
    this.D = Math.max(4, Math.min(15, 3 + this.jit * 2));
    this.lastSnapAt = this.now();
    this.reconcile(a!);
  }
  /** Host's live controller map [[id, team, playerIdx]...]: rings, camera focus and which player I predict. */
  applyCtrls(C: any[]) {
    if (!Array.isArray(C)) return;
    const cur = G.CT;
    const same = cur.length === C.length && cur.every((c, i) => c.id === C[i][0]);
    if (!same) G.setCtrls(C.map((c) => G.mkCtrl(c[0], c[1])));
    G.CT.forEach((c, i) => (c.idx = C[i][2]));
    const me = G.CT.find((c) => c.id === this.t.me);
    this.myIdx = me ? me.idx : -1;
  }
  /** Reset my player to the host's acked state, then replay my unacknowledged inputs. */
  reconcile(a: number[]) {
    const k = this.myIdx;
    if (k < 0 || !P[k]) return;
    const p = P[k],
      ox = p.x,
      oy = p.y;
    applyPlayer(p, a, k);
    const ownerIdx = a[20];
    B.owner = ownerIdx >= 0 ? P[ownerIdx] : null;
    while (this.inbuf.length && this.inbuf[0].n <= this.ack) this.inbuf.shift();
    G.setPredict(1);
    for (const e of this.inbuf) {
      p.in = this.frozen(p) ? { dx: 0, dy: 0 } : { ...e.i };
      G.step(p, STEP);
    }
    G.setPredict(0);
    const ex = ox - p.x,
      ey = oy - p.y,
      err = Math.hypot(ex, ey);
    this.stats.recon++;
    if (err > 0.5) this.stats.corr++;
    if (err < 40) {
      // smooth small corrections instead of snapping
      p.x += ex * 0.6;
      p.y += ey * 0.6;
    }
  }
  /** Per rendered frame: sample input at 60 Hz, predict, interpolate the rest, publish input. */
  frame(dt: number, sample: () => Input) {
    if (this.gid < 0 || !P.length) return;
    // 1) local input ticks + prediction
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 6) {
      this.acc -= STEP;
      n++;
      this.inputTick(sample());
    }
    // 2) interpolation of everyone else
    const lt = (this.now() / 1000) * 60;
    if (this.off != null && this.snaps.length) {
      this.off -= dt * 0.25; // slow decay so the max filter can follow clock drift
      const rt = lt + this.off - this.D;
      let i = this.snaps.length - 1;
      while (i > 0 && this.snaps[i - 1][0] > rt) i--;
      const s1 = this.snaps[i],
        s0 = i > 0 ? this.snaps[i - 1] : s1;
      let u = s1 === s0 ? 0 : (rt - s0[0]) / (s1[0] - s0[0]);
      u = Math.max(0, Math.min(1, u));
      const latest = this.snaps[this.snaps.length - 1];
      this.stall = rt > latest[0] + 15 ? 1 : 0;
      const skip = this.myIdx >= 0 && !G.RPL ? this.myIdx : undefined,
        mine = skip != null ? saveP(P[skip]) : null;
      applySnap(s0, s1 === s0 ? null : s1, u, skip);
      if (mine) loadP(P[skip!], mine);
      if (latest[17]) applySnap(latest, null, 0); // replays: show exactly what the host shows
      else if (rt > latest[0]) {
        // starved: dead-reckon everyone (not me) forward from the newest snapshot, at most 100 ms
        const ex = Math.min(6, rt - latest[0]) / 60;
        for (let k = 0; k < P.length; k++)
          if (k !== this.myIdx) {
            P[k].x += P[k].vx * ex;
            P[k].y += P[k].vy * ex;
          }
        if (!B.owner) {
          B.x += B.vx * ex;
          B.y += B.vy * ex;
          B.z = Math.max(4, B.z + B.vz * ex);
        }
      }
      // The ball sticks to my predicted hands when the host says I have it.
      if (this.myIdx >= 0 && latest[20] === this.myIdx && !G.RPL) B.owner = P[this.myIdx];
    }
    if (B.owner) G.bstep(dt); // held-ball placement (dribble bounce) follows the rendered owner
    G.netSim(dt);
    if (!G.RPL) for (const p of P) pose3(p);
    this.pub({ I: packInput(this.wire) });
  }
  wire = { n: 0, dx: 0, dy: 0, sp: 0, post: 0, c: EDGES.map(() => 0), mt: 0, tp: -1 };
  private inputTick(i: Input) {
    const k = this.myIdx,
      p = k >= 0 ? P[k] : null;
    this.n++;
    const w = this.wire;
    w.n = this.n;
    w.dx = i.dx;
    w.dy = i.dy;
    w.sp = i.sp ? 1 : 0;
    w.post = i.post ? 1 : 0;
    const bump = (e: string) => (w.c[EDGES.indexOf(e as any)] += 1);
    if (i.sd) {
      bump("sd");
      if (p && p.mode === "s") w.tp = Math.round(p.t * 1000); // tempo tap on my own timeline
    }
    if (i.su) {
      bump("su");
      if (p && p.mode === "c") w.mt = Math.round((p.t + STEP) * 1000); // meter time on my own timeline
    }
    if (i.e) bump("e");
    if (i.sb) bump("sb");
    if (i.mv) bump("mv" + i.mv);
    if (i.lob) bump("lob");
    if (i.sw) bump("sw");
    if (i.pf) bump("pf");
    if (i.to) bump("to");
    if (i.ch) bump("ch");
    if (i.ds) bump("ds");
    if ((i as any).skip) bump("skip");
    if (p && !G.RPL && G.S === "play") {
      this.inbuf.push({ n: this.n, i: { ...i } });
      if (this.inbuf.length > 120) this.inbuf.shift();
      G.setPredict(1);
      p.in = this.frozen(p) ? { dx: 0, dy: 0 } : { ...i };
      G.step(p, STEP);
      G.setPredict(0);
    }
  }
  /** Same dead-ball rules as the host: no control during inbounds, others' free throws and after scores. */
  private frozen(p: any) {
    return G.inb > 0 || G.rs > 0 || !!G.JB || (G.ftq && G.ftq.s !== p);
  }
  close() {
    this.unsub();
  }
}
function saveP(p: any) {
  const o: any = {};
  for (const k of PFIELDS) o[k] = p[k];
  return o;
}
function loadP(p: any, o: any) {
  for (const k of PFIELDS) p[k] = o[k];
}
