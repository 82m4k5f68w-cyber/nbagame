// Skinned player model (port of src/client/rig3d.ts): one SkinnedMeshRenderer per player on a bone hierarchy that
// mirrors the core's joint model exactly (Core Pose.RIG offsets; Pose.handPos stays the true release point).
// Lathed muscles, sneakers, face parts and jersey prints are merged into one mesh with rig3d's two-bone joint blends.
// Colours live in one shared palette Texture2D (each part's UVs point at its texel); the jersey fabric is a second
// submesh with a knit texture; numbers and names are small quads painted from a built-in bitmap font.
//
// Frames: three.js is right-handed (W3 = [(x-470)*.1, z*.1, (y-250)*.1]); here Unity = three with Z flipped
// (PhysXBall.U). So geometry is built exactly as rig3d builds it (three space, CCW fronts) and mirrored at the end
// (z -> -z keeps fronts: Unity fronts are clockwise), bone offsets get z negated, and a three Euler (x, y, z, order)
// becomes the Unity rotation with the X and Y angles negated, composed in the same order (M Rx(a) M = Rx(-a),
// M Ry(a) M = Ry(-a), M Rz(a) M = Rz(a), M = diag(1, 1, -1)). unity/CoreTests/RigCheck.cs verifies the chain.
using System;
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Pose;

namespace Hoops.Game
{
    public sealed class PlayerRig
    {
        // ---- bone indices (same order as rig3d's `names`) ----
        public const int HIPS = 0, BD = 1, TL = 2, TR = 3, KL = 4, KR = 5, SL = 6, SR = 7, EL = 8, ER = 9, WL = 10, WR = 11,
            CH = 12, NK = 13, HD = 14, AL = 15, AR = 16, GL = 17, GR = 18, FLL = 19, FLR = 20, TFL = 21, TFR = 22, HEM = 23,
            JW = 24, MI = 25, MO = 26, CL = 27, CR = 28, BRL = 29, BRR = 30, LL = 31, LR = 32, YL = 33, YR = 34, NB = 35;
        public const int XYZ = 0, YXZ = 1, XZY = 2;

        public GameObject go;
        public Transform G;
        public SkinnedMeshRenderer smr;
        public readonly Transform[] bn = new Transform[NB];
        public Player p;
        // three-space Euler components the later passes read back (rig3d reads bone.rotation.x/z)
        readonly float[] thx = new float[2], thz = new float[2], knx = new float[2], anx = new float[2];
        float bdx, bdz;
        // cloth / hem springs, foot plants
        readonly float[] cx = new float[2], cvx = new float[2], cz = new float[2], cvz = new float[2];
        float hx, hvx, hz, hvz, hpx, hpz;
        readonly bool[] plOn = new bool[2];
        readonly Vector3[] plP = new Vector3[2];
        readonly float[] plW = new float[2];
        readonly Vector3[] fr = new Vector3[8]; // face rest positions (Unity local): corners, brows, lids, irises
        static readonly float L1 = (float)RIG.L1, L2 = (float)RIG.L2;

        // ---------------------------------------------------------------- rotations
        static Quaternion AX(float a) { a *= 0.5f; return new Quaternion(Mathf.Sin(a), 0, 0, Mathf.Cos(a)); }
        static Quaternion AY(float a) { a *= 0.5f; return new Quaternion(0, Mathf.Sin(a), 0, Mathf.Cos(a)); }
        static Quaternion AZ(float a) { a *= 0.5f; return new Quaternion(0, 0, Mathf.Sin(a), Mathf.Cos(a)); }
        /// <summary>three.js Euler (x, y, z, order) -> the same rotation in the Z-mirrored Unity frame.</summary>
        public static Quaternion E(float x, float y, float z, int order)
        {
            Quaternion qx = AX(-x), qy = AY(-y), qz = AZ(z);
            return order == XYZ ? qx * qy * qz : order == YXZ ? qy * qx * qz : qx * qz * qy;
        }
        static Quaternion EX(float x) => AX(-x);

        // ---------------------------------------------------------------- geometry (three space)
        sealed class Geo
        {
            public readonly List<Vector3> v = new(), n = new();
            public readonly List<Vector2> uv = new();
            public readonly List<int> t = new();
            public Geo Clone()
            {
                var g = new Geo();
                g.v.AddRange(v); g.n.AddRange(n); g.uv.AddRange(uv); g.t.AddRange(t);
                return g;
            }
            public Geo Scale(float sx, float sy, float sz)
            {
                for (int i = 0; i < v.Count; i++)
                {
                    var a = v[i]; v[i] = new Vector3(a.x * sx, a.y * sy, a.z * sz);
                    var b = n[i]; n[i] = new Vector3(b.x / sx, b.y / sy, b.z / sz).normalized; // normal matrix
                }
                return this;
            }
            public Geo Move(float x, float y, float z)
            {
                var d = new Vector3(x, y, z);
                for (int i = 0; i < v.Count; i++) v[i] += d;
                return this;
            }
            public Geo Rot(int ax, float a)
            {
                float c = Mathf.Cos(a), s = Mathf.Sin(a);
                for (int i = 0; i < v.Count; i++) { v[i] = R(v[i]); n[i] = R(n[i]); }
                return this;
                Vector3 R(Vector3 q) => ax == 0 ? new Vector3(q.x, q.y * c - q.z * s, q.y * s + q.z * c)
                    : ax == 1 ? new Vector3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c)
                    : new Vector3(q.x * c - q.y * s, q.x * s + q.y * c, q.z);
            }
            /// <summary>Orient every triangle so its front (CCW) agrees with its vertex normals.</summary>
            public Geo FixWinding()
            {
                for (int i = 0; i < t.Count; i += 3)
                {
                    Vector3 a = v[t[i]], b = v[t[i + 1]], c = v[t[i + 2]],
                        fn = Vector3.Cross(b - a, c - a), vn = n[t[i]] + n[t[i + 1]] + n[t[i + 2]];
                    if (Vector3.Dot(fn, vn) < 0) { int k = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = k; }
                }
                return this;
            }
            public void Tri(int a, int b, int c) { t.Add(a); t.Add(b); t.Add(c); }
            public int Vert(Vector3 p, Vector3 nn, float u = 0, float w = 0) { v.Add(p); n.Add(nn); uv.Add(new Vector2(u, w)); return v.Count - 1; }
        }

        /// <summary>THREE.SphereGeometry(1, ws, hs).</summary>
        static Geo Sphere(int ws, int hs)
        {
            var g = new Geo();
            for (int iy = 0; iy <= hs; iy++)
            {
                float vv = iy / (float)hs, th = vv * Mathf.PI;
                for (int ix = 0; ix <= ws; ix++)
                {
                    float u = ix / (float)ws, ph = u * 2 * Mathf.PI;
                    var p = new Vector3(-Mathf.Cos(ph) * Mathf.Sin(th), Mathf.Cos(th), Mathf.Sin(ph) * Mathf.Sin(th));
                    g.Vert(p, p, u, 1 - vv);
                }
            }
            int W = ws + 1;
            for (int iy = 0; iy < hs; iy++)
                for (int ix = 0; ix < ws; ix++)
                {
                    int a = iy * W + ix + 1, b = iy * W + ix, c = (iy + 1) * W + ix, d = (iy + 1) * W + ix + 1;
                    if (iy != 0) g.Tri(a, b, d);
                    if (iy != hs - 1) g.Tri(b, c, d);
                }
            return g.FixWinding();
        }
        /// <summary>THREE.LatheGeometry of [radius, y] pairs (normals point outward whichever way the profile runs:
        /// rig3d's limb profiles run top-down, which three lathes inside out).</summary>
        static Geo Lathe(float[,] pr, int seg)
        {
            int np = pr.GetLength(0);
            var g = new Geo();
            var nr = new Vector2[np];
            float sgn = pr[np - 1, 1] >= pr[0, 1] ? 1 : -1;
            Vector2 prev = Vector2.zero;
            for (int j = 0; j < np; j++)
            {
                if (j == np - 1) { nr[j] = prev.normalized; break; }
                float dx = pr[j + 1, 0] - pr[j, 0], dy = pr[j + 1, 1] - pr[j, 1];
                var cur = new Vector2(dy, -dx) * sgn;
                nr[j] = (j == 0 ? cur : cur + prev).normalized;
                prev = cur;
            }
            for (int i = 0; i <= seg; i++)
            {
                float phi = i / (float)seg * 2 * Mathf.PI, s = Mathf.Sin(phi), c = Mathf.Cos(phi);
                for (int j = 0; j < np; j++)
                    g.Vert(new Vector3(pr[j, 0] * s, pr[j, 1], pr[j, 0] * c), new Vector3(nr[j].x * s, nr[j].y, nr[j].x * c).normalized, i / (float)seg, j / (float)(np - 1));
            }
            for (int i = 0; i < seg; i++)
                for (int j = 0; j < np - 1; j++)
                {
                    int a = j + i * np, b = a + np, c = a + np + 1, d = a + 1;
                    g.Tri(a, b, d);
                    g.Tri(c, d, b);
                }
            return g.FixWinding();
        }
        /// <summary>THREE.TorusGeometry(R, r, radial, tubular) (ring in the XY plane).</summary>
        static Geo Torus(float R, float r, int radial, int tubular)
        {
            var g = new Geo();
            for (int j = 0; j <= radial; j++)
                for (int i = 0; i <= tubular; i++)
                {
                    float u = i / (float)tubular * 2 * Mathf.PI, v = j / (float)radial * 2 * Mathf.PI;
                    var p = new Vector3((R + r * Mathf.Cos(v)) * Mathf.Cos(u), (R + r * Mathf.Cos(v)) * Mathf.Sin(u), r * Mathf.Sin(v));
                    var c = new Vector3(R * Mathf.Cos(u), R * Mathf.Sin(u), 0);
                    g.Vert(p, (p - c).normalized);
                }
            for (int j = 1; j <= radial; j++)
                for (int i = 1; i <= tubular; i++)
                {
                    int a = (tubular + 1) * j + i - 1, b = (tubular + 1) * (j - 1) + i - 1, c = (tubular + 1) * (j - 1) + i, d = (tubular + 1) * j + i;
                    g.Tri(a, b, d);
                    g.Tri(b, c, d);
                }
            return g.FixWinding();
        }
        /// <summary>THREE.CylinderGeometry(rt, rb, h, radial) with caps.</summary>
        static Geo Cylinder(float rt, float rb, float h, int radial)
        {
            var g = new Geo();
            float slope = (rb - rt) / h;
            for (int y = 0; y < 2; y++)
                for (int i = 0; i <= radial; i++)
                {
                    float th = i / (float)radial * 2 * Mathf.PI, r = y == 0 ? rt : rb, s = Mathf.Sin(th), c = Mathf.Cos(th);
                    g.Vert(new Vector3(r * s, y == 0 ? h / 2 : -h / 2, r * c), new Vector3(s, slope, c).normalized);
                }
            for (int i = 0; i < radial; i++) { int a = i, b = i + radial + 1; g.Tri(a, b, a + 1); g.Tri(b, b + 1, a + 1); }
            for (int y = 0; y < 2; y++)
            {
                float yy = y == 0 ? h / 2 : -h / 2, r = y == 0 ? rt : rb;
                var nn = new Vector3(0, y == 0 ? 1 : -1, 0);
                int c0 = g.Vert(new Vector3(0, yy, 0), nn);
                for (int i = 0; i <= radial; i++)
                {
                    float th = i / (float)radial * 2 * Mathf.PI;
                    g.Vert(new Vector3(r * Mathf.Sin(th), yy, r * Mathf.Cos(th)), nn);
                }
                for (int i = 0; i < radial; i++) g.Tri(c0, c0 + 1 + i, c0 + 2 + i);
            }
            return g.FixWinding();
        }
        /// <summary>rig3d roundBox: BoxGeometry(w, h, d, 2, 2, 2) with chamfered edges (r = 28% of the thinnest side) and
        /// three's computeVertexNormals (each face's 3x3 grid shares its vertices).</summary>
        static Geo RoundBox(float w, float h, float d)
        {
            var g = new Geo();
            var half = new Vector3(w / 2, h / 2, d / 2);
            float r = Mathf.Min(w, Mathf.Min(h, d)) * 0.28f;
            for (int ax = 0; ax < 3; ax++)
                for (int sd = -1; sd <= 1; sd += 2)
                {
                    int ua = (ax + 1) % 3, va = (ax + 2) % 3, b0 = g.v.Count;
                    for (int j = 0; j <= 2; j++)
                        for (int i = 0; i <= 2; i++)
                        {
                            var p = Vector3.zero;
                            p[ax] = sd * half[ax];
                            p[ua] = (i - 1) * half[ua];
                            p[va] = (j - 1) * half[va];
                            // chamfer: pull the point onto a sphere of radius r around the clamped inner box
                            var cc = new Vector3(Mathf.Clamp(p.x, -half.x + r, half.x - r), Mathf.Clamp(p.y, -half.y + r, half.y - r), Mathf.Clamp(p.z, -half.z + r, half.z - r));
                            var off = p - cc;
                            if (off.sqrMagnitude > 1e-9f) off = off.normalized * r;
                            g.Vert(cc + off, Vector3.zero);
                        }
                    var outw = Vector3.zero;
                    outw[ax] = sd;
                    for (int j = 0; j < 2; j++)
                        for (int i = 0; i < 2; i++)
                        {
                            int a = b0 + j * 3 + i, b = a + 1, c = a + 4, e = a + 3;
                            // orient by the flat face direction, then accumulate area-weighted normals
                            Vector3 pa = Flat(a), pb = Flat(b), pc = Flat(c);
                            bool flip = Vector3.Dot(Vector3.Cross(pb - pa, pc - pa), outw) < 0;
                            if (flip) { g.Tri(a, c, b); g.Tri(a, e, c); } else { g.Tri(a, b, c); g.Tri(a, c, e); }
                        }
                    Vector3 Flat(int k) { int jj = (k - b0) / 3, ii = (k - b0) % 3; var q = Vector3.zero; q[ua] = ii; q[va] = jj; return q; }
                }
            for (int i = 0; i < g.t.Count; i += 3)
            {
                int a = g.t[i], b = g.t[i + 1], c = g.t[i + 2];
                var fn = Vector3.Cross(g.v[b] - g.v[a], g.v[c] - g.v[a]);
                g.n[a] += fn; g.n[b] += fn; g.n[c] += fn;
            }
            for (int i = 0; i < g.n.Count; i++) g.n[i] = g.n[i].sqrMagnitude > 1e-12f ? g.n[i].normalized : Vector3.up;
            return g;
        }
        /// <summary>THREE.PlaneGeometry(w, h) (normal +z) with UVs into a rectangle of the decal atlas.</summary>
        static Geo Plane(float w, float h, Rect uv)
        {
            var g = new Geo();
            var nn = new Vector3(0, 0, 1);
            g.Vert(new Vector3(-w / 2, -h / 2, 0), nn, uv.xMin, uv.yMin);
            g.Vert(new Vector3(w / 2, -h / 2, 0), nn, uv.xMax, uv.yMin);
            g.Vert(new Vector3(w / 2, h / 2, 0), nn, uv.xMax, uv.yMax);
            g.Vert(new Vector3(-w / 2, h / 2, 0), nn, uv.xMin, uv.yMax);
            g.Tri(0, 1, 2);
            g.Tri(0, 2, 3);
            return g;
        }
        static float[,] Pr(params float[] a)
        {
            var r = new float[a.Length / 2, 2];
            for (int i = 0; i < a.Length / 2; i++) { r[i, 0] = a[2 * i]; r[i, 1] = a[2 * i + 1]; }
            return r;
        }

        // ---------------------------------------------------------------- colours
        /// <summary>three's Color(hex) (linear). Vertex colours then take one more sRGB->linear step on purpose (rig3d):
        /// the palette stores these linear values as sRGB texels, so the shader sees linear(linear(hex)).</summary>
        static Color Lin(string hex)
        {
            if (hex == null || !ColorUtility.TryParseHtmlString(hex, out var c)) c = Color.gray;
            return c.linear;
        }
        static Color Shade(Color c, float k) => new Color(Mathf.Clamp01(c.r * k), Mathf.Clamp01(c.g * k), Mathf.Clamp01(c.b * k), 1);
        static bool IsDark(Color c) => c.r * 0.3f + c.g * 0.59f + c.b * 0.11f < 0.45f;

        const int PALN = 64;
        static Texture2D palette;
        static readonly Dictionary<Color32, int> palIdx = new();
        static Vector2 PalUV(Color c)
        {
            if (palette == null)
            {
                palette = new Texture2D(PALN, PALN, TextureFormat.RGBA32, false, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp, name = "RigPalette" };
                var px = new Color32[PALN * PALN];
                for (int i = 0; i < px.Length; i++) px[i] = new Color32(255, 255, 255, 255);
                palette.SetPixels32(px);
            }
            Color32 k = c;
            k.a = 255;
            if (!palIdx.TryGetValue(k, out int i0))
            {
                i0 = Math.Min(palIdx.Count, PALN * PALN - 1);
                palIdx[k] = i0;
                palette.SetPixel(i0 % PALN, i0 / PALN, k);
                palDirty = true;
            }
            return new Vector2((i0 % PALN + 0.5f) / PALN, (i0 / PALN + 0.5f) / PALN);
        }
        static bool palDirty;

        // ---------------------------------------------------------------- materials
        static Shader lit;
        static Material bodyMat;
        static Texture2D knitA, knitN;
        static readonly Dictionary<Color32, Material> jerseyMats = new();
        static Material NewLit(float smooth, float metal)
        {
            if (lit == null) lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(lit);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metal);
            return m;
        }
        static void SetMap(Material m, Texture t)
        {
            m.mainTexture = t;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", t);
        }
        static void SetCol(Material m, Color c)
        {
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
        }
        static Material BodyMat()
        {
            if (bodyMat == null)
            {
                bodyMat = NewLit(0.28f, 0.02f); // roughness .72
                bodyMat.name = "RigBody";
            }
            if (palDirty) { palette.Apply(false); palDirty = false; }
            SetMap(bodyMat, palette);
            return bodyMat;
        }
        /// <summary>Jersey mesh fabric: tiling knit of little ventilation holes (albedo + normal map from the height).</summary>
        static void Knit()
        {
            if (knitA != null) return;
            const int N = 64;
            var hgt = new float[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float hv = 1;
                    for (int j = 0; j < 4; j++)
                        for (int i = 0; i < 4; i++)
                        {
                            float cx = 8 + i * 16 + (j % 2) * 8, cy = 8 + j * 16;
                            for (int wx = -1; wx <= 1; wx++)
                                for (int wy = -1; wy <= 1; wy++)
                                {
                                    float dx = (x + 0.5f - cx - wx * N) / 3.2f, dy = (y + 0.5f - cy - wy * N) / 2.6f, d = Mathf.Sqrt(dx * dx + dy * dy);
                                    hv = Mathf.Min(hv, Mathf.Lerp(0.42f, 1f, Mathf.Clamp01((d - 0.8f) / 0.4f)));
                                }
                        }
                    hgt[y * N + x] = hv;
                }
            knitA = new Texture2D(N, N, TextureFormat.RGBA32, true, false) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 4, name = "Knit" };
            knitN = new Texture2D(N, N, TextureFormat.RGBA32, true, true) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 4, name = "KnitN" };
            var a = new Color32[N * N];
            var nm = new Color32[N * N];
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                {
                    float hv = hgt[y * N + x], g = 0.86f + 0.14f * hv;
                    a[y * N + x] = new Color(g, g, g, 1);
                    float dx = (hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N]) * 1.6f,
                        dy = (hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x]) * 1.6f;
                    var n = new Vector3(-dx, -dy, 1).normalized;
                    // r = x, g = y, b = z, a = 1: decodes right with both the RGB and the RG-or-AG unpack paths
                    nm[y * N + x] = new Color32((byte)(n.x * 127.5f + 127.5f), (byte)(n.y * 127.5f + 127.5f), (byte)(n.z * 127.5f + 127.5f), 255);
                }
            knitA.SetPixels32(a);
            knitA.Apply(true);
            knitN.SetPixels32(nm);
            knitN.Apply(true);
        }
        static Material JerseyMat(Color lin)
        {
            Color32 k = lin;
            if (jerseyMats.TryGetValue(k, out var m)) return m;
            Knit();
            m = NewLit(0.3f, 0.02f);
            m.name = "Jersey";
            SetMap(m, knitA);
            SetCol(m, lin); // = linear(linear(hex)) after Unity's own sRGB->linear on the colour (matches the palette)
            if (m.HasProperty("_BumpMap"))
            {
                m.SetTexture("_BumpMap", knitN);
                m.SetFloat("_BumpScale", 0.6f);
                m.EnableKeyword("_NORMALMAP");
            }
            jerseyMats[k] = m;
            return m;
        }
        static Material DecalMat(Texture2D t)
        {
            var m = NewLit(0.25f, 0f);
            m.name = "JerseyPrint";
            SetMap(m, t);
            SetCol(m, Color.white);
            // alpha-tested (no sorting): URP Lit _AlphaClip + _ALPHATEST_ON
            if (m.HasProperty("_AlphaClip")) m.SetFloat("_AlphaClip", 1);
            if (m.HasProperty("_Cutoff")) m.SetFloat("_Cutoff", 0.5f);
            m.EnableKeyword("_ALPHATEST_ON");
            m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.AlphaTest;
            return m;
        }

        // ---------------------------------------------------------------- jersey prints (tiny bitmap font)
        // 5x7 glyphs, one row per entry, bit 4 = leftmost column
        static readonly Dictionary<char, int[]> FONT = new()
        {
            ['0'] = new[] { 14, 17, 19, 21, 25, 17, 14 }, ['1'] = new[] { 4, 12, 4, 4, 4, 4, 14 }, ['2'] = new[] { 14, 17, 1, 2, 4, 8, 31 },
            ['3'] = new[] { 30, 1, 1, 14, 1, 1, 30 }, ['4'] = new[] { 2, 6, 10, 18, 31, 2, 2 }, ['5'] = new[] { 31, 16, 30, 1, 1, 17, 14 },
            ['6'] = new[] { 6, 8, 16, 30, 17, 17, 14 }, ['7'] = new[] { 31, 1, 2, 4, 8, 8, 8 }, ['8'] = new[] { 14, 17, 17, 14, 17, 17, 14 },
            ['9'] = new[] { 14, 17, 17, 15, 1, 2, 12 }, ['A'] = new[] { 14, 17, 17, 31, 17, 17, 17 }, ['B'] = new[] { 30, 17, 17, 30, 17, 17, 30 },
            ['C'] = new[] { 14, 17, 16, 16, 16, 17, 14 }, ['D'] = new[] { 30, 17, 17, 17, 17, 17, 30 }, ['E'] = new[] { 31, 16, 16, 30, 16, 16, 31 },
            ['F'] = new[] { 31, 16, 16, 30, 16, 16, 16 }, ['G'] = new[] { 14, 17, 16, 23, 17, 17, 15 }, ['H'] = new[] { 17, 17, 17, 31, 17, 17, 17 },
            ['I'] = new[] { 14, 4, 4, 4, 4, 4, 14 }, ['J'] = new[] { 7, 2, 2, 2, 2, 18, 12 }, ['K'] = new[] { 17, 18, 20, 24, 20, 18, 17 },
            ['L'] = new[] { 16, 16, 16, 16, 16, 16, 31 }, ['M'] = new[] { 17, 27, 21, 21, 17, 17, 17 }, ['N'] = new[] { 17, 17, 25, 21, 19, 17, 17 },
            ['O'] = new[] { 14, 17, 17, 17, 17, 17, 14 }, ['P'] = new[] { 30, 17, 17, 30, 16, 16, 16 }, ['Q'] = new[] { 14, 17, 17, 17, 21, 18, 13 },
            ['R'] = new[] { 30, 17, 17, 30, 20, 18, 17 }, ['S'] = new[] { 15, 16, 16, 14, 1, 1, 30 }, ['T'] = new[] { 31, 4, 4, 4, 4, 4, 4 },
            ['U'] = new[] { 17, 17, 17, 17, 17, 17, 14 }, ['V'] = new[] { 17, 17, 17, 17, 17, 10, 4 }, ['W'] = new[] { 17, 17, 17, 21, 21, 21, 10 },
            ['X'] = new[] { 17, 17, 10, 4, 10, 17, 17 }, ['Y'] = new[] { 17, 17, 10, 4, 4, 4, 4 }, ['Z'] = new[] { 31, 1, 2, 4, 8, 16, 31 },
            ['-'] = new[] { 0, 0, 0, 31, 0, 0, 0 }, ['.'] = new[] { 0, 0, 0, 0, 0, 12, 12 }, ['\''] = new[] { 4, 4, 8, 0, 0, 0, 0 },
        };
        /// <summary>Upper-case ASCII for the print (accents dropped: Dončić -> DONCIC).</summary>
        static string Plain(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var d = s.Normalize(System.Text.NormalizationForm.FormD);
            var b = new System.Text.StringBuilder();
            foreach (var ch in d)
                if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark) b.Append(char.ToUpperInvariant(ch));
            return b.ToString();
        }
        /// <summary>Paints white text centred in a pixel rectangle of the alpha buffer (4x4 supersampled, optional italic
        /// shear). Glyph cells are sized to fit both the box width and maxH.</summary>
        static void Text(float[] A, int W, string s, int x0, int y0, int bw, int bh, float maxH, float italic)
        {
            if (s.Length == 0) return;
            float cell = Mathf.Min(maxH / 7f, (bw - 6) / (s.Length * 6f - 1));
            float tw = (s.Length * 6 - 1) * cell, th = 7 * cell, ox = x0 + (bw - tw) / 2, oy = y0 + (bh - th) / 2;
            for (int y = y0; y < y0 + bh; y++)
                for (int x = x0; x < x0 + bw; x++)
                {
                    int hit = 0;
                    for (int sy = 0; sy < 4; sy++)
                        for (int sx = 0; sx < 4; sx++)
                        {
                            float fy = y + (sy + 0.5f) / 4f, fx = x + (sx + 0.5f) / 4f;
                            float ry = (oy + th - fy) / cell; // row from the top
                            float rx = (fx - ox - italic * (fy - oy)) / cell;
                            if (ry < 0 || ry >= 7 || rx < 0) continue;
                            int gi = (int)(rx / 6), col = (int)(rx - gi * 6), row = (int)ry;
                            if (gi >= s.Length || col >= 5) continue;
                            if (FONT.TryGetValue(s[gi], out var gl) && ((gl[row] >> (4 - col)) & 1) != 0) hit++;
                        }
                    if (hit > 0) A[y * W + x] = Mathf.Max(A[y * W + x], hit / 16f);
                }
        }
        // decal atlas (256 x 256): number = left half of the top half, wordmark = second quarter, name = bottom quarter
        static readonly Rect UV_NUM = new Rect(0, 0.5f, 0.5f, 0.5f), UV_WORD = new Rect(0, 0.25f, 1, 0.25f), UV_NAME = new Rect(0, 0, 1, 0.25f);
        static Texture2D PrintTex(string no, string word, string name)
        {
            const int W = 256;
            var A = new float[W * W];
            Text(A, W, no, 0, 128, 128, 128, 84, 0);
            Text(A, W, word, 0, 64, 256, 64, 34, 0.22f);
            Text(A, W, name, 0, 0, 256, 64, 30, 0);
            var px = new Color32[W * W];
            for (int i = 0; i < px.Length; i++) px[i] = new Color32(255, 255, 255, (byte)(A[i] * 255));
            var t = new Texture2D(W, W, TextureFormat.RGBA32, true, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Trilinear, anisoLevel = 4, name = "Print " + name };
            t.SetPixels32(px);
            t.Apply(true, true);
            return t;
        }

        // ---------------------------------------------------------------- build
        struct Blend { public int to; public float from, len, max; public bool end; public bool on; }
        static Blend Bl(int to, float from, float len, bool end, float max = 0.5f) => new Blend { to = to, from = from, len = len, end = end, max = max, on = true };
        sealed class Part { public Geo g; public Color col; public int bone, sub; public Blend b1, b2; }

        static readonly int[] PARENT = { -1, HIPS, HIPS, HIPS, TL, TR, CH, CH, SL, SR, EL, ER, BD, CH, NK, KL, KR, WL, WR, HIPS, HIPS, AL, AR, BD, HD, HD, HD, HD, HD, HD, HD, HD, HD, HD, HD };
        static readonly string[] NAMES = { "hips", "bd", "tl", "tr", "kl", "kr", "sL", "sR", "eL", "eR", "wL", "wR", "ch", "nk", "hd", "al", "ar", "gL", "gR", "flL", "flR", "tfL", "tfR", "hem", "jw", "mi", "mo", "cL", "cR", "brL", "brR", "lL", "lR", "yL", "yR" };
        /// <summary>Rest offsets of every bone from its parent, in three space (rig3d makeRig).</summary>
        static Vector3[] Offsets(float k)
        {
            var R = RIG;
            float HB = (float)(R.chest + R.neck + R.head), F0 = 0.12f;
            Vector3 FB(float x, float y, float z) => new Vector3(x, y - HB, z);
            return new[]
            {
                Vector3.zero, new Vector3(0, (float)R.hip, 0), new Vector3(-(float)R.hipX, (float)R.hip, 0), new Vector3((float)R.hipX, (float)R.hip, 0),
                new Vector3(0, -L1, 0), new Vector3(0, -L1, 0), new Vector3(-(float)R.shX * k, (float)R.sh, 0), new Vector3((float)R.shX * k, (float)R.sh, 0),
                new Vector3(0, -(float)R.ua, 0), new Vector3(0, -(float)R.ua, 0), new Vector3(0, -(float)R.fa, 0), new Vector3(0, -(float)R.fa, 0),
                new Vector3(0, (float)R.chest, 0), new Vector3(0, (float)R.neck, 0), new Vector3(0, (float)R.head, 0),
                new Vector3(0, -L2, 0), new Vector3(0, -L2, 0), new Vector3(0, -(float)R.fing, 0), new Vector3(0, -(float)R.fing, 0),
                new Vector3(-(float)R.hipX, (float)R.hip, 0), new Vector3((float)R.hipX, (float)R.hip, 0),
                new Vector3(0, -0.16f, 0.36f), new Vector3(0, -0.16f, 0.36f), new Vector3(0, -0.05f, 0),
                FB(0, 2.64f, 0.02f), FB(0, 2.556f, 0.31f), FB(0, 2.565f, 0.365f), FB(-0.08f, 2.562f, 0.36f), FB(0.08f, 2.562f, 0.36f),
                FB(-F0 - 0.01f, 2.9f, 0.34f), FB(F0 + 0.01f, 2.9f, 0.34f), FB(-F0 - 0.01f, 2.852f, 0.33f), FB(F0 + 0.01f, 2.852f, 0.33f),
                FB(-F0 - 0.01f, 2.8f, 0.355f), FB(F0 + 0.01f, 2.8f, 0.355f),
            };
        }

        /// <summary>Cached per-look meshes and print materials (a rematch or a returning sub rebuilds only the bones).</summary>
        sealed class Look { public Mesh mesh; public Material[] mats; }
        static readonly Dictionary<string, Look> looks = new();

        static string Key(Player p) => $"{p.n}|{p.col}|{p.skin}|{p.no}|{p.hr}|{p.bd}|{p.bk}|{(p.tm >= 0 && p.tm < 2 ? Sim.cl[(int)p.tm] : "")}|{p.sg?.hs}";

        public static PlayerRig Build(Player p, Transform parent)
        {
            var r = new PlayerRig { p = p };
            float k = (float)p.bk;
            var off = Offsets(k);
            r.go = new GameObject("Rig " + p.n);
            r.G = r.go.transform;
            r.G.SetParent(parent, false);
            for (int i = 0; i < NB; i++)
            {
                var t = new GameObject(NAMES[i]).transform;
                t.SetParent(PARENT[i] < 0 ? r.G : r.bn[PARENT[i]], false);
                var o = off[i];
                t.localPosition = new Vector3(o.x, o.y, -o.z);
                r.bn[i] = t;
            }
            string key = Key(p);
            if (!looks.TryGetValue(key, out var look))
            {
                look = new Look();
                look.mesh = MakeMesh(p, off, out var jersey, out var print);
                var bp = new Matrix4x4[NB];
                for (int i = 0; i < NB; i++) bp[i] = r.bn[i].worldToLocalMatrix * r.G.localToWorldMatrix;
                look.mesh.bindposes = bp;
                look.mats = new[] { BodyMat(), JerseyMat(jersey), DecalMat(print) };
                looks[key] = look;
            }
            else BodyMat();
            var smr = r.smr = r.go.AddComponent<SkinnedMeshRenderer>();
            smr.sharedMesh = look.mesh;
            smr.bones = r.bn;
            smr.rootBone = r.bn[HIPS];
            smr.sharedMaterials = look.mats;
            smr.localBounds = new Bounds(new Vector3(0, 3.6f, 0), new Vector3(9, 10, 9));
            smr.updateWhenOffscreen = false;
            smr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            smr.receiveShadows = true;
            smr.quality = SkinQuality.Bone4;
            for (int s = 0; s < 8; s++) r.fr[s] = r.bn[CL + s].localPosition;
            r.FaceRest();
            r.G.localScale = Vector3.one * (float)(p.ht / 6.4);
            return r;
        }

        public void Destroy()
        {
            if (go != null) UnityEngine.Object.Destroy(go);
            go = null;
        }

        static Mesh MakeMesh(Player p, Vector3[] off, out Color jersey, out Texture2D print)
        {
            float k = (float)p.bk;
            // bone rest positions (three model space)
            var bp = new Vector3[NB];
            for (int i = 0; i < NB; i++) bp[i] = (PARENT[i] < 0 ? Vector3.zero : bp[PARENT[i]]) + off[i];
            var parts = new List<Part>();
            void put(Geo g0, Color col, int bone, float x, float y, float z, float sx = 1, float sy = 1, float sz = 1, Blend b1 = default, Blend b2 = default, int sub = 0)
            {
                var g = g0.Clone().Scale(sx, sy, sz).Move(x + bp[bone].x, y + bp[bone].y, z + bp[bone].z);
                parts.Add(new Part { g = g, col = col, bone = bone, b1 = b1, b2 = b2, sub = sub });
            }
            // place by the position relative to the PELVIS bone (rig3d putT)
            void putT(Geo g0, Color col, int bone, float x, float y, float z, float sx = 1, float sy = 1, float sz = 1)
                => put(g0, col, bone, x - bp[bone].x, y - (bp[bone].y - bp[BD].y), z - bp[bone].z, sx, sy, sz);
            Geo limb(int seg, params float[] pr) => Lathe(Pr(pr), seg);
            // spheres: three's 24 x 16 for the big parts, fewer segments for small features (same shapes)
            Geo s24 = Sphere(24, 16), s16 = Sphere(16, 10), s10 = Sphere(10, 6);
            Geo sph(float m) => m >= 0.2f ? s24 : m >= 0.08f ? s16 : s10;
            void putS(Color col, int bone, float x, float y, float z, float sx, float sy, float sz) => putT(sph(Mathf.Max(sx, Mathf.Max(sy, sz))), col, bone, x, y, z, sx, sy, sz);
            Geo box(float w, float h, float d) => RoundBox(w, h, d);
            Geo ring(float r2, float t) => Torus(r2, t, 6, 24).Rot(0, Mathf.PI / 2);

            Color sk = Lin(p.skin), col = Lin(p.col);
            jersey = col;
            Color hc = Lin(string.Equals(p.skin, "#e8b88f", StringComparison.OrdinalIgnoreCase) ? "#3d2a18" : "#121212");
            // personal style (deterministic per player, rig3d's name hash)
            uint h = 0;
            var nm = p.n ?? "";
            for (int i = 0; i < nm.Length; i++)
            {
                h = unchecked(h * 31 + nm[i]);
                if (char.IsHighSurrogate(nm[i])) i++; // JS for-of walks code points, charCodeAt(0) = the high surrogate
            }
            Color trim = Lin(IsDark(col) ? "#f2f2f2" : "#16161c");
            uint shoeKind = h % 4;
            Color shoe = shoeKind == 1 ? col : shoeKind == 2 ? Lin("#141414") : Lin("#f6f6f6"),
                sole = shoeKind == 2 ? Lin("#202020") : Lin("#f4f4f4"),
                accent = h % 2 != 0 ? col : Lin("#e8541e"),
                sock = h % 5 == 0 ? Lin("#141414") : Lin("#f4f4f4"),
                white = Lin("#f8f8f8");
            bool headband = h % 7 == 0, hasSleeve = h % 4 == 1;
            Color sleeve = h % 8 < 4 ? Lin("#141414") : Lin("#f2f2f2");

            // ---- legs ----
            for (int s = 0; s < 2; s++)
            {
                int t = s == 0 ? TL : TR, kn = s == 0 ? KL : KR, fb = s == 0 ? FLL : FLR, an = s == 0 ? AL : AR, tfb = s == 0 ? TFL : TFR;
                float sd = s == 0 ? -1 : 1;
                put(limb(16, 0f, 0.05f, 0.25f, 0f, 0.27f, -0.4f, 0.25f, -0.9f, 0.19f, -1.45f, 0.17f, -1.62f, 0f, -1.66f), sk, t, 0, 0, 0, b1: Bl(kn, -L1, 0.45f, true));
                var flap = Bl(fb, -0.86f, 0.62f, true, 0.85f);
                put(limb(18, 0f, 0.12f, 0.34f * k, 0.1f, 0.37f * k, -0.4f, 0.39f * k, -0.86f, 0f, -0.88f), col, t, 0, 0, 0, b1: flap);
                put(box(0.05f, 0.8f, 0.16f), trim, t, sd * 0.37f * k, -0.42f, 0, b1: flap);
                put(limb(16, 0f, 0.08f, 0.16f, 0.05f, 0.17f, -0.25f, 0.19f, -0.5f, 0.15f, -0.95f, 0.11f, -1.35f, 0f, -1.42f), sk, kn, 0, 0, -0.02f, b1: Bl(t, 0, 0.4f, false));
                put(limb(12, 0.13f, -1.12f, 0.135f, -1.48f, 0f, -1.5f), sock, kn, 0, 0, 0);
                put(box(0.39f, 0.27f, 0.82f), shoe, an, 0, 0, 0.14f);
                put(box(0.41f, 0.07f, 0.85f), sole, an, 0, -0.13f, 0.14f);
                put(box(0.4f, 0.035f, 0.86f), Shade(sole, 0.55f), an, 0, -0.18f, 0.14f);
                put(box(0.36f, 0.1f, 0.24f), shoeKind == 3 ? col : Shade(shoe, 0.88f), tfb, 0, 0.12f, 0.11f);
                put(box(0.06f, 0.13f, 0.46f), shoeKind == 3 ? col : accent, an, sd * 0.2f, 0.02f, 0.12f);
                put(box(0.22f, 0.16f, 0.07f), accent, an, 0, 0.08f, -0.27f);
                for (int li = 0; li < 3; li++) put(box(0.2f, 0.025f, 0.035f), white, an, 0, 0.14f - li * 0.012f, 0.26f + li * 0.09f);
            }
            // ---- torso (jersey fabric submesh): pelvis below the waist, chest above, hem on its spring bone ----
            var torso = Lathe(Pr(0f, -0.5f, 0.86f, -0.47f, 0.92f, 0.1f, 0.97f, 0.7f, 1.06f, 1.15f, 1.0f, 1.42f, 0.66f, 1.6f, 0f, 1.64f), 24);
            for (int i = 0; i < torso.uv.Count; i++) torso.uv[i] = new Vector2(torso.uv[i].x * 40, torso.uv[i].y * 26); // knit tiling
            put(torso, col, BD, 0, 0.3f, 0, 0.62f * k, 1, 0.42f * k, Bl(CH, 1.25f, 0.6f, false, 1), Bl(HEM, 0.05f, 0.35f, true, 0.7f), 1);
            putT(ring(0.3f, 0.05f), trim, CH, 0, 1.9f, 0.03f, 1, 1, 0.9f); // collar
            for (int s = -1; s <= 1; s += 2) put(box(0.05f, 1.55f, 0.3f * k), trim, BD, s * 0.6f * k, 0.75f, 0, b1: Bl(CH, 1.25f, 0.6f, false, 1)); // side panels
            put(Torus(0.56f * k, 0.06f, 6, 28).Rot(0, Mathf.PI / 2), trim, BD, 0, -0.12f, 0, 1, 1, 0.72f); // waistband
            for (int s = -1; s <= 1; s += 2) putT(Torus(0.29f * k, 0.045f, 6, 20).Rot(1, Mathf.PI / 2), trim, CH, s * 0.86f * k * 0.95f, 1.78f, 0); // armholes
            putT(limb(16, 0f, 0f, 0.16f, -0.02f, 0.15f, 0.35f, 0f, 0.38f), sk, NK, 0, 2.02f, 0); // neck
            // ---- head: per-player face from the name (stylised, no likenesses) ----
            uint fh = h ^ 0x9e3779b9;
            float fr() { fh = unchecked((fh ^ (fh >> 15)) * 2246822507u); return fh % 1000 / 1000f; }
            float Fw = 0.92f + fr() * 0.16f, Fjw = 0.9f + fr() * 0.25f, Fjl = 0.9f + fr() * 0.25f, Fnw = 0.85f + fr() * 0.45f, Fnl = 0.85f + fr() * 0.35f,
                Feg = 0.12f + fr() * 0.03f, Fbr = 0.03f + fr() * 0.03f, Fba = (fr() - 0.5f) * 0.25f, Fea = 0.85f + fr() * 0.35f, Flp = 0.8f + fr() * 0.5f;
            var sf = p.sg?.face;
            if (sf != null)
            {
                Fw = (float)(sf.w ?? Fw); Fjw = (float)(sf.jw ?? Fjw); Fjl = (float)(sf.jl ?? Fjl); Fnw = (float)(sf.nw ?? Fnw); Fnl = (float)(sf.nl ?? Fnl);
                Feg = (float)(sf.eg ?? Feg); Fbr = (float)(sf.br ?? Fbr); Fba = (float)(sf.ba ?? Fba); Fea = (float)(sf.ea ?? Fea); Flp = (float)(sf.lp ?? Flp);
            }
            putS(sk, HD, 0, 2.74f, 0, 0.36f * Fw, 0.43f, 0.39f); // skull
            putS(sk, JW, 0, 2.55f - (Fjl - 1) * 0.05f, 0.08f, 0.27f * Fjw, 0.22f * Fjl, 0.3f); // jaw (opens on its hinge)
            putS(Lin("#3a1416"), MI, 0, 2.5f, 0.315f, 0.072f, 0.056f, 0.05f); // mouth interior
            putT(box(0.11f, 0.022f, 0.02f), Lin("#f2efe6"), MI, 0, 2.548f, 0.352f); // upper teeth
            putT(box(0.1f, 0.02f, 0.02f), Lin("#e8e4da"), MI, 0, 2.452f, 0.345f); // lower teeth
            for (int s = -1; s <= 1; s += 2)
            {
                int yb = s < 0 ? YL : YR;
                putS(sk, HD, s * 0.36f * Fw, 2.72f, 0, 0.07f * Fea, 0.11f * Fea, 0.07f); // ear
                putS(white, HD, s * Feg, 2.8f, 0.33f, 0.065f, 0.05f, 0.03f); // eye white
                putS(Lin("#1a1410"), yb, s * Feg, 2.8f, 0.355f, 0.035f, 0.035f, 0.02f); // iris
                putS(Lin("#ffffff"), yb, s * Feg + 0.012f, 2.812f, 0.372f, 0.009f, 0.009f, 0.006f); // catchlight
                putT(box(0.15f, Fbr, 0.05f).Rot(2, -s * Fba), hc, s < 0 ? BRL : BRR, s * Feg, 2.9f, 0.34f); // brow
                putS(Shade(sk, 0.86f), s < 0 ? LL : LR, s * Feg, 2.8f, 0.338f, 0.072f, 0.056f, 0.036f); // closing lid
            }
            putS(Shade(sk, 0.9f), HD, 0, 2.7f, 0.38f, 0.06f * Fnw, 0.09f * Fnl, 0.07f); // nose
            putT(box(0.13f, 0.03f, 0.03f), Shade(sk, 0.55f), MO, 0, 2.565f, 0.365f); // mouth line
            for (int s = -1; s <= 1; s += 2) putT(box(0.06f, 0.028f, 0.03f), Shade(sk, 0.5f), s < 0 ? CL : CR, s * 0.085f, 2.563f, 0.36f); // corners
            putT(box(0.13f, 0.025f * Flp, 0.03f), Shade(sk, 0.75f), JW, 0, 2.54f, 0.36f); // lower lip
            for (int s = -1; s <= 1; s += 2)
            {
                putT(box(0.13f, 0.025f, 0.03f), Shade(sk, 0.78f), HD, s * Feg, 2.835f, 0.335f); // upper eyelid
                putS(Shade(sk, 1.05f), HD, s * 0.2f * Fw, 2.68f, 0.27f, 0.09f, 0.07f, 0.07f); // cheekbone
            }
            putS(Shade(sk, 0.96f), JW, 0, 2.43f - (Fjl - 1) * 0.06f, 0.2f, 0.13f * Fjw, 0.09f, 0.12f); // chin
            // hair: cap high and back so the hairline frames the forehead
            int sub = p.sg != null && p.sg.hs.HasValue ? (int)p.sg.hs.Value : ((int)h >> 3) % 3;
            int hr = (int)p.hr;
            if (hr == 1)
            {
                putS(hc, HD, 0, 2.95f, -0.08f, 0.385f * Fw, 0.3f, 0.415f);
                if (sub == 0) putS(Shade(hc, 1.35f), HD, 0, 2.78f, -0.1f, 0.37f * Fw, 0.17f, 0.37f); // faded sides
                if (sub == 1) for (int w = 0; w < 3; w++) putT(ring(0.2f + w * 0.06f, 0.012f), Shade(hc, 1.6f), HD, 0, 3.2f - w * 0.03f, -0.06f + w * 0.01f); // waves
                if (sub == 2) putT(box(0.02f, 0.03f, 0.3f), Shade(sk, 0.85f), HD, 0.14f, 3.22f, 0); // part line
            }
            if (hr == 2)
            {
                putS(hc, HD, 0, 2.98f, -0.08f, 0.41f * Fw, 0.34f, 0.44f);
                putS(hc, HD, 0, 2.82f, -0.2f, 0.4f * Fw, 0.32f, 0.3f); // back volume
                putT(box(0.5f, 0.08f, 0.1f), hc, HD, 0, 3.08f, 0.22f); // swept fringe
                if (p.sg != null && p.sg.hs == 1)
                {
                    var lk = Cylinder(0.05f, 0.035f, 0.85f, 6);
                    for (int d = 0; d < 9; d++)
                    {
                        float a = Mathf.PI * (0.25f + d / 8f * 1.5f);
                        putT(lk, hc, HD, Mathf.Cos(a) * 0.36f, 2.5f, -Mathf.Abs(Mathf.Sin(a)) * 0.34f - 0.04f);
                    }
                }
            }
            if (hr == 3)
            {
                putS(hc, HD, 0, 3.02f, -0.06f, 0.52f * Fw, 0.48f, 0.52f);
                putS(Shade(hc, 1.15f), HD, 0, 3.16f, -0.04f, 0.42f, 0.3f, 0.42f);
            }
            if (p.bd != 0)
            {
                putS(hc, JW, 0, 2.46f - (Fjl - 1) * 0.05f, 0.16f, 0.29f * Fjw, 0.15f * Fjl, 0.2f); // jawline beard
                for (int s = -1; s <= 1; s += 2) putS(hc, HD, s * 0.25f * Fjw, 2.6f, 0.14f, 0.07f, 0.14f, 0.14f); // sideburns
                putT(box(0.22f, 0.045f, 0.05f), hc, HD, 0, 2.61f, 0.37f); // mustache
            }
            if (headband) putT(ring(0.375f, 0.05f), accent, HD, 0, 2.94f, 0, 1, 1, 1.05f);
            // ---- arms ----
            for (int s = 0; s < 2; s++)
            {
                int s2 = s == 0 ? SL : SR, e = s == 0 ? EL : ER, w = s == 0 ? WL : WR, fg = s == 0 ? GL : GR;
                float sd = s == 0 ? -1 : 1;
                Color arm = hasSleeve && sd < 0 ? sleeve : sk;
                put(s24, sk, s2, 0, -0.02f, 0, 0.25f * k, 0.27f, 0.25f * k); // deltoid
                put(limb(16, 0f, 0f, 0.16f * k, -0.05f, 0.17f * k, -0.4f, 0.13f * k, -0.85f, 0.12f * k, -1.04f, 0f, -1.08f), arm, s2, 0, 0, 0, b1: Bl(e, -1.02f, 0.35f, true));
                put(limb(16, 0f, 0.04f, 0.13f * k, 0f, 0.14f * k, -0.3f, 0.1f * k, -0.9f, 0f, -0.98f), arm, e, 0, 0, 0, b1: Bl(s2, 0, 0.3f, false));
                put(box(0.18f, 0.2f, 0.1f), sk, w, 0, -0.12f, 0.02f); // palm
                put(box(0.17f, 0.16f, 0.07f), Shade(sk, 0.94f), fg, 0, -0.08f, 0.035f); // fingers
                put(box(0.06f, 0.14f, 0.06f), sk, w, -sd * 0.1f, -0.12f, 0.07f); // thumb
            }
            // ---- jersey prints: number back + front, wordmark, name (rigid on the chest bone, chest-local offsets) ----
            string no = p.no.ToString("0"), word = Plain(p.tm >= 0 && p.tm < 2 ? Sim.cl[(int)p.tm] : ""), last = Plain(nm);
            int sp = last.LastIndexOf(' ');
            if (sp >= 0) last = last.Substring(sp + 1);
            if (word.Length > 10) word = word.Substring(0, 10);
            if (last.Length > 11) last = last.Substring(0, 11);
            print = PrintTex(no, word, last);
            float cy = -(float)RIG.chest;
            Color pw = Color.white;
            put(Plane(0.8f, 0.8f, UV_NUM).Rot(1, Mathf.PI), pw, CH, 0, 1.35f + cy, -0.47f * k, sub: 2);
            put(Plane(0.95f, 0.24f, UV_WORD), pw, CH, 0, 1.72f + cy, 0.465f * k, sub: 2);
            put(Plane(0.45f, 0.45f, UV_NUM), pw, CH, 0, 1.4f + cy, 0.47f * k, sub: 2);
            put(Plane(1.4f, 0.35f, UV_NAME).Rot(1, Mathf.PI), pw, CH, 0, 1.88f + cy, -0.46f * k, sub: 2);

            // ---- merge: skin weights (rig3d's eased two-bone blends), palette UVs, mirror into Unity's frame ----
            var V = new List<Vector3>();
            var N = new List<Vector3>();
            var UV = new List<Vector2>();
            var BW = new List<BoneWeight>();
            var T = new[] { new List<int>(), new List<int>(), new List<int>() };
            foreach (var pt in parts)
            {
                int b0 = V.Count;
                var g = pt.g;
                Vector2 puv = pt.sub == 0 ? PalUV(pt.col) : Vector2.zero;
                for (int i = 0; i < g.v.Count; i++)
                {
                    float ly = g.v[i].y - bp[pt.bone].y, w2 = 0, w3 = 0;
                    if (pt.b1.on)
                    {
                        var b = pt.b1;
                        float u = Mathf.Clamp01(b.end ? (b.from + b.len - ly) / b.len : (ly - (b.from - b.len)) / b.len);
                        w2 = b.max * u * u * (3 - 2 * u);
                    }
                    if (pt.b2.on)
                    {
                        var b = pt.b2;
                        float u = Mathf.Clamp01((b.from + b.len - ly) / b.len);
                        w3 = b.max * u * u * (3 - 2 * u) * (1 - w2);
                    }
                    BW.Add(new BoneWeight
                    {
                        boneIndex0 = pt.bone, weight0 = 1 - w2 - w3,
                        boneIndex1 = pt.b1.on ? pt.b1.to : 0, weight1 = w2,
                        boneIndex2 = pt.b2.on ? pt.b2.to : 0, weight2 = w3,
                    });
                    var v = g.v[i];
                    var n = g.n[i];
                    V.Add(new Vector3(v.x, v.y, -v.z));
                    N.Add(new Vector3(n.x, n.y, -n.z));
                    UV.Add(pt.sub == 0 ? puv : g.uv[i]);
                }
                var tl = T[pt.sub];
                foreach (int ix in g.t) tl.Add(ix + b0);
            }
            var mesh = new Mesh { name = "Player " + nm };
            if (V.Count > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(V);
            mesh.SetNormals(N);
            mesh.SetUVs(0, UV);
            mesh.boneWeights = BW.ToArray();
            mesh.subMeshCount = 3;
            for (int s = 0; s < 3; s++) mesh.SetTriangles(T[s], s);
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            mesh.UploadMeshData(false);
            return mesh;
        }

        // ---------------------------------------------------------------- per frame
        /// <summary>Joint angles (p.q) -> bone rotations (rig3d applyPose; same mapping as Core Pose.skeleton/handPos).</summary>
        public void ApplyPose(Player p)
        {
            var q = p.q;
            if (q == null) return;
            G.localPosition = new Vector3((float)((p.x - 470) * 0.1), (float)(p.z * 0.1 - q.cr * 0.4), -(float)((p.y - 250) * 0.1));
            G.localRotation = AY(-(float)(Math.PI / 2 - fv(p)));
            thx[0] = -(float)q.tL; thz[0] = (float)hipAb(q, -1);
            thx[1] = -(float)q.tR; thz[1] = (float)hipAb(q, 1);
            knx[0] = (float)q.kL; knx[1] = (float)q.kR;
            anx[0] = (float)q.fL; anx[1] = (float)q.fR;
            for (int s = 0; s < 2; s++)
            {
                bn[TL + s].localRotation = E(thx[s], 0, thz[s], XYZ);
                bn[KL + s].localRotation = EX(knx[s]);
                bn[AL + s].localRotation = EX(anx[s]);
                bn[TFL + s].localRotation = EX(-Mathf.Max(0, anx[s] - 0.15f) * 0.8f); // toe-off: toes stay down
            }
            bn[CH].localRotation = E((float)q.cx, (float)q.cy, 0, YXZ);
            bn[NK].localRotation = EX((float)q.nk);
            bn[HD].localRotation = E((float)q.hp, (float)q.hy, 0, YXZ);
            bn[GL].localRotation = EX(-(float)q.gL * 1.4f);
            bn[GR].localRotation = EX(-(float)q.gR * 1.4f);
            // shoulders XZY: the humeral twist (hL/hR) turns about the upper-arm bone itself
            bn[SL].localRotation = E(-(float)q.aL, (float)q.hL, -(float)q.zL, XZY);
            bn[SR].localRotation = E(-(float)q.aR, -(float)q.hR, (float)q.sz, XZY);
            bn[EL].localRotation = EX(-(float)q.eL);
            bn[ER].localRotation = EX(-(float)q.eR);
            bn[WL].localRotation = E(-(float)q.wL, (float)q.oL, 0, YXZ); // forearm twist then wrist flex
            bn[WR].localRotation = E(-(float)q.wR, (float)q.oR, 0, YXZ);
            bdx = (float)q.ln; bdz = (float)q.rz;
            bn[BD].localRotation = E(bdx, (float)q.ty, bdz, YXZ);
            ApplyFace(p.fc);
        }

        /// <summary>Face at rest: mouth closed, closing lids folded up into the upper eyelid line.</summary>
        void FaceRest()
        {
            bn[MI].localScale = new Vector3(1, 0.001f, 1);
            bn[LL].localScale = bn[LR].localScale = new Vector3(1, 0.02f, 1);
            bn[JW].localRotation = Quaternion.identity;
            bn[MO].localScale = Vector3.one;
            for (int s = 0; s < 8; s++) { bn[CL + s].localPosition = fr[s]; if (s < 4) bn[CL + s].localRotation = Quaternion.identity; }
        }
        /// <summary>Expressions (p.fc from Core face(): jaw, smile, brows, anger, squint, blink, width, eye look) -> face bones.</summary>
        void ApplyFace(FaceState c)
        {
            if (c == null) { FaceRest(); return; }
            float jw = (float)c.jw, sm = (float)c.sm, smp = Mathf.Max(0, sm), wd = (float)c.wd, br = (float)c.br, an = (float)c.an;
            bn[JW].localRotation = EX(jw * 0.3f + smp * 0.05f);
            bn[MI].localScale = new Vector3(1 + wd * 0.25f + smp * 0.2f, Mathf.Max(0.001f, Mathf.Max(jw * 0.95f, smp * 0.32f)), 1);
            bn[MO].localScale = new Vector3(1 + wd * 0.3f + smp * 0.25f + Mathf.Min(0, sm) * 0.15f, 1, 1);
            float lid = Mathf.Max((float)c.bl, Mathf.Max((float)c.sq * 0.5f, smp * 0.22f));
            for (int s = 0; s < 2; s++)
            {
                float sd = s == 1 ? 1 : -1;
                var r0 = fr[s];
                bn[CL + s].localPosition = new Vector3(r0.x + sd * (wd * 0.025f + smp * 0.035f), r0.y + sm * (sm > 0 ? 0.014f : 0.034f), r0.z - smp * 0.006f);
                bn[CL + s].localRotation = AZ(sd * sm * 0.7f);
                var r1 = fr[2 + s];
                bn[BRL + s].localPosition = new Vector3(r1.x, r1.y + br * 0.035f - an * 0.02f, r1.z);
                bn[BRL + s].localRotation = AZ(sd * (an * 0.38f - br * 0.22f));
                bn[LL + s].localScale = new Vector3(1, Mathf.Max(0.02f, lid), 1);
                var r3 = fr[6 + s];
                bn[YL + s].localPosition = new Vector3(r3.x + (float)c.ex * 0.035f, r3.y - (float)c.ey * 0.03f, r3.z);
            }
        }

        /// <summary>Foot planting (rig3d footIK): a stance foot stays where it touched down; two-bone IK in the leg's
        /// sagittal plane reaches it. Fades with the core stepper's own weight (p.stp.w), which already plants feet.</summary>
        public void FootIK(Player p, float dt, bool on)
        {
            bool grounded = on && p.z < 1.5 && (p.mode == "i" || p.mode == "b") && !Util.T(p.postA);
            double sp = Util.Hypot(p.vx, p.vy);
            float stw = p.stp != null ? (float)p.stp.w : 0;
            for (int s = 0; s < 2; s++)
            {
                Transform th = bn[TL + s], kn = bn[KL + s], an = bn[AL + s];
                bool stance = grounded && (sp < 25 || (s == 1 ? Math.Cos(p.ph) > 0.15 : Math.Cos(p.ph) < -0.15));
                var V1 = kn.TransformPoint(0, -L2, 0); // FK ankle (world)
                if (stance && !plOn[s]) { plOn[s] = true; plP[s] = new Vector3(V1.x, Mathf.Min(V1.y, 0.25f), V1.z); }
                if (!stance) plOn[s] = false;
                if (plOn[s] && Mathf.Sqrt((V1.x - plP[s].x) * (V1.x - plP[s].x) + (V1.z - plP[s].z) * (V1.z - plP[s].z)) > 1.4f) plOn[s] = false;
                plW[s] += ((plOn[s] ? 1 : 0) - plW[s]) * Mathf.Min(1, dt * 14);
                if (plW[s] < 0.02f) continue;
                var V2 = th.parent.InverseTransformPoint(plP[s]) - th.localPosition; // hip -> target, parent-local
                float dy = V2.y, dz = -V2.z, // back to three's +z
                    d = Mathf.Min(L1 + L2 - 0.01f, Mathf.Max(0.4f, Mathf.Sqrt(dy * dy + dz * dz)));
                float a1 = Mathf.Acos(Mathf.Clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)),
                    tIK = Mathf.Atan2(dz, -dy) + a1,
                    kIK = Mathf.PI - Mathf.Acos(Mathf.Clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
                float w = plW[s] * (1 - stw), tFK = -thx[s], kFK = knx[s];
                thx[s] = -(tFK + (tIK - tFK) * w);
                knx[s] = kFK + (kIK - kFK) * w;
                float flat = -(thx[s] + knx[s]);
                anx[s] += (flat - anx[s]) * w; // planted foot stays flat
                th.localRotation = E(thx[s], 0, thz[s], XYZ);
                kn.localRotation = EX(knx[s]);
                an.localRotation = EX(anx[s]);
            }
        }

        /// <summary>Shorts-hem flap bones chase their thigh through an underdamped spring (trail, overshoot, lift while
        /// falling); the jersey hem lags the pelvis. Purely visual (rig3d clothStep).</summary>
        public void ClothStep(Player p, float dt)
        {
            float h = Mathf.Min(dt, 1 / 30f);
            if (h <= 0) return;
            bool air = p.z > 2;
            float vz = (float)p.vz;
            for (int s = 0; s < 2; s++)
            {
                float tx = thx[s] + (air ? Mathf.Clamp(-vz * 0.0012f, -0.25f, 0.25f) : 0), tz = thz[s];
                for (int it = 0; it < 2; it++)
                {
                    cvx[s] += ((tx - cx[s]) * 220 - cvx[s] * 13) * (h / 2);
                    cvz[s] += ((tz - cz[s]) * 220 - cvz[s] * 13) * (h / 2);
                    cx[s] += cvx[s] * (h / 2);
                    cz[s] += cvz[s] * (h / 2);
                }
                if (Mathf.Abs(cx[s] - tx) > 1.2f) { cx[s] = tx; cvx[s] = 0; } // teleports
                bn[FLL + s].localRotation = E(cx[s], 0, cz[s], XYZ);
            }
            hvx += (-(bdx - hpx) / h) * 0.35f + ((air ? Mathf.Clamp(-vz * 0.002f, -0.3f, 0.3f) : 0) - hx) * 180 * h - hvx * 11 * h;
            hvz += (-(bdz - hpz) / h) * 0.35f + -hz * 180 * h - hvz * 11 * h;
            hpx = bdx;
            hpz = bdz;
            hx = Mathf.Clamp(hx + hvx * h, -0.5f, 0.5f);
            hz = Mathf.Clamp(hz + hvz * h, -0.5f, 0.5f);
            bn[HEM].localRotation = E(hx, 0, hz, XYZ);
        }

        /// <summary>World position of the shooting palm (the ball while holding): right wrist, the left while a lefty's
        /// shot is mirrored (q.mir). Same point as Core Pose.handPos.</summary>
        public Vector3 Palm(Player p) => bn[p.q != null && Util.T(p.q.mir) ? WL : WR].TransformPoint(0, -0.62f, -0.1f);
    }
}
