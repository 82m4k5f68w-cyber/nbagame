// Settings (UI v6): persistence (localStorage h2k_set, the browser game's shape - the Unity page reads the same keys)
// and the tabbed settings drawer #sd (Gameplay / Controls / Display / Audio / Accessibility). Opened from the hub
// (before any game boots), the matchup screen and the pause menu. Every tab panel is in the DOM (inactive ones
// hidden), so `[data-<key>]` selectors always resolve. Options are segmented buttons `data-<key>="<value>"`.
import { cfg } from "../../core/sim";
import { V, CAMN, MN, HSRN, PAL, QLN, PRESETS, applyPreset, GRADES, WXN } from "../view";
import { IN, ACTS, KMAP, saveKeys } from "../input";
import { crowd } from "../crowd";
import { comment, rumble } from "../broadcast";
import { trapNav, NAV } from "./nav";

/** Shell state that lives with the settings (was module state in game.ts). */
export const ST = {
  QPICK: 0, // the player chose a graphics level (saved; otherwise the GPU-tier default applies)
  HPICK: 0, // same for the HSR mode
  MYM: 0, // My Player mode
  QLEN: 60, // quarter length (s)
};
const KEYS = ["PRE", "AO", "GRADE", "GRAIN", "WX", "COMM", "VOICE", "ANNV", "MUSIC", "RUMBLE", "CB", "BIGM", "AUTO", "INTRO", "THEME", "TXT", "RM", "HC", "MINHUD", "SPT"];
export function loadSet() {
  try {
    const o = JSON.parse(localStorage.getItem("h2k_set") || "{}");
    if (o.m != null) V.METER = o.m;
    if (o.s != null) IN.TEMPO = o.s;
    if (o.p != null) cfg.PRO = o.p;
    if (o.cm != null) V.CAMM = o.cm;
    if (o.q2 != null) (V.QL = o.q2), (ST.QPICK = 1); // only an explicit pick (old saves always carried "q" = the default)
    if (o.fx != null) V.FX = !!o.fx;
    if (o.gp != null) V.GPU = o.gp ? 1 : 0;
    if (o.hs != null) (V.HSR = o.hs), (ST.HPICK = 1);
    if (o.hm != null) V.HSRM = o.hm;
    if (o.tf != null) V.TFPS = o.tf;
    if (o.fc != null) V.FPSC = o.fc;
    if (o.my != null) ST.MYM = o.my;
    if (o.df != null) cfg.DIFF = o.df;
    if (o.ql) ST.QLEN = o.ql;
    if (o.ru) Object.assign(cfg, o.ru);
    for (const k of KEYS) if (o[k] != null) (V as any)[k] = o[k];
    if (o.CROWD != null) crowd.vol = o.CROWD;
    if (o.CHANTS != null) crowd.on = o.CHANTS;
  } catch (e) {}
  applyA11y();
}
export function saveSet() {
  try {
    const o: any = {
      m: V.METER, s: IN.TEMPO, p: cfg.PRO, cm: V.CAMM, q2: ST.QPICK ? V.QL : undefined, fx: V.FX ? 1 : 0, gp: V.GPU, hs: ST.HPICK ? V.HSR : undefined, hm: V.HSRM, tf: V.TFPS, fc: V.FPSC, my: ST.MYM, df: cfg.DIFF, ql: ST.QLEN,
      ru: { FOULS: cfg.FOULS, SCLK: cfg.SCLK, VIOL: cfg.VIOL, SUBS: cfg.SUBS, BADGES: cfg.BADGES, SHATTER: cfg.SHATTER },
      CROWD: crowd.vol, CHANTS: crowd.on,
    };
    for (const k of KEYS) o[k] = (V as any)[k];
    localStorage.setItem("h2k_set", JSON.stringify(o));
  } catch (e) {}
}
/** Root switches for tokens.css: theme, text size, reduced motion, high contrast. */
export function applyA11y() {
  const d = document.documentElement;
  d.dataset.theme = ["dark", "light", "auto"][V.THEME] || "dark";
  d.dataset.text = String(V.TXT || 0);
  if (V.RM) d.dataset.motion = "reduce";
  else delete d.dataset.motion;
  if (V.HC) d.dataset.contrast = "high";
  else delete d.dataset.contrast;
}

/** Display refresh line under Target FPS: browsers never draw faster than the screen refreshes. */
export const hzLine = () => {
  const hz = V.HZ;
  if (!hz) return "Auto resolution holds this frame rate. Browsers draw at most once per screen refresh.";
  const t = V.TFPS || hz;
  return `Your screen: ${hz} Hz. ` + (t > hz ? `Browsers can't draw faster than the screen, so ${V.TFPS} acts as Max (${hz} FPS).` : V.TFPS ? `Auto resolution aims for ${t} FPS.` : `Auto resolution aims for every refresh (${hz} FPS).`);
};
export const keyName = (c: string) => (c || "?").replace(/^Key/, "").replace(/^Digit/, "").replace("ShiftLeft", "L-Shift").replace("ShiftRight", "R-Shift").replace("ControlLeft", "L-Ctrl").replace("Arrow", "");
const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

// ---------------- the drawer ----------------
export type Ctx = "hub" | "menu" | "pause";
/** Shell hooks (game.ts binds them; the hub leaves most empty). */
export const SETH = {
  onEdit: null as null | (() => void),
  onOnline: null as null | (() => void),
  onReel: null as null | ((f: File) => void),
};
type O = [number, string];
type It = { k: string; l: string; o: O[]; g: () => number; s: (v: number) => void; h?: string | (() => string); hid?: string; on?: (c: Ctx) => boolean };
const onoff: O[] = [
  [1, "On"],
  [0, "Off"],
];
const CRN: O[] = [
  [0, "Off"],
  [35, "Low"],
  [70, "Medium"],
  [100, "Full"],
];
const r3d = (c: Ctx) => c === "hub" || V.r3d;
const notPause = (c: Ctx) => c !== "pause";
const cmtV = () => (V.COMM ? (V.VOICE ? 2 : 1) : 0);
export const TABS: [string, string, string][] = [
  ["gameplay", "Gameplay", "🏀"],
  ["controls", "Controls", "🎮"],
  ["display", "Display", "🖥"],
  ["audio", "Audio", "🔊"],
  ["access", "Accessibility", "♿"],
];
/** Every option: key (data- attribute), label, choices, get/set, hint. Grouped per tab below. */
const I: Record<string, It> = {
  mp: { k: "mp", l: "Players", o: [[0, "1 Player"], [1, "2 Players (keyboard)"]], g: () => IN.MP2, s: (v) => (IN.MP2 = v), on: notPause, h: "Player 2 takes the right-side team: arrows move · Enter shoot · / pass · . spin · , hesi · Right Shift sprint" },
  my: { k: "my", l: "Player mode", o: [[0, "Pick a team"], [1, "My Player"]], g: () => ST.MYM, s: (v) => (ST.MYM = v), on: notPause },
  df: { k: "df", l: "Difficulty", o: [[0, "Rookie"], [1, "Pro"], [2, "All-Star"], [3, "Hall of Fame"]], g: () => cfg.DIFF, s: (v) => (cfg.DIFF = v), h: "Applies to CPU teams: ratings, coach IQ (sets, doubles, rotations)." },
  p: { k: "p", l: "Pro Play engine", o: onoff, g: () => cfg.PRO, s: (v) => (cfg.PRO = v) },
  s: { k: "s", l: "Shooting style", o: [[0, "Hold & release"], [1, "Tempo"]], g: () => IN.TEMPO, s: (v) => (IN.TEMPO = v), h: "Tempo: tap shoot to start, tap again on green (T in game)." },
  m: { k: "m", l: "Shot meter", o: MN.map((n, i) => [i, n] as O), g: () => V.METER, s: (v) => (V.METER = v), h: "Green is always at the top. A defender in your face shrinks the window (CONTESTED / SMOTHERED)." },
  rf: { k: "rf", l: "Fouls", o: onoff, g: () => cfg.FOULS, s: (v) => (cfg.FOULS = v) },
  rc: { k: "rc", l: "Shot clock", o: onoff, g: () => cfg.SCLK, s: (v) => (cfg.SCLK = v) },
  rv: { k: "rv", l: "Violations", o: onoff, g: () => cfg.VIOL, s: (v) => (cfg.VIOL = v), h: "3 seconds · 8 seconds · goaltending · out of bounds" },
  rs: { k: "rs", l: "Fatigue & subs", o: onoff, g: () => cfg.SUBS, s: (v) => (cfg.SUBS = v), h: "5v5: reserves check in, 6 fouls = out" },
  rb: { k: "rb", l: "Badges & hot zones", o: onoff, g: () => cfg.BADGES, s: (v) => (cfg.BADGES = v) },
  rg: { k: "rg", l: "Glass-breaking dunks", o: onoff, g: () => cfg.SHATTER, s: (v) => (cfg.SHATTER = v), h: "Very rare: a monster dunk shatters the backboard (a stoppage while it is replaced)." },
  pi: { k: "pi", l: "Player intros", o: onoff, g: () => V.INTRO, s: (v) => (V.INTRO = v), h: "Starting-lineup cards before the tip." },
  ru: { k: "ru", l: "Gamepad rumble", o: onoff, g: () => V.RUMBLE, s: (v) => ((V.RUMBLE = v), rumble(0.6, 200)) },
  cm: { k: "cm", l: "Camera", o: CAMN.map((n, i) => [i, n] as O), g: () => V.CAMM, s: (v) => (V.CAMM = v), on: r3d, h: "K in game cycles the camera." },
  pre: { k: "pre", l: "Graphics preset", o: [...PRESETS.map((p, i) => [i, p[0]] as O), [-1, "Custom"]], g: () => V.PRE, s: (v) => (v >= 0 ? (applyPreset(v), (ST.QPICK = 1), (ST.HPICK = 1)) : (V.PRE = -1)), on: r3d, h: () => (V.PRE >= 0 ? PRESETS[V.PRE][4] : "Your own mix of the options below.") , hid: "prehint" },
  q: { k: "q", l: "Graphics", o: QLN.map((n, i) => [i, n] as O), g: () => V.QL, s: (v) => ((V.QL = v), (ST.QPICK = 1), (V.QAUTO = ""), (V.PRE = -1)), on: r3d, h: () => (ST.QPICK ? "Saved. Ultra = everything max (4K soft shadows, live jumbotron cam, full crowd)." : "Picked for your GPU until you choose.") },
  fx: { k: "fx", l: "Effects", o: onoff, g: () => (V.FX ? 1 : 0), s: (v) => ((V.FX = !!v), (V.PRE = -1)), on: r3d, h: "Bloom, ambient occlusion, motion blur, colour grade." },
  ao: { k: "ao", l: "Ambient occlusion", o: [[-1, "Auto"], [0, "Off"], [1, "Half res"], [2, "Full res"]], g: () => V.AO, s: (v) => ((V.AO = v), (V.PRE = -1)), on: r3d, h: "Soft contact shadows in corners, under players and in the stands (N8AO). Auto = full res on High / Ultra." },
  gr: { k: "gr", l: "Colour look", o: GRADES.map((g, i) => [i, g[0]] as O), g: () => V.GRADE, s: (v) => (V.GRADE = v), on: r3d },
  fg: { k: "fg", l: "Film grain & vignette", o: onoff, g: () => V.GRAIN, s: (v) => (V.GRAIN = v), on: r3d },
  wx: { k: "wx", l: "Street weather", o: WXN.map((n, i) => [i, n[0].toUpperCase() + n.slice(1)] as O), g: () => Math.max(0, WXN.indexOf(V.WX)), s: (v) => (V.WX = WXN[v] || "auto"), on: r3d, h: "Street courts: Auto follows your local time of day (and a rainy or snowy day now and then)." },
  gp: { k: "gp", l: "Renderer", o: [[0, "WebGL"], [1, "WebGPU (beta)"]], g: () => V.GPU, s: (v) => ((V.GPU = v), saveSet(), setTimeout(() => location.reload(), 150)), on: r3d, h: () => (V.backend ? "Now: " + V.backend + ((V.backend === "WebGL") !== !V.GPU ? " · restart to switch" : "") + ". " : "") + "Switching reloads the page." },
  hsr: { k: "hsr", l: "Super resolution (HSR)", o: HSRN.map((n, i) => [i, n] as O), g: () => V.HSR, s: (v) => ((V.HSR = v), (ST.HPICK = 1), (V.PRE = -1)), on: r3d, h: "Draws fewer pixels and rebuilds a sharp full-size image from several frames (temporal upscaling, like DLSS / FSR 2, no AI). Quality 67% · Balanced 58% · Performance 50% · Ultra 33%; Auto holds your target." },
  hsrm: { k: "hsrm", l: "Upscaler", o: [[0, "Auto"], [1, "Temporal"], [2, "Spatial"]], g: () => V.HSRM, s: (v) => (V.HSRM = v), on: r3d, h: "Spatial (FSR 1 style) is lighter for very old GPUs; Auto uses it on Low graphics." },
  tfps: { k: "tfps", l: "Target FPS", o: [60, 90, 120, 144, 240, 0].map((f) => [f, f ? String(f) : "Max"] as O), g: () => V.TFPS, s: (v) => (V.TFPS = v), on: r3d, h: hzLine, hid: "hzline" },
  fpsc: { k: "fpsc", l: "FPS counter", o: onoff, g: () => V.FPSC, s: (v) => (V.FPSC = v) },
  mh: { k: "mh", l: "HUD", o: [[0, "Full"], [1, "Minimal"]], g: () => V.MINHUD, s: (v) => (V.MINHUD = v), h: "Minimal keeps the score bug, shot clock and meter; hides the player card, play calls and markers." },
  th: { k: "th", l: "Menu theme", o: [[0, "Dark"], [1, "Light"], [2, "System"]], g: () => V.THEME, s: (v) => ((V.THEME = v), applyA11y()) },
  cmt: { k: "cmt", l: "Commentary", o: [[0, "Off"], [1, "Captions"], [2, "Captions + voice"]], g: cmtV, s: (v) => ((V.COMM = v ? 1 : 0), (V.VOICE = v === 2 ? 1 : 0), v === 2 && comment("clutch")) },
  anv: { k: "anv", l: "Announcer voice", o: [[2, "AI"], [1, "Browser"], [0, "Off"]], g: () => V.ANNV, s: (v) => ((V.ANNV = v), v && V.VOICE && comment("clutch")), h: "AI = the recorded announcer + PA voice (falls back to the browser's speech)." },
  vcmd: { k: "vcmd", l: "Voice commands (beta)", o: [[0, "Off"], [1, "On"]], g: () => V.VCMD, s: (v) => ((V.VCMD = v), import("../voicecmd").then((m) => { if (v) m.enableVoiceCommands().then((ok) => { if (!ok) V.VCMD = 0; }); else m.disableVoiceCommands(); })), h: "Hold ` and say: timeout · sub · call horns / spain / post · switch · pause. Turning it on asks for the microphone and downloads Whisper tiny (~41 MB model + ~25 MB runtime, once); speech stays on your device." },
  mu: { k: "mu", l: "Arena music", o: onoff, g: () => V.MUSIC, s: (v) => (V.MUSIC = v) },
  vc: { k: "vc", l: "Crowd volume", o: CRN, g: () => crowd.vol, s: (v) => (crowd.vol = v) },
  ch: { k: "ch", l: "Crowd chants", o: onoff, g: () => (crowd.on ? 1 : 0), s: (v) => (crowd.on = v), h: "DE-FENSE · LET'S GO · M-V-P · AIR BALL · boos and roars" },
  ts: { k: "ts", l: "Text size", o: [[0, "Normal"], [1, "Large"], [2, "Extra large"]], g: () => V.TXT, s: (v) => ((V.TXT = v), applyA11y()), h: "Menus and the in-game HUD." },
  cb: { k: "cb", l: "Meter colours", o: PAL.map((p, i) => [i, p.n] as O), g: () => V.CB, s: (v) => (V.CB = v), h: "Red-green safe for protanopia / deuteranopia, blue-yellow safe for tritanopia." },
  bm: { k: "bm", l: "Meter size", o: [[0, "Normal"], [1, "Large"]], g: () => V.BIGM, s: (v) => (V.BIGM = v) },
  hc: { k: "hc", l: "High contrast", o: onoff, g: () => V.HC, s: (v) => ((V.HC = v), applyA11y()), h: "Solid HUD panels, outlined text, stronger lines in menus." },
  rm: { k: "rm", l: "Reduce motion", o: onoff, g: () => V.RM, s: (v) => ((V.RM = v), applyA11y()), h: "No menu animations or camera shake." },
  spt: { k: "spt", l: "Sprint", o: [[0, "Hold"], [1, "Toggle"]], g: () => V.SPT, s: (v) => (V.SPT = v), h: "Toggle: tap sprint once to run, again to stop." },
  au: { k: "au", l: "Auto-release assist", o: onoff, g: () => V.AUTO, s: (v) => (V.AUTO = v), h: "Hold & release only: lets go near the top of the meter for you." },
};
const row = (c: Ctx, it: It) => {
  if (it.on && !it.on(c)) return "";
  const cur = it.g(),
    h = typeof it.h === "function" ? it.h() : it.h,
    sw = it.k === "cb" ? (i: number) => `<span class="swatch" aria-hidden="true"><i style="background:${PAL[i].g}"></i><i style="background:${PAL[i].f}"></i></span> ` : () => "";
  return `<div class="srow"><span class="sl" id="sl-${it.k}">${esc(it.l)}</span><div class="seg" role="group" aria-labelledby="sl-${it.k}">${it.o
    .map(([v, n]) => `<button type="button" data-${it.k}="${v}" class="${cur === v ? "on" : ""}" aria-pressed="${cur === v}">${sw(v)}${esc(n)}</button>`)
    .join("")}</div>${h ? `<p class="hint"${it.hid ? ` id="${it.hid}"` : ""}>${esc(h)}</p>` : ""}</div>`;
};
const grp = (c: Ctx, h: string, ks: string[], extra = "") => {
  const body = ks.map((k) => row(c, I[k])).join("") + extra;
  return body ? `<section class="sgrp"><h3>${h}</h3>${body}</section>` : "";
};
const PADK = [["Move", "Left stick"], ["Shoot (hold, release on green)", "A"], ["Pass / lob", "X / B"], ["Step-back", "Y"], ["Hesitation / spin", "LB / RB"], ["Post up / sprint", "LT / RT"], ["Pump fake · play call", "L3 · R3"], ["Timeout · challenge", "D-pad ↑ · ↓"], ["Camera", "Select"], ["Pause", "Start"]];
const NAVK = [["Move between buttons", "Arrows · D-pad"], ["Select", "Enter · Space · A"], ["Back · close", "Esc · B"], ["Your team · opponent (matchup)", "Q E · Z C · LB RB · LT RT"], ["Settings", "S on the matchup screen"]];
function panels(c: Ctx) {
  const gameplay =
    (notPause(c)
      ? `<section class="sgrp"><h3>Match</h3>${row(c, I.mp)}${row(c, I.my)}<div class="sbtns"><button type="button" class="btn sm" id="edit">✎ Edit My Player</button><button type="button" class="btn sm" id="online">🌐 Play online</button><label class="btn sm ld" tabindex="0">📼 Watch a saved reel<input type="file" id="rlf" accept=".json,application/json" hidden></label></div></section>`
      : "") +
    grp(c, "Difficulty", ["df", "p"]) +
    grp(c, "Shooting", ["s", "m"]) +
    grp(c, "Rules", ["rf", "rc", "rv", "rs", "rb", "rg"]) +
    grp(c, "Presentation", ["pi"]);
  const controls =
    `<section class="sgrp"><h3>Keyboard</h3><p class="hint">Select an action, then press its new key (Esc cancels). Movement stays on WASD / arrows.</p><div class="keys2">${ACTS.map(([id, l]) => `<button type="button" data-key="${id}" aria-label="${esc(l)}: ${esc(keyName(KMAP[id]))}"><span>${esc(l)}</span><kbd>${esc(keyName(KMAP[id]))}</kbd></button>`).join("")}</div><div class="sbtns"><button type="button" id="krs" class="btn sm ghost">Reset keys</button></div></section>` +
    grp(c, "Gamepad", ["ru"], `<div class="kref">${PADK.map(([a, b]) => `<span>${a}</span><kbd>${b}</kbd>`).join("")}</div>`) +
    `<section class="sgrp"><h3>Menus</h3><div class="kref">${NAVK.map(([a, b]) => `<span>${a}</span><kbd>${b}</kbd>`).join("")}</div></section>` +
    `<section class="sgrp"><h3>Touch</h3><p class="hint">Thumb on the left half of the court = analog stick (push to the edge to sprint); hold the right half to shoot or jump. The buttons under the court do the rest.</p></section>`;
  const display = grp(c, "Camera & quality", ["cm", "pre", "q", "fx", "ao", "gp"]) + grp(c, "Look", ["gr", "fg", "wx"]) + grp(c, "Performance", ["hsr", "hsrm", "tfps", "fpsc"]) + grp(c, "Interface", ["mh", "th"]);
  const audio = grp(c, "Broadcast", ["cmt", "anv", "vcmd"]) + grp(c, "Arena", ["mu", "vc", "ch"]);
  const access = grp(c, "Vision", ["ts", "cb", "bm", "hc"]) + grp(c, "Motion", ["rm"]) + grp(c, "Input", ["spt", "au"]);
  return { gameplay, controls, display, audio, access } as Record<string, string>;
}
let TAB = "gameplay",
  CTX: Ctx = "menu",
  onClose: null | (() => void) = null,
  opener: HTMLElement | null = null,
  untrap: null | (() => void) = null;
export const settingsOpen = () => {
  const s = document.getElementById("sd");
  return !!s && !s.hidden;
};
/** Open (or re-render) the drawer. ctx decides which groups show; close() runs onClose (the shell re-renders). */
export function openSettings(tab?: string, ctx?: Ctx, close?: () => void) {
  const fresh = !settingsOpen();
  if (fresh) {
    opener = document.activeElement as HTMLElement;
    onClose = close || null;
  }
  if (ctx) CTX = ctx;
  if (tab) TAB = tab;
  let s = document.getElementById("sd") as HTMLElement,
    m = document.getElementById("sdm") as HTMLElement;
  if (!s) {
    m = document.createElement("div");
    m.id = "sdm";
    m.onclick = closeSettings;
    s = document.createElement("aside");
    s.id = "sd";
    s.setAttribute("role", "dialog");
    s.setAttribute("aria-modal", "true");
    s.setAttribute("aria-label", "Settings");
    document.body.append(m, s);
  }
  const P = panels(CTX),
    sc = (s.querySelector(".sdb") as HTMLElement)?.scrollTop || 0;
  s.innerHTML = `<div class="sdh"><h2 class="disp">Settings</h2><button type="button" class="btn icon ghost" id="sdx" aria-label="Close settings">✕</button></div>
   <div class="tabs" role="tablist">${TABS.map(([k, n, ic]) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="sdp-${k}" aria-selected="${k === TAB}" tabindex="${k === TAB ? 0 : -1}"><span aria-hidden="true">${ic}</span> ${n}</button>`).join("")}</div>
   <div class="sdb">${TABS.map(([k]) => `<div class="sdp" role="tabpanel" id="sdp-${k}" aria-labelledby="tab-${k}"${k === TAB ? "" : " hidden"}>${P[k]}</div>`).join("")}</div>`;
  s.hidden = false;
  m.hidden = false;
  if (!fresh) (s.querySelector(".sdb") as HTMLElement).scrollTop = sc;
  bind(s);
  if (untrap) untrap();
  untrap = trapNav(s, closeSettings);
  if (fresh) (s.querySelector(`[data-tab="${TAB}"]`) as HTMLElement).focus();
}
export function closeSettings() {
  const s = document.getElementById("sd"),
    m = document.getElementById("sdm");
  if (!s || s.hidden) return;
  s.hidden = true;
  if (m) m.hidden = true;
  if (untrap) (untrap(), (untrap = null));
  saveSet();
  const f = onClose,
    o = opener;
  onClose = null;
  opener = null;
  if (f) f();
  else if (o && o.isConnected) o.focus();
}
function bind(s: HTMLElement) {
  const tabs = [...s.querySelectorAll<HTMLElement>("[data-tab]")];
  const show = (k: string, focus = true) => {
    TAB = k;
    for (const b of tabs) {
      const on = b.dataset.tab === k;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      (s.querySelector("#sdp-" + b.dataset.tab) as HTMLElement).hidden = !on;
    }
    (s.querySelector(".sdb") as HTMLElement).scrollTop = 0;
    if (focus) (s.querySelector(`[data-tab="${k}"]`) as HTMLElement).focus();
  };
  tabs.forEach((b, i) => {
    b.onclick = () => show(b.dataset.tab!);
    b.onkeydown = (e) => {
      // tabs: Left / Right switch (WAI-ARIA tabs pattern); Down enters the panel
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        show(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].dataset.tab!);
      }
    };
  });
  (s.querySelector("#sdx") as HTMLElement).onclick = closeSettings;
  for (const k in I) {
    const it = I[k];
    s.querySelectorAll<HTMLElement>(`[data-${k}]`).forEach(
      (b) =>
        (b.onclick = () => {
          it.s(+b.dataset[k]!);
          saveSet();
          // every option row follows the state (a preset changes several at once)
          for (const k2 in I)
            s.querySelectorAll<HTMLElement>(`[data-${k2}]`).forEach((c) => {
              const on = +c.dataset[k2]! === I[k2].g();
              c.classList.toggle("on", on);
              c.setAttribute("aria-pressed", String(on));
            });
          if (it.hid) {
            const h = s.querySelector("#" + it.hid);
            if (h && typeof it.h === "function") h.textContent = it.h();
          }
        }),
    );
  }
  s.querySelectorAll<HTMLElement>("[data-key]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.key!;
        b.classList.add("wait");
        b.querySelector("kbd")!.textContent = "press a key…";
        NAV.hold = 1;
        const h = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          removeEventListener("keydown", h, true);
          NAV.hold = 0;
          if (e.code !== "Escape") {
            for (const k in KMAP) if (KMAP[k] === e.code && k !== id) KMAP[k] = KMAP[id]; // swap a clash
            KMAP[id] = e.code;
            saveKeys();
          }
          openSettings();
          (document.querySelector(`#sd [data-key="${id}"]`) as HTMLElement)?.focus();
        };
        addEventListener("keydown", h, true);
      }),
  );
  const krs = s.querySelector<HTMLElement>("#krs");
  if (krs)
    krs.onclick = () => {
      for (const [id, , d] of ACTS) KMAP[id] = d;
      saveKeys();
      openSettings();
    };
  const hook = (id: string, f: null | (() => void)) => {
    const b = s.querySelector<HTMLElement>("#" + id);
    if (!b) return;
    if (!f) return void (b.hidden = true);
    b.onclick = () => {
      onClose = null;
      closeSettings();
      f();
    };
  };
  hook("edit", SETH.onEdit);
  hook("online", SETH.onOnline);
  const rl = s.querySelector<HTMLInputElement>("#rlf");
  if (rl) {
    const lab = rl.closest("label") as HTMLElement;
    if (!SETH.onReel) lab.hidden = true;
    else {
      lab.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), rl.click());
      rl.onchange = () => {
        const f = rl.files;
        if (f && f[0] && SETH.onReel) {
          const g = SETH.onReel;
          onClose = null;
          closeSettings();
          g(f[0]);
        }
      };
    }
  }
}
