// Pathfinding on the baked LIFE navmesh (src/life/navmesh.gen.ts, from recast-navigation at build time): triangle lookup
// on a coarse grid, A* over triangle adjacency (roads cost 2.5x, so walkers cross them, but at short crossings) and a
// funnel (string pulling) for the corner points. DOM-free, allocation-light, no wasm.
import { NAVMESH } from "./navmesh.gen";
import { ROADS } from "./places";

export type Pt = { x: number; z: number };
const b64 = (s: string) => {
  const bin = atob(s),
    u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};
export function makeNav(data = NAVMESH) {
  const vq = new Int16Array(b64(data.v)),
    tri = new Uint16Array(b64(data.t)),
    NV = vq.length / 2,
    NT = tri.length / 3,
    vx = new Float32Array(NV),
    vz = new Float32Array(NV);
  for (let i = 0; i < NV; i++) (vx[i] = vq[i * 2] / data.q), (vz[i] = vq[i * 2 + 1] / data.q);
  const cx = new Float32Array(NT),
    cz = new Float32Array(NT),
    cost = new Float32Array(NT),
    nb = new Int32Array(NT * 3).fill(-1); // neighbour across edge k (v[k] -> v[k+1])
  const onRoad = (x: number, z: number) => ROADS.some((r) => x > Math.min(r.x0, r.x1) && x < Math.max(r.x0, r.x1) && z > Math.min(r.z0, r.z1) && z < Math.max(r.z0, r.z1));
  const edges = new Map<number, number>();
  for (let t = 0; t < NT; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    cx[t] = (vx[a] + vx[b] + vx[c]) / 3;
    cz[t] = (vz[a] + vz[b] + vz[c]) / 3;
    cost[t] = onRoad(cx[t], cz[t]) ? 2.5 : 1;
    for (let k = 0; k < 3; k++) {
      const p = tri[t * 3 + k], q = tri[t * 3 + ((k + 1) % 3)],
        key = Math.min(p, q) * 65536 + Math.max(p, q),
        o = edges.get(key);
      if (o == null) edges.set(key, t * 3 + k);
      else (nb[t * 3 + k] = (o / 3) | 0), (nb[o] = t);
    }
  }
  // spatial grid of triangle bounding boxes for point lookup
  const CELL = 24,
    grid = new Map<number, number[]>();
  const gk = (gx: number, gz: number) => (gx + 512) * 1024 + (gz + 512);
  for (let t = 0; t < NT; t++) {
    const xs = [0, 1, 2].map((k) => vx[tri[t * 3 + k]]), zs = [0, 1, 2].map((k) => vz[tri[t * 3 + k]]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const k = gk(gx, gz);
        (grid.get(k) || grid.set(k, []).get(k)!).push(t);
      }
  }
  const cross = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  function inTri(t: number, x: number, z: number) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const d1 = cross(vx[a], vz[a], vx[b], vz[b], x, z), d2 = cross(vx[b], vz[b], vx[c], vz[c], x, z), d3 = cross(vx[c], vz[c], vx[a], vz[a], x, z);
    return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6));
  }
  /** Triangle containing p, or the one with the nearest centroid within r (snaps points just off the mesh). */
  function locate(x: number, z: number, r = 30): number {
    const c = grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (c) for (const t of c) if (inTri(t, x, z)) return t;
    let best = -1, bd = r * r;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
        for (const t of grid.get(gk(gx, gz)) || []) {
          const d = (cx[t] - x) ** 2 + (cz[t] - z) ** 2;
          if (d < bd) (bd = d), (best = t);
        }
    return best;
  }
  const g = new Float32Array(NT), f = new Float32Array(NT), from = new Int32Array(NT), mark = new Uint32Array(NT);
  let stamp = 0;
  /** Corner points from a to b (a excluded, b included); [] when unreachable. */
  function path(a: Pt, b: Pt): Pt[] {
    const s = locate(a.x, a.z), e = locate(b.x, b.z);
    if (s < 0 || e < 0) return [];
    if (s === e) return [{ x: b.x, z: b.z }];
    stamp++;
    const open: number[] = [s];
    g[s] = 0;
    f[s] = Math.hypot(cx[s] - b.x, cz[s] - b.z);
    from[s] = -1;
    mark[s] = stamp;
    const closed = new Set<number>();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const t = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (t === e) break;
      closed.add(t);
      for (let k = 0; k < 3; k++) {
        const n = nb[t * 3 + k];
        if (n < 0 || closed.has(n)) continue;
        const ng = g[t] + Math.hypot(cx[n] - cx[t], cz[n] - cz[t]) * (cost[t] + cost[n]) * 0.5;
        if (mark[n] !== stamp || ng < g[n]) {
          if (mark[n] !== stamp) open.push(n);
          mark[n] = stamp;
          g[n] = ng;
          f[n] = ng + Math.hypot(cx[n] - b.x, cz[n] - b.z);
          from[n] = t;
        }
      }
    }
    if (mark[e] !== stamp) return [];
    const chain: number[] = [];
    for (let t = e; t >= 0; t = from[t]) chain.push(t);
    chain.reverse();
    // portals (left/right as seen walking from a to b), then the simple stupid funnel
    const L: Pt[] = [{ x: a.x, z: a.z }], Rr: Pt[] = [{ x: a.x, z: a.z }];
    for (let i = 0; i + 1 < chain.length; i++) {
      const t = chain[i], n = chain[i + 1];
      let k = 0;
      while (k < 3 && nb[t * 3 + k] !== n) k++;
      const p = tri[t * 3 + k], q = tri[t * 3 + ((k + 1) % 3)];
      const P1 = { x: vx[p], z: vz[p] }, P2 = { x: vx[q], z: vz[q] };
      // triangle winding decides which end is left
      if (cross(cx[t], cz[t], P1.x, P1.z, P2.x, P2.z) < 0) L.push(P1), Rr.push(P2);
      else L.push(P2), Rr.push(P1);
    }
    L.push({ x: b.x, z: b.z });
    Rr.push({ x: b.x, z: b.z });
    const out: Pt[] = [];
    // Mikko Mononen's simple stupid funnel; tri2 > 0 = c is to the left of a->b (x right, z down)
    const tri2 = (a2: Pt, b2: Pt, c2: Pt) => (c2.x - a2.x) * (b2.z - a2.z) - (b2.x - a2.x) * (c2.z - a2.z);
    const eq = (p1: Pt, p2: Pt) => Math.abs(p1.x - p2.x) < 1e-4 && Math.abs(p1.z - p2.z) < 1e-4;
    let apex = L[0], pl = L[0], pr = Rr[0], ai = 0, li = 0, ri = 0;
    for (let i = 1; i < L.length; i++) {
      const l = L[i], r = Rr[i];
      if (tri2(apex, pr, r) <= 0) {
        if (eq(apex, pr) || tri2(apex, pl, r) > 0) (pr = r), (ri = i);
        else {
          out.push((apex = pl));
          ai = li;
          (pl = apex), (pr = apex), (li = ai), (ri = ai), (i = ai);
          continue;
        }
      }
      if (tri2(apex, pl, l) >= 0) {
        if (eq(apex, pl) || tri2(apex, pr, l) < 0) (pl = l), (li = i);
        else {
          out.push((apex = pr));
          ai = ri;
          (pl = apex), (pr = apex), (li = ai), (ri = ai), (i = ai);
          continue;
        }
      }
    }
    out.push({ x: b.x, z: b.z });
    return out;
  }
  /** Nearest walkable point (triangle centroid when p is off the mesh). */
  const snap = (p: Pt): Pt | null => {
    const t = locate(p.x, p.z, 60);
    return t < 0 ? null : inTri(t, p.x, p.z) ? { x: p.x, z: p.z } : { x: cx[t], z: cz[t] };
  };
  return { path, snap, locate, tris: NT };
}
