// Navmesh pathing for LIFE NPCs (recast-navigation; wasm is embedded in its JS, ~1 MB, so load it lazily:
// `const nav = await import("./nav")`). Not wired into src/life yet (the LIFE agent owns it) - see docs/ASSETS.md.
//   const N = await buildTownNav(PLACES, WORLD);   // ground minus building footprints (ovals as 16-gons)
//   const pts = N.path({ x: 0, z: 0 }, { x: 120, z: 80 });   // [{x, z}...] around buildings
import { init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";

export type Foot = { x: number; z: number; w: number; d: number; oval?: boolean; k?: string };
let inited: Promise<void> | null = null;
/** Triangle soup: a floor grid over [-half, half]^2 with raised blocks for every footprint (recast carves them out). */
export function townGeometry(places: Foot[], half: number, cell = 20) {
  const pos: number[] = [],
    idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  };
  for (let x = -half; x < half; x += cell) for (let z = -half; z < half; z += cell) quad([x, 0, z], [x + cell, 0, z], [x + cell, 0, z + cell], [x, 0, z + cell]);
  const H = 12;
  for (const p of places) {
    if (p.k === "court") continue; // walk-on courts
    const ring: number[][] = [];
    const n = p.oval ? 16 : 4;
    for (let i = 0; i < n; i++) {
      const a = p.oval ? (i / n) * Math.PI * 2 : 0;
      ring.push(p.oval ? [p.x + (Math.cos(a) * p.w) / 2, p.z + (Math.sin(a) * p.d) / 2] : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [p.x + (sx * p.w) / 2, p.z + (sz * p.d) / 2])[i]);
    }
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i],
        [bx, bz] = ring[(i + 1) % n];
      quad([ax, 0, az], [bx, 0, bz], [bx, H, bz], [ax, H, az]); // walls
    }
    const c = pos.length / 3; // roof fan (non-walkable: above the agent's climb)
    pos.push(p.x, H, p.z, ...ring.flatMap(([x, z]) => [x, H, z]));
    for (let i = 0; i < n; i++) idx.push(c, c + 1 + ((i + 1) % n), c + 1 + i);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
export async function buildTownNav(places: Foot[], half: number, agentRadius = 1.4) {
  await (inited ||= init());
  const g = townGeometry(places, half);
  const r = generateSoloNavMesh(g.positions, g.indices, { cs: 0.6, ch: 0.3, walkableRadius: Math.ceil(agentRadius / 0.6), walkableClimb: 2, walkableHeight: 10, maxEdgeLen: 40, maxSimplificationError: 1.3, minRegionArea: 8 } as any);
  if (!r.success || !r.navMesh) throw new Error("navmesh: " + (r as any).error);
  const nav: NavMesh = r.navMesh,
    q = new NavMeshQuery(nav);
  return {
    nav,
    /** Straight path (corners) from a to b on the walkable area; [] when unreachable. */
    path(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] {
      const res: any = q.computePath({ x: a.x, y: 0, z: a.z }, { x: b.x, y: 0, z: b.z });
      return res && res.success ? res.path.map((p: any) => ({ x: p.x, z: p.z })) : [];
    },
    /** Snap a point to the nearest walkable spot. */
    snap(p: { x: number; z: number }) {
      const r2: any = q.findClosestPoint({ x: p.x, y: 0, z: p.z });
      return r2 && r2.success ? { x: r2.point.x, z: r2.point.z } : null;
    },
    destroy: () => (q.destroy(), nav.destroy()),
  };
}
