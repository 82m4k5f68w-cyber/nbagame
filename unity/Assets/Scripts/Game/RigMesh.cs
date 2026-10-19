// Player body / face / uniform geometry, port of src/client/rig3d.ts makeRig + src/client/look.ts (same lofted
// anatomy, same per-face painting, same deterministic look per name). UnityEngine-free on purpose: Rig.cs turns the
// result into a skinned Mesh, and unity/CoreTests/RigMeshCheck.cs runs it on plain .NET (arms present, weighted to the
// arm bones, inside the renderer bounds, triangle budget).
// Everything here is in three.js space (right-handed, +z = the player's front); Rig.cs mirrors z when it builds the Mesh.
using System;
using System.Collections.Generic;
using Hoops.Core;
using V3 = System.Numerics.Vector3;

namespace Hoops.Game
{
    /// <summary>Deterministic personal look (look.ts lookOf / faceOf).</summary>
    public sealed class RigLook
    {
        public uint h;
        public string hc, eye, sec, trim, sock, sleeveC, wristC, kneeC, tightsC, bandC;
        public int hair, beard, shoeCut, sleeve, wrist, knee, tights, tape;
        public double sockH;
        public bool band;
        public string[] shoe;
        // face proportions
        public double w, jw, jl, nw, nl, eg, br, ba, ea, lp, es, nb, ck, ch, fh;

        const string SEC = "7b3fb5:fdb927,1d428a:ffc72c,0e2240:fec524,007ac1:ef3b24,6b7078:111111,236192:78be20,006bb6:f58426,007a33:ffffff,00471b:eee1c6,00538c:b8c4ca,860038:fdbb30,ce1141:c4ced4,c8102e:1d42ba,0077c0:c4ced4";
        const string SHOES = "#f6f6f6 T #f4f4f4 #d8d8d8 #f8f8f8|#141414 #f4f4f4 #f4f4f4 #1a1a1a #141414|T #f6f6f6 #f4f4f4 #f0f0f0 #f6f6f6|#f6f6f6 S #f4f4f4 #8a5a32 #f6f6f6|#141414 T #141414 #141414 #141414|#f6f6f6 #e8541e #f4f4f4 #e8541e #f6f6f6|S T #f6f6f6 #e6e6e6 #f6f6f6|#d9e021 #141414 #f4f4f4 #141414 #141414|#f6f6f6 #141414 #f4f4f4 #8a5a32 #141414|#c4ced4 T #f4f4f4 #3a3a3a #f6f6f6";
        const string HAIRL = "#3d2a18 #2a1c10 #5a3a1e #8a6a3c #1c1410 #4a2e1a";
        const string HAIRD = "#121212 #1a1410 #0e0e0e #161210";
        const string EYEL = "#3b2414 #4a6a8a #5a6a3a #2a1a10 #6a4a2a";
        const string EYED = "#2a1a10 #3b2414 #1e140c";

        public static double Lum(string hex)
        {
            int n = Hex(hex);
            return (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
        }
        static int Hex(string hex)
        {
            var s = (hex ?? "#888888").TrimStart('#');
            if (s.Length > 6) s = s.Substring(0, 6);
            return int.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out int v) ? v : 0x888888;
        }
        public static string Secondary(string col)
        {
            var c = (col ?? "").TrimStart('#').ToLowerInvariant();
            foreach (var e in SEC.Split(',')) if (e.Substring(0, 6) == c) return "#" + e.Substring(7);
            return Lum(col) < 0.45 ? "#f2f2f2" : "#16161c";
        }
        /// <summary>rig3d's name hash: h = h * 31 + code point (JS for-of walks code points; charCodeAt(0) = high surrogate).</summary>
        public static uint NameHash(string nm)
        {
            uint h = 0;
            nm ??= "";
            for (int i = 0; i < nm.Length; i++)
            {
                h = unchecked(h * 31 + nm[i]);
                if (char.IsHighSurrogate(nm[i])) i++;
            }
            return h;
        }

        public static RigLook Of(string name, string skin, int hr, int bd, string col, double? hs, Face face)
        {
            var L = new RigLook();
            uint h = L.h = NameHash(name);
            uint s = h ^ 0x85ebca6bu;
            double r()
            {
                s = unchecked((s ^ (s >> 13)) * 3266489909u);
                s ^= s >> 16;
                return s % 1000 / 1000.0;
            }
            bool light = string.Equals(skin, "#e8b88f", StringComparison.OrdinalIgnoreCase);
            var hl = (light ? HAIRL : HAIRD).Split(' ');
            L.hc = hl[(int)Math.Floor(r() * hl.Length)];
            double u = r();
            int hair = 0;
            if (hr == 1)
            {
                if (hs == 5) hair = 10;
                else if (hs == 0) hair = 2;
                else if (hs == 1) hair = 3;
                else if (hs == 2) hair = 4;
                else hair = light ? (u < 0.45 ? 4 : u < 0.7 ? 2 : u < 0.85 ? 1 : 6) : u < 0.3 ? 2 : u < 0.5 ? 3 : u < 0.68 ? 1 : u < 0.82 ? 5 : u < 0.94 ? 6 : 4;
            }
            else if (hr == 2) hair = hs == 1 ? 8 : 7;
            else if (hr == 3) hair = 9;
            L.hair = hair;
            double bu = r();
            if (bd != 0) L.beard = bu < 0.4 ? 1 : bu < 0.6 ? 2 : bu < 0.75 ? 3 : bu < 0.9 ? 5 : 4;
            else if (bu < 0.22) L.beard = 4;
            var el = (light ? EYEL : EYED).Split(' ');
            L.eye = el[(int)Math.Floor(r() * el.Length)];
            L.sec = Secondary(col);
            L.trim = Lum(col) < 0.5 ? "#ffffff" : "#16161c";
            var sw = SHOES.Split('|');
            var sh = sw[h % (uint)sw.Length].Split(' ');
            L.shoe = new string[sh.Length];
            for (int i = 0; i < sh.Length; i++) L.shoe[i] = sh[i] == "T" ? col : sh[i] == "S" ? L.sec : sh[i];
            string pick(string a)
            {
                var l = a.Split(' ');
                return l[(int)Math.Floor(r() * l.Length)].Replace("T", col).Replace("S", L.sec);
            }
            double cu = r();
            L.shoeCut = cu < 0.35 ? 0 : cu < 0.7 ? 1 : 2;
            L.sock = pick("#f4f4f4 #f4f4f4 #141414 T");
            L.sockH = 0.14 + Math.Floor(r() * 3) * 0.18;
            const string acc = "#141414 #f2f2f2 T";
            L.sleeve = r() < 0.22 ? 1 + (int)Math.Floor(r() * 3) : 0;
            L.sleeveC = pick(acc);
            L.wrist = r() < 0.3 ? 1 + (int)Math.Floor(r() * 3) : 0;
            L.wristC = pick(acc + " S");
            L.knee = r() < 0.18 ? 1 + (int)Math.Floor(r() * 3) : 0;
            L.kneeC = pick("#141414 #f2f2f2");
            double tu = r();
            L.tights = tu < 0.14 ? 1 : tu < 0.22 ? 2 : 0;
            L.tightsC = pick("#141414 #f2f2f2 T");
            L.band = h % 7 == 0 || r() < 0.06;
            L.bandC = pick(acc + " S");
            L.tape = r() < 0.25 ? 1 + (int)Math.Floor(r() * 7) : 0;
            // face (faceOf): same stream and order as rig3d's original F, SIG face wins
            uint fh = h ^ 0x9e3779b9u;
            double fr() { fh = unchecked((fh ^ (fh >> 15)) * 2246822507u); return fh % 1000 / 1000.0; }
            L.w = 0.92 + fr() * 0.16; L.jw = 0.9 + fr() * 0.25; L.jl = 0.9 + fr() * 0.25; L.nw = 0.85 + fr() * 0.45; L.nl = 0.85 + fr() * 0.35;
            L.eg = 0.12 + fr() * 0.03; L.br = 0.03 + fr() * 0.03; L.ba = (fr() - 0.5) * 0.25; L.ea = 0.85 + fr() * 0.35; L.lp = 0.8 + fr() * 0.5;
            L.es = 0.9 + fr() * 0.2; L.nb = fr(); L.ck = fr(); L.ch = 0.85 + fr() * 0.3; L.fh = fr();
            if (face != null)
            {
                L.w = face.w ?? L.w; L.jw = face.jw ?? L.jw; L.jl = face.jl ?? L.jl; L.nw = face.nw ?? L.nw; L.nl = face.nl ?? L.nl;
                L.eg = face.eg ?? L.eg; L.br = face.br ?? L.br; L.ba = face.ba ?? L.ba; L.ea = face.ea ?? L.ea; L.lp = face.lp ?? L.lp;
            }
            return L;
        }
    }

    /// <summary>The built player geometry (three space): skinned vertices with per-vertex hex colour + material class,
    /// triangles per material class, and the jersey prints (atlas UVs) as a separate list.</summary>
    public sealed class RigMeshData
    {
        public readonly List<V3> v = new(), n = new();
        public readonly List<float> u = new(), w = new(); // uv (knit tiling for class 1, atlas for prints)
        public readonly List<string> col = new();
        public readonly List<int> cls = new();
        public readonly List<int> bi = new(); // 4 bone indices per vertex
        public readonly List<float> bw = new(); // 4 weights per vertex
        public readonly List<int>[] tri = { new(), new(), new(), new(), new(), new(), new(), new() }; // by material class
        public readonly List<int> print = new(); // print triangles (vertices with cls = -1)
        public int Tris { get { int t = print.Count; foreach (var l in tri) t += l.Count; return t / 3; } }
        public RigLook look;
    }

    public static class RigMesh
    {
        // bone indices (rig3d `names` order)
        public const int HIPS = 0, BD = 1, TL = 2, TR = 3, KL = 4, KR = 5, SL = 6, SR = 7, EL = 8, ER = 9, WL = 10, WR = 11,
            CH = 12, NK = 13, HD = 14, AL = 15, AR = 16, GL = 17, GR = 18, FLL = 19, FLR = 20, TFL = 21, TFR = 22, HEM = 23,
            JW = 24, MI = 25, MO = 26, CL = 27, CR = 28, BRL = 29, BRR = 30, LL = 31, LR = 32, YL = 33, YR = 34, NB = 35;
        public static readonly int[] PARENT = { -1, HIPS, HIPS, HIPS, TL, TR, CH, CH, SL, SR, EL, ER, BD, CH, NK, KL, KR, WL, WR, HIPS, HIPS, AL, AR, BD, HD, HD, HD, HD, HD, HD, HD, HD, HD, HD, HD };

        /// <summary>Rest offsets of every bone from its parent, in three space (rig3d makeRig).</summary>
        public static V3[] Offsets(double k)
        {
            var R = Pose.RIG;
            float HB = (float)(R.chest + R.neck + R.head), F0 = 0.12f, L1 = (float)R.L1, L2 = (float)R.L2;
            V3 FB(float x, float y, float z) => new V3(x, y - HB, z);
            return new[]
            {
                V3.Zero, new V3(0, (float)R.hip, 0), new V3(-(float)R.hipX, (float)R.hip, 0), new V3((float)R.hipX, (float)R.hip, 0),
                new V3(0, -L1, 0), new V3(0, -L1, 0), new V3(-(float)(R.shX * k), (float)R.sh, 0), new V3((float)(R.shX * k), (float)R.sh, 0),
                new V3(0, -(float)R.ua, 0), new V3(0, -(float)R.ua, 0), new V3(0, -(float)R.fa, 0), new V3(0, -(float)R.fa, 0),
                new V3(0, (float)R.chest, 0), new V3(0, (float)R.neck, 0), new V3(0, (float)R.head, 0),
                new V3(0, -L2, 0), new V3(0, -L2, 0), new V3(0, -(float)R.fing, 0), new V3(0, -(float)R.fing, 0),
                new V3(-(float)R.hipX, (float)R.hip, 0), new V3((float)R.hipX, (float)R.hip, 0),
                new V3(0, -0.16f, 0.36f), new V3(0, -0.16f, 0.36f), new V3(0, -0.05f, 0),
                FB(0, 2.64f, 0.02f), FB(0, 2.556f, 0.31f), FB(0, 2.565f, 0.365f), FB(-0.08f, 2.562f, 0.36f), FB(0.08f, 2.562f, 0.36f),
                FB(-F0 - 0.01f, 2.9f, 0.34f), FB(F0 + 0.01f, 2.9f, 0.34f), FB(-F0 - 0.01f, 2.852f, 0.33f), FB(F0 + 0.01f, 2.852f, 0.33f),
                FB(-F0 - 0.01f, 2.8f, 0.355f), FB(F0 + 0.01f, 2.8f, 0.355f),
            };
        }

        /// <summary>Rest (bind) position of every bone in model space. Walks each bone's parent chain: the arm bones
        /// (sL..wR, gL/gR = 6..11, 17, 18) hang from the chest (12), which comes LATER in the index order - summing in
        /// index order put the whole arm 4.2 ft low in bind space (the Unity "arms don't show" bug).</summary>
        public static V3[] RestPositions(V3[] off)
        {
            var bp = new V3[NB];
            for (int i = 0; i < NB; i++)
            {
                var a = V3.Zero;
                for (int b = i; b >= 0; b = PARENT[b]) a += off[b];
                bp[i] = a;
            }
            return bp;
        }

        // ---------------------------------------------------------------- geometry (indexed, three conventions)
        public sealed class Geo
        {
            public readonly List<V3> v = new(), n = new();
            public readonly List<float> u = new(), w = new();
            public readonly List<int> t = new();
            public bool quad; // loft: triangles come in quad pairs
            public Geo Clone()
            {
                var g = new Geo { quad = quad };
                g.v.AddRange(v); g.n.AddRange(n); g.u.AddRange(u); g.w.AddRange(w); g.t.AddRange(t);
                return g;
            }
            public int Vert(V3 p, V3 nn, float uu = 0, float ww = 0) { v.Add(p); n.Add(nn); u.Add(uu); w.Add(ww); return v.Count - 1; }
            public Geo Scale(float sx, float sy, float sz)
            {
                for (int i = 0; i < v.Count; i++)
                {
                    v[i] = new V3(v[i].X * sx, v[i].Y * sy, v[i].Z * sz);
                    var b = new V3(n[i].X / sx, n[i].Y / sy, n[i].Z / sz);
                    n[i] = b.LengthSquared() > 1e-20f ? V3.Normalize(b) : b;
                }
                return this;
            }
            public Geo Move(float x, float y, float z)
            {
                var d = new V3(x, y, z);
                for (int i = 0; i < v.Count; i++) v[i] += d;
                return this;
            }
            /// <summary>three rotateX (ax 0) / rotateY (1) / rotateZ (2).</summary>
            public Geo Rot(int ax, double a)
            {
                float c = (float)Math.Cos(a), s = (float)Math.Sin(a);
                V3 R(V3 q) => ax == 0 ? new V3(q.X, q.Y * c - q.Z * s, q.Y * s + q.Z * c)
                    : ax == 1 ? new V3(q.X * c + q.Z * s, q.Y, -q.X * s + q.Z * c)
                    : new V3(q.X * c - q.Y * s, q.X * s + q.Y * c, q.Z);
                for (int i = 0; i < v.Count; i++) { v[i] = R(v[i]); n[i] = R(n[i]); }
                return this;
            }
            /// <summary>three computeVertexNormals on the indexed geometry (area-weighted face normals).</summary>
            public Geo Normals()
            {
                for (int i = 0; i < n.Count; i++) n[i] = V3.Zero;
                for (int i = 0; i < t.Count; i += 3)
                {
                    int a = t[i], b = t[i + 1], c = t[i + 2];
                    var fn = V3.Cross(v[c] - v[b], v[a] - v[b]);
                    n[a] += fn; n[b] += fn; n[c] += fn;
                }
                for (int i = 0; i < n.Count; i++) n[i] = n[i].LengthSquared() > 1e-24f ? V3.Normalize(n[i]) : V3.UnitY;
                return this;
            }
            /// <summary>rig3d weld: vertex normals, then coincident vertices (seams, poles) share their averaged normal.</summary>
            public Geo Weld()
            {
                Normals();
                var m = new Dictionary<(long, long, long), List<int>>();
                for (int i = 0; i < v.Count; i++)
                {
                    var k = ((long)Math.Round(v[i].X * 1e4), (long)Math.Round(v[i].Y * 1e4), (long)Math.Round(v[i].Z * 1e4));
                    if (!m.TryGetValue(k, out var l)) m[k] = l = new List<int>();
                    l.Add(i);
                }
                foreach (var l in m.Values)
                {
                    if (l.Count < 2) continue;
                    var s = V3.Zero;
                    foreach (int i in l) s += n[i];
                    s = s.LengthSquared() > 1e-24f ? V3.Normalize(s) : V3.UnitY;
                    foreach (int i in l) n[i] = s;
                }
                return this;
            }
            public Geo Warp(Func<V3, V3> f)
            {
                var g = Clone();
                for (int i = 0; i < g.v.Count; i++) g.v[i] = f(g.v[i]);
                return g.Weld();
            }
        }

        static double Pw(double t, double e) => Math.Sign(t) * Math.Pow(Math.Abs(t), e);
        /// <summary>rig3d loft: levels [y, rx, zf, zb, zc]; egg rings (front depth zf, back zb), superellipse e.</summary>
        public static Geo Loft(double[] L, int seg, double e = 1)
        {
            int nl = L.Length / 5;
            var g = new Geo { quad = true };
            for (int j = 0; j < nl; j++)
                for (int i = 0; i <= seg; i++)
                {
                    double th = (double)i / seg * Math.PI * 2, s = Pw(Math.Sin(th), e), c = Pw(Math.Cos(th), e);
                    int o = j * 5;
                    g.Vert(new V3((float)(L[o + 1] * s), (float)L[o], (float)(L[o + 4] + (c > 0 ? L[o + 2] : L[o + 3]) * c)), V3.Zero, (float)i / seg, (float)j / (nl - 1));
                }
            int W = seg + 1;
            bool up = true;
            for (int j = 0; j < nl - 1; j++)
                if (L[(j + 1) * 5] != L[j * 5]) { up = L[(j + 1) * 5] > L[j * 5]; break; }
            for (int j = 0; j < nl - 1; j++)
                for (int i = 0; i < seg; i++)
                {
                    int a = j * W + i, b = a + 1, c = a + W, d = c + 1;
                    if (up) { g.t.Add(a); g.t.Add(b); g.t.Add(d); g.t.Add(a); g.t.Add(d); g.t.Add(c); }
                    else { g.t.Add(a); g.t.Add(d); g.t.Add(b); g.t.Add(a); g.t.Add(c); g.t.Add(d); }
                }
            return g.Weld();
        }
        public static double[] Refine(double[] L, int n, double from = -1e9)
        {
            var o = new List<double>();
            for (int j = 0; j < L.Length / 5 - 1; j++)
                for (int s = 0; s < (L[j * 5 + 5] > from ? n : 1); s++)
                    for (int k = 0; k < 5; k++) o.Add(L[j * 5 + k] + (L[j * 5 + 5 + k] - L[j * 5 + k]) * s / n);
            for (int k = 0; k < 5; k++) o.Add(L[L.Length - 5 + k]);
            return o.ToArray();
        }
        public static double[] Shell(double[] L, double s, double cy, double sy)
        {
            var o = (double[])L.Clone();
            for (int j = 0; j < o.Length; j += 5) { o[j] = cy + (o[j] - cy) * sy; o[j + 1] *= s; o[j + 2] *= s; o[j + 3] *= s; }
            return o;
        }
        static void LevelAt(double[] L, double y, double[] o)
        {
            int n = L.Length / 5;
            for (int j = 0; j < n - 1; j++)
            {
                double y0 = L[j * 5], y1 = L[j * 5 + 5];
                if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1) || j == n - 2)
                {
                    double u = y1 == y0 ? 0 : Math.Min(1, Math.Max(0, (y - y0) / (y1 - y0)));
                    for (int k = 0; k < 4; k++) o[k] = L[j * 5 + 1 + k] + (L[j * 5 + 6 + k] - L[j * 5 + 1 + k]) * u;
                    return;
                }
            }
        }
        /// <summary>THREE.SphereGeometry(1, ws, hs).</summary>
        public static Geo Sphere(int ws, int hs)
        {
            var g = new Geo();
            for (int iy = 0; iy <= hs; iy++)
            {
                double vv = (double)iy / hs, th = vv * Math.PI;
                for (int ix = 0; ix <= ws; ix++)
                {
                    double uu = (double)ix / ws, ph = uu * 2 * Math.PI;
                    var p = new V3((float)(-Math.Cos(ph) * Math.Sin(th)), (float)Math.Cos(th), (float)(Math.Sin(ph) * Math.Sin(th)));
                    g.Vert(p, p, (float)uu, (float)(1 - vv));
                }
            }
            int W = ws + 1;
            for (int iy = 0; iy < hs; iy++)
                for (int ix = 0; ix < ws; ix++)
                {
                    int a = iy * W + ix + 1, b = iy * W + ix, c = (iy + 1) * W + ix, d = (iy + 1) * W + ix + 1;
                    if (iy != 0) { g.t.Add(a); g.t.Add(b); g.t.Add(d); }
                    if (iy != hs - 1) { g.t.Add(b); g.t.Add(c); g.t.Add(d); }
                }
            return g;
        }
        /// <summary>THREE.TorusGeometry(R, r, radial, tubular) (ring in the XY plane).</summary>
        public static Geo Torus(double R, double r, int radial, int tubular)
        {
            var g = new Geo();
            for (int j = 0; j <= radial; j++)
                for (int i = 0; i <= tubular; i++)
                {
                    double uu = (double)i / tubular * 2 * Math.PI, vv = (double)j / radial * 2 * Math.PI;
                    var p = new V3((float)((R + r * Math.Cos(vv)) * Math.Cos(uu)), (float)((R + r * Math.Cos(vv)) * Math.Sin(uu)), (float)(r * Math.Sin(vv)));
                    var c = new V3((float)(R * Math.Cos(uu)), (float)(R * Math.Sin(uu)), 0);
                    g.Vert(p, V3.Normalize(p - c));
                }
            for (int j = 1; j <= radial; j++)
                for (int i = 1; i <= tubular; i++)
                {
                    int a = (tubular + 1) * j + i - 1, b = (tubular + 1) * (j - 1) + i - 1, c = (tubular + 1) * (j - 1) + i, d = (tubular + 1) * j + i;
                    g.t.Add(a); g.t.Add(b); g.t.Add(d);
                    g.t.Add(b); g.t.Add(c); g.t.Add(d);
                }
            return g;
        }
        /// <summary>rig3d roundBox: BoxGeometry(w, h, d, sx, 2, 2) with chamfered edges (r = 28% of the thinnest side).</summary>
        public static Geo RoundBox(double w, double h, double d, int sx = 2)
        {
            var g = new Geo();
            var half = new[] { w / 2, h / 2, d / 2 };
            var segs = new[] { sx, 2, 2 };
            double r = Math.Min(w, Math.Min(h, d)) * 0.28;
            for (int ax = 0; ax < 3; ax++)
                for (int sd = -1; sd <= 1; sd += 2)
                {
                    int ua = (ax + 1) % 3, va = (ax + 2) % 3, b0 = g.v.Count, nu = segs[ua], nv = segs[va];
                    for (int j = 0; j <= nv; j++)
                        for (int i = 0; i <= nu; i++)
                        {
                            var p = new double[3];
                            p[ax] = sd * half[ax];
                            p[ua] = (2.0 * i / nu - 1) * half[ua];
                            p[va] = (2.0 * j / nv - 1) * half[va];
                            var cc = new double[3];
                            for (int q = 0; q < 3; q++) cc[q] = Math.Max(-half[q] + r, Math.Min(half[q] - r, p[q]));
                            double ox = p[0] - cc[0], oy = p[1] - cc[1], oz = p[2] - cc[2], ol = Math.Sqrt(ox * ox + oy * oy + oz * oz);
                            if (ol > 1e-9) { ox *= r / ol; oy *= r / ol; oz *= r / ol; }
                            g.Vert(new V3((float)(cc[0] + ox), (float)(cc[1] + oy), (float)(cc[2] + oz)), V3.Zero);
                        }
                    for (int j = 0; j < nv; j++)
                        for (int i = 0; i < nu; i++)
                        {
                            int a = b0 + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, e = a + nu + 1;
                            // orient outward by the flat grid direction
                            var fu = new V3(); var fv = new V3();
                            fu = Axis(ua); fv = Axis(va);
                            bool flip = V3.Dot(V3.Cross(fu, fv), Axis(ax) * sd) < 0;
                            if (flip) { g.t.Add(a); g.t.Add(c); g.t.Add(b); g.t.Add(a); g.t.Add(e); g.t.Add(c); }
                            else { g.t.Add(a); g.t.Add(b); g.t.Add(c); g.t.Add(a); g.t.Add(c); g.t.Add(e); }
                        }
                }
            return g.Normals();
            static V3 Axis(int a) => a == 0 ? V3.UnitX : a == 1 ? V3.UnitY : V3.UnitZ;
        }
        static double Sn(double x, double y, double z) => Math.Sin(x * 7.1 + y * 3.3) * Math.Sin(y * 5.7 - z * 6.1 + 1.3) * Math.Sin(z * 4.3 + x * 2.9 + 0.7);

        // ---------------------------------------------------------------- colours (three's linear working space)
        static double S2L(double c) => c < 0.04045 ? c * 0.0773993808 : Math.Pow(c * 0.9478672986 + 0.0521327014, 2.4);
        static double L2S(double c) => c < 0.0031308 ? c * 12.92 : 1.055 * Math.Pow(c, 0.41666) - 0.055;
        static double[] Lin(string hex) { int n = HexI(hex); return new[] { S2L(((n >> 16) & 255) / 255.0), S2L(((n >> 8) & 255) / 255.0), S2L((n & 255) / 255.0) }; }
        static int HexI(string hex) { var s = (hex ?? "#888888").TrimStart('#'); return int.TryParse(s.Length > 6 ? s.Substring(0, 6) : s, System.Globalization.NumberStyles.HexNumber, null, out int v) ? v : 0x888888; }
        static string ToHex(double[] c)
        {
            int b(double x) => (int)Math.Round(Math.Max(0, Math.Min(1, L2S(x))) * 255);
            return "#" + (b(c[0]) << 16 | b(c[1]) << 8 | b(c[2])).ToString("x6");
        }
        public static string Shade(string hex, double k) { var c = Lin(hex); return ToHex(new[] { c[0] * k, c[1] * k, c[2] * k }); }
        public static string Mix(string a, string b, double t) { var x = Lin(a); var y = Lin(b); return ToHex(new[] { x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t }); }

        // ---------------------------------------------------------------- build
        public struct Blend { public int to; public double from, len, max; public bool end, z, on; }
        static Blend Bl(int to, double from, double len, bool end, double max = 0.5, bool z = false) => new Blend { to = to, from = from, len = len, end = end, max = max, z = z, on = true };
        /// <summary>Per-face colour key from the face centroid (part-local), v = loft level fraction; null drops the face.</summary>
        public delegate string CF(double x, double y, double z, double v);
        sealed class Part { public Geo g; public string key; public int bone; public Blend b1, b2; public string[] keys; public bool print; }

        /// <summary>Builds the player's mesh data (lod 1 = High tier detail, 0 = Low/Medium). `word` = jersey wordmark.</summary>
        /// <summary>Test hook: (bone, key, triangles) per part.</summary>
        public static Action<int, string, int> Trace;

        public static RigMeshData Build(Player p, int lod)
        {
            double k = p.bk;
            string sk = p.skin;
            var LK = RigLook.Of(p.n, p.skin, (int)p.hr, (int)p.bd, p.col, p.sg?.hs, p.sg?.face);
            bool hi = lod > 0;
            var off = Offsets(k);
            var bp = RestPositions(off);
            var R = Pose.RIG;
            double L1 = R.L1, L2 = R.L2;
            var parts = new List<Part>();
            var prints = new List<Part>();

            void put(List<Part> list, Geo g0, string key, int bone, double x, double y, double z, double sx = 1, double sy = 1, double sz = 1, Blend b1 = default, Blend b2 = default, CF cf = null, bool vtx = false)
            {
                var g = g0.Clone().Scale((float)sx, (float)sy, (float)sz);
                string[] keys = null;
                if (cf != null)
                {
                    // paint per face (per quad on lofts: clean stepped edges); unweld so every face owns its colour
                    var o = new Geo();
                    var kl = new List<string>();
                    string kk = null;
                    int nf = g.t.Count / 3;
                    for (int f = 0; f < nf; f++)
                    {
                        if (!g.quad || f % 2 == 0)
                        {
                            int nv = g.quad && f + 1 < nf ? 6 : 3;
                            double cx = 0, cy = 0, cz = 0, cv = 0;
                            for (int q = 0; q < nv; q++) { int ix = g.t[f * 3 + q]; cx += g.v[ix].X; cy += g.v[ix].Y; cz += g.v[ix].Z; cv += g.w[ix]; }
                            kk = cf(cx / nv, cy / nv, cz / nv, cv / nv);
                            if (vtx && kk == null) kk = key;
                        }
                        if (kk == null) continue;
                        for (int q = 0; q < 3; q++) { int ix = g.t[f * 3 + q]; o.t.Add(o.Vert(g.v[ix], g.n[ix], g.u[ix], g.w[ix])); }
                        kl.Add(kk);
                    }
                    if (kl.Count == 0) return;
                    g = o;
                    keys = kl.ToArray();
                }
                Trace?.Invoke(bone, key, g.t.Count / 3);
                g.Move((float)x + bp[bone].X, (float)y + bp[bone].Y, (float)z + bp[bone].Z);
                list.Add(new Part { g = g, key = key, bone = bone, b1 = b1, b2 = b2, keys = keys, print = list == prints });
            }
            double by(int bone) => bp[bone].Y - bp[BD].Y;
            void P(Geo g, string key, int bone, double x, double y, double z, double sx = 1, double sy = 1, double sz = 1, Blend b1 = default, Blend b2 = default, CF cf = null)
                => put(parts, g, key, bone, x, y, z, sx, sy, sz, b1, b2, cf);
            void PT(Geo g, string key, int bone, double x, double y, double z, double sx = 1, double sy = 1, double sz = 1, Blend b1 = default, Blend b2 = default, CF cf = null, bool vtx = false)
                => put(parts, g, key, bone, x - bp[bone].X, y - by(bone), z - bp[bone].Z, sx, sy, sz, b1, b2, cf, vtx);
            Geo S2 = hi ? Sphere(14, 10) : Sphere(10, 7), S1 = hi ? Sphere(9, 6) : Sphere(7, 5);
            int SG(int n) => hi ? n : Math.Max(6, (int)Math.Round(n * 0.6, MidpointRounding.AwayFromZero));
            double[] RF(double[] L, int n) => hi ? Refine(L, n) : L;
            Geo box(double w, double h, double d, int s = 2) => RoundBox(w, h, d, s);

            // ---- colours (key -> hex, material class) ----
            string hcol = LK.hc, sec = LK.sec, lip = Mix(Shade(sk, 0.78), "#7a3530", 0.25);
            var C = new Dictionary<string, (string hex, int cls)>
            {
                ["skin"] = (sk, 2), ["warm"] = (Mix(sk, "#b4473a", 0.16), 2), ["dark"] = (Shade(sk, 0.8), 2), ["crease"] = (Shade(sk, 0.6), 2),
                ["lip"] = (lip, 7), ["lipD"] = (Shade(lip, 0.55), 7), ["jer"] = (p.col, 1), ["sht"] = (p.col, 0), ["shtD"] = (Shade(p.col, 0.5), 0),
                ["sec"] = (sec, 0), ["secK"] = (sec, 1), ["hair"] = (hcol, 3), ["h1"] = (Mix(hcol, sk, 0.3), 3), ["h2"] = (Mix(hcol, sk, 0.55), 3),
                ["h3"] = (Mix(hcol, sk, 0.78), 2), ["hw"] = (Shade(hcol, 1.9), 3), ["hs"] = (Shade(hcol, 1.45), 3), ["stub"] = (Mix(sk, hcol, 0.42), 2),
                ["white"] = (Mix("#f4f1ea", sk, 0.08), 5), ["iris"] = (LK.eye, 5), ["pupil"] = ("#060606", 5), ["glint"] = ("#ffffff", 5),
                ["teeth"] = ("#efeadf", 5), ["mouth"] = ("#3a1416", 7), ["lash"] = (Mix("#141010", hcol, 0.3), 3), ["sleeve"] = (LK.sleeveC, 0),
                ["wrist"] = (LK.wristC, 0), ["knee"] = (LK.kneeC, 0), ["tights"] = (LK.tightsC, 0), ["sock"] = (LK.sock, 0), ["band"] = (LK.bandC, 0),
                ["tape"] = ("#f2f0ea", 0), ["su"] = (LK.shoe[0], 4), ["sa"] = (LK.shoe[1], 4), ["sm"] = (LK.shoe[2], 6), ["so"] = (LK.shoe[3], 6),
                ["sl"] = (LK.shoe[4], 0), ["sin"] = ("#1e1e22", 0),
            };
            double mu = Math.Min(1, Math.Max(0, (k - 0.85) / 0.45)),
                lean = 1 - Math.Min(0.08, Math.Max(-0.04, (p.ht - 6.5) * 0.09)),
                ga = (0.95 + 0.18 * k) * lean, gl = (0.96 + 0.15 * k) * lean, kz = 0.86 + 0.14 * k;

            // ---------------- torso
            var TL0 = new[]
            {
                -0.25, 0, 0, 0, 0, -0.22, 0.4, 0.3, 0.32, 0, -0.05, 0.53, 0.33, 0.39, -0.02, 0.2, 0.545, 0.33, 0.38, -0.02,
                0.45, 0.52, 0.32, 0.33, 0, 0.7, 0.51, 0.33, 0.31, 0, 0.95, 0.55, 0.36 + 0.02 * mu, 0.32, 0, 1.15, 0.61, 0.39 + 0.03 * mu, 0.34, 0,
                1.35, 0.67 + 0.02 * mu, 0.42 + 0.04 * mu, 0.36, 0, 1.52, 0.71 + 0.03 * mu, 0.42 + 0.03 * mu, 0.37, 0, 1.66, 0.73 + 0.02 * mu, 0.37, 0.37, 0,
                1.78, 0.7, 0.31, 0.34, 0, 1.88, 0.58 + 0.03 * mu, 0.25, 0.3, -0.01, 1.96, 0.38 + 0.03 * mu, 0.2, 0.24, -0.02, 2.02, 0.2, 0.16, 0.17, -0.01,
                2.06, 0, 0, 0, -0.01,
            };
            var TLv = (double[])TL0.Clone();
            for (int j = 0; j < TLv.Length; j += 5) { TLv[j + 1] *= k; TLv[j + 2] *= kz; TLv[j + 3] *= kz; TLv[j + 4] *= kz; }
            var TLr = hi ? Refine(Refine(TLv, 2), 2, 1.1) : Refine(TLv, 2, 1.1);
            double neckY(double ax, double z) => z > 0 ? 1.68 + 1.1 * ax : 1.9 + 0.45 * ax;
            CF jersey = (x, y, z, v) =>
            {
                if (y < 0.24) return "sht";
                double ax = Math.Abs(x), ny = neckY(ax, z);
                if (ax < 0.32 * k && y > ny) return "skin";
                if (ax < 0.34 * k && y > ny - 0.05) return "sec";
                double dx = (ax - 0.82 * k) / (0.37 * k), dy = (y - 1.97) / 0.56, d = dx * dx + dy * dy;
                if (d < 1) return "skin";
                if (d < 1.2) return "sec";
                double a = Math.Atan2(ax, z);
                if (Math.Abs(a - Math.PI / 2) < 0.14 && y < 1.4) return "secK";
                return "jer";
            };
            P(Loft(TLr, SG(48), 0.86), "jer", BD, 0, 0, 0, 1, 1, 1, Bl(CH, 1.25, 0.6, false, 1), Bl(HEM, 0.05, 0.35, true, 0.7), jersey);
            P(Torus(0.555 * k, 0.05, 6, SG(36)).Rot(0, Math.PI / 2), "sec", BD, 0, 0.24, -0.015 * kz, 1, 1, 0.7 * kz);
            P(Loft(new[] { -0.16, 0.21, 0.18, 0.21, 0, -0.06, 0.165, 0.15, 0.17, 0.01, 0.1, 0.145, 0.135, 0.15, 0.02, 0.26, 0.135, 0.125, 0.14, 0.01, 0.38, 0.13, 0.12, 0.135, 0, 0.44, 0, 0, 0, 0 }, SG(22)),
                "skin", NK, 0, 0, 0, 1.12 + 0.1 * mu, 1, 1.1 + 0.08 * mu, Bl(CH, -0.16, 0.2, true, 0.6), Bl(HD, 0.4, 0.15, false, 0.5));

            // ---------------- legs
            double K = -L1, A = -L1 - L2;
            var LEG = new[]
            {
                0.1, 0, 0, 0, 0, 0.07, 0.235, 0.24, 0.25, 0, -0.05, 0.27, 0.28, 0.29, 0, -0.35, 0.275, 0.29 + 0.01 * mu, 0.27, 0.01,
                -0.65, 0.26, 0.29 + 0.015 * mu, 0.25, 0.02, -0.95, 0.235, 0.265 + 0.01 * mu, 0.22, 0.02, K + 0.38, 0.205, 0.225, 0.19, 0.015,
                K + 0.2, 0.185, 0.2, 0.175, 0.01, K + 0.08, 0.178, 0.205, 0.165, 0.01, K, 0.172, 0.19, 0.165, 0.005, K - 0.1, 0.168, 0.17, 0.17, 0,
                K - 0.28, 0.178 + 0.01 * mu, 0.15, 0.215 + 0.015 * mu, -0.02, K - 0.5, 0.172 + 0.01 * mu, 0.145, 0.205 + 0.01 * mu, -0.02,
                K - 0.75, 0.15, 0.135, 0.16, -0.01, K - 1.0, 0.125, 0.12, 0.12, 0, K - 1.25, 0.106, 0.11, 0.1, 0, A + 0.15, 0.1, 0.1, 0.095, 0,
                A, 0.1, 0.1, 0.1, 0, A - 0.05, 0, 0, 0, 0,
            };
            for (int j = 0; j < LEG.Length; j += 5) for (int q = 1; q < 4; q++) LEG[j + q] *= gl;
            double sockTop = A + LK.sockH + 0.12;
            for (int s = 0; s < 2; s++)
            {
                int t = s == 0 ? TL : TR, kn = s == 0 ? KL : KR, an = s == 0 ? AL : AR, tfb = s == 0 ? TFL : TFR, fb = s == 0 ? FLL : FLR;
                double sd = s == 0 ? -1 : 1;
                int side = sd < 0 ? 1 : 2;
                CF legC = (x, y, z, v) =>
                {
                    if (y < sockTop) return "sock";
                    if ((LK.knee & side) != 0 && y < K + 0.3 && y > K - 0.38) return "knee";
                    if (LK.tights != 0 && y > (LK.tights == 2 ? K - 0.45 : K + 0.42)) return "tights";
                    return "skin";
                };
                P(Loft(RF(LEG, 2), SG(22), 0.95), "skin", t, 0, 0, 0, 1, 1, 1, Bl(kn, K - 0.2, 0.4, true, 1), Bl(BD, 0.07, 0.3, false, 0.3), legC);
                var sh = new[] { 0.16, 0, 0, 0, -0.02, 0.12, 0.33, 0.34, 0.37, -0.02, -0.2, 0.36, 0.36, 0.39, -0.02, -0.5, 0.37, 0.36, 0.38, -0.01, -0.8, 0.385, 0.37, 0.37, 0, -0.9, 0.39, 0.375, 0.375, 0, -0.9, 0.36, 0.35, 0.35, 0, -0.6, 0.3, 0.3, 0.3, 0, -0.5, 0, 0, 0, 0 };
                for (int j = 0; j < sh.Length; j += 5) for (int q = 1; q < 4; q++) sh[j + q] *= k;
                CF shortsC = (x, y, z, v) =>
                {
                    if (v > 0.66) return "shtD";
                    if (y < -0.8) return "sec";
                    double a = Math.Atan2(x * sd, z);
                    if (Math.Abs(a - Math.PI / 2) < 0.16) return "sec";
                    return "sht";
                };
                P(Loft(RF(sh, 2), SG(26)), "sht", t, 0, 0, 0, 1, 1, 1, Bl(fb, -0.86, 0.62, true, 0.85), default, shortsC);
                int cut = LK.shoeCut;
                var SHO = new[]
                {
                    -0.3, 0, 0.02, 0.15, 0, -0.28, 0.12, 0.1, 0.2, 0, -0.22, 0.165, 0.17 + cut * 0.03, 0.205, 0, -0.1, 0.185, 0.18 + cut * 0.04, 0.205, 0,
                    0.05, 0.195, 0.14 + cut * 0.02, 0.205, 0, 0.18, 0.205, 0.1, 0.205, 0, 0.3, 0.21, 0.065, 0.205, 0, 0.42, 0.195, 0.03, 0.2, 0,
                    0.5, 0.16, 0, 0.19, 0, 0.55, 0.1, -0.04, 0.17, 0, 0.57, 0, -0.06, 0.15, 0,
                };
                var SL0 = new List<double>();
                for (int j = 0; j < SHO.Length; j += 5)
                {
                    double top = SHO[j + 2], bot = -SHO[j + 3], c = (top + bot) / 2;
                    SL0.AddRange(new[] { SHO[j], SHO[j + 1] * (0.95 + 0.05 * k), c - bot, top - c, -c });
                }
                double topAt(double z)
                {
                    for (int j = 0; j < SHO.Length - 5; j += 5) if (z <= SHO[j + 5]) return SHO[j + 2] + (SHO[j + 7] - SHO[j + 2]) * (z - SHO[j]) / Math.Max(1e-6, SHO[j + 5] - SHO[j]);
                    return 0;
                }
                CF shoeC = (x, y, z, v) =>
                {
                    if (y < -0.172) return "so";
                    if (y < -0.122) return "sm";
                    double tp = topAt(z);
                    if (y > tp - 0.03 && z < -0.04) return "sin";
                    if (Math.Abs(x) < 0.075 && z > -0.02 && z < 0.36 && y > tp - 0.035) return "sl";
                    if (z > 0.43) return "sa";
                    if (z < -0.19) return "sa";
                    if (Math.Abs(x) > 0.11 && Math.Abs(y - (-0.07 + 0.22 * (z - 0.05))) < 0.026 && z > -0.16 && z < 0.36) return "sa";
                    return "su";
                };
                P(Loft(RF(SL0.ToArray(), 2), SG(22), 0.6).Rot(0, Math.PI / 2), "su", an, 0, 0, 0, 1, 1, 1, Bl(tfb, 0.44, 0.16, false, 1, true), default, shoeC);
                if (cut == 2)
                    P(Loft(new[] { -0.02, 0.17, 0.17, 0.18, -0.01, 0.3, 0.165, 0.16, 0.17, -0.01, 0.34, 0.15, 0.145, 0.155, -0.01, 0.3, 0.13, 0.125, 0.14, -0.01, 0.0, 0.12, 0.11, 0.12, -0.01 }, SG(18)),
                        "su", an, 0, 0, 0, 1, 1, 1, default, default, (x, y, z, v) => v > 0.45 ? "sin" : y > 0.27 ? "sa" : "su");
            }

            // ---------------- arms + hands
            double UA = R.ua, FA = R.fa, W = -UA - FA;
            var ARM = new[]
            {
                0.12, 0, 0, 0, 0, 0.06, 0.15, 0.15, 0.15, 0, -0.12, 0.165, 0.16, 0.16, 0, -0.35, 0.158, 0.175 + 0.02 * mu, 0.155 + 0.01 * mu, 0.01,
                -0.55, 0.152, 0.18 + 0.03 * mu, 0.158 + 0.01 * mu, 0.015, -0.75, 0.137, 0.15 + 0.01 * mu, 0.147, 0.005, -0.9, 0.122, 0.125, 0.13, 0,
                -UA, 0.12, 0.114, 0.124, -0.005, -UA - 0.1, 0.126, 0.12, 0.12, 0, -UA - 0.24, 0.138 + 0.01 * mu, 0.127, 0.121, 0.005,
                -UA - 0.44, 0.127, 0.111, 0.106, 0, -UA - 0.68, 0.102, 0.082, 0.081, 0, W + 0.1, 0.087, 0.062, 0.066, 0, W, 0.086, 0.06, 0.065, 0,
                W - 0.05, 0, 0, 0, 0,
            };
            for (int j = 0; j < ARM.Length; j += 5) for (int q = 1; q < 4; q++) ARM[j + q] *= ga;
            for (int s = 0; s < 2; s++)
            {
                int s2 = s == 0 ? SL : SR, e = s == 0 ? EL : ER, w = s == 0 ? WL : WR, fg = s == 0 ? GL : GR;
                double sd = s == 0 ? -1 : 1;
                int side = sd < 0 ? 1 : 2;
                bool slv = (LK.sleeve & side) != 0;
                CF armC = (x, y, z, v) =>
                {
                    if ((LK.wrist & side) != 0 && y < W + 0.2) return "wrist";
                    if (slv && y < 0.05 && y > W + 0.06) return "sleeve";
                    if (y < -UA + 0.07 && y > -UA - 0.07 && z < -0.05) return "dark";
                    return "skin";
                };
                P(hi ? Sphere(14, 10) : Sphere(10, 8), slv ? "sleeve" : "skin", s2, sd * 0.02, -0.2, 0, 0.2 * ga * (1 + 0.08 * mu), 0.27, 0.215 * ga * (1 + 0.06 * mu), Bl(CH, 0.08, 0.22, false, 0.25));
                P(Loft(RF(ARM, 2), SG(20)), "skin", s2, 0, 0, 0, 1, 1, 1, Bl(e, -UA - 0.12, 0.24, true, 1), Bl(CH, 0.06, 0.24, false, 0.3), armC);
                if ((LK.wrist & side) != 0)
                    P(Loft(new[] { W + 0.03, 0.093 * ga, 0.07 * ga, 0.075 * ga, 0, W + 0.2, 0.098 * ga, 0.075 * ga, 0.08 * ga, 0, W + 0.2, 0.08 * ga, 0.06 * ga, 0.06 * ga, 0, W + 0.03, 0.08 * ga, 0.06 * ga, 0.06 * ga, 0 }, SG(16)), "wrist", e, 0, UA, 0);
                P(box(0.165, 0.2, 0.075).Warp(v => v.Z > 0 ? v : new V3(v.X, v.Y, v.Z - 0.012f * (1 - (v.X / 0.09f) * (v.X / 0.09f)))), "skin", w, 0, -0.11, 0.012);
                for (int f = 0; f < 4; f++)
                {
                    double Lf = f == 0 ? 0.148 : f == 1 ? 0.165 : f == 2 ? 0.155 : 0.125, r = (0.024 - f * 0.0012) * (0.95 + 0.05 * k), fx = -sd * (0.058 - f * 0.039);
                    bool tp = LK.tape != 0 && ((sd > 0 && ((f == 0 && (LK.tape & 1) != 0) || (f == 2 && (LK.tape & 2) != 0))) || (sd < 0 && f == 0 && (LK.tape & 4) != 0));
                    P(Loft(new[] { 0.04, 0, 0, 0, 0, 0.03, r, r * 0.9, r * 0.95, 0, -Lf * 0.42, r * 0.96, r * 0.86, r * 0.92, 0, -Lf * 0.48, r * 1.02, r * 0.9, r * 0.98, 0, -Lf + r, r * 0.82, r * 0.78, r * 0.8, 0, -Lf, 0, 0, 0, 0 }, SG(8)),
                        tp ? "tape" : "skin", fg, fx, 0, 0.014, 1, 1, 1, default, default, (x2, y2, z2, v2) => tp ? "tape" : y2 > -0.005 ? "warm" : "skin");
                }
                P(Loft(new[] { 0.03, 0, 0, 0, 0, 0.02, 0.032, 0.03, 0.03, 0, -0.07, 0.03, 0.027, 0.028, 0, -0.13, 0.024, 0.022, 0.022, 0, -0.155, 0, 0, 0, 0 }, SG(8)).Rot(0, -0.35).Rot(2, -sd * 0.5), "skin", w, -sd * 0.075, -0.07, 0.045);
            }

            // ---------------- head
            double fw = LK.w;
            var SK0 = new[]
            {
                2.32, 0, 0, 0, -0.04, 2.36, 0.2, 0.16, 0.24, -0.04, 2.46, 0.26, 0.24, 0.3, -0.04, 2.58, 0.3, 0.355, 0.34, -0.04,
                2.68, 0.335, 0.37 + 0.01 * LK.ck, 0.37, -0.04, 2.8, 0.35, 0.375, 0.4, -0.04, 2.92, 0.355, 0.4, 0.41, -0.04,
                3.02 + 0.02 * LK.fh, 0.345, 0.37, 0.41, -0.04, 3.11 + 0.01 * LK.fh, 0.3, 0.3, 0.37, -0.04, 3.18, 0.21, 0.2, 0.27, -0.04,
                3.215, 0.1, 0.09, 0.13, -0.04, 3.228, 0, 0, 0, -0.04,
            };
            for (int j = 0; j < SK0.Length; j += 5) SK0[j + 1] *= fw;
            var SKL = hi ? Refine(SK0, 2) : SK0;
            double jy(double y) => 2.64 - (2.64 - y) * LK.jl;
            var JL0 = new[] { 2.64, 0.25, 0.2, 0.16, 0.1, 2.57, 0.27, 0.26, 0.2, 0.09, 2.5, 0.25, 0.275, 0.19, 0.09, 2.43, 0.2, 0.26, 0.15, 0.1, 2.375, 0.13, 0.215 * LK.ch, 0.1, 0.12, 2.335, 0.065, 0.14 * LK.ch, 0.05, 0.15, 2.318, 0, 0, 0, 0.16 };
            for (int j = 0; j < JL0.Length; j += 5) { JL0[j] = jy(JL0[j]); JL0[j + 1] *= LK.jw; }
            var JLr = hi ? Refine(JL0, 3) : Refine(JL0, 2);
            CF jawC = null;
            PT(S1, "mouth", MI, 0, 2.5, 0.315, 0.072, 0.056, 0.05);
            PT(box(0.11, 0.022, 0.02), "teeth", MI, 0, 2.548, 0.352);
            PT(box(0.1, 0.02, 0.02), "teeth", MI, 0, 2.452, 0.345);
            double es = LK.es;
            for (int s = 0; s < 2; s++)
            {
                double sd = s == 0 ? -1 : 1, ex = sd * LK.eg;
                PT(S2, "warm", HD, sd * 0.338 * fw, 2.72, -0.03, 0.05, 0.105 * LK.ea, 0.078);
                PT(S1, "crease", HD, sd * (0.338 * fw + 0.03), 2.72, -0.025, 0.022, 0.06 * LK.ea, 0.042);
                PT(S1, "warm", HD, sd * (0.338 * fw + 0.005), 2.63 - 0.02 * LK.ea, -0.015, 0.035, 0.035, 0.035);
                PT(S2, "white", HD, ex, 2.8, 0.322, 0.066 * es, 0.046 * es, 0.034);
                int yb = sd < 0 ? YL : YR;
                PT(S1, "iris", yb, ex, 2.8, 0.349, 0.03 * es, 0.03 * es, 0.009);
                PT(S1, "pupil", yb, ex, 2.8, 0.356, 0.013 * es, 0.013 * es, 0.005);
                PT(S1, "glint", yb, ex + 0.011, 2.811, 0.361, 0.006, 0.006, 0.003);
                PT(Sphere(12, 8), "skin", HD, ex, 2.846, 0.326, 0.074 * es, 0.024, 0.036);
                PT(box(0.13 * es, 0.012, 0.016, 4).Warp(v => new V3(v.X, v.Y - 6 * v.X * v.X, v.Z)), "lash", HD, ex, 2.834, 0.352);
                PT(S1, "skin", HD, ex, 2.762, 0.33, 0.066 * es, 0.013, 0.03);
                PT(S2, "dark", sd < 0 ? LL : LR, ex, 2.8, 0.338, 0.072, 0.056, 0.038);
                var brow = box(0.16, LK.br, 0.045, 6).Warp(v =>
                {
                    double uu = v.X * sd / 0.08;
                    return new V3(v.X, (float)(v.Y * (1 - 0.35 * Math.Max(0, uu)) - 2.2 * v.X * v.X), v.Z);
                }).Rot(2, -sd * LK.ba);
                PT(brow, "lash", sd < 0 ? BRL : BRR, ex, 2.9, 0.352);
            }
            double nw = LK.nw, nl = LK.nl;
            PT(S2, "skin", HD, 0, 2.755, 0.355 + 0.02 * LK.nb, 0.034 * nw, 0.085 * nl, 0.04);
            PT(S2, "skin", HD, 0, 2.66 - 0.03 * (nl - 1), 0.405 + 0.012 * nl, 0.048 * nw, 0.044, 0.045);
            for (int s = 0; s < 2; s++)
            {
                double sd = s == 0 ? -1 : 1;
                PT(S1, "skin", HD, sd * 0.042 * nw, 2.648 - 0.02 * (nl - 1), 0.38, 0.03 * nw, 0.03, 0.035);
                PT(S1, "crease", HD, sd * 0.022 * nw, 2.63 - 0.025 * (nl - 1), 0.4, 0.013, 0.007, 0.01);
            }
            PT(S2, "lip", HD, 0, 2.582, 0.356, 0.078, 0.019 * LK.lp, 0.03);
            PT(S2, "lip", JW, 0, 2.547, 0.354, 0.07, 0.022 * LK.lp, 0.032);
            PT(box(0.13, 0.012, 0.02), "lipD", MO, 0, 2.565, 0.37);
            for (int s = 0; s < 2; s++) { double sd = s == 0 ? -1 : 1; PT(box(0.05, 0.016, 0.02), "lipD", sd < 0 ? CL : CR, sd * 0.082, 2.563, 0.36); }

            // hair: painted skull + volume shells eased to zero at the hairline
            int hair = LK.hair, beard = LK.beard;
            const double hcy = 2.78;
            double hm(double x, double y, double z, double lo = 0)
            {
                double ax = Math.Abs(x), f = Math.Min(1, Math.Max(0, z / 0.3)), b = Math.Min(1, Math.Max(0, -z / 0.25)),
                    yl = 2.85 + f * (0.16 - 0.08 * Math.Min(1, ax / 0.3)) - b * 0.3 - lo, m = y - yl;
                if (ax > 0.29 && z > -0.04 && z < 0.1) m = Math.Max(m, Math.Min(y - 2.66, 0.02));
                return m;
            }
            string fadeKey(double y) => y > 2.97 ? "hair" : y > 2.9 ? "h1" : y > 2.82 ? "h2" : "h3";
            string scalp(double x, double y, double z)
            {
                if (hair == 0) return null;
                double m = hm(x, y, z);
                if (m < 0) return null;
                if (hair == 1) return m < 0.02 ? "h2" : "h1";
                if (hair == 2 || hair == 5 || hair == 6) return fadeKey(y);
                if (hair == 3) return Math.Sin(Math.Sqrt(x * x + (z + 0.06) * (z + 0.06) + (y - 3.25) * 0.8 * (y - 3.25) * 0.8) * 60) > 0.35 ? "hw" : m < 0.02 ? "h1" : "hair";
                if (hair == 10) return Math.Sin(x * 70) > 0.1 || y < 2.88 ? "hair" : "h2";
                return m < 0.015 ? "h1" : "hair";
            }
            CF skullC = (x, y, z, v) =>
            {
                var sc = scalp(x, y, z);
                if (sc != null) return sc;
                double ax = Math.Abs(x);
                if (beard == 1 && ax > 0.24 * fw && y < 2.72 && y > 2.5 && z > -0.03 && z < 0.2) return "hair";
                if (beard == 4 && ax > 0.24 * fw && y < 2.66 && z > -0.03 && z < 0.2) return "stub";
                return "skin";
            };
            PT(Loft(SKL, SG(32), 0.92), "skin", HD, 0, 0, 0, 1, 1, 1, default, default, skullC, true);
            void vol(double s, double sy, double lo, double soft, CF cf, double bump = 0)
            {
                var g = Loft(SKL, SG(32), 0.92).Warp(v =>
                {
                    double t0 = Math.Min(1, Math.Max(0, hm(v.X, v.Y, v.Z, lo) / soft)), t = t0 * t0 * (3 - 2 * t0), k1 = 1 + (s - 1) * t, k2 = 1 + (sy - 1) * t;
                    if (bump > 0)
                    {
                        double nn = Sn(v.X * 3.1, v.Y * 3.3, v.Z * 3.2) + 0.5 * Sn(v.X * 7.7 + 1, v.Y * 8.1, v.Z * 7.3);
                        k1 += nn * bump * t; k2 += nn * bump * t;
                    }
                    return new V3((float)(v.X * k1), (float)(hcy + (v.Y - hcy) * k2), (float)((v.Z + 0.04) * k1 - 0.04));
                });
                PT(g, "hair", HD, 0, 0, 0, 1, 1, 1, default, default, cf);
            }
            CF inHair(double lo, Func<double, double, double, string> key) => (x, y, z, v) => hm(x, y, z, lo) > -0.004 ? key(x, y, z) : null;
            if (hair == 2 || hair == 5) vol(1.035, 1.05, -0.12, 0.05, inHair(-0.12, (x, y, z) => "hair"));
            if (hair == 4) vol(1.07, 1.1, 0, 0.09, (x, y, z, v) => hm(x, y, z) > -0.004 ? (Math.Abs(x - 0.13 * fw) < 0.012 && z > -0.05 && y > 3.0 ? "h2" : "hair") : null);
            if (hair == 5)
                PT(Loft(new[] { 2.98, 0.29 * fw, 0.3, 0.32, -0.05, 3.2, 0.31 * fw, 0.31, 0.33, -0.06, 3.42, 0.3 * fw, 0.3, 0.32, -0.06, 3.47, 0.22 * fw, 0.22, 0.24, -0.06, 3.48, 0, 0, 0, -0.06 }, SG(28), 0.75), "hair", HD, 0, 0, 0);
            if (hair == 6) vol(1.1, 1.14, -0.12, 0.07, inHair(-0.12, (x, y, z) => "hair"), 0.03);
            if (hair == 7 || hair == 8) vol(1.09, 1.14, 0.02, 0.12, inHair(0.02, (x, y, z) => Math.Sin(x * 46 + z * 5) > 0.6 && y > 2.95 ? "hs" : "hair"));
            if (hair == 9) vol(1.32, 1.36, 0.02, 0.16, inHair(0.02, (x, y, z) => "hair"), 0.04);
            if (hair == 8)
                for (int d = 0; d < 12; d++)
                {
                    double a = Math.PI * (0.22 + d / 11.0 * 1.56), len = 0.7 + ((int)(LK.h >> d) & 3) * 0.06;
                    PT(Loft(new[] { 0.0, 0, 0, 0, 0, -0.02, 0.045, 0.045, 0.045, 0, -len, 0.035, 0.035, 0.035, 0, -len - 0.02, 0, 0, 0, 0 }, 6).Rot(2, Math.Cos(a) * 0.15), "hair", HD, Math.Cos(a) * 0.36 * fw, 2.98, -Math.Abs(Math.Sin(a)) * 0.37 - 0.04);
                }
            if (beard != 0)
            {
                bool lipZone(double ax, double y, double z) => ax < 0.11 && y > 2.47 && z > 0.17;
                string bk(double x, double y, double z)
                {
                    double ax = Math.Abs(x);
                    if (z < -0.02) return null;
                    if (beard == 1) return lipZone(ax, y, z) ? null : "hair";
                    if (beard == 4) return lipZone(ax, y, z) ? null : "stub";
                    if (beard == 3) return (ax > 0.17 || y < 2.4) && !lipZone(ax, y, z) ? "hair" : null;
                    return ax < 0.1 && y < 2.48 && z > 0.12 ? "hair" : null;
                }
                jawC = (x, y, z, v) => bk(x, y, z) ?? "skin";
                if (beard == 1) PT(Loft(Shell(JLr, 1.03, 2.6, 1.03), SG(28), 0.9), "hair", JW, 0, 0, 0, 1, 1, 1, default, default, (x, y, z, v) => y < 2.61 && bk(x, y, z) != null ? "hair" : null);
                if (beard == 1 || beard == 2 || beard == 5) PT(box(0.2, 0.032, 0.04, 6).Warp(v => new V3(v.X, v.Y - 2.5f * v.X * v.X, v.Z)), "hair", HD, 0, 2.598, 0.36);
            }
            PT(Loft(JLr, SG(28), 0.9), "skin", JW, 0, 0, 0, 1, 1, 1, default, default, jawC, true);
            if (LK.band) PT(Torus(0.352 * fw, 0.036, 8, SG(36)).Rot(0, Math.PI / 2 - 0.12), "band", HD, 0, 3.0, -0.035, 1, 1, 1.13);

            // ---------------- jersey prints: curved onto the chest / back, skinned like the torso
            var tAt = new double[4];
            void prt(double cx, double cy, double w, double h, bool back, double u0, double v0, double u1, double v1)
            {
                const int nx = 10, ny = 3;
                var g = new Geo();
                for (int j = 0; j <= ny; j++)
                    for (int i = 0; i <= nx; i++)
                    {
                        double lx = ((double)i / nx - 0.5) * w, y = cy + ((double)j / ny - 0.5) * h, x = cx + (back ? -lx : lx);
                        LevelAt(TLv, y, tAt);
                        double sx = Math.Min(1, Math.Abs(x) / Math.Max(0.05, tAt[0])), sa = Math.Pow(sx, 1 / 0.86), c = Math.Pow(Math.Max(0, 1 - sa * sa), 0.5 * 0.86);
                        g.Vert(new V3((float)x, (float)y, (float)(back ? tAt[3] - tAt[2] * c - 0.009 : tAt[3] + tAt[1] * c + 0.009)), V3.Zero, (float)(u0 + (double)i / nx * (u1 - u0)), (float)(v0 + (double)j / ny * (v1 - v0)));
                    }
                for (int j = 0; j < ny; j++)
                    for (int i = 0; i < nx; i++)
                    {
                        int a = j * (nx + 1) + i;
                        if (back) { g.t.Add(a); g.t.Add(a + nx + 2); g.t.Add(a + 1); g.t.Add(a); g.t.Add(a + nx + 1); g.t.Add(a + nx + 2); }
                        else { g.t.Add(a); g.t.Add(a + 1); g.t.Add(a + nx + 2); g.t.Add(a); g.t.Add(a + nx + 2); g.t.Add(a + nx + 1); }
                    }
                put(prints, g.Normals(), "jer", BD, 0, 0, 0, 1, 1, 1, Bl(CH, 1.25, 0.6, false, 1));
            }
            prt(0, 1.22, 0.42 * k, 0.42, false, 0, 0.5, 0.5, 1);
            prt(0, 1.53, 0.9 * k, 0.225, false, 0, 0.25, 1, 0.5);
            prt(0, 1.24, 0.74 * k, 0.74, true, 0, 0.5, 0.5, 1);
            prt(0, 1.7, 1.15 * k, 0.29, true, 0, 0, 1, 0.25);

            // ---------------- merge
            var D = new RigMeshData { look = LK };
            foreach (var list in new[] { parts, prints })
                foreach (var pt in list)
                {
                    var g = pt.g;
                    int b0 = D.v.Count;
                    for (int i = 0; i < g.v.Count; i++)
                    {
                        string kk = pt.keys != null ? pt.keys[i / 3] : pt.key;
                        if (!C.TryGetValue(kk, out var e)) e = C["skin"];
                        D.v.Add(g.v[i]);
                        D.n.Add(g.n[i]);
                        D.col.Add(e.hex);
                        int cls = pt.print ? -1 : e.cls;
                        D.cls.Add(cls);
                        D.u.Add(pt.print || cls == 1 ? g.u[i] * (pt.print ? 1 : 20) : 0);
                        D.w.Add(pt.print || cls == 1 ? g.w[i] * (pt.print ? 1 : 13) : 0);
                        double ramp(Blend b)
                        {
                            double ly = b.z ? g.v[i].Z - bp[pt.bone].Z : g.v[i].Y - bp[pt.bone].Y,
                                uu = Math.Min(1, Math.Max(0, b.end ? (b.from + b.len - ly) / b.len : (ly - (b.from - b.len)) / b.len));
                            return b.max * uu * uu * (3 - 2 * uu);
                        }
                        double w2 = pt.b1.on ? ramp(pt.b1) : 0, w3 = pt.b2.on ? ramp(pt.b2) * (1 - w2) : 0;
                        D.bi.Add(pt.bone); D.bi.Add(pt.b1.on ? pt.b1.to : 0); D.bi.Add(pt.b2.on ? pt.b2.to : 0); D.bi.Add(0);
                        D.bw.Add((float)(1 - w2 - w3)); D.bw.Add((float)w2); D.bw.Add((float)w3); D.bw.Add(0);
                    }
                    for (int f = 0; f < g.t.Count; f += 3)
                    {
                        int cls = D.cls[b0 + g.t[f]];
                        var tl = cls < 0 ? D.print : D.tri[cls];
                        tl.Add(b0 + g.t[f]); tl.Add(b0 + g.t[f + 1]); tl.Add(b0 + g.t[f + 2]);
                    }
                }
            return D;
        }
    }
}
