// Hoops 2K27 - the HTML game's menus over the Unity WebGL build (hand-written, plain JS, no framework, no sim).
// Ports src/client/main.ts (hub: mode cards, quick play, update log, controls) and src/client/game.ts (matchup screen
// menu() with lineups + avatar() portraits + ratings, settings drawer #sd, pause, final screen with record, player of
// the game, stat bars, shot charts) and src/client/modesui.ts (mode strip, clutch picker). Unity draws the game and
// its in-game HUD underneath (Hud.cs / Broadcast.cs).
// Bridge: page -> Unity  unityInstance.SendMessage("Hoops2K27", "FromPage", json)   (PageBridge.cs)
//           {cmd:"start", mode, arg, np, sel, opp, diff, ql, set:{...}, rec:{w,l}} | {cmd:"resume"} | {cmd:"pause"} |
//           {cmd:"quit"} | {cmd:"rematch"} | {cmd:"replay"} | {cmd:"online"} | {cmd:"setting", k, v}
//         Unity -> page  HoopsUi_Show(screen, json) (Assets/Plugins/WebGL/HoopsUi.jslib) -> H2KUI.show(screen, json)
//           "ready" | "menu" | "pause" {sc, cl, q, cm, m, s, fx} | "final" {sc, cl, pc, me, gm, box, xs, shots, hx}
// Settings live in localStorage h2k_set in the browser game's shape (shared with it on the same origin).
(function () {
  "use strict";
  var D = window.H2K_DATA || { TM: [], CLUTCH: [], MODES: [] },
    HB = window.H2K_HUB || { LOG: [], K1: [], K2: [], K3: [], K4: [], K5: [] };
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
  var lsGet = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  var lsPut = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var POS = ["PG", "SG", "SF", "PF", "C"],
    DIFFN = ["Rookie", "Pro", "All-Star", "Hall of Fame"],
    CAMN = ["Broadcast", "2K Style", "Baseline", "Player Lock"],
    MN = ["Arrow 2", "Bar (feet)", "Bar (head)", "Ring"];

  // ---------------- settings (browser h2k_set shape) ----------------
  var SET = Object.assign({ m: 0, s: 0, p: 1, cm: 0, fx: 1, df: 1, ql: 60, COMM: 1, VOICE: 1, MUSIC: 1, INTRO: 1, RUMBLE: 1, CB: 0, BIGM: 0 }, lsGet("h2k_set", {}));
  SET.ru = Object.assign({ FOULS: 1, SCLK: 1, VIOL: 1, SUBS: 1, BADGES: 1 }, SET.ru || {});
  var saveSet = function () { lsPut("h2k_set", SET); };
  /** Flat settings for Unity (same keys as the menu's data- attributes / PageBridge.Apply). */
  function flat() {
    var o = { m: SET.m, s: SET.s, p: SET.p, cm: SET.cm, fx: SET.fx ? 1 : 0, df: SET.df, rf: SET.ru.FOULS, rc: SET.ru.SCLK, rv: SET.ru.VIOL, rs: SET.ru.SUBS, rb: SET.ru.BADGES,
      cmt: SET.COMM ? (SET.VOICE ? 2 : 1) : 0, pi: SET.INTRO, mu: SET.MUSIC, ru: SET.RUMBLE, cb: SET.CB, bm: SET.BIGM };
    if (SET.q2 != null) o.q = SET.q2; // graphics only when picked (else Unity's GPU-tier default)
    return o;
  }
  function setK(k, v) {
    switch (k) {
      case "m": SET.m = v; break;
      case "s": SET.s = v; break;
      case "p": SET.p = v; break;
      case "cm": SET.cm = v; break;
      case "q": SET.q2 = v; break;
      case "fx": SET.fx = v; break;
      case "df": SET.df = v; break;
      case "rf": SET.ru.FOULS = v; break;
      case "rc": SET.ru.SCLK = v; break;
      case "rv": SET.ru.VIOL = v; break;
      case "rs": SET.ru.SUBS = v; break;
      case "rb": SET.ru.BADGES = v; break;
      case "cmt": SET.COMM = v ? 1 : 0; SET.VOICE = v === 2 ? 1 : 0; break;
      case "pi": SET.INTRO = v; break;
      case "mu": SET.MUSIC = v; break;
      case "ru": SET.RUMBLE = v; break;
      case "cb": SET.CB = v; break;
      case "bm": SET.BIGM = v; break;
      case "ql": SET.ql = v; saveSet(); return; // sent with "start"
    }
    saveSet();
    send({ cmd: "setting", k: k, v: v });
  }

  // ---------------- Unity bridge ----------------
  var U = null, ready = false, Q = [], prog = 0, failed = "";
  function send(o) {
    var s = JSON.stringify(o);
    Q.push(s);
    flush();
  }
  function flush() {
    while (U && ready && Q.length) {
      var s = Q.shift();
      try { U.SendMessage("Hoops2K27", "FromPage", s); } catch (e) { console.error("FromPage", e); }
    }
  }
  function boot(canvas, cfg) {
    if (typeof window.createUnityInstance !== "function") return fail("The game build is missing (createUnityInstance).");
    window.createUnityInstance(canvas, cfg, function (p) { prog = p; loadUi(); })
      .then(function (u) { U = u; window.unityInstance = u; prog = 1; loadUi(); flush(); })
      .catch(function (e) { fail(String(e && e.message || e)); });
  }
  function fail(m) {
    failed = m;
    loadUi();
    if (scr === "loading" || scr === "menu") menu();
  }
  function loadUi() {
    var h = $("#ldh");
    if (h) h.textContent = failed ? failed : ready ? "arena ready" : "loading the arena… " + Math.round(prog * 100) + "%";
    var b = document.querySelector("#ov .ldb i");
    if (b) b.style.setProperty("--w", Math.round(prog * 100) + "%");
    var m = document.querySelector("#ov .ldm");
    if (m) m.textContent = failed ? failed : ready ? "ARENA READY" : "LOADING THE ARENA… " + Math.round(prog * 100) + "%";
  }

  // ---------------- rosters (sim.ts RO / nChoices over roster.js) ----------------
  var ALL = [];
  D.TM.forEach(function (t, ti) { t[2].forEach(function (a) { ALL.push({ t: ti, a: a }); }); });
  var NP0 = 5, NP = 5, SEL = 0, OPP = -1, scr = "hub", last = null;
  var ov2 = function (p) { return p[13]; };
  var nChoices = function () { return NP > 1 ? D.TM.length : ALL.length; };
  function RO(i) {
    if (NP > 1) {
      var ps = NP >= 5 ? D.TM[i][2] : D.TM[i][2].slice().sort(function (a, b) { return ov2(b) - ov2(a); }).slice(0, NP);
      return [D.TM[i][1], ps, D.TM[i][0]];
    }
    return [D.TM[ALL[i].t][1], [ALL[i].a], ALL[i].a[0]];
  }
  var avg = function (a, k) { return Math.round(a.reduce(function (s, p) { return s + p[k]; }, 0) / a.length); };
  var rec = {
    get: function () { return Object.assign({ w: 0, l: 0, st: 0, best: 0 }, lsGet("h2k_rec", {})); },
    put: function (r) { lsPut("h2k_rec", r); },
  };

  // ---------------- portraits (game.ts avatar) ----------------
  var AV = {};
  function avatar(t, col) {
    var key = t[0] + col;
    if (AV[key]) return AV[key];
    var c = document.createElement("canvas");
    c.width = c.height = 96;
    var x = c.getContext("2d");
    if (!x) return "";
    var sk = t[7], hc = sk === "#e8b88f" ? "#4a3320" : "#141414";
    var g = x.createRadialGradient(48, 30, 4, 48, 48, 60);
    g.addColorStop(0, col);
    g.addColorStop(1, "#090b16");
    x.fillStyle = g;
    x.fillRect(0, 0, 96, 96);
    x.fillStyle = col; // jersey + shoulders
    x.beginPath(); x.ellipse(48, 104, 44, 34, 0, 0, 6.3); x.fill();
    x.strokeStyle = "rgba(255,255,255,.75)";
    x.lineWidth = 3;
    x.beginPath(); x.arc(48, 70, 12, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    x.fillStyle = "#fff";
    x.font = "900 15px system-ui";
    x.textAlign = "center";
    x.fillText(String(t[12]), 48, 92);
    x.fillStyle = sk; // neck, head, ears
    x.fillRect(40, 56, 16, 14);
    x.beginPath(); x.ellipse(48, 42, 17, 21, 0, 0, 6.3); x.fill();
    x.beginPath(); x.ellipse(31, 43, 3.5, 6, 0, 0, 6.3); x.ellipse(65, 43, 3.5, 6, 0, 0, 6.3); x.fill();
    x.fillStyle = hc;
    if (t[8] === 1) { x.beginPath(); x.ellipse(48, 28, 17.5, 10, 0, Math.PI, 2 * Math.PI); x.fill(); }
    if (t[8] === 2) { x.beginPath(); x.ellipse(48, 30, 19, 13, 0, Math.PI, 2 * Math.PI); x.fill(); x.fillRect(29, 28, 6, 26); x.fillRect(61, 28, 6, 26); }
    if (t[8] === 3) { x.beginPath(); x.arc(48, 27, 22, Math.PI * 0.92, Math.PI * 2.08); x.fill(); }
    if (t[9]) { x.beginPath(); x.ellipse(48, 56, 14, 9, 0, 0, Math.PI); x.fill(); }
    x.fillStyle = "#16110c"; // eyes, brows, mouth
    x.fillRect(40, 40, 4, 3);
    x.fillRect(52, 40, 4, 3);
    x.fillStyle = hc;
    x.fillRect(38, 35, 8, 2);
    x.fillRect(50, 35, 8, 2);
    x.strokeStyle = "rgba(60,20,10,.7)";
    x.lineWidth = 1.6;
    x.beginPath(); x.arc(48, 50, 5, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
    return (AV[key] = c.toDataURL());
  }

  // ---------------- hub (main.ts hubInit) ----------------
  var HMODES = [
    { t: "5v5 NBA GAME", ic: "🏆", c: "#1d428a", big: 1, tags: ["FULL COURT", "4 QUARTERS", "FOULS · FTs", "REPLAYS", "BOX SCORE"], hot: "UNITY",
      d: "The full game: " + D.TM.length + " teams, motion offense, screens, rebounds, free throws, Pro Play animation, instant replays and a box score — rendered by the Unity engine.", b: [["▶ PLAY 5v5", "5"], ["3v3 / 2v2", "3", 1]] },
    { t: "1V1 SHOWDOWN", ic: "⚡", c: "#7b3fb5", tags: ["PICK ANY STAR", "FULL COURT"], d: "Pick any of " + ALL.length + " players and duel the CPU with the same physics, fouls and tempo shooting.", b: [["▶ PLAY 1v1", "1"]] },
    { t: "GAME MODES", ic: "🎮", c: "#e8541e", tags: ["CLUTCH", "STREET", "CONTESTS", "PRACTICE"], d: "Clutch challenges, street ball, King of the Court, the All-Star game, the daily challenge, 3-point and dunk contests, HORSE, practice and a tutorial — on the matchup screen.", b: [["▶ PICK A MODE", "5"]] },
    { t: "PLAY ONLINE", ic: "🌐", c: "#0b7a8a", tags: ["ROOM CODES", "ANTI-LAG"], hot: "NEW", d: "Host a game and send your friend the 4-letter code, or type a friend's code in the lobby.", b: [["▶ ONLINE LOBBY", "online"]] },
  ];
  var hubRaf = 0;
  function hubInit() {
    var LP = lsGet("h2k_lastplay", null), RC = rec.get();
    var lpNp = LP ? (LP.np || (/^1v1/.test(LP.mode || "") ? 1 : 5)) : 5;
    $("#hst").innerHTML = "<span><b>" + D.TM.length + "</b> teams</span><span><b>" + ALL.length + "</b> players</span><span><b>" + (D.MODES.length + 2) + "</b> modes</span><span><b>Unity</b> WebGPU / WebGL2</span><span><b>Online</b> rooms</span>";
    var qp = document.createElement("div");
    qp.className = "qp";
    qp.innerHTML = '<button id="qpb" class="qpb">▶ QUICK PLAY <small>' + (LP ? (lpNp > 1 ? lpNp + "v" + lpNp : "1v1") + " · your last matchup" : "5v5 · jump straight in") + "</small></button>" +
      '<div class="qrec"><b>' + RC.w + "</b>W <b>" + RC.l + "</b>L" + (RC.st > 1 ? " · 🔥 <b>" + RC.st + "</b> straight" : "") + "</div>";
    $("#play .hero").appendChild(qp);
    $("#qpb").onclick = function () {
      enterGame(LP ? (LP.np0 || (lpNp > 1 ? 5 : 1)) : 5, lpNp);
      SEL = LP ? Math.min(LP.sel | 0, nChoices() - 1) : 0;
      OPP = LP && LP.opp >= 0 && LP.opp < nChoices() ? LP.opp : -1;
      menu();
      start("game");
    };
    $("#grid").innerHTML = HMODES.map(function (m, i) {
      return '<div class="m' + (m.big ? " big" : "") + '" style="--c:' + m.c + ";--i:" + i + '"><div class="ic">' + m.ic + "</div><h2>" + m.t + '</h2><div class="tags">' + (m.hot ? '<i class="hot">' + m.hot + "</i>" : "") +
        m.tags.map(function (t) { return "<i>" + t + "</i>"; }).join("") + "</div><p>" + esc(m.d) + "</p>" +
        m.b.map(function (b) { return '<button class="' + (b[2] ? "b2" : "") + '" data-g="' + b[1] + '">' + b[0] + "</button>"; }).join("") + "</div>";
    }).join("");
    document.querySelectorAll("[data-g]").forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.g;
        if (g === "online") return online();
        enterGame(+g === 1 ? 1 : 5, +g);
        menu();
      };
    });
    document.querySelectorAll(".m").forEach(function (c) {
      c.onmousemove = function (e) {
        var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty("--ry", (x - 0.5) * 8 + "deg");
        c.style.setProperty("--rx", (0.5 - y) * 6 + "deg");
        c.style.setProperty("--mx", x * 100 + "%");
        c.style.setProperty("--my", y * 100 + "%");
      };
      c.onmouseleave = function () { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); };
    });
    $("#logp").innerHTML = HB.LOG.map(function (r, i) {
      return '<div class="rel" style="animation-delay:' + i * 60 + 'ms"><h3>v' + r.v + " <span>" + r.n + "</span>" + (r.n2 ? "<em>LATEST</em>" : "") + "<s>" + r.d + "</s></h3><ul>" +
        r.l.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>";
    }).join("");
    var kh = function (id, a) { $(id).innerHTML = a.map(function (x) { return "<div><span>" + x[0] + "</span><kbd>" + x[1] + "</kbd></div>"; }).join(""); };
    kh("#k1", HB.K1); kh("#k2", HB.K2); kh("#k3", HB.K3); kh("#k5", HB.K5);
    var latest = HB.LOG.length ? HB.LOG[0].v : "";
    if (lsGet("h2k_seen", "") === latest) $("#nw").style.display = "none";
    document.querySelectorAll("nav button").forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll("nav button").forEach(function (x) { x.classList.toggle("on", x === b); });
        ["play", "log", "how"].forEach(function (t) { $("#" + t).hidden = t !== b.dataset.t; });
        if (b.dataset.t === "log") { $("#nw").style.display = "none"; lsPut("h2k_seen", latest); }
        window.scrollTo(0, 0);
      };
    });
    var cv = $("#bg"), c = cv.getContext && cv.getContext("2d"), W = 0, H = 0, pts = [];
    if (!c) return;
    var rs = function () {
      W = cv.width = innerWidth;
      H = cv.height = innerHeight;
      pts = Array.from({ length: 42 }, function () { return { x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 3, v: 0.15 + Math.random() * 0.5 }; });
    };
    rs();
    addEventListener("resize", rs);
    var fr = function (t) {
      if (scr !== "hub" || document.hidden) { hubRaf = requestAnimationFrame(fr); return; }
      c.clearRect(0, 0, W, H);
      var g = c.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.1, Math.max(W, H) * 0.9);
      g.addColorStop(0, "#1c2257"); g.addColorStop(0.5, "#0a0c1c"); g.addColorStop(1, "#05060d");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.strokeStyle = "rgba(255,170,80,.10)";
      c.lineWidth = 1;
      var hz = H * 0.62, off = (t * 0.02) % 80;
      for (var i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(W / 2 + i * 40, hz); c.lineTo(W / 2 + i * 260, H); c.stroke(); }
      for (var k = 0; k < 12; k++) { var y = hz + Math.pow((k * 80 + off) / 960, 2) * (H - hz) * 2.2; if (y > hz && y < H) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } }
      c.beginPath(); c.arc(W / 2, hz + 8, Math.min(W, H) * 0.2, Math.PI, 0); c.strokeStyle = "rgba(255,210,63,.12)"; c.lineWidth = 2; c.stroke();
      for (var j = 0; j < pts.length; j++) { var p = pts[j]; p.y -= p.v; if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; } c.fillStyle = "rgba(255,140,50,.35)"; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.3); c.fill(); }
      hubRaf = requestAnimationFrame(fr);
    };
    hubRaf = requestAnimationFrame(fr);
  }
  /** Hub -> game view: swap the stylesheets like main.ts go() (hub CSS off, game CSS on). */
  function enterGame(np0, np) {
    NP0 = np0;
    NP = np > 0 ? np : np0;
    $("#hcss").media = "not all";
    $("#gcss").media = "all";
    $("#hub").hidden = true;
    $("#game").hidden = false;
  }
  function toHub() {
    if (scr !== "hub" && scr !== "menu") send({ cmd: "quit" });
    scr = "hub";
    playing(false);
    $("#hcss").media = "all";
    $("#gcss").media = "not all";
    $("#hub").hidden = false;
    $("#game").hidden = true;
    menuKeys = null;
  }
  function online() {
    enterGame(5, 5);
    scr = "online";
    send({ cmd: "online" });
    ov().style.display = "none"; // Unity's lobby (NetLobby IMGUI) draws over the arena
    playing(false);
  }

  // ---------------- matchup screen (game.ts menu) ----------------
  var ov = function () { return $("#ov"); };
  var opt = function (k, v, cur, l) { return '<button data-' + k + '="' + v + '" class="' + (cur === v ? "on" : "") + '">' + l + "</button>"; };
  var onoff = function (k, cur) { return opt(k, 1, cur ? 1 : 0, "On") + opt(k, 0, cur ? 1 : 0, "Off"); };
  var menuKeys = null;
  var modeStrip = function () {
    return '<div class="modes" role="group" aria-label="Game modes">' + D.MODES.map(function (m) { return '<button data-mode="' + m[0] + '"><span>' + m[1] + "</span>" + m[2] + "</button>"; }).join("") + "</div>";
  };
  function loading() {
    return ready ? "" : '<div class="ldm">' + (failed ? esc(failed) : "LOADING THE ARENA… " + Math.round(prog * 100) + "%") + '</div><div class="ldb"><i style="--w:' + Math.round(prog * 100) + '%"></i></div>';
  }
  function menu() {
    scr = "menu";
    playing(false);
    var o = ov(), N = nChoices();
    o.style.display = "flex";
    o.classList.add("mu-on");
    if (SEL >= N) SEL = 0;
    if (OPP >= N || OPP === SEL) OPP = -1;
    var R = rec.get();
    var side = function (i, you) {
      var r = RO(i), pl = r[1],
        ovr0 = Math.round(pl.reduce(function (a, p) { return a + ov2(p); }, 0) / pl.length),
        name = r[2], sub = NP > 1 ? "" : D.TM[ALL[i].t][0],
        bars = [["3PT", avg(pl, 1)], ["INSIDE", avg(pl, 2)], ["SPEED", avg(pl, 3)], ["DEFENSE", avg(pl, 4)]];
      return '<section class="side' + (you ? " you" : "") + '" style="--c:' + r[0] + '">' +
        '<div class="sh"><button class="arw" data-cy="' + (you ? "y" : "o") + '" data-d="-1" aria-label="Previous">◀</button>' +
        '<div class="badge">' + esc(name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()) + "</div>" +
        '<div class="tn"><small>' + (you ? "YOU" : "OPPONENT") + (sub ? " · " + esc(sub) : "") + "</small><b>" + esc(name) + "</b></div>" +
        '<div class="ovr"><small>OVR</small>' + ovr0 + "</div>" +
        '<button class="arw" data-cy="' + (you ? "y" : "o") + '" data-d="1" aria-label="Next">▶</button></div>' +
        '<div class="rt">' + bars.map(function (b) { return "<div><span>" + b[0] + '</span><i style="--w:' + b[1] + '%"></i><em>' + b[1] + "</em></div>"; }).join("") + "</div>" +
        '<ol class="lu">' + pl.map(function (p, k) {
          return '<li style="--d:' + k * 60 + 'ms"><img alt="" src="' + avatar(p, r[0]) + '"><span class="pn">' + (NP >= 5 ? POS[k] : "#" + p[12]) + "</span><b>" + esc(p[0]) + '</b><span class="po">' + ov2(p) + "</span></li>";
        }).join("") + "</ol></section>";
    };
    var rnd = '<section class="side rnd"><div class="sh"><button class="arw" data-cy="o" data-d="-1" aria-label="Previous">◀</button><div class="badge">?</div><div class="tn"><small>OPPONENT</small><b>Random</b></div><button class="arw" data-cy="o" data-d="1" aria-label="Next">▶</button></div>' +
      '<p class="hint" style="margin:10px 0">A surprise ' + (NP > 1 ? "team" : "star") + ' every game. Use ▶ or ↑ ↓ to pick one.</p><ol class="lu q">' +
      (NP > 1 ? POS.slice(0, NP) : ["?"]).map(function (ps, k) { return '<li style="--d:' + k * 60 + 'ms"><span class="qa">?</span><span class="pn">' + (NP > 1 ? ps : "") + "</span><b>Mystery " + (NP > 1 ? "starter" : "star") + '</b><span class="po">??</span></li>'; }).join("") + "</ol></section>";
    var strip = "";
    for (var i = 0; i < N; i++) {
      var r = RO(i);
      strip += '<button class="card' + (i === SEL ? " sel" : "") + '" role="option" aria-selected="' + (i === SEL) + '" data-i="' + i + '" style="--i:' + (i % 12) + ";--c:" + r[0] + '" title="' + esc(r[2]) + '">' +
        (NP > 1 ? esc(r[2]) : '<img alt="" src="' + avatar(r[1][0], r[0]) + '"><span>' + esc(r[2].split(" ").pop()) + "</span>") + "</button>";
    }
    var cmt = SET.COMM ? (SET.VOICE ? 2 : 1) : 0;
    o.innerHTML = '<div class="mu">' +
      '<header class="mu-top"><div class="logo">HOOPS<span>2K27</span></div><div class="mu-sub">' + (NP > 1 ? NP + "V" + NP : "1V1 SHOWDOWN") + " · UNITY ARENA</div>" +
      '<div class="rec" title="Your record vs the CPU">' + R.w + "W · " + R.l + "L" + (R.st > 1 ? " · 🔥 " + R.st + " straight" : "") + '</div><button id="set" class="gear">⚙ Settings</button></header>' +
      '<div class="vs">' + side(SEL, true) +
      '<div class="mid"><div class="vsb">VS</div>' +
      '<div class="chips"><b>DIFFICULTY</b>' + DIFFN.map(function (n, i) { return opt("df", i, SET.df, n); }).join("") + "</div>" +
      (NP0 > 1 ? '<div class="chips"><b>TEAM SIZE</b>' + [5, 3, 2].map(function (n) { return '<button data-tsz="' + n + '" class="' + (NP === n ? "on" : "") + '">' + n + "v" + n + "</button>"; }).join("") + "</div>" : "") +
      '<div class="chips"><b>QUARTERS</b>' + [30, 60, 120, 180].map(function (q) { return '<button data-ql="' + q + '" class="' + (SET.ql === q ? "on" : "") + '">' + (q < 60 ? q + "s" : q / 60 + " min") + "</button>"; }).join("") + "</div>" +
      '<button class="big" id="tip">TIP OFF ▶</button>' + loading() + '<p class="hint">← → your ' + (NP > 1 ? "team" : "star") + " · ↑ ↓ opponent · Enter tip off</p>" + modeStrip() + "</div>" +
      (OPP < 0 ? rnd : side(OPP, false)) + "</div>" +
      '<div id="g" class="strip" role="listbox" aria-label="Choose">' + strip + "</div>" +
      '<aside id="sd" hidden><div class="sdh"><b>SETTINGS</b><button id="sdx" aria-label="Close settings">✕</button></div>' +
      '<div class="opts"><h3>MATCH</h3><b>PRO PLAY ENGINE</b>' + opt("p", 1, SET.p, "On") + opt("p", 0, SET.p, "Off") + '<button id="online">🌐 Play online</button></div>' +
      '<div class="opts"><h3>SHOOTING</h3><b>STYLE</b>' + opt("s", 0, SET.s, "Hold &amp; release") + opt("s", 1, SET.s, "Tempo") + "<b>SHOT METER</b>" + MN.map(function (n, i) { return opt("m", i, SET.m, n); }).join("") + "</div>" +
      '<div class="opts"><h3>RULES</h3><b>FOULS</b>' + onoff("rf", SET.ru.FOULS) + "<b>SHOT CLOCK</b>" + onoff("rc", SET.ru.SCLK) + "<b>VIOLATIONS</b>" + onoff("rv", SET.ru.VIOL) +
      '<i class="sm">3 seconds · 8 seconds · goaltending</i><b>FATIGUE &amp; SUBS</b>' + onoff("rs", SET.ru.SUBS) + '<i class="sm">5v5: reserves check in, 6 fouls = out</i><b>BADGES &amp; HOT ZONES</b>' + onoff("rb", SET.ru.BADGES) + "</div>" +
      '<div class="opts"><h3>PRESENTATION</h3><b>COMMENTARY</b>' + opt("cmt", 0, cmt, "Off") + opt("cmt", 1, cmt, "Captions") + opt("cmt", 2, cmt, "Captions + voice") +
      "<b>PLAYER INTROS</b>" + onoff("pi", SET.INTRO) + "<b>MUSIC</b>" + onoff("mu", SET.MUSIC) + "<b>GAMEPAD RUMBLE</b>" + onoff("ru", SET.RUMBLE) + "</div>" +
      '<div class="opts"><h3>ACCESSIBILITY</h3><b>METER COLORS</b>' + opt("cb", 0, SET.CB, "Standard") + opt("cb", 1, SET.CB, "Colorblind-safe") + "<b>METER SIZE</b>" + opt("bm", 0, SET.BIGM, "Normal") + opt("bm", 1, SET.BIGM, "Large") + "</div>" +
      '<div class="opts"><h3>DISPLAY</h3><b>CAMERA</b>' + CAMN.map(function (n, i) { return opt("cm", i, SET.cm, n); }).join("") +
      "<b>GRAPHICS</b>" + opt("q", 0, SET.q2, "Low") + opt("q", 1, SET.q2, "Medium") + opt("q", 2, SET.q2, "High") + "<b>EFFECTS</b>" + opt("fx", 1, SET.fx ? 1 : 0, "On") + opt("fx", 0, SET.fx ? 1 : 0, "Off") + "</div>" +
      '<p class="hint">Keys: WASD / arrows move · hold SPACE shoot · E pass · R lob · Q switch · K camera · M meter · Esc pause</p></aside></div>';
    var cyc = function (who, d) {
      if (who === "y") {
        SEL = (SEL + d + N) % N;
        if (SEL === OPP) SEL = (SEL + d + N) % N;
      } else {
        var x = OPP + d;
        if (x < -1) x = N - 1;
        if (x >= N) x = -1;
        if (x === SEL) x += d;
        OPP = x >= N ? -1 : x < -1 ? N - 1 : x;
      }
      menu();
      var f = o.querySelector('.arw[data-cy="' + who + '"][data-d="' + d + '"]');
      if (f) f.focus();
    };
    o.querySelectorAll(".arw").forEach(function (b) { b.onclick = function () { cyc(b.dataset.cy, +b.dataset.d); }; });
    o.querySelectorAll(".strip .card").forEach(function (b) {
      b.onclick = function () { SEL = +b.dataset.i; if (OPP === SEL) OPP = -1; menu(); };
    });
    var tip = function () { start("game"); };
    $("#tip").onclick = tip;
    var grp = function (k, f, again) {
      o.querySelectorAll("[data-" + k + "]").forEach(function (b) {
        b.onclick = function () {
          f(+b.dataset[k]);
          if (again) menu();
          else o.querySelectorAll("[data-" + k + "]").forEach(function (c) { c.classList.toggle("on", c === b); });
        };
      });
    };
    grp("tsz", function (v) { NP = v; }, true);
    grp("ql", function (v) { setK("ql", v); });
    ["df", "m", "s", "p", "cm", "q", "fx", "rf", "rc", "rv", "rs", "rb", "cmt", "mu", "pi", "ru", "cb", "bm"].forEach(function (k) { grp(k, function (v) { setK(k, v); }); });
    o.querySelectorAll("[data-mode]").forEach(function (b) {
      b.onclick = function () { b.dataset.mode === "clutch" ? clutchScreen() : start(b.dataset.mode); };
    });
    var sd = $("#sd");
    $("#set").onclick = function () { sd.hidden = false; $("#sdx").focus(); };
    $("#sdx").onclick = function () { sd.hidden = true; $("#set").focus(); };
    $("#online").onclick = online;
    menuKeys = function (e) {
      if (scr !== "menu" || !document.getElementById("tip")) return;
      if (e.target && e.target.closest && e.target.closest("input,select")) return;
      if (e.code === "Escape" && !sd.hidden) return $("#sdx").click();
      if (!sd.hidden) return;
      if (e.code === "ArrowRight") cyc("y", 1);
      else if (e.code === "ArrowLeft") cyc("y", -1);
      else if (e.code === "ArrowDown") cyc("o", 1);
      else if (e.code === "ArrowUp") cyc("o", -1);
      else if (e.code === "Enter" && !(e.target && e.target.closest && e.target.closest("button"))) tip();
      else return;
      e.preventDefault();
    };
  }
  /** modesui.ts clutchScreen: pick a scenario (stars = beaten, saved in h2k_cc like the browser). */
  function clutchScreen() {
    scr = "clutch";
    var st = lsGet("h2k_cc", {}), o = ov();
    o.style.display = "flex";
    o.classList.remove("mu-on");
    o.innerHTML = '<div class="fin"><div class="logo" style="font-size:36px;animation:none">CLUTCH CHALLENGES</div><p class="hint">Your team vs your chosen opponent (or a random one). Beat the scenario.</p>' +
      '<div class="cc">' + D.CLUTCH.map(function (c, i) { return '<button data-cc="' + i + '"><b>' + (st[i] ? "★" : "☆") + " " + esc(c.n) + "</b><small>" + esc(c.d) + "</small></button>"; }).join("") + "</div>" +
      '<div class="row"><button class="ghost" id="mme">Back</button></div></div>';
    o.querySelectorAll("[data-cc]").forEach(function (b) { b.onclick = function () { start("clutch", +b.dataset.cc); }; });
    $("#mme").onclick = menu;
  }
  /** TIP OFF / a mode: hand the matchup to Unity and get out of the way. */
  function start(mode, arg) {
    var r = rec.get();
    last = { cmd: "start", mode: mode, arg: arg || 0, np: NP, sel: SEL, opp: OPP, diff: SET.df, ql: SET.ql, set: flat(), rec: { w: r.w, l: r.l } };
    if (mode === "game") lsPut("h2k_lastplay", { mode: NP > 1 ? "5v5-3d" : "1v1-3d", np: NP, np0: NP0, sel: SEL, opp: OPP });
    send(last);
    play();
  }
  function playing(on) {
    var g = $("#game");
    if (g) g.classList.toggle("playing", on);
    document.body.classList.toggle("playing", on);
  }
  function play() {
    if (!ready) {
      // the build is still streaming: the start command waits in the queue, show progress until Unity says "ready"
      scr = "loading";
      var o = ov();
      o.style.display = "flex";
      o.classList.remove("mu-on");
      o.innerHTML = '<div class="logo">HOOPS<span>2K27</span></div>' + loading();
      return;
    }
    scr = "play";
    ov().style.display = "none";
    playing(true);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var c = $("#unity-canvas");
    if (c && c.focus) c.focus();
  }

  // ---------------- pause (game.ts pause) ----------------
  var PZ = null;
  function pause(j) {
    PZ = j || PZ || {};
    if (PZ.cm != null) SET.cm = PZ.cm; // K / M in game change these on the Unity side
    if (PZ.m != null) SET.m = PZ.m;
    scr = "pause";
    playing(false);
    var o = ov(), sc = PZ.sc || [0, 0], cl = PZ.cl || ["", ""];
    o.style.display = "flex";
    o.classList.remove("mu-on");
    o.innerHTML = '<div class="logo" style="font-size:38px">PAUSED</div><div class="sub">' + esc(cl[0]) + " " + sc[0] + " — " + sc[1] + " " + esc(cl[1]) + " · Q" + (PZ.q || 1) + '</div><div id="pz">' +
      '<button id="pr">▶ Resume</button><button id="pc">🎥 Camera: ' + CAMN[SET.cm | 0] + '</button><button id="pf">✨ Effects: ' + (SET.fx ? "On" : "Off") + "</button>" +
      '<button id="pm">🎯 Meter: ' + MN[SET.m | 0] + '</button><button id="pt">⏱ Shooting: ' + (SET.s ? "Tempo" : "Hold &amp; release") + "</button>" +
      '<button id="prp">⏪ Instant replay</button><button id="prs">↻ Restart game</button><button id="pq">✕ Quit to menu</button></div><p class="hint">Esc or P to resume</p>';
    $("#pr").onclick = resume;
    $("#pc").onclick = function () { setK("cm", ((SET.cm | 0) + 1) % 4); pause(); };
    $("#pf").onclick = function () { setK("fx", SET.fx ? 0 : 1); pause(); };
    $("#pm").onclick = function () { setK("m", ((SET.m | 0) + 1) % 4); pause(); };
    $("#pt").onclick = function () { setK("s", SET.s ? 0 : 1); pause(); };
    $("#prp").onclick = function () { send({ cmd: "replay" }); play(); };
    $("#prs").onclick = function () { send({ cmd: "rematch" }); play(); };
    $("#pq").onclick = function () { send({ cmd: "quit" }); menu(); };
    $("#pr").focus();
  }
  function resume() {
    send({ cmd: "resume" });
    play();
  }

  // ---------------- final screen (game.ts endGame) ----------------
  function shotChart(F, t) {
    var shots = (F.shots || []).filter(function (s) { return s[0] === t; });
    if (!shots.length) return "";
    var W = 220, H = 196, k = 0.42, cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    var x = cv.getContext("2d");
    if (!x) return "";
    var hx = (F.hx || [887.5, 52.5])[t], rx = W / 2, ry = 16, col = (F.pc || [])[t] || "#ffd23f", name = (F.cl || [])[t] || "";
    var P2 = function (gx, gy) { return [rx + (gy - 250) * k, ry + Math.abs(gx - hx) * k]; };
    x.fillStyle = "#1b1f36";
    x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(255,255,255,.35)";
    x.lineWidth = 1.2;
    x.strokeRect(rx - 80 * k, 0, 160 * k, 190 * k); // the lane
    x.beginPath(); x.arc(rx, ry + 190 * k - 16 * k, 60 * k, 0, Math.PI); x.stroke(); // free-throw circle
    x.beginPath(); x.moveTo(rx - 220 * k, 0); x.lineTo(rx - 220 * k, ry + 140 * k);
    x.arc(rx, ry, 237.5 * k, Math.PI - Math.acos(220 / 237.5), Math.acos(220 / 237.5), true);
    x.lineTo(rx + 220 * k, 0); x.stroke(); // three-point line
    x.strokeStyle = "#ff8a3a";
    x.beginPath(); x.arc(rx, ry, 7.5 * k + 1, 0, 7); x.stroke(); // rim
    var m = 0;
    shots.forEach(function (s) {
      var p = P2(s[1], s[2]);
      if (s[3]) {
        m++;
        x.fillStyle = col; x.strokeStyle = "#fff"; x.lineWidth = 1;
        x.beginPath(); x.arc(p[0], p[1], 3.6, 0, 7); x.fill(); x.stroke();
      } else {
        x.strokeStyle = "rgba(255,255,255,.55)"; x.lineWidth = 1.4;
        x.beginPath(); x.moveTo(p[0] - 2.8, p[1] - 2.8); x.lineTo(p[0] + 2.8, p[1] + 2.8); x.moveTo(p[0] + 2.8, p[1] - 2.8); x.lineTo(p[0] - 2.8, p[1] + 2.8); x.stroke();
      }
    });
    return '<figure class="chart"><img alt="' + esc(name) + ' shot chart" src="' + cv.toDataURL() + '"><figcaption style="color:' + col + '">' + esc(name) + " · " + m + "/" + shots.length + "</figcaption></figure>";
  }
  function final(F) {
    scr = "final";
    playing(false);
    var o = ov(), sc = F.sc || [0, 0], cl = F.cl || ["", ""], pc = F.pc || ["#7b3fb5", "#1d428a"], box = F.box || [[], []], xs = F.xs || { paint: [0, 0], fb: [0, 0], sec: [0, 0] };
    var me = F.me | 0, w = sc[me] > sc[1 - me], game = F.gm === "game";
    var sum = function (t, k) { return box[t].reduce(function (a, p) { return a + (p[k] || 0); }, 0); };
    var pct = function (m, a) { return a ? Math.round((100 * m) / a) : 0; };
    if (game && !F.online) {
      var r0 = rec.get();
      if (w) { r0.w++; r0.st = Math.max(1, r0.st + 1); r0.best = Math.max(r0.best, r0.st); }
      else { r0.l++; r0.st = 0; }
      rec.put(r0);
    }
    if (last && last.mode === "clutch" && w) { var cc = lsGet("h2k_cc", {}); cc[last.arg] = 1; lsPut("h2k_cc", cc); }
    var wt = sc[0] >= sc[1] ? 0 : 1, val = function (p) { return p.pts + p.reb * 1.2 + p.ast * 1.5 + p.blk * 2; };
    var pog = box[wt].slice().sort(function (a, b) { return val(b) - val(a); })[0];
    var rows = [
      ["FG%", pct(sum(0, "fgm"), sum(0, "fga")), pct(sum(1, "fgm"), sum(1, "fga"))],
      ["3P%", pct(sum(0, "tpm"), sum(0, "tpa")), pct(sum(1, "tpm"), sum(1, "tpa"))],
      ["REB", sum(0, "reb"), sum(1, "reb")],
      ["AST", sum(0, "ast"), sum(1, "ast")],
      ["BLK", sum(0, "blk"), sum(1, "blk")],
      ["OREB", sum(0, "orb"), sum(1, "orb")],
      ["PAINT PTS", xs.paint[0], xs.paint[1]],
      ["FAST BREAK", xs.fb[0], xs.fb[1]],
      ["2ND CHANCE", xs.sec[0], xs.sec[1]],
      ["HUSTLE", sum(0, "hus"), sum(1, "hus")],
    ];
    var tb = function (t) {
      return '<table class="bx"><tr><th>' + esc(cl[t]) + '</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th><th>BLK</th><th>OREB</th><th>PF</th><th title="charges drawn + loose-ball dives + screen assists">HUS</th></tr>' +
        box[t].map(function (p) {
          return "<tr" + (p.fo ? ' class="fo"' : "") + "><td>" + esc(p.n) + "</td><td>" + p.pts + "</td><td>" + p.reb + "</td><td>" + p.ast + "</td><td>" + p.fgm + "-" + p.fga + "</td><td>" + p.tpm + "-" + p.tpa +
            "</td><td>" + p.blk + "</td><td>" + (p.orb || 0) + "</td><td>" + (p.pf || 0) + (p.fo ? " (out)" : "") + "</td><td>" + (p.hus || 0) + "</td></tr>";
        }).join("") + "</table>";
    };
    var r = rec.get(), title = !game ? "FINAL" : w ? "VICTORY" : "DEFEAT";
    var charts = shotChart(F, 0) + shotChart(F, 1);
    o.style.display = "flex";
    o.classList.remove("mu-on");
    o.innerHTML = '<div class="fin" style="--c0:' + pc[0] + ";--c1:" + pc[1] + '">' +
      '<div class="logo" style="font-size:44px;animation:none;color:' + (!game ? "#fff" : w ? "#ffd23f" : "#ff8a6b") + '">' + title + "</div>" +
      '<div class="sc"><span style="--c:' + pc[0] + '">' + esc(cl[0]) + "</span><b>" + sc[0] + "</b><i>—</i><b>" + sc[1] + '</b><span style="--c:' + pc[1] + '">' + esc(cl[1]) + "</span></div>" +
      (game ? '<p class="hint">Record ' + r.w + "W · " + r.l + "L" + (r.st > 1 ? " · 🔥 " + r.st + " straight" : "") + (r.best > 1 ? " · best streak " + r.best : "") + "</p>" : "") +
      (pog ? '<div class="pog"><img alt="" src="' + avatar([pog.n, 0, 0, 0, 0, 0, 0, pog.sk, pog.hr, pog.bd, 0, 0, pog.no], pog.col || pc[wt]) + '"><div><small>PLAYER OF THE GAME</small><b>' + esc(pog.n) + "</b><span>" +
        pog.pts + " PTS · " + pog.reb + " REB · " + pog.ast + " AST" + (pog.blk ? " · " + pog.blk + " BLK" : "") + "</span></div></div>" : "") +
      '<div class="cmp">' + rows.map(function (x) {
        var t = x[1] + x[2] || 1;
        return "<div><em>" + x[1] + '</em><span><i style="--w:' + (100 * x[1]) / t + '%;background:var(--c0)"></i><i style="--w:' + (100 * x[2]) / t + '%;background:var(--c1)"></i></span><em>' + x[2] + "</em><small>" + x[0] + "</small></div>";
      }).join("") + "</div>" +
      (charts ? '<div class="charts">' + charts + "</div>" : "") +
      '<details class="bxw"><summary>Box score</summary>' + tb(0) + tb(1) + "</details>" +
      '<div class="row"><button class="big" id="rm">↻ REMATCH</button><button id="pa" class="ghost">Change teams</button></div></div>';
    $("#rm").onclick = function () { send({ cmd: "rematch" }); play(); };
    $("#pa").onclick = function () { send({ cmd: "quit" }); menu(); };
    $("#rm").focus();
  }

  // ---------------- Unity -> page ----------------
  function show(screen, json) {
    var j = {};
    try { j = json ? (typeof json === "string" ? JSON.parse(json) : json) : {}; } catch (e) {}
    if (screen === "ready") {
      ready = true;
      prog = 1;
      loadUi();
      flush();
      if (scr === "loading") play();
      else if (scr === "menu") menu();
    } else if (screen === "pause") {
      if (scr === "play") pause(j);
    } else if (screen === "final") {
      if (scr === "play" || scr === "pause") final(j);
    } else if (screen === "menu") {
      if (scr === "play" || scr === "pause" || scr === "final" || scr === "online") menu();
    } else if (screen === "play") {
      if (scr === "pause") play();
    }
  }

  addEventListener("keydown", function (e) {
    if (scr === "pause" && (e.code === "Escape" || e.code === "KeyP")) { e.preventDefault(); return resume(); }
    if (menuKeys && scr === "menu") return menuKeys(e);
    // in play Unity reads the keys; keep the page from scrolling (Unity runs with captureAllKeyboardInput off so
    // the page's own inputs keep working)
    if (scr === "play" && /^(Arrow|Space)/.test(e.code) && !(e.target && e.target.closest && e.target.closest("input,select,textarea"))) e.preventDefault();
  });
  addEventListener("blur", function () { if (scr === "play") send({ cmd: "pause" }); });
  $("#bk").onclick = toHub;
  hubInit();
  loadUi();

  window.H2KUI = {
    boot: boot,
    fail: fail,
    show: show,
    /** test / debug readout */
    state: function () { return { scr: scr, ready: ready, NP0: NP0, NP: NP, SEL: SEL, OPP: OPP, queued: Q.length }; },
  };
})();
