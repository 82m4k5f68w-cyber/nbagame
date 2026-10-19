// Player mesh check (unity/Assets/Scripts/Game/RigMesh.cs, the UnityEngine-free half of Rig.cs): for every player
// of every team at both detail levels the mesh must carry real arms (vertices skinned to the shoulder / elbow / wrist /
// finger bones, athletic girth), weights that sum to 1, finite positions inside the SkinnedMeshRenderer's local
// bounds (Rig.cs: centre (0, 3.6, 0), size 9 x 10 x 9 around the hips), and stay inside the triangle budget.
// Bug report "arms don't show". Also prints the look of a few players (compare with src/client/look.ts lookOf).
//   scripts/unity/cs.sh unity/CoreTests/RigMeshCheck.cs
//@include unity/Assets/Scripts/Game/RigMesh.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using Hoops.Game;
using static Hoops.Core.Sim;

static class RigMeshCheck
{
    static void Main()
    {
        Rng.Seed(3);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.MYM = 0;
        cfg.input = c => new Input();
        var fails = new List<string>();
        int n = 0;
        long[] tris = new long[2];
        int[] tmax = new int[2];
        for (int g = 0; g < 7; g++)
        {
            setCtrls(new List<Ctrl>());
            start(g * 2 % 14, new StartOpts { j = (g * 2 + 1) % 14 });
            foreach (var p in P)
                for (int lod = 0; lod < 2; lod++)
                {
                    var D = RigMesh.Build(p, lod);
                    n += lod == 0 ? 1 : 0;
                    tris[lod] += D.Tris;
                    tmax[lod] = Math.Max(tmax[lod], D.Tris);
                    int arm = 0, bad = 0, outside = 0;
                    double girth = 0;
                    var off = RigMesh.Offsets(p.bk);
                    // right shoulder joint (three space, rest pose)
                    var sh = off[RigMesh.BD] + off[RigMesh.CH] + off[RigMesh.SR];
                    for (int i = 0; i < D.v.Count; i++)
                    {
                        var v = D.v[i];
                        float w = D.bw[i * 4] + D.bw[i * 4 + 1] + D.bw[i * 4 + 2] + D.bw[i * 4 + 3];
                        if (!float.IsFinite(v.X + v.Y + v.Z) || Math.Abs(w - 1) > 1e-4) bad++;
                        if (Math.Abs(v.X) > 4.5 || v.Y < -1.4 || v.Y > 8.6 || Math.Abs(v.Z) > 4.5) outside++;
                        int b = D.bi[i * 4];
                        if (D.bw[i * 4] > 0.5 && (b == RigMesh.SL || b == RigMesh.SR || b == RigMesh.EL || b == RigMesh.ER || b == RigMesh.WL || b == RigMesh.WR || b == RigMesh.GL || b == RigMesh.GR))
                        {
                            arm++;
                            double dy = sh.Y - v.Y;
                            if (v.X > 0 && dy > 0.4 && dy < 0.6) girth = Math.Max(girth, Math.Sqrt((v.X - sh.X) * (v.X - sh.X) + (v.Z - sh.Z) * (v.Z - sh.Z)));
                        }
                    }
                    string id = $"{p.n} lod {lod}";
                    if (arm < 300) fails.Add($"{id}: only {arm} arm vertices");
                    if (girth < 0.15) fails.Add($"{id}: upper arm radius {girth:0.000}");
                    if (bad > 0) fails.Add($"{id}: {bad} bad vertices");
                    if (outside > 0) fails.Add($"{id}: {outside} vertices outside the renderer bounds");
                    if (D.print.Count == 0) fails.Add($"{id}: no jersey prints");
                    if (D.Tris > (lod == 1 ? 26000 : 15000)) fails.Add($"{id}: {D.Tris} triangles");
                }
        }
        Console.WriteLine($"{n} players: triangles avg lod1 {tris[1] / n} (max {tmax[1]}), lod0 {tris[0] / n} (max {tmax[0]})");
        foreach (var nm in new[] { "Doncic", "Curry", "Jokic", "Brunson", "Towns" })
        {
            var L = RigLook.Of(nm, "#8d5524", 1, 1, "#1d428a", null, null);
            Console.WriteLine($"look {nm}: hair {L.hair} beard {L.beard} cut {L.shoeCut} sleeve {L.sleeve} wrist {L.wrist} knee {L.knee} tights {L.tights} band {L.band} tape {L.tape} hc {L.hc} eye {L.eye} sock {L.sock} {L.sockH:0.00} shoe {string.Join(",", L.shoe)} es {L.es:0.000} fh {L.fh:0.000}");
        }
        Console.WriteLine(fails.Count == 0 ? "RIG MESH OK" : "RIG MESH FAIL\n" + string.Join("\n", fails.GetRange(0, Math.Min(20, fails.Count))));
        Environment.Exit(fails.Count == 0 ? 0 : 1);
    }
}
