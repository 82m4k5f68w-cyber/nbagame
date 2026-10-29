// Save hub + save indicator + quicksave key + recovery / quota toasts + cloud conflict prompt (UI v6 tokens/kit).
// The data side is save.ts. Used by the main hub (header "Saves" button) and LIFE (title screen = this hub, pause menu).
import * as SV from "./save";

const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const CSS = `
#svi{position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:97;display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:var(--r-pill);background:var(--glass);border:1px solid var(--line);color:var(--tx);font:700 var(--fs-xs)/1 var(--ff-ui);letter-spacing:.06em;text-transform:uppercase;box-shadow:var(--sh-1);pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity var(--dur-2),transform var(--dur-2)}
#svi.on{opacity:1;transform:none}
#svi i{width:12px;height:12px;border-radius:50%;border:2px solid var(--acc-2);border-right-color:transparent;animation:svspin .8s linear infinite}
#svi.ok i{border-color:var(--ok);animation:none;background:var(--ok)}
@keyframes svspin{to{transform:rotate(360deg)}}
#svt{position:fixed;left:50%;top:calc(14px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:98;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:min(560px,calc(100% - 32px))}
#svt div{pointer-events:auto;padding:10px 16px;border-radius:var(--r-md);background:var(--ink-3);color:var(--tx);border:1px solid var(--line-2);box-shadow:var(--sh-2);font:600 var(--fs-sm)/1.35 var(--ff-ui);animation:kin var(--dur-2) var(--ease) both}
#svt .warn{border-color:var(--warn)} #svt .bad{border-color:var(--bad)} #svt .ok{border-color:var(--ok)}
#svh{position:fixed;inset:0;z-index:95;overflow:auto;background:var(--scrim);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);padding:calc(var(--sp-4) + env(safe-area-inset-top,0px)) var(--gutter) var(--sp-8);font-family:var(--ff-ui);color:var(--tx);text-align:left}
.svw{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:var(--sp-4)}
.svw.inl{padding:var(--sp-4) 0}
.svhd{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3)}
.svhd h2{font:700 var(--fs-2xl)/1 var(--ff-display);letter-spacing:.02em;margin:0;flex:1;min-width:160px}
.svhd .acts{display:flex;flex-wrap:wrap;gap:var(--sp-2)}
.svcl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);color:var(--tx-2);font-size:var(--fs-sm)}
.svg{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:var(--sp-3)}
.svc{display:flex;flex-direction:column;border-radius:var(--r-lg);background:var(--ink-2);border:1px solid var(--line);overflow:hidden;box-shadow:var(--sh-1);min-width:0}
.svc.last{border-color:var(--acc-2)}
.svc .th{position:relative;aspect-ratio:16/9;background:linear-gradient(135deg,var(--c,#2a2f6a),var(--ink-0));background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:var(--sp-2) var(--sp-3)}
.svc .th b{font:700 var(--fs-xl)/1 var(--ff-display);text-shadow:0 2px 8px rgba(0,0,0,.7);color:#fff}
.svc .th .chip{position:absolute;top:8px;left:8px}
.svc .th .slot{position:absolute;top:8px;right:10px;font:700 var(--fs-xs)/1 var(--ff-ui);color:#fff;opacity:.85;text-shadow:0 1px 4px #000}
.svc .bd{padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);flex:1}
.svc .sub{color:var(--tx-2);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svc dl{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:0}
.svc dl div{background:var(--glass-2);border-radius:var(--r-xs);padding:5px 6px;min-width:0}
.svc dt{font-size:var(--fs-2xs);color:var(--tx-3);letter-spacing:.08em;text-transform:uppercase}
.svc dd{margin:0;font:700 var(--fs-sm)/1.2 var(--ff-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svc .when{font-size:var(--fs-xs);color:var(--tx-3)}
.svc .ba{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto}
.svc .ba .btn{padding:6px 10px;min-height:34px;font-size:var(--fs-sm)}
.svc.empty .th{background:repeating-linear-gradient(135deg,var(--ink-1) 0 12px,var(--ink-2) 12px 24px)}
.svbk{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line);padding-top:var(--sp-2)}
.svbk div{display:flex;align-items:center;gap:8px;font-size:var(--fs-xs);color:var(--tx-2)}
.svbk div span{flex:1;min-width:0}
.svbk .btn{padding:4px 9px;min-height:28px;font-size:var(--fs-xs)}
.svsec{font:700 var(--fs-xs)/1 var(--ff-ui);letter-spacing:var(--ls-caps);text-transform:uppercase;color:var(--tx-3);margin-top:var(--sp-2)}
.svcf{position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:var(--scrim);padding:var(--gutter)}
.svcf .panel{max-width:620px;width:100%;padding:var(--sp-5);border-radius:var(--r-lg);background:var(--ink-1);border:1px solid var(--line-2);box-shadow:var(--sh-3)}
.svcf .two{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3);margin:var(--sp-3) 0}
.svcf .two>div{border:1px solid var(--line);border-radius:var(--r-md);padding:var(--sp-3);display:flex;flex-direction:column;gap:6px}
.svcf .two>div.new{border-color:var(--ok)}
@media (max-width:520px){.svc dl{grid-template-columns:repeat(2,1fr)}.svcf .two{grid-template-columns:1fr}}
`;
let quick: (() => void) | null = null;
let inited = false;
let indT: any = 0;

export function initSaveUI() {
  if (inited) return;
  inited = true;
  SV.init();
  (window as any).H2K_SAVE = { SV, openSaveHub, quickSave, toasts: TLOG }; // debug / tests
  if (!document.getElementById("svcss")) {
    const s = document.createElement("style");
    s.id = "svcss";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  SV.onSave((e) => {
    if (e.k === "saving") ind("Saving…", false);
    else if (e.k === "saved" && e.msg !== "migrate") ind("Saved", true);
    else if (e.k === "recovered") toast("🛟 " + (e.msg || "Save restored from a backup"), "warn");
    else if (e.k === "quota") toast("💾 " + e.msg, "bad", 8000);
    else if (e.k === "error" && e.id) toast("⚠️ " + (e.msg || "Save failed"), "bad", 6000);
    else if (e.k === "conflict") conflicts();
    if (e.k !== "saving") refresh();
  });
  // quicksave: F5 / Ctrl+S (LIFE saves the life; elsewhere the game data gets a milestone snapshot)
  addEventListener(
    "keydown",
    (e) => {
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S"))) {
        e.preventDefault();
        e.stopPropagation();
        quickSave();
      }
    },
    true,
  );
  if (!/[?&]nocloud\b/.test(location.search))
    setTimeout(
      () =>
        SV.cloudInit()
          .then((on) => on && SV.cloudSync())
          .catch(() => {}),
      800,
    );
}
export function setQuick(f: (() => void) | null) {
  quick = f;
}
export function quickSave() {
  if (quick) quick();
  else SV.snapGame({ milestone: true });
  toast("💾 Quicksaved", "ok", 1800);
}
function ind(txt: string, ok: boolean) {
  let el = document.getElementById("svi");
  if (!el) {
    el = document.createElement("div");
    el.id = "svi";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.innerHTML = `<i></i><span>${esc(txt)}</span>`;
  el.className = "on" + (ok ? " ok" : "");
  clearTimeout(indT);
  if (ok) indT = setTimeout(() => el!.classList.remove("on"), 1600);
}
const TLOG: string[] = []; // last toasts (tests)
export function toast(msg: string, kind: "ok" | "warn" | "bad" | "" = "", ms = 4500) {
  TLOG.push(msg);
  if (TLOG.length > 20) TLOG.shift();
  let box = document.getElementById("svt");
  if (!box) {
    box = document.createElement("div");
    box.id = "svt";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const d = document.createElement("div");
  d.className = kind;
  d.textContent = msg;
  box.appendChild(d);
  while (box.children.length > 3) box.firstElementChild!.remove();
  setTimeout(() => d.remove(), ms);
}
/** A small compressed snapshot of a canvas (call right after it was drawn: WebGL buffers clear after compositing). */
export function snapThumb(src: HTMLCanvasElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = 224;
    c.height = 126;
    const g = c.getContext("2d")!;
    const sw = src.width,
      sh = src.height,
      a = sw / sh > 16 / 9 ? [(sw - (sh * 16) / 9) / 2, 0, (sh * 16) / 9, sh] : [0, (sh - (sw * 9) / 16) / 2, sw, (sw * 9) / 16];
    g.drawImage(src, a[0], a[1], a[2], a[3], 0, 0, c.width, c.height);
    let u = c.toDataURL("image/webp", 0.55);
    if (!u.startsWith("data:image/webp")) u = c.toDataURL("image/jpeg", 0.6);
    return u.length > 200 ? u : null;
  } catch (e) {
    return null;
  }
}
/** Save a text file: the artifact `downloads` capability when present (plain links are blocked there), else a Blob link. */
export async function download(name: string, data: string) {
  try {
    const c = (globalThis as any).claude;
    const dl = c && c.use ? await Promise.race([c.use("downloads").catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]) : null;
    if (dl) return void (await (dl as any).save({ filename: name, data }));
  } catch (e) {}
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fmtPt = (s?: number) => {
  s = s || 0;
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
const fmtMoney = (n?: number) => {
  n = n || 0;
  return "$" + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : Math.abs(n) >= 1e4 ? Math.round(n / 1e3) + "K" : Math.round(n).toLocaleString());
};
const STC: Record<string, string> = { hs: "#2f6fdb", college: "#8e44ad", draft: "#c0392b", nba: "#d35400" };
const STN: Record<string, string> = { hs: "HIGH SCHOOL", college: "COLLEGE", draft: "DRAFT", nba: "NBA" };

export type HubOpts = {
  ctx: "hub" | "life";
  /** LIFE: continue a slot (loads it) / start a new one. */
  onPlay?: (slot: number, data: any | null) => void;
  onClose?: () => void;
  /** Rendered inline (LIFE title) instead of as an overlay. */
  host?: HTMLElement;
  head?: string;
  foot?: string;
};
let cur: { o: HubOpts; el: HTMLElement; open: Set<string> } | null = null;
function refresh() {
  if (cur && cur.el.isConnected) draw();
}
/** The save hub: LIFE slots, game data, backups, export / import, cloud. */
export function openSaveHub(o: HubOpts) {
  initSaveUI();
  let el: HTMLElement;
  if (o.host) el = o.host;
  else {
    document.getElementById("svh")?.remove();
    el = document.createElement("div");
    el.id = "svh";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Saves");
    el.className = "kit";
    document.body.appendChild(el);
  }
  cur = { o, el, open: new Set() };
  draw();
  setTimeout(() => el.querySelector<HTMLElement>("[data-play],[data-new],.btn")?.focus(), 30);
  if (!o.host) el.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), close()));
  return el;
}
export function closeSaveHub() {
  close();
}
function close() {
  if (!cur) return;
  const c = cur;
  cur = null;
  if (!c.o.host) c.el.remove();
  c.o.onClose?.();
}
function card(slot: number) {
  const id = SV.lifeId(slot),
    m = SV.meta(id),
    last = SV.lastId() === id;
  const play = !!cur!.o.onPlay;
  if (!m)
    return `<article class="svc empty" data-slot="${slot}"><div class="th"><span class="slot">SLOT ${slot + 1}</span><b>Empty</b></div><div class="bd"><div class="sub">Start a new life: high school senior → college → NBA.</div><div class="ba">${play ? `<button type="button" class="btn pri" data-new="${slot}">New life ▶</button>` : ""}<button type="button" class="btn ghost" data-imp="${slot}">Import</button></div></div></article>`;
  const th = SV.thumb(id),
    bks = SV.backups(id),
    open = cur!.open.has(id);
  return `<article class="svc${last ? " last" : ""}" data-slot="${slot}" style="--c:${STC[m.stage || "hs"] || "#2a2f6a"}"><div class="th" ${th ? `style="background-image:url(${th})"` : ""}><span class="chip">${esc(STN[m.stage || "hs"] || "")}</span><span class="slot">SLOT ${slot + 1}${last ? " · LAST PLAYED" : ""}</span><b>${esc(m.name)}</b></div>
   <div class="bd"><div class="sub">${esc(m.sub || "")}</div>
   <dl><div><dt>Day</dt><dd>${m.day ?? "-"}</dd></div><div><dt>Record</dt><dd>${esc(m.rec || "-")}</dd></div><div><dt>Money</dt><dd>${fmtMoney(m.money)}</dd></div><div><dt>Played</dt><dd>${fmtPt(m.pt)}</dd></div></dl>
   <div class="when">Saved ${esc(SV.when(m.t))}${m.dev !== SV.device() ? " · other device" : ""} · ${Math.max(1, Math.round(m.sz / 1024))} KB</div>
   <div class="ba">${play ? `<button type="button" class="btn pri" data-play="${slot}">Continue ▶</button>` : ""}<button type="button" class="btn" data-exp="${id}" title="Export this slot">Export</button><button type="button" class="btn" data-bk="${id}" aria-expanded="${open}">Backups (${bks.length})</button><button type="button" class="btn ghost" data-del="${id}" title="Delete">Delete</button></div>
   ${open ? bkList(id) : ""}</div></article>`;
}
function bkList(id: string) {
  const b = SV.backups(id);
  return `<div class="svbk">${b.length ? b.map((x) => `<div><span>${esc(SV.when(x.t))} · day ${x.m.day ?? "?"} · ${esc(x.m.rec || "")} · ${fmtMoney(x.m.money)}</span><button type="button" class="btn" data-rs="${id}" data-k="${x.k}">Restore</button></div>`).join("") : "<div><span>No backups yet: one is kept every couple of minutes of play (the last " + SV.MAX_BK + ").</span></div>"}</div>`;
}
function gameCard() {
  const m = SV.meta("game"),
    open = cur!.open.has("game");
  if (!m) return `<article class="svc empty"><div class="th"><b>Game data</b></div><div class="bd"><div class="sub">My Player, your record, Season, settings: saved as you play.</div></div></article>`;
  return `<article class="svc" data-game="1" style="--c:#1d428a"><div class="th"><span class="chip">MY PLAYER · RECORD · SEASON · SETTINGS</span><b>${esc(m.name)}</b></div><div class="bd"><div class="sub">${esc(m.sub || "")}</div><dl><div><dt>Record</dt><dd>${esc(m.rec || "0-0")}</dd></div><div><dt>Size</dt><dd>${Math.max(1, Math.round(m.sz / 1024))} KB</dd></div><div><dt>Backups</dt><dd>${SV.backups("game").length}</dd></div><div><dt>Saved</dt><dd>${esc(SV.when(m.t))}</dd></div></dl>
   <div class="ba"><button type="button" class="btn" data-exp="game">Export</button><button type="button" class="btn" data-bk="game" aria-expanded="${open}">Backups (${SV.backups("game").length})</button></div>${open ? bkList("game") : ""}</div></article>`;
}
function cloudLine() {
  const c = SV.CLOUD;
  if (!c.on) return `<span class="chip">☁ Offline</span><span>Saves live on this device. Export a file to move them (or open the published page for cloud saves).</span>`;
  const st = c.state === "busy" ? "Syncing…" : c.state === "error" ? "Cloud error (" + esc(c.err) + ")" : c.at ? "Synced " + SV.when(c.at) : "Cloud on";
  return `<span class="chip" style="border-color:var(--ok)">☁ ${st}</span><span>Private to you, on every device you sign in on.</span><button type="button" class="btn" id="svsy">Sync now</button>${c.conflicts.length ? `<button type="button" class="btn pri" id="svcfb">Resolve ${c.conflicts.length} conflict${c.conflicts.length > 1 ? "s" : ""}</button>` : ""}`;
}
function draw() {
  const c = cur!,
    o = c.o;
  const used = SV.list().reduce((a, m) => a + m.sz, 0);
  c.el.innerHTML = `<div class="svw${o.host ? " inl" : ""}">
   ${o.head || ""}
   <div class="svhd"><h2>${o.ctx === "life" ? "Your lives" : "Saves"}</h2><div class="acts"><button type="button" class="btn" id="svea">⬇ Export all</button><label class="btn" style="cursor:pointer">⬆ Import<input type="file" accept=".json,application/json" id="svim" hidden></label>${o.host ? "" : `<button type="button" class="btn ghost" id="svx">Close</button>`}</div></div>
   <div class="svcl" id="svcl">${cloudLine()}</div>
   <div class="svsec">LIFE · ${SV.LIFE_SLOTS} slots · autosaves every 2 min + after every big moment · F5 / Ctrl+S quicksave</div>
   <div class="svg">${Array.from({ length: SV.LIFE_SLOTS }, (_, i) => card(i)).join("")}</div>
   ${o.ctx === "hub" ? `<div class="svsec">Game</div><div class="svg">${gameCard()}</div>` : ""}
   <div class="svsec" style="text-transform:none;letter-spacing:0">${Math.round(used / 1024)} KB of local storage in use · every save is checksummed, with the last ${SV.MAX_BK} versions kept as backups</div>
   ${o.foot || ""}</div>`;
  const q = <T extends HTMLElement>(s: string) => c.el.querySelectorAll<T>(s);
  q("[data-play]").forEach(
    (b) =>
      (b.onclick = async () => {
        const s = +b.dataset.play!;
        const d = await SV.load(SV.lifeId(s));
        if (!d) return toast("⚠️ That save could not be read (and no backup verified).", "bad");
        go(s, d);
      }),
  );
  q("[data-new]").forEach((b) => (b.onclick = () => go(+b.dataset.new!, null)));
  q("[data-exp]").forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.exp!,
          t = await SV.exportOne(id);
        if (!t) return toast("Nothing to export", "warn");
        const m = SV.meta(id)!;
        await download(`hoops2k27-${id}-${String(m.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`, t);
      }),
  );
  q("[data-bk]").forEach((b) => (b.onclick = () => (c.open.has(b.dataset.bk!) ? c.open.delete(b.dataset.bk!) : c.open.add(b.dataset.bk!), draw())));
  q("[data-rs]").forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.rs!;
        if (!confirm("Restore this backup? Your current save is kept as a backup too.")) return;
        const ok = await SV.restore(id, +b.dataset.k!);
        toast(ok ? "🛟 Backup restored" : "⚠️ That backup is damaged", ok ? "ok" : "bad");
        if (ok && id === "game" && o.ctx === "hub") setTimeout(() => location.reload(), 600);
        else draw();
      }),
  );
  q("[data-del]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.del!;
        if (!confirm(`Delete ${SV.meta(id)?.name || "this save"}? Its backups go too. Export it first if you might want it back.`)) return;
        SV.remove(id);
        draw();
      }),
  );
  q("[data-imp]").forEach((b) => (b.onclick = () => pickFile(+b.dataset.imp!)));
  (c.el.querySelector("#svea") as HTMLElement).onclick = async () => {
    const t = await SV.exportAll();
    await download(`hoops2k27-saves-${new Date().toISOString().slice(0, 10)}.json`, t);
  };
  (c.el.querySelector("#svim") as HTMLInputElement).onchange = (e: any) => {
    const f = e.target.files && e.target.files[0];
    if (f) importFile(f);
  };
  const x = c.el.querySelector("#svx") as HTMLElement | null;
  if (x) x.onclick = close;
  const sy = c.el.querySelector("#svsy") as HTMLElement | null;
  if (sy) sy.onclick = () => SV.cloudSync().then(() => refresh());
  const cf = c.el.querySelector("#svcfb") as HTMLElement | null;
  if (cf) cf.onclick = conflicts;
}
function go(slot: number, d: any | null) {
  const o = cur!.o;
  if (!o.host) close();
  o.onPlay?.(slot, d);
}
function pickFile(slot?: number) {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = ".json,application/json";
  i.onchange = () => i.files && i.files[0] && importFile(i.files[0], slot);
  i.click();
}
async function importFile(f: File, slot?: number) {
  const r = await SV.importText(await f.text(), { slot });
  toast(r.ok ? `⬆ Imported ${r.ok} save${r.ok > 1 ? "s" : ""}${r.bad ? ` (${r.bad} damaged, skipped)` : ""}` : "⚠️ That file isn't a Hoops 2K27 save (or it is damaged).", r.ok ? "ok" : "bad");
  refresh();
  if (r.ids.includes("game") && cur && cur.o.ctx === "hub") setTimeout(() => location.reload(), 900);
}
/** Cloud conflict prompt: both copies changed since the last sync. The newer one is the default. */
function conflicts() {
  const c = SV.CLOUD.conflicts[0];
  if (!c || document.querySelector(".svcf")) return;
  const L = c.local,
    C = c.cloud.m,
    newer = L.t >= c.cloud.t ? "local" : "cloud";
  const col = (m: SV.Meta, k: string, label: string, t: number) =>
    `<div class="${newer === k ? "new" : ""}"><b class="disp">${label}${newer === k ? ' <span class="chip">NEWER</span>' : ""}</b><span>${esc(m.name)} · ${esc(m.sub || "")}</span><span>Day ${m.day ?? "-"} · ${esc(m.rec || "")} · ${fmtMoney(m.money)}</span><span class="muted">Saved ${esc(SV.when(t))}</span><button type="button" class="btn${newer === k ? " pri" : ""}" data-pick="${k}">Keep ${label.toLowerCase()}</button></div>`;
  const d = document.createElement("div");
  d.className = "svcf kit";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.innerHTML = `<div class="panel"><span class="eyebrow">Cloud save conflict · ${esc(c.id === "game" ? "Game data" : "LIFE slot " + (+c.id.slice(4) + 1))}</span><h2 class="disp" style="margin:6px 0 0">Two different versions</h2><p class="muted">This save changed here and on another device since the last sync. Pick the one to keep - the other stays in Backups.</p><div class="two">${col(L, "local", "This device", L.t)}${col(C, "cloud", "Cloud", c.cloud.t)}</div></div>`;
  document.body.appendChild(d);
  d.querySelectorAll<HTMLElement>("[data-pick]").forEach(
    (b) =>
      (b.onclick = async () => {
        d.remove();
        await SV.resolve(c.id, b.dataset.pick as any);
        toast("☁ Kept " + (b.dataset.pick === "local" ? "this device's" : "the cloud") + " version", "ok");
        refresh();
        if (SV.CLOUD.conflicts.length) conflicts();
        else if (c.id === "game" && b.dataset.pick === "cloud" && cur?.o.ctx === "hub") setTimeout(() => location.reload(), 600);
      }),
  );
  setTimeout(() => d.querySelector<HTMLElement>(".btn.pri")?.focus(), 30);
}
