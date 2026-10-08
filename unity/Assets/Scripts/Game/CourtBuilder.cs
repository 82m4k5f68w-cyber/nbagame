// Court, hoops and the key lights, built from code (no imported assets). Feet, Unity Y up; game (x, y) maps through
// PhysXBall.U; three.js positions from render3d.ts map through Gfx.V3 (Z mirrored). The floor texture is painted from
// code (maple boards, scuffs, team paint, NBA lines, logo and team names) and repainted by Arena when the teams change.
// Stands, crowd, lights rig, jumbotron etc. are in Arena.cs; ball/rim colliders are in PhysXBall.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;

namespace Hoops.Game
{
    public static class CourtBuilder
    {
        public static Transform Root;
        public static GameObject Floor, Apron;
        public static Light Key, Fill;
        /// <summary>Per hoop: the parts that shake on a dunk (rim 1, bracket .8, board .35) with their rest heights.</summary>
        public static readonly List<(Transform t, float y, float k)>[] HoopParts = { new List<(Transform, float, float)>(), new List<(Transform, float, float)>() };
        static Material floorMat;
        static Gfx.Paint court;
        static Color32[] wood;
        const int TW = 2048, TH = 1090;
        const float K = TW / 940f;

        public static void Build()
        {
            Root = new GameObject("Arena").transform;
            // floor: own quad with UVs in game coords (u = x / 940, v = y / 500) so the painted lines land where the sim
            // thinks they are; PhysX's floor lives in PhysXBall
            Floor = new GameObject("Court", typeof(MeshFilter), typeof(MeshRenderer));
            Floor.transform.SetParent(Root, false);
            var qm = new Mesh { vertices = new[] { PhysXBall.U(0, 0, 0), PhysXBall.U(940, 0, 0), PhysXBall.U(940, 500, 0), PhysXBall.U(0, 500, 0) }, uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) }, triangles = new[] { 0, 1, 2, 0, 2, 3 } };
            qm.RecalculateNormals();
            if (qm.normals[0].y < 0) { qm.triangles = new[] { 0, 2, 1, 0, 3, 2 }; qm.RecalculateNormals(); }
            qm.RecalculateTangents();
            Floor.GetComponent<MeshFilter>().sharedMesh = qm;
            Floor.GetComponent<MeshRenderer>().receiveShadows = true;
            Floor.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            floorMat = Gfx.Lit(Color.white, 0.66f);
            PaintCourt(Sim.PC[0], Sim.PC[1], Sim.cl[0], Sim.cl[1]);
            Gfx.SetTex(floorMat, court.tex);
            Floor.GetComponent<Renderer>().sharedMaterial = floorMat;
            Apron = Gfx.Obj("Apron", Gfx.Cube(), Gfx.Lit(new Color(0.07f, 0.08f, 0.165f), 0.45f), new Vector3(0, -0.05f, 0), Quaternion.identity, new Vector3(150, 0.06f, 100), Root, false);
            Hoops();
            // lights: near-overhead key with soft shadows (the catwalk rig) + cool fill; spots/shafts are in Arena
            Key = new GameObject("Key").AddComponent<Light>();
            Key.type = LightType.Directional;
            Key.color = new Color(1f, 0.953f, 0.886f);
            Key.intensity = 1.5f;
            Key.shadows = LightShadows.Soft;
            Key.shadowStrength = 0.8f;
            Key.shadowBias = 0.02f;
            Key.shadowNormalBias = 0.25f;
            // three: sun at (4, 80, 7) looking at the origin -> Unity direction from (4, 80, -7)
            Key.transform.rotation = Quaternion.LookRotation(-Gfx.V3(4, 80, 7).normalized, Vector3.forward);
            Fill = new GameObject("Fill").AddComponent<Light>();
            Fill.type = LightType.Directional;
            Fill.intensity = 0.3f;
            Fill.color = new Color(0.7f, 0.8f, 1f);
            Fill.shadows = LightShadows.None;
            Fill.transform.rotation = Quaternion.Euler(30, 200, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.42f, 0.44f, 0.52f);
            RenderSettings.ambientEquatorColor = new Color(0.26f, 0.25f, 0.3f);
            RenderSettings.ambientGroundColor = new Color(0.22f, 0.17f, 0.12f);
        }

        /// <summary>Padded stanchion, arm, glass with white frame + shooter's square, bottom pad, torus rim + bracket
        /// (render3d.ts hoops). Board/rim/bracket transforms are recorded for the dunk shake.</summary>
        static void Hoops()
        {
            var mt = Gfx.Lit(new Color(0.15f, 0.165f, 0.21f), 0.65f, 0.7f);
            var white = Gfx.Lit(Color.white, 0.5f);
            var glass = Gfx.Transparent(Gfx.Lit(new Color(0.91f, 0.96f, 1f, 0.22f), 0.96f), true);
            var rimM = Gfx.Lit(new Color(1f, 0.3f, 0.1f), 0.78f, 0.7f);
            var padB = Gfx.Lit(new Color(0.82f, 0.23f, 0.1f), 0.5f);
            var torus = Gfx.Torus(0.75f, 0.07f, 48, 10);
            var cyl = Gfx.Cylinder(0.42f, 0.55f, 12, 20);
            var box = Gfx.Cube();
            for (int b = 0; b < 2; b++)
            {
                float sg = b == 1 ? 1 : -1, hx = (float)(Sim.HXs[b] - 470) * 0.1f;
                var pad = Gfx.Lit(Gfx.Hex(Sim.PC[b], new Color(0.11f, 0.26f, 0.54f)), 0.15f);
                Gfx.Obj("Base", box, pad, Gfx.V3(sg * 49.4f, 1.7f, 0), Quaternion.identity, new Vector3(2.6f, 3.4f, 3.6f), Root);
                Gfx.Obj("Stanchion", cyl, mt, Gfx.V3(sg * 49.4f, 9, 0), Quaternion.identity, Vector3.one, Root);
                Gfx.Obj("Arm", box, mt, Gfx.V3(sg * 46.3f, 12.6f, 0), Quaternion.Euler(0, 0, sg * -0.32f * Mathf.Rad2Deg), new Vector3(6.2f, 0.4f, 0.5f), Root);
                Gfx.Obj("Brace", box, mt, Gfx.V3(sg * 43.3f, 11.5f, 0), Quaternion.identity, new Vector3(0.25f, 1.2f, 1.2f), Root);
                // the board: glass + frame + shooter's square + bottom pad move together
                var board = new GameObject("Board").transform;
                board.SetParent(Root, false);
                board.localPosition = Gfx.V3(sg * 43, 11.45f, 0);
                Gfx.Obj("Glass", box, glass, Vector3.zero, Quaternion.identity, new Vector3(0.12f, 3.5f, 6), board, false);
                const float e = 0.07f;
                Gfx.Obj("FrameT", box, white, new Vector3(0, 1.75f, 0), Quaternion.identity, new Vector3(0.13f, e, 6 + e), board, false);
                Gfx.Obj("FrameB", box, white, new Vector3(0, -1.75f, 0), Quaternion.identity, new Vector3(0.13f, e, 6 + e), board, false);
                Gfx.Obj("FrameL", box, white, new Vector3(0, 0, 3), Quaternion.identity, new Vector3(0.13f, 3.5f, e), board, false);
                Gfx.Obj("FrameR", box, white, new Vector3(0, 0, -3), Quaternion.identity, new Vector3(0.13f, 3.5f, e), board, false);
                float fx = -sg * 0.08f, sy = 10.6f - 11.45f;
                Gfx.Obj("SqT", box, white, new Vector3(fx, sy + 0.75f, 0), Quaternion.identity, new Vector3(0.02f, 0.06f, 2), board, false);
                Gfx.Obj("SqB", box, white, new Vector3(fx, sy - 0.75f, 0), Quaternion.identity, new Vector3(0.02f, 0.06f, 2), board, false);
                Gfx.Obj("SqL", box, white, new Vector3(fx, sy, 1), Quaternion.identity, new Vector3(0.02f, 1.5f, 0.06f), board, false);
                Gfx.Obj("SqR", box, white, new Vector3(fx, sy, -1), Quaternion.identity, new Vector3(0.02f, 1.5f, 0.06f), board, false);
                Gfx.Obj("Pad", box, padB, new Vector3(0, 9.68f - 11.45f, 0), Quaternion.identity, new Vector3(0.2f, 0.2f, 6.1f), board);
                var rim = Gfx.Obj("Rim", torus, rimM, Gfx.V3(hx, 10, 0), Quaternion.identity, Vector3.one, Root).transform;
                var brk = Gfx.Obj("Bracket", box, rimM, Gfx.V3(sg * 42.6f, 10, 0), Quaternion.identity, new Vector3(0.6f, 0.14f, 0.42f), Root).transform;
                HoopParts[b].Add((rim, rim.localPosition.y, 1f));
                HoopParts[b].Add((brk, brk.localPosition.y, 0.8f));
                HoopParts[b].Add((board, board.localPosition.y, 0.35f));
            }
        }

        static Color32 Mix(Color32 a, Color32 b, float t) => new Color32((byte)(a.r + (b.r - a.r) * t), (byte)(a.g + (b.g - a.g) * t), (byte)(a.b + (b.b - a.b) * t), 255);
        static Color32 HSL(float h, float s, float l)
        {
            float q = l < 0.5f ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
            float Ch(float t)
            {
                t = t - Mathf.Floor(t);
                return t < 1 / 6f ? p + (q - p) * 6 * t : t < 0.5f ? q : t < 2 / 3f ? p + (q - p) * (2 / 3f - t) * 6 : p;
            }
            return new Color32((byte)(Ch(h + 1 / 3f) * 255), (byte)(Ch(h) * 255), (byte)(Ch(h - 1 / 3f) * 255), 255);
        }
        public static Color HSLc(float h, float s, float l) => HSL(h, s, l);

        /// <summary>Paints the hardwood (once) and the team paint, lines, logo and names (every team change).</summary>
        public static void PaintCourt(string pc0, string pc1, string n0, string n1)
        {
            if (court == null)
            {
                court = new Gfx.Paint(TW, TH);
                court.tex.anisoLevel = 8;
                wood = Wood();
            }
            var px = court.px;
            System.Array.Copy(wood, px, px.Length);
            Color32 c0 = Gfx.Hex(pc0, new Color(0.48f, 0.25f, 0.71f)), c1 = Gfx.Hex(pc1, new Color(0.11f, 0.26f, 0.54f)), line = new Color32(251, 251, 246, 255);
            // row index = game y * K (v = y / 500): no flip, rows run toward the broadcast camera
            void Blend(int i, Color32 c, float a) => px[i] = Mix(px[i], c, a);
            void Fill(float x0, float y0, float x1, float y1, Color32 c, float a = 1)
            {
                for (int y = Mathf.Max(0, (int)(y0 * K)); y < Mathf.Min(TH, (int)(y1 * K)); y++)
                    for (int x = Mathf.Max(0, (int)(x0 * K)); x < Mathf.Min(TW, (int)(x1 * K)); x++) Blend(y * TW + x, c, a);
            }
            void Disc(float cx, float cy, float r, float a0, float a1, Color32 c, float a)
            {
                for (int y = Mathf.Max(0, (int)((cy - r) * K)); y < Mathf.Min(TH, (int)((cy + r) * K) + 1); y++)
                    for (int x = Mathf.Max(0, (int)((cx - r) * K)); x < Mathf.Min(TW, (int)((cx + r) * K) + 1); x++)
                    {
                        float dx = x / K - cx, dy = y / K - cy;
                        if (dx * dx + dy * dy > r * r) continue;
                        float an = Mathf.Atan2(dy, dx);
                        if (an < a0) an += Mathf.PI * 2;
                        if (an > a1) continue;
                        Blend(y * TW + x, c, a);
                    }
            }
            void Ring(float cx, float cy, float r, float a0, float a1, float dash = 0)
            {
                float hw = 1.1f;
                for (float a = a0; a <= a1; a += 0.6f / (r * K))
                {
                    if (dash > 0 && ((int)((a - a0) * r / dash) & 1) == 1) continue;
                    for (float t = -hw; t <= hw; t += 0.4f)
                    {
                        int x = (int)((cx + Mathf.Cos(a) * (r + t)) * K), y = (int)((cy + Mathf.Sin(a) * (r + t)) * K);
                        if (x >= 0 && x < TW && y >= 0 && y < TH) px[y * TW + x] = line;
                    }
                }
            }
            void HL(float x0, float x1, float y) => Fill(Mathf.Min(x0, x1), y - 1.1f, Mathf.Max(x0, x1), y + 1.1f, line);
            void VL(float x, float y0, float y1) => Fill(x - 1.1f, Mathf.Min(y0, y1), x + 1.1f, Mathf.Max(y0, y1), line);
            for (int b = 0; b < 2; b++)
            {
                Color32 col = b == 1 ? c1 : c0, dark = Mix(col, new Color32(0, 0, 0, 255), 0.18f);
                float x0 = b == 1 ? 750 : 0;
                // lane paint: gradient toward the free-throw line, baseline band
                for (int i = 0; i < 19; i++)
                {
                    float t = i / 18f, xa = x0 + i * 10;
                    Fill(xa, 170, xa + 10, 330, b == 1 ? Mix(dark, col, t) : Mix(col, dark, t), 0.86f);
                }
                Fill(b == 1 ? 900 : 0, 0, b == 1 ? 940 : 40, 500, col, 0.18f);
            }
            Disc(470, 250, 60, Mathf.PI / 2, 3 * Mathf.PI / 2, c0, 0.85f);
            Disc(470, 250, 60, -Mathf.PI / 2, Mathf.PI / 2, c1, 0.85f);
            // lines
            HL(0, 940, 1.5f); HL(0, 940, 498.5f); VL(1.5f, 0, 500); VL(938.5f, 0, 500); VL(470, 0, 500);
            Ring(470, 250, 60, 0, 6.3f);
            Ring(470, 250, 20, 0, 6.3f);
            for (int b = 0; b < 2; b++)
            {
                float hx = (float)Sim.HXs[b], e = b == 1 ? 940 : 0, sg = b == 1 ? -1 : 1, lx = e + sg * 190;
                HL(e, lx, 170); HL(e, lx, 330); VL(lx, 170, 330);
                if (b == 0) { Ring(lx, 250, 60, -1.57f, 1.57f); Ring(lx, 250, 60, 1.57f, 4.71f, 7); }
                else { Ring(lx, 250, 60, 1.57f, 4.71f); Ring(lx, 250, 60, -1.57f, 1.57f, 7); }
                if (b == 0) Ring(hx, 250, 237, -1.19f, 1.19f); else Ring(hx, 250, 237, Mathf.PI - 1.19f, Mathf.PI + 1.19f);
                HL(e, hx + sg * 88, 30); HL(e, hx + sg * 88, 470); // corner threes
                if (b == 0) Ring(hx, 250, 40, -1.57f, 1.57f); else Ring(hx, 250, 40, 1.57f, 4.71f); // restricted area
                foreach (var yy in new[] { 170f, 330f })
                    foreach (var dx in new[] { 70f, 80f, 110f, 140f })
                        VL(e + sg * dx, yy, yy + (yy < 250 ? -6 : 6)); // lane hash marks
            }
            // centre logo + team names along the baselines (read from the broadcast side)
            Color32 wt = new Color32(255, 255, 255, 235), wn = Mix(new Color32(255, 255, 255, 255), wood[(int)(250 * K) * TW + (int)(20 * K)], 0.75f);
            BitFont.Draw(px, TW, TH, "2K27", (int)(470 * K), (int)(252 * K), 13, wt, false, 0, 0.18f);
            BitFont.Draw(px, TW, TH, (n0 ?? "").ToUpperInvariant(), (int)(20 * K), (int)(250 * K), 6, wn, false, 0, 0, -1);
            BitFont.Draw(px, TW, TH, (n1 ?? "").ToUpperInvariant(), (int)(920 * K), (int)(250 * K), 6, wn, false, 0, 0, 1);
            court.Upload();
        }

        /// <summary>Maple boards along the court (2.25" strips, random lengths, staggered joints), grain, scuffs where
        /// the action is, varnish sheen toward centre court.</summary>
        static Color32[] Wood()
        {
            var px = new Color32[TW * TH];
            var rnd = new System.Random(7);
            int bh = Mathf.Max(4, Mathf.RoundToInt(1.9f * K));
            for (int y = 0; y < TH; y += bh)
            {
                int x = -(int)(rnd.NextDouble() * 300);
                while (x < TW)
                {
                    int L = 260 + (int)(rnd.NextDouble() * 520);
                    float t = (float)rnd.NextDouble();
                    Color32 c = HSL((28 + t * 7) / 360f, 0.58f + t * 0.12f, 0.5f + t * 0.09f);
                    for (int yy = y; yy < Mathf.Min(TH, y + bh); yy++)
                        for (int xx = Mathf.Max(0, x); xx < Mathf.Min(TW, x + L); xx++)
                        {
                            float g = 0.97f + 0.03f * Mathf.Sin(xx * 0.05f + y * 0.37f);
                            var p = c;
                            p.r = (byte)(p.r * g); p.g = (byte)(p.g * g); p.b = (byte)(p.b * g);
                            if (xx == x || xx == x + 1) p = Mix(p, new Color32(90, 52, 18, 255), 0.18f); // butt joint
                            px[yy * TW + xx] = p;
                        }
                    for (int k = 0; k < 3; k++)
                    {
                        int gx = x + (int)(rnd.NextDouble() * L), gy = y + (int)(rnd.NextDouble() * bh), gl = 20 + (int)(rnd.NextDouble() * 90);
                        float a = 0.04f + (float)rnd.NextDouble() * 0.05f;
                        if (gy < TH) for (int xx = Mathf.Max(0, gx); xx < Mathf.Min(TW, gx + gl); xx++) px[gy * TW + xx] = Mix(px[gy * TW + xx], new Color32(110, 64, 24, 255), a); // grain
                    }
                    x += L;
                }
                for (int xx = 0; xx < TW; xx++) px[y * TW + xx] = Mix(px[y * TW + xx], new Color32(70, 40, 12, 255), 0.16f); // seam
            }
            // scuff marks: arcs of shoe rubber in the paint, at the top of the key and the centre circle
            float[,] hot = { { 100, 250, 90 }, { 840, 250, 90 }, { 230, 250, 60 }, { 710, 250, 60 }, { 470, 250, 70 } };
            for (int n = 0; n < 220; n++)
            {
                int h = n % 5;
                float a = (float)rnd.NextDouble() * 6.283f, r = (float)rnd.NextDouble() * hot[h, 2],
                    cx = (hot[h, 0] + Mathf.Cos(a) * r) * K, cy = (hot[h, 1] + Mathf.Sin(a) * r * 1.4f) * K,
                    rr = 14 + (float)rnd.NextDouble() * 40, a0 = (float)rnd.NextDouble() * 6.3f, a1 = a0 + 0.5f + (float)rnd.NextDouble(),
                    al = 0.035f + (float)rnd.NextDouble() * 0.06f, w = 1 + (float)rnd.NextDouble() * 2;
                for (float t = a0; t < a1; t += 0.5f / rr)
                    for (float d = -w; d <= w; d += 1)
                    {
                        int x = (int)(cx + Mathf.Cos(t) * (rr + d)), y = (int)(cy + Mathf.Sin(t) * (rr + d));
                        if (x >= 0 && x < TW && y >= 0 && y < TH) px[y * TW + x] = Mix(px[y * TW + x], new Color32(35, 22, 12, 255), al);
                    }
            }
            for (int y = 0; y < TH; y++)
                for (int x = 0; x < TW; x++)
                {
                    float dx = (x - TW / 2f) / TW, dy = (y - TH / 2f) / TW, d = Mathf.Sqrt(dx * dx + dy * dy) / 0.6f;
                    int i = y * TW + x;
                    px[i] = d < 0.5f ? Mix(px[i], new Color32(255, 225, 180, 255), 0.05f * (1 - d * 2)) : Mix(px[i], new Color32(80, 40, 10, 255), 0.1f * Mathf.Min(1, (d - 0.5f) * 2));
                }
            return px;
        }
    }
}
