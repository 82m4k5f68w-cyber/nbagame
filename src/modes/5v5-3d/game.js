const $ = (s) => document.querySelector(s),
  C = $("#c"),
  X = $("#h").getContext("2d"),
  ov = $("#ov");
function fatal(m) {
  ov.style.display = "flex";
  ov.innerHTML =
    '<h1>HOOPS 2K27</h1><p style="color:#ff9966;max-width:560px">' + m + "</p>";
}
let ERR = 0;
window.onerror = (m, u, l) => {
  if (!ERR && !/gamepad|permission/i.test(String(m))) {
    ERR = 1;
    fatal("Error: " + m + " (line " + l + ")");
  }
};
const CW = 940,
  CH = 500,
  g = 320,
  HXs = [52.5, 887.5],
  HY = 250,
  RR = 7.5,
  BR = 3.9;
const hoop = (t) => (t ? HXs[0] : HXs[1]),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  pr = (x, y, z = 0) => {
    const w = W3(x, y, z);
    if (typeof GL !== "undefined" && GL && GL.proj)
      return GL.proj(w[0], w[1], w[2]);
    const q = pj(w[0], w[1], w[2]);
    return [q[0], q[1]];
  };
// [name, three, inside, speed, defense, jump, style 0 norm/1 quick/2 fadeaway/3 stepback/4 touch]
const TM = [
  [
    "Lakers",
    "#7b3fb5",
    [
      ["Doncic", 93, 86, 76, 50, 50, 3, "#e8b88f", 2, 1, 6.6, 1.3, 77],
      ["Reaves", 84, 76, 78, 70, 45, 0, "#e8b88f", 1, 0, 6.5, 1, 15],
      ["LaRavia", 78, 70, 72, 72, 50, 0, "#e8b88f", 1, 0, 6.8, 1.05, 12],
      ["Mamukelashvili", 70, 76, 64, 70, 48, 0, "#e8b88f", 1, 1, 6.9, 1.2, 25],
      ["Kessler", 20, 80, 60, 92, 55, 4, "#e8b88f", 1, 0, 7, 1.05, 24],
    ],
  ],
  [
    "Warriors",
    "#1d428a",
    [
      ["Curry", 99, 80, 82, 60, 40, 1, "#b9825a", 1, 0, 6.2, 0.9, 30],
      ["Podziemski", 78, 66, 80, 72, 48, 0, "#e8b88f", 1, 0, 6.4, 0.95, 2],
      ["Lendeborg", 66, 76, 74, 72, 55, 0, "#8d5524", 1, 0, 6.9, 1.1, 5],
      ["Green", 58, 70, 70, 90, 45, 0, "#6b4226", 1, 1, 6.5, 1.25, 23],
      ["Porzingis", 80, 82, 52, 84, 50, 2, "#e8b88f", 1, 0, 7.2, 1, 7],
    ],
  ],
  [
    "Nuggets",
    "#0e2240",
    [
      ["Murray", 88, 84, 84, 60, 50, 0, "#8d5524", 1, 0, 6.4, 1, 27],
      ["Braun", 72, 82, 82, 70, 60, 0, "#8d5524", 1, 0, 6.6, 1.05, 0],
      ["Johnson", 82, 72, 70, 60, 50, 0, "#e8b88f", 1, 0, 6.8, 1.05, 3],
      ["Gordon", 62, 88, 76, 76, 70, 0, "#c68642", 1, 0, 6.8, 1.2, 32],
      ["Jokic", 82, 96, 52, 70, 40, 4, "#e8b88f", 2, 1, 6.9, 1.4, 15],
    ],
  ],
  [
    "Thunder",
    "#007ac1",
    [
      ["Gilgeous-Alexander", 86, 94, 88, 82, 55, 2, "#6b4226", 1, 0, 6.6, 1, 2],
      ["Wallace", 74, 72, 84, 86, 55, 0, "#6b4226", 1, 0, 6.4, 0.95, 22],
      ["J. Williams", 78, 82, 80, 74, 55, 0, "#6b4226", 1, 0, 6.6, 1, 8],
      ["Holmgren", 80, 86, 70, 90, 62, 2, "#e8b88f", 1, 0, 7.1, 0.85, 7],
      ["Hartenstein", 30, 78, 56, 84, 50, 4, "#e8b88f", 2, 0, 7, 1.2, 55],
    ],
  ],
  [
    "Spurs",
    "#6b7078",
    [
      ["Fox", 82, 86, 94, 66, 55, 0, "#8d5524", 1, 0, 6.3, 0.95, 4],
      ["Castle", 70, 80, 84, 78, 60, 0, "#6b4226", 1, 0, 6.6, 1.05, 5],
      ["Vassell", 82, 74, 76, 66, 52, 2, "#6b4226", 1, 0, 6.6, 1, 24],
      ["Champagnie", 78, 70, 72, 72, 50, 0, "#6b4226", 1, 0, 6.6, 1, 30],
      ["Wembanyama", 82, 92, 66, 98, 58, 2, "#6b4226", 1, 0, 7.4, 0.85, 1],
    ],
  ],
  [
    "Timberwolves",
    "#236192",
    [
      ["LaMelo Ball", 88, 84, 82, 56, 52, 3, "#8d5524", 3, 0, 6.6, 0.95, 1],
      ["Edwards", 86, 92, 95, 76, 85, 3, "#6b4226", 1, 1, 6.4, 1.2, 5],
      ["McDaniels", 70, 74, 80, 84, 55, 0, "#8d5524", 1, 0, 6.9, 0.95, 3],
      ["Kuminga", 60, 86, 86, 72, 78, 0, "#8d5524", 1, 0, 6.7, 1.1, 9],
      ["Gobert", 20, 86, 52, 95, 50, 4, "#8d5524", 0, 1, 7.1, 1.15, 27],
    ],
  ],
  [
    "Knicks",
    "#006bb6",
    [
      ["Brunson", 84, 86, 80, 60, 45, 0, "#8d5524", 1, 0, 6.2, 1, 11],
      ["Hart", 60, 70, 76, 86, 55, 0, "#8d5524", 1, 0, 6.5, 1.1, 3],
      ["Bridges", 80, 78, 78, 88, 55, 0, "#8d5524", 1, 0, 6.6, 1, 25],
      ["Anunoby", 78, 72, 76, 90, 60, 0, "#8d5524", 1, 0, 6.7, 1.1, 8],
      ["Towns", 84, 88, 60, 70, 45, 2, "#c68642", 1, 1, 7, 1.2, 32],
    ],
  ],
];
const SK = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#6b4226"],
  SP = [
    [250, 250],
    [190, 110],
    [190, 390],
    [75, 40],
    [95, 250],
  ];
let S = "menu",
  P = [],
  B = {},
  sc = [0, 0],
  q = 1,
  clock = 60,
  shot = 24,
  pos = 0,
  ap = 0,
  T = 0,
  TX = [],
  rs = 0,
  pend = 0,
  fin = 0,
  AC,
  lastO = null,
  cl = null;
const MN = ["Arrow 2", "Bar (feet)", "Bar (head)", "Ring"],
  NP = 5,
  K = {},
  ev = {};
let MP2 = window.__MP ? 1 : 0,
  ap2 = 0,
  lastO2 = null,
  H2 = null,
  ev2 = {},
  QL = matchMedia("(pointer:coarse)").matches ? 1 : 2,
  PCNT = [0, 0],
  LASTP = [-9, -9],
  MYM = window.__MY ? 1 : 0,
  PRO = 1,
  DT = 0.016,
  fc = 0,
  METER = 0,
  TEMPO = 0,
  ftq = null,
  tf = [0, 0],
  inb = 0;
const OV = {
    Curry: 97,
    Doncic: 97,
    Jokic: 99,
    "Gilgeous-Alexander": 98,
    Wembanyama: 98,
    Edwards: 93,
    Brunson: 93,
    Towns: 90,
    Fox: 91,
    Murray: 90,
    "LaMelo Ball": 90,
    Reaves: 85,
    Kessler: 82,
    Gobert: 84,
    Green: 80,
    Porzingis: 86,
    Hart: 82,
    Bridges: 84,
    Anunoby: 85,
    Castle: 84,
    Holmgren: 90,
    "J. Williams": 87,
    McDaniels: 83,
    Kuminga: 82,
    Vassell: 82,
  },
  ovr = (p) => OV[p.n] || Math.round(68 + (Math.max(p.c, p.i) - 75) * 0.4);
function snd(f, d, ty = "sine", v = 0.07) {
  try {
    AC = AC || new AudioContext();
    const o = AC.createOscillator(),
      gn = AC.createGain();
    o.type = ty;
    o.frequency.value = f;
    gn.gain.value = v;
    gn.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
    o.connect(gn);
    gn.connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + d);
  } catch (e) {}
}
const txt = (s, x, y, c = "#fff") => TX.push({ s, x, y, t: 1.2, c });
let SEL = 0;
const ov2 = (p) => OV[p[0]] || ovr({ c: p[1], i: p[2] }),
  ALL = TM.flatMap((t, ti) => t[2].map((a) => ({ t: ti, a }))),
  RO = (i) =>
    NP > 1
      ? [TM[i][1], TM[i][2], TM[i][0]]
      : [TM[ALL[i].t][1], [ALL[i].a], ALL[i].a[0]];
const MYP = {
  d: {
    n: "MY PLAYER",
    c: 80,
    i: 78,
    s: 80,
    d: 72,
    j: 60,
    st: 0,
    sk: "#c68642",
    hr: 1,
    bd: 0,
    ht: 6.6,
    bk: 1,
    no: 1,
    col: "#e8541e",
  },
};
try {
  Object.assign(MYP.d, JSON.parse(localStorage.getItem("h2k_myp") || "{}"));
} catch (e) {}
const mkT = () => {
  const d = MYP.d;
  MYP.t = [
    d.n,
    d.c,
    d.i,
    d.s,
    d.d,
    d.j,
    d.st,
    d.sk,
    d.hr,
    d.bd,
    d.ht,
    d.bk,
    d.no,
  ];
};
mkT();
const PRE = {
  Sharpshooter: [92, 70, 78, 62, 60, 1],
  Slasher: [72, 92, 90, 65, 78, 0],
  Playmaker: [82, 76, 88, 68, 60, 3],
  "Two-Way": [78, 78, 80, 88, 65, 0],
  Big: [52, 92, 60, 90, 70, 4],
};
function RS(ti, t) {
  if (MYM && t === 0) {
    if (NP === 1) return [MYP.d.col, [MYP.t], MYP.t[0]];
    const b = RO(ti);
    let w = 0;
    b[1].forEach((a, k) => {
      if (ov2(a) < ov2(b[1][w])) w = k;
    });
    return [b[0], [MYP.t, ...b[1].filter((a, k) => k !== w)], b[2]];
  }
  if (MYM && t === 1 && NP === 1) return RO(SEL);
  return RO(ti);
}
function edMy() {
  const d = MYP.d,
    SKN = ["#f1c27d", "#c68642", "#8d5524", "#6b4226", "#e8b88f"],
    CAP = 380,
    ST = ["Standard", "Quick", "Fadeaway", "Step-back", "Touch"],
    HR = ["Bald", "Short", "Long", "Afro"],
    re = () => {
      d.n = $("#mn").value || d.n;
      edMy();
    };
  const sl = (k, l) =>
    `<label>${l} <b id="v${k}">${d[k]}</b><input type="range" min="40" max="99" value="${d[k]}" data-k="${k}"></label>`;
  ov.innerHTML = `<div class="logo" style="font-size:34px">MY PLAYER</div><div class="opts"><input id="mn" maxlength="12" value="${d.n}"><b>ARCHETYPE</b>${Object.keys(
    PRE,
  )
    .map((k) => `<button data-pre="${k}">${k}</button>`)
    .join(
      "",
    )}</div><div class="opts ed">${sl("c", "3PT")}${sl("i", "INSIDE")}${sl("s", "SPEED")}${sl("d", "DEFENSE")}${sl("j", "JUMP")}<div id="pts"></div></div>
<div class="opts"><b>SHOT FORM</b>${ST.map((n, i) => `<button data-st="${i}" class="${d.st === i ? "on" : ""}">${n}</button>`).join("")}<b>LOOK</b>${SKN.map((c) => `<button data-sk="${c}" style="background:${c};width:34px;height:34px;padding:0;${d.sk === c ? "outline:3px solid #ffd23f" : ""}"></button>`).join("")}${HR.map((n, i) => `<button data-hr="${i}" class="${d.hr === i ? "on" : ""}">${n}</button>`).join("")}<button data-bd="1" class="${d.bd ? "on" : ""}">Beard</button>
<label>Height <b id="vh">${d.ht.toFixed(1)}</b> ft<input type="range" min="6" max="7.3" step=".1" value="${d.ht}" data-h="ht"></label><label>Build<input type="range" min=".9" max="1.3" step=".05" value="${d.bk}" data-h="bk"></label><label>Number<input id="mno" type="number" min="0" max="99" value="${d.no}"></label></div><button class="big" id="done">SAVE ▶</button>`;
  const up = () => {
    $("#pts").textContent =
      "Points " +
      (CAP - (d.c + d.i + d.s + d.d + d.j)) +
      " left · OVR " +
      ovr({ n: "x", c: d.c, i: d.i });
  };
  up();
  ov.querySelectorAll("input[data-k]").forEach(
    (e) =>
      (e.oninput = () => {
        const k = e.dataset.k;
        let v = +e.value;
        const o = d.c + d.i + d.s + d.d + d.j - d[k];
        if (o + v > CAP) v = CAP - o;
        d[k] = v;
        e.value = v;
        $("#v" + k).textContent = v;
        up();
      }),
  );
  ov.querySelectorAll("[data-pre]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = PRE[b.dataset.pre];
        [d.c, d.i, d.s, d.d, d.j, d.st] = a;
        re();
      }),
  );
  ov.querySelectorAll("[data-st]").forEach(
    (b) =>
      (b.onclick = () => {
        d.st = +b.dataset.st;
        re();
      }),
  );
  ov.querySelectorAll("[data-sk]").forEach(
    (b) =>
      (b.onclick = () => {
        d.sk = b.dataset.sk;
        re();
      }),
  );
  ov.querySelectorAll("[data-hr]").forEach(
    (b) =>
      (b.onclick = () => {
        d.hr = +b.dataset.hr;
        re();
      }),
  );
  ov.querySelector("[data-bd]").onclick = () => {
    d.bd = d.bd ? 0 : 1;
    re();
  };
  ov.querySelectorAll("[data-h]").forEach(
    (e) =>
      (e.oninput = () => {
        d[e.dataset.h] = +e.value;
        if (e.dataset.h === "ht") $("#vh").textContent = (+e.value).toFixed(1);
      }),
  );
  $("#done").onclick = () => {
    d.n = ($("#mn").value || "MY PLAYER").toUpperCase().slice(0, 12);
    d.no = +$("#mno").value || 0;
    mkT();
    try {
      localStorage.setItem("h2k_myp", JSON.stringify(d));
    } catch (e) {}
    menu();
  };
}
function menu() {
  S = "menu";
  ov.style.display = "flex";
  const N = NP > 1 ? TM.length : ALL.length,
    IT = [...Array(N).keys()].map((i) => {
      const r = RO(i);
      return {
        n: r[2],
        c: r[0],
        sub: NP > 1 ? r[1].map((p) => p[0]).join(" · ") : TM[ALL[i].t][0],
        o: Math.round(r[1].reduce((a, p) => a + ov2(p), 0) / r[1].length),
        pl: r[1],
      };
    });
  ov.style.setProperty("--tc", IT[SEL].c);
  ov.innerHTML = `<div class="ball">🏀</div><div class="logo">HOOPS<span>2K27</span></div><div class="sub">${NP > 1 ? "5v5 NBA GAME" : "1v1 SHOWDOWN — PICK YOUR STAR"} · PRO PHYSICS · TEMPO SHOOTING</div><div id="g">${IT.map((t, i) => `<button class="card${i === SEL ? " sel" : ""}" data-i="${i}" style="--i:${i % 12};--c:${t.c}"><i>${t.n.slice(0, 3).toUpperCase()}</i><b>${t.n}</b><small>${t.sub}</small><em>OVR ${t.o}</em></button>`).join("")}</div><div id="pv"></div><div class="opts"><b>PLAYERS</b><button data-mp="0" class="${MP2 ? "" : "on"}">1 Player</button><button data-mp="1" class="${MP2 ? "on" : ""}">2 Players (keyboard)</button><b>P2 = right team: arrows move · Enter shoot · / pass · . spin · , hesi · Right Shift sprint</b><b>PLAYER MODE</b><button data-my="0" class="${MYM ? "" : "on"}">Pick a team</button><button data-my="1" class="${MYM ? "on" : ""}">My Player</button><button id="edit">✎ Edit my player</button><b>SHOT METER</b>${MN.map((n, i) => `<button data-m="${i}" class="${i === METER ? "on" : ""}">${n}</button>`).join("")}<b>SHOOTING</b><button data-s="0" class="${TEMPO ? "" : "on"}">Hold &amp; release</button><button data-s="1" class="${TEMPO ? "on" : ""}">Tempo</button><b>CAMERA</b>${CAMN.map((n, i) => `<button data-cm="${i}" class="${CAMM === i ? "on" : ""}">${n}</button>`).join("")}<b>GRAPHICS</b><button data-q="0" class="${QL === 0 ? "on" : ""}">Low</button><button data-q="1" class="${QL === 1 ? "on" : ""}">Medium</button><button data-q="2" class="${QL === 2 ? "on" : ""}">High</button><b>PRO PLAY ENGINE</b><button data-p="1" class="${PRO ? "on" : ""}">On</button><button data-p="0" class="${PRO ? "" : "on"}">Off</button></div><button class="big" id="tip">TIP OFF ▶</button>`;
  const pv = () => {
    $("#pv").innerHTML =
      IT[SEL].pl
        .map(
          (p, k) =>
            `<div class="pl" style="--d:${k * 80}ms"><b>${p[0]}</b><span>${ov2(p)}</span><u style="--w:${p[1]}%"></u><u style="--w:${p[2]}%"></u><u style="--w:${p[3]}%"></u></div>`,
        )
        .join("") + '<p class="lg">bars: 3PT · INSIDE · SPEED</p>';
  };
  pv();
  ov.querySelectorAll(".card").forEach(
    (b) =>
      (b.onclick = () => {
        SEL = +b.dataset.i;
        ov.querySelectorAll(".card").forEach((c) =>
          c.classList.toggle("sel", c === b),
        );
        ov.style.setProperty("--tc", IT[SEL].c);
        pv();
      }),
  );
  $("#tip").onclick = () => start(SEL);
  ov.querySelectorAll("[data-m]").forEach(
    (b) =>
      (b.onclick = () => {
        METER = +b.dataset.m;
        ov.querySelectorAll("[data-m]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  ov.querySelectorAll("[data-s]").forEach(
    (b) =>
      (b.onclick = () => {
        TEMPO = +b.dataset.s;
        ov.querySelectorAll("[data-s]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  ov.querySelectorAll("[data-p]").forEach(
    (b) =>
      (b.onclick = () => {
        PRO = +b.dataset.p;
        ov.querySelectorAll("[data-p]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  ov.querySelectorAll("[data-cm]").forEach(
    (b) =>
      (b.onclick = () => {
        CAMM = +b.dataset.cm;
        ov.querySelectorAll("[data-cm]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  ov.querySelectorAll("[data-q]").forEach(
    (b) =>
      (b.onclick = () => {
        QL = +b.dataset.q;
        ov.querySelectorAll("[data-q]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  ov.querySelectorAll("[data-my]").forEach(
    (b) =>
      (b.onclick = () => {
        MYM = +b.dataset.my;
        ov.querySelectorAll("[data-my]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
  $("#edit").onclick = edMy;
  ov.querySelectorAll("[data-mp]").forEach(
    (b) =>
      (b.onclick = () => {
        MP2 = +b.dataset.mp;
        ov.querySelectorAll("[data-mp]").forEach((c) =>
          c.classList.toggle("on", c === b),
        );
      }),
  );
}
function start(i) {
  crowdInit();
  let j;
  do j = (Math.random() * (NP > 1 ? TM.length : ALL.length)) | 0;
  while (j === i);
  P = [];
  [i, j].forEach((ti, t) =>
    RS(ti, t)[1].forEach((a, k) =>
      P.push({
        n: a[0],
        c: a[1],
        i: a[2],
        s: a[3],
        d: a[4],
        j: a[5],
        st: a[6],
        tm: t,
        k,
        col: t && RS(ti, t)[0] === RS(i, 0)[0] ? "#b03a2e" : RS(ti, t)[0],
        skin: a[7],
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        f: 0,
        ph: 0,
        mode: "i",
        t: 0,
        cd: 0,
        rl: 0,
        mt: 0,
        ai: {},
        in: {},
        stt: { pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, blk: 0 },
        my: a === MYP.t,
        sg: SIG[a[0]] || {},
        slow: 0,
        sbw: 0,
        sv: 0,
        tp: null,
        pf: 0,
        bn: 1,
        bx: 0,
        by: 0,
        hr: a[8],
        bd: a[9],
        ht: a[10],
        bk: a[11],
        no: a[12],
      }),
    ),
  );
  PC = [RS(i, 0)[0], RS(j, 1)[0]];
  cl = [RS(i, 0)[2], RS(j, 1)[2]];
  sc = [0, 0];
  tf = [0, 0];
  ftq = null;
  inb = 0;
  q = 1;
  clock = 60;
  fin = 0;
  rs = 0;
  B = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    owner: null,
    mode: "held",
    sh: 0,
    sc: 0,
    last: null,
    age: 0,
    to: null,
    three: 0,
    a: 0,
  };
  setup(0);
  S = "play";
  ov.style.display = "none";
  snd(500, 0.2, "square");
}
function nearest(t, x, y, ex = -1) {
  let b = -1,
    bd = 1e9;
  for (let k = 0; k < NP; k++) {
    const p = P[t * NP + k],
      d = Math.hypot(p.x - x, p.y - y);
    if (t * NP + k !== ex && d < bd) {
      bd = d;
      b = t * NP + k;
    }
  }
  return b;
}
function setup(off) {
  const ah = hoop(off),
    own = hoop(1 - off),
    Y = [250, 90, 170, 330, 410];
  for (let k = 0; k < NP; k++) {
    const o = P[off * NP + k],
      e = P[(1 - off) * NP + k];
    o.x =
      k || NP === 1 ? own + (ah - own) * (k ? 0.3 : 0.12) : own < 470 ? 6 : 934;
    e.x = own + (ah - own) * 0.65;
    o.y = Y[k];
    e.y = Y[(k + 2) % 5];
  }
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    p.t = 0;
    p.ai = {};
    p.cd = 0;
  });
  B.owner = P[off * NP];
  B.mode = "held";
  B.sc = 0;
  B.sh = 0;
  B.last = null;
  pos = off;
  shot = 24;
  PCNT[0] = PCNT[1] = 0;
  ap = MYM ? 0 : off ? nearest(0, B.owner.x, B.owner.y) : 0;
  lastO = null;
  inb = 1.2;
  txt("INBOUND", 480, 230);
}
function pass(p, r, ty) {
  const sk = clamp((p.s + p.c) / 200, 0.4, 0.95);
  let near = 0;
  const ddx = r.x - B.x,
    ddy = r.y - B.y,
    l2 = ddx * ddx + ddy * ddy || 1;
  for (const q of P) {
    if (q.tm === p.tm) continue;
    const u = clamp(((q.x - B.x) * ddx + (q.y - B.y) * ddy) / l2, 0, 1);
    if (Math.hypot(B.x + ddx * u - q.x, B.y + ddy * u - q.y) < 20) near = 1;
  }
  if (ty == null)
    ty =
      Math.hypot(hoop(r.tm) - r.x, HY - r.y) < 110 && r.j >= 60 && near
        ? 2
        : near
          ? 1
          : 0;
  const spd = ty === 2 ? 380 : ty === 1 ? 460 : 560,
    zt = ty === 2 ? 100 : ty === 1 ? -20 : 62;
  let Tm = Math.max(0.15, Math.hypot(ddx, ddy) / spd),
    tx = r.x,
    tz = r.y;
  for (let n = 0; n < 3; n++) {
    tx = r.x + r.vx * Tm * 0.9;
    tz = r.y + r.vy * Tm * 0.9;
    Tm = Math.max(0.15, Math.hypot(tx - B.x, tz - B.y) / spd);
  }
  const dp = P[nearest(1 - p.tm, p.x, p.y)],
    press = Math.hypot(dp.x - p.x, dp.y - p.y) < 45 ? 0.2 : 0,
    er = (1 - sk + press) * Math.min(28, Math.hypot(ddx, ddy) * 0.08);
  tx += (Math.random() - 0.5) * 2 * er;
  tz += (Math.random() - 0.5) * 2 * er;
  if (ty === 2) Tm *= 1.25;
  B.owner = null;
  B.mode = "pass";
  B.ptype = ty;
  B.to = r;
  const bf = ty === 1 ? 1.07 : 1;
  B.vx = ((tx - B.x) / Tm) * bf;
  B.vy = ((tz - B.y) / Tm) * bf;
  B.vz = (zt - B.z + 0.5 * g * Tm * Tm) / Tm;
  B.age = 0;
  B.last = p;
  B.sh = 0;
  p.cd = 0.4;
  p.pT = 0.25;
  PCNT[p.tm]++;
  LASTP[p.tm] = T;
  B.pp = { p, t: T };
  snd(260, 0.05, "triangle");
}
function pick(p, i) {
  let b = null,
    bs = -9;
  for (const r of P) {
    if (r.tm !== p.tm || r === p) continue;
    const dx = r.x - p.x,
      dy = r.y - p.y,
      d = Math.hypot(dx, dy) || 1,
      m = Math.hypot(i.dx, i.dy);
    const al =
        m > 0.1
          ? (dx * i.dx + dy * i.dy) / d / m
          : (Math.cos(p.f) * dx + Math.sin(p.f) * dy) / d,
      s =
        al * 2 -
        d / 1500 +
        (Math.min(
          80,
          Math.hypot(
            P[nearest(1 - p.tm, r.x, r.y)].x - r.x,
            P[nearest(1 - p.tm, r.x, r.y)].y - r.y,
          ),
        ) /
          80) *
          0.12 -
        (al < 0.3 ? 1.5 : 0);
    if (s > bs) {
      bs = s;
      b = r;
    }
  }
  return b;
}
function launch(p) {
  p.rl = 1;
  const H = typeof GL !== "undefined" && GL && GL.hand ? GL.hand(p) : null,
    HK = H && H[2] > 40 && H[2] < 170,
    hx = hoop(p.tm),
    x0 = HK ? H[0] : p.x,
    y0 = HK ? H[1] : p.y,
    z0 = HK ? H[2] : p.z + 66 + (p.st === 2 ? 6 : 0),
    D0 = Math.hypot(hx - x0, HY - y0),
    three = D0 >= 237,
    lay = D0 < 90 || !!p.hk,
    isFT = !!ftq;
  if (isFT) {
    B.ft = 1;
    ftq.fired = 1;
    if (ftq.i + 1 >= ftq.n && !ftq.tech) ftq = null;
  } else B.ft = 0;
  let b =
    D0 < 90 || p.hk
      ? (p.i / 100) * (p.hk ? 0.72 : 0.8)
      : D0 < 237
        ? ((p.c * 0.5 + p.i * 0.5) / 100) * 0.58
        : (p.c / 100) * 0.5;
  let ct = 0,
    blk = null;
  for (const o of P) {
    if (o.tm === p.tm) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < 60) {
      const c2 = (1 - d / 60) * (o.z > 8 ? 1.5 : 1);
      if (c2 > ct) {
        ct = c2;
        blk = o;
      }
    }
  }
  b -= Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1)) * 0.3;
  if (p.sbw > 0) b += 0.06;
  const cx =
      isH(p) && p.cw != null
        ? p.cw
        : Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1) + (p.bmp || 0) * 0.5),
    rat =
      (isFT
        ? p.c * 0.8 + 15
        : D0 < 90
          ? p.i
          : D0 < 237
            ? (p.c + p.i) / 2
            : p.c) +
      (p.heat || 0) * 2,
    win =
      (0.07 + (rat / 100) * 0.05) *
      (1 - 0.45 * cx) *
      (0.85 + 0.15 * (p.en == null ? 1 : p.en)),
    rT = lay ? 0.28 : p.st === 1 ? 0.3 : 0.4;
  let gr;
  if (isH(p) && cx > 0.45 && !lay)
    txt("CONTESTED", ...pr(p.x, p.y, 108), "#ff6b6b");
  if (isH(p)) {
    const wt = win * (TEMPO ? 1.2 : 1),
      wmt = (0.07 + (rat / 100) * 0.05) * (TEMPO ? 1.2 : 1),
      cen = (TEMPO ? rT : p.st === 1 ? 0.45 : 0.6) + (wmt - wt),
      er = TEMPO
        ? Math.abs((p.tp == null ? 9 : p.tp) - cen)
        : Math.abs(p.mt - cen);
    {
      const tt = TEMPO ? (p.tp == null ? 9 : p.tp) : p.mt;
      gr = tt >= cen - wt && tt <= cen + wt + 0.03;
    }
    if (!gr && !lay)
      txt(
        TEMPO && p.tp == null
          ? "NO TEMPO"
          : (TEMPO ? p.tp > cen : p.mt > cen)
            ? "LATE"
            : "EARLY",
        ...pr(p.x, p.y, 95),
        "#ff9966",
      );
  } else
    gr =
      Math.random() <
      clamp(
        (rat / 100) * 0.75 + 0.1 - cx * 0.45 + (p.sbw > 0 ? 0.1 : 0),
        0.05,
        0.95,
      );
  B.owner = null;
  B.mode = "air";
  B.sh = 1;
  B.sc = 0;
  B.last = p;
  B.age = 0;
  B.three = three;
  B.to = null;
  if (!isFT) {
    p.stt.fga++;
    if (three) p.stt.tpa++;
  }
  B.x = x0;
  B.y = y0;
  B.z = z0;
  B.fl = 0;
  B.dk = 0;
  B.gn = 0;
  B.wv = [0, 0, 0];
  if (p.sv === 6 && Math.random() < 0.9) {
    B.dk = 1;
    B.x = hx;
    B.y = HY;
    B.z = 116;
    B.vx = B.vy = 0;
    B.vz = -130;
    B.three = 0;
    txt("DUNK!", ...pr(hx, HY, 125), "#ffd23f");
    snd(150, 0.2, "square", 0.12);
    return;
  }
  if (
    blk &&
    blk.z > 10 &&
    Math.hypot(blk.x - p.x, blk.y - p.y) < 24 &&
    Math.random() < 0.08 + (ct * 0.3 * blk.d) / 100
  ) {
    B.vx = (p.x - blk.x) * 8 + (Math.random() - 0.5) * 80;
    B.vy = (Math.random() - 0.5) * 120;
    B.vz = 60;
    B.sh = 0;
    blk.stt.blk++;
    EXC = 0.9;
    txt("BLOCKED!", ...pr(blk.x, blk.y, 80), "#ff6b4a");
    snd(150, 0.15, "square");
    if (Math.random() < 0.12) tech(blk, p.tm);
    return;
  }
  const mk = lay
      ? Math.random() < clamp(b + (gr ? 0.15 : 0), 0.03, 0.97)
      : gr && Math.random() < 0.98 - cx * 0.25,
    a = Math.random() * 6.28,
    off = mk ? (RAP ? 0.3 : 1.2) : 9 + Math.random() * 7,
    tx = hx + Math.cos(a) * off,
    ty = HY + Math.sin(a) * off,
    dx = tx - x0,
    dy = ty - y0,
    D = Math.hypot(dx, dy) || 1,
    dz = 100 - z0;
  const fd =
    !lay &&
    !isFT &&
    blk &&
    Math.hypot(blk.x - p.x, blk.y - p.y) < 24 &&
    blk.z > 3 &&
    Math.random() < 0.1
      ? blk
      : null;
  if (fd && !mk) {
    B.owner = p;
    B.mode = "held";
    B.sh = 0;
    foul(fd, p, "SHOOTING", 1, three);
    return;
  }
  if (fd) B.fl = 1;
  let th =
    D < 90 ? 1.15 : D < 200 ? 1.0 : D < 300 ? 0.92 : D < 400 ? 1.02 : 1.1;
  for (let k = 0; k < 8 && D * Math.tan(th) - dz < 8 && th < 1.45; k++)
    th += 0.08;
  let ge = g,
    v = Math.sqrt(
      (ge * D * D) /
        (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)),
    );
  if (RAP) {
    ge = g - 0.0032 * 16 * v * Math.cos(th);
    v = Math.sqrt(
      (ge * D * D) /
        (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)),
    );
  }
  B.vz = v * Math.sin(th);
  const TF = (B.vz + Math.sqrt(B.vz * B.vz + 2 * ge * (z0 - 100))) / ge,
    hv = (D * 0.1) / (1 - Math.exp(-0.1 * TF));
  B.vx = (hv * dx) / D;
  B.vy = (hv * dy) / D;
  {
    const h3 = Math.hypot(B.vx, B.vy) || 1;
    B.wv = [(16 * B.vy) / h3, (-16 * B.vx) / h3, 0];
  }
  if (RAP) {
    for (let it = 0; it < 6; it++) {
      let x = x0,
        y = y0,
        z = z0,
        vx = B.vx,
        vy = B.vy,
        vz = B.vz,
        T2 = 0;
      const W = B.wv;
      while (T2 < 4) {
        vx *= 1 - 0.0004;
        vy *= 1 - 0.0004;
        vz += (0.0032 * (W[0] * vy - W[1] * vx) - g) * 0.004;
        const qz = z;
        x += vx * 0.004;
        y += vy * 0.004;
        z += vz * 0.004;
        T2 += 0.004;
        if (qz >= 100 && z < 100 && vz < 0) break;
      }
      B.vx += ((tx - x) / Math.max(0.2, T2)) * 0.9;
      B.vy += ((ty - y) / Math.max(0.2, T2)) * 0.9;
      const h4 = Math.hypot(B.vx, B.vy) || 1;
      B.wv = [(16 * B.vy) / h4, (-16 * B.vx) / h4, 0];
    }
  }
  B.gn = gr;
  if (gr && isH(p)) txt("GREEN!", ...pr(p.x, p.y, 95), "#2ecc71");
  snd(380, 0.07, "triangle");
}
function step(p, dt) {
  const i = p.in,
    has = B.owner === p,
    oh = hoop(p.tm),
    ux = oh - p.x,
    uy = HY - p.y,
    D = Math.hypot(ux, uy) || 1;
  p.cd -= dt;
  p.slow -= dt;
  p.sbw -= dt;
  p.pT = (p.pT || 0) - dt;
  p.bmp = Math.max(0, (p.bmp || 0) - dt * 1.5);
  p.scr = Math.max(0, (p.scr || 0) - dt);
  p.setT = (p.setT || 0) - dt;
  p.manT = (p.manT || 0) - dt;
  {
    const sv2 = Math.hypot(p.vx, p.vy);
    p.en = Math.max(
      0,
      Math.min(
        1,
        (p.en == null ? 1 : p.en) - (i.sp && sv2 > 150 ? dt * 0.1 : -dt * 0.04),
      ),
    );
  }
  if (
    has &&
    p.mode === "i" &&
    p.cd <= 0 &&
    !(p.mvT > 0) &&
    (i.dx || i.dy) &&
    p.li &&
    i.dx * p.li[0] + i.dy * p.li[1] < -0.3 &&
    Math.hypot(p.vx, p.vy) > 110
  )
    i.mv = i.mv || 3;
  if (i.dx || i.dy) p.li = [i.dx, i.dy];
  p.postA =
    has && i.post && p.mode === "i" && D < 190 && !ftq && !(p.mvT > 0) ? 1 : 0;
  if (p.postA) {
    i.dx = (ux / D) * 0.3;
    i.dy = (uy / D) * 0.3;
  }
  if (p.mvT > 0) {
    p.mvE = (p.mvE || 0) + dt;
    p.mvT -= dt;
    const e = p.mvE,
      S = p.mvS || 1,
      k = p.mvk;
    let f = 0,
      l = 0;
    if (k === 1) {
      if (e < 0.22) f = 0.05;
      else {
        f = 1.5;
        l = 0.25;
      }
    } else if (k === 2) {
      if (e < 0.15) l = 0.6;
      else {
        l = 0.9;
        f = 0.9;
      }
    } else if (k === 3) {
      if (e < 0.3) {
        l = 1.3;
        f = 0.3;
      } else f = 1.1;
    } else {
      if (e < 0.15) {
        l = 0.7;
        f = 0.2;
      } else {
        l = 0.2;
        f = 1.4;
      }
    }
    i.dx = (ux / D) * f - (uy / D) * l * S;
    i.dy = (uy / D) * f + (ux / D) * l * S;
    if (p.mvT <= 0 && k === 4 && has) {
      p.hk = 1;
      i.sd = 1;
      i.su = 1;
    }
  } else if (
    i.mv &&
    has &&
    p.mode === "i" &&
    p.cd <= 0 &&
    !ftq &&
    pos === p.tm
  ) {
    const d = P[nearest(1 - p.tm, p.x, p.y)],
      dist = Math.hypot(d.x - p.x, d.y - p.y),
      S = -uy * (p.x - d.x) + ux * (p.y - d.y) >= 0 ? 1 : -1,
      u = p === P[ap];
    if (p.postA) {
      if (i.mv === 1) {
        p.hk = 1;
        p.fsv = 10;
        i.sd = 1;
        i.su = 1;
        if (u) txt("HOOK", ...pr(p.x, p.y, 100), "#ffd23f");
      } else if (i.mv === 3) {
        p.hk = 1;
        p.fsv = 2;
        i.sd = 1;
        i.su = 1;
        if (u) txt("TURNAROUND", ...pr(p.x, p.y, 100), "#ffd23f");
      } else {
        p.mvk = 4;
        p.mvT = 0.4;
        p.mvE = 0;
        p.mvS = S;
        p.cd = 0.9;
        if (u) txt("DROP STEP", ...pr(p.x, p.y, 100), "#ffd23f");
      }
    } else {
      p.mvk = i.mv;
      p.mvT = 0.5;
      p.mvE = 0;
      p.mvS = S;
      p.cd = 0.9;
      if (u)
        txt(
          ["", "HESITATION", "SPIN MOVE", "BEHIND THE BACK"][i.mv],
          ...pr(p.x, p.y, 100),
          "#ffd23f",
        );
      if (dist < 60 && Math.random() < 0.5 + (p.s - d.d) / 250) {
        d.slow = Math.max(d.slow, 0.7);
        d.scr = Math.max(d.scr || 0, 0.35);
        if (u) txt("ANKLE BREAKER!", ...pr(d.x, d.y, 95), "#ff6b6b");
      }
    }
  }

  if (p.mode === "i" && i.sb && has && pos === p.tm && p.cd <= 0 && D > 60) {
    p.mode = "b";
    p.t = 0;
    p.bn = p.st === 1 ? 2 : 1;
    p.cd = 1.6;
    p.bx = -ux / D;
    p.by = -uy / D;
    P[nearest(1 - p.tm, p.x, p.y)].slow = 0.5 + 0.25 * p.bn;
    if (p === P[ap])
      txt(
        p.bn > 1 ? "DOUBLE STEP-BACK!" : "STEP-BACK!",
        ...pr(p.x, p.y, 95),
        "#ffd23f",
      );
  }
  if (p.mode === "b") {
    p.t += dt;
    const m = p.t < 0.17 || (p.bn > 1 && p.t > 0.23 && p.t < 0.4);
    p.vx = m ? p.bx * 190 : 0;
    p.vy = m ? p.by * 190 : 0;
    if (i.sd && p.t > 0.12 && has) {
      p.mode = "c";
      p.t = 0;
      p.sbw = 0.9;
    } else if (p.t >= (p.bn > 1 ? 0.4 : 0.2)) {
      p.mode = "i";
      p.sbw = 0.9;
      p.vx = p.vy = 0;
    }
  }
  if (p.mode === "i") {
    if (i.sd) {
      if (has && pos === p.tm) {
        p.mode = "c";
        p.t = 0;
        if (TEMPO && isH(p)) i.su = 1;
      } else if (!has && p.z <= 0) p.vz = 126 + p.j * 0.9;
    }
    if (has && (i.pass || i.e || i.lob)) {
      const r = i.pass || pick(p, i);
      if (r) pass(p, r, i.lob ? 2 : undefined);
    } else if (i.e && p.cd <= 0) {
      p.cd = 0.8;
      const o = B.owner;
      if (
        o &&
        o.tm !== p.tm &&
        Math.hypot(o.x - p.x, o.y - p.y) < 22 &&
        o.mode === "i" &&
        !(o.mvT > 0) &&
        false
      ) {
        B.owner = p;
        pos = p.tm;
        shot = 24;
        txt("STEAL!", ...pr(p.x, p.y, 90), "#7CFC7C");
        snd(220, 0.12, "square");
      } else if (
        o &&
        o.tm !== p.tm &&
        Math.hypot(o.x - p.x, o.y - p.y) < 24 &&
        !ftq &&
        false
      )
        foul(p, o, "REACH-IN", 0);
    }
  }
  if (p.mode === "c") {
    p.t += dt;
    p.vx *= 0.85;
    p.vy *= 0.85;
    if (!has) p.mode = "i";
    else if (i.su || p.t > 1.4) {
      p.mt = p.t;
      p.cw = Math.min(1, contestOf(p)[0] + (p.bmp || 0) * 0.5);
      p.mode = "s";
      p.t = 0;
      p.rl = 0;
      const lay = D < 90 && !ftq,
        k = p.st === 2 ? 70 : p.st === 3 ? 110 : 0;
      p.sv = PRO
        ? pickClip(p, D, lay)
        : lay
          ? D < 50 && p.j >= 55
            ? 6
            : 5
          : p.st === 2
            ? 2
            : p.st === 3
              ? 3
              : p.st === 4
                ? 4
                : p.st === 1
                  ? 1
                  : 0;
      p.tp = null;
      p.vz = ftq
        ? 60
        : ((lay ? 150 : 126) + p.j * 0.9) *
          (PRO && p.st === 1 && !lay ? 0.75 : 1);
      p.vx = ftq
        ? 0
        : lay
          ? (ux / D) * 100
          : PRO && p.sv === 8
            ? p.vx * 0.5
            : (-ux / D) * k;
      p.vy = ftq ? 0 : lay ? (uy / D) * 100 : (-uy / D) * k;
    }
  }
  if (p.mode === "s") {
    if (TEMPO && isH(p) && i.sd && p.tp == null && p.t > 0.03) p.tp = p.t;
    p.t += dt;
    if (!p.rl && has && p.t >= (D < 90 ? 0.28 : p.st === 1 ? 0.3 : 0.4))
      launch(p);
    if (p.t > 0.7 && p.z <= 0) {
      p.mode = "i";
      p.vx = p.vy = 0;
      p.hk = 0;
    }
  }
  if (p.mode === "i") {
    const sp =
        (150 + p.s * 1.1) *
        (p.scr > 0 ? 0.15 : p.slow > 0 ? 0.4 : 1) *
        (0.75 + 0.25 * (p.en == null ? 1 : p.en)) *
        (has ? 0.96 : 1) *
        (i.sp ? 1.2 : 1) *
        (p.z > 0 ? 0.5 : 1),
      k = Math.min(1, dt * (p.z > 0 ? 1.5 : 9));
    if (PRO && p.z <= 0) {
      const dx = i.dx * sp - p.vx,
        dy = i.dy * sp - p.vy,
        dl = Math.hypot(dx, dy),
        cur = Math.hypot(p.vx, p.vy),
        brk = cur > 40 && dx * p.vx + dy * p.vy < 0,
        ac = (brk ? 1100 : 620 + p.s * 3) * (p.mvT > 0 ? 2.6 : 1) * dt,
        mm = Math.min(dl, ac);
      if (dl > 0) {
        p.vx += (dx / dl) * mm;
        p.vy += (dy / dl) * mm;
      }
      p.brk = brk ? 1 : Math.max(0, (p.brk || 0) - dt * 4);
    } else {
      p.vx += (i.dx * sp - p.vx) * k;
      p.vy += (i.dy * sp - p.vy) * k;
    }
  }
  p.x = clamp(p.x + p.vx * dt, 8, CW - 8);
  p.y = clamp(p.y + p.vy * dt, 8, CH - 8);
  const sv = Math.hypot(p.vx, p.vy);
  p.ph += sv * dt * 0.09;
  if (p.mode !== "i") p.f = Math.atan2(uy, ux);
  else {
    let tf = null;
    if (pos !== p.tm && B.owner) tf = Math.atan2(B.y - p.y, B.x - p.x);
    else if (has)
      tf =
        (p.vx * ux + p.vy * uy) / D < -0.3 * sv
          ? Math.atan2(uy, ux)
          : sv > 20
            ? Math.atan2(p.vy, p.vx)
            : null;
    else
      tf = sv > 150 ? Math.atan2(p.vy, p.vx) : Math.atan2(B.y - p.y, B.x - p.x);
    if (tf != null) {
      const dd = Math.atan2(Math.sin(tf - p.f), Math.cos(tf - p.f));
      p.f += dd * Math.min(1, dt * 10);
    }
  }
  if (p.postA) p.f = Math.atan2(-uy, -ux);
  if (p.z > 0 || p.vz > 0) {
    p.vz -= g * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
      p.z = 0;
      p.vz = 0;
    }
  }
}
function mv(p, tx, ty, s = 1) {
  const dx = tx - p.x,
    dy = ty - p.y,
    d = Math.hypot(dx, dy);
  if (d > 6) {
    p.in.dx = (dx / d) * Math.min(1, d / 30) * s;
    p.in.dy = (dy / d) * Math.min(1, d / 30) * s;
  }
}
function ai(p, dt) {
  const a = p.ai,
    t = p.tm,
    i = (p.in = { dx: 0, dy: 0 }),
    has = B.owner === p,
    dh = hoop(1 - t),
    oh = hoop(t);
  if (rs > 0) return;
  if (has) {
    if (p.mode === "c") {
      if (p.t >= a.rel) i.su = 1;
      return;
    }
    if (p.mode !== "i") return;
    const dn = P[nearest(1 - t, p.x, p.y)],
      D0 = Math.hypot(oh - p.x, HY - p.y);
    if (
      p.cd <= 0 &&
      D0 > 150 &&
      Math.hypot(dn.x - p.x, dn.y - p.y) < 38 &&
      (p.st === 1 || p.st === 3) &&
      Math.random() < dt * 2
    )
      i.sb = 1;
    if (p.sbw > 0 && D0 > 120) {
      i.sd = 1;
      a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
      a.r = 0;
      return;
    }
    const D = Math.hypot(oh - p.x, HY - p.y);
    if (!a.r)
      ((a.r =
        p.c < 50
          ? 55 + Math.random() * 40
          : p.c >= 86 && Math.random() < 0.65
            ? 245
            : p.i >= 90 && Math.random() < 0.5
              ? 70 + Math.random() * 60
              : 100 + Math.random() * 130),
        (a.w = 0),
        (a.pt = 0.8));
    if (D > a.r) mv(p, oh, HY + Math.sin(T * 1.5 + p.k) * 90, 1);
    else {
      a.w += dt;
      i.sp = 0;
      if (
        a.w > 0.45 &&
        (Math.hypot(dn.x - p.x, dn.y - p.y) > 30 || shot < 7 || a.w > 1.3)
      ) {
        i.sd = 1;
        a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
        a.r = 0;
      }
    }
    a.pt -= dt;
    if (a.pt < 0) {
      a.pt = 0.5;
      const ql = (r, d) => (d < 90 ? r.i : d < 237 ? (r.c + r.i) / 2 : r.c),
        val = (r) => {
          const o = P[nearest(1 - t, r.x, r.y)],
            od = Math.hypot(o.x - r.x, o.y - r.y),
            dd = Math.hypot(oh - r.x, HY - r.y),
            dx = r.x - p.x,
            dy = r.y - p.y,
            l2 = dx * dx + dy * dy || 1;
          for (const e of P)
            if (e.tm !== t) {
              const u = clamp(((e.x - p.x) * dx + (e.y - p.y) * dy) / l2, 0, 1);
              if (Math.hypot(p.x + dx * u - e.x, p.y + dy * u - e.y) < 14)
                return -1;
            }
          return (
            (Math.min(od, 80) / 80) * 0.6 +
            (ql(r, dd) / 100) * 0.5 +
            (dd < D ? 0.12 : 0) +
            (OFFS[t] === r ? 0.45 : 0) +
            (r.my ? 0.2 : 0)
          );
        };
      const own =
        (Math.min(Math.hypot(dn.x - p.x, dn.y - p.y), 80) / 80) * 0.6 +
        (ql(p, D) / 100) * 0.5;
      let bo = null,
        bv = own + 0.12;
      for (const r of P)
        if (r.tm === t && r !== p) {
          const v = val(r);
          if (v > bv) {
            bv = v;
            bo = r;
          }
        }
      const prs = Math.hypot(dn.x - p.x, dn.y - p.y) < 40;
      if (
        bo &&
        PCNT[t] < 3 &&
        T - LASTP[t] > 1.1 &&
        Math.hypot(bo.x - p.x, bo.y - p.y) < 280 &&
        (Math.abs(hoop(t) - bo.x) < Math.abs(hoop(t) - p.x) + 40 || prs) &&
        Math.random() < (prs ? 0.8 : 0.5)
      )
        i.pass = bo;
    }
    if (
      p.cd <= 0 &&
      p.s >= 72 &&
      Math.hypot(dn.x - p.x, dn.y - p.y) < 55 &&
      Math.random() < dt * 1.4
    )
      i.mv = 1 + ((Math.random() * 3) | 0);
  } else if (pos === t && B.mode !== "held" && B.to === p)
    mv(p, B.x + B.vx * 0.2, B.y + B.vy * 0.2, 1);
  else if (pos === t && B.owner) {
    if (offBall(p, t)) return;
    const s = SP[p.k],
      x = t ? 52.5 + s[0] : 887.5 - s[0];
    const nd = P[nearest(1 - t, p.x, p.y)];
    mv(
      p,
      x + (p.x - nd.x) * 0.35,
      s[1] + Math.sin(T + p.k * 2) * 18 + (p.y - nd.y) * 0.3,
      0.95,
    );
  } else if (B.owner) {
    const o = p.manT > 0 && p.man != null ? P[p.man] : P[(1 - t) * NP + p.k],
      ou = B.owner === o ? 22 : 26,
      l = Math.hypot(dh - o.x, HY - o.y) || 1;
    const hb = B.owner,
      hh = Math.hypot(dh - hb.x, HY - hb.y);
    if (
      hh < 140 &&
      p.k !== hb.k &&
      nearest(t, hb.x, hb.y, t * NP + hb.k) === t * NP + p.k
    )
      mv(p, hb.x + (dh - hb.x) * 0.35, hb.y + (HY - hb.y) * 0.35, 1.1);
    else {
      let tx = o.x + ((dh - o.x) / l) * ou,
        ty = o.y + ((HY - o.y) / l) * ou;
      if (dh > 470 ? B.x < 470 : B.x > 470)
        tx = dh > 470 ? Math.max(tx, 455) : Math.min(tx, 485);
      mv(p, tx, ty, 0.92);
    }
    if (
      Math.hypot(o.x - p.x, o.y - p.y) < 42 &&
      (o.mode === "c" || o.mode === "s") &&
      p.z <= 0 &&
      !a.j
    )
      i.sd = a.j = 1;
    if (o.mode === "i") a.j = 0;
    if (
      (dh > 470 ? B.x >= 470 : B.x <= 470) &&
      B.owner === o &&
      Math.hypot(o.x - p.x, o.y - p.y) < 22 &&
      Math.random() < dt * 0.7
    )
      i.e = 1;
  } else {
    loose(p, t);
  }
}
function hum() {
  const i = {
    dx:
      ((!MP2 && K.ArrowRight) || K.KeyD ? 1 : 0) -
      ((!MP2 && K.ArrowLeft) || K.KeyA ? 1 : 0),
    dy:
      ((!MP2 && K.ArrowDown) || K.KeyS ? 1 : 0) -
      ((!MP2 && K.ArrowUp) || K.KeyW ? 1 : 0),
    sd: ev.sd,
    su: ev.su,
    e: ev.e,
    sb: ev.f,
    mv: ev.cc ? 1 : ev.x ? 2 : ev.vv ? 3 : 0,
    post: K.KeyB || GP.post,
    lob: ev.r,
    sp: K.ShiftLeft || K.ShiftRight || GP.sp,
  };
  if (GP.on) {
    i.dx += GP.dx;
    i.dy += GP.dy;
  }
  const m = Math.hypot(i.dx, i.dy);
  if (m > 1) {
    i.dx /= m;
    i.dy /= m;
  }
  return i;
}
function bstep(dt) {
  const o = B.owner;
  if (o) {
    {
      const off = o.mvT > 0 ? Math.sin((o.mvE || 0) * 14) * 7 : 0;
      B.x = o.x + Math.cos(o.f) * 8 - Math.sin(o.f) * off;
      B.y = o.y + Math.sin(o.f) * 5 + Math.cos(o.f) * off;
    }
    B.z =
      o.mode === "c"
        ? PRO && o.st === 1
          ? o.z + 38
          : o.z + 55
        : o.mode === "s"
          ? PRO && o.st === 1
            ? o.z + 38 + Math.min(1, o.t / 0.3) * 52
            : o.z + 55 + Math.min(1, o.t / 0.4) * 28
          : PRO
            ? dz(o, dt)
            : 6 + Math.abs(Math.sin(T * 8 + o.k)) * 30;
    B.vx = B.vy = B.vz = 0;
    return;
  }
  B.age += dt;
  const RA = RAP && B.mode === "air";
  if (!RA) {
    B.vz -= g * dt;
    B.vx *= 1 - 0.1 * dt;
    B.vy *= 1 - 0.1 * dt;
  }
  if (B.mode === "pass" && B.to && B.age > 0.04) {
    const r = B.to,
      dx = r.x + r.vx * 0.12 - B.x,
      dy = r.y + r.vy * 0.12 - B.y,
      ds = Math.hypot(dx, dy) || 1,
      sp = Math.hypot(B.vx, B.vy);
    B.vx += ((dx / ds) * sp - B.vx) * Math.min(1, dt * 2.5);
    B.vy += ((dy / ds) * sp - B.vy) * Math.min(1, dt * 2.5);
  }
  const pz = B.z;
  if (RA) rapStep(dt);
  else {
    B.x += B.vx * dt;
    B.y += B.vy * dt;
    B.z += B.vz * dt;
  }
  B.a += B.vx * dt * 0.1;
  for (const hx of HXs) {
    const rx = B.x - hx,
      ry = B.y - HY,
      d = Math.hypot(rx, ry),
      b = hx > 470 ? 1 : 0;
    if (d > 0 && !RA) {
      const cx = hx + (rx / d) * RR,
        cy = HY + (ry / d) * RR,
        vx = B.x - cx,
        vy = B.y - cy,
        vz = B.z - 100,
        dd = Math.hypot(vx, vy, vz),
        m = BR + 0.8;
      if (dd < m && dd > 0) {
        const nx = vx / dd,
          ny = vy / dd,
          nz = vz / dd;
        B.x = cx + nx * m;
        B.y = cy + ny * m;
        B.z = 100 + nz * m;
        const dot = B.vx * nx + B.vy * ny + B.vz * nz;
        if (dot < 0) {
          B.vx -= 1.55 * dot * nx;
          B.vy -= 1.55 * dot * ny;
          B.vz -= 1.55 * dot * nz;
          B.vx *= 0.93;
          B.vy *= 0.93;
          snd(300, 0.06, "triangle");
        }
      }
    }
    const bx = b ? 900 : 40;
    if (
      !RA &&
      (b ? B.x > bx - BR && B.x < bx + 6 : B.x < bx + BR && B.x > bx - 6) &&
      Math.abs(B.y - HY) < 30 &&
      B.z > 93 &&
      B.z < 136
    ) {
      B.x = b ? bx - BR : bx + BR;
      B.vx = -B.vx * 0.6;
      snd(200, 0.05, "square");
    }
    if (pz >= 100 && B.z < 100 && B.vz < 0 && d < RR - 1.2 && B.sh && !B.sc) {
      B.sc = 1;
      const t = b ? 0 : 1,
        pts = B.ft ? 1 : B.three && B.last.tm === t ? 3 : 2;
      sc[t] += pts;
      EXC = 1;
      {
        const L = B.last;
        if (L && L.stt) {
          L.stt.pts += pts;
          if (!B.ft) {
            L.stt.fgm++;
            if (B.three) L.stt.tpm++;
          }
          if (
            B.pp &&
            B.pp.p !== L &&
            B.pp.p.tm === L.tm &&
            T - B.pp.t < 3.5 &&
            !B.ft
          )
            B.pp.p.stt.ast++;
        }
      }
      if (B.last) {
        B.last.heat = Math.min(3, (B.last.heat || 0) + 1);
        if (B.last.heat === 3)
          txt("ON FIRE!", ...pr(B.last.x, B.last.y, 105), "#ff9a2e");
      }
      txt(
        "+" + pts,
        ...pr(hx > 470 ? hx - 50 : hx + 20, HY, 125),
        pts === 3 ? "#ffd23f" : "#fff",
      );
      snd(900, 0.25, "sine", 0.1);
      if (ftq) ftq.next = 1.3;
      else if (B.fl) startFT(B.last, 1);
      else {
        rs = 1.4;
        pend = 1 - t;
        if (
          typeof GL !== "undefined" &&
          GL &&
          (B.dk || (B.gn && B.three && B.last === P[ap]))
        )
          RQ = 1;
      }
      B.sh = 0;
      fin = 0;
    }
    if (B.sc && B.z > 60 && B.z < 100 && d < RR + 3) {
      B.vx *= 0.9;
      B.vy *= 0.9;
    }
  }
  if (!RA && B.z < BR) {
    B.z = BR;
    if (Math.abs(B.vz) > 60) snd(110, 0.05, "sine", 0.1);
    B.vz *= -0.72;
    B.vx *= 0.9;
    B.vy *= 0.9;
    if (Math.abs(B.vz) < 25) B.vz = 0;
  }
  if (!RA) {
    if (B.x < 6 || B.x > CW - 6) {
      B.x = clamp(B.x, 6, CW - 6);
      B.vx *= -0.5;
    }
    if (B.y < 6 || B.y > CH - 6) {
      B.y = clamp(B.y, 6, CH - 6);
      B.vy *= -0.5;
    }
  }
  if (B.sc) return;
  if (ftq) return;
  if (
    B.sh &&
    B.vz < 0 &&
    B.z > 88 &&
    B.z < 135 &&
    (Math.hypot(B.x - HXs[0], B.y - HY) < 14 ||
      Math.hypot(B.x - HXs[1], B.y - HY) < 14)
  )
    return;
  for (const p of [...P].sort(
    (a, b) =>
      b.j +
      b.d * 0.3 +
      (b.z > 5 ? 25 : 0) +
      Math.random() * 40 -
      (a.j + a.d * 0.3 + (a.z > 5 ? 25 : 0) + Math.random() * 40),
  )) {
    if ((p === B.last && B.age < 0.3) || p.mode === "s") continue;
    const d = Math.hypot(p.x - B.x, p.y - B.y);
    const rc = B.mode === "pass" && p === B.to;
    if (
      d < (rc ? 26 : 12) &&
      B.z > p.z + (rc ? -8 : 2) &&
      B.z < p.z + 68 + p.j * 0.2 + (rc && B.ptype === 2 ? 55 : 0)
    ) {
      if (B.mode === "pass" && p !== B.to) continue;
      if (B.mode === "air" && B.age < 0.5 && (B.vz > 0 || p.tm === B.last.tm))
        continue;
      if (B.sh && B.last && !B.sc) p.stt.reb++;
      if (B.sh && B.last && !B.sc)
        B.last.heat = Math.max(-2, (B.last.heat || 0) - 1);
      B.owner = p;
      B.mode = "held";
      B.sh = 0;
      B.to = null;
      if (p.tm !== pos) {
        pos = p.tm;
        shot = 24;
        PCNT[0] = PCNT[1] = 0;
      }
      snd(180, 0.05, "square");
      break;
    }
  }
}
function upd(dt) {
  T += dt;
  DT = dt;
  fc -= dt;
  if (RPL) {
    rplStep(dt);
    return;
  }
  gpPoll();
  crowdTick(dt);
  TX.forEach((o) => {
    o.t -= dt;
    o.y -= 25 * dt;
  });
  TX = TX.filter((o) => o.t > 0);
  if (S !== "play") return;
  const h = hum(),
    h2 = MP2 ? hum2() : null;
  H2 = h2;
  ev.sd = ev.su = ev.e = ev.f = ev.x = ev.cc = ev.vv = ev.r = 0;
  P.forEach((p, k) => {
    if (inb > 0 || (ftq && p !== ftq.s)) {
      p.in = { dx: 0, dy: 0 };
      return;
    }
    if (k === ap) p.in = rs > 0 ? { dx: 0, dy: 0 } : h;
    else if (MP2 && k === ap2) p.in = rs > 0 ? { dx: 0, dy: 0 } : h2;
    else ai(p, dt);
  });
  if (
    rs <= 0 &&
    !B.owner &&
    !ftq &&
    inb <= 0 &&
    (B.mode !== "pass" || B.to === P[ap])
  ) {
    const q = P[ap];
    if (!h.dx && !h.dy && !h.sd && q.mode === "i") {
      q.in = { dx: 0, dy: 0 };
      loose(q, q.tm);
    } else if (
      q.mode === "i" &&
      B.mode === "air" &&
      Math.hypot(B.x - q.x, B.y - q.y) < 150
    ) {
      const a = { dx: 0, dy: 0 },
        sv = q.in;
      q.in = a;
      loose(q, q.tm);
      q.in = sv;
      sv.dx = sv.dx * 0.4 + a.dx * 0.9;
      sv.dy = sv.dy * 0.4 + a.dy * 0.9;
      if (
        a.sd ||
        (q.z <= 0 && B.z > 45 && Math.hypot(B.x - q.x, B.y - q.y) < 34)
      )
        sv.sd = 1;
    }
  }
  ftIn(h, dt);
  if (inb > 0) {
    inb -= dt;
    if (inb <= 0 && B.owner && B.mode === "held") {
      const o = B.owner;
      if (NP > 1) {
        let b = null,
          bv = -1e9;
        for (const q of P)
          if (q.tm === o.tm && q !== o) {
            const nd = P[nearest(1 - o.tm, q.x, q.y)],
              v =
                Math.min(80, Math.hypot(nd.x - q.x, nd.y - q.y)) -
                Math.hypot(q.x - o.x, q.y - o.y) * 0.1;
            if (v > bv) {
              bv = v;
              b = q;
            }
          }
        pass(o, b, 0);
      }
    }
  }
  if (ev.q) {
    ev.q = 0;
    if (!(B.owner && B.owner.tm === 0)) ap = nearest(0, B.x, B.y, ap);
  }
  if (MYM) {
    if (!(ftq && ftq.s.tm === 0 && ftq.i >= 0)) ap = 0;
  } else if (B.owner && B.owner.tm === 0) ap = B.owner.k;
  else if (B.owner) {
    if (B.owner !== lastO) ap = nearest(0, B.owner.x, B.owner.y);
  } else if (P[ap].mode !== "s") ap = nearest(0, B.x, B.y);
  lastO = B.owner;
  if (MP2) {
    if (B.owner && B.owner.tm === 1) ap2 = NP + B.owner.k;
    else if (B.owner) {
      if (B.owner !== lastO2) ap2 = nearest(1, B.owner.x, B.owner.y);
    } else if (P[ap2] && P[ap2].mode !== "s") ap2 = nearest(1, B.x, B.y);
    lastO2 = B.owner;
  }
  P.forEach((p) => step(p, dt));
  collide();
  bstep(dt / 2);
  bstep(dt / 2);
  ftTick(dt);
  netSim(dt);
  recFrame();
  if (rs > 0) {
    rs -= dt;
    if (rs <= 0) {
      if (RQ && REC.length > 80) {
        startReplay();
        return;
      }
      setup(pend);
    }
    return;
  }
  if (clock > 0 && !ftq && inb <= 0) clock = Math.max(0, clock - dt);
  if (B.owner && !ftq && inb <= 0) shot -= dt;
  if (shot <= 0 && !ftq) {
    txt("SHOT CLOCK!", 470, 200, "#ff6b4a");
    setup(1 - pos);
  }
  if (clock <= 0 && !ftq && !(B.sh && !B.owner)) {
    if (q >= 4 && sc[0] !== sc[1]) endGame();
    else {
      q++;
      tf = [0, 0];
      clock = q > 4 ? 30 : 60;
      setup(q % 2 ? 0 : 1);
      txt(q > 4 ? "OVERTIME" : "QUARTER " + q, 470, 200, "#ffd23f");
    }
  }
}
const fmt = (s) => {
  s = Math.ceil(s * 12);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const W3 = (x, y, z = 0) => [(x - 470) * 0.1, z * 0.1, (y - 250) * 0.1];
let CP = [0, 22, 36],
  PC = ["#7b3fb5", "#1d428a"],
  cx = 0;
const FOC = 742,
  FY = -0.554,
  FZ = -0.831,
  UY = 0.831,
  UZ = -0.554;
function pj(x, y, z) {
  const dx = x - CP[0],
    dy = y - CP[1],
    dz = z - CP[2],
    zc = dy * FY + dz * FZ;
  if (zc < 1) return [480, 270, 1, 1];
  const s = FOC / zc;
  return [480 + dx * s, 270 - (dy * UY + dz * UZ) * s, s, zc];
}
const fl = (x, y) => {
    const w = W3(x, 0, y);
    return pj(w[0], 0, w[2]);
  },
  gp = (a) => a.map((p) => fl(p[0], p[1]));
function poly(a, fill, st, lw) {
  X.beginPath();
  a.forEach((q, i) => (i ? X.lineTo(q[0], q[1]) : X.moveTo(q[0], q[1])));
  if (fill) {
    X.fillStyle = fill;
    X.fill();
  }
  if (st) {
    X.strokeStyle = st;
    X.lineWidth = lw;
    X.stroke();
  }
}
function gar(x, y, r, a0, a1) {
  const o = [];
  for (let k = 0; k <= 36; k++) {
    const a = a0 + ((a1 - a0) * k) / 36;
    o.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return o;
}
const CRW = Array.from({ length: 600 }, (_, i) => [
  Math.random() * 150 - 75,
  0.3 + Math.random() * 4,
  ["#6a4c93", "#c9184a", "#f4a261", "#2a9d8f", "#e9c46a", "#4361ee"][i % 6],
]);
function hoopD(b) {
  const hx = (HXs[b] - 470) * 0.1,
    sg = b ? 1 : -1,
    bx = sg * 43;
  let a = pj(sg * 44.5, 0, 0),
    c = pj(sg * 44.5, 12, 0);
  X.lineCap = "round";
  X.strokeStyle = "#2b2b33";
  X.lineWidth = 0.45 * a[2];
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(c[0], c[1]);
  X.stroke();
  a = pj(sg * 44.5, 10.8, 0);
  c = pj(bx, 10.8, 0);
  X.lineWidth = 0.3 * a[2];
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(c[0], c[1]);
  X.stroke();
  poly(
    [pj(bx, 9.6, -3), pj(bx, 9.6, 3), pj(bx, 13.6, 3), pj(bx, 13.6, -3)],
    "rgba(225,235,255,.85)",
    "#fff",
    1.5,
  );
  const rim = [],
    net = [];
  for (let k = 0; k <= 16; k++) {
    const t = (k / 16) * 6.283;
    rim.push(pj(hx + Math.cos(t) * 0.75, 10, Math.sin(t) * 0.75));
    net.push(pj(hx + Math.cos(t) * 0.45, 8.6, Math.sin(t) * 0.45));
  }
  drawNet(b, (x, y, z) => {
    const w = W3(x, y, z);
    return pj(w[0], w[1], w[2]);
  });
  poly(rim, 0, "#ff4d1a", 3.2);
}
function scene() {
  X.fillStyle = "#07081a";
  X.fillRect(0, 0, 960, 540);
  const a = pj(-80, 0, -34),
    c = pj(80, 24, -34),
    g1 = X.createLinearGradient(0, Math.min(c[1], a[1]), 0, a[1]);
  g1.addColorStop(0, "#1a1e44");
  g1.addColorStop(1, "#0c0e24");
  poly([a, pj(80, 0, -34), c, pj(-80, 24, -34)], g1);
  for (const q of CRW) {
    const p = pj(q[0], q[1] + Math.sin(T * 3 + q[0]) * 0.08, -33.9);
    X.fillStyle = q[2];
    X.fillRect(p[0], p[1], 0.4 * p[2], 0.5 * p[2]);
  }
  poly(
    [pj(-80, 0, -34), pj(80, 0, -34), pj(80, 0, 40), pj(-80, 0, 40)],
    "#14162e",
  );
  poly(
    gp([
      [0, 0],
      [940, 0],
      [940, 500],
      [0, 500],
    ]),
    "#c98f4d",
  );
  X.strokeStyle = "rgba(0,0,0,.09)";
  X.lineWidth = 1;
  for (let x = 0; x <= 940; x += 24) {
    const u = fl(x, 0),
      v = fl(x, 500);
    X.beginPath();
    X.moveTo(u[0], u[1]);
    X.lineTo(v[0], v[1]);
    X.stroke();
  }
  X.globalAlpha = 0.6;
  poly(
    gp([
      [0, 170],
      [190, 170],
      [190, 330],
      [0, 330],
    ]),
    PC[0],
  );
  poly(
    gp([
      [750, 170],
      [940, 170],
      [940, 330],
      [750, 330],
    ]),
    PC[1],
  );
  X.globalAlpha = 1;
  const W = "rgba(255,255,255,.92)",
    L = 2.5;
  poly(
    gp([
      [0, 0],
      [940, 0],
      [940, 500],
      [0, 500],
      [0, 0],
    ]),
    0,
    W,
    L,
  );
  poly(
    gp([
      [470, 0],
      [470, 500],
    ]),
    0,
    W,
    L,
  );
  poly(gp(gar(470, 250, 60, 0, 6.3)), 0, W, L);
  for (const b of [0, 1]) {
    const hx = HXs[b],
      e = b ? 940 : 0,
      sg = b ? -1 : 1;
    poly(
      gp([
        [b ? 750 : 0, 170],
        [b ? 940 : 190, 170],
        [b ? 940 : 190, 330],
        [b ? 750 : 0, 330],
        [b ? 750 : 0, 170],
      ]),
      0,
      W,
      L,
    );
    poly(
      gp(gar(e + sg * 190, 250, 60, b ? 1.57 : -1.57, b ? 4.71 : 1.57)),
      0,
      W,
      L,
    );
    poly(
      gp(
        gar(
          hx,
          250,
          237,
          b ? Math.PI - 1.19 : -1.19,
          b ? Math.PI + 1.19 : 1.19,
        ),
      ),
      0,
      W,
      L,
    );
    poly(
      gp([
        [e, 30],
        [hx + sg * 88, 30],
      ]),
      0,
      W,
      L,
    );
    poly(
      gp([
        [e, 470],
        [hx + sg * 88, 470],
      ]),
      0,
      W,
      L,
    );
  }
  hoopD(0);
  hoopD(1);
}
function segs(p, out) {
  pose3(p);
  const q = p.q,
    S = p.ht / 6.4,
    th = Math.PI / 2 - p.f,
    cs = Math.cos(th),
    sn = Math.sin(th),
    w = W3(p.x, p.y, p.z),
    k = p.bk;
  const bp = (a) => {
    const x = a[0],
      y = a[1],
      z = a[2],
      X1 = x * Math.cos(q.rz) - y * Math.sin(q.rz),
      Y1 = x * Math.sin(q.rz) + y * Math.cos(q.rz),
      Y2 = Y1 * Math.cos(q.ln) - z * Math.sin(q.ln),
      Z2 = Y1 * Math.sin(q.ln) + z * Math.cos(q.ln);
    return [
      X1 * Math.cos(q.ty) + Z2 * Math.sin(q.ty),
      Y2 + 3.2,
      -X1 * Math.sin(q.ty) + Z2 * Math.cos(q.ty),
    ];
  };
  const W = (l) => [
    w[0] + (l[0] * cs + l[2] * sn) * S,
    w[1] - q.cr * 0.4 + l[1] * S,
    w[2] + (-l[0] * sn + l[2] * cs) * S,
  ];
  const add = (a, b, wd, col, n) => {
    const A = pj(...W(a)),
      B2 = pj(...W(b));
    B2[0] += 0.01;
    out.push({ z: (A[3] + B2[3]) / 2, A, B: B2, w: wd * S, c: col, n });
  };
  const dk = "#0b0b12",
    hc = p.skin === "#e8b88f" ? "#4a3320" : "#141414",
    back = Math.cos(p.f) * (CP[0] - w[0]) + Math.sin(p.f) * (CP[2] - w[2]) < 0;
  for (const sd of [-1, 1]) {
    const tl = sd < 0 ? q.tL : q.tR,
      kl = sd < 0 ? q.kL : q.kR,
      hj = [sd * 0.3, 3.2, 0],
      kn = [hj[0], hj[1] - 1.6 * Math.cos(tl), hj[2] + 1.6 * Math.sin(tl)],
      a2 = tl - kl,
      an = [kn[0], kn[1] - 1.6 * Math.cos(a2), kn[2] + 1.6 * Math.sin(a2)];
    add(hj, kn, 0.44, p.skin);
    add(kn, an, 0.34, p.skin);
    add(an, [an[0], an[1] - 0.12, an[2] + 0.55], 0.32, "#f2f2f2");
    add(
      hj,
      [(hj[0] + kn[0]) / 2, (hj[1] + kn[1]) / 2, (hj[2] + kn[2]) / 2],
      0.62 * k,
      p.col,
    );
    const sh = [sd * 0.9 * k, 1.95, 0],
      aF = sd < 0 ? q.aL : q.aR,
      eF = sd < 0 ? q.eL : q.eR,
      sa = sd < 0 ? q.zL : q.sz,
      wF = sd < 0 ? q.wL : q.wR,
      sp = Math.sin(sa) * sd,
      c2 = Math.cos(sa),
      el = [
        sh[0] + sp * 1.05,
        sh[1] - Math.cos(aF) * c2 * 1.05,
        sh[2] + Math.sin(aF) * 1.05,
      ],
      a3 = aF + eF,
      wr = [el[0] + sp * 0.5, el[1] - Math.cos(a3) * c2, el[2] + Math.sin(a3)],
      bs = bp(sh),
      be = bp(el),
      bw = bp(wr);
    out.push(0);
    out.pop();
    const A1 = pj(...W(bs)),
      A2 = pj(...W(be)),
      A3 = pj(...W(bw)),
      A4 = pj(
        ...W(
          bp([
            wr[0] + sp * 0.1,
            wr[1] - Math.cos(a3 + wF) * 0.38,
            wr[2] + Math.sin(a3 + wF) * 0.38,
          ]),
        ),
      );
    [
      [A1, A2, 0.34 * k, p.skin],
      [
        A1,
        [
          A1[0] + (A2[0] - A1[0]) * 0.3,
          A1[1] + (A2[1] - A1[1]) * 0.3,
          A1[2],
          A1[3],
        ],
        0.48 * k,
        p.col,
      ],
      [A2, A3, 0.28, p.skin],
      [A3, A4, 0.3, p.skin],
    ].forEach((o) => {
      const B2 = [o[1][0] + 0.01, o[1][1], o[1][2], o[1][3]];
      out.push({
        z: (o[0][3] + B2[3]) / 2,
        A: o[0],
        B: B2,
        w: o[2] * S,
        c: o[3],
      });
    });
  }
  const t = (a, b, wd, col, n) => add(bp(a), bp(b), wd, col, n);
  t([0, 0, 0], [0, 0.7, 0], 1.15 * k, p.col);
  t([0, 0.5, 0], [0, 2, 0], 1.4 * k, p.col, back ? p.no : null);
  t([0, 2, 0], [0, 2.35, 0], 0.3, p.skin);
  t([0, 2.75, 0], [0, 2.75, 0], 0.88, p.skin);
  if (p.hr === 1) t([0, 2.92, -0.08], [0, 2.92, -0.08], 0.86, hc);
  if (p.hr === 2) {
    t([0, 2.9, -0.06], [0, 2.9, -0.06], 0.88, hc);
    t([0, 2.8, -0.35], [0, 2.1, -0.6], 0.3, hc);
  }
  if (p.hr === 3) t([0, 2.95, -0.05], [0, 2.95, -0.05], 1.25, hc);
  if (p.bd) t([0, 2.52, 0.28], [0, 2.52, 0.28], 0.42, hc);
}
function paint(g) {
  const a = g.A,
    b = g.B,
    wp = Math.max(1.5, (g.w * (a[2] + b[2])) / 2);
  X.lineCap = "round";
  X.lineWidth = wp + 2;
  X.strokeStyle = "rgba(0,0,0,.4)";
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(b[0], b[1]);
  X.stroke();
  X.lineWidth = wp;
  X.strokeStyle = g.c;
  X.beginPath();
  X.moveTo(a[0], a[1]);
  X.lineTo(b[0], b[1]);
  X.stroke();
  if (g.n != null) {
    X.fillStyle = "#fff";
    X.font = "900 " + ((wp * 0.5) | 0) + "px system-ui";
    X.textAlign = "center";
    X.fillText(g.n, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + wp * 0.15);
  }
}
function ballD(q) {
  const r = Math.max(2, 0.39 * q[2]);
  X.save();
  X.translate(q[0], q[1]);
  X.rotate(B.a);
  const g = X.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#ff9a4a");
  g.addColorStop(1, "#c4500f");
  X.fillStyle = g;
  X.beginPath();
  X.arc(0, 0, r, 0, 6.3);
  X.fill();
  X.strokeStyle = "#2a1004";
  X.lineWidth = Math.max(1, r * 0.1);
  X.beginPath();
  X.moveTo(-r, 0);
  X.lineTo(r, 0);
  X.moveTo(0, -r);
  X.lineTo(0, r);
  X.stroke();
  X.beginPath();
  X.arc(0, 0, r, 0, 6.3);
  X.stroke();
  X.restore();
}
function pose3(p) {
  const has = B.owner === p,
    air = p.z > 2,
    sp = Math.hypot(p.vx, p.vy),
    spd = Math.min(1, sp / 200),
    s = Math.sin(p.ph),
    md = p.mode,
    w = W3(p.x, p.y, p.z);
  let tL = s * 0.95 * spd,
    tR = -s * 0.95 * spd,
    kL = Math.max(0, -s) * 1.2 * spd + 0.05,
    kR = Math.max(0, s) * 1.2 * spd + 0.05,
    aL = -s * 0.8 * spd,
    aR = s * 0.8 * spd,
    eL = 0.5 + spd * 0.8,
    eR = 0.5 + spd * 0.8,
    sz = 0.1,
    cr = 0,
    ln = 0.12 * spd - (p.brk || 0) * 0.3,
    rz = 0,
    ty = s * 0.25 * spd,
    wR = 0,
    wL = 0,
    zL = null;
  if (air && md !== "s" && md !== "c") {
    tL = 0.6;
    tR = 0.1;
    kL = 1;
    kR = 0.7;
  }
  if (md === "c") {
    wR = -0.5;
    wL = -0.2;
    zL = -0.08;
    aL = aR = 1;
    eL = eR = 1.7;
    cr = 0.5;
    if (PRO && p.sg && p.sg.cl) {
      aR = 0.6;
      eR = 1.3;
      aL = 0.7;
      eL = 1.4;
      cr = 0.3;
    }
    tL = 0.3;
    tR = -0.2;
    kL = kR = 0.8;
    sz = 0.05;
    ty = 0;
  } else if (md === "s" && PRO) {
    const k = Math.min(1, p.t / 0.4),
      o = clip(p, k);
    aR = o.aR;
    eR = o.eR;
    aL = o.aL;
    eL = o.eL;
    tL = o.tL;
    tR = o.tR;
    kL = o.kL;
    kR = o.kR;
    ln = o.ln;
    sz = o.sz;
    cr = p.z < 2 ? o.cr : 0;
    rz = o.rz;
    ty = o.ty;
    wR = o.wR;
    wL = o.wL;
    zL = o.zL;
  } else if (md === "s") {
    const k = Math.min(1, p.t / 0.4),
      v = p.sv,
      e = Math.min(1, k / 0.55),
      se = e * e * (3 - 2 * e),
      rel = k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.15),
      fo = k < 0.7 ? 0 : (k - 0.7) / 0.3;
    aR =
      k < 0.55
        ? 1 + se * 1.25
        : k < 0.7
          ? 2.25 + ((k - 0.55) / 0.15) * 0.7
          : 2.95 - fo * 0.35;
    eR =
      k < 0.55
        ? 1.7 - se * 0.45
        : k < 0.7
          ? 1.25 - ((k - 0.55) / 0.15) * 1.1
          : 0.15 + fo * 0.35;
    aL = k < 0.55 ? 1 + se * 0.95 : Math.max(1.1, 1.95 - rel * 0.8);
    eL = k < 0.55 ? 1.5 : 1.3;
    sz = 0.03 + rel * 0.1;
    ln = -0.05;
    tL = 0.5 - rel * 0.3;
    tR = -0.1;
    kL = 0.9 - rel * 0.7;
    kR = 0.6 - rel * 0.5;
    ty = 0;
    cr = p.z < 2 && k > 0.7 ? 0.5 * Math.min(1, (k - 0.7) / 0.15) : 0;
    if (v === 1) {
      aR = k < 0.4 ? 1 + (k / 0.4) * 1.9 : 2.9 - fo * 0.3;
      eR = k < 0.4 ? 1.7 - (k / 0.4) * 1.5 : 0.2;
      kL = 0.4;
      tL = 0.25;
    }
    if (v === 2) {
      ln = -0.5 * Math.sin(Math.min(1, k * 1.1) * 3.14);
      tL = 1.1;
      kL = 0.2;
      tR = -0.4;
      kR = 0.5;
    }
    if (v === 3) {
      ln = -0.35;
      tL = 0.2;
      tR = -0.5;
      kR = 0.9;
      kL = 0.6;
    }
    if (v === 4) {
      aR = 2.7;
      eR = 0.3;
      aL = 0.5;
      eL = 1;
      ln = 0.15;
      rz = 0.25;
      tL = 0.3;
    }
    if (v === 5) {
      aR = 3;
      eR = 0.2;
      aL = 0.5;
      eL = 1.3;
      ln = 0.3;
      tL = 1.5;
      kL = 1.5;
      tR = -0.4;
      kR = 0.3;
    }
    if (v === 6) {
      aR = aL = k < 0.7 ? 3 : 1.7;
      eR = eL = 0.2;
      ln = 0.1;
      tL = 0.7;
      tR = 0.2;
      kL = kR = 0.8;
      sz = 0.2;
    }
  } else if (md === "b") {
    ln = -0.38;
    tL = Math.sin(p.t * 28) * 0.7;
    tR = -tL;
    kL = Math.max(0, -tL) + 0.4;
    kR = Math.max(0, tL) + 0.4;
    aR = 0.7 + Math.sin(p.t * 22) * 0.5;
    eR = 1.2;
    aL = 0.5;
    eL = 1;
    cr = 0.3;
    ty = Math.sin(p.t * 22) * 0.3;
  } else if (has) {
    {
      const u = PRO
        ? clamp((B.z - 6) / 30, 0, 1)
        : Math.abs(Math.sin(T * 8 + p.k));
      aR = PRO ? 0.5 + u * 0.45 : 0.55 + u * 0.8;
      eR = PRO ? 0.25 + u * 1.1 : 0.9;
      if (PRO) wR = 0.8 - u * 1.2;
    }
    aL = 0.4 + spd * 0.3;
    eL = 1;
    cr = 0.2;
    ln = 0.08 + spd * 0.2;
    ty = 0;
  } else if (air) {
    aL = aR = 3;
    eL = eR = 0.1;
    sz = 0.12;
  } else if (pos !== p.tm) {
    aL = aR = 0.6;
    eL = eR = 0.9;
    sz = 1.1 + Math.sin(T * 8 + p.k) * 0.1;
    cr = 0.4;
    tL = s * 0.5 * spd + 0.35;
    tR = -s * 0.5 * spd + 0.35;
    kL = kR = 0.8;
    ln = 0.18;
  }
  let hz = 0;
  {
    const sv = Math.hypot(p.vx, p.vy),
      def = pos !== p.tm && B.owner;
    if (md === "i" && !air && sv > 25) {
      const cf = Math.cos(p.f),
        sf = Math.sin(p.f),
        fw = (p.vx * cf + p.vy * sf) / sv,
        sd2 = (-p.vx * sf + p.vy * cf) / sv;
      if (!def && !(p.mvT > 0)) {
        tL *= fw;
        tR *= fw;
        kL = Math.max(0.05, kL * Math.abs(fw));
        kR = Math.max(0.05, kR * Math.abs(fw));
        if (fw < -0.3) ln -= 0.12;
      }
      hz = Math.abs(sd2) * (0.16 + 0.14 * Math.abs(s)) * spd + (def ? 0.12 : 0);
      cr += Math.abs(sd2) * 0.15 * spd;
    } else if (def && !air) hz = 0.14;
    if (PRO && has && md === "i" && !(p.mvT > 0) && !p.postA) {
      const S2 = p.ht / 6.4,
        w = W3(p.x, p.y, p.z),
        b = W3(B.x, B.y, B.z),
        th = Math.PI / 2 - p.f,
        X1 = b[0] - w[0],
        Y1 = b[1] - (w[1] - cr * 0.4),
        Z1 = b[2] - w[2],
        lx = (X1 * Math.cos(th) - Z1 * Math.sin(th)) / S2,
        lz = (X1 * Math.sin(th) + Z1 * Math.cos(th)) / S2,
        tx = lx - 0.82 * p.bk,
        ty = Y1 / S2 - 5.1,
        tz = lz,
        L1 = 1.02,
        L2 = 1.15,
        d = Math.min(L1 + L2 - 0.02, Math.max(0.3, Math.hypot(tx, ty, tz))),
        ph2 = Math.atan2(tz, -ty),
        al = Math.acos(
          clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1),
        );
      aR = ph2 - al;
      eR =
        Math.PI -
        Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      sz = clamp(Math.atan2(tx, Math.max(0.2, -ty)), -0.4, 0.6);
    }
    if (
      def &&
      !air &&
      (B.owner.mode === "c" || B.owner.mode === "s") &&
      Math.hypot(B.owner.x - p.x, B.owner.y - p.y) < 70
    ) {
      aR = 2.9;
      eR = 0.15;
      aL = 1.3;
      eL = 0.6;
    }
    if (p.pT > 0) {
      aL = aR = 1.5;
      eL = eR = 0.25;
      ln += 0.1;
    }
    if (B.mode === "pass" && B.to === p && !air) {
      aL = aR = 1.35;
      eL = eR = 0.5;
      zL = 0.15;
    }
  }
  if (p.mvT > 0) {
    const e = p.mvE || 0,
      sd = p.mvS || 1;
    if (p.mvk === 2) {
      ty += (e / 0.45) * 6.283 * sd;
      ln = 0.25;
      cr = 0.2;
    } else if (p.mvk === 1) {
      cr = e < 0.22 ? 0.55 : 0.1;
      ln = e < 0.22 ? -0.12 : 0.35;
    } else if (p.mvk === 3) {
      ty += Math.sin(e * 10) * 0.9 * sd;
      ln = 0.2;
      aR = 0.3;
      eR = 0.4;
    } else {
      ln = 0.3;
      cr = 0.2;
    }
  }
  if (p.postA) {
    cr = 0.45;
    ln = 0.25;
    sz = 0.8;
    aL = 1.2;
  }
  {
    const n = {
      tL,
      tR,
      kL,
      kR,
      aL,
      aR,
      eL,
      eR,
      sz,
      cr,
      ln,
      rz,
      ty,
      wR,
      wL,
      zL: zL == null ? sz : zL,
      hz,
    };
    if (PRO && p.q && p.q.wR != null) {
      const f = Math.min(1, DT * 20);
      for (const kk in n)
        if (kk !== "wR" && p.q[kk] != null)
          n[kk] = p.q[kk] + (n[kk] - p.q[kk]) * f;
    }
    p.q = n;
  }
}
function foul(d, o, k, sh, th) {
  tf[d.tm]++;
  d.pf++;
  txt(k + " FOUL", ...pr(d.x, d.y, 95), "#ff6b4a");
  snd(120, 0.3, "sawtooth", 0.1);
  B.sh = 0;
  B.ft = 0;
  const n = sh ? (th ? 3 : 2) : tf[d.tm] >= 5 ? 2 : 0;
  if (n) startFT(o, n, 0, 0);
  else {
    B.owner = o;
    B.mode = "held";
    setup(o.tm);
  }
}
function tech(d, ret) {
  txt("TECHNICAL FOUL", ...pr(d.x, d.y, 95), "#ff3b3b");
  let b = null;
  for (const p of P) if (p.tm !== d.tm && (!b || p.c > b.c)) b = p;
  B.sh = 0;
  startFT(b, 1, ret, 1);
}
function startFT(s, n, ret, tech) {
  ftq = { s, n, i: -1, ret, tech, next: 0.9, w: 1.2, fired: 0 };
}
function ftLay() {
  const f = ftq,
    s = f.s,
    hx = hoop(s.tm),
    d = hx > 470 ? -1 : 1,
    fc = hx > 470 ? 0 : Math.PI;
  let m = 0;
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    if (p !== s) {
      p.x = hx + d * (70 + (m >> 1) * 28);
      p.y = 250 + (m & 1 ? 46 : -46);
      p.f = fc;
      m++;
    }
  });
  s.x = hx + d * 137;
  s.y = 250;
  s.f = fc;
  s.ai = {};
  B.owner = s;
  B.mode = "held";
  B.sh = 0;
  B.sc = 0;
  B.ft = 1;
  pos = s.tm;
  shot = 24;
}
function ftTick(dt) {
  const f = ftq;
  if (!f) return;
  if (f.next > 0) {
    f.next -= dt;
    if (f.next <= 0) {
      f.fired = 0;
      f.w = 1.1;
      if (f.i + 1 < f.n) {
        f.i++;
        ftLay();
      } else {
        ftq = null;
        if (f.tech) setup(f.ret);
      }
    }
    return;
  }
  if (f.fired && !B.sc && B.age > 1.3 && !B.owner) f.next = 0.3;
}
function ftIn(h, dt) {
  const f = ftq;
  if (!f || f.i < 0) return;
  const s = f.s,
    a = s.ai;
  if (s.tm === 0 && (!MYM || s.my)) {
    ap = s.k;
    s.in = { dx: 0, dy: 0, sd: h.sd, su: h.su };
  } else if (MP2 && s.tm === 1 && H2) {
    ap2 = NP + s.k;
    s.in = { dx: 0, dy: 0, sd: H2.sd, su: H2.su };
  } else {
    s.in = { dx: 0, dy: 0 };
    f.w -= dt;
    if (f.w < 0 && s.mode === "i" && !f.fired) {
      s.in.sd = 1;
      a.rel = 0.6 + (Math.random() - 0.5) * 0.1;
    }
    if (s.mode === "c" && s.t >= (a.rel || 0.6)) s.in.su = 1;
  }
}
const OFFS = [null, null],
  ACT = [
    { c: -1, done: 0 },
    { c: -1, done: 0 },
  ];
function offBall(p, t) {
  const hx = hoop(t),
    dir = hx > 470 ? -1 : 1,
    tt = T + t * 1.7,
    ph = tt % 3.6,
    cyc = Math.floor(tt / 3.6),
    side = cyc % 2 ? 1 : -1,
    h = B.owner,
    ms = P.filter((q) => q.tm === t && q !== h),
    S = ACT[t];
  OFFS[t] = null;
  if (ms.length < 2) return false;
  if (S.c !== cyc) {
    S.c = cyc;
    S.done = 0;
  }
  const big = (a, b) => b.ht * b.bk - a.ht * a.bk,
    sh = ms.reduce(
      (a, q) =>
        !a ||
        q.c + 30 * ((q.sg && q.sg.off) || 0) >
          a.c + 30 * ((a.sg && a.sg.off) || 0)
          ? q
          : a,
      null,
    );
  if (cyc % 2 === 0) {
    if (sh.c < 70) return false;
    const scr = ms.filter((q) => q !== sh).sort(big)[0],
      df = P[(1 - t) * NP + sh.k],
      post = [hx + dir * 130, HY + side * 85];
    if (ph < 1.9 && Math.hypot(scr.x - df.x, scr.y - df.y) < 40) {
      df.scr = Math.max(df.scr || 0, 0.6);
      scr.setT = 0.5;
    }
    if (ph > 1.7 && Math.hypot(sh.x - df.x, sh.y - df.y) > 38) OFFS[t] = sh;
    if (p === sh) {
      const g =
        ph < 0.9
          ? [hx + dir * 60, HY - side * 150]
          : ph < 1.9
            ? [post[0] + dir * 8, post[1] - side * 14]
            : [hx + dir * 215, HY + side * 125];
      mv(p, g[0], g[1], ph < 1.9 ? 1.2 : 0.9);
      return true;
    }
    if (p === scr) {
      if (ph < 1.9)
        mv(p, post[0] * 0.6 + df.x * 0.4, post[1] * 0.6 + df.y * 0.4, 1.1);
      else mv(p, hx + dir * 38, HY + side * 22, 1);
      return true;
    }
    return cut(p, t);
  }
  const sc = ms.filter((q) => q !== sh || ms.length < 3).sort(big)[0],
    d1 = P[(1 - t) * NP + h.k],
    dd = P[(1 - t) * NP + sc.k],
    spot = [d1.x + (hx - d1.x) * 0.1, d1.y + (HY - d1.y) * 0.1];
  if (ph > 2 && Math.hypot(sc.x - dd.x, sc.y - dd.y) > 38) OFFS[t] = sc;
  if (p !== sc) {
    if (p.sg && p.sg.off >= 0.9) {
      const a = T * 1.1 + p.k;
      mv(
        p,
        hx + dir * (195 + 25 * Math.sin(a * 1.3)),
        HY + Math.sin(a) * 185,
        1.1,
      );
      return true;
    }
    return cut(p, t);
  }
  if (ph < 1.5) {
    mv(p, spot[0], spot[1], 1.15);
    if (Math.hypot(p.x - d1.x, p.y - d1.y) < 26) {
      p.setT = 0.5;
      d1.scr = Math.max(d1.scr || 0, 0.6);
    }
    return true;
  }
  if (!S.done) {
    S.done = 1;
    if (Math.random() < 0.45) {
      d1.man = t * NP + sc.k;
      d1.manT = 2.5;
      dd.man = t * NP + h.k;
      dd.manT = 2.5;
      txt("SWITCH", ...pr(dd.x, dd.y, 95), "#9ad");
    }
  }
  const roll = sc.i >= 75 && sc.c < 80,
    g = roll
      ? [hx + dir * 42, HY + side * 18]
      : [hx + dir * 215, HY + side * 105];
  mv(p, g[0], g[1], 1.05);
  return true;
}
function passMark() {
  const p = P[ap];
  if (!p || B.owner !== p || ftq || inb > 0) return;
  const i = {
      dx: (K.ArrowRight || K.KeyD ? 1 : 0) - (K.ArrowLeft || K.KeyA ? 1 : 0),
      dy: (K.ArrowDown || K.KeyS ? 1 : 0) - (K.ArrowUp || K.KeyW ? 1 : 0),
    },
    r = pick(p, i);
  if (!r || r === p) return;
  const q = pr(r.x, r.y, r.z + 92);
  X.fillStyle = "#ffd23f";
  X.font = "800 14px system-ui";
  X.textAlign = "center";
  X.fillText("▼", q[0], q[1]);
}
function openMark() {
  const o = OFFS[0];
  if (!o || !B.owner || B.owner.tm !== 0 || B.owner === o) return;
  const q = pr(o.x, o.y, o.z + 85);
  X.fillStyle = "#2ecc71";
  X.font = "800 12px system-ui";
  X.textAlign = "center";
  X.fillText("▼ OPEN", q[0], q[1]);
}
function loose(p, t) {
  const i = p.in,
    hx = B.last ? hoop(B.last.tm) : hoop(t),
    dir = hx > 470 ? -1 : 1,
    own = [];
  for (let k = 0; k < NP; k++) {
    const q = P[p.tm * NP + k];
    own.push([Math.hypot(q.x - hx, q.y - HY), k]);
  }
  own.sort((a, b) => a[0] - b[0]);
  const rk = own.findIndex((v) => v[1] === p.k),
    K2 = NP > 2 ? 2 : 1,
    d = Math.hypot(B.x - p.x, B.y - p.y),
    sh = B.last && B.last.tm === p.tm,
    fly =
      B.sh &&
      B.last &&
      B.z > 45 &&
      B.age < 1.3 &&
      B.vz > -120 &&
      Math.hypot(B.x - hx, B.y - HY) > 40;
  if (fly) {
    if (rk < K2)
      mv(
        p,
        hx + dir * (26 + rk * 22),
        HY + (rk ? 36 : -8) * (p.k % 2 ? 1 : -1),
        1.1,
      );
    else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
    else mv(p, hx + dir * 70, HY + (p.k - 2) * 50, 0.8);
  } else {
    const nr = [...Array(NP).keys()]
      .map((k) => [
        Math.hypot(P[p.tm * NP + k].x - B.x, P[p.tm * NP + k].y - B.y),
        k,
      ])
      .sort((a, b) => a[0] - b[0])
      .slice(0, K2)
      .some((v) => v[1] === p.k);
    if (nr || d < 90) {
      mv(p, B.x + B.vx * 0.25, B.y + B.vy * 0.25, 1.15);
      if (B.z > 50 && d < 28 && p.z <= 0) i.sd = 1;
    } else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
    else mv(p, hx + dir * 80, HY + (p.k - 2) * 50, 0.8);
  }
}
const CL = {
    jump: {
      aR: [0, 1, 0.55, 2.25, 0.7, 2.95, 1, 2.6],
      eR: [0, 1.7, 0.55, 1.25, 0.7, 0.15, 1, 0.5],
      aL: [0, 1, 0.55, 1.95, 0.75, 1.1, 1, 1.1],
      eL: [0, 1.5, 1, 1.3],
      tL: [0, 0.5, 0.6, 0.5, 0.75, 0.2, 1, 0.2],
      tR: [0, -0.1, 1, -0.1],
      kL: [0, 0.9, 0.6, 0.9, 0.75, 0.2, 1, 0.2],
      kR: [0, 0.6, 0.6, 0.6, 0.75, 0.1, 1, 0.1],
      ln: [0, -0.05, 1, -0.05],
      sz: [0, 0.03, 0.6, 0.03, 0.75, 0.13, 1, 0.13],
      cr: [0, 0, 0.7, 0, 0.85, 0.5, 1, 0.5],
      rz: [0, 0, 1, 0],
      ty: [0, 0, 1, 0],
      wR: [0, -0.5, 0.5, -0.8, 0.62, -0.8, 0.7, 1.1, 1, 1.1],
      wL: [0, -0.2, 0.55, -0.3, 0.7, 0.2, 1, 0.2],
      zL: [0, -0.08, 0.55, -0.1, 0.65, -0.1, 0.85, 0.5, 1, 0.55],
    },
    hook: {
      aR: [0, 1.2, 0.4, 2, 0.6, 3.1, 0.9, 3.3, 1, 3.2],
      eR: [0, 0.8, 0.6, 0.1, 1, 0.1],
      aL: [0, 1.4, 0.5, 1.2, 1, 1],
      eL: [0, 1, 1, 1],
      ty: [0, 1.4, 1, 1.4],
      rz: [0, 0.15, 1, 0.1],
      ln: [0, 0.05, 1, 0.05],
      tL: [0, 0.2, 1, 0.2],
      tR: [0, -0.1, 1, -0.1],
      kL: [0, 0.5, 1, 0.5],
      kR: [0, 0.5, 1, 0.5],
      wR: [0, 0, 0.8, 0.3, 0.95, 1, 1, 1],
      sz: [0, 0.2, 1, 0.2],
    },
    curry: {
      aR: [0, 0.6, 0.3, 1.2, 0.55, 2.2, 0.72, 2.95, 1, 3],
      eR: [0, 1.3, 0.3, 1.45, 0.5, 1.1, 0.72, 0.12, 1, 0.1],
      aL: [0, 0.7, 0.3, 1.2, 0.55, 1.9, 0.78, 2.5, 1, 2.65],
      eL: [0, 1.4, 0.55, 1.3, 0.78, 1.2, 1, 1],
      tL: [0, -0.05, 0.5, 0, 0.75, 0.15, 1, 0.1],
      tR: [0, 0.18, 0.5, 0.15, 0.75, 0.1, 1, 0.08],
      kL: [0, 0.5, 0.55, 0.5, 0.78, 0.1, 1, 0.1],
      kR: [0, 0.55, 0.55, 0.5, 0.78, 0.1, 1, 0.1],
      ln: [0, 0.04, 1, 0.02],
      sz: [0, 0.25, 0.35, 0.1, 0.7, 0, 1, 0.04],
      cr: [0, 0.3, 0.5, 0.1, 0.7, 0, 1, 0.4],
      wR: [0, -0.5, 0.55, -0.7, 0.7, -0.8, 0.78, 1.15, 1, 1.15],
      wL: [0, -0.1, 0.6, -0.3, 0.78, -0.5, 1, -0.6],
      zL: [0, -0.05, 0.5, -0.08, 0.72, 0.1, 0.9, 0.4, 1, 0.45],
    },
    quick: {
      wR: [0, -0.5, 0.38, -0.8, 0.46, 1.1, 1, 1.1],
      wL: [0, -0.2, 0.4, -0.3, 0.5, 0.2, 1, 0.2],
      zL: [0, -0.08, 0.4, -0.1, 0.5, 0.5, 1, 0.55],
      aR: [0, 1, 0.4, 2.9, 1, 2.6],
      eR: [0, 1.7, 0.4, 0.2, 1, 0.5],
      kL: [0, 0.4, 1, 0.4],
      tL: [0, 0.25, 1, 0.25],
    },
    fade: {
      ty: [0, -1.1, 0.5, 0, 1, 0],
      ln: [0, 0, 0.5, -0.5, 1, -0.1],
      tL: [0, 1.1, 1, 1.1],
      kL: [0, 0.2, 1, 0.2],
      tR: [0, -0.4, 1, -0.4],
      kR: [0, 0.5, 1, 0.5],
    },
    step: {
      ln: [0, -0.35, 1, -0.35],
      tL: [0, 0.2, 1, 0.2],
      tR: [0, -0.5, 1, -0.5],
      kR: [0, 0.9, 1, 0.9],
      kL: [0, 0.6, 1, 0.6],
    },
    float: {
      wR: [0, -0.3, 0.5, -0.4, 0.6, 0.9, 1, 0.9],
      aR: [0, 1, 0.5, 2.7, 1, 2.4],
      eR: [0, 1.6, 0.5, 0.3, 1, 0.3],
      aL: [0, 0.5, 1, 0.5],
      eL: [0, 1, 1, 1],
      ln: [0, 0.15, 1, 0.15],
      rz: [0, 0.25, 1, 0.25],
      tL: [0, 0.3, 1, 0.3],
    },
    lay: {
      wR: [0, -0.2, 0.4, 0.7, 1, 0.7],
      wL: [0, 0, 1, 0],
      zL: [0, 0.3, 1, 0.3],
      aR: [0, 2, 0.4, 3, 1, 3],
      eR: [0, 0.8, 0.4, 0.2, 1, 0.2],
      aL: [0, 0.5, 1, 0.5],
      eL: [0, 1.3, 1, 1.3],
      ln: [0, 0.3, 1, 0.3],
      tL: [0, 1.5, 1, 1.5],
      kL: [0, 1.5, 1, 1.5],
      tR: [0, -0.4, 1, -0.4],
      kR: [0, 0.3, 1, 0.3],
    },
    dunk: {
      wR: [0, 0, 0.5, -0.3, 0.7, 0.8, 1, 0.8],
      wL: [0, 0, 0.5, -0.3, 0.7, 0.8, 1, 0.8],
      zL: [0, 0.2, 1, 0.2],
      aR: [0, 2, 0.4, 3, 0.7, 3, 0.9, 1.7],
      aL: [0, 2, 0.4, 3, 0.7, 3, 0.9, 1.7],
      eR: [0, 0.4, 1, 0.2],
      eL: [0, 0.4, 1, 0.2],
      ln: [0, 0.1, 1, 0.1],
      tL: [0, 0.7, 1, 0.7],
      tR: [0, 0.2, 1, 0.2],
      kL: [0, 0.8, 1, 0.8],
      kR: [0, 0.8, 1, 0.8],
      sz: [0, 0.2, 1, 0.2],
    },
    euro: {
      wR: [0, -0.2, 0.45, 0.7, 1, 0.7],
      zL: [0, 0.3, 1, 0.3],
      aR: [0, 1.4, 0.45, 3, 1, 3],
      eR: [0, 1, 0.45, 0.2, 1, 0.2],
      aL: [0, 0.8, 1, 0.8],
      eL: [0, 1.2, 1, 1.2],
      ln: [0, 0.2, 1, 0.2],
      rz: [0, -0.3, 0.5, 0.3, 1, 0.2],
      tL: [0, 1.2, 0.5, 0.9, 1, 0.9],
      kL: [0, 1.2, 1, 1.2],
      tR: [0, -0.5, 1, -0.5],
      kR: [0, 0.5, 1, 0.5],
      ty: [0, 0.5, 1, -0.3],
    },
    hop: {
      wR: [0, -0.5, 0.45, -0.8, 0.58, 1.1, 1, 1.1],
      aR: [0, 1, 0.45, 2.4, 0.65, 2.95, 1, 2.6],
      eR: [0, 1.6, 0.45, 1.1, 0.65, 0.15, 1, 0.5],
      tL: [0, 0.8, 1, 0.4],
      tR: [0, 0.3, 1, -0.1],
      kL: [0, 1.1, 1, 0.4],
      kR: [0, 0.8, 1, 0.3],
      ln: [0, 0.18, 0.6, -0.05, 1, -0.05],
    },
  },
  CK = [
    "jump",
    "quick",
    "fade",
    "step",
    "float",
    "lay",
    "dunk",
    "euro",
    "hop",
    "curry",
    "hook",
  ],
  SIG = {
    Curry: { cl: 1, w: 0.15, off: 1 },
    Doncic: { l: -0.28, f: 0.05 },
    Jokic: { a: -0.2, k: 0.3, l: 0.06 },
    Wembanyama: { a: 0.4, g: 0.5, w: 0.2 },
    Edwards: { k: 0.2, f: 0.05 },
    "Gilgeous-Alexander": { a: 0.1, l: -0.16 },
    Brunson: { l: -0.1, k: 0.05 },
    Towns: { a: 0.1, l: -0.12 },
    Fox: { k: 0.12, l: -0.08 },
    "LaMelo Ball": { k: 0.15, l: -0.2, f: 0.06 },
    Porzingis: { a: 0.3, l: -0.15 },
    Holmgren: { a: 0.28, l: -0.08 },
  };
function smp(a, k) {
  if (!a) return null;
  if (k <= a[0]) return a[1];
  for (let i = 2; i < a.length; i += 2)
    if (k <= a[i]) {
      const u = (k - a[i - 2]) / (a[i] - a[i - 2]),
        s = u * u * (3 - 2 * u);
      return a[i - 1] + (a[i + 1] - a[i - 1]) * s;
    }
  return a[a.length - 1];
}
function clip(p, k) {
  const c = CL[CK[p.sv]] || CL.jump,
    o = {};
  for (const n of [
    "aR",
    "eR",
    "aL",
    "eL",
    "tL",
    "tR",
    "kL",
    "kR",
    "ln",
    "sz",
    "cr",
    "rz",
    "ty",
    "wR",
    "wL",
    "zL",
  ]) {
    const v = smp(c[n], k);
    o[n] = v == null ? smp(CL.jump[n], k) : v;
  }
  const g = p.sg || {},
    up = Math.min(1, k / 0.7);
  o.aR += (g.a || 0) * up;
  o.sz += (g.f || 0) * up;
  o.ln += (g.l || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.tL += (g.k || 0) * (k > 0.5 ? 1 : 0);
  o.aL -= (g.g || 0) * 0.4 * (k > 0.7 ? (k - 0.7) / 0.3 : 0);
  o.wR *= 1 + (g.w || 0);
  if (CK[p.sv] === "curry" && p.sbw > 0) {
    o.ln -= 0.22;
    o.tR -= 0.2;
  }
  return o;
}
function pickClip(p, D, lay) {
  if (p.fsv != null) {
    const v = p.fsv;
    p.fsv = null;
    return v;
  }
  const c = contestOf(p)[0],
    dir = hoop(p.tm) > 470 ? 1 : -1,
    fw = p.vx * dir,
    sp = Math.hypot(p.vx, p.vy);
  if (lay) {
    if (D < 50 && p.j >= 55) return 6;
    return c > 0.35 && sp > 60 ? 7 : 5;
  }
  if (p.sg && p.sg.cl) return 9;
  if (p.sbw > 0) return 3;
  if (fw > 110 && D > 110) return 8;
  if (p.st === 4) return 4;
  if (p.st === 2 || (c > 0.5 && p.st !== 1)) return 2;
  if (p.st === 3) return 3;
  return p.st === 1 ? 1 : 0;
}
function dz(o, dt) {
  if (B.dh == null) {
    B.dh = 30;
    B.dvv = 0;
  }
  const sp = Math.hypot(o.vx, o.vy);
  B.dvv -= g * dt;
  B.dh += B.dvv * dt;
  const top = o.z + 34 + Math.min(8, sp * 0.03);
  if (B.dh > top) {
    B.dh = top;
    B.dvv = -(150 + sp * 0.25);
  }
  if (B.dh < 4) {
    B.dh = 4;
    B.dvv = Math.abs(B.dvv) * 0.88;
  }
  return B.dh;
}
function collide() {
  for (let a = 0; a < P.length; a++)
    for (let b = a + 1; b < P.length; b++) {
      const A = P[a],
        C = P[b],
        dx = A.x - C.x,
        dy = A.y - C.y,
        d = Math.hypot(dx, dy);
      if (d < 16 && d > 0 && A.z < 8 && C.z < 8) {
        if (!PRO) {
          const s = (16 - d) / 2 / d;
          A.x += dx * s;
          A.y += dy * s;
          C.x -= dx * s;
          C.y -= dy * s;
          continue;
        }
        const nx = dx / d,
          ny = dy / d,
          mA = A.bk * A.ht * (A.setT > 0 ? 3 : A.postA ? 1.7 : 1),
          mC = C.bk * C.ht * (C.setT > 0 ? 3 : C.postA ? 1.7 : 1),
          rv = (A.vx - C.vx) * nx + (A.vy - C.vy) * ny,
          ov = 16 - d;
        A.x += (nx * ov * mC) / (mA + mC);
        A.y += (ny * ov * mC) / (mA + mC);
        C.x -= (nx * ov * mA) / (mA + mC);
        C.y -= (ny * ov * mA) / (mA + mC);
        if (rv < 0) {
          const j = (-1.05 * rv) / (1 / mA + 1 / mC),
            hit = -rv;
          A.vx += (j * nx) / mA;
          A.vy += (j * ny) / mA;
          C.vx -= (j * nx) / mC;
          C.vy -= (j * ny) / mC;
          if (hit > 150 && fc <= 0 && rs <= 0 && !ftq && inb <= 0) {
            const sx = A.setT > 0 ? A : C.setT > 0 ? C : null;
            if (sx) {
              const o = sx === A ? C : A;
              if (
                o.tm !== sx.tm &&
                Math.hypot(sx.vx, sx.vy) > 110 &&
                Math.random() < 0.35
              ) {
                fc = 2;
                txt("ILLEGAL SCREEN", ...pr(sx.x, sx.y, 95), "#ff6b4a");
                tf[sx.tm]++;
                sx.pf++;
                setup(o.tm);
              }
            }
          }
          if (hit > 60) {
            for (const q of [A, C]) {
              if (hit > 120) q.slow = Math.max(q.slow, 0.12);
              if (q.mode === "c" || q.mode === "s")
                q.bmp = Math.min(1, (q.bmp || 0) + hit / 260);
            }
            const h = B.owner;
            if (
              hit > 170 &&
              fc <= 0 &&
              rs <= 0 &&
              !ftq &&
              inb <= 0 &&
              h &&
              (A === h || C === h)
            ) {
              const o = A === h ? C : A;
              fc = 2;
              if (o.tm !== h.tm) {
                const sh = h.mode === "c" || h.mode === "s";
                if (
                  Math.hypot(o.vx, o.vy) < 70 &&
                  Math.hypot(h.vx, h.vy) > 170 &&
                  Math.random() < 0.5
                ) {
                  txt("OFFENSIVE FOUL", ...pr(h.x, h.y, 95), "#ff6b4a");
                  tf[h.tm]++;
                  h.pf++;
                  setup(o.tm);
                } else if (Math.random() < 0.3)
                  foul(o, h, sh ? "SHOOTING" : "BLOCKING", sh ? 1 : 0, 0);
              }
            }
          }
        }
      }
    }
}
const NETS = HXs.map((hx) => {
  const p = [],
    c = [],
    S = 12,
    R = [
      [7.5, 100],
      [6.4, 93],
      [5.4, 86],
      [4.6, 80],
    ],
    gr = [];
  for (let r = 0; r < 4; r++) {
    gr.push([]);
    for (let k = 0; k < S; k++) {
      const a = (k / S) * 6.283 + (r % 2 ? 3.1416 / S : 0),
        q = {
          x: hx + Math.cos(a) * R[r][0],
          y: HY + Math.sin(a) * R[r][0],
          z: R[r][1],
          f: r === 0,
        };
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      p.push(q);
      gr[r].push(q);
    }
  }
  const L = (a, b) =>
    c.push([a, b, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)]);
  for (let r = 1; r < 4; r++)
    for (let k = 0; k < S; k++) {
      L(gr[r][k], gr[r - 1][k]);
      L(gr[r][k], gr[r - 1][(k + 1) % S]);
      L(gr[r][k], gr[r][(k + 1) % S]);
    }
  return { p, c };
});
function netSim(dt) {
  for (const N of NETS) {
    for (const q of N.p) {
      if (q.f) continue;
      const vx = (q.x - q.px) * 0.95,
        vy = (q.y - q.py) * 0.95,
        vz = (q.z - q.pz) * 0.95;
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      q.x += vx;
      q.y += vy;
      q.z += vz - g * dt * dt * 0.6;
    }
    for (let it = 0; it < 4; it++) {
      for (const c of N.c) {
        const a = c[0],
          b = c[1],
          dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z,
          d = Math.hypot(dx, dy, dz) || 1,
          f = ((d - c[2]) / d) * 0.5;
        if (!a.f) {
          a.x += dx * f;
          a.y += dy * f;
          a.z += dz * f;
        }
        if (!b.f) {
          b.x -= dx * f;
          b.y -= dy * f;
          b.z -= dz * f;
        }
      }
      if (!B.owner)
        for (const q of N.p) {
          if (q.f) continue;
          const dx = q.x - B.x,
            dy = q.y - B.y,
            dz = q.z - B.z,
            d = Math.hypot(dx, dy, dz);
          if (d < BR + 1.2 && d > 0) {
            const s = (BR + 1.2 - d) / d;
            q.x += dx * s;
            q.y += dy * s;
            q.z += dz * s;
          }
        }
    }
  }
}
function drawNet(b, pf) {
  X.strokeStyle = "rgba(255,255,255,.8)";
  X.lineWidth = 1.1;
  X.beginPath();
  for (const c of NETS[b].c) {
    const u = pf(c[0].x, c[0].y, c[0].z),
      v = pf(c[1].x, c[1].y, c[1].z);
    X.moveTo(u[0], u[1]);
    X.lineTo(v[0], v[1]);
  }
  X.stroke();
}
function cut(p, t) {
  const hx = hoop(t),
    dir = hx > 470 ? -1 : 1,
    ph = (T * 0.7 + p.k * 1.3) % 4;
  if (ph < 0.8) {
    mv(p, hx + dir * 40, HY + (p.k % 2 ? 30 : -30), 1.1);
    return true;
  }
  if (ph < 1.8) {
    mv(p, hx + dir * 215, HY + (p.k % 2 ? 1 : -1) * (80 + p.k * 20), 1);
    return true;
  }
  return false;
}
const isH = (p) => p === P[ap] || (MP2 && p === P[ap2]);
function hum2() {
  const i = {
    dx: (K.ArrowRight ? 1 : 0) - (K.ArrowLeft ? 1 : 0),
    dy: (K.ArrowDown ? 1 : 0) - (K.ArrowUp ? 1 : 0),
    sd: ev2.sd,
    su: ev2.su,
    e: ev2.e,
    mv: ev2.cc ? 1 : ev2.x ? 2 : 0,
    sp: K.ShiftRight,
  };
  const m = Math.hypot(i.dx, i.dy);
  if (m > 1) {
    i.dx /= m;
    i.dy /= m;
  }
  ev2.sd = ev2.su = ev2.e = ev2.x = ev2.cc = 0;
  return i;
}
let GL = null;
const qtr = () => q;
function glInit() {
  try {
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    const R = new THREE.WebGLRenderer({
      canvas: C,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!R.getContext()) throw 0;
    const mob = matchMedia("(pointer:coarse)").matches;
    R.setPixelRatio(Math.min(devicePixelRatio || 1, mob ? 1.25 : 1.75));
    R.setSize(960, 540, false);
    R.shadowMap.enabled = true;
    R.shadowMap.type = mob ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    R.outputEncoding = THREE.sRGBEncoding;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.1;
    const S = new THREE.Scene();
    S.background = new THREE.Color(0x05060d);
    S.fog = new THREE.Fog(0x05060d, 85, 200);
    const cam = new THREE.PerspectiveCamera(40, 960 / 540, 0.5, 400);
    S.add(new THREE.HemisphereLight(0xe8eeff, 0x3b2a18, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.15);
    sun.position.set(12, 55, 24);
    sun.castShadow = true;
    const sm = mob ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, {
      left: -52,
      right: 52,
      top: 30,
      bottom: -30,
      near: 5,
      far: 140,
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    S.add(sun);
    for (const x of [-32, 0, 32]) {
      const s = new THREE.PointLight(0xfff0d8, 0.35, 90);
      s.position.set(x, 30, 0);
      S.add(s);
    }
    const M = (c, o = {}) =>
        new THREE.MeshStandardMaterial(
          Object.assign({ color: c, roughness: 0.6 }, o),
        ),
      ad = (g, m, x, y, z) => {
        const k = new THREE.Mesh(g, m);
        k.position.set(x, y, z);
        k.castShadow = k.receiveShadow = true;
        S.add(k);
        return k;
      },
      cv = (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return [c, c.getContext("2d")];
      },
      TX2 = (c) => {
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        return t;
      };
    const [ct, c2] = cv(2048, 1024),
      tex = TX2(ct);
    tex.anisotropy = R.capabilities.getMaxAnisotropy();
    let pcK = "";
    function court() {
      const c = c2;
      c.setTransform(2048 / 940, 0, 0, 1024 / 500, 0, 0);
      const g = c.createLinearGradient(0, 0, 940, 0);
      g.addColorStop(0, "#c48a4a");
      g.addColorStop(0.5, "#dcaa6a");
      g.addColorStop(1, "#c48a4a");
      c.fillStyle = g;
      c.fillRect(0, 0, 940, 500);
      for (let y = 0; y < 500; y += 6) {
        c.fillStyle = y % 12 ? "rgba(90,50,15,.07)" : "rgba(255,230,190,.05)";
        c.fillRect(0, y, 940, 3);
      }
      for (let i = 0; i < 600; i++) {
        c.fillStyle = "rgba(70,40,10,.06)";
        c.fillRect(
          Math.random() * 940,
          Math.floor(Math.random() * 83) * 6,
          30 + Math.random() * 90,
          1,
        );
      }
      c.globalAlpha = 0.8;
      c.fillStyle = PC[0] || "#7b3fb5";
      c.fillRect(0, 170, 190, 160);
      c.fillStyle = PC[1] || "#1d428a";
      c.fillRect(750, 170, 190, 160);
      c.globalAlpha = 0.2;
      c.beginPath();
      c.arc(470, 250, 60, 0, 6.3);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = "#fff";
      c.lineWidth = 2.6;
      const st = (a) => {
        c.beginPath();
        a.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
      };
      c.strokeRect(1.5, 1.5, 937, 497);
      st([
        [470, 0],
        [470, 500],
      ]);
      st(gar(470, 250, 60, 0, 6.3));
      st(gar(470, 250, 20, 0, 6.3));
      for (const b of [0, 1]) {
        const hx = HXs[b],
          e = b ? 940 : 0,
          sg = b ? -1 : 1;
        c.strokeRect(b ? 750 : 0, 170, 190, 160);
        st(gar(e + sg * 190, 250, 60, b ? 1.57 : -1.57, b ? 4.71 : 1.57));
        st(
          gar(
            hx,
            250,
            237,
            b ? Math.PI - 1.19 : -1.19,
            b ? Math.PI + 1.19 : 1.19,
          ),
        );
        st([
          [e, 30],
          [hx + sg * 88, 30],
        ]);
        st([
          [e, 470],
          [hx + sg * 88, 470],
        ]);
        st(gar(hx, 250, 40, b ? 1.57 : -1.57, b ? 4.71 : 1.57));
      }
      c.font = "900 64px system-ui";
      c.textAlign = "center";
      c.fillStyle = "rgba(255,255,255,.16)";
      c.fillText("HOOPS 2K27", 470, 272);
      tex.needsUpdate = true;
    }
    const fl = ad(
      new THREE.PlaneGeometry(94, 50),
      M(0xffffff, { map: tex, roughness: 0.28, metalness: 0.08 }),
      0,
      0,
      0,
    );
    fl.rotation.x = -Math.PI / 2;
    const ap2 = ad(
      new THREE.PlaneGeometry(140, 90),
      M(0x15182c, { roughness: 0.85 }),
      0,
      -0.03,
      0,
    );
    ap2.rotation.x = -Math.PI / 2;
    const [cw, q] = cv(1024, 256);
    q.fillStyle = "#14172a";
    q.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 2600; i++) {
      q.fillStyle = [
        "#6a4c93",
        "#c9184a",
        "#f4a261",
        "#2a9d8f",
        "#e9c46a",
        "#4361ee",
        "#ddd",
        "#333",
      ][i % 8];
      q.beginPath();
      q.arc(
        ((i * 37) % 1024) + Math.random() * 4,
        ((Math.floor(i / 28) * 9) % 256) + 4,
        3,
        0,
        6.3,
      );
      q.fill();
    }
    const crowd = TX2(cw);
    crowd.wrapS = THREE.RepeatWrapping;
    crowd.repeat.set(3, 1);
    for (const [x, z, ry, w] of [
      [0, -66, 0, 170],
      [0, 66, Math.PI, 170],
      [-92, 0, Math.PI / 2, 110],
      [92, 0, -Math.PI / 2, 110],
    ]) {
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 34),
        M(0xffffff, { map: crowd, roughness: 0.95, emissive: 0x1a1a28 }),
      );
      st.position.set(x, 13, z);
      st.rotation.y = ry;
      st.rotateX(-0.55);
      S.add(st);
    }
    const [lc, l] = cv(1024, 64);
    l.fillStyle = "#000";
    l.fillRect(0, 0, 1024, 64);
    l.font = "900 40px system-ui";
    l.fillStyle = "#ffd23f";
    for (let i = 0; i < 3; i++) l.fillText("HOOPS 2K27 ★", i * 341 + 12, 46);
    const led = TX2(lc);
    led.wrapS = THREE.RepeatWrapping;
    led.repeat.set(3, 1);
    const brd = new THREE.Mesh(
      new THREE.BoxGeometry(96, 1.4, 0.3),
      [0, 1, 2, 3, 4, 5].map((i) =>
        i === 4 ? new THREE.MeshBasicMaterial({ map: led }) : M(0x111111),
      ),
    );
    brd.position.set(0, 0.7, -27.5);
    S.add(brd);
    for (const b of [0, 1]) {
      const hx = (HXs[b] - 470) * 0.1,
        sg = b ? 1 : -1,
        mt = M(0x2a2d36, { metalness: 0.6, roughness: 0.4 });
      ad(new THREE.CylinderGeometry(0.35, 0.45, 13, 16), mt, sg * 48.6, 6.5, 0);
      ad(new THREE.BoxGeometry(5.6, 0.35, 0.35), mt, sg * 45.8, 11.4, 0);
      ad(
        new THREE.BoxGeometry(1.4, 2.4, 2.4),
        M(0x1d428a, { roughness: 0.8 }),
        sg * 48.6,
        1.2,
        0,
      );
      const bb = ad(
        new THREE.BoxGeometry(0.12, 3.5, 6),
        new THREE.MeshPhysicalMaterial({
          color: 0xddeeff,
          transparent: true,
          opacity: 0.3,
          roughness: 0.05,
        }),
        sg * 43,
        11.45,
        0,
      );
      bb.castShadow = false;
      const fr = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.13, 3.5, 6)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      fr.position.copy(bb.position);
      S.add(fr);
      const sq = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(2, 1.5)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      sq.position.set(sg * 42.92, 10.6, 0);
      sq.rotation.y = Math.PI / 2;
      S.add(sq);
      const rim = ad(
        new THREE.TorusGeometry(0.75, 0.055, 10, 32),
        M(0xff4d1a, { metalness: 0.5, roughness: 0.35 }),
        hx,
        10,
        0,
      );
      rim.rotation.x = Math.PI / 2;
      ad(new THREE.BoxGeometry(0.6, 0.12, 0.4), M(0xff4d1a), sg * 42.6, 10, 0);
    }
    const nc = NETS.reduce((a, N) => a + N.c.length, 0),
      np = new Float32Array(nc * 6),
      ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.BufferAttribute(np, 3));
    const net = new THREE.LineSegments(
      ng,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
      }),
    );
    net.frustumCulled = false;
    S.add(net);
    const [bc, b2] = cv(256, 128);
    b2.fillStyle = "#d9661f";
    b2.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 1500; i++) {
      b2.fillStyle = "rgba(0,0,0,.08)";
      b2.fillRect(Math.random() * 256, Math.random() * 128, 1.5, 1.5);
    }
    b2.strokeStyle = "#1c0d04";
    b2.lineWidth = 3;
    b2.beginPath();
    b2.moveTo(0, 64);
    b2.lineTo(256, 64);
    b2.moveTo(64, 0);
    b2.lineTo(64, 128);
    b2.moveTo(192, 0);
    b2.lineTo(192, 128);
    b2.stroke();
    b2.beginPath();
    b2.ellipse(128, 64, 40, 64, 0, 0, 6.3);
    b2.stroke();
    const ball = ad(
      new THREE.SphereGeometry(0.39, 32, 20),
      M(0xffffff, { map: TX2(bc), roughness: 0.75 }),
      0,
      -5,
      0,
    );
    const CN = 1800,
      cpos = [],
      cc = new THREE.Color(),
      dm = new THREE.Object3D(),
      crowdI = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.55, 0.95, 0.4),
        M(0xffffff, { roughness: 0.9 }),
        CN,
      );
    for (let i = 0; i < CN; i++) {
      const sd = i % 4,
        row = Math.floor(i / 4) % 9;
      let x,
        y = 2.4 + row * 1.25,
        z,
        ry;
      if (sd < 2) {
        x = (Math.random() - 0.5) * 118;
        z = (sd ? 1 : -1) * (31 + row * 1.55);
        ry = sd ? Math.PI : 0;
      } else {
        z = (Math.random() - 0.5) * 62;
        x = (sd === 2 ? -1 : 1) * (54 + row * 1.55);
        ry = sd === 2 ? Math.PI / 2 : -Math.PI / 2;
      }
      cpos.push([x, y, z, ry, Math.random() * 6.28]);
      cc.setHSL(Math.random(), 0.45, 0.3 + Math.random() * 0.3);
      crowdI.setColorAt(i, cc);
    }
    crowdI.instanceColor.needsUpdate = true;
    crowdI.frustumCulled = false;
    S.add(crowdI);
    let exc = 0.3;
    function crowdUpd() {
      for (let i = 0; i < crowdI.count; i++) {
        const c = cpos[i];
        dm.position.set(
          c[0],
          c[1] + Math.max(0, Math.sin(T * (3 + exc * 5) + c[4])) * 0.28 * exc,
          c[2],
        );
        dm.rotation.set(0, c[3], 0);
        dm.updateMatrix();
        crowdI.setMatrixAt(i, dm.matrix);
      }
      crowdI.instanceMatrix.needsUpdate = true;
    }
    const [jc, j2] = cv(512, 256),
      jt = TX2(jc),
      js2 = new THREE.MeshBasicMaterial({ map: jt }),
      jum = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 14), [
        js2,
        js2,
        M(0x0a0a10),
        M(0x0a0a10),
        js2,
        js2,
      ]);
    jum.position.set(0, 26, 0);
    S.add(jum);
    let jk = "";
    function jumbo() {
      const k =
        sc[0] +
        "-" +
        sc[1] +
        "-" +
        fmt(clock) +
        "-" +
        Math.ceil(shot) +
        "-" +
        qtr();
      if (k === jk) return;
      jk = k;
      j2.fillStyle = "#05070f";
      j2.fillRect(0, 0, 512, 256);
      j2.fillStyle = "#ffd23f";
      j2.font = "900 30px system-ui";
      j2.textAlign = "center";
      j2.fillText("HOOPS 2K27", 256, 36);
      j2.fillStyle = "#fff";
      j2.font = "800 24px system-ui";
      j2.fillText(((cl && cl[0]) || "").toUpperCase().slice(0, 12), 128, 86);
      j2.fillText(((cl && cl[1]) || "").toUpperCase().slice(0, 12), 384, 86);
      j2.font = "900 84px system-ui";
      j2.fillText(sc[0], 128, 176);
      j2.fillText(sc[1], 384, 176);
      j2.fillStyle = "#ffd23f";
      j2.font = "800 34px system-ui";
      j2.fillText(
        (qtr() > 4 ? "OT" : "Q" + qtr()) + "  " + fmt(clock),
        256,
        226,
      );
      jt.needsUpdate = true;
    }
    const [gcv, g2] = cv(128, 128),
      gr0 = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr0.addColorStop(0, "rgba(255,245,220,1)");
    gr0.addColorStop(0.25, "rgba(255,235,200,.45)");
    gr0.addColorStop(1, "rgba(255,230,190,0)");
    g2.fillStyle = gr0;
    g2.fillRect(0, 0, 128, 128);
    const glow = [];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(gcv),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.75,
          fog: false,
        }),
      );
      sp.scale.set(9, 9, 1);
      sp.position.set(-45 + i * 10, 36, (i % 2 ? 1 : -1) * 12);
      S.add(sp);
      glow.push(sp);
    }
    const gC = new THREE.CylinderGeometry(1, 1, 1, 14),
      gS = new THREE.SphereGeometry(1, 20, 14),
      gB = new THREE.BoxGeometry(1, 1, 1),
      gT = new THREE.CylinderGeometry(1, 0.82, 1, 16);
    const mk = (g, col, sx, sy, sz, x, y, z, par, o) => {
      const k = new THREE.Mesh(g, M(col, o));
      k.scale.set(sx, sy, sz);
      k.position.set(x, y, z);
      k.castShadow = true;
      par.add(k);
      return k;
    };
    function rig(p) {
      const G = new THREE.Group(),
        bd = new THREE.Group(),
        k = p.bk,
        sk = p.skin,
        hc = sk === "#e8b88f" ? "#3d2a18" : "#121212",
        jr = { roughness: 0.85 },
        hr = { roughness: 1 };
      bd.position.y = 3.2;
      G.add(bd);
      const leg = (x) => {
        const th = new THREE.Group();
        th.position.set(x, 3.2, 0);
        mk(gC, sk, 0.24, 1.6, 0.24, 0, -0.8, 0, th);
        mk(gC, p.col, 0.3 * k, 0.7, 0.3 * k, 0, -0.3, 0, th, jr);
        const sn = new THREE.Group();
        sn.position.y = -1.58;
        mk(gS, sk, 0.2, 0.2, 0.2, 0, 0, 0, sn);
        mk(gC, sk, 0.17, 1.55, 0.17, 0, -0.78, 0, sn);
        mk(gC, "#f4f4f4", 0.19, 0.35, 0.19, 0, -1.35, 0, sn);
        mk(gB, "#fafafa", 0.38, 0.28, 0.78, 0, -1.6, 0.14, sn);
        mk(gB, "#222", 0.39, 0.06, 0.8, 0, -1.73, 0.14, sn);
        th.add(sn);
        G.add(th);
        return [th, sn];
      };
      const [tl, kl] = leg(-0.32),
        [tr, kr] = leg(0.32);
      mk(gT, p.col, 0.62 * k, 1, 0.5 * k, 0, 0.15, 0, bd, jr);
      mk(gT, p.col, 0.78 * k, 1.5, 0.44 * k, 0, 1.25, 0, bd, jr);
      const [nc2, nx] = cv(128, 128);
      nx.fillStyle = "#fff";
      nx.font = "900 84px system-ui";
      nx.textAlign = "center";
      nx.fillText(p.no, 64, 96);
      const nm = new THREE.MeshBasicMaterial({
          map: TX2(nc2),
          transparent: true,
        }),
        nb = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), nm);
      nb.position.set(0, 1.35, -0.47);
      nb.rotation.y = Math.PI;
      bd.add(nb);
      const nf = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), nm);
      nf.position.set(0, 1.5, 0.47);
      bd.add(nf);
      {
        const [n3c, n3] = cv(256, 64);
        n3.fillStyle = "#fff";
        n3.font = "800 40px system-ui";
        n3.textAlign = "center";
        n3.fillText(p.n.split(" ").pop().toUpperCase().slice(0, 11), 128, 46);
        const np3 = new THREE.Mesh(
          new THREE.PlaneGeometry(1.4, 0.35),
          new THREE.MeshBasicMaterial({ map: TX2(n3c), transparent: true }),
        );
        np3.position.set(0, 1.88, -0.46);
        np3.rotation.y = Math.PI;
        bd.add(np3);
      }
      mk(gC, sk, 0.17, 0.35, 0.17, 0, 2.2, 0, bd);
      const arm = (x) => {
        const sh = new THREE.Group();
        sh.position.set(x * k * 0.95, 1.9, 0);
        mk(gS, sk, 0.25 * k, 0.27, 0.25 * k, 0, 0, 0, sh);
        mk(gC, sk, 0.16 * k, 1, 0.16 * k, 0, -0.5, 0, sh);
        const el = new THREE.Group();
        el.position.y = -1.02;
        mk(gS, sk, 0.14, 0.14, 0.14, 0, 0, 0, el);
        mk(gC, sk, 0.13 * k, 0.98, 0.13 * k, 0, -0.49, 0, el);
        const wr = new THREE.Group();
        wr.position.y = -1;
        mk(gB, sk, 0.16, 0.36, 0.1, 0, -0.17, 0.02, wr);
        el.add(wr);
        sh.add(el);
        bd.add(sh);
        return [sh, el, wr];
      };
      const [sL, eL, wL] = arm(-0.88),
        [sR, eR, wR] = arm(0.88);
      mk(gS, sk, 0.38, 0.46, 0.4, 0, 2.72, 0.02, bd);
      mk(gS, sk, 0.08, 0.12, 0.08, 0.38, 2.72, 0, bd);
      mk(gS, sk, 0.08, 0.12, 0.08, -0.38, 2.72, 0, bd);
      if (p.hr === 1) mk(gS, hc, 0.4, 0.3, 0.42, 0, 2.88, -0.02, bd, hr);
      if (p.hr === 2) {
        mk(gS, hc, 0.42, 0.36, 0.44, 0, 2.86, -0.03, bd, hr);
        mk(gB, hc, 0.5, 0.9, 0.22, 0, 2.5, -0.36, bd, hr);
      }
      if (p.hr === 3) mk(gS, hc, 0.52, 0.5, 0.52, 0, 2.98, -0.04, bd, hr);
      if (p.bd) mk(gS, hc, 0.3, 0.2, 0.2, 0, 2.47, 0.28, bd, hr);
      G.scale.setScalar(p.ht / 6.4);
      S.add(G);
      return { G, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR };
    }
    function apply(p) {
      const m = p.gl,
        q = p.q;
      if (!m || !q) return;
      const w = W3(p.x, p.y, p.z);
      m.G.position.set(w[0], w[1] - q.cr * 0.4, w[2]);
      m.G.rotation.y = Math.PI / 2 - p.f;
      m.tl.rotation.x = -q.tL;
      m.tr.rotation.x = -q.tR;
      m.tl.rotation.z = -(q.hz || 0);
      m.tr.rotation.z = q.hz || 0;
      m.kl.rotation.x = q.kL;
      m.kr.rotation.x = q.kR;
      m.sL.rotation.x = -q.aL;
      m.sR.rotation.x = -q.aR;
      m.sL.rotation.z = -(q.zL == null ? q.sz : q.zL);
      m.sR.rotation.z = q.sz;
      m.eL.rotation.x = -q.eL;
      m.eR.rotation.x = -q.eR;
      m.wL.rotation.x = -(q.wL || 0);
      m.wR.rotation.x = -(q.wR || 0);
      m.bd.rotation.set(q.ln, q.ty, q.rz, "YXZ");
    }
    const cl2 = new THREE.Vector3(0, 0, 3);
    let pset = null,
      lastR = 0,
      ema = 16,
      nf = 0,
      lvl = 2,
      lastTot = 0,
      lastQ = -1;
    GL = {
      hand(p) {
        const m = p.gl;
        if (!m) return null;
        m.G.updateMatrixWorld(true);
        const v = m.wR.localToWorld(new THREE.Vector3(0, -0.62, 0.1));
        return [v.x * 10 + 470, v.z * 10 + 250, v.y * 10];
      },
      proj(x, y, z) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        return [(v.x + 1) * 480, (1 - v.y) * 270];
      },
      render() {
        if (QL !== lastQ) {
          lastQ = QL;
          R.shadowMap.enabled = QL > 0;
          const ss = QL > 1 ? 2048 : 1024;
          sun.shadow.mapSize.set(ss, ss);
          if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
          }
          R.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.75][QL]));
          R.setSize(960, 540, false);
          crowdI.count = [0, 700, 1800][QL];
          glow.forEach((s) => (s.visible = QL > 0));
          S.traverse((o) => {
            if (o.material)
              [].concat(o.material).forEach((mm) => (mm.needsUpdate = true));
          });
        }
        const tot = sc[0] + sc[1];
        if (tot !== lastTot) {
          lastTot = tot;
          exc = 1;
        }
        exc = Math.max(0.3, exc - 0.004);
        if (QL > 0 && (nf & 1) === 0) crowdUpd();
        jumbo();
        const now = performance.now();
        if (lastR) {
          ema = ema * 0.95 + (now - lastR) * 0.05;
          if (++nf > 90) {
            nf = 0;
            if (ema > 38 && lvl === 2) {
              lvl = 1;
              R.shadowMap.enabled = false;
              R.setPixelRatio(1);
              S.traverse((o) => {
                if (o.material)
                  []
                    .concat(o.material)
                    .forEach((mm) => (mm.needsUpdate = true));
              });
            } else if (ema > 55 && lvl === 1) {
              GL = null;
              C.style.visibility = "hidden";
              return;
            }
          }
        }
        lastR = now;
        if (PC.join() !== pcK) {
          pcK = PC.join();
          court();
        }
        if (P !== pset) {
          if (pset) pset.forEach((p) => p.gl && S.remove(p.gl.G));
          P.forEach((p) => (p.gl = rig(p)));
          pset = P;
        }
        if (P.length) {
          P.forEach((p) => {
            if (!RPL) pose3(p);
            apply(p);
          });
          const w = W3(B.x, B.y, B.z);
          ball.position.set(w[0], w[1], w[2]);
          ball.rotation.set(B.a * 0.7, 0, B.a);
          {
            const o = B.owner;
            if (!RPL && o && o.gl && (o.mode === "c" || o.mode === "s")) {
              o.gl.G.updateMatrixWorld(true);
              ball.position.copy(
                o.gl.wR.localToWorld(new THREE.Vector3(0, -0.62, 0.1)),
              );
            }
          }
        }
        let i = 0;
        for (const N of NETS)
          for (const c of N.c)
            for (const v of [c[0], c[1]]) {
              const w = W3(v.x, v.y, v.z);
              np[i++] = w[0];
              np[i++] = w[1];
              np[i++] = w[2];
            }
        ng.attributes.position.needsUpdate = true;
        led.offset.x = (T * 0.05) % 1;
        {
          const cm = RPL ? 1 : CAMM,
            p0 = P.length ? P[ap] : null,
            hx = (hoop(pos) - 470) * 0.1;
          let tp = [CP[0], 22, 36],
            tl = [CP[0], 0, 3];
          if (cm === 1 && p0) {
            const w = W3(p0.x, p0.y, 0),
              bx = W3(B.x, B.y, 0),
              fx = w[0] * 0.5 + bx[0] * 0.5;
            tp = [fx, 12.5, 26];
            tl = [fx, 2.5, 2];
          } else if (cm === 2) {
            const sg = hx > 0 ? 1 : -1;
            tp = [sg * 58, 13, 0];
            tl = [sg * 20, 3, 0];
          } else if (cm === 3 && p0) {
            const w = W3(p0.x, p0.y, 0),
              dr = hoop(p0.tm) > 470 ? 1 : -1;
            tp = [w[0] - dr * 13, 8.5, w[2] + (w[2] > 0 ? -4 : 4) + 10];
            tl = [w[0] + dr * 9, 3, w[2] * 0.6];
          }
          cam.position.lerp(new THREE.Vector3(...tp), 0.1);
          cl2.lerp(new THREE.Vector3(...tl), 0.14);
          cam.lookAt(cl2);
          cam.updateMatrixWorld();
          R.render(S, cam);
        }
      },
    };
  } catch (e) {
    GL = null;
    console.error("WebGL off", e);
  }
}
let RAP = null;
function rapInit() {
  if (typeof RAPIER === "undefined") return;
  RAPIER.init()
    .then(() => {
      const R2 = RAPIER,
        w = new R2.World({ x: 0, y: 0, z: -g }),
        fix = (d) => w.createCollider(d);
      fix(
        R2.ColliderDesc.cuboid(700, 500, 10)
          .setTranslation(470, 250, -10)
          .setRestitution(0.8)
          .setFriction(0.6),
      );
      for (const [x, y, hx, hy] of [
        [-5, 250, 5, 500],
        [945, 250, 5, 500],
        [470, -5, 700, 5],
        [470, 505, 700, 5],
      ])
        fix(
          R2.ColliderDesc.cuboid(hx, hy, 300)
            .setTranslation(x, y, 300)
            .setRestitution(0.5),
        );
      for (const b of [0, 1]) {
        const hx = HXs[b],
          bx = b ? 900 : 40;
        fix(
          R2.ColliderDesc.cuboid(0.6, 30, 20)
            .setTranslation(bx + (b ? 0.6 : -0.6), HY, 116)
            .setRestitution(0.62)
            .setFriction(0.3),
        );
        for (let k = 0; k < 24; k++) {
          const a0 = (k / 24) * 6.283,
            a1 = ((k + 1) / 24) * 6.283,
            x0 = hx + Math.cos(a0) * RR,
            y0 = HY + Math.sin(a0) * RR,
            x1 = hx + Math.cos(a1) * RR,
            y1 = HY + Math.sin(a1) * RR,
            ang = Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2;
          fix(
            R2.ColliderDesc.capsule(Math.hypot(x1 - x0, y1 - y0) / 2, 0.55)
              .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, 100)
              .setRotation({
                x: 0,
                y: 0,
                z: Math.sin(ang / 2),
                w: Math.cos(ang / 2),
              })
              .setRestitution(0.55)
              .setFriction(0.4),
          );
        }
      }
      const bb = w.createRigidBody(
        R2.RigidBodyDesc.dynamic()
          .setTranslation(470, 250, 50)
          .setLinearDamping(0)
          .setAngularDamping(0.3)
          .setCcdEnabled(true),
      );
      w.createCollider(
        R2.ColliderDesc.ball(BR)
          .setRestitution(0.72)
          .setFriction(0.55)
          .setDensity(0.02),
        bb,
      );
      RAP = { w, bb };
    })
    .catch((e) => console.error("rapier off", e));
}
function rapStep(dt) {
  const { w, bb } = RAP,
    W = B.wv || [0, 0, 0],
    k = 0.0032;
  B.vx *= 1 - 0.1 * dt;
  B.vy *= 1 - 0.1 * dt;
  B.vz += k * (W[0] * B.vy - W[1] * B.vx) * dt;
  bb.setTranslation({ x: B.x, y: B.y, z: B.z }, true);
  bb.setLinvel({ x: B.vx, y: B.vy, z: B.vz }, true);
  bb.setAngvel({ x: W[0], y: W[1], z: W[2] }, true);
  w.timestep = dt;
  w.step();
  const t = bb.translation(),
    v = bb.linvel(),
    a = bb.angvel();
  B.x = t.x;
  B.y = t.y;
  B.z = t.z;
  B.vx = v.x;
  B.vy = v.y;
  B.vz = v.z;
  B.wv = [a.x, a.y, a.z];
  B.a += Math.hypot(a.x, a.y, a.z) * dt * 0.5;
}
const REC = [];
let RPL = null,
  RQ = 0,
  LIVE = null,
  CAMM = 0,
  EXC = 0.3,
  CRG = null;
const GP = { on: 0, dx: 0, dy: 0, sp: 0, post: 0, pb: [] },
  CAMN = ["Broadcast", "2K Style", "Baseline", "Player Lock"];
function recFrame() {
  if (typeof GL === "undefined" || !GL || RPL) return;
  if (REC.length > 330) REC.shift();
  REC.push({
    p: P.map((p) => [p.x, p.y, p.z, p.f, p.q ? Object.assign({}, p.q) : null]),
    b: [B.x, B.y, B.z, B.a],
  });
}
function startReplay() {
  LIVE = {
    p: P.map((p) => [p.x, p.y, p.z, p.f, p.q]),
    b: [B.x, B.y, B.z, B.a],
  };
  RPL = { i: Math.max(0, REC.length - 250) };
}
function rplStep(dt) {
  const r = RPL;
  r.i += dt * 60 * 0.4;
  const n = Math.floor(r.i);
  if (n >= REC.length - 1) {
    P.forEach((p, k) => {
      const l = LIVE.p[k];
      p.x = l[0];
      p.y = l[1];
      p.z = l[2];
      p.f = l[3];
      p.q = l[4];
    });
    B.x = LIVE.b[0];
    B.y = LIVE.b[1];
    B.z = LIVE.b[2];
    B.a = LIVE.b[3];
    RPL = null;
    RQ = 0;
    REC.length = 0;
    rs = 0.001;
    return;
  }
  const f = REC[n];
  P.forEach((p, k) => {
    const s = f.p[k];
    p.x = s[0];
    p.y = s[1];
    p.z = s[2];
    p.f = s[3];
    if (s[4]) p.q = s[4];
  });
  B.x = f.b[0];
  B.y = f.b[1];
  B.z = f.b[2];
  B.a = f.b[3];
}
function replayHud() {
  if (!RPL) return;
  X.fillStyle = "#ff4d4d";
  X.font = "900 18px system-ui";
  X.textAlign = "left";
  X.fillText("● REPLAY · slow motion · SPACE to skip", 22, 100);
}
let GPX = 0;
function gpPoll() {
  if (GPX) return;
  try {
    gpPoll0();
  } catch (e) {
    GPX = 1;
  }
}
function gpPoll0() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  let p = null;
  for (const x of navigator.getGamepads() || [])
    if (x && x.connected) {
      p = x;
      break;
    }
  GP.on = !!p;
  if (!p) return;
  const a = p.axes,
    dz = (v) => (Math.abs(v) < 0.2 ? 0 : v),
    b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
  GP.dx = dz(a[0] || 0);
  GP.dy = dz(a[1] || 0);
  GP.sp = b(7);
  GP.post = b(6);
  const e = (i, f, u) => {
    const d = b(i);
    if (d && !GP.pb[i] && f) f();
    if (!d && GP.pb[i] && u) u();
    GP.pb[i] = d;
  };
  e(
    0,
    () => (ev.sd = 1),
    () => (ev.su = 1),
  );
  e(2, () => (ev.e = 1));
  e(1, () => (ev.r = 1));
  e(3, () => (ev.f = 1));
  e(4, () => (ev.cc = 1));
  e(5, () => (ev.x = 1));
  e(8, () => {
    CAMM = (CAMM + 1) % 4;
  });
}
function crowdInit() {
  try {
    AC = AC || new AudioContext();
    if (CRG) return;
    const bf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate),
      d = bf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = AC.createBufferSource();
    s.buffer = bf;
    s.loop = true;
    const f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 700;
    f.Q.value = 0.6;
    CRG = AC.createGain();
    CRG.gain.value = 0.015;
    s.connect(f);
    f.connect(CRG);
    CRG.connect(AC.destination);
    s.start();
  } catch (e) {}
}
function crowdTick(dt) {
  EXC = Math.max(0.2, EXC - dt * 0.25);
  if (CRG) CRG.gain.value = 0.012 + 0.06 * EXC;
}
function endGame() {
  S = "over";
  ov.style.display = "flex";
  const w = sc[0] > sc[1],
    tb = (t) =>
      `<table class="bx"><tr><th>${cl[t]}</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th><th>BLK</th></tr>${P.filter(
        (p) => p.tm === t,
      )
        .map(
          (p) =>
            `<tr><td>${p.n}</td><td>${p.stt.pts}</td><td>${p.stt.reb}</td><td>${p.stt.ast}</td><td>${p.stt.fgm}-${p.stt.fga}</td><td>${p.stt.tpm}-${p.stt.tpa}</td><td>${p.stt.blk}</td></tr>`,
        )
        .join("")}</table>`;
  ov.innerHTML = `<div class="logo" style="font-size:40px">${w ? "YOU WIN!" : "FINAL"}</div><p style="font-size:24px;font-weight:800">${cl[0]} ${sc[0]} — ${sc[1]} ${cl[1]}</p><div class="bxw">${tb(0)}${tb(1)}</div><button class="big" id="pa">Play again</button>`;
  $("#pa").onclick = menu;
  snd(w ? 800 : 200, 0.5, "triangle");
}
function contestOf(p) {
  let ct = 0,
    o2 = null;
  for (const o of P) {
    if (o.tm === p.tm) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < 60) {
      const c2 = (1 - d / 60) * (o.z > 8 ? 1.5 : 1);
      if (c2 > ct) {
        ct = c2;
        o2 = o;
      }
    }
  }
  return [Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1)), o2];
}
function contestFx(p) {
  if (B.owner !== p || ftq) return;
  const c = contestOf(p)[0],
    q = pr(p.x, p.y, 0),
    sx = q[0],
    sy = q[1],
    ph = Math.max(40, Math.abs(sy - pr(p.x, p.y, 70)[1]));
  if (c > 0.03) {
    X.strokeStyle = "rgba(255,70,70," + (0.35 + c * 0.55) + ")";
    X.lineWidth = 2 + c * 3;
    X.beginPath();
    X.ellipse(sx, sy, ph * 0.55, ph * 0.22, 0, 0, 6.3);
    X.stroke();
  }
  if (p.mode === "c" || p.mode === "s") {
    X.textAlign = "center";
    X.font = "800 12px system-ui";
    X.fillStyle = c < 0.08 ? "#2ecc71" : c < 0.5 ? "#ffd23f" : "#ff6b6b";
    X.fillText(
      c < 0.08 ? "WIDE OPEN" : "CONTESTED " + Math.round(c * 100) + "%",
      sx,
      sy + ph * 0.5,
    );
  }
}
function meter(p) {
  const tm = TEMPO && p.mode === "s" && !p.rl,
    hold = !TEMPO && p.mode === "c";
  if (!(tm || hold)) return;
  const D0 = Math.hypot(hoop(p.tm) - p.x, HY - p.y),
    rat =
      (ftq
        ? p.c * 0.8 + 15
        : D0 < 90
          ? p.i
          : D0 < 237
            ? (p.c + p.i) / 2
            : p.c) +
      (p.heat || 0) * 2,
    c = p.mode === "s" && p.cw != null ? p.cw : contestOf(p)[0],
    win =
      (0.07 + (rat / 100) * 0.05) *
      (1 - 0.45 * c) *
      (TEMPO ? 1.2 : 1) *
      (0.85 + 0.15 * (p.en == null ? 1 : p.en)),
    ideal = TEMPO
      ? p.sv >= 5 && p.sv < 8
        ? 0.28
        : p.st === 1
          ? 0.3
          : 0.4
      : p.st === 1
        ? 0.45
        : 0.6,
    wm = (0.07 + (rat / 100) * 0.05) * (TEMPO ? 1.2 : 1),
    m = (ideal + wm) / 0.97,
    pg = Math.min(1, p.t / m),
    g1 = 1,
    g0 = 0.97 - (2 * win) / m,
    inG = pg >= g0 && pg <= g1,
    q = pr(p.x, p.y, 0),
    sx = q[0],
    sy = q[1],
    ph = Math.max(40, Math.abs(sy - pr(p.x, p.y, 70)[1]));
  if (METER === 0) {
    const ax = sx - ph * 0.5,
      aw = ph * 0.3,
      ah = ph * 1.05,
      sw = aw * 0.3,
      path = () => {
        X.beginPath();
        X.moveTo(ax - sw, sy);
        X.lineTo(ax - sw, sy - ah * 0.65);
        X.lineTo(ax - aw / 2, sy - ah * 0.65);
        X.lineTo(ax, sy - ah);
        X.lineTo(ax + aw / 2, sy - ah * 0.65);
        X.lineTo(ax + sw, sy - ah * 0.65);
        X.lineTo(ax + sw, sy);
        X.closePath();
      };
    X.save();
    path();
    X.fillStyle = "rgba(10,12,24,.6)";
    X.fill();
    X.clip();
    X.fillStyle = inG ? "#2ecc71" : "#fff";
    X.fillRect(ax - aw, sy - ah * pg, aw * 2, ah * pg);
    X.fillStyle = "rgba(46,204,113,.75)";
    X.fillRect(ax - aw, sy - ah * g1, aw * 2, ah * (g1 - g0));
    X.restore();
    X.strokeStyle = "#fff";
    X.lineWidth = 2;
    path();
    X.stroke();
  } else if (METER === 1) {
    const w = ph * 1.1,
      x0 = sx - w / 2,
      y0 = sy + ph * 0.18;
    X.fillStyle = "rgba(0,0,0,.65)";
    X.fillRect(x0 - 2, y0 - 2, w + 4, 10);
    X.fillStyle = "#f5c542";
    X.fillRect(x0, y0, w * pg, 6);
    X.fillStyle = "#1fd6c0";
    X.fillRect(x0 + g0 * w, y0, (g1 - g0) * w, 6);
    X.fillStyle = "#fff";
    X.fillRect(x0 + w * pg - 1, y0 - 3, 3, 12);
  } else if (METER === 2) {
    const h = pr(p.x, p.y, p.z + 92),
      w = 60,
      x0 = h[0] - w / 2;
    X.fillStyle = "rgba(0,0,0,.65)";
    X.fillRect(x0 - 2, h[1] - 2, w + 4, 9);
    X.fillStyle = "#2ecc71";
    X.fillRect(x0 + g0 * w, h[1], (g1 - g0) * w, 5);
    X.fillStyle = "#ffd23f";
    X.fillRect(x0 + pg * w - 1, h[1] - 3, 3, 11);
  } else {
    const rx = ph * 0.6,
      ry = ph * 0.24;
    X.lineWidth = 5;
    X.strokeStyle = "rgba(0,0,0,.55)";
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, 0, 6.3);
    X.stroke();
    X.strokeStyle = "#1fd6c0";
    X.lineWidth = 7;
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, -1.57 + g0 * 6.283, -1.57 + g1 * 6.283);
    X.stroke();
    X.strokeStyle = inG ? "#2ecc71" : "#ffd23f";
    X.lineWidth = 4;
    X.beginPath();
    X.ellipse(sx, sy, rx, ry, 0, -1.57, -1.57 + pg * 6.283);
    X.stroke();
  }
}
function hud2() {
  const p = P[ap];
  X.fillStyle = "rgba(0,0,0,.55)";
  X.fillRect(0, 512, 960, 28);
  X.font = "700 12px system-ui";
  X.fillStyle = "#fff";
  X.textAlign = "left";
  X.fillText(
    p.n +
      "  OVR " +
      ovr(p) +
      " · 3PT " +
      p.c +
      " · INS " +
      p.i +
      " · SPD " +
      p.s +
      " · DEF " +
      p.d +
      " · " +
      p.stt.pts +
      "p " +
      p.stt.reb +
      "r " +
      p.stt.ast +
      "a · EN " +
      Math.round((p.en == null ? 1 : p.en) * 100) +
      "%",
    12,
    530,
  );
  X.textAlign = "right";
  X.fillText(
    "TEMPO " +
      (TEMPO ? "ON" : "OFF") +
      " [T] · METER " +
      MN[METER] +
      " [M] · PRO " +
      (PRO ? "ON" : "OFF") +
      " · FOULS you " +
      tf[0] +
      " / cpu " +
      tf[1],
    948,
    530,
  );
  if (ftq && ftq.i >= 0) {
    X.textAlign = "center";
    X.font = "800 18px system-ui";
    X.fillStyle = "#ffd23f";
    X.fillText(
      (ftq.tech ? "TECHNICAL " : "") +
        "FREE THROW " +
        (ftq.i + 1) +
        "/" +
        ftq.n +
        " — " +
        ftq.s.n,
      480,
      100,
    );
  }
}
function hud() {
  X.fillStyle = "rgba(8,10,24,.88)";
  X.beginPath();
  X.rect(230, 6, 500, 62);
  X.fill();
  X.fillStyle = PC[0] || "#7b3fb5";
  X.fillRect(230, 6, 6, 62);
  X.fillStyle = PC[1] || "#1d428a";
  X.fillRect(724, 6, 6, 62);
  X.textAlign = "center";
  X.fillStyle = "#fff";
  X.font = "700 12px system-ui";
  X.fillText(cl[0].toUpperCase() + " (YOU)", 340, 24);
  X.fillText(cl[1].toUpperCase(), 620, 24);
  X.font = "800 30px system-ui";
  X.fillText(sc[0], 340, 56);
  X.fillText(sc[1], 620, 56);
  X.fillStyle = "#ffd23f";
  X.font = "800 20px system-ui";
  X.fillText((q > 4 ? "OT" : "Q" + q) + "  " + fmt(clock), 480, 36);
  X.fillStyle = shot < 5 ? "#ff6b4a" : "#fff";
  X.font = "700 16px system-ui";
  X.fillText(Math.ceil(Math.max(0, shot)), 480, 58);
  TX.forEach((o) => {
    X.globalAlpha = Math.min(1, o.t * 2);
    X.fillStyle = o.c;
    X.font = "900 22px system-ui";
    X.fillText(o.s, o.x, o.y);
    X.globalAlpha = 1;
  });
}
function draw() {
  const tx = P.length ? clamp((B.x - 470) * 0.085, -30, 30) : 0;
  cx += (tx - cx) * 0.08;
  CP[0] = cx;
  if (GL) {
    X.clearRect(0, 0, 960, 540);
    try {
      GL.render();
    } catch (e) {
      GL = null;
      console.error(e);
    }
  }
  if (!GL) scene();
  if (!P.length) return;
  if (!GL)
    for (const p of P) {
      const w = W3(p.x, p.y, 0),
        q = pj(w[0], 0, w[2]),
        r = Math.max(0.35, 1 - p.z * 0.012);
      X.fillStyle = "rgba(0,0,0,.32)";
      X.beginPath();
      X.ellipse(q[0], q[1], 1.1 * q[2] * r, 0.45 * q[2] * r, 0, 0, 6.3);
      X.fill();
    }
  {
    const c0 = pr(P[ap].x, P[ap].y, 0),
      c1 = pr(P[ap].x + 19, P[ap].y, 0),
      rx = Math.abs(c1[0] - c0[0]) || 20;
    X.strokeStyle = "#ffd23f";
    X.lineWidth = 2.5;
    X.beginPath();
    X.ellipse(c0[0], c0[1], rx, rx * 0.42, 0, 0, 6.3);
    X.stroke();
  }
  if (MP2 && P[ap2]) {
    const w1 = W3(P[ap2].x, P[ap2].y, 0),
      q1 = pj(w1[0], 0, w1[2]);
    X.strokeStyle = "#4fd1ff";
    X.beginPath();
    X.ellipse(q1[0], q1[1], 1.9 * q1[2], 0.8 * q1[2], 0, 0, 6.3);
    X.stroke();
  }
  if (!GL) {
    const L = [];
    P.forEach((p) => segs(p, L));
    const bw = W3(B.x, B.y, B.z),
      bq = pj(bw[0], bw[1], bw[2]),
      bf = pj(bw[0], 0, bw[2]);
    X.fillStyle = "rgba(0,0,0,.35)";
    X.beginPath();
    X.ellipse(bf[0], bf[1], 0.5 * bf[2], 0.22 * bf[2], 0, 0, 6.3);
    X.fill();
    L.push({ z: bq[3] - 0.3, ball: bq });
    L.sort((a, b) => b.z - a.z);
    L.forEach((o) => (o.ball ? ballD(o.ball) : paint(o)));
  }
  hud();
  hud2();
  X.textAlign = "center";
  X.font = "700 11px system-ui";
  X.fillStyle = "#fff";
  for (const p of [P[ap], B.owner, MP2 ? P[ap2] : null])
    if (p) {
      const [sx, sy] = pr(p.x, p.y, p.z + 78);
      X.fillText(p.n.toUpperCase() + " " + ovr(p), sx, sy);
    }
  const p0 = P[ap];
  contestFx(p0);
  meter(p0);
  openMark();
  passMark();
  replayHud();
  if (MP2 && P[ap2]) {
    contestFx(P[ap2]);
    meter(P[ap2]);
  }
}
let last = performance.now();
let ACC = 0;
function loop(n) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (n - last) / 1000);
  last = n;
  if (S === "play") {
    ACC += dt;
    let k = 0;
    while (ACC >= 1 / 60 && k < 6) {
      upd(1 / 60);
      ACC -= 1 / 60;
      k++;
    }
  } else T += dt;
  draw();
}
function kd(c) {
  if (RPL && c === "Space") RPL.i = 1e9;
  if (!K[c]) {
    K[c] = 1;
    if (c === "KeyK") {
      CAMM = (CAMM + 1) % 4;
      txt("CAMERA: " + CAMN[CAMM], 480, 200, "#ffd23f");
    }
    if (c === "Space") ev.sd = 1;
    if (c === "Enter") ev2.sd = 1;
    if (c === "Slash") ev2.e = 1;
    if (c === "Period") ev2.x = 1;
    if (c === "Comma") ev2.cc = 1;
    if (c === "KeyE") ev.e = 1;
    if (c === "KeyQ") ev.q = 1;
    if (c === "KeyF") ev.f = 1;
    if (c === "KeyX") ev.x = 1;
    if (c === "KeyR") ev.r = 1;
    if (c === "KeyC") ev.cc = 1;
    if (c === "KeyV") ev.vv = 1;
    if (c === "KeyT") TEMPO = 1 - TEMPO;
    if (c === "KeyM") {
      METER = (METER + 1) % 4;
      txt("METER: " + MN[METER], 480, 200, "#ffd23f");
    }
  }
}
function ku(c) {
  K[c] = 0;
  if (c === "Space") ev.su = 1;
  if (c === "Enter") ev2.su = 1;
}
addEventListener("keydown", (e) => {
  if (
    [
      "Space",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Slash",
      "Enter",
    ].includes(e.code)
  )
    e.preventDefault();
  kd(e.code);
});
addEventListener("keyup", (e) => ku(e.code));
document.querySelectorAll("#tc button").forEach((b) => {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    kd(b.dataset.k);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) =>
    b.addEventListener(t, () => {
      if (K[b.dataset.k]) ku(b.dataset.k);
    }),
  );
});
rapInit();
if (typeof THREE !== "undefined") glInit();
menu();
requestAnimationFrame(loop);
