// Online play in the browser: lobby (create / join by code, sides, team picks, ready-up), host & guest wiring,
// connection HUD (ping, host, stalls) and reconnect tokens.
import * as G from "../../core/sim";
import { cfg, CT, type Ctrl, type Input } from "../../core/sim";
import { TM } from "../../core/data";
import { HostSession, CHAT, type Lobby } from "../../net/host";
import { GuestSession } from "../../net/guest";
import type { Transport } from "../../net/transport";
import { connect, detect } from "./room";
import { V, pr as prj } from "../view";
import { IN, hum, TX } from "../input";
import { audio } from "../audio";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const ov = () => $("#ov");
const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const store = {
  get(k: string, d = "") {
    try {
      return localStorage.getItem(k) || d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const tok = () => {
  let t = store.get("h2k_tok");
  if (!t) store.set("h2k_tok", (t = Math.random().toString(36).slice(2, 12)));
  return t;
};
const elo = () => Math.round(+store.get("h2k_elo", "1000") || 1000);
/** Quick-chat bubbles over players + a small feed. */
const BUB: { who: string; k: number; t: number }[] = [];
function onChat(who: string, k: number) {
  NET.chats++;
  BUB.push({ who, k, t: 3 });
  if (BUB.length > 5) BUB.shift();
  audio.snd(1200, 0.06, "triangle", 0.05);
}
const newCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[(Math.random() * 24) | 0]).join("");
const teamName = (np: number, i: number) => (np > 1 ? TM[i][0] : G.ALL[i] ? G.ALL[i].a[0] : "?");
const choices = (np: number) => (np > 1 ? TM.length : G.ALL.length);

let t: Transport | null = null,
  host: HostSession | null = null,
  guest: GuestSession | null = null,
  skipReq = 0,
  hiddenTimer: any = null,
  menuBack: (() => void) | null = null;

export const NET = {
  role: null as null | "host" | "guest",
  code: "",
  chats: 0, // quick-chat messages seen (tests)
  setMenu(f: () => void) {
    menuBack = f;
  },
  /** Straight from the home screen: host a game or join a code without going through the menus. */
  async quick(a: { host?: boolean; join?: string }) {
    ov().style.display = "flex";
    ov().innerHTML = `<div class="logo" style="font-size:36px">CONNECTING<span>…</span></div><p>${a.join ? "Joining game " + esc(a.join) : "Opening a live room"}</p><div id="nerr" style="color:#ff9966;min-height:18px"></div>`;
    const kind = await detect();
    if (!kind) return NET.openLobby();
    const name = store.get("h2k_name", "") || "Player" + Math.floor(Math.random() * 90 + 10);
    store.set("h2k_name", name);
    try {
      if (a.join) await NET.join(a.join, name);
      else await NET.create(name);
    } catch (e) {
      await NET.openLobby();
      err(e);
    }
  },
  async openLobby() {
    ov().style.display = "flex";
    ov().innerHTML = `<div class="logo" style="font-size:36px">CONNECTING<span>…</span></div>`;
    const kind = await detect();
    const name = store.get("h2k_name", "Player");
    ov().style.display = "flex";
    ov().innerHTML = `<div class="logo" style="font-size:40px">PLAY<span>ONLINE</span></div><div class="sub">${
      kind === "room" ? "LIVE ROOM · FRIENDS ON THIS PAGE JOIN WITH YOUR CODE" : kind === "ws" ? "HOOPS SERVER" : "OFFLINE"
    }</div>
    <div class="opts"><b>YOUR NAME</b><input id="nm" maxlength="14" value="${esc(name)}" style="width:180px"></div>
    ${
      kind
        ? `<div class="opts"><b>HOST A GAME</b><button id="cr">Create game (${cfg.NP > 1 ? "5v5" : "1v1"})</button>${kind === "ws" ? '<button id="crd">Create on dedicated server</button>' : ""}
    ${store.get("h2k_last") ? `<b>LAST GAME</b><button id="rj">↻ Rejoin ${esc(store.get("h2k_last"))}</button>` : ""}<b>JOIN A FRIEND</b><input id="cd" maxlength="4" placeholder="CODE" value="${esc(store.get("h2k_last", ""))}" style="width:90px;text-transform:uppercase;letter-spacing:3px;font-weight:800"><button id="jn">Join</button></div>
    <p class="note" style="max-width:520px">Host plays on this device and runs the game; friends join with the 4-letter code. Up to ${cfg.NP > 1 ? "2 humans per side (AI fills the rest)" : "1 human per side"}. Local 2-player stays in the main menu.</p>`
        : `<p style="max-width:520px;color:#ff9966">Online play works on the shared Hoops 2K27 link on claude.ai: open it while signed in to claude.ai, then host or enter a friend's code. This copy of the page can't reach the live rooms. Local 2-player still works from the main menu.</p>`
    }
    <div id="nerr" style="color:#ff9966;min-height:18px"></div><button class="big" id="bkm">◀ Back</button>`;
    const nm = () => {
      const v = ($("#nm") as HTMLInputElement).value.trim() || "Player";
      store.set("h2k_name", v);
      return v;
    };
    $("#bkm").onclick = () => menuBack && menuBack();
    if (!kind) return;
    $("#cr").onclick = () => NET.create(nm()).catch(err);
    const crd = document.getElementById("crd");
    if (crd) crd.onclick = () => NET.createDedicated(nm()).catch(err);
    const rj = document.getElementById("rj");
    if (rj) rj.onclick = () => NET.join(store.get("h2k_last"), nm()).catch(err);
    $("#jn").onclick = () => {
      const c = ($("#cd") as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, "");
      if (c.length !== 4) return err(new Error("Enter the 4-letter code"));
      NET.join(c, nm()).catch(err);
    };
  },
  async create(name: string) {
    NET.code = newCode();
    t = await connect(NET.code);
    host = new HostSession(t, { n: name, tok: tok(), tm: 0, play: true, elo: elo() }, { np: cfg.NP, pro: cfg.PRO, ql: 60, code: NET.code });
    host.onChat = onChat;
    host.onChange = () => NET.role === "host" && host!.L.st === "lobby" && renderHostLobby();
    NET.role = "host";
    IN.MP2 = 0;
    renderHostLobby();
  },
  async createDedicated(name: string) {
    const code = newCode();
    const tr: any = await connect(code);
    tr.requestHost && tr.requestHost(code);
    t = tr;
    startGuest(code, name);
  },
  async join(code: string, name: string) {
    store.set("h2k_last", code);
    t = await connect(code);
    startGuest(code, name);
  },
  /** Every frame while in a lobby: re-render if the lobby changed (never depends on callback ordering). */
  lobbyTick() {
    if (host && host.L.st === "lobby") {
      const k = lobbyKey(host.L, 0, watchKey());
      if (k !== shownKey) renderHostLobby();
    } else if (guest && (!guest.L || guest.L.st === "lobby")) {
      const k = guest.L ? lobbyKey(guest.L, guest.rdy, Math.round(guest.rtt / 25)) : "none";
      if (k !== shownKey) renderGuestLobby();
    }
  },
  /** Debug snapshot for tests. */
  dbg() {
    return { kind: t && t.kind, me: t && t.me, peers: t ? t.peers().map((p) => [p.id.slice(0, 6), p.me, Object.keys(p.state || {}).join("")]) : [], L: guest && guest.L ? guest.L.st : null, code: NET.code };
  },
  remoteInput(c: Ctrl): Input {
    return host ? host.remoteInput(c) : { dx: 0, dy: 0 };
  },
  requestSkip() {
    skipReq = 1;
  },
  /** Quick chat (keys 1-6). */
  chat(k: number) {
    if (host) host.chat("host", k - 1);
    else if (guest) guest.chat(k - 1);
  },
  /** Final-screen buttons for online games: rematch (host starts / guests vote) and back to the lobby. */
  finalButtons() {
    return host
      ? `<button class="big" id="nrm">↻ REMATCH</button><button class="ghost" id="pa">Back to lobby</button><p class="hint" id="nrmc"></p>`
      : `<button class="big" id="nrm">↻ I want a rematch</button><button class="ghost" id="pa">Leave game</button><p class="hint" id="nrmc">The host decides: rematch or back to the lobby.</p>`;
  },
  bindFinal() {
    const b = document.getElementById("nrm");
    if (!b) return;
    if (host) {
      const iv = setInterval(() => {
        const c = document.getElementById("nrmc");
        if (!c || !host) return clearInterval(iv);
        const [n, m] = host.rematchVotes();
        c.textContent = m ? `${n}/${m} want a rematch` : "";
      }, 400);
      b.onclick = () => {
        clearInterval(iv);
        audio.crowdInit();
        host!.rematch(IN.TEMPO);
        V.focus = Math.max(0, CT.findIndex((c) => c.id === "p1"));
        ov().style.display = "none";
        TX.length = 0;
      };
    } else if (guest) {
      b.onclick = () => {
        guest!.wantRematch();
        b.textContent = "Rematch requested ✓";
      };
      const pa = document.getElementById("pa");
      if (pa) pa.onclick = () => leave();
    }
  },
  /** Ranked rating after an online game (humans on both sides). Returns a line for the final screen. */
  rate(): string {
    const L = host ? host.L : guest ? guest.L : null,
      meId = host ? "host" : t ? t.me : "";
    if (!L) return "";
    const mine = L.slots.find((s) => s.id === meId);
    if (!mine) return "";
    const side = (tm: number) => L.slots.filter((s) => s.tm === tm),
      opp = side(1 - mine.tm);
    if (!opp.length) return `<p class="hint">Unrated: no human on the other side</p>`;
    const key = NET.code + ":" + L.gid;
    const avg = (a: any[]) => a.reduce((s, x) => s + (x.elo || 1000), 0) / a.length,
      my = elo(),
      ex = 1 / (1 + Math.pow(10, (avg(opp) - avg(side(mine.tm))) / 400)),
      res = G.sc[mine.tm] > G.sc[1 - mine.tm] ? 1 : G.sc[mine.tm] < G.sc[1 - mine.tm] ? 0 : 0.5,
      d = Math.round(24 * (res - ex));
    if (store.get("h2k_elo_g") !== key) {
      store.set("h2k_elo_g", key);
      store.set("h2k_elo", String(my + d));
    }
    return `<p class="hint">Ranked: <b style="color:${d >= 0 ? "#2ecc71" : "#ff6b4a"}">${d >= 0 ? "+" : ""}${d}</b> → ${elo()} rating</p>`;
  },
  hostTick() {
    host && host.tick();
  },
  guestFrame(dt: number) {
    if (!guest) return;
    guest.tempo = IN.TEMPO;
    guest.frame(dt, () => {
      const i: any = hum();
      if (skipReq) {
        i.skip = 1;
        skipReq = 0;
      }
      return i;
    });
    const k = CT.findIndex((c) => c.id === t!.me);
    V.focus = k < 0 ? 0 : k;
    if (G.S !== "play" && G.S !== "over" && !G.RPL && guest.L && guest.L.st !== "lobby") G.setT(G.T + dt);
  },
  backToLobby() {
    if (host) {
      host.backToLobby();
      renderHostLobby();
    } else if (guest) renderGuestLobby();
  },
  /** Connection strip, top-right of the HUD. */
  hud(X: CanvasRenderingContext2D) {
    if (!NET.role || !t) return;
    X.textAlign = "right";
    X.font = "700 11px system-ui";
    let s = "",
      worst = 0;
    const L = host ? host.L : guest ? guest.L : null,
      nameOf = (id: string) => (L && (L.slots.find((x) => x.id === id) || { n: "" }).n) || "Fan";
    if (host) {
      const gs = [...host.guests.values()];
      worst = Math.max(0, ...gs.map((g) => g.ping || 0));
      const watch = gs.filter((g) => g.st && g.st.tm === -1).length;
      s = `HOST · ${NET.code} · ${gs.map((g) => clean2(nameOf(g.id) || g.st.n) + " " + (g.ping ? Math.round(g.ping) + "ms" : "…")).join(" · ")}${watch ? " · 👁 " + watch : ""}`;
    } else if (guest) {
      worst = guest.rtt;
      s = `ONLINE · ${NET.code} · ${guest.rtt ? Math.round(guest.rtt) : "…"} ms · buffer ${Math.round((guest.D * 1000) / 60)} ms${guest.side === -1 ? " · WATCHING" : ""}`;
    }
    const w = X.measureText(s).width;
    X.fillStyle = "rgba(0,0,0,.5)";
    X.fillRect(948 - w - 30, 72, w + 34, 18);
    X.fillStyle = t.connected() ? "#e9eefc" : "#ff6b4a";
    X.fillText(s, 948, 85);
    // signal bars: green < 80 ms, yellow < 160, red beyond (or disconnected)
    const bars = !t.connected() ? 0 : !worst ? 2 : worst < 80 ? 4 : worst < 160 ? 3 : worst < 260 ? 2 : 1,
      bc = bars >= 4 ? "#2ecc71" : bars === 3 ? "#ffd23f" : "#ff6b4a";
    for (let i = 0; i < 4; i++) {
      X.fillStyle = i < bars ? bc : "rgba(255,255,255,.2)";
      X.fillRect(948 - w - 24 + i * 5, 86 - 4 - i * 3, 3, 4 + i * 3);
    }
    // quick-chat bubbles over the speaker's player, plus a feed for spectators
    for (let i = BUB.length - 1; i >= 0; i--) {
      const b = BUB[i];
      b.t -= 1 / 60;
      if (b.t <= 0) {
        BUB.splice(i, 1);
        continue;
      }
      const c = CT.find((c) => (c.id === "p1" ? "host" : c.id) === b.who),
        p = c && G.P[c.idx],
        msg = CHAT[b.k] || "";
      X.globalAlpha = Math.min(1, b.t * 2);
      X.font = "800 13px system-ui";
      X.textAlign = "center";
      if (p) {
        const q = prj(p.x, p.y, p.z + 100),
          bw = X.measureText(msg).width + 16;
        X.fillStyle = "rgba(255,255,255,.92)";
        X.fillRect(q[0] - bw / 2, q[1] - 18, bw, 22);
        X.fillStyle = "#111";
        X.fillText(msg, q[0], q[1] - 2);
      } else {
        X.textAlign = "left";
        X.fillStyle = "#fff";
        X.fillText(clean2(nameOf(b.who)) + ": " + msg, 14, 120 + i * 18);
      }
      X.globalAlpha = 1;
    }
    if (guest && (guest.stall || guest.hostGoneAt)) {
      X.textAlign = "center";
      X.font = "900 22px system-ui";
      X.fillStyle = "#ffd23f";
      X.fillText(guest.hostGoneAt && performance.now() - guest.hostGoneAt > 4000 ? "HOST LEFT THE GAME" : "WAITING FOR HOST…", 480, 280);
    }
  },
};
function err(e: any) {
  const n = document.getElementById("nerr");
  if (n) n.textContent = String((e && e.message) || e);
}

// ---------------- host ----------------
function teamSelect(id: string, np: number, cur: number) {
  let o = "";
  for (let i = 0; i < choices(np); i++) o += `<option value="${i}" ${i === cur ? "selected" : ""}>${esc(teamName(np, i))}</option>`;
  return `<select id="${id}" style="background:#1c2140;color:#fff;border:1px solid #3a4280;border-radius:8px;padding:6px">${o}</select>`;
}
function slotList(L: Lobby, me: string) {
  const side = (tm: number) =>
    L.slots
      .filter((s) => s.tm === tm)
      .map((s) => `<div class="pl" style="--d:0ms;opacity:1"><b>${esc(s.n)}${s.id === me || s.id === "host" ? (s.id === "host" ? " (host)" : " (you)") : ""} <small style="opacity:.6">★${s.elo || 1000}</small></b><span>${s.on ? (s.rdy || s.id === "host" ? "READY" : "…") : "OFFLINE"}</span></div>`)
      .join("") || '<p class="lg">AI</p>';
  return `<div class="opts" style="align-items:flex-start"><div style="flex:1;min-width:150px"><b>HOME · ${esc(teamName(L.np, L.teams[0]))}</b>${side(0)}</div><div style="flex:1;min-width:150px"><b>AWAY · ${esc(teamName(L.np, L.teams[1]))}</b>${side(1)}</div></div>`;
}
let shownKey = "";
const lobbyKey = (L: Lobby, r: number, x: any) => JSON.stringify([L.st, L.teams, L.ql, L.pro, L.slots.map((s) => [s.id, s.tm, s.rdy, s.on, s.n, s.elo]), r, x]);
const watchKey = () => (host ? [...host.guests.values()].map((g) => g.id + ":" + (g.st && g.st.tm)).join(",") : "");
function renderHostLobby() {
  if (!host) return;
  shownKey = lobbyKey(host.L, 0, watchKey());
  const L = host.L,
    me = L.slots.find((s) => s.id === "host");
  G.setS("menu");
  ov().style.display = "flex";
  ov().innerHTML = `<div class="logo" style="font-size:34px">GAME <span>${NET.code}</span></div><div class="sub">SHARE THIS CODE · FRIENDS PICK "PLAY ONLINE" → JOIN</div><button id="cpy" style="margin:4px">⧉ Copy code</button><p class="hint">${[...host.guests.values()].map((g) => esc(clean2(g.st.n)) + " " + (g.ping ? Math.round(g.ping) + " ms" : "…")).join(" · ")}</p>
  ${slotList(L, "host")}${(() => {
    const w = [...host.guests.values()].filter((g) => g.st && g.st.tm === -1).map((g) => esc(clean2(g.st.n)));
    return w.length ? `<p class="hint">👁 Watching: ${w.join(", ")}</p>` : "";
  })()}<p class="hint">Quick chat in game: keys 1–6 (${CHAT.map(esc).join(" · ")})</p>
  <div class="opts"><b>YOUR SIDE</b><button data-sd="0" class="${me && me.tm === 0 ? "on" : ""}">Home</button><button data-sd="1" class="${me && me.tm === 1 ? "on" : ""}">Away</button>
  <b>${L.np > 1 ? "TEAMS" : "PLAYERS"}</b>${teamSelect("t0", L.np, L.teams[0])} vs ${teamSelect("t1", L.np, L.teams[1])}
  <b>QUARTER LENGTH</b>${[30, 60, 120].map((q) => `<button data-ql="${q}" class="${L.ql === q ? "on" : ""}">${q}s</button>`).join("")}
  <b>PRO PLAY</b><button data-pro="1" class="${L.pro ? "on" : ""}">On</button><button data-pro="0" class="${L.pro ? "" : "on"}">Off</button></div>
  <button class="big" id="go" ${host.canStart() ? "" : 'style="opacity:.5"'}>${host.canStart() ? "START GAME ▶" : "WAITING FOR READY…"}</button><button id="lv" style="margin-top:8px">Leave</button>`;
  ov()
    .querySelectorAll<HTMLElement>("[data-sd]")
    .forEach((b) => (b.onclick = () => (host!.setSide(+b.dataset.sd!), renderHostLobby())));
  ov()
    .querySelectorAll<HTMLElement>("[data-ql]")
    .forEach((b) => (b.onclick = () => (host!.setOpt("ql", +b.dataset.ql!), renderHostLobby())));
  ov()
    .querySelectorAll<HTMLElement>("[data-pro]")
    .forEach((b) => (b.onclick = () => (host!.setOpt("pro", +b.dataset.pro!), renderHostLobby())));
  const ts = () => host!.setTeams(+($("#t0") as HTMLSelectElement).value, +($("#t1") as HTMLSelectElement).value);
  $("#t0").onchange = ts;
  $("#t1").onchange = ts;
  $("#go").onclick = () => {
    if (!host!.canStart()) return;
    audio.crowdInit();
    host!.start(IN.TEMPO);
    V.focus = Math.max(0, CT.findIndex((c) => c.id === "p1"));
    ov().style.display = "none";
    TX.length = 0;
    watchHidden();
  };
  $("#lv").onclick = () => leave();
  $("#cpy").onclick = () => {
    const done = () => ($("#cpy").textContent = "Copied ✓");
    try {
      navigator.clipboard.writeText(NET.code).then(done, () => ($("#cpy").textContent = NET.code));
    } catch {
      $("#cpy").textContent = NET.code;
    }
  };
}
const clean2 = (n: any) => String(n || "Player").slice(0, 14);
/** A host tab in the background keeps simulating (browsers stop rAF when hidden). */
function watchHidden() {
  if (hiddenTimer) return;
  let last = performance.now(),
    acc = 0;
  hiddenTimer = setInterval(() => {
    const now = performance.now();
    if (!document.hidden || NET.role !== "host") {
      last = now;
      acc = 0;
      return;
    }
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    let k = 0;
    while (acc >= 1 / 60 && k < 15) {
      if (G.S === "play" || G.RPL) {
        G.upd(1 / 60);
        host && host.tick();
      }
      acc -= 1 / 60;
      k++;
    }
  }, 50);
}

// ---------------- guest ----------------
function startGuest(code: string, name: string) {
  NET.code = code;
  NET.role = "guest";
  IN.MP2 = 0;
  guest = new GuestSession(t!, { n: name, tok: tok(), code, elo: elo() });
  guest.onChat = onChat;
  guest.onLobby = (L) => {
    if (L.st === "lobby") renderGuestLobby();
  };
  guest.onStart = () => {
    audio.crowdInit();
    ov().style.display = "none";
    TX.length = 0;
    (window as any).H2K && (window as any).H2K.resetFx && (window as any).H2K.resetFx(0);
  };
  guest.onFx = (f) => {
    G.FX.push(f);
    if (G.FX.length > 64) G.FX.shift(); // same cap as the sim's own emitter
  };
  renderGuestLobby();
  setTimeout(() => {
    if (guest && !guest.L) err(new Error(`No game ${code} found yet — check the code, or wait for the host.`));
  }, 6000);
}
function renderGuestLobby() {
  if (!guest) return;
  shownKey = guest.L ? lobbyKey(guest.L, guest.rdy, Math.round(guest.rtt / 25)) : "none";
  const L = guest.L;
  ov().style.display = "flex";
  if (!L) {
    ov().innerHTML = `<div class="logo" style="font-size:34px">JOINING <span>${NET.code}</span></div><p>Looking for the host…</p><div id="nerr" style="color:#ff9966"></div><button id="lv">Cancel</button>`;
    $("#lv").onclick = () => leave();
    return;
  }
  const mine = L.slots.find((s) => s.id === t!.me);
  ov().innerHTML = `<div class="logo" style="font-size:34px">GAME <span>${esc(L.code)}</span></div><div class="sub">${L.np > 1 ? "5V5" : "1V1"} · ${L.ql}s QUARTERS · HOSTED BY ${esc(
    (L.slots.find((s) => s.id === "host") || { n: L.ded ? "SERVER" : "HOST" }).n,
  )}</div>
  ${slotList(L, t!.me)}
  <div class="opts"><b>PICK A SIDE</b><button data-sd="0" class="${mine && mine.tm === 0 ? "on" : ""}">Home</button><button data-sd="1" class="${mine && mine.tm === 1 ? "on" : ""}">Away</button><button data-sd="-1" class="${guest!.side === -1 ? "on" : ""}">Watch</button></div>
  <p class="hint">Ping ${guest.rtt ? Math.round(guest.rtt) + " ms" : "measuring…"}</p>
  <button class="big" id="rd" ${mine ? "" : 'style="opacity:.5"'}>${guest.rdy ? "READY ✓ (tap to cancel)" : "READY UP"}</button><button id="lv" style="margin-top:8px">Leave</button>
  <p class="note">${L.ded ? "Dedicated server: the game starts when every seated player is ready." : "The host starts the game when everyone is ready."}</p>`;
  ov()
    .querySelectorAll<HTMLElement>("[data-sd]")
    .forEach((b) => (b.onclick = () => (guest!.setSide(+b.dataset.sd!), setTimeout(renderGuestLobby, 150))));
  $("#rd").onclick = () => {
    guest!.setReady(guest!.rdy ? 0 : 1);
    renderGuestLobby();
  };
  $("#lv").onclick = () => leave();
}
function leave() {
  host && host.close();
  guest && guest.close();
  t && t.leave();
  host = guest = null;
  t = null;
  NET.role = null;
  G.setS("menu");
  menuBack ? menuBack() : location.reload();
}
