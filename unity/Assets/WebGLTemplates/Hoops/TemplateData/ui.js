// Hoops 2K27 - the HTML game's menus over the Unity WebGL build (hand-written, plain JS, no framework, no sim).
// Starts from src/client/main.ts (hub: mode cards, quick play, update log, controls), src/client/game.ts (matchup
// screen menu() with lineups + avatar() portraits + ratings, settings, pause, final screen with record, player of the
// game, stat bars, shot charts) and src/client/modesui.ts (mode strip, clutch picker), then goes further: animated
// screen transitions, a team carousel with starting-five portraits, player cards (ratings + badges) on hover / focus /
// tap, a tabbed settings screen (Gameplay / Controls / Graphics / Audio with volume sliders), a pause menu with the live
// box score, a loading screen fed by the Unity loader's progress, and keyboard / gamepad navigation of every menu
// (arrows or d-pad / stick move between controls, Enter or A activates, Esc or B goes back). Unity draws the game and
// its in-game HUD underneath (Hud.cs / Broadcast.cs).
// Bridge: page -> Unity  unityInstance.SendMessage("Hoops2K27", "FromPage", json)   (PageBridge.cs)
//           {cmd:"start", mode, arg, np, sel, opp, diff, ql, set:{...}, rec:{w,l}} | {cmd:"resume"} | {cmd:"pause"} |
//           {cmd:"quit"} | {cmd:"rematch"} | {cmd:"replay"} | {cmd:"online"} | {cmd:"setting", k, v}
//         Unity -> page  HoopsUi_Show(screen, json) (Assets/Plugins/WebGL/HoopsUi.jslib) -> H2KUI.show(screen, json)
//           "ready" | "menu" | "pause" {sc, cl, pc, q, cm, m, s, fx, box} | "final" {sc, cl, pc, me, gm, box, xs, qs, shots, hx}
// Settings live in localStorage h2k_set in the browser game's shape (+ vol for the audio sliders).
(function () {
  "use strict";
  var D = window.H2K_DATA || { TM: [], BADGE: {}, CLUTCH: [], MODES: [] },
    HB = window.H2K_HUB || { LOG: [], K1: [], K2: [], K3: [], K4: [], K5: [] };
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
  var lsGet = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  var lsPut = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var POS = ["PG", "SG", "SF", "PF", "C"],
    DIFFN = ["Rookie", "Pro", "All-Star", "Hall of Fame"],
    CAMN = ["Broadcast", "2K Style", "Baseline", "Player Lock"],
    MN = ["Arrow 2", "Bar (feet)", "Bar (head)", "Ring"],
    QN = ["Low", "Medium", "High"],
    HSRN = ["Off", "Auto", "Quality", "Balanced", "Performance", "Ultra Perf."];
  // display refresh from rAF intervals (~1 s, low percentile, snapped): "Your screen: N Hz" in the graphics tab
  var HZ = 0;
  (function () {
    var d = [], last = 0, t0 = performance.now();
    function f(t) {
      if (last) d.push(t - last);
      last = t;
      if (t - t0 < 1100 || d.length < 20) return requestAnimationFrame(f);
      d.sort(function (a, b) { return a - b; });
      var hz = 1000 / (d[Math.floor(d.length * 0.2)] || 16.7), best = 60;
      [30, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360].forEach(function (r) { if (Math.abs(r - hz) < Math.abs(best - hz)) best = r; });
      HZ = Math.abs(best - hz) / hz < 0.08 ? best : Math.round(hz);
    }
    requestAnimationFrame(f);
  })();

  // ---------------- settings (browser h2k_set shape) ----------------
  var SET = Object.assign({ m: 0, s: 0, p: 1, cm: 0, fx: 1, df: 1, ql: 60, COMM: 1, VOICE: 1, MUSIC: 1, CHANTS: 1, INTRO: 1, RUMBLE: 1, CB: 0, BIGM: 0, THEME: 0, TXT: 0, RM: 0, HC: 0, MINHUD: 0, SPT: 0 }, lsGet("h2k_set", {}));
  SET.ru = Object.assign({ FOULS: 1, SCLK: 1, VIOL: 1, SUBS: 1, BADGES: 1 }, SET.ru || {});
  SET.vol = Object.assign({ vm: 100, vu: 100, vc: 100, vv: 100 }, SET.vol || {});
  var saveSet = function () { lsPut("h2k_set", SET); };
  var PALN = ["Standard", "Red-green safe", "Blue-yellow safe", "Monochrome"];
  /** UI v6 root switches (tokens.css): theme, text size, reduced motion, high contrast. */
  function applyA11y() {
    var d = document.documentElement;
    d.dataset.theme = ["dark", "light", "auto"][SET.THEME | 0] || "dark";
    d.dataset.text = String(SET.TXT | 0);
    if (SET.RM) d.dataset.motion = "reduce"; else delete d.dataset.motion;
    if (SET.HC) d.dataset.contrast = "high"; else delete d.dataset.contrast;
  }
  applyA11y();
  /** Flat settings for Unity (same keys as the menus' data- attributes / PageBridge.Apply). */
  function flat() {
    var o = { m: SET.m, s: SET.s, p: SET.p, cm: SET.cm, fx: SET.fx ? 1 : 0, df: SET.df, rf: SET.ru.FOULS, rc: SET.ru.SCLK, rv: SET.ru.VIOL, rs: SET.ru.SUBS, rb: SET.ru.BADGES,
      cmt: SET.COMM ? (SET.VOICE ? 2 : 1) : 0, pi: SET.INTRO, mu: SET.MUSIC, ch: SET.CHANTS, ru: SET.RUMBLE, cb: SET.CB, bm: SET.BIGM,
      vm: SET.vol.vm, vu: SET.vol.vu, vc: SET.vol.vc, vv: SET.vol.vv, mh: SET.MINHUD | 0, spt: SET.SPT | 0, ts: SET.TXT | 0, hc: SET.HC | 0, rm: SET.RM | 0, th: SET.THEME | 0 };
    if (SET.q2 != null) o.q = SET.q2; // graphics only when picked (else Unity's GPU-tier default)
    if (SET.hs != null) o.hsr = SET.hs; // H2K Super Resolution, same rule
    o.hsrm = SET.hm || 0;
    o.tfps = SET.tf == null ? 60 : SET.tf;
    return o;
  }
  var getK = function (k) {
    var f = flat();
    if (k === "q") return SET.q2 == null ? -1 : SET.q2;
    if (k === "hsr") return SET.hs == null ? -1 : SET.hs;
    return f[k];
  };
  function setK(k, v) {
    switch (k) {
      case "m": SET.m = v; break;
      case "s": SET.s = v; break;
      case "p": SET.p = v; break;
      case "cm": SET.cm = v; break;
      case "q": SET.q2 = v; break;
      case "fx": SET.fx = v; break;
      case "hsr": SET.hs = v; break;
      case "hsrm": SET.hm = v; break;
      case "tfps": SET.tf = v; break;
      case "df": SET.df = v; break;
      case "rf": SET.ru.FOULS = v; break;
      case "rc": SET.ru.SCLK = v; break;
      case "rv": SET.ru.VIOL = v; break;
      case "rs": SET.ru.SUBS = v; break;
      case "rb": SET.ru.BADGES = v; break;
      case "cmt": SET.COMM = v ? 1 : 0; SET.VOICE = v === 2 ? 1 : 0; break;
      case "pi": SET.INTRO = v; break;
      case "mu": SET.MUSIC = v; break;
      case "ch": SET.CHANTS = v; break;
      case "ru": SET.RUMBLE = v; break;
      case "cb": SET.CB = v; break;
      case "bm": SET.BIGM = v; break;
      case "mh": SET.MINHUD = v; break;
      case "spt": SET.SPT = v; break;
      case "ts": SET.TXT = v; applyA11y(); break;
      case "hc": SET.HC = v; applyA11y(); break;
      case "rm": SET.RM = v; applyA11y(); break;
      case "th": SET.THEME = v; applyA11y(); break;
      case "vm": case "vu": case "vc": case "vv": SET.vol[k] = v; break;
      case "ql": SET.ql = v; saveSet(); return; // sent with "start"
    }
    saveSet();
    send({ cmd: "setting", k: k, v: v });
  }

  // ---------------- Unity bridge ----------------
  var U = null, ready = false, Q = [], prog = 0, failed = "";
  function send(o) {
    Q.push(JSON.stringify(o));
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
      .catch(function (e) { fail(String((e && e.message) || e)); });
  }
  function fail(m) {
    failed = m;
    loadUi();
  }
  function loadUi() {
    var pc = Math.round(prog * 100) + "%";
    var h = $("#ldh");
    if (h) h.textContent = failed ? failed : ready ? "arena ready" : "loading the arena… " + pc;
    $$("#ov .ldb i, #ldbar i").forEach(function (b) { b.style.setProperty("--w", pc); });
    $$("#ov .ldm").forEach(function (m) { m.textContent = failed ? failed : ready ? "ARENA READY" : "LOADING THE ARENA… " + pc; });
  }

  // ---------------- rosters (sim.ts RO / nChoices over roster.js) ----------------
  var ALL = [], BYNAME = {};
  D.TM.forEach(function (t, ti) { t[2].forEach(function (a) { ALL.push({ t: ti, a: a }); BYNAME[a[0]] = a; }); });
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
  var teamOvr = function (pl) { return Math.round(pl.reduce(function (a, p) { return a + ov2(p); }, 0) / pl.length); };
  var abbr = function (n) { return n.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(); };
  var hexRgb = function (h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ""), n = m ? parseInt(m[1], 16) : 0x2a2f6a; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  var shade = function (h, k) { var c = hexRgb(h), f = function (v) { return Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1)); }; return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")"; };
  var lum = function (h) { var c = hexRgb(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };
  /** Team mark (browser ui/art.ts teamMark): shield in the team colour, sash, ball seams, monogram. Generic, no real logos. */
  function teamMark(name, col, size, cls) {
    var id = "g" + abbr(name) + hexRgb(col).join(""), lo = shade(col, 0.45), ink = lum(col) > 0.62 ? "#10142a" : "#fff";
    return '<svg class="' + (cls || "tmk") + '" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + shade(col, 1.35) + '"/><stop offset="1" stop-color="' + lo + '"/></linearGradient></defs>' +
      '<path d="M32 2 58 11v20c0 15-11 25-26 31C17 56 6 46 6 31V11z" fill="url(#' + id + ')" stroke="rgba(255,255,255,.55)" stroke-width="2"/><path d="M6 40 58 18v9L8 49z" fill="rgba(255,255,255,.16)"/>' +
      '<g fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.6"><circle cx="32" cy="31" r="19"/><path d="M13 31h38M32 12v38M19 17c7 8 7 20 0 28M45 17c-7 8-7 20 0 28"/></g>' +
      '<text x="32" y="38" text-anchor="middle" font-family="H2K Display,Impact,sans-serif" font-weight="700" font-size="19" fill="' + ink + '">' + abbr(name) + "</text></svg>";
  }
  var brandMark = function (s) {
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="bm" cx=".35" cy=".3"><stop offset="0" stop-color="#ffb070"/><stop offset=".6" stop-color="#ff6a1f"/><stop offset="1" stop-color="#8a3108"/></radialGradient></defs><circle cx="20" cy="20" r="17" fill="url(#bm)"/><g fill="none" stroke="#2a0e00" stroke-width="1.6" opacity=".8"><path d="M3 20h34M20 3v34"/><path d="M8 8c6 6 6 18 0 24M32 8c-6 6-6 18 0 24"/></g></svg>';
  };
  var ftin = function (h) { var i = Math.round(h * 12); return Math.floor(i / 12) + "'" + (i % 12) + '"'; };
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

  // ---------------- screens: every render fades / slides in (CSS .scr), reduced motion respected ----------------
  var ov = function () { return $("#ov"); };
  var navScope = null; // element arrow navigation is confined to (null = the visible screen)
  function screen(html, cls, mu) {
    closeCard();
    var o = ov();
    o.style.display = "flex";
    o.classList.toggle("mu-on", !!mu);
    o.innerHTML = '<div class="scr ' + (cls || "") + '">' + html + "</div>";
    o.scrollTop = 0;
    return o;
  }
  function focusFirst(sel) {
    var e = sel && document.querySelector(sel);
    if (e && e.focus) e.focus({ preventScroll: true });
  }

  // ---------------- hub (main.ts hubInit) ----------------
  var HMODES = [
    { t: "5v5 NBA GAME", k: "arena", ic: "🏆", c: "#1d428a", big: 1, tags: ["FULL COURT", "4 QUARTERS", "FOULS · FTs", "REPLAYS", "BOX SCORE"], hot: "UNITY",
      d: "The full game: " + D.TM.length + " teams, motion offense, screens, rebounds, free throws, Pro Play animation, instant replays and a box score — rendered by the Unity engine.", b: [["▶ PLAY 5v5", "5"], ["3v3 / 2v2", "3", 1]] },
    { t: "1V1 SHOWDOWN", k: "duel", ic: "⚡", c: "#7b3fb5", tags: ["PICK ANY STAR", "FULL COURT"], d: "Pick any of " + ALL.length + " players and duel the CPU with the same physics, fouls and tempo shooting.", b: [["▶ PLAY 1v1", "1"]] },
    { t: "GAME MODES", k: "modes", ic: "🎮", c: "#e8541e", tags: ["CLUTCH", "STREET", "CONTESTS", "PRACTICE"], d: "Clutch challenges, street ball, King of the Court, the All-Star game, the daily challenge, 3-point and dunk contests, HORSE, practice and a tutorial — on the matchup screen.", b: [["▶ PICK A MODE", "5"]] },
    { t: "PLAY ONLINE", k: "online", ic: "🌐", c: "#0b7a8a", tags: ["ROOM CODES", "ANTI-LAG"], hot: "NEW", d: "Host a game and send your friend the 4-letter code, or type a friend's code in the lobby.", b: [["▶ ONLINE LOBBY", "online"]] },
  ];
  var hubRaf = 0;
  var hbtn = function (b, i) { return '<button type="button" class="btn' + (b[2] ? " ghost" : i === 0 ? " pri" : "") + '" data-g="' + b[1] + '">' + b[0] + "</button>"; };
  function hubInit() {
    var LP = lsGet("h2k_lastplay", null), RC = rec.get(), MY = lsGet("h2k_myp", null);
    var lpNp = LP ? LP.np || (/^1v1/.test(LP.mode || "") ? 1 : 5) : 5;
    $("#brand").innerHTML = brandMark(34) + '<span class="disp">HOOPS <b>2K27</b></span>';
    $("#prof").innerHTML = '<span class="chip"><b>' + RC.w + "</b>W <b>" + RC.l + "</b>L</span>" + (MY && MY.lv ? '<span class="chip">LV <b>' + MY.lv + "</b></span>" : "");
    var F = HMODES[0];
    $("#feat").style.setProperty("--c", F.c);
    $("#feat").innerHTML = '<div class="art art-' + F.k + '"></div><div class="fb"><span class="eyebrow">Featured · ' + F.hot + '</span><h1 class="disp">' + F.t + "</h1><p>" + esc(F.d) + '</p><div class="tags">' +
      F.tags.map(function (t) { return '<span class="chip">' + t + "</span>"; }).join("") + '</div><div class="acts">' + F.b.map(hbtn).join("") + "</div></div>";
    var games = RC.w + RC.l, pct = games ? Math.round((100 * RC.w) / games) : 0;
    $("#side").innerHTML = '<article class="tile qp"><span class="eyebrow">Quick play</span><button type="button" id="qpb" class="btn pri lg qpb">▶ Quick play <small>' + (LP ? (lpNp > 1 ? lpNp + "v" + lpNp : "1v1") + " · your last matchup" : "5v5 · jump straight in") + "</small></button>" +
      '<div class="ldw"><div class="ldb" id="ldbar"><i></i></div></div></article>' +
      '<article class="tile pro"><span class="eyebrow">Your record vs the CPU</span><div class="pr"><div class="ring" style="--p:' + pct + '"><b class="disp">' + pct + '%</b><small>WINS</small></div><dl><div><dt>Record</dt><dd class="disp">' + RC.w + "-" + RC.l +
      '</dd></div><div><dt>Streak</dt><dd class="disp">' + (RC.st > 1 ? "🔥 " + RC.st : RC.st || 0) + '</dd></div><div><dt>Best</dt><dd class="disp">' + (RC.best || 0) + "</dd></div></dl></div></article>" +
      '<article class="tile"><span class="eyebrow">The league</span><div class="stats" id="hst"><span class="chip"><b>' + D.TM.length + '</b> teams</span><span class="chip"><b>' + ALL.length + '</b> players</span><span class="chip"><b>' + (D.MODES.length + 2) + '</b> modes</span><span class="chip"><b>Unity</b> WebGPU / WebGL2</span><span class="chip"><b>Online</b> rooms</span></div></article>';
    $("#qpb").onclick = function () {
      enterGame(LP ? LP.np0 || (lpNp > 1 ? 5 : 1) : 5, lpNp);
      SEL = LP ? Math.min(LP.sel | 0, nChoices() - 1) : 0;
      OPP = LP && LP.opp >= 0 && LP.opp < nChoices() ? LP.opp : -1;
      start("game");
    };
    $("#grid").innerHTML = HMODES.slice(1).map(function (m, i) {
      return '<article class="m" style="--c:' + m.c + ";--i:" + i + '"><div class="art art-' + m.k + '"><span class="ic" aria-hidden="true">' + m.ic + "</span>" + (m.hot ? '<span class="chip hot">' + m.hot + "</span>" : "") + '</div><div class="mb"><h2 class="disp">' + m.t + '</h2><div class="tags">' +
        m.tags.map(function (t) { return '<span class="chip">' + t + "</span>"; }).join("") + "</div><p>" + esc(m.d) + '</p><div class="acts">' + m.b.map(hbtn).join("") + "</div></div></article>";
    }).join("");
    $$("#hub [data-g]").forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.g;
        if (g === "online") return online();
        enterGame(+g === 1 ? 1 : 5, +g);
        menu();
      };
    });
    $("#news").innerHTML = HB.LOG.slice(0, 3).map(function (r, i) {
      return '<article class="nw"><div class="nh"><span class="chip' + (i ? "" : " hot") + '">v' + r.v + '</span><span class="muted">' + r.d + '</span></div><h3 class="disp">' + r.n + "</h3><p>" + r.l[0] + "</p></article>";
    }).join("") + '<button type="button" class="btn ghost nwall" data-goto="log">All updates ▶</button>';
    $$("#hub [data-goto]").forEach(function (b) { b.onclick = function () { hubTab(b.dataset.goto); }; });
    $("#logp").innerHTML = HB.LOG.map(function (r, i) {
      return '<article class="rel" style="animation-delay:' + Math.min(i, 8) * 50 + 'ms"><h3><span class="chip' + (r.n2 ? " hot" : "") + '">v' + r.v + '</span> <span class="disp">' + r.n + "</span>" + (r.n2 ? '<em class="chip">LATEST</em>' : "") + "<s>" + r.d + "</s></h3><ul>" +
        r.l.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></article>";
    }).join("");
    var kh = function (id, a) { $(id).innerHTML = a.map(function (x) { return "<div><span>" + x[0] + "</span><kbd>" + x[1] + "</kbd></div>"; }).join(""); };
    kh("#k1", HB.K1); kh("#k2", HB.K2); kh("#k3", HB.K3); kh("#k5", HB.K5);
    var latest = HB.LOG.length ? HB.LOG[0].v : "";
    if (lsGet("h2k_seen", "") === latest) $("#nw").hidden = true;
    $$("#hub nav button").forEach(function (b) {
      b.onclick = function () { hubTab(b.dataset.t); };
    });
    $("#hset").onclick = function () { openSettings("gameplay"); };
    hubTab.latest = latest;
    var cv = $("#bg"), c = cv.getContext && cv.getContext("2d"), W = 0, H = 0, pts = [];
    if (!c) return;
    var rs = function () {
      W = cv.width = innerWidth;
      H = cv.height = innerHeight;
      pts = Array.from({ length: 36 }, function () { return { x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.5, v: 0.12 + Math.random() * 0.4 }; });
    };
    rs();
    addEventListener("resize", rs);
    var fr = function (t) {
      hubRaf = requestAnimationFrame(fr);
      var still = SET.RM || matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (scr !== "hub" || document.hidden || (still && fr.done)) return;
      fr.done = 1;
      var light = getComputedStyle(document.documentElement).colorScheme === "light", L = light ? "255,120,40" : "255,170,80";
      c.clearRect(0, 0, W, H);
      var g = c.createRadialGradient(W * 0.5, H * 0.05, 0, W * 0.5, H * 0.1, Math.max(W, H) * 0.9);
      g.addColorStop(0, light ? "#ffffff" : "#1a2160"); g.addColorStop(0.5, light ? "#eef0f6" : "#0a0c1c"); g.addColorStop(1, light ? "#e3e6f0" : "#05060d");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      c.strokeStyle = "rgba(" + L + ",.09)";
      c.lineWidth = 1;
      var hz = H * 0.62, off = still ? 0 : (t * 0.02) % 80;
      for (var i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(W / 2 + i * 40, hz); c.lineTo(W / 2 + i * 260, H); c.stroke(); }
      for (var k = 0; k < 12; k++) { var y = hz + Math.pow((k * 80 + off) / 960, 2) * (H - hz) * 2.2; if (y > hz && y < H) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } }
      for (var j = 0; j < pts.length; j++) { var p = pts[j]; if (!still) { p.y -= p.v; if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; } } c.fillStyle = "rgba(" + L + ",.3)"; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.3); c.fill(); }
    };
    hubRaf = requestAnimationFrame(fr);
  }
  function hubTab(t) {
    $$("#hub nav button").forEach(function (x) { x.classList.toggle("on", x.dataset.t === t); x.setAttribute("aria-current", x.dataset.t === t ? "page" : "false"); });
    ["play", "log", "how"].forEach(function (k) { $("#" + k).hidden = k !== t; });
    if (t === "log") { $("#nw").hidden = true; lsPut("h2k_seen", hubTab.latest); }
    window.scrollTo(0, 0);
  }
  /** Hub -> game view: swap the stylesheets like main.ts go() (hub CSS off, game CSS on). */
  function enterGame(np0, np) {
    NP0 = np0;
    NP = np > 0 ? np : np0;
    $("#hcss").media = "not all";
    $("#gcss").media = "all";
    $("#hub").hidden = true;
    $("#game").hidden = false;
    window.scrollTo(0, 0);
  }
  function toHub() {
    if (scr !== "hub" && scr !== "menu" && scr !== "clutch") send({ cmd: "quit" });
    scr = "hub";
    closeSettings();
    closeCard();
    playing(false);
    $("#hcss").media = "all";
    $("#gcss").media = "not all";
    $("#hub").hidden = false;
    $("#hub").classList.remove("in");
    void $("#hub").offsetWidth; // restart the entry animation
    $("#hub").classList.add("in");
    $("#game").hidden = true;
    focusFirst("#qpb");
  }
  function online() {
    enterGame(5, 5);
    scr = "online";
    send({ cmd: "online" });
    ov().style.display = "none"; // Unity's lobby (NetLobby IMGUI) draws over the arena
    playing(false);
  }

  // ---------------- player card (ratings + badges) on hover / focus / tap ----------------
  var cardFor = null;
  function closeCard() {
    var c = $("#pcard");
    if (c) c.hidden = true;
    cardFor = null;
  }
  function openCard(el) {
    var p = BYNAME[el.dataset.pn];
    if (!p) return;
    var c = $("#pcard"), col = el.dataset.col || "#2a2f55";
    if (!c) {
      c = document.createElement("div");
      c.id = "pcard";
      c.setAttribute("role", "dialog");
      document.body.appendChild(c);
    }
    var bars = [["3PT", p[1]], ["INSIDE", p[2]], ["SPEED", p[3]], ["DEFENSE", p[4]], ["JUMP", p[5]]];
    var bd = (p[14] || []).map(function (b) { return '<i title="' + esc(D.BADGE[b] || b) + '">' + esc(D.BADGE[b] || b) + "</i>"; }).join("");
    c.style.setProperty("--c", col);
    c.innerHTML = '<div class="pch"><img alt="" src="' + avatar(p, col) + '"><div><small>#' + p[12] + " · " + ftin(p[10]) + "</small><b>" + esc(p[0]) + '</b></div><div class="ovr"><small>OVR</small>' + ov2(p) + "</div></div>" +
      '<div class="rt">' + bars.map(function (b) { return "<div><span>" + b[0] + '</span><i style="--w:' + b[1] + '%"></i><em>' + b[1] + "</em></div>"; }).join("") + "</div>" +
      '<div class="bdg">' + (bd || '<i class="no">No badges</i>') + "</div>";
    c.hidden = false;
    cardFor = el;
    var r = el.getBoundingClientRect(), cw = 260, x = r.right + 10, y = r.top;
    if (x + cw > innerWidth - 8) x = r.left - cw - 10;
    if (x < 8) x = Math.max(8, Math.min(innerWidth - cw - 8, r.left));
    c.style.left = x + "px";
    c.style.top = Math.max(8, Math.min(innerHeight - 250, y)) + "px";
  }
  function bindCards(root) {
    $$("[data-pn]", root).forEach(function (li) {
      li.onmouseenter = function () { openCard(li); };
      li.onmouseleave = function () { if (cardFor === li) closeCard(); };
      li.onfocus = function () { openCard(li); };
      li.onblur = function () { if (cardFor === li) closeCard(); };
      li.onpointerup = function (e) { if (e.pointerType !== "mouse") (cardFor === li ? closeCard() : openCard(li)); };
    });
  }

  // ---------------- matchup screen (game.ts menu) + team carousel ----------------
  var opt = function (k, v, cur, l) { return '<button data-' + k + '="' + v + '" class="' + (cur === v ? "on" : "") + '">' + l + "</button>"; };
  var modeStrip = function () {
    return '<div class="modes" role="group" aria-label="Game modes">' + D.MODES.map(function (m) { return '<button type="button" class="mode" data-mode="' + m[0] + '" style="--c:' + (m[4] || "#2a2f6a") + '"><span class="mic" aria-hidden="true">' + m[1] + "</span><b>" + m[2] + "</b><small>" + (m[3] || "") + "</small></button>"; }).join("") + "</div>";
  };
  function loading() {
    return ready ? "" : '<div class="ldm">' + (failed ? esc(failed) : "LOADING THE ARENA… " + Math.round(prog * 100) + "%") + '</div><div class="ldb"><i style="--w:' + Math.round(prog * 100) + '%"></i></div>';
  }
  function side(i, you) {
    var r = RO(i), pl = r[1], name = r[2], sub = NP > 1 ? "" : D.TM[ALL[i].t][0], cy = you ? "y" : "o";
    return '<section class="side' + (you ? " you" : "") + '" style="--c:' + r[0] + '">' +
      '<div class="sh"><button type="button" class="arw btn icon" data-cy="' + cy + '" data-d="-1" aria-label="Previous">◀</button>' +
      (NP > 1 ? teamMark(name, r[0], 54) : '<img class="hs" alt="" src="' + avatar(pl[0], r[0]) + '">') +
      '<div class="tn"><span class="eyebrow">' + (you ? "You" : "Opponent") + (sub ? " · " + esc(sub) : "") + '</span><b class="disp">' + esc(name) + "</b></div>" +
      '<div class="ovr"><small>OVR</small><b class="disp">' + teamOvr(pl) + "</b></div>" +
      '<button type="button" class="arw btn icon" data-cy="' + cy + '" data-d="1" aria-label="Next">▶</button></div>' +
      '<ol class="lu">' + pl.map(function (p, k) {
        return '<li tabindex="0" data-pn="' + esc(p[0]) + '" data-col="' + r[0] + '" style="--d:' + k * 50 + 'ms"><img alt="" src="' + avatar(p, r[0]) + '"><span class="pn">' + (NP >= 5 ? POS[k] : "#" + p[12]) + "</span><b>" + esc(p[0]) +
          ((p[14] || []).length ? ' <small class="bd">★' + p[14].length + "</small>" : "") + '</b><span class="po">' + ov2(p) + '</span><i class="pb" style="--w:' + Math.max(0, (ov2(p) - 55) * 2.3) + '%"></i></li>';
      }).join("") + "</ol></section>";
  }
  function carousel() {
    var N = nChoices(), h = "";
    for (var i = 0; i < N; i++) {
      var r = RO(i), sel = i === SEL, op = i === OPP;
      h += '<button type="button" class="card' + (sel ? " sel" : "") + (op ? " opp" : "") + '" role="option" aria-selected="' + sel + '" data-i="' + i + '" style="--i:' + (i % 12) + ";--c:" + r[0] + '" title="' + esc(r[2]) + '">' +
        (NP > 1
          ? teamMark(r[2], r[0], 34, "cb") + '<span class="cn">' + esc(r[2]) + '</span><span class="co">' + teamOvr(r[1]) + '</span><span class="c5">' +
            r[1].map(function (p) { return '<img alt="" src="' + avatar(p, r[0]) + '">'; }).join("") + "</span>"
          : '<img alt="" src="' + avatar(r[1][0], r[0]) + '"><span class="cn">' + esc(r[2].split(" ").pop()) + '</span><span class="co">' + ov2(r[1][0]) + "</span>") +
        (sel ? '<em class="tg">YOU</em>' : op ? '<em class="tg o">OPP</em>' : "") + "</button>";
    }
    return '<section class="pick"><h2 class="eyebrow">Choose your ' + (NP > 1 ? "team" : "star") + '</h2><div class="car"><button type="button" class="carb btn" data-car="-1" aria-label="Previous team">◀</button><div id="g" class="strip" role="listbox" aria-label="Choose your ' + (NP > 1 ? "team" : "star") + '">' + h +
      '</div><button type="button" class="carb btn" data-car="1" aria-label="Next team">▶</button></div></section>';
  }
  function cyc(who, d) {
    var N = nChoices();
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
    var f = document.activeElement, keep = f && f.dataset && f.dataset.cy ? '.arw[data-cy="' + f.dataset.cy + '"][data-d="' + f.dataset.d + '"]' : f && f.dataset && f.dataset.car ? '.carb[data-car="' + f.dataset.car + '"]' : null;
    menu(keep || ".strip .card.sel");
  }
  function menu(focusSel) {
    var again = scr === "menu";
    scr = "menu";
    playing(false);
    var N = nChoices();
    if (SEL >= N) SEL = 0;
    if (OPP >= N || OPP === SEL) OPP = -1;
    var R = rec.get();
    var rnd = '<section class="side rnd"><div class="sh"><button type="button" class="arw btn icon" data-cy="o" data-d="-1" aria-label="Previous">◀</button><div class="qmark disp" aria-hidden="true">?</div><div class="tn"><span class="eyebrow">Opponent</span><b class="disp">Random</b></div><button type="button" class="arw btn icon" data-cy="o" data-d="1" aria-label="Next">▶</button></div>' +
      '<ol class="lu q">' +
      (NP > 1 ? POS.slice(0, NP) : ["?"]).map(function (ps, k) { return '<li style="--d:' + k * 50 + 'ms"><span class="qa">?</span><span class="pn">' + (NP > 1 ? ps : "") + "</span><b>Mystery " + (NP > 1 ? "starter" : "star") + '</b><span class="po">??</span></li>'; }).join("") + "</ol></section>";
    var rat = function (pl) { return [avg(pl, 1), avg(pl, 2), avg(pl, 3), avg(pl, 4), teamOvr(pl)]; },
      A = rat(RO(SEL)[1]), Bv = OPP >= 0 ? rat(RO(OPP)[1]) : null,
      tape = Bv ? '<div class="cmp tape" style="--c0:' + RO(SEL)[0] + ";--c1:" + RO(OPP)[0] + '">' + ["3PT", "INSIDE", "SPEED", "DEFENSE", "OVERALL"].map(function (k, j) {
        var t = A[j] + Bv[j] || 1;
        return '<div><em class="' + (A[j] > Bv[j] ? "w" : "") + '">' + A[j] + '</em><span><i style="--w:' + (100 * A[j]) / t + '%;background:var(--c0)"></i><i style="--w:' + (100 * Bv[j]) / t + '%;background:var(--c1)"></i></span><em class="' + (Bv[j] > A[j] ? "w" : "") + '">' + Bv[j] + "</em><small>" + k + "</small></div>";
      }).join("") + "</div>" : '<p class="hint tape0">Random opponent: a surprise ' + (NP > 1 ? "team" : "star") + " every game.</p>",
      segf = function (k, l, o, cur) { return '<div class="fr"><span class="sl">' + l + '</span><div class="seg">' + o.map(function (x) { return '<button type="button" data-' + k + '="' + x[0] + '" class="' + (cur === x[0] ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div></div>"; };
    var o = screen('<div class="mu">' +
      '<header class="mu-top"><div class="mu-title"><span class="eyebrow">' + (NP > 1 ? NP + "v" + NP : "1v1 Showdown") + ' · Unity arena</span><h1 class="disp">Matchup</h1></div>' +
      '<div class="mu-tools"><span class="chip rec" title="Your record vs the CPU"><b>' + R.w + "</b>W <b>" + R.l + "</b>L" + (R.st > 1 ? " · 🔥 <b>" + R.st + "</b>" : "") + '</span><button type="button" id="set" class="btn gear">⚙ Settings</button></div></header>' +
      '<div class="vs">' + side(SEL, true) +
      '<div class="mid"><div class="vsb disp" aria-hidden="true">VS</div>' + tape + '<div class="frm">' +
      segf("df", "Difficulty", DIFFN.map(function (n, i) { return [i, n]; }), SET.df) +
      (NP0 > 1 ? segf("tsz", "Team size", [[5, "5v5"], [3, "3v3"], [2, "2v2"]], NP) : "") +
      segf("ql", "Quarter length", [[30, "30 s"], [60, "1 min"], [120, "2 min"], [180, "3 min"]], SET.ql) + "</div>" +
      '<button type="button" class="btn pri lg big" id="tip">Tip off ▶</button>' + loading() +
      '<p class="hint keys">Arrows / d-pad move · Enter / A select · Q E your ' + (NP > 1 ? "team" : "star") + " · Z C opponent · Esc / B back</p></div>" +
      (OPP < 0 ? rnd : side(OPP, false)) + "</div>" + carousel() + '<section class="mstrip"><h2 class="eyebrow">More ways to play</h2>' + modeStrip() + "</section></div>", again ? "re" : "", true);
    o.style.setProperty("--tc", RO(SEL)[0]);
    $$(".arw", o).forEach(function (b) { b.onclick = function () { cyc(b.dataset.cy, +b.dataset.d); }; });
    $$(".carb", o).forEach(function (b) { b.onclick = function () { cyc("y", +b.dataset.car); }; });
    $$(".strip .card", o).forEach(function (b) {
      b.onclick = function () { SEL = +b.dataset.i; if (OPP === SEL) OPP = -1; menu('.strip .card[data-i="' + SEL + '"]'); };
    });
    var cur = $(".strip .card.sel", o);
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
    $("#tip").onclick = function () { start("game"); };
    var grp = function (k, f, re) {
      $$("[data-" + k + "]", o).forEach(function (b) {
        b.onclick = function () {
          f(+b.dataset[k]);
          if (re) menu('[data-' + k + '="' + b.dataset[k] + '"]');
          else $$("[data-" + k + "]", o).forEach(function (c) { c.classList.toggle("on", c === b); });
        };
      });
    };
    grp("tsz", function (v) { NP = v; }, true);
    grp("ql", function (v) { setK("ql", v); });
    grp("df", function (v) { setK("df", v); });
    $$("[data-mode]", o).forEach(function (b) {
      b.onclick = function () { b.dataset.mode === "clutch" ? clutchScreen() : start(b.dataset.mode); };
    });
    $("#set").onclick = function () { openSettings("gameplay"); };
    bindCards(o);
    focusFirst(focusSel || "#tip");
  }
  /** modesui.ts clutchScreen: pick a scenario (stars = beaten, saved in h2k_cc like the browser). */
  function clutchScreen() {
    scr = "clutch";
    var st = lsGet("h2k_cc", {});
    var o = screen('<div class="fin"><header class="fhead"><span class="eyebrow">Game modes</span><div class="logo disp">Clutch challenges</div><p class="hint">Your team vs your chosen opponent (or a random one). Beat the scenario.</p></header>' +
      '<div class="cc">' + D.CLUTCH.map(function (c, i) { return '<button type="button" data-cc="' + i + '" class="' + (st[i] ? "done" : "") + '"><span class="ccs">' + (st[i] ? "★" : "☆") + "</span><b>" + esc(c.n) + "</b><small>" + esc(c.d) + "</small></button>"; }).join("") + "</div>" +
      '<div class="row actions"><button type="button" class="btn" id="mme">◀ Back</button></div></div>', "clutch");
    $$("[data-cc]", o).forEach(function (b) { b.onclick = function () { start("clutch", +b.dataset.cc); }; });
    $("#mme").onclick = function () { menu(); };
    focusFirst("[data-cc]");
  }
  /** TIP OFF / a mode: hand the matchup to Unity and get out of the way. */
  function start(mode, arg) {
    var r = rec.get();
    last = { cmd: "start", mode: mode, arg: arg || 0, np: NP, sel: SEL, opp: OPP, diff: SET.df, ql: SET.ql, set: flat(), rec: { w: r.w, l: r.l } };
    if (mode === "game") lsPut("h2k_lastplay", { mode: NP > 1 ? "5v5-3d" : "1v1-3d", np: NP, np0: NP0, sel: SEL, opp: OPP });
    closeSettings();
    send(last);
    play();
  }
  function playing(on) {
    var g = $("#game");
    if (g) g.classList.toggle("playing", on);
    document.body.classList.toggle("playing", on);
  }
  var TIPS = (HB.K1 || []).concat(HB.K2 || []).map(function (k) { return k[0] + ": " + k[1]; });
  var tipT = 0;
  function play() {
    closeCard();
    if (!ready) {
      // the build is still streaming: the start command waits in the queue; progress until Unity says "ready"
      scr = "loading";
      var l = last || { sel: SEL, opp: OPP };
      var me = RO(l.sel), op = l.opp >= 0 ? RO(l.opp) : null;
      screen('<div class="load"><div class="logo">HOOPS<span>2K27</span></div>' +
        '<div class="lvs"><span style="--c:' + me[0] + '">' + esc(me[2]) + "</span><i>VS</i><span" + (op ? ' style="--c:' + op[0] + '"' : "") + ">" + (op ? esc(op[2]) : "Random") + "</span></div>" +
        loading() + '<p class="hint tip" id="ltip">' + esc(TIPS.length ? TIPS[(Math.random() * TIPS.length) | 0] : "") + "</p></div>", "loading");
      clearInterval(tipT);
      tipT = setInterval(function () {
        var t = $("#ltip");
        if (!t || scr !== "loading") return clearInterval(tipT);
        t.textContent = TIPS[(Math.random() * TIPS.length) | 0] || "";
      }, 3500);
      return;
    }
    clearInterval(tipT);
    scr = "play";
    ov().style.display = "none";
    closeSettings();
    playing(true);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var c = $("#unity-canvas");
    if (c && c.focus) c.focus();
  }

  // ---------------- settings: tabs Gameplay / Controls / Display / Audio / Accessibility (browser ui/settings.ts) ----------------
  var TABS = [["gameplay", "Gameplay", "🏀"], ["controls", "Controls", "🎮"], ["display", "Display", "🖥"], ["audio", "Audio", "🔊"], ["access", "Accessibility", "♿"]];
  var setTab = "gameplay";
  function sdEl() {
    var s = $("#sd");
    if (!s) {
      var m = document.createElement("div");
      m.id = "sdm";
      m.hidden = true;
      m.onclick = function () { closeSettings(); };
      s = document.createElement("aside");
      s.id = "sd";
      s.hidden = true;
      s.setAttribute("role", "dialog");
      s.setAttribute("aria-modal", "true");
      s.setAttribute("aria-label", "Settings");
      document.body.appendChild(m);
      document.body.appendChild(s);
    }
    return s;
  }
  var segRow = function (k, l, o, cur, hint) {
    return '<div class="srow"><span class="sl">' + l + '</span><div class="seg" role="group" aria-label="' + l + '">' + o.map(function (x) {
      return '<button type="button" data-' + k + '="' + x[0] + '" class="' + (cur === x[0] ? "on" : "") + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>" + (hint ? '<p class="hint">' + hint + "</p>" : "") + "</div>";
  };
  var OO = [[1, "On"], [0, "Off"]];
  function onoff(k, l, hint) { return segRow(k, l, OO, getK(k) ? 1 : 0, hint); }
  var grpS = function (h, body) { return '<section class="sgrp"><h3>' + h + "</h3>" + body + "</section>"; };
  function slider(k, l) {
    return '<label class="vol"><span>' + l + '</span><input type="range" min="0" max="100" step="5" data-v="' + k + '" value="' + SET.vol[k] + '" aria-label="' + l + '"><em id="sv-' + k + '">' + SET.vol[k] + "</em></label>";
  }
  function tabBody(t) {
    if (t === "gameplay")
      return grpS("Match", segRow("df", "Difficulty", DIFFN.map(function (n, i) { return [i, n]; }), SET.df) + onoff("p", "Pro Play engine")) +
        grpS("Shooting", segRow("s", "Shooting style", [[0, "Hold &amp; release"], [1, "Tempo"]], SET.s) + segRow("m", "Shot meter", MN.map(function (n, i) { return [i, n]; }), SET.m, "Green is always at the top.")) +
        grpS("Rules", onoff("rf", "Fouls") + onoff("rc", "Shot clock") + onoff("rv", "Violations", "3 seconds · 8 seconds · goaltending") + onoff("rs", "Fatigue &amp; subs", "5v5: reserves check in, 6 fouls = out") + onoff("rb", "Badges &amp; hot zones")) +
        grpS("Presentation", onoff("pi", "Player intros"));
    if (t === "controls") {
      var tb = function (h, a) { return '<section class="sgrp"><h3>' + h + '</h3><div class="kref">' + a.map(function (x) { return "<span>" + esc(x[0]) + "</span><kbd>" + esc(x[1]) + "</kbd>"; }).join("") + "</div></section>"; };
      return tb("KEYBOARD · MOVE &amp; SHOOT", HB.K1) + tb("KEYBOARD · DRIBBLE &amp; POST", HB.K2) + tb("KEYBOARD · GAME", HB.K3.filter(function (k) { return !/Remap|online/i.test(k[0]); })) +
        grpS("GAMEPAD", onoff("ru", "Gamepad rumble") + '<div class="kref">' + HB.K5.map(function (x) { return "<span>" + esc(x[0]) + "</span><kbd>" + esc(x[1]) + "</kbd>"; }).join("") + "</div>") +
        tb("MENUS", [["Move between buttons", "arrows / d-pad / stick"], ["Select", "Enter / A"], ["Back · close", "Esc / B"], ["Your team · opponent", "Q E · Z C (LB RB · LT RT)"], ["Pause / resume", "Esc / P / Start"]]) +
        '<p class="hint">The Unity build uses these fixed bindings for now (no remapping yet).</p>';
    }
    if (t === "display")
      return grpS("Camera &amp; quality", segRow("cm", "Camera", CAMN.map(function (n, i) { return [i, n]; }), SET.cm, "K in game cycles the camera.") + segRow("q", "Graphics", QN.map(function (n, i) { return [i, n]; }), getK("q"), SET.q2 == null ? "Auto: picked for your GPU until you choose." : "Saved.") +
        onoff("fx", "Effects", "Bloom · colour grade · depth of field in replays")) +
        grpS("Performance", segRow("hsr", "Super resolution (HSR)", HSRN.map(function (n, i) { return [i, n]; }), getK("hsr"), (SET.hs == null ? "Auto-picked for your GPU. " : "") + "Draws fewer pixels and upscales (STP temporal where supported, else FSR 1). Quality 67% · Balanced 58% · Performance 50% · Ultra 33%; Auto holds your target.") +
          segRow("hsrm", "Upscaler", [[0, "Auto"], [1, "Temporal"], [2, "Spatial"]], SET.hm || 0) +
          segRow("tfps", "Target FPS", [60, 90, 120, 144, 240, 0].map(function (f) { return [f, f ? String(f) : "Max"]; }), SET.tf == null ? 60 : SET.tf, (HZ ? "Your screen: " + HZ + " Hz. " : "") + "Browsers draw at most once per screen refresh, so higher targets act as Max.")) +
        grpS("Interface", segRow("mh", "HUD", [[0, "Full"], [1, "Minimal"]], SET.MINHUD | 0) + segRow("th", "Menu theme", [[0, "Dark"], [1, "Light"], [2, "System"]], SET.THEME | 0));
    if (t === "access")
      return grpS("Vision", segRow("ts", "Text size", [[0, "Normal"], [1, "Large"], [2, "Extra large"]], SET.TXT | 0, "Menus (the Unity HUD keeps its size).") +
          segRow("cb", "Meter colours", PALN.map(function (n, i) { return [i, n]; }), SET.CB | 0, "Red-green safe for protanopia / deuteranopia, blue-yellow safe for tritanopia.") +
          segRow("bm", "Meter size", [[0, "Normal"], [1, "Large"]], SET.BIGM | 0) + onoff("hc", "High contrast", "Stronger lines and text in the menus.")) +
        grpS("Motion", onoff("rm", "Reduce motion", "No menu animations.")) +
        grpS("Input", segRow("spt", "Sprint", [[0, "Hold"], [1, "Toggle"]], SET.SPT | 0));
    var cmt = SET.COMM ? (SET.VOICE ? 2 : 1) : 0;
    return grpS("VOLUME", slider("vm", "Master") + slider("vu", "Music") + slider("vc", "Crowd") + slider("vv", "Commentary")) +
      grpS("SOUND", onoff("mu", "Arena music") + onoff("ch", "Crowd chants", "DE-FENSE · LET'S GO · M-V-P · AIR BALL · boos and roars") + segRow("cmt", "Commentary", [[0, "Off"], [1, "Captions"], [2, "Captions + voice"]], cmt));
  }
  var setBack = null, setOpener = null;
  function openSettings(tab, back) {
    closeCard();
    var fresh = !settingsOn();
    if (fresh) setOpener = document.activeElement;
    setTab = tab || setTab;
    if (back !== undefined) setBack = back || null;
    var s = sdEl();
    s.innerHTML = '<div class="sdh"><h2 class="disp">Settings</h2><button type="button" class="btn icon ghost" id="sdx" aria-label="Close settings">✕</button></div>' +
      '<div class="tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === setTab) + '" class="' + (t[0] === setTab ? "on" : "") + '"><span aria-hidden="true">' + t[2] + "</span> " + t[1] + "</button>"; }).join("") + "</div>" +
      '<div class="sdb"><div class="tbody sdp" role="tabpanel" data-t="' + setTab + '">' + tabBody(setTab) + "</div></div>";
    s.hidden = false;
    $("#sdm").hidden = false;
    $$("[data-tab]", s).forEach(function (b) { b.onclick = function () { openSettings(b.dataset.tab); focusFirst('#sd [data-tab="' + b.dataset.tab + '"]'); }; });
    ["df", "p", "s", "m", "cb", "bm", "rf", "rc", "rv", "rs", "rb", "pi", "ru", "q", "fx", "hsr", "hsrm", "tfps", "cm", "mu", "ch", "cmt", "mh", "th", "ts", "hc", "rm", "spt"].forEach(function (k) {
      $$("[data-" + k + "]", s).forEach(function (b) {
        b.onclick = function () {
          setK(k, +b.dataset[k]);
          $$("[data-" + k + "]", s).forEach(function (c) { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", String(c === b)); });
          if (k === "df" && scr === "menu") $$('#ov [data-df]').forEach(function (c) { c.classList.toggle("on", +c.dataset.df === SET.df); });
        };
      });
    });
    $$("input[data-v]", s).forEach(function (r) {
      r.oninput = function () { $("#sv-" + r.dataset.v).textContent = r.value; };
      r.onchange = function () { setK(r.dataset.v, +r.value); };
    });
    $("#sdx").onclick = function () { closeSettings(); };
    navScope = s;
    if (!s.contains(document.activeElement)) focusFirst('#sd [data-tab="' + setTab + '"]');
  }
  function settingsOn() { var s = $("#sd"); return !!s && !s.hidden; }
  function closeSettings() {
    var s = $("#sd");
    if (!s || s.hidden) return;
    s.hidden = true;
    $("#sdm").hidden = true;
    navScope = null;
    var b = setBack, o = setOpener;
    setBack = null;
    setOpener = null;
    if (b) b();
    else if (scr === "menu") focusFirst("#set");
    else if (scr === "hub") focusFirst("#hset");
    else if (o && o.isConnected && o.focus) o.focus();
  }
  // ---------------- pause (game.ts pause) + live box score ----------------
  var PZ = null;
  function boxTable(F, t, live) {
    var box = (F.box || [[], []])[t] || [], cl = (F.cl || ["", ""])[t], pc = (F.pc || [])[t] || "#ffd23f";
    if (!box.length) return "";
    return '<table class="bx' + (live ? " live" : "") + '"><tr><th style="color:' + pc + '">' + esc(cl) + "</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th>" +
      (live ? "" : "<th>3P</th><th>BLK</th><th>OREB</th><th>PF</th><th title=\"charges drawn + loose-ball dives + screen assists\">HUS</th>") + "</tr>" +
      box.map(function (p) {
        return "<tr class=\"" + (p.fo ? "fo" : "") + (live && p.on ? " on" : "") + '"><td>' + esc(p.n) + "</td><td>" + p.pts + "</td><td>" + p.reb + "</td><td>" + p.ast + "</td><td>" + p.fgm + "-" + p.fga + "</td>" +
          (live ? "" : "<td>" + p.tpm + "-" + p.tpa + "</td><td>" + p.blk + "</td><td>" + (p.orb || 0) + "</td><td>" + (p.pf || 0) + (p.fo ? " (out)" : "") + "</td><td>" + (p.hus || 0) + "</td>") + "</tr>";
      }).join("") + "</table>";
  }
  /** Broadcast scoreboard row (browser game.ts board). */
  function board(sc, cl, pc, sub) {
    var t = function (i) { return '<div class="bt' + (i ? " r" : "") + '" style="--c:' + pc[i] + '">' + teamMark(cl[i], pc[i], 44) + '<b class="disp">' + esc(cl[i]) + '</b><em class="disp num">' + sc[i] + "</em></div>"; };
    return '<div class="board">' + t(0) + '<span class="bmid">' + (sub || "") + "</span>" + t(1) + "</div>";
  }
  function pause(j, focusSel) {
    PZ = j || PZ || {};
    if (PZ.cm != null && j) SET.cm = PZ.cm; // K / M in game change these on the Unity side
    if (PZ.m != null && j) SET.m = PZ.m;
    scr = "pause";
    playing(false);
    var sc = PZ.sc || [0, 0], cl = PZ.cl || ["", ""], pc = PZ.pc || ["#7b3fb5", "#1d428a"];
    var bx = boxTable(PZ, 0, 1) + boxTable(PZ, 1, 1);
    var mi = function (id, ic, l, v) { return '<button type="button" id="' + id + '" class="mi"><span class="mic" aria-hidden="true">' + ic + "</span><span>" + l + "</span>" + (v ? "<em>" + v + "</em>" : "") + "</button>"; };
    var o = screen('<div class="pzw"><section class="pzl panel"><span class="eyebrow">Game paused</span><div class="logo disp">Paused</div>' + board(sc, cl, pc, "Q" + (PZ.q || 1)) +
      '<div id="pz" class="mlist">' + mi("pr", "▶", "Resume") + mi("prp", "⏪", "Instant replay") + mi("pse", "⚙", "Settings") +
      mi("pc", "🎥", "Camera", CAMN[SET.cm | 0]) + mi("pm", "🎯", "Meter", MN[SET.m | 0]) + mi("pt", "⏱", "Shooting", SET.s ? "Tempo" : "Hold &amp; release") +
      mi("prs", "↻", "Restart game") + mi("pq", "✕", "Quit to menu") + '</div><p class="hint">Esc / P / Start to resume</p></section>' +
      (bx ? '<section class="pzr panel"><h2 class="eyebrow">Box score</h2>' + bx + "</section>" : "") + "</div>", "pause");
    void o;
    $("#pr").onclick = resume;
    $("#pse").onclick = function () { openSettings("gameplay", function () { pause(null, "#pse"); }); };
    $("#pc").onclick = function () { setK("cm", ((SET.cm | 0) + 1) % 4); pause(null, "#pc"); };
    $("#pm").onclick = function () { setK("m", ((SET.m | 0) + 1) % 4); pause(null, "#pm"); };
    $("#pt").onclick = function () { setK("s", SET.s ? 0 : 1); pause(null, "#pt"); };
    $("#prp").onclick = function () { send({ cmd: "replay" }); play(); };
    $("#prs").onclick = function () { send({ cmd: "rematch" }); play(); };
    $("#pq").onclick = function () { send({ cmd: "quit" }); menu(); };
    focusFirst(focusSel || "#pr");
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
  function qtrTable(F) {
    var qs = F.qs || [], sc = F.sc || [0, 0], cl = F.cl || ["", ""], cols = [], prev = [0, 0];
    qs.forEach(function (c) { cols.push([c[0] - prev[0], c[1] - prev[1]]); prev = c; });
    if (!qs.length) return "";
    cols.push([sc[0] - prev[0], sc[1] - prev[1]]);
    var hd = cols.map(function (_, i) { return "<th>" + (i < 4 ? "Q" + (i + 1) : "OT" + (i - 3)) + "</th>"; }).join("");
    var row = function (t) { return "<tr><td>" + esc(cl[t]) + "</td>" + cols.map(function (c) { return "<td>" + c[t] + "</td>"; }).join("") + "<td><b>" + sc[t] + "</b></td></tr>"; };
    return '<table class="bx qtr"><tr><th></th>' + hd + "<th>T</th></tr>" + row(0) + row(1) + "</table>";
  }
  /** Hollinger game score from the box score (browser twin: game.ts gmSc). */
  function gmSc(p) {
    var orb = p.orb || 0;
    return (p.pts || 0) + 0.4 * (p.fgm || 0) - 0.7 * (p.fga || 0) + 0.7 * orb + 0.3 * ((p.reb || 0) - orb) + 0.7 * (p.ast || 0) + 0.7 * (p.blk || 0) - 0.4 * (p.pf || 0) + 0.5 * (p.hus || 0);
  }
  function lineTag(s) {
    var n = [s.pts, s.reb, s.ast, s.blk].filter(function (v) { return v >= 10; }).length;
    return n >= 3 ? "TRIPLE-DOUBLE" : n === 2 ? "DOUBLE-DOUBLE" : s.pts >= 30 ? s.pts + "-POINT NIGHT" : s.fga >= 5 && s.fgm === s.fga ? "PERFECT FROM THE FIELD" : "";
  }
  function final(F) {
    scr = "final";
    playing(false);
    var sc = F.sc || [0, 0], cl = F.cl || ["", ""], pc = F.pc || ["#7b3fb5", "#1d428a"], box = F.box || [[], []], xs = F.xs || { paint: [0, 0], fb: [0, 0], sec: [0, 0] };
    var me = F.me | 0, w = sc[me] > sc[1 - me], game = F.gm === "game";
    var sum = function (t, k) { return (box[t] || []).reduce(function (a, p) { return a + (p[k] || 0); }, 0); };
    var pct = function (m, a) { return a ? Math.round((100 * m) / a) : 0; };
    if (game && !F.online) {
      var r0 = rec.get();
      if (w) { r0.w++; r0.st = Math.max(1, r0.st + 1); r0.best = Math.max(r0.best, r0.st); }
      else { r0.l++; r0.st = 0; }
      rec.put(r0);
    }
    if (last && last.mode === "clutch" && w) { var cc = lsGet("h2k_cc", {}); cc[last.arg] = 1; lsPut("h2k_cc", cc); }
    // player of the game: best game score (Hollinger) on the winners, unless a loser had a monster night (10+ better)
    var wt = sc[0] >= sc[1] ? 0 : 1, val = gmSc;
    var best = function (t) { return (box[t] || []).slice().sort(function (a, b) { return val(b) - val(a); })[0]; };
    var pw = best(wt), pl2 = best(1 - wt), pog = pw && pl2 && val(pl2) >= val(pw) + 10 ? pl2 : pw, pogTag = pog ? lineTag(pog) : "";
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
    var r = rec.get(), title = !game ? "FINAL" : w ? "VICTORY" : "DEFEAT";
    var charts = shotChart(F, 0) + shotChart(F, 1);
    var pogCard = "";
    if (pog) {
      var pt = BYNAME[pog.n], bd = pt ? pt[14] || [] : [], fg = pog.fga ? Math.round((100 * pog.fgm) / pog.fga) + "% FG" : "";
      pogCard = '<section class="pog panel" tabindex="0"' + (pt ? ' data-pn="' + esc(pog.n) + '" data-col="' + pc[wt] + '"' : "") + ' style="--c:' + pc[wt] + '"><img alt="" src="' + avatar([pog.n, 0, 0, 0, 0, 0, 0, pog.sk, pog.hr, pog.bd, 0, 0, pog.no], pog.col || pc[wt]) + '"><div class="pgb"><small class="eyebrow">PLAYER OF THE GAME' + (pogTag ? " · " + pogTag : "") + '</small><b class="disp">' + esc(pog.n) + "</b>" +
        '<div class="pgs"><span><b>' + pog.pts + "</b>PTS</span><span><b>" + pog.reb + "</b>REB</span><span><b>" + pog.ast + "</b>AST</span>" + (pog.blk ? "<span><b>" + pog.blk + "</b>BLK</span>" : "") + "</div>" +
        '<small class="pgl">' + pog.fgm + "-" + pog.fga + (fg ? " · " + fg : "") + " · " + pog.tpm + "-" + pog.tpa + " 3P" + (bd.length ? " · " + bd.map(function (b) { return D.BADGE[b] || b; }).join(" · ") : "") + "</small></div></section>";
    }
    var o = screen('<div class="fin' + (!game ? "" : w ? " won" : " lost") + '" style="--c0:' + pc[0] + ";--c1:" + pc[1] + '">' +
      '<header class="fhead"><span class="eyebrow">Final' + (game ? " · record " + r.w + "-" + r.l + (r.st > 1 ? " · 🔥 " + r.st + " straight" : "") + (r.best > 1 ? " · best streak " + r.best : "") : "") + "</span>" +
      '<div class="logo disp">' + title + "</div>" + board(sc, cl, pc, "FINAL") + qtrTable(F) + "</header>" +
      '<div class="fgrid"><div class="fcol">' + pogCard +
      '<section class="panel"><h2 class="eyebrow">Team stats</h2><div class="cmp">' + rows.map(function (x) {
        var t = x[1] + x[2] || 1;
        return '<div><em class="' + (x[1] > x[2] ? "w" : "") + '">' + x[1] + '</em><span><i style="--w:' + (100 * x[1]) / t + '%;background:var(--c0)"></i><i style="--w:' + (100 * x[2]) / t + '%;background:var(--c1)"></i></span><em class="' + (x[2] > x[1] ? "w" : "") + '">' + x[2] + "</em><small>" + x[0] + "</small></div>";
      }).join("") + "</div></section></div><div class=\"fcol\">" +
      (charts ? '<section class="panel"><h2 class="eyebrow">Shot charts</h2><div class="charts">' + charts + "</div></section>" : "") +
      '<section class="bxw panel"><h3 class="eyebrow">Box score</h3>' + boxTable(F, 0) + boxTable(F, 1) + "</section></div></div>" +
      '<div class="row actions"><button type="button" class="btn pri lg" id="rm">↻ Rematch</button><button type="button" id="pa" class="btn">Change teams</button><button type="button" id="ph" class="btn ghost">Main menu</button></div></div>', "final");
    $("#rm").onclick = function () { send({ cmd: "rematch" }); play(); };
    $("#pa").onclick = function () { send({ cmd: "quit" }); menu(); };
    $("#ph").onclick = function () { send({ cmd: "quit" }); scr = "menu"; toHub(); };
    bindCards(o);
    focusFirst("#rm");
  }

  // ---------------- Unity -> page ----------------
  function show(screenName, json) {
    var j = {};
    try { j = json ? (typeof json === "string" ? JSON.parse(json) : json) : {}; } catch (e) {}
    if (screenName === "ready") {
      ready = true;
      prog = 1;
      loadUi();
      flush();
      if (scr === "loading") play();
      else $$("#ov .ldm, #ov .ldb").forEach(function (e) { e.remove(); });
    } else if (screenName === "pause") {
      if (scr === "play") pause(j);
    } else if (screenName === "final") {
      if (scr === "play" || scr === "pause") { closeSettings(); final(j); }
    } else if (screenName === "menu") {
      if (scr === "play" || scr === "pause" || scr === "final" || scr === "online") { closeSettings(); menu(); }
    } else if (screenName === "play") {
      if (scr === "pause") play();
    }
  }

  // ---------------- keyboard / gamepad navigation ----------------
  /** Focusable controls of the top layer: settings > visible overlay > hub. */
  function layer() {
    if (navScope && !navScope.hidden) return navScope;
    var o = ov();
    if (scr !== "hub" && o && o.style.display !== "none") return o;
    return $("#hub");
  }
  function focusables(root) {
    return $$('button, [tabindex="0"], input, select, a[href]', root).filter(function (e) {
      if (e.disabled) return false;
      var r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    });
  }
  /** Spatial navigation: the nearest control in the arrow's direction (distance along it + 2x the sideways offset). */
  function nav(dx, dy) {
    var root = layer(), list = focusables(root);
    if (!list.length) return;
    var cur = document.activeElement;
    if (!cur || list.indexOf(cur) < 0) return list[0].focus();
    var a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2, best = null, bs = 1e9;
    list.forEach(function (e) {
      if (e === cur) return;
      var r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var along = (x - ax) * dx + (y - ay) * dy, side = Math.abs((x - ax) * dy) + Math.abs((y - ay) * dx);
      // must lie ahead: beyond the current control's edge in that direction
      var edge = dx ? (dx > 0 ? r.left >= a.right - 4 : r.right <= a.left + 4) : dy > 0 ? r.top >= a.bottom - 4 : r.bottom <= a.top + 4;
      if (!edge || along <= 0) return;
      var s = along + side * 2;
      if (s < bs) { bs = s; best = e; }
    });
    if (best) {
      best.focus();
      if (best.scrollIntoView) best.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function back() {
    if (cardFor) return closeCard();
    if (navScope && !navScope.hidden) return closeSettings();
    if (scr === "pause") return resume();
    if (scr === "clutch") return menu();
    if (scr === "menu") return toHub();
    if (scr === "final") { send({ cmd: "quit" }); return menu(); }
    if (scr === "hub" && $("#play").hidden) return hubTab("play");
  }
  function primary() {
    if (scr === "menu" && !(navScope && !navScope.hidden)) return start("game");
    if (scr === "pause") return resume();
  }
  var typing = function (e) { return e && e.closest && e.closest('input:not([type="range"]),select,textarea'); };
  addEventListener("keydown", function (e) {
    if (scr === "play") {
      // Unity reads the keys (captureAllKeyboardInput off so the page's inputs work): just keep the page still
      if (/^(Arrow|Space)/.test(e.code) && !typing(e.target)) e.preventDefault();
      // Unity only hears keys while its canvas has focus: if the focus went elsewhere, Esc / P still pause
      // (PageBridge ignores a second pause; the page waits for Unity's HoopsUi_Show("pause") with the box score)
      if ((e.code === "Escape" || e.code === "KeyP") && document.activeElement !== $("#unity-canvas")) { send({ cmd: "pause" }); e.preventDefault(); }
      return;
    }
    if (typing(e.target) && e.code !== "Escape") return;
    var range = e.target && e.target.type === "range";
    switch (e.code) {
      case "ArrowLeft": if (range) return; nav(-1, 0); break;
      case "ArrowRight": if (range) return; nav(1, 0); break;
      case "ArrowUp": nav(0, -1); break;
      case "ArrowDown": nav(0, 1); break;
      case "Escape": case "Backspace": back(); break;
      case "KeyP": if (scr !== "pause") return; resume(); break;
      case "Enter": case "NumpadEnter":
        if (e.target && e.target.matches && e.target.matches("button, [data-pn]")) { if (e.target.dataset.pn) openCard(e.target); return; }
        primary(); break;
      case "KeyQ": case "KeyE": case "KeyZ": case "KeyC":
        if (scr !== "menu" || (navScope && !navScope.hidden)) return;
        cyc(e.code === "KeyQ" || e.code === "KeyE" ? "y" : "o", e.code === "KeyQ" || e.code === "KeyZ" ? -1 : 1); break;
      default: return;
    }
    e.preventDefault();
  });
  // gamepad: d-pad / left stick = arrows, A = select, B = back, Start = resume, LB/RB your team, LT/RT opponent
  // (while playing Unity owns the pad; getGamepads can throw in sandboxed iframes - permissions policy)
  var GP = { held: {}, rep: 0 };
  function padTick(t) {
    requestAnimationFrame(padTick);
    if (scr === "play" || document.hidden) return;
    var pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { return; }
    var g = null;
    for (var i = 0; pads && i < pads.length; i++) if (pads[i] && pads[i].connected !== false) { g = pads[i]; break; }
    if (!g) return;
    var b = function (k) { return !!(g.buttons[k] && (g.buttons[k].pressed || g.buttons[k].value > 0.5)); };
    var ax = g.axes[0] || 0, ay = g.axes[1] || 0;
    var dir = b(14) || ax < -0.6 ? "L" : b(15) || ax > 0.6 ? "R" : b(12) || ay < -0.6 ? "U" : b(13) || ay > 0.6 ? "D" : "";
    var press = function (k, v) { var was = GP.held[k]; GP.held[k] = v; return v && !was; };
    if (dir) {
      if (press("dir" + dir, true) || t > GP.rep) {
        GP.rep = t + (GP.held.dirRep ? 120 : 380);
        GP.held.dirRep = true;
        nav(dir === "L" ? -1 : dir === "R" ? 1 : 0, dir === "U" ? -1 : dir === "D" ? 1 : 0);
      }
    } else { GP.held.dirRep = false; ["L", "R", "U", "D"].forEach(function (d) { GP.held["dir" + d] = false; }); }
    if (press("a", b(0))) { var f = document.activeElement; if (f && f !== document.body && f.click) { if (f.dataset && f.dataset.pn) openCard(f); else f.click(); } else primary(); }
    if (press("b", b(1))) back();
    if (press("st", b(9)) && scr === "pause") resume();
    if (scr === "menu" && !(navScope && !navScope.hidden)) {
      if (press("lb", b(4))) cyc("y", -1);
      if (press("rb", b(5))) cyc("y", 1);
      if (press("lt", b(6))) cyc("o", -1);
      if (press("rt", b(7))) cyc("o", 1);
    }
  }
  requestAnimationFrame(padTick);

  addEventListener("blur", function () { if (scr === "play") send({ cmd: "pause" }); });
  addEventListener("resize", closeCard);
  $("#bk").onclick = toHub;
  hubInit();
  loadUi();

  window.H2KUI = {
    boot: boot,
    fail: fail,
    show: show,
    /** test / debug readout */
    state: function () { return { scr: scr, ready: ready, NP0: NP0, NP: NP, SEL: SEL, OPP: OPP, queued: Q.length, settings: !!(navScope && !navScope.hidden), tab: setTab }; },
  };
})();
