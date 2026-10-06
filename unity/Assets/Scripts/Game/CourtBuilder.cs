// Court, hoops, arena shell and lights, built from code (no imported assets). Feet, Unity Y up; game (x, y) maps
// through PhysXBall.U. The floor texture is painted once at startup (hardwood planks + NBA lines).
using Hoops.Core;
using UnityEngine;

namespace Hoops.Game
{
    public static class CourtBuilder
    {
        public static void Build()
        {
            var root = new GameObject("Arena").transform;
            // floor: 94 x 50 ft court on a larger apron
            // own quad with UVs in game coords (u = x / 940, v = y / 500) so the painted lines land where the sim
            // thinks they are; PhysX's floor lives in PhysXBall
            var floor = new GameObject("Court", typeof(MeshFilter), typeof(MeshRenderer));
            floor.transform.SetParent(root, false);
            var qm = new Mesh { vertices = new[] { PhysXBall.U(0, 0, 0), PhysXBall.U(940, 0, 0), PhysXBall.U(940, 500, 0), PhysXBall.U(0, 500, 0) }, uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) }, triangles = new[] { 0, 1, 2, 0, 2, 3 } };
            qm.RecalculateNormals();
            if (qm.normals[0].y < 0) { qm.triangles = new[] { 0, 2, 1, 0, 3, 2 }; qm.RecalculateNormals(); }
            qm.RecalculateTangents();
            floor.GetComponent<MeshFilter>().sharedMesh = qm;
            floor.GetComponent<MeshRenderer>().receiveShadows = true;
            var fm = PlayerDraw.Mat(Color.white, 0.62f);
            var tex = CourtTexture();
            fm.mainTexture = tex;
            if (fm.HasProperty("_BaseMap")) fm.SetTexture("_BaseMap", tex);
            floor.GetComponent<Renderer>().sharedMaterial = fm;
            var apron = GameObject.CreatePrimitive(PrimitiveType.Plane);
            apron.transform.SetParent(root, false);
            apron.transform.position = new Vector3(0, -0.02f, 0);
            apron.transform.localScale = new Vector3(14, 1, 9);
            Object.Destroy(apron.GetComponent<Collider>());
            apron.GetComponent<Renderer>().sharedMaterial = PlayerDraw.Mat(new Color(0.13f, 0.1f, 0.16f), 0.4f);
            // hoops: glass, frame, rim (torus of capsules), support
            for (int b = 0; b < 2; b++)
            {
                double hx = Sim.HXs[b], bx = b == 1 ? 900 : 40, side = b == 1 ? 1 : -1;
                Box(root, PhysXBall.U(bx + side * 0.6, Sim.HY, 116), new Vector3(0.12f, 4f, 6f), new Color(0.85f, 0.92f, 1f, 1f), 0.95f);
                Box(root, PhysXBall.U(bx + side * 0.6, Sim.HY, 101.5), new Vector3(0.14f, 0.12f, 1.9f), new Color(0.95f, 0.95f, 0.95f), 0.5f); // shooter's square base
                Box(root, PhysXBall.U(bx + side * 30, Sim.HY, 60), new Vector3(1.2f, 12f, 1.2f), new Color(0.12f, 0.12f, 0.14f), 0.4f);
                Box(root, PhysXBall.U(bx + side * 15, Sim.HY, 118), new Vector3(3f, 0.4f, 0.4f), new Color(0.12f, 0.12f, 0.14f), 0.4f);
                var rim = PlayerDraw.Mat(new Color(1f, 0.33f, 0.05f), 0.7f);
                for (int k = 0; k < 24; k++)
                {
                    double a0 = k / 24.0 * 6.283, a1 = (k + 1) / 24.0 * 6.283;
                    Vector3 p0 = PhysXBall.U(hx + System.Math.Cos(a0) * Sim.RR, Sim.HY + System.Math.Sin(a0) * Sim.RR, 100),
                        p1 = PhysXBall.U(hx + System.Math.Cos(a1) * Sim.RR, Sim.HY + System.Math.Sin(a1) * Sim.RR, 100);
                    var g = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    Object.Destroy(g.GetComponent<Collider>());
                    g.transform.SetParent(root, false);
                    g.transform.position = (p0 + p1) * 0.5f;
                    g.transform.rotation = Quaternion.FromToRotation(Vector3.up, (p1 - p0).normalized);
                    g.transform.localScale = new Vector3(0.09f, (p1 - p0).magnitude * 0.5f + 0.045f, 0.09f);
                    g.GetComponent<Renderer>().sharedMaterial = rim;
                }
            }
            // stands: tiers of seats around the court
            var seat = PlayerDraw.Mat(new Color(0.2f, 0.12f, 0.3f), 0.2f);
            for (int t = 0; t < 6; t++)
            {
                float d = 34 + t * 4, h = 1 + t * 2.4f;
                Box(root, new Vector3(0, h, -d), new Vector3(120 + t * 8, 2.4f, 4), seat.color, 0.2f);
                Box(root, new Vector3(0, h, d), new Vector3(120 + t * 8, 2.4f, 4), seat.color, 0.2f);
                Box(root, new Vector3(-60 - t * 4, h, 0), new Vector3(4, 2.4f, 70 + t * 8), seat.color, 0.2f);
                Box(root, new Vector3(60 + t * 4, h, 0), new Vector3(4, 2.4f, 70 + t * 8), seat.color, 0.2f);
            }
            // lights: near-overhead key with soft shadows + cool fill
            var key = new GameObject("Key").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 1.6f;
            key.shadows = LightShadows.Soft;
            key.shadowStrength = 0.75f;
            key.transform.rotation = Quaternion.Euler(72, 20, 0);
            var fill = new GameObject("Fill").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.35f;
            fill.color = new Color(0.7f, 0.8f, 1f);
            fill.shadows = LightShadows.None;
            fill.transform.rotation = Quaternion.Euler(30, 200, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.45f, 0.45f, 0.52f);
            RenderSettings.ambientEquatorColor = new Color(0.3f, 0.28f, 0.32f);
            RenderSettings.ambientGroundColor = new Color(0.25f, 0.2f, 0.16f);
        }

        static void Box(Transform root, Vector3 pos, Vector3 size, Color c, float smooth)
        {
            var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Object.Destroy(g.GetComponent<Collider>());
            g.transform.SetParent(root, false);
            g.transform.position = pos;
            g.transform.localScale = size;
            g.GetComponent<Renderer>().sharedMaterial = PlayerDraw.Mat(c, smooth);
        }

        /// <summary>2048 x 1090 px = 94 x 50 ft: planks, paint, arcs, lines (game px * 2.18).</summary>
        static Texture2D CourtTexture()
        {
            const int W = 2048, H = 1090;
            const float k = W / 940f;
            var px = new Color32[W * H];
            var rnd = new System.Random(7);
            for (int y = 0; y < H; y++)
            {
                int plank = y / 22;
                float tone = 0.92f + (float)((plank * 7919 % 13) / 13.0) * 0.12f;
                for (int x = 0; x < W; x++)
                {
                    float grain = 0.97f + 0.03f * Mathf.Sin(x * 0.05f + plank * 3.1f);
                    byte r = (byte)(222 * tone * grain), g = (byte)(170 * tone * grain), b = (byte)(110 * tone * grain);
                    px[y * W + x] = new Color32(r, g, b, 255);
                }
            }
            var line = new Color32(250, 250, 250, 255);
            var paint = new Color32(124, 63, 181, 255);
            void Fill(float x0, float y0, float x1, float y1, Color32 c)
            {
                for (int y = Mathf.Max(0, (int)(y0 * k)); y < Mathf.Min(H, (int)(y1 * k)); y++)
                    for (int x = Mathf.Max(0, (int)(x0 * k)); x < Mathf.Min(W, (int)(x1 * k)); x++) px[y * W + x] = c;
            }
            void Ring(float cx, float cy, float r, float a0, float a1, Color32 c)
            {
                for (float a = a0; a <= a1; a += 0.002f)
                    for (float t = -0.18f; t <= 0.18f; t += 0.18f)
                    {
                        int x = (int)((cx + Mathf.Cos(a) * (r + t)) * k), y = (int)((cy + Mathf.Sin(a) * (r + t)) * k);
                        for (int dy = -1; dy <= 1; dy++)
                            for (int dx = -1; dx <= 1; dx++)
                                if (x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H) px[(y + dy) * W + x + dx] = c;
                    }
            }
            // boundary + half-court line
            Fill(0, 0, 940, 2, line); Fill(0, 498, 940, 500, line); Fill(0, 0, 2, 500, line); Fill(938, 0, 940, 500, line);
            Fill(469, 0, 471, 500, line);
            Ring(470, 250, 60, 0, 6.29f, line);
            for (int b = 0; b < 2; b++)
            {
                float hx = (float)Sim.HXs[b], dir = b == 1 ? -1 : 1, bx = b == 1 ? 940 : 0;
                float lx0 = Mathf.Min(bx, bx + dir * 190), lx1 = Mathf.Max(bx, bx + dir * 190);
                Fill(lx0, 170, lx1, 330, paint);
                Fill(lx0, 170, lx1, 172, line); Fill(lx0, 328, lx1, 330, line);
                Fill(bx + dir * 190 - 1, 170, bx + dir * 190 + 1, 330, line);
                Ring(bx + dir * 190, 250, 60, 0, 6.29f, line);
                // three-point line: corners at 22 ft, arc at 23.75 ft
                float cl = 140 * 0.98f;
                Fill(Mathf.Min(bx, bx + dir * cl), 30, Mathf.Max(bx, bx + dir * cl), 32, line);
                Fill(Mathf.Min(bx, bx + dir * cl), 468, Mathf.Max(bx, bx + dir * cl), 470, line);
                float a = Mathf.Acos(220f / 237.5f);
                if (b == 0) Ring(hx, 250, 237.5f, -Mathf.PI / 2 + (Mathf.PI / 2 - a), Mathf.PI / 2 - (Mathf.PI / 2 - a), line);
                else Ring(hx, 250, 237.5f, Mathf.PI / 2 + (Mathf.PI / 2 - a), 3 * Mathf.PI / 2 - (Mathf.PI / 2 - a), line);
            }
            var t2 = new Texture2D(W, H, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, anisoLevel = 8 };
            t2.SetPixels32(px);
            t2.Apply(true, true);
            return t2;
        }
    }
}
