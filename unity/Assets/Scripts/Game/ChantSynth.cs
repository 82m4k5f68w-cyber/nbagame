// Crowd chant synthesis (port of src/client/chantsyn.ts: same score, voices, percussion, arena reverb and random
// draws). UnityEngine-free: Chants.cs renders a ChantJob a few voices per frame and turns it into a stereo AudioClip;
// unity/CoreTests/ChantCheck.cs renders every chant and compares levels with the browser numbers.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Hoops.Game
{
    public static class ChantSynth
    {
        public const int CSR = 22050;
        public const double TAIL = 1.2;

        public static uint Hash(string s)
        {
            uint h = 2166136261;
            unchecked { foreach (char ch in s) h = (h ^ ch) * 16777619; }
            return h;
        }

        public static readonly Dictionary<string, double[]> VF = new Dictionary<string, double[]>
        {
            ["i"] = new double[] { 310, 2250, 2950 }, ["I"] = new double[] { 420, 1900, 2550 }, ["e"] = new double[] { 560, 1800, 2500 },
            ["ae"] = new double[] { 720, 1650, 2450 }, ["a"] = new double[] { 760, 1220, 2550 }, ["o"] = new double[] { 520, 880, 2400 },
            ["u"] = new double[] { 340, 860, 2250 }, ["er"] = new double[] { 500, 1350, 1700 }, ["m"] = new double[] { 260, 1100, 2300 },
            ["n"] = new double[] { 280, 1500, 2500 }, ["l"] = new double[] { 360, 1050, 2650 }, ["w"] = new double[] { 300, 700, 2250 },
            ["r"] = new double[] { 380, 1100, 1550 }, ["y"] = new double[] { 290, 2200, 2950 },
        };
        public static readonly Dictionary<string, double[]> NC = new Dictionary<string, double[]>
        {
            ["d"] = new double[] { 3200, 1.2, 0.8, 0.03, 0 }, ["t"] = new double[] { 3800, 1.2, 0.9, 0.04, 0 },
            ["k"] = new double[] { 2100, 1.4, 0.8, 0.045, 0 }, ["p"] = new double[] { 1100, 1.0, 0.7, 0.03, 0 },
            ["f"] = new double[] { 2600, 0.7, 0.32, 0.09, 0 }, ["v"] = new double[] { 2200, 0.8, 0.2, 0.07, 1 },
            ["s"] = new double[] { 5600, 1.6, 0.42, 0.12, 0 }, ["sh"] = new double[] { 2900, 1.5, 0.5, 0.11, 0 },
            ["ch"] = new double[] { 3000, 1.4, 0.65, 0.09, 0 },
        };
        static double[] Vf(string k) => k != null && VF.TryGetValue(k, out var v) ? v : null;
        static double[] Nc(string k) => k != null && NC.TryGetValue(k, out var v) ? v : null;

        public sealed class Syl { public double t, d, p, a; public string on, v0, v1, co; }
        public sealed class Hit { public int k; public double t, a, d; }
        public sealed class Spec { public string id; public double len, jit; public int nv, free; public List<Syl> syl = new List<Syl>(); public List<Hit> hits = new List<Hit>(); }
        static Syl S(double t, double d, double p, string on, string v0, string v1, string co, double a = 1) =>
            new Syl { t = t, d = d, p = p, on = on, v0 = v0, v1 = string.IsNullOrEmpty(v1) ? v0 : v1, co = co, a = a };

        // ---- words -> syllables ----
        static readonly Dictionary<string, string> NICK = new Dictionary<string, string> { ["TIMBERWOLVES"] = "WOLVES", ["CAVALIERS"] = "CAVS", ["MAVERICKS"] = "MAVS", ["TRAIL BLAZERS"] = "BLAZERS", ["76ERS"] = "SIXERS" };
        static bool IsV(char c) => "AEIOUY".IndexOf(c) >= 0;
        static string OnsetOf(string c)
        {
            if (c == "") return "";
            if (c.StartsWith("SH")) return "sh";
            if (c.StartsWith("CH")) return "ch";
            if (c.StartsWith("TH") || c.StartsWith("PH")) return "f";
            char x = c[0];
            return x == 'D' ? "d" : x == 'T' ? "t" : x == 'K' || x == 'C' || x == 'Q' || x == 'G' ? "k" : x == 'P' || x == 'B' ? "p" : x == 'F' ? "f" : x == 'V' ? "v" : x == 'S' || x == 'Z' || x == 'X' ? "s" : x == 'J' ? "ch" : x == 'M' ? "m" : x == 'N' ? "n" : x == 'L' ? "l" : x == 'R' ? "r" : x == 'W' ? "w" : "";
        }
        static string[] VowelOf(string v, string next)
        {
            if (v == "EE" || v == "EA" || v == "IE" || v == "Y" || (v == "I" && next == "")) return new[] { "i", "i" };
            if (v == "OO" || (v == "U" && next == "")) return new[] { "u", "u" };
            if (v == "AI" || v == "AY" || v == "EI" || v == "EY") return new[] { "e", "i" };
            if (v == "OU" || v == "OW") return new[] { "a", "u" };
            if (v == "OA" || (v == "O" && next == "")) return new[] { "o", "u" };
            if (v == "OI" || v == "OY") return new[] { "o", "i" };
            char x = v[0];
            if (next != "" && next[0] == 'R') return x == 'A' ? new[] { "a", "a" } : x == 'O' ? new[] { "o", "o" } : new[] { "er", "er" };
            return x == 'A' ? new[] { "ae", "ae" } : x == 'E' ? new[] { "e", "e" } : x == 'I' ? new[] { "I", "I" } : x == 'O' ? new[] { "a", "a" } : x == 'U' ? new[] { "a", "a" } : new[] { "i", "i" };
        }
        static string CodaOf(string c)
        {
            if (c == "") return "";
            char x = c[c.Length - 1];
            if (c.Length > 1 && (c[0] == 'N' || c[0] == 'M') && (x == 'S' || x == 'Z')) return "ns";
            return x == 'S' || x == 'Z' || x == 'X' ? "s" : x == 'T' || x == 'D' ? "t" : x == 'K' || x == 'G' || x == 'C' ? "k" : x == 'N' || x == 'M' ? "n" : x == 'L' ? "l" : x == 'P' || x == 'B' ? "p" : x == 'R' ? "r" : "";
        }
        /// <summary>chantsyn.ts sylls(): [onset, v0, v1, coda] per syllable (max 3; long names keep two).</summary>
        public static List<string[]> Sylls(string word)
        {
            var w = new string((word ?? "").ToUpperInvariant().Where(ch => (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == ' ' || ch == '-').ToArray());
            if (NICK.TryGetValue(w, out var nk)) w = nk;
            var parts = w.Split(new[] { ' ', '-' }).Where(s => s.Length > 0).ToArray();
            w = parts.Length > 0 ? parts[parts.Length - 1] : "HEY";
            if (w.Length > 3 && w.EndsWith("E") && !IsV(w[w.Length - 2])) w = w.Substring(0, w.Length - 1);
            var o = new List<string[]>();
            int i = 0;
            while (i < w.Length)
            {
                string on = "";
                while (i < w.Length && !IsV(w[i])) on += w[i++];
                string v = "";
                while (i < w.Length && IsV(w[i])) v += w[i++];
                if (v == "")
                {
                    if (o.Count > 0) o[o.Count - 1][3] = CodaOf(on);
                    break;
                }
                int j = i;
                while (j < w.Length && !IsV(w[j])) j++;
                string cons = w.Substring(i, j - i);
                int keep = j >= w.Length ? cons.Length : cons.Length >= 2 ? 1 : 0;
                var vv = VowelOf(v, cons);
                o.Add(new[] { OnsetOf(on), vv[0], vv[1], CodaOf(cons.Substring(0, keep)) });
                i += keep;
            }
            if (o.Count == 0) o.Add(new[] { "", "e", "i", "" });
            return o.Count > 3 ? o.GetRange(0, 2) : o;
        }
        static void NameSyl(List<Syl> o, string word, double t0, double span, double hi)
        {
            var s = Sylls(word);
            int n = s.Count;
            double st = span / n;
            for (int i = 0; i < n; i++) o.Add(S(t0 + i * st, Math.Min(0.32, st * 0.85), i == 0 ? hi : i == n - 1 ? -1 : 0, s[i][0], s[i][1], s[i][2], s[i][3]));
        }

        /// <summary>The chant's score (96 BPM, like the organ).</summary>
        public static Spec MakeSpec(string id, string word)
        {
            var sp = new Spec { id = id, len = 5, nv = 12, jit = 0.022 };
            var syl = sp.syl;
            var hits = sp.hits;
            void Stomp(double t, double a = 1) => hits.Add(new Hit { k = 0, t = t, a = a });
            void Clap(double t, double a = 1) => hits.Add(new Hit { k = 1, t = t, a = a });
            switch (id)
            {
                case "defense":
                    for (double c = 0; c < 5; c += 2.5) { Stomp(c); Stomp(c + 0.625); syl.Add(S(c + 1.25, 0.3, 0, "d", "i", "i", "", 1)); syl.Add(S(c + 1.875, 0.5, 4, "f", "e", "e", "ns", 1)); }
                    break;
                case "letsgo":
                    for (double c = 0; c < 5; c += 2.5)
                    {
                        syl.Add(S(c, 0.22, 0, "l", "e", "e", "s", 0.9));
                        syl.Add(S(c + 0.3125, 0.26, 0, "k", "o", "u", "", 1));
                        NameSyl(syl, word, c + 0.625, 0.625, 3);
                        foreach (var k in new[] { 1.25, 1.5625, 1.875, 2.03125, 2.1875 }) Clap(c + k);
                    }
                    break;
                case "mvp":
                    sp.len = 4.8;
                    for (double c = 0; c < 4.8; c += 1.6) { syl.Add(S(c, 0.32, 0, "", "e", "e", "n", 1)); syl.Add(S(c + 0.42, 0.32, 0, "v", "i", "i", "", 1)); syl.Add(S(c + 0.84, 0.46, 1, "p", "i", "i", "", 1.1)); }
                    break;
                case "airball":
                    sp.len = 3.75; sp.nv = 10;
                    for (double c = 0; c < 3.75; c += 1.25) { syl.Add(S(c, 0.45, 0, "", "e", "er", "", 1)); syl.Add(S(c + 0.625, 0.52, -3, "p", "o", "o", "l", 1)); }
                    break;
                case "overtime":
                    for (double c = 0; c < 5; c += 2.5)
                    {
                        Stomp(c); Stomp(c + 0.3125);
                        syl.Add(S(c + 0.625, 0.26, 0, "", "o", "u", "", 0.9));
                        syl.Add(S(c + 0.9375, 0.26, 0, "v", "er", "er", "", 0.9));
                        syl.Add(S(c + 1.25, 0.5, 2, "t", "a", "i", "n", 1.1));
                        Clap(c + 1.875); Clap(c + 2.1875);
                    }
                    break;
                case "wewant":
                    for (double c = 0; c < 5; c += 2.5)
                    {
                        syl.Add(S(c, 0.22, 0, "w", "i", "i", "", 0.9));
                        syl.Add(S(c + 0.3125, 0.26, 0, "w", "a", "a", "n", 1));
                        NameSyl(syl, word, c + 0.625, 0.625, 3);
                        Clap(c + 1.25); Clap(c + 1.5625);
                    }
                    break;
                case "rockyou":
                    sp.len = 6; sp.nv = 0;
                    for (double c = 0; c < 6; c += 1.5) { Stomp(c, 1.1); Stomp(c + 0.375, 1.1); Clap(c + 0.75, 1.2); }
                    break;
                case "charge":
                    sp.len = 0.8; sp.nv = 14; sp.jit = 0.03;
                    syl.Add(S(0, 0.6, 2, "ch", "a", "er", "ch", 1.2));
                    break;
                case "boo":
                    sp.len = 3; sp.nv = 16; sp.free = 1;
                    for (int i = 0; i < 4; i++) hits.Add(new Hit { k = 2, t = 0.2 + i * 0.55, a = 0.5, d = 0.6 });
                    break;
                case "roar":
                    sp.len = 3.5; sp.nv = 14; sp.free = 1;
                    hits.Add(new Hit { k = 3, t = 0, a = 1, d = 3.4 });
                    for (int i = 0; i < 3; i++) hits.Add(new Hit { k = 2, t = 0.3 + i * 0.7, a = 0.45, d = 0.7 });
                    for (int i = 0; i < 10; i++) Clap(0.6 + i * 0.27, 0.5);
                    break;
                case "aww": sp.len = 1.8; sp.nv = 12; sp.free = 1; break;
                case "shh": sp.len = 1.4; sp.nv = 10; sp.free = 1; break;
            }
            return sp;
        }
        static List<Syl> FreeSyl(string id, Func<double> r)
        {
            double t = r();
            t *= 0.3;
            var o = new List<Syl>();
            if (id == "boo") { double d = 2.1 + r() * 0.6; o.Add(S(t, d, -2 - r() * 2, "p", "u", "u", "", 0.9)); }
            else if (id == "roar")
            {
                double d = 1.6 + r() * 1.5, p = 3 + r() * 3;
                string on = r() < 0.4 ? "y" : "", v0 = r() < 0.5 ? "a" : "e", v1 = r() < 0.5 ? "a" : "ae";
                o.Add(S(t * 0.7, d, p, on, v0, v1, "", 1));
            }
            else if (id == "aww") { double d = 1.1 + r() * 0.4; o.Add(S(t * 0.5, d, 1 - r() * 2, "", "a", "o", "", 0.8)); }
            else
                for (int k = 0; k < 3 && t < 1.1; k++)
                {
                    double d = 0.2 + r() * 0.15;
                    o.Add(S(t, d, 0, "sh", "", "", "", 0.8));
                    t += 0.35 + r() * 0.2;
                }
            return o;
        }

        sealed class BP
        {
            double b0, a1, a2, x1, x2, y1, y2;
            public void Set(double f, double q)
            {
                double w = 2 * Math.PI * Math.Min(f, CSR * 0.45) / CSR, al = Math.Sin(w) / (2 * q), a0 = 1 + al;
                b0 = al / a0; a1 = -2 * Math.Cos(w) / a0; a2 = (1 - al) / a0;
            }
            public double Run(double x)
            {
                double y = b0 * (x - x2) - a1 * y1 - a2 * y2;
                x2 = x1; x1 = x; y2 = y1; y1 = y;
                return y;
            }
            public void Clear() { x1 = x2 = y1 = y2 = 0; }
        }
        static double OnLen(string on) { var n = Nc(on); return n != null ? n[3] : on != "" && Vf(on) != null ? 0.07 : 0; }
        static double CoLen(string co)
        {
            if (co == "ns") return 0.2;
            if (co == "n" || co == "l" || co == "r") return 0.09;
            var n = Nc(co);
            return n != null ? n[3] + (co == "t" || co == "k" || co == "p" ? 0.03 : 0) : 0;
        }

        /// <summary>Renders one chant into stereo buffers a unit of work at a time (Step until Done).</summary>
        public sealed class ChantJob
        {
            public readonly float[] L, R;
            public bool Done;
            public readonly string id, word;
            readonly Spec sp;
            readonly Func<double> r;
            int v, stage;
            readonly BP f1 = new BP(), f2 = new BP(), f3 = new BP(), fn = new BP();
            readonly Dictionary<int, float[][]> gr = new Dictionary<int, float[][]>();
            float[] wet;
            public string Key => string.IsNullOrEmpty(word) ? id : id + ":" + word;

            public ChantJob(string id, string word)
            {
                this.id = id;
                this.word = word ?? "";
                sp = MakeSpec(id, this.word);
                r = ChantDir.Rng32(Hash(id + "|" + this.word));
                int n = (int)Math.Ceiling((sp.len + TAIL) * CSR);
                L = new float[n];
                R = new float[n];
            }

            /// <summary>One unit: a voice, a percussion hit, the section copies, a reverb channel, normalize.</summary>
            public bool Step()
            {
                if (stage == 0) { if (v < sp.nv) Voice(v++); else { stage = 1; v = 0; } }
                else if (stage == 1) { if (v < sp.hits.Count) { Hit(sp.hits[v], v); v++; } else stage = 2; }
                else if (stage == 2) { Copies(); stage = 3; }
                else if (stage == 3) { Verb(0); stage = 4; }
                else if (stage == 4) { Verb(1); stage = 5; }
                else { Norm(); stage = 6; Done = true; }
                return Done;
            }
            public ChantJob All() { while (!Done) Step(); return this; }

            static void Pan(double pan, double lev, out double gl, out double gr)
            {
                gl = lev * Math.Cos((pan + 1) * Math.PI / 4);
                gr = lev * Math.Sin((pan + 1) * Math.PI / 4);
            }

            void Voice(int i)
            {
                bool fem = r() < 0.3;
                double f0b = (fem ? 205 : 128) * Math.Pow(2, (r() - 0.5) * 0.12), fs = fem ? 1.12 : 1, det = (r() - 0.5) * 1.1;
                double o1 = r(), o2 = r(), o3 = r();
                double off = (o1 + o2 + o3 - 1.5) * sp.jit * 1.4, gain = (0.55 + r() * 0.45) / Math.Sqrt(Math.Max(1, sp.nv));
                double pan = r() * 2 - 1, dist = r();
                int dly = (int)Math.Floor((0.004 + dist * 0.03) * CSR);
                double lev = gain * (1 - dist * 0.45);
                Pan(pan, lev, out var gl, out var gR);
                double rough = 0.25 + r() * 0.25;
                var syls = sp.free != 0 ? FreeSyl(sp.id, r) : sp.syl;
                int N = L.Length;
                double ph = r(), lp = 0, drift = 0;
                foreach (var s in syls)
                {
                    if (sp.free == 0 && r() < 0.04) continue;
                    double st = s.t + off + (r() - 0.5) * sp.jit, D = s.d * (0.9 + r() * 0.2), oL = OnLen(s.on), cL = CoLen(s.co), vS = oL, vE = Math.Max(vS + 0.04, D - cL);
                    int a0 = Math.Max(0, (int)Math.Floor(st * CSR)), a1 = Math.Min(N - dly - 1, (int)Math.Floor((st + D + 0.03) * CSR));
                    if (a1 <= a0) continue;
                    f1.Clear(); f2.Clear(); f3.Clear(); fn.Clear();
                    double[] ncOn = Nc(s.on), ncCo = Nc(s.co == "ns" ? "s" : s.co), fOn = Vf(s.on), fCo = Vf(s.co == "ns" ? "n" : s.co), v0 = Vf(s.v0), v1 = Vf(s.v1) ?? v0;
                    bool voiced = v0 != null;
                    double av = 0, an = 0, avT = 0, anT = 0, f0 = f0b, nf = -1;
                    for (int k = a0; k < a1; k++)
                    {
                        if ((k - a0) % 32 == 0)
                        {
                            double u = (double)k / CSR - st, tF1, tF2, tF3;
                            avT = 0; anT = 0;
                            int nb = -1;
                            if (u < vS)
                            {
                                if (ncOn != null)
                                {
                                    double uu = u / oL;
                                    nb = 0;
                                    anT = ncOn[2] * (ncOn[3] < 0.05 ? (uu < 0.6 ? 1 : 0.3) : Math.Sin(Math.PI * Math.Min(1, uu * 1.2)));
                                    avT = ncOn[4] != 0 ? 0.35 : 0;
                                }
                                else if (fOn != null) avT = 0.55 + 0.45 * (u / oL);
                                var fv = fOn ?? v0 ?? VF["e"];
                                tF1 = fv[0]; tF2 = fv[1]; tF3 = fv[2];
                            }
                            else if (u < vE)
                            {
                                double w = (u - vS) / (vE - vS), g = w < 0.4 ? 0 : (w - 0.4) / 0.6;
                                var aa = v0 ?? VF["e"];
                                var bb = v1 ?? aa;
                                avT = voiced ? (u - vS < 0.025 ? (u - vS) / 0.025 : 1.08 - 0.25 * w) : 0;
                                tF1 = aa[0] + (bb[0] - aa[0]) * g; tF2 = aa[1] + (bb[1] - aa[1]) * g; tF3 = aa[2] + (bb[2] - aa[2]) * g;
                                if (!voiced && ncOn != null) { nb = 0; anT = ncOn[2] * (w < 0.15 ? w / 0.15 : w > 0.8 ? (1 - w) / 0.2 : 1); }
                                if (fOn != null && u - vS < 0.05)
                                {
                                    double m = (u - vS) / 0.05;
                                    tF1 = fOn[0] + (tF1 - fOn[0]) * m; tF2 = fOn[1] + (tF2 - fOn[1]) * m; tF3 = fOn[2] + (tF3 - fOn[2]) * m;
                                }
                            }
                            else
                            {
                                double uc = u - vE;
                                var bb = v1 ?? VF["e"];
                                tF1 = bb[0]; tF2 = bb[1]; tF3 = bb[2];
                                if (fCo != null && (s.co != "ns" || uc < 0.09)) { avT = 0.5; tF1 = fCo[0]; tF2 = fCo[1]; tF3 = fCo[2]; }
                                else if (ncCo != null)
                                {
                                    double ul = s.co == "ns" ? uc - 0.09 : uc;
                                    bool stop = s.co == "t" || s.co == "k" || s.co == "p";
                                    avT = 0; nb = 1;
                                    anT = stop ? (ul > 0.03 && ul < 0.03 + ncCo[3] ? ncCo[2] : 0) : ncCo[2] * (ul < ncCo[3] ? 1 - ul / ncCo[3] : 0);
                                }
                            }
                            if (u > D - 0.03) avT *= Math.Max(0, (D + 0.03 - u) / 0.06);
                            double F1 = tF1 * fs, F2 = tF2 * fs, F3 = tF3 * fs;
                            f1.Set(F1, F1 / 110); f2.Set(F2, F2 / 150); f3.Set(F3, F3 / 210);
                            if (nb >= 0)
                            {
                                var c = nb == 0 ? ncOn : ncCo;
                                if (c != null && nf != c[0]) { fn.Set(c[0], c[1]); nf = c[0]; }
                            }
                            drift += (r() - 0.5) * 0.06 - drift * 0.02;
                            f0 = f0b * Math.Pow(2, (s.p + det + drift - 1.5 * Math.Min(1, Math.Max(0, u / D))) / 12);
                        }
                        av += (avT * s.a - av) * 0.02;
                        an += (anT * s.a - an) * 0.08;
                        ph += f0 / CSR;
                        if (ph >= 1) ph -= 1;
                        double nz = r() * 2 - 1;
                        lp += (2 * ph - 1 - lp) * 0.35;
                        double y = 0;
                        if (av > 0.001)
                        {
                            double src = (lp + nz * rough) * av;
                            y = f1.Run(src) * 2.2 + f2.Run(src) * 1.4 + f3.Run(src) * 0.7;
                        }
                        if (an > 0.001) y += fn.Run(nz) * an * 1.6;
                        int j = k + dly;
                        L[j] = (float)(L[j] + y * gl);
                        R[j] = (float)(R[j] + y * gR);
                    }
                }
            }

            float[][] Grain(int k, int vv)
            {
                int key = k * 4 + vv;
                if (gr.TryGetValue(key, out var g0)) return g0;
                int n = (int)Math.Floor((k == 0 ? 0.26 : 0.1) * CSR), off = (int)Math.Floor(0.03 * CSR);
                var gL = new float[n];
                var gR = new float[n];
                if (k == 0)
                {
                    double e1 = Math.Exp(-16.0 / CSR), e2 = Math.Exp(-35.0 / CSR), e3 = Math.Exp(-30.0 / CSR);
                    for (int i = 0; i < 18; i++)
                    {
                        double j1 = r(), j2 = r();
                        int a0 = Math.Max(0, off + (int)Math.Floor((j1 + j2 - 1) * 0.02 * CSR));
                        double pan = r() * 2 - 1, g = (0.6 + r() * 0.4) / 6;
                        Pan(pan, g, out var gl, out var grr);
                        double f0 = 85 + r() * 30, ph = 0, lp = 0, a = 1, b = 1.2, sw = f0 - 42;
                        for (int q = a0; q < n; q++)
                        {
                            ph += (42 + sw) / CSR;
                            sw *= e3;
                            lp += (r() * 2 - 1 - lp) * 0.08;
                            double y = Math.Sin(2 * Math.PI * ph) * a + lp * b;
                            a *= e1; b *= e2;
                            gL[q] = (float)(gL[q] + y * gl);
                            gR[q] = (float)(gR[q] + y * grr);
                        }
                    }
                }
                else
                {
                    double ed = Math.Exp(-260.0 / CSR), et = Math.Exp(-60.0 / CSR);
                    int m = (int)Math.Floor(0.011 * CSR), hn = (int)Math.Floor(0.07 * CSR);
                    for (int i = 0; i < 22; i++)
                    {
                        double j1 = r(), j2 = r();
                        int a0 = Math.Max(0, off + (int)Math.Floor((j1 + j2 - 1) * 0.014 * CSR));
                        double pan = r() * 2 - 1, g = (0.5 + r() * 0.5) / 5;
                        Pan(pan, g, out var gl, out var grr);
                        fn.Clear();
                        fn.Set(1000 + r() * 1200, 1.3);
                        double e = 1, tl = 3;
                        for (int q = 0; q < hn && a0 + q < n; q++)
                        {
                            if (q % m == 0 && q < 3 * m) e = 1;
                            if (q >= 3 * m) tl *= et;
                            double y = fn.Run(r() * 2 - 1) * e * tl;
                            e *= ed;
                            gL[a0 + q] = (float)(gL[a0 + q] + y * gl);
                            gR[a0 + q] = (float)(gR[a0 + q] + y * grr);
                        }
                    }
                }
                return gr[key] = new[] { gL, gR };
            }

            void Hit(Hit h, int i)
            {
                int N = L.Length;
                if (h.k <= 1)
                {
                    var g = Grain(h.k, i % (h.k == 0 ? 2 : 3));
                    int a0 = (int)Math.Floor(h.t * CSR) - (int)Math.Floor(0.03 * CSR);
                    for (int q = Math.Max(0, -a0); q < g[0].Length && a0 + q < N; q++)
                    {
                        L[a0 + q] = (float)(L[a0 + q] + g[0][q] * h.a);
                        R[a0 + q] = (float)(R[a0 + q] + g[1][q] * h.a);
                    }
                }
                else if (h.k == 2)
                {
                    int a0 = Math.Max(0, (int)Math.Floor(h.t * CSR)), n = (int)Math.Floor(h.d * CSR);
                    double pan = r() * 2 - 1;
                    Pan(pan, h.a * 0.06, out var gl, out var grr);
                    double fa = 2100 + r() * 700, fb = fa * (1.15 + r() * 0.2), ph = 0;
                    for (int k = 0; k < n && a0 + k < N; k++)
                    {
                        double u = (double)k / n, f = (u < 0.3 ? fa + (fb - fa) * (u / 0.3) : fb - (fb - fa) * 0.4 * ((u - 0.3) / 0.7)) * (1 + 0.01 * Math.Sin(k * 0.012));
                        ph += f / CSR;
                        if (ph >= 1) ph -= 1;
                        double e = u < 0.05 ? u / 0.05 : u > 0.85 ? (1 - u) / 0.15 : 1, y = Math.Sin(2 * Math.PI * ph) * e;
                        L[a0 + k] = (float)(L[a0 + k] + y * gl);
                        R[a0 + k] = (float)(R[a0 + k] + y * grr);
                    }
                }
                else
                {
                    int a0 = Math.Max(0, (int)Math.Floor(h.t * CSR)), n = (int)Math.Floor(h.d * CSR), k35 = (int)Math.Floor(0.35 * CSR);
                    double ed = Math.Exp(-1.1 / CSR), e = 1;
                    f1.Clear(); f2.Clear(); f1.Set(900, 0.5); f2.Set(1000, 0.5);
                    for (int k = 0; k < n && a0 + k < N; k++)
                    {
                        double vv;
                        if (k < k35) vv = (double)k / k35;
                        else { vv = e; e *= ed; }
                        vv *= h.a * 0.35;
                        L[a0 + k] = (float)(L[a0 + k] + f1.Run(r() * 2 - 1) * vv);
                        R[a0 + k] = (float)(R[a0 + k] + f2.Run(r() * 2 - 1) * vv);
                    }
                }
            }

            void Copies()
            {
                if (sp.nv <= 0) return;
                int N = L.Length, d1 = (int)Math.Floor(0.019 * CSR), d2 = (int)Math.Floor(0.037 * CSR);
                for (int k = N - 1; k >= d2; k--)
                {
                    float l = L[k], rr = R[k];
                    L[k] = (float)(l + R[k - d1] * 0.7 + L[k - d2] * 0.55);
                    R[k] = (float)(rr + L[k - d1] * 0.7 + R[k - d2] * 0.55);
                }
            }

            void Verb(int ch)
            {
                int N = L.Length, pre = (int)Math.Floor(0.025 * CSR), sp2 = ch != 0 ? 23 : 0;
                wet ??= new float[N];
                var x = ch != 0 ? R : L;
                int[] cn = { 1557, 1617, 1491, 1422 }, an = { 556, 341 };
                var cb = new float[4][];
                var ci = new int[4];
                var cf = new double[4];
                for (int c = 0; c < 4; c++) cb[c] = new float[(int)Math.Floor((cn[c] + sp2) * (double)CSR / 44100)];
                var ap = new float[2][];
                var ai = new int[2];
                for (int a = 0; a < 2; a++) ap[a] = new float[(int)Math.Floor((an[a] + sp2) * (double)CSR / 44100)];
                const double fb = 0.8, dm = 0.3;
                for (int k = 0; k < N; k++)
                {
                    double inp = k >= pre ? x[k - pre] * 0.15 : 0, y = 0;
                    for (int c = 0; c < 4; c++)
                    {
                        double o = cb[c][ci[c]];
                        cf[c] = o * (1 - dm) + cf[c] * dm;
                        cb[c][ci[c]] = (float)(inp + cf[c] * fb);
                        if (++ci[c] >= cb[c].Length) ci[c] = 0;
                        y += o;
                    }
                    for (int a = 0; a < 2; a++)
                    {
                        double q = ap[a][ai[a]];
                        ap[a][ai[a]] = (float)(y + q * 0.5);
                        y = q - y * 0.5;
                        if (++ai[a] >= ap[a].Length) ai[a] = 0;
                    }
                    wet[k] = (float)y;
                }
                for (int k = 0; k < N; k++) x[k] = (float)(x[k] + wet[k] * 1.4);
            }

            void Norm()
            {
                wet = null;
                double pk = 1e-6;
                for (int k = 0; k < L.Length; k++) pk = Math.Max(pk, Math.Max(Math.Abs(L[k]), Math.Abs(R[k])));
                double g = 0.9 / pk;
                for (int k = 0; k < L.Length; k++) { L[k] = (float)(L[k] * g); R[k] = (float)(R[k] * g); }
            }
        }
    }
}
