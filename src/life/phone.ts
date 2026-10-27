// LIFE phone overlay: lock screen (time, notifications) -> home screen -> apps: Messages, Calendar, Map (fast travel),
// Bank, Hoopr (fictional social network), Contacts, School (grades/GPA/homework), Stats (ratings/career/draft stock),
// Settings. Pure DOM, rendered from the life state; P / the phone button toggles it, Esc / the home bar goes back.
import * as S from "./state";
import { PLACES, placeById, doorOf, travelMin, isOpen, RIDE_COST, bedOf } from "./places";
import { kfmt, ago, fameTier, myPost, suggestions, pushPosts, postsFor, screenPosts, aiFeedPrompt, aiReplyPrompt, handleOf, clean, scrub } from "./social";
import { askJSON, aiReady, AI } from "./ai";

export interface PhoneCtx {
  L: () => S.Life;
  root: HTMLElement;
  travel: (id: string) => void;
  save: () => void;
  toast: (x: string, ic?: string) => void;
  refresh: () => void;
  quit: () => void;
  settingsChanged: () => void;
}
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const APPS: [string, string, string, string][] = [
  ["msg", "Messages", "💬", "linear-gradient(160deg,#5ef08a,#1fbf4f)"],
  ["cal", "Calendar", "📅", "linear-gradient(160deg,#fff,#e9e9ee)"],
  ["map", "Map", "🗺️", "linear-gradient(160deg,#7fe0a0,#2f9d6a)"],
  ["bank", "Bank", "💳", "linear-gradient(160deg,#3a4bff,#1b2499)"],
  ["hoopr", "Hoopr", "🏀", "linear-gradient(160deg,#ff8a3d,#e8541e)"],
  ["school", "School", "🎓", "linear-gradient(160deg,#ffd76a,#e0a526)"],
  ["stats", "Stats", "📊", "linear-gradient(160deg,#4a4f6a,#1c1f2e)"],
  ["lg", "League", "🏆", "linear-gradient(160deg,#ffcf5a,#c0392b)"],
  ["con", "Contacts", "👥", "linear-gradient(160deg,#c9ced6,#8a919c)"],
  ["set", "Settings", "⚙️", "linear-gradient(160deg,#9aa0aa,#5b616b)"],
];
const KC: Record<string, string> = { fan: "#e8541e", hater: "#6b2e2e", reporter: "#1d9bf0", analyst: "#6c5ce7", teammate: "#16a085", coach: "#2c3e50", rival: "#c0392b", brand: "#111", meme: "#8e44ad", news: "#0b7a8a", friend: "#f39c12", me: "#ffd23f" };

export function makePhone(cx: PhoneCtx) {
  const el = document.createElement("div");
  el.className = "phone";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Phone");
  el.innerHTML = `<div class="scrn"><div class="isl"></div><div class="sbar"><span id="pclk">9:41</span><span>●●● 5G 🔋</span></div><div class="app" id="papp"></div><div class="hind" id="phome" title="Home"><i></i></div></div>`;
  cx.root.appendChild(el);
  const app = el.querySelector("#papp") as HTMLElement,
    clk = el.querySelector("#pclk") as HTMLElement;
  let open = false,
    view = "lock",
    arg = "",
    feedBusy = false,
    hooprSeen = 0;
  const L = () => cx.L();
  (el.querySelector("#phome") as HTMLElement).onclick = () => go(view === "lock" ? "home" : view === "home" ? "lock" : "home");
  const hdr = (t: string, back = "home", extra = "") => `<div class="ah"><button data-back="${back}" aria-label="Back">‹ Back</button><b>${t}</b>${extra}</div>`;
  const bind = () => {
    app.querySelectorAll<HTMLElement>("[data-back]").forEach((b) => (b.onclick = () => go(b.dataset.back!)));
    app.querySelectorAll<HTMLElement>("[data-app]").forEach((b) => (b.onclick = () => go(b.dataset.app!)));
  };
  function badge(k: string) {
    const l = L();
    if (k === "msg") return S.unread(l);
    if (k === "hoopr") return Math.max(0, l.feed.length - hooprSeen) > 0 ? Math.min(99, l.feed.length - hooprSeen) : 0;
    if (k === "school") return l.courses.filter((c) => c.hw >= 0).length;
    if (k === "stats") return l.p.sp;
    return 0;
  }
  function go(v: string, a = "") {
    view = v;
    arg = a;
    render();
  }
  function render() {
    const l = L(),
      m = S.minOf(l.t);
    clk.textContent = S.hhmm(m).replace(/ (AM|PM)/, "");
    if (view === "lock") {
      const nts = l.notes.slice(-4).reverse();
      app.innerHTML = `<div class="wall"></div><div class="lock" id="plk"><div class="d">${S.WD[S.wdOf(S.dayOf(l.t))]} · ${esc(S.STAGE_N[l.stage])}</div><div class="t">${S.hhmm(m).replace(/ (AM|PM)/, "")}</div><div class="d">${esc(S.dateStr(l))}</div><div class="nt">${nts.map((n) => `<div>${n.ic} ${esc(n.x)}</div>`).join("")}</div><div class="sw2">tap to unlock</div></div>`;
      (app.querySelector("#plk") as HTMLElement).onclick = () => go("home");
      return;
    }
    if (view === "home") {
      app.innerHTML = `<div class="wall"></div><div class="home">${APPS.map(([k, n, ic, bg]) => {
        const b = badge(k);
        return `<button class="ai" data-app="${k}" aria-label="${n}"><i style="background:${bg}">${ic}</i>${b ? `<em>${b}</em>` : ""}<span>${n}</span></button>`;
      }).join("")}</div>`;
      bind();
      return;
    }
    const f = (VIEWS as any)[view];
    if (f) f();
    bind();
  }
  // ---------------- apps
  const VIEWS = {
    msg() {
      const l = L();
      const th = l.contacts.map((c) => ({ c, m: (l.msgs[c.id] || [])[(l.msgs[c.id] || []).length - 1], u: (l.msgs[c.id] || []).filter((m) => m.f !== "me" && !m.rd).length })).filter((x) => x.m);
      th.sort((a, b) => b.m!.t - a.m!.t);
      app.innerHTML = hdr("Messages") + th.map((x) => `<button class="li" data-th="${x.c.id}"><span class="av" style="background:${x.c.c}">${esc(x.c.n[0])}</span><span class="tx"><b>${esc(x.c.n)}</b><span>${esc(x.m!.f === "me" ? "You: " + x.m!.x : x.m!.x)}</span></span>${x.u ? '<span class="dot"></span>' : `<small style="opacity:.5">${ago(l.t, x.m!.t)}</small>`}</button>`).join("");
      app.querySelectorAll<HTMLElement>("[data-th]").forEach((b) => (b.onclick = () => go("thread", b.dataset.th!)));
    },
    thread() {
      const l = L(),
        c = l.contacts.find((c) => c.id === arg);
      const th = l.msgs[arg] || [];
      th.forEach((m) => (m.rd = 1));
      const last = [...th].reverse().find((m) => m.rep && m.rep.length);
      app.innerHTML = hdr(esc(c ? c.n : arg), "msg") + `<div class="msgs">${th.map((m) => `<div class="bub${m.f === "me" ? " me" : ""}">${esc(m.x)}</div>`).join("")}</div>${last ? `<div class="reps">${last.rep!.map((r, i) => `<button data-rp="${i}">${esc(r[0])}</button>`).join("")}</div>` : ""}`;
      app.querySelectorAll<HTMLElement>("[data-rp]").forEach(
        (b) =>
          (b.onclick = () => {
            S.reply(L(), arg, +b.dataset.rp!);
            cx.save();
            render();
            app.scrollTop = 1e6;
          }),
      );
      app.scrollTop = 1e6;
      cx.refresh();
    },
    cal() {
      const l = L(),
        d0 = S.dayOf(l.t),
        days: number[] = [];
      for (let d = Math.max(l.y0, d0 - 1); d < l.y0 + l.ylen && days.length < 8; d++) days.push(d);
      const col: Record<string, string> = { class: "#4fa3ff", exam: "#ff5a4f", practice: "#3ddc84", game: "#ffd23f", draft: "#e8541e" };
      app.innerHTML =
        hdr("Calendar") +
        `<div class="cal">${days
          .map((d) => {
            const ev = l.cal.filter((e) => e.day === d);
            return `<div class="dh${d === d0 ? " today" : ""}">${d === d0 ? "TODAY · " : ""}${S.WD[S.wdOf(d)].toUpperCase()} · DAY ${d - l.y0 + 1}</div>${
              ev.length
                ? ev
                    .map((e) => {
                      const st = e.s === 1 ? `<span class="tag g">${e.res ? (e.res.won ? "W " : "L ") + e.res.us + "-" + e.res.them : "DONE"}</span>` : e.s === 2 ? `<span class="tag r">${e.res ? (e.res.won ? "W " : "L ") + e.res.us + "-" + e.res.them + " · MISSED" : "MISSED"}</span>` : e.s === 3 ? '<span class="tag y">NOW</span>' : "";
                      return `<div class="ev" style="--c:${col[e.k] || "#888"}"><span class="tm">${S.hhmm(e.st)}</span><span class="tt">${esc(e.k === "game" ? (e.home ? "vs " : "@ ") + S.oppName(l, e) : e.title)}<small>${esc(placeById(e.place)?.n || e.place)}${e.big ? " · " + (e.big === "state" ? "🏆 State final" : "🔥 Tournament") : ""}</small></span>${st}</div>`;
                    })
                    .join("")
                : '<div class="note" style="padding:4px 4px 8px">Free day</div>'
            }`;
          })
          .join("")}</div>`;
    },
    map() {
      const l = L(),
        mins = S.minOf(l.t);
      app.innerHTML = hdr("Map") + `<div class="mapw"><canvas id="pmc" width="400" height="400"></canvas>${PLACES.filter((p) => !p.deco)
        .map((p) => {
          const u = (p.x + 340) / 680,
            v = (p.z + 340) / 680,
            unl = l.visited.includes(p.id) || p.k === "food" || p.k === "shop" || p.k === "court" || p.k === "gym";
          return `<button class="mpin${arg === p.id ? " on" : ""}" style="left:${u * 100}%;top:${v * 100}%;${unl ? "" : "opacity:.35"}" data-pin="${p.id}" title="${esc(p.n)}">${p.ic}</button>`;
        })
        .join("")}</div><div id="pmi" style="padding:6px 14px 20px"></div>`;
      drawMap(app.querySelector("#pmc") as HTMLCanvasElement, l, null);
      const info = app.querySelector("#pmi") as HTMLElement;
      const show = (id: string) => {
        const p = placeById(id)!,
          unl = l.visited.includes(p.id) || p.k === "food" || p.k === "shop" || p.k === "court" || p.k === "gym",
          d = doorOf(p),
          w = (window as any).__lifePos || { x: 0, z: 0 },
          tm = travelMin(w, d),
          ev = S.evAt(l, p.id);
        info.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><span style="font-size:30px">${p.ic}</span><div style="flex:1"><b style="font:800 16px system-ui">${esc(p.n)}</b><div class="note">${isOpen(p, mins) ? "Open now" : "Closed now"}${p.open ? ` · ${S.hhmm(p.open[0])} - ${S.hhmm(p.open[1])}` : ""}${ev ? ` · <b style="color:#ffd23f">${esc(ev.title)}</b>` : ""}</div></div></div>${unl ? `<button class="go" style="width:100%;margin-top:10px" data-ride="${p.id}">🚗 ZipRide · ${tm} min · $${RIDE_COST}</button>` : `<p class="note">Visit it once on foot to unlock fast travel.</p>`}`;
        const rb = info.querySelector("[data-ride]") as HTMLElement | null;
        if (rb)
          rb.onclick = () => {
            if (L().money < RIDE_COST) return cx.toast("Not enough money for a ride", "💸");
            close();
            cx.travel(p.id);
          };
      };
      app.querySelectorAll<HTMLElement>("[data-pin]").forEach(
        (b) =>
          (b.onclick = () => {
            app.querySelectorAll(".mpin").forEach((x) => x.classList.toggle("on", x === b));
            show(b.dataset.pin!);
          }),
      );
      const nx = S.nextEv(l);
      show(arg || (nx ? nx.place : bedOf(l.stage)));
    },
    bank() {
      const l = L(),
        wk = l.deals.reduce((a, d) => a + d.pay, 0);
      app.innerHTML =
        hdr("Bank") +
        `<div class="note" style="padding:4px 16px 0">Checking · ${esc(l.p.n)}</div><div class="big2">$${l.money.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
      <div class="kv"><span>Weekly endorsements</span><span>$${wk.toLocaleString()}</span>${l.contract ? `<span>Salary (per year)</span><span>$${l.contract.sal.toLocaleString()}</span><span>Contract years left</span><span>${l.contract.yrs}</span>` : ""}</div>
      ${l.deals.length ? `<h3 style="padding:0 16px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">DEALS</h3>${l.deals.map((d) => `<div class="li"><span class="av" style="background:#222">🤝</span><span class="tx"><b>${esc(d.b)}</b><span>$${d.pay.toLocaleString()} / week</span></span></div>`).join("")}` : `<p class="note" style="padding:0 16px">${l.stage === "hs" ? "High-school athletes can't take endorsement money. Keep building your following." : "Deals unlock at 2K, 10K, 40K, 150K and 500K followers."}</p>`}
      <h3 style="padding:0 16px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">ACTIVITY</h3>${[...l.txn]
        .reverse()
        .slice(0, 40)
        .map((t) => `<div class="li"><span class="tx"><b>${esc(t.x)}</b><span>Day ${S.dayOf(t.t) + 1} · ${S.hhmm(S.minOf(t.t))}</span></span><b style="color:${t.a >= 0 ? "#3ddc84" : "#fff"}">${t.a >= 0 ? "+" : "-"}$${Math.abs(t.a).toLocaleString()}</b></div>`)
        .join("")}`;
    },
    hoopr() {
      const l = L();
      hooprSeen = l.feed.length;
      app.innerHTML =
        hdr("Hoopr", "home", `<small style="font:700 12px system-ui;opacity:.75">${kfmt(l.followers)} followers</small>`) +
        `<div class="trend">${(l.tags.length ? l.tags : ["#Hoopr"]).map((t) => `<span>${esc(t)}</span>`).join("")}</div>
        <div class="compose"><input id="hpi" maxlength="240" placeholder="What's happening, @${esc(handleOf(l))}?" aria-label="New post" autocomplete="off"><div class="sg">${suggestions(l)
          .map((s, i) => `<button data-sg="${i}">${esc(s)}</button>`)
          .join("")}</div><button class="pbtn" id="hpp">Post</button></div>
        <div id="hfeed">${feedBusy ? '<div class="shim"></div><div class="shim"></div>' : ""}${l.feed.slice(0, 50).map(postHtml).join("") || '<p class="note" style="padding:14px">Nothing yet. Play a game or post something!</p>'}</div>`;
      const inp = app.querySelector("#hpi") as HTMLInputElement,
        sg = suggestions(l);
      app.querySelectorAll<HTMLElement>("[data-sg]").forEach((b) => (b.onclick = () => (inp.value = sg[+b.dataset.sg!])));
      (app.querySelector("#hpp") as HTMLElement).onclick = () => doPost(inp.value);
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") doPost(inp.value);
      };
      inp.onkeyup = (e) => e.stopPropagation();
      cx.refresh();
      maybeAIFeed();
    },
    school() {
      const l = L(),
        g = S.gpa(l);
      if (!l.courses.length && !l.done.length) {
        app.innerHTML = hdr("School") + `<p class="note" style="padding:14px">No classes${l.stage === "nba" ? " - you're a pro now. (Your transcript is below.)" : "."}</p>`;
        return;
      }
      app.innerHTML =
        hdr("School") +
        `<div class="big2">${g == null ? "—" : g.toFixed(2)} <small style="font:700 13px system-ui;opacity:.7">GPA</small></div>${S.probation(l) ? '<p style="padding:0 16px"><span class="tag r">ACADEMIC PROBATION</span> <span class="note">Raise your GPA to 2.00 to play.</span></p>' : g != null && g >= 3.5 ? '<p style="padding:0 16px"><span class="tag g">DEAN\'S LIST PACE</span></p>' : ""}
        ${l.courses
          .map((c, i) => {
            const p = S.coursePct(c),
              nx = l.cal.find((e) => e.c === i && e.s === 0 && (e.k === "class" || e.k === "exam"));
            return `<div class="li"><span class="av" style="background:#1f2a55">${p == null ? "–" : S.letter(p)[0]}</span><span class="tx"><b>${esc(c.n)}</b><span>${p == null ? "No grades yet" : Math.round(p) + "% · " + c.sc.length + " grades"}${nx ? " · next " + S.WD[S.wdOf(nx.day)] + " " + S.hhmm(nx.st) + " @ " + esc(placeById(nx.place)?.n) : ""}</span></span>${c.hw >= 0 ? '<span class="tag y">HW</span>' : ""}${c.study > 0 ? '<span class="tag g">STUDIED</span>' : ""}</div>`;
          })
          .join("")}
        <p class="note" style="padding:6px 16px">Homework: do it at your desk (${l.stage === "college" ? "dorm" : "home"}) or the library before the next class. Study at the library (or book a $25 tutor) to boost your next quiz.</p>
        ${l.done.length ? `<h3 style="padding:0 16px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">TRANSCRIPT</h3><table style="margin:0 8px 20px;width:calc(100% - 16px)"><tr><th>COURSE</th><th>TERM</th><th>GRADE</th></tr>${l.done.map((d) => `<tr><td>${esc(d.n)}</td><td>${esc(d.yr)}</td><td>${S.letter(d.pct)[0]}</td></tr>`).join("")}</table>` : ""}`;
    },
    stats() {
      const l = L(),
        p = l.p,
        ln = l.career,
        pg = (k: number, g = ln.gp) => (g ? (k / g).toFixed(1) : "0.0"),
        st = S.draftStock(l);
      const bar = (k: "c" | "i" | "s" | "d" | "j", n: string) => `<div style="display:grid;grid-template-columns:70px 1fr 36px ${p.sp ? "30px" : ""};gap:8px;align-items:center;padding:3px 16px;font:700 12px system-ui"><span>${n}</span><span class="bar2"><i style="width:${p[k]}%"></i></span><b>${Math.floor(p[k])}</b>${p.sp ? `<button class="gh" style="padding:2px 6px" data-sp="${k}">+</button>` : ""}</div>`;
      app.innerHTML =
        hdr("Stats") +
        `<div style="display:flex;gap:12px;align-items:center;padding:4px 16px 8px"><span class="av" style="background:${p.col};width:56px;height:56px;font-size:20px;color:#111">${S.ovrOf(p)}</span><div><b style="font:900 18px system-ui">${esc(p.n)}</b><div class="note">${esc(p.pos)} · ${Math.floor(p.ht)}'${Math.round((p.ht % 1) * 12)}" · Level ${p.lv} · ${fameTier(l.followers)}</div></div></div>
        <div style="padding:0 16px 8px"><div class="bar2"><i style="width:${Math.min(100, (p.xp / (300 + p.lv * 60)) * 100)}%"></i></div><div class="note">${p.xp} / ${300 + p.lv * 60} XP${p.sp ? ` · <b style="color:#ffd23f">${p.sp} skill points to spend</b>` : ""}</div></div>
        ${bar("c", "3PT")}${bar("i", "INSIDE")}${bar("s", "SPEED")}${bar("d", "DEFENSE")}${bar("j", "JUMP")}
        <div class="kv"><span>Health</span><span>${Math.round(l.health)}%${l.inj ? " · " + esc(l.inj.k) : ""}</span><span>Reputation</span><span>${Math.round(l.rep)}</span><span>Followers</span><span>${l.followers.toLocaleString()}</span>
        <span>${esc(l.team.name)}</span><span>${l.team.w}-${l.team.l}</span><span>This season</span><span>${l.line.gp} GP · ${pg(l.line.pts, l.line.gp)} PPG · ${pg(l.line.reb, l.line.gp)} RPG · ${pg(l.line.ast, l.line.gp)} APG</span>
        <span>Career</span><span>${ln.gp} GP · ${pg(ln.pts)} PPG · ${pg(ln.reb)} RPG · ${pg(ln.ast)} APG</span><span>FG / 3P</span><span>${ln.fga ? Math.round((100 * ln.fgm) / ln.fga) : 0}% / ${ln.tpa ? Math.round((100 * ln.tpm) / ln.tpa) : 0}%</span>
        ${l.stage === "college" || l.stage === "draft" ? `<span>Draft stock</span><span>${st} · proj. ${S.projPick(st) > 60 ? "undrafted" : "#" + S.projPick(st)}</span>` : ""}${l.draft ? `<span>Drafted</span><span>#${l.draft.pick} · ${esc(S.NBA_NAMES[l.draft.team])}</span>` : ""}</div>
        ${l.hist.length ? `<table style="margin:6px 8px 20px;width:calc(100% - 16px)"><tr><th>YEAR</th><th>TEAM</th><th>REC</th><th>PPG</th><th>GPA</th></tr>${l.hist.map((h) => `<tr><td>${esc(S.STAGE_N[h.stage])} ${h.yr}</td><td>${esc(h.team.split(" ").slice(-1)[0])}</td><td>${h.rec}</td><td>${pg(h.line.pts, h.line.gp)}</td><td>${h.gpa == null ? "—" : h.gpa.toFixed(2)}</td></tr><tr><td colspan="5" style="opacity:.7;font-size:11px">${h.aw.map((a) => "🏅 " + esc(a)).join(" · ")}</td></tr>`).join("")}</table>` : ""}`;
      const lg = S.legacy(l);
      app.insertAdjacentHTML(
        "beforeend",
        `<div style="padding:4px 16px 20px"><div class="note">Hall of Fame tracker · legacy ${lg} / ${S.HOF}</div><div class="bar2"><i style="width:${Math.min(100, (lg / S.HOF) * 100)}%"></i></div>${l.stage === "nba" ? `<div class="row"><span class="note">Agent: ${esc(l.agent || "none")} · contract $${l.contract ? (l.contract.sal / 1e6).toFixed(1) + "M x " + l.contract.yrs + " yrs" : "-"}</span>${l.flags.treq ? '<span class="tag y">TRADE REQUESTED</span>' : '<button class="gh" id="ptr">Request a trade</button>'}</div>` : ""}</div>`,
      );
      const tr = app.querySelector("#ptr") as HTMLElement | null;
      if (tr)
        tr.onclick = () => {
          if (!confirm("Request a trade? Your coach won't like it.")) return;
          S.requestTrade(L());
          cx.save();
          cx.toast("Your agent told the front office. Expect a move soon.", "📞");
          render();
        };
      app.querySelectorAll<HTMLElement>("[data-sp]").forEach(
        (b) =>
          (b.onclick = () => {
            if (S.spend(L(), b.dataset.sp as any)) cx.save();
            render();
          }),
      );
    },
    lg() {
      const l = L(),
        st = S.standings(l),
        tour = l.cal.filter((e) => e.rd && e.big);
      app.innerHTML =
        hdr("League") +
        `<div class="note" style="padding:2px 16px 8px">${esc(S.STAGE_N[l.stage])}${l.stage === "college" ? " · Year " + l.yr : l.stage === "nba" ? " · Season " + l.yr : ""} · you're <b style="color:#ffd23f">#${st.me || "-"}</b></div>
        <table style="margin:0 8px;width:calc(100% - 16px)"><tr><th>#</th><th>TEAM</th><th>W-L</th></tr>${st.rows
          .map((c, i) => `<tr${c === l.league[0] ? ' style="color:#ffd23f;font-weight:800"' : ""}><td>${i + 1}</td><td><span class="sw" style="display:inline-block;width:10px;height:10px;background:${c.col};border:0;margin-right:6px"></span>${esc(c.name)}</td><td>${c.w}-${c.l}</td></tr>`)
          .join("")}</table>
        ${tour.length ? `<h3 style="padding:10px 16px 0;font:800 11px system-ui;letter-spacing:2px;opacity:.7">${tour[0].big === "mm" ? "MARCH MADNESS" : "STATE PLAYOFFS"}</h3>${tour.map((e) => `<div class="li"><span class="tx"><b>${esc(e.title)}</b><span>${S.WD[S.wdOf(e.day)]} ${S.hhmm(e.st)} · vs ${esc(S.oppName(l, e))}</span></span>${e.res ? `<span class="tag ${e.res.won ? "g" : "r"}">${e.res.won ? "W" : "L"} ${e.res.us}-${e.res.them}</span>` : '<span class="tag">UPCOMING</span>'}</div>`).join("")}` : ""}`;
    },
    con() {
      const l = L();
      app.innerHTML = hdr("Contacts") + l.contacts.map((c) => `<button class="li" data-th="${c.id}"><span class="av" style="background:${c.c}">${esc(c.n[0])}</span><span class="tx"><b>${esc(c.n)}</b><span>${esc(c.role)}</span></span><span title="Relationship" style="font:800 12px system-ui">${"❤️".repeat(Math.max(0, Math.round(c.aff / 25)))}${c.aff < 25 ? "🖤" : ""} ${Math.round(c.aff)}</span></button>`).join("");
      app.querySelectorAll<HTMLElement>("[data-th]").forEach((b) => (b.onclick = () => go("thread", b.dataset.th!)));
    },
    set() {
      const l = L(),
        s = l.set;
      const seg = (k: string, opts: [number, string][]) => `<div class="seg">${opts.map(([v, n]) => `<button class="pill${(s as any)[k] === v ? " on" : ""}" data-set="${k}" data-v="${v}">${n}</button>`).join("")}</div>`;
      app.innerHTML =
        hdr("Settings") +
        `<div style="padding:4px 2px 20px">
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">DAY LENGTH</h3>${seg("spd", [[0.5, "Relaxed"], [1, "Normal"], [2, "Fast"]])}
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">ALARM</h3>${seg("alarm", [[360, "6:00"], [390, "6:30"], [420, "7:00"], [450, "7:30"], [480, "8:00"]])}
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">GAME QUARTERS</h3>${seg("ql", [[30, "30 s"], [60, "1 min"], [120, "2 min"], [180, "3 min"]])}
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">DIFFICULTY</h3>${seg("diff", [[-1, "Auto"], [0, "Rookie"], [1, "Pro"], [2, "All-Star"], [3, "HOF"]])}
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">AI (CLAUDE)</h3>${seg("ai", [[1, "On"], [0, "Offline only"]])}<p class="note" style="padding:0 14px">Quiz questions and Hoopr posts can be written by Claude when this page runs on claude.ai (it asks first). Offline, the built-in question bank and post generator are used. Your own posts stay on this device.</p>
        <h3 style="padding:0 14px;font:800 11px system-ui;letter-spacing:2px;opacity:.7">ACCESSIBILITY</h3>${seg("big", [[0, "Normal text"], [1, "Bigger text"]])}${seg("cb", [[0, "Standard colours"], [1, "Colour-blind safe"]])}${seg("rm", [[0, "Motion on"], [1, "Reduce motion"]])}
        <div class="seg" style="margin-top:12px"><button class="gh" id="psv">💾 Save now</button><button class="gh" id="pqt">⏏ Quit to hub</button></div><p class="note" style="padding:0 14px">AI status: ${AI.last || "idle"}</p></div>`;
      app.querySelectorAll<HTMLElement>("[data-set]").forEach(
        (b) =>
          (b.onclick = () => {
            (L().set as any)[b.dataset.set!] = +b.dataset.v!;
            AI.on = L().set.ai;
            cx.settingsChanged();
            cx.save();
            render();
          }),
      );
      (app.querySelector("#psv") as HTMLElement).onclick = () => (cx.save(), cx.toast("Saved", "💾"));
      (app.querySelector("#pqt") as HTMLElement).onclick = () => cx.quit();
    },
  };
  function postHtml(p: S.Post) {
    const l = L(),
      col = KC[p.k] || "#555";
    return `<div class="post"><span class="pa" style="background:${col}">${esc((p.n || p.h)[0].toUpperCase())}</span><div class="pb"><div class="ph2"><b>${esc(p.n)}</b>${p.v ? '<span class="vf">✓</span>' : ""}<span>@${esc(p.h)} · ${ago(l.t, p.t)}</span>${p.ai ? '<span title="Written by Claude">✨</span>' : ""}</div><div class="px">${esc(p.x)}</div><div class="pf"><span>💬 ${p.re ? p.re.length : Math.round(p.lk / 40)}</span><span>🔁 ${kfmt(p.rp)}</span><span>♥ ${kfmt(p.lk)}</span></div>${p.re && p.re.length ? `<div class="rep">${p.re.map((r) => `<div><b>${esc(r.n)}</b> <span style="opacity:.55">@${esc(r.h)}</span> ${esc(r.x)}</div>`).join("")}</div>` : ""}</div></div>`;
  }
  async function doPost(text: string) {
    const l = L(),
      t = String(text || "").trim();
    if (!t) return;
    const r = myPost(l, t);
    if (!r) return;
    cx.toast(`Posted · +${kfmt(r.gain)} followers`, "🏀");
    cx.save();
    render();
    // AI replies (on top of the procedural ones), only if available
    if (await aiReady()) {
      const x = await askJSON("re:" + r.post.id, aiReplyPrompt(l, S.aiSummary(l), scrub(clean(t).x)));
      const ps = screenPosts(l, x, 3);
      if (ps.length) {
        r.post.re = [...ps, ...(r.post.re || [])].slice(0, 6);
        cx.save();
        if (view === "hoopr") render();
      }
    }
  }
  let lastAIFeed = -1;
  async function maybeAIFeed() {
    const l = L(),
      key = "feed:" + S.dayOf(l.t) + ":" + l.log.length;
    if (feedBusy || lastAIFeed === l.log.length || !(await aiReady())) return;
    lastAIFeed = l.log.length;
    feedBusy = true;
    if (view === "hoopr") render();
    const x = await askJSON(key, aiFeedPrompt(l, S.aiSummary(l), 5));
    feedBusy = false;
    const ps = screenPosts(l, x, 6);
    if (ps.length) pushPosts(l, ps), cx.save();
    if (view === "hoopr" && open) render();
  }
  function close() {
    open = false;
    el.classList.remove("on");
  }
  return {
    el,
    isOpen: () => open,
    toggle(v?: boolean, at?: string) {
      open = v ?? !open;
      el.classList.toggle("on", open);
      if (open) go(at || (view === "lock" || !view ? "lock" : view === "thread" ? "msg" : view));
    },
    open(at: string, a = "") {
      open = true;
      el.classList.add("on");
      go(at, a);
    },
    close,
    back() {
      if (view === "thread") go("msg");
      else if (view !== "home" && view !== "lock") go("home");
      else close();
    },
    view: () => view,
    render,
    /** Push procedural posts for an event (and ask the AI for more next time the feed opens). */
    event(ev: any) {
      pushPosts(L(), postsFor(L(), ev));
    },
  };
}
export type Phone = ReturnType<typeof makePhone>;

/** Town map drawing (minimap + Map app). Roads, footprints coloured by kind, player arrow, objective. */
const KCOL: Record<string, string> = { home: "#ffd23f", school: "#c0392b", arena: "#e8541e", gym: "#ff3b30", food: "#f39c12", shop: "#ff7ab6", court: "#4fa3ff", campus: "#b58b5a", dorm: "#d4b48c", house: "#8a8f99", service: "#9b59b6" };
import { ROADS } from "./places";
export function drawMap(c: HTMLCanvasElement, l: S.Life, me: { x: number; z: number; f: number } | null, target?: { x: number; z: number } | null, zoom = 1, rot = 0) {
  const g = c.getContext("2d")!,
    W = c.width,
    H = c.height;
  g.save();
  g.fillStyle = "#3d6b35";
  g.fillRect(0, 0, W, H);
  const k = (W / 680) * zoom,
    cx0 = me && zoom > 1 ? me.x : 0,
    cz0 = me && zoom > 1 ? me.z : 0;
  g.translate(W / 2, H / 2);
  g.rotate(rot);
  g.scale(k, k);
  g.translate(-cx0, -cz0);
  g.fillStyle = "#4a7a40";
  g.fillRect(-235, -200, 170, 120);
  g.fillStyle = "#2f3236";
  for (const r of ROADS) g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
  g.fillStyle = "#b9b6ae";
  for (const r of ROADS) {
    const h = r.x1 - r.x0 > r.z1 - r.z0;
    if (h) g.fillRect(r.x0, r.z0 - 9, r.x1 - r.x0, 9), g.fillRect(r.x0, r.z1, r.x1 - r.x0, 9);
    else g.fillRect(r.x0 - 9, r.z0, 9, r.z1 - r.z0), g.fillRect(r.x1, r.z0, 9, r.z1 - r.z0);
  }
  for (const p of PLACES) {
    g.fillStyle = KCOL[p.k] || "#888";
    g.globalAlpha = p.deco ? 0.5 : 0.95;
    if (p.oval) {
      g.beginPath();
      g.ellipse(p.x, p.z, p.w / 2, p.d / 2, 0, 0, 6.3);
      g.fill();
    } else g.fillRect(p.x - p.w / 2, p.z - p.d / 2, p.w, p.d);
  }
  g.globalAlpha = 1;
  if (zoom > 1) {
    g.font = `${Math.round(22 / zoom)}px system-ui`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of PLACES) if (!p.deco && p.ic) g.fillText(p.ic, p.x, p.z);
  }
  if (target) {
    g.strokeStyle = "#ffd23f";
    g.lineWidth = 4 / k;
    g.beginPath();
    g.arc(target.x, target.z, 14, 0, 6.3);
    g.stroke();
    g.fillStyle = "#ffd23f";
    g.beginPath();
    g.arc(target.x, target.z, 6, 0, 6.3);
    g.fill();
  }
  if (me) {
    g.translate(me.x, me.z);
    g.rotate(me.f);
    g.fillStyle = "#fff";
    g.strokeStyle = "#111";
    g.lineWidth = 2 / k;
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(-8, 7);
    g.lineTo(-4, 0);
    g.lineTo(-8, -7);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.restore();
  // off-screen objective: an arrow at the rim (minimap)
  if (target && me && zoom > 1) {
    const dx = target.x - me.x,
      dz = target.z - me.z,
      a = Math.atan2(dz, dx) + rot,
      r2 = (W / 2) * 0.86,
      d = Math.hypot(dx, dz) * k;
    if (d > r2) {
      // a gold triangle at the rim pointing out toward the objective
      g.save();
      g.translate(W / 2 + Math.cos(a) * r2, H / 2 + Math.sin(a) * r2);
      g.rotate(a);
      g.fillStyle = "#ffd23f";
      g.strokeStyle = "#111";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(14, 0);
      g.lineTo(-8, 10);
      g.lineTo(-8, -10);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}
