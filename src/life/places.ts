// LIFE town layout (world units = feet; x east, z south). DOM-free: the 3D world, the minimap, the Map app (fast
// travel) and the tests all read it. Roads: Main St (z = 0), Market St (z = 168), Campus Ave (x = 0).
export type PK = "home" | "school" | "arena" | "gym" | "food" | "shop" | "court" | "campus" | "dorm" | "house" | "service";
export interface Place {
  id: string;
  n: string; // display name (fictional brands only)
  k: PK;
  x: number; // footprint centre
  z: number;
  w: number; // size along x
  d: number; // size along z
  h: number;
  col: string;
  door: "n" | "s" | "e" | "w";
  ic: string; // map icon
  sign?: string; // sign colour
  oval?: number; // arena: elliptical footprint
  deco?: number; // decoration only (no door)
  open?: [number, number]; // opening hours (minutes); default always
}
export const ROADS: { x0: number; z0: number; x1: number; z1: number; n: string }[] = [
  { x0: -330, z0: -18, x1: 330, z1: 18, n: "Main St" },
  { x0: -330, z0: 150, x1: 330, z1: 186, n: "Market St" },
  { x0: -18, z0: -330, x1: 18, z1: 330, n: "Campus Ave" },
];
export const WORLD = 340; // half-size of the walkable area
export const PLACES: Place[] = [
  // ---- campus (north-west): halls around the quad (centre -150, -150)
  { id: "hale", n: "Hale Hall", k: "campus", x: -205, z: -230, w: 80, d: 44, h: 38, col: "#9a5b3c", door: "s", ic: "📐", sign: "#f2e6d0" },
  { id: "wren", n: "Wren Hall", k: "campus", x: -95, z: -230, w: 80, d: 44, h: 38, col: "#8c6046", door: "s", ic: "📖", sign: "#f2e6d0" },
  { id: "lab", n: "Science Center", k: "campus", x: -262, z: -140, w: 46, d: 70, h: 44, col: "#c9ccd3", door: "e", ic: "🔬", sign: "#1f6fd1" },
  { id: "library", n: "Ashford Library", k: "campus", x: -40, z: -140, w: 40, d: 70, h: 40, col: "#b58b5a", door: "w", ic: "📚", sign: "#f2e6d0" },
  { id: "dining", n: "Commons Dining", k: "campus", x: -205, z: -55, w: 70, d: 40, h: 26, col: "#a7745a", door: "s", ic: "🍽️", sign: "#ffd23f" },
  { id: "dorm", n: "Founders Dorm", k: "dorm", x: -95, z: -55, w: 70, d: 40, h: 46, col: "#c7b299", door: "s", ic: "🛏️", sign: "#ffffff" },
  // ---- arena district (north-east)
  { id: "arena", n: "Summit Arena", k: "arena", x: 165, z: -165, w: 150, d: 116, h: 48, col: "#d5d9e0", door: "s", ic: "🏟️", sign: "#e8541e", oval: 1 },
  { id: "gym", n: "Iron Temple Gym", k: "gym", x: 50, z: -52, w: 52, d: 40, h: 24, col: "#3b3f4a", door: "s", ic: "🏋️", sign: "#ff3b30", open: [5 * 60, 23 * 60] },
  // ---- downtown (south-east): Main St storefronts (doors north) + Market St
  { id: "burrito", n: "Burrito Barn", k: "food", x: 55, z: 52, w: 42, d: 38, h: 22, col: "#b5452b", door: "n", ic: "🌯", sign: "#ffcf3f", open: [10 * 60, 23 * 60] },
  { id: "pizza", n: "Slice Society", k: "food", x: 108, z: 52, w: 40, d: 38, h: 26, col: "#2f6b3a", door: "n", ic: "🍕", sign: "#ffffff", open: [11 * 60, 24 * 60] },
  { id: "cafe", n: "Morning Grind", k: "food", x: 160, z: 52, w: 40, d: 38, h: 30, col: "#6b4a35", door: "n", ic: "☕", sign: "#f5deb3", open: [6 * 60, 18 * 60] },
  { id: "green", n: "Green Leaf Kitchen", k: "food", x: 212, z: 52, w: 40, d: 38, h: 24, col: "#4f8a4b", door: "n", ic: "🥗", sign: "#ffffff", open: [8 * 60, 21 * 60] },
  { id: "threads", n: "Threads", k: "shop", x: 268, z: 52, w: 50, d: 38, h: 34, col: "#2b2d42", door: "n", ic: "👕", sign: "#ff7ab6", open: [9 * 60, 21 * 60] },
  { id: "mart", n: "Corner Mart", k: "shop", x: 55, z: 222, w: 42, d: 40, h: 20, col: "#d9b44a", door: "n", ic: "🏪", sign: "#ffffff" },
  { id: "barber", n: "Fade Factory", k: "service", x: 108, z: 222, w: 38, d: 40, h: 22, col: "#7d3c98", door: "n", ic: "💈", sign: "#ffffff", open: [9 * 60, 20 * 60] },
  { id: "tower", n: "Summit Tower", k: "house", x: 200, z: 240, w: 70, d: 70, h: 120, col: "#5d6d7e", door: "n", ic: "🏢", deco: 1 },
  { id: "tower2", n: "Harbor Point", k: "house", x: 290, z: 225, w: 50, d: 60, h: 90, col: "#34495e", door: "n", ic: "🏢", deco: 1 },
  // ---- neighbourhood (south-west): home, houses, Central High, The Cage
  { id: "home", n: "Home", k: "home", x: -60, z: 62, w: 38, d: 32, h: 20, col: "#e2d4b7", door: "n", ic: "🏠", sign: "#ffffff" },
  { id: "h1", n: "House", k: "house", x: -120, z: 62, w: 36, d: 32, h: 19, col: "#b9c9d6", door: "n", ic: "", deco: 1 },
  { id: "h2", n: "House", k: "house", x: -180, z: 62, w: 38, d: 32, h: 21, col: "#d6b9b9", door: "n", ic: "", deco: 1 },
  { id: "h3", n: "House", k: "house", x: -240, z: 62, w: 36, d: 32, h: 19, col: "#c9d6b9", door: "n", ic: "", deco: 1 },
  { id: "h4", n: "House", k: "house", x: -295, z: 62, w: 34, d: 32, h: 20, col: "#d9cfa0", door: "n", ic: "", deco: 1 },
  { id: "hs", n: "Central High", k: "school", x: -215, z: 245, w: 120, d: 56, h: 32, col: "#a33a2e", door: "n", ic: "🏫", sign: "#ffd23f" },
  { id: "court", n: "The Cage", k: "court", x: -75, z: 250, w: 54, d: 58, h: 0, col: "#3a4a5a", door: "n", ic: "🏀" },
];
export const placeById = (id: string) => PLACES.find((p) => p.id === id);
/** Door point (just outside the facade, on the walkable side) and the facing into the building. */
export function doorOf(p: Place): { x: number; z: number; f: number } {
  const o = 4;
  if (p.oval) return { x: p.x, z: p.z + p.d / 2 + o, f: -Math.PI / 2 };
  switch (p.door) {
    case "n":
      return { x: p.x, z: p.z - p.d / 2 - o, f: Math.PI / 2 };
    case "s":
      return { x: p.x, z: p.z + p.d / 2 + o, f: -Math.PI / 2 };
    case "e":
      return { x: p.x + p.w / 2 + o, z: p.z, f: Math.PI };
    default:
      return { x: p.x - p.w / 2 - o, z: p.z, f: 0 };
  }
}
/** Is (x, z) inside a building footprint (+ margin r)? Courts and decoration-less spots are walkable. */
export function blocked(x: number, z: number, r = 1.4): Place | null {
  if (Math.abs(x) > WORLD || Math.abs(z) > WORLD) return PLACES[0];
  for (const p of PLACES) {
    if (p.k === "court") continue;
    if (p.oval) {
      const dx = (x - p.x) / (p.w / 2 + r),
        dz = (z - p.z) / (p.d / 2 + r);
      if (dx * dx + dz * dz < 1) return p;
    } else if (Math.abs(x - p.x) < p.w / 2 + r && Math.abs(z - p.z) < p.d / 2 + r) return p;
  }
  return null;
}
/** Walking minutes between two places (fast travel cost; ~4.5 ft/s walking, roads add 30%). */
export function travelMin(a: { x: number; z: number }, b: { x: number; z: number }) {
  const d = (Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * 1.05;
  return Math.max(3, Math.round(d / 4.5 / 60 * 10 + 2));
}
/** Is a place open at minute-of-day m? */
export const isOpen = (p: Place, m: number) => !p.open || (m >= p.open[0] && m < p.open[1]);
/** The sleeping place for a stage (home in high school and the NBA, the dorm in college). */
export const bedOf = (stage: string) => (stage === "college" ? "dorm" : "home");
