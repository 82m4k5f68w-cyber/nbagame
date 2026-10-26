// Menu navigation (UI v6) for keyboard and gamepad: arrows / d-pad / left stick move focus spatially between the
// controls of the top layer (a trapped dialog such as the settings drawer, else the shell's base layer: hub or the
// game overlay), Enter / Space / A activate, Esc / B go back, shoulder buttons go to the shell (team cycling).
// Only active while a menu is up: in play the keys belong to the game (input.ts).
type Base = {
  /** menus are on screen (not playing) */
  active: () => boolean;
  /** the element whose controls arrows move between */
  root: () => HTMLElement | null;
  back?: () => void;
  /** Esc with no dialog open (the hub; the game handles Esc itself) */
  esc?: () => void;
  /** Enter / A with nothing focused */
  primary?: () => void;
  /** gamepad extras: lb rb lt rt start select */
  pad?: (b: string) => void;
};
let BASE: Base | null = null;
/** hold = 1 while another handler owns the keyboard (key remapping waits for any key). */
export const NAV = { hold: 0 };
const TRAPS: { el: HTMLElement; back: () => void }[] = [];
export const setNavBase = (b: Base) => {
  BASE = b;
  init();
};
/** Confine navigation to el (a dialog) until the returned function is called; Esc / B call back. */
export function trapNav(el: HTMLElement, back: () => void) {
  const t = { el, back };
  TRAPS.push(t);
  init();
  return () => {
    const i = TRAPS.indexOf(t);
    if (i >= 0) TRAPS.splice(i, 1);
  };
}
const top = () => {
  for (let i = TRAPS.length - 1; i >= 0; i--) if (TRAPS[i].el.isConnected && !TRAPS[i].el.hidden) return TRAPS[i];
  return null;
};
const on = () => !!top() || !!(BASE && BASE.active());
const layer = () => (top() ? top()!.el : BASE ? BASE.root() : null);
const SEL = 'button, a[href], input:not([type="hidden"]):not([type="file"]), select, summary, [tabindex="0"]';
export function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(SEL)].filter((e) => {
    if ((e as any).disabled || e.closest("[hidden]") || e.getAttribute("aria-hidden") === "true") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
  });
}
/** Move focus to the nearest control in the direction (distance along it + 2x the sideways offset). */
export function nav(dx: number, dy: number) {
  const root = layer();
  if (!root) return;
  const list = focusables(root);
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement;
  if (!cur || !list.includes(cur)) {
    const f = root.querySelector<HTMLElement>("[data-autofocus]") || list[0];
    return f.focus();
  }
  const a = cur.getBoundingClientRect(),
    ax = a.left + a.width / 2,
    ay = a.top + a.height / 2;
  let best: HTMLElement | null = null,
    bs = 1e9;
  for (const e of list) {
    if (e === cur) continue;
    const r = e.getBoundingClientRect(),
      x = r.left + r.width / 2,
      y = r.top + r.height / 2,
      along = (x - ax) * dx + (y - ay) * dy,
      side = Math.abs((x - ax) * dy) + Math.abs((y - ay) * dx),
      ahead = dx ? (dx > 0 ? r.left >= a.right - 4 : r.right <= a.left + 4) : dy > 0 ? r.top >= a.bottom - 4 : r.bottom <= a.top + 4;
    if (!ahead || along <= 0) continue;
    const s = along + side * 2;
    if (s < bs) (bs = s), (best = e);
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
function back() {
  const t = top();
  if (t) return t.back();
  BASE?.back?.();
}
const typing = (t: any) => t && t.closest && t.closest('input:not([type="range"]):not([type="file"]),select,textarea');
const ctl = (t: any) => t && t.closest && t.closest(SEL + ",label");
function key(e: KeyboardEvent) {
  if (NAV.hold || !on()) return;
  const t = e.target as HTMLElement;
  if (typing(t) && e.key !== "Escape") return;
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = dirs[e.key];
  if (d) {
    if ((t as any)?.type === "range" && d[0]) return;
    if (t?.getAttribute?.("role") === "tab" && d[0]) return; // the tab list switches tabs itself
    e.preventDefault();
    e.stopImmediatePropagation();
    nav(d[0], d[1]);
    return;
  }
  if (e.key === "Escape") {
    if (top()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return back();
    }
    return BASE?.esc?.(); // (the game shell handles its own Esc: pause / resume)
  }
  if ((e.key === "Enter" || e.key === " ") && ctl(t) && t !== document.body) {
    // a focused control: let the browser activate it, keep the game's input layer out of it
    e.stopImmediatePropagation();
    if (t.tagName === "LABEL" || t.getAttribute("role") === "link") (e.preventDefault(), t.click());
    return;
  }
  if (e.key === "Enter" && BASE?.primary && (!ctl(t) || t === document.body) && !top()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    BASE.primary();
  }
}
// ---- gamepad (menus only; in play input.ts gpPoll owns the pad; getGamepads can throw in sandboxed iframes) ----
const held: Record<string, boolean> = {};
let rep = 0,
  repOn = false,
  padX = 0;
function padTick(t: number) {
  requestAnimationFrame(padTick);
  if (padX || document.hidden || !on()) return;
  let g: Gamepad | null = null;
  try {
    for (const p of navigator.getGamepads ? navigator.getGamepads() : [])
      if (p && p.connected !== false) {
        g = p;
        break;
      }
  } catch (e) {
    padX = 1;
    return;
  }
  if (!g) return;
  const b = (k: number) => !!(g!.buttons[k] && (g!.buttons[k].pressed || g!.buttons[k].value > 0.5)),
    ax = g.axes[0] || 0,
    ay = g.axes[1] || 0,
    dir = b(14) || ax < -0.6 ? "L" : b(15) || ax > 0.6 ? "R" : b(12) || ay < -0.6 ? "U" : b(13) || ay > 0.6 ? "D" : "",
    press = (k: string, v: boolean) => {
      const was = held[k];
      held[k] = v;
      return v && !was;
    };
  if (dir) {
    if (press("d" + dir, true) || t > rep) {
      rep = t + (repOn ? 120 : 380);
      repOn = true;
      nav(dir === "L" ? -1 : dir === "R" ? 1 : 0, dir === "U" ? -1 : dir === "D" ? 1 : 0);
    }
  } else {
    repOn = false;
    for (const d of "LRUD") held["d" + d] = false;
  }
  if (press("a", b(0))) {
    const f = document.activeElement as HTMLElement;
    if (f && f !== document.body && layer()?.contains(f)) f.click();
    else BASE?.primary?.();
  }
  if (press("b", b(1))) back();
  const ex: [string, number][] = [
    ["lb", 4],
    ["rb", 5],
    ["lt", 6],
    ["rt", 7],
    ["select", 8],
    ["start", 9],
  ];
  for (const [n, i] of ex) if (press(n, b(i)) && !top()) BASE?.pad?.(n);
}
let inited = 0;
function init() {
  if (inited) return;
  inited = 1;
  addEventListener("keydown", key, true);
  requestAnimationFrame(padTick);
}
