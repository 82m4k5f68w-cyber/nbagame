// Procedural art for the menus (UI v6): mode-card illustrations drawn on a canvas (no image files) and team logo
// marks as inline SVG. Fictional-safe: generic shapes + the team's colour and a 3-letter monogram, no real logos.
const CACHE = new Map<string, string>();
export const hexRgb = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  const n = m ? parseInt(m[1], 16) : 0x2a2f6a;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** k < 1 darker, k > 1 lighter (towards white). */
export const shade = (h: string, k: number) => {
  const [r, g, b] = hexRgb(h),
    f = (v: number) => Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
export const lum = (h: string) => {
  const [r, g, b] = hexRgb(h);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
export const abbr = (n: string) => n.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
/** Team mark: a shield in the team colour with a diagonal sash, ball seams and the monogram. */
export function teamMark(name: string, col: string, size = 56, cls = "tmk") {
  const id = "g" + abbr(name) + hexRgb(col).join(""),
    hi = shade(col, 1.35),
    lo = shade(col, 0.45),
    ink = lum(col) > 0.62 ? "#10142a" : "#fff";
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>
<path d="M32 2 58 11v20c0 15-11 25-26 31C17 56 6 46 6 31V11z" fill="url(#${id})" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
<path d="M6 40 58 18v9L8 49z" fill="rgba(255,255,255,.16)"/>
<g fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.6"><circle cx="32" cy="31" r="19"/><path d="M13 31h38M32 12v38M19 17c7 8 7 20 0 28M45 17c-7 8-7 20 0 28"/></g>
<text x="32" y="38" text-anchor="middle" font-family="'H2K Display',Impact,sans-serif" font-weight="700" font-size="19" letter-spacing=".5" fill="${ink}" stroke="${lo}" stroke-width=".6">${abbr(name)}</text></svg>`;
}
function ball(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#ffb070");
  g.addColorStop(0.6, "#e8661e");
  g.addColorStop(1, "#8a3108");
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, r, 0, 7);
  x.fill();
  x.strokeStyle = "rgba(30,10,0,.75)";
  x.lineWidth = Math.max(1, r * 0.07);
  x.beginPath();
  x.moveTo(cx - r, cy);
  x.lineTo(cx + r, cy);
  x.moveTo(cx, cy - r);
  x.lineTo(cx, cy + r);
  x.stroke();
  x.beginPath();
  x.arc(cx - r * 1.25, cy, r * 0.95, -0.75, 0.75);
  x.stroke();
  x.beginPath();
  x.arc(cx + r * 1.25, cy, r * 0.95, Math.PI - 0.75, Math.PI + 0.75);
  x.stroke();
}
/** Hardwood floor in perspective from the horizon hz down, with court lines. */
function floor(x: CanvasRenderingContext2D, w: number, h: number, hz: number, tint: string) {
  const g = x.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, "rgba(120,70,30,.0)");
  g.addColorStop(0.25, "rgba(176,110,52,.55)");
  g.addColorStop(1, "rgba(214,150,80,.85)");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(w * 0.3, hz);
  x.lineTo(w * 0.7, hz);
  x.lineTo(w * 1.4, h);
  x.lineTo(-w * 0.4, h);
  x.closePath();
  x.fill();
  x.save();
  x.clip();
  x.strokeStyle = "rgba(90,50,20,.18)";
  x.lineWidth = 1;
  for (let i = -24; i <= 24; i++) {
    x.beginPath();
    x.moveTo(w / 2 + i * w * 0.012, hz);
    x.lineTo(w / 2 + i * w * 0.07, h);
    x.stroke();
  }
  x.strokeStyle = "rgba(255,255,255,.75)";
  x.lineWidth = 2;
  const py = (t: number) => hz + (h - hz) * t * t,
    px = (u: number, t: number) => w / 2 + u * (w * 0.2 + w * 0.9 * t * t);
  // half-court line + centre circle
  x.beginPath();
  x.moveTo(px(-1, 0.72), py(0.72));
  x.lineTo(px(1, 0.72), py(0.72));
  x.stroke();
  x.beginPath();
  x.ellipse(w / 2, py(0.72), w * 0.09, (h - hz) * 0.06, 0, 0, 7);
  x.fillStyle = tint;
  x.globalAlpha = 0.45;
  x.fill();
  x.globalAlpha = 1;
  x.stroke();
  // far key + arc
  x.beginPath();
  x.rect(w / 2 - w * 0.045, py(0.08), w * 0.09, py(0.3) - py(0.08));
  x.stroke();
  x.beginPath();
  x.ellipse(w / 2, py(0.1), w * 0.21, (h - hz) * 0.12, 0, 0, Math.PI);
  x.stroke();
  x.restore();
}
function hoop(x: CanvasRenderingContext2D, cx: number, by: number, s: number) {
  x.fillStyle = "rgba(255,255,255,.18)";
  x.strokeStyle = "rgba(255,255,255,.85)";
  x.lineWidth = 2;
  x.beginPath();
  x.rect(cx - s, by - s * 0.7, s * 2, s * 1.2);
  x.fill();
  x.stroke();
  x.strokeRect(cx - s * 0.32, by - s * 0.15, s * 0.64, s * 0.5);
  x.strokeStyle = "#ff6a1f";
  x.lineWidth = 3;
  x.beginPath();
  x.ellipse(cx, by + s * 0.55, s * 0.42, s * 0.1, 0, 0, 7);
  x.stroke();
  x.strokeStyle = "rgba(255,255,255,.6)";
  x.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    x.beginPath();
    x.moveTo(cx + i * s * 0.12, by + s * 0.58);
    x.lineTo(cx + i * s * 0.07, by + s * 1.15);
    x.stroke();
  }
}
function player(x: CanvasRenderingContext2D, cx: number, fy: number, s: number, col: string, lean = 0) {
  x.save();
  x.translate(cx, fy);
  x.rotate(lean);
  x.fillStyle = "rgba(0,0,0,.35)";
  x.beginPath();
  x.ellipse(0, 0, s * 0.45, s * 0.1, 0, 0, 7);
  x.fill();
  x.fillStyle = col;
  x.strokeStyle = "rgba(255,255,255,.7)";
  x.lineWidth = 1.5;
  // legs, torso, head (a simple broadcast silhouette)
  x.beginPath();
  x.moveTo(-s * 0.18, 0);
  x.lineTo(-s * 0.1, -s * 0.9);
  x.lineTo(s * 0.1, -s * 0.9);
  x.lineTo(s * 0.2, 0);
  x.lineTo(s * 0.06, 0);
  x.lineTo(0, -s * 0.55);
  x.lineTo(-s * 0.05, 0);
  x.closePath();
  x.fill();
  x.beginPath();
  x.roundRect(-s * 0.22, -s * 1.55, s * 0.44, s * 0.7, s * 0.12);
  x.fill();
  x.stroke();
  x.beginPath();
  x.arc(0, -s * 1.75, s * 0.17, 0, 7);
  x.fillStyle = "#3b2a20";
  x.fill();
  x.restore();
}
/** Mode illustration (cached data URL). kinds: arena duel life my online local classic. */
export function modeArt(kind: string, c1: string, c2 = "#ff6a1f", w = 720, h = 360): string {
  const key = kind + c1 + c2 + w + "x" + h;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const x = cv.getContext("2d");
  if (!x) return "";
  // sky: team colour into ink, arena light beams
  const bg = x.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, shade(c1, 0.9));
  bg.addColorStop(0.55, shade(c1, 0.32));
  bg.addColorStop(1, "#06070e");
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const bx = w * (0.15 + i * 0.24),
      g = x.createLinearGradient(bx, 0, bx, h * 0.8);
    g.addColorStop(0, "rgba(255,240,210,.16)");
    g.addColorStop(1, "rgba(255,240,210,0)");
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(bx - 8, 0);
    x.lineTo(bx + 8, 0);
    x.lineTo(bx + 60, h * 0.8);
    x.lineTo(bx - 60, h * 0.8);
    x.fill();
  }
  x.globalCompositeOperation = "source-over";
  const hz = h * 0.42;
  if (kind === "life") {
    // skyline at dusk over an outdoor court
    const sky = x.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, "rgba(255,120,60,.0)");
    sky.addColorStop(1, "rgba(255,150,60,.35)");
    x.fillStyle = sky;
    x.fillRect(0, 0, w, hz);
    let bx = 0,
      s = 7;
    while (bx < w) {
      s = (s * 9301 + 49297) % 233280;
      const bw = 30 + (s % 50),
        bh = 40 + ((s >> 3) % 110);
      x.fillStyle = "rgba(8,10,24,.85)";
      x.fillRect(bx, hz - bh, bw - 4, bh);
      x.fillStyle = "rgba(255,210,120,.55)";
      for (let wy = hz - bh + 8; wy < hz - 8; wy += 12) for (let wx = bx + 5; wx < bx + bw - 10; wx += 10) if (((wx * 7 + wy * 3) | 0) % 5 < 2) x.fillRect(wx, wy, 4, 5);
      bx += bw;
    }
  }
  if (kind === "online") {
    x.strokeStyle = "rgba(120,220,255,.35)";
    x.lineWidth = 1.2;
    const gx = w * 0.72,
      gy = h * 0.38,
      R = h * 0.34;
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.ellipse(gx, gy, R * Math.cos((i * Math.PI) / 12), R, 0, 0, 7);
      x.stroke();
      x.beginPath();
      x.ellipse(gx, gy - R + (i * 2 * R) / 6 + R / 6, R * Math.sin(Math.acos(Math.min(1, Math.abs(-R + (i * 2 * R) / 6 + R / 6) / R))), R * 0.12, 0, 0, 7);
      x.stroke();
    }
    x.strokeStyle = "rgba(255,200,60,.85)";
    x.setLineDash([5, 6]);
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(w * 0.12, h * 0.75);
    x.quadraticCurveTo(w * 0.35, h * 0.05, gx - R * 0.4, gy - R * 0.2);
    x.stroke();
    x.setLineDash([]);
  }
  if (kind === "my") {
    // attribute radar
    const cx = w * 0.74,
      cy = h * 0.42,
      R = h * 0.3,
      v = [0.9, 0.7, 0.85, 0.6, 0.78];
    x.strokeStyle = "rgba(255,255,255,.25)";
    x.lineWidth = 1;
    for (let r = 1; r <= 3; r++) {
      x.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        x.lineTo(cx + Math.cos(a) * R * (r / 3), cy + Math.sin(a) * R * (r / 3));
      }
      x.stroke();
    }
    x.fillStyle = "rgba(255,200,61,.35)";
    x.strokeStyle = "#ffc83d";
    x.lineWidth = 2.5;
    x.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      x.lineTo(cx + Math.cos(a) * R * v[i % 5], cy + Math.sin(a) * R * v[i % 5]);
    }
    x.fill();
    x.stroke();
  }
  if (kind === "classic") {
    // side view: floor line, hoop, pixel ball, scanlines
    x.fillStyle = "rgba(214,150,80,.8)";
    x.fillRect(0, h * 0.8, w, h * 0.2);
    x.fillStyle = "#fff";
    x.fillRect(w * 0.82, h * 0.18, 6, h * 0.62);
    x.fillRect(w * 0.78, h * 0.18, 6, h * 0.22);
    x.fillStyle = "#ff6a1f";
    x.fillRect(w * 0.7, h * 0.32, w * 0.08, 5);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = `rgba(255,140,40,${0.25 + i * 0.12})`;
      x.fillRect(w * (0.2 + i * 0.08), h * (0.55 - Math.sin(i / 5 * 2.6) * 0.32), 12, 12);
    }
    x.fillStyle = "rgba(0,0,0,.18)";
    for (let y = 0; y < h; y += 4) x.fillRect(0, y, w, 2);
  } else floor(x, w, h, hz, shade(c1, 1.1));
  if (kind === "arena" || kind === "local") {
    hoop(x, w / 2, hz - h * 0.2, h * 0.09);
    const pos = [
      [-0.3, 0.55],
      [0.1, 0.6],
      [0.32, 0.7],
      [-0.12, 0.78],
      [0.2, 0.88],
    ];
    pos.forEach(([u, t], i) => {
      const yy = hz + (h - hz) * t * t;
      player(x, w / 2 + u * w * (0.3 + t * 0.6) - 18, yy, h * 0.1 * (0.55 + t), i % 2 ? shade(c1, 1.3) : kind === "local" ? "#0f8a5f" : shade(c2, 1));
    });
    ball(x, w * 0.56, hz - h * 0.04, h * 0.035);
  }
  if (kind === "duel") {
    hoop(x, w * 0.5, hz - h * 0.2, h * 0.09);
    player(x, w * 0.4, h * 0.92, h * 0.2, shade(c1, 1.4), 0.08);
    player(x, w * 0.6, h * 0.86, h * 0.19, shade(c2, 1), -0.06);
    x.strokeStyle = "rgba(255,255,255,.7)";
    x.setLineDash([4, 6]);
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(w * 0.42, h * 0.5);
    x.quadraticCurveTo(w * 0.47, -h * 0.05, w * 0.5, hz - h * 0.08);
    x.stroke();
    x.setLineDash([]);
    ball(x, w * 0.45, h * 0.24, h * 0.04);
  }
  if (kind === "life" || kind === "my" || kind === "online") {
    player(x, w * 0.3, h * 0.92, h * 0.22, shade(c2, 1));
    ball(x, w * 0.37, h * 0.83, h * 0.035);
  }
  // vignette
  const v = x.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,.55)");
  x.fillStyle = v;
  x.fillRect(0, 0, w, h);
  let u = "";
  try {
    u = cv.toDataURL("image/webp", 0.82);
    if (!u.startsWith("data:image/webp")) u = cv.toDataURL();
  } catch (e) {}
  CACHE.set(key, u);
  return u;
}
/** Brand mark: a ball in a ring (hub header). */
export const brandMark = (s = 34) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 40 40" aria-hidden="true"><defs><radialGradient id="bm" cx=".35" cy=".3"><stop offset="0" stop-color="#ffb070"/><stop offset=".6" stop-color="#ff6a1f"/><stop offset="1" stop-color="#8a3108"/></radialGradient></defs><circle cx="20" cy="20" r="17" fill="url(#bm)"/><g fill="none" stroke="#2a0e00" stroke-width="1.6" opacity=".8"><path d="M3 20h34M20 3v34"/><path d="M8 8c6 6 6 18 0 24M32 8c-6 6-6 18 0 24"/></g><circle cx="20" cy="20" r="19" fill="none" stroke="#ffc83d" stroke-width="1.5" opacity=".7"/></svg>`;
