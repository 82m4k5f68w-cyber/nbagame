// Deterministic personal look of a player (hair style + colour, facial hair, eyes, accessories, sneakers, team trim),
// derived from his name hash + roster data + SIG overrides (p.sg.hs / p.sg.face). Shared by the 3D rig (rig3d.ts),
// the 2D views (canvas.ts) and the menu portraits (game.ts avatar) so a player looks the same everywhere.
// Unity mirrors this file in Game/Rig.cs (Look). Stylised: no real photos or likenesses are used.

export interface Look {
  h: number; // name hash (rig3d's original: h = h*31 + code point, uint32)
  hc: string; // hair colour
  hair: number; // 0 bald, 1 buzz, 2 fade, 3 waves, 4 crew/part, 5 high-top, 6 curly top, 7 swept (hr 2), 8 locks (hr 2, hs 1), 9 afro, 10 cornrows (hs 5 only)
  beard: number; // 0 none, 1 full, 2 goatee, 3 chin strap, 4 stubble, 5 mustache + goatee
  eye: string; // iris colour
  sec: string; // team secondary (trim, piping, stripes)
  trim: string; // contrast colour for numbers' fill
  shoe: string[]; // upper, accent, midsole, outsole, laces
  shoeCut: number; // 0 low, 1 mid, 2 high
  sock: string;
  sockH: number; // sock top height above the ankle (shin units)
  sleeve: number; // arm sleeve: 0 none, 1 left, 2 right, 3 both
  sleeveC: string;
  wrist: number; // wristbands: 0 none, 1 left, 2 right, 3 both
  wristC: string;
  knee: number; // knee sleeves bitmask (1 left, 2 right)
  kneeC: string;
  tights: number; // 0 none, 1 compression shorts to above the knee, 2 three-quarter tights
  tightsC: string;
  band: boolean; // headband
  bandC: string;
  tape: number; // finger tape bitmask: bit0 right index, bit1 right ring, bit2 left index
}

/** Team primary -> secondary (trim) colour; flat string so no array-literal tables in the bundle. */
const SEC = "7b3fb5:fdb927,1d428a:ffc72c,0e2240:fec524,007ac1:ef3b24,6b7078:111111,236192:78be20,006bb6:f58426,007a33:ffffff,00471b:eee1c6,00538c:b8c4ca,860038:fdbb30,ce1141:c4ced4,c8102e:1d42ba,0077c0:c4ced4";
let SECM: Map<string, string> | null = null;
export function secondary(col: string): string {
  if (!SECM) {
    SECM = new Map();
    for (const e of SEC.split(",")) SECM.set(e.slice(0, 6), "#" + e.slice(7));
  }
  const s = SECM.get(String(col || "").replace("#", "").toLowerCase());
  return s || (lum(col) < 0.45 ? "#f2f2f2" : "#16161c");
}
export function lum(hex: string) {
  const n = parseInt(String(hex || "#888").slice(1, 7), 16);
  return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
}
/** Shoe colourways: upper accent midsole outsole laces ("T" = team colour, "S" = team secondary). */
const SHOES = "#f6f6f6 T #f4f4f4 #d8d8d8 #f8f8f8|#141414 #f4f4f4 #f4f4f4 #1a1a1a #141414|T #f6f6f6 #f4f4f4 #f0f0f0 #f6f6f6|#f6f6f6 S #f4f4f4 #8a5a32 #f6f6f6|#141414 T #141414 #141414 #141414|#f6f6f6 #e8541e #f4f4f4 #e8541e #f6f6f6|S T #f6f6f6 #e6e6e6 #f6f6f6|#d9e021 #141414 #f4f4f4 #141414 #141414|#f6f6f6 #141414 #f4f4f4 #8a5a32 #141414|#c4ced4 T #f4f4f4 #3a3a3a #f6f6f6";
const HAIRL = "#3d2a18 #2a1c10 #5a3a1e #8a6a3c #1c1410 #4a2e1a";
const HAIRD = "#121212 #1a1410 #0e0e0e #161210";
const EYEL = "#3b2414 #4a6a8a #5a6a3a #2a1a10 #6a4a2a";

export function lookOf(p: { n: string; skin: string; hr: number; bd: number; col: string; sg?: any }): Look {
  let h = 0;
  for (const ch of String(p.n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // a second, well-mixed stream for the style picks (the raw name hash is poorly distributed in its low bits)
  let s = (h ^ 0x85ebca6b) >>> 0;
  const r = () => ((s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0), ((s ^= s >>> 16) >>> 0) % 1000) / 1000;
  const light = p.skin === "#e8b88f",
    hl = (light ? HAIRL : HAIRD).split(" "),
    hc = hl[Math.floor(r() * hl.length)],
    hs = p.sg && p.sg.hs;
  let hair = 0;
  const u = r();
  if (p.hr === 1) {
    if (hs === 5) hair = 10;
    else if (hs === 0) hair = 2;
    else if (hs === 1) hair = 3;
    else if (hs === 2) hair = 4;
    else {
      hair = light ? (u < 0.45 ? 4 : u < 0.7 ? 2 : u < 0.85 ? 1 : 6) : u < 0.3 ? 2 : u < 0.5 ? 3 : u < 0.68 ? 1 : u < 0.82 ? 5 : u < 0.94 ? 6 : 4;
    }
  } else if (p.hr === 2) hair = hs === 1 ? 8 : 7;
  else if (p.hr === 3) hair = 9;
  let beard = 0;
  const bu = r();
  if (p.bd) beard = bu < 0.4 ? 1 : bu < 0.6 ? 2 : bu < 0.75 ? 3 : bu < 0.9 ? 5 : 4;
  else if (bu < 0.22) beard = 4; // clean-shaven players: some stubble
  const el = light ? EYEL.split(" ") : ["#2a1a10", "#3b2414", "#1e140c"],
    eye = el[Math.floor(r() * el.length)];
  const sec = secondary(p.col),
    trim = lum(p.col) < 0.5 ? "#ffffff" : "#16161c",
    sw = SHOES.split("|"),
    shoe = sw[h % sw.length].split(" ").map((c) => (c === "T" ? p.col : c === "S" ? sec : c));
  const pick = (a: string) => {
    const l = a.split(" ");
    return l[Math.floor(r() * l.length)].replace("T", p.col).replace("S", sec);
  };
  const cu = r(),
    shoeCut = cu < 0.35 ? 0 : cu < 0.7 ? 1 : 2,
    sock = pick("#f4f4f4 #f4f4f4 #141414 T"),
    sockH = 0.14 + Math.floor(r() * 3) * 0.18,
    acc = "#141414 #f2f2f2 T",
    sleeve = r() < 0.22 ? 1 + Math.floor(r() * 3) : 0,
    sleeveC = pick(acc),
    wrist = r() < 0.3 ? 1 + Math.floor(r() * 3) : 0,
    wristC = pick(acc + " S"),
    knee = r() < 0.18 ? 1 + Math.floor(r() * 3) : 0,
    kneeC = pick("#141414 #f2f2f2"),
    tu = r(),
    tights = tu < 0.14 ? 1 : tu < 0.22 ? 2 : 0,
    tightsC = pick("#141414 #f2f2f2 T"),
    band = h % 7 === 0 || r() < 0.06,
    bandC = pick(acc + " S"),
    tape = r() < 0.25 ? 1 + Math.floor(r() * 7) : 0;
  return { h, hc, hair, beard, eye, sec, trim, shoe, shoeCut, sock, sockH, sleeve, sleeveC, wrist, wristC, knee, kneeC, tights, tightsC, band, bandC, tape };
}

/** Per-player face proportions from the name hash (same stream and order as rig3d's original F), SIG `face` wins. */
export function faceOf(h: number, sg?: any) {
  let fh = (h ^ 0x9e3779b9) >>> 0;
  const fr = () => ((fh = Math.imul(fh ^ (fh >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const F = {
    w: 0.92 + fr() * 0.16, // skull width
    jw: 0.9 + fr() * 0.25, // jaw width
    jl: 0.9 + fr() * 0.25, // jaw length
    nw: 0.85 + fr() * 0.45, // nose width
    nl: 0.85 + fr() * 0.35, // nose length
    eg: 0.12 + fr() * 0.03, // eye spacing
    br: 0.03 + fr() * 0.03, // brow thickness
    ba: (fr() - 0.5) * 0.25, // brow angle
    ea: 0.85 + fr() * 0.35, // ear size
    lp: 0.8 + fr() * 0.5, // lip fullness
    es: 0.9 + fr() * 0.2, // eye size
    nb: fr(), // nose bridge height (0 flat .. 1 high)
    ck: fr(), // cheekbone prominence
    ch: 0.85 + fr() * 0.3, // chin size
    fh: fr(), // forehead height
    ...((sg && sg.face) || {}),
  };
  return F;
}
