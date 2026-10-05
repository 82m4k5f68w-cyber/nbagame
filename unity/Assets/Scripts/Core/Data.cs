// Rosters, ratings, signature tweaks and shot clips (port of src/core/data.ts). The tables live in Data.Gen.cs,
// generated from the TypeScript source so the two never drift.
using System;
using System.Collections.Generic;

namespace Hoops.Core
{
    /// <summary>[name, 3pt, inside, speed, defense, jump, style, skin, hair, beard, height, build, number]
    /// style: 0 normal / 1 quick / 2 fadeaway / 3 step-back / 4 touch</summary>
    public sealed class Tuple
    {
        public string n, skin;
        public int c, i, s, d, j, st, hr, bd, num;
        public double ht, bk;
        public Tuple(string n, int c, int i, int s, int d, int j, int st, string skin, int hr, int bd, double ht, double bk, int num)
        {
            this.n = n; this.c = c; this.i = i; this.s = s; this.d = d; this.j = j; this.st = st;
            this.skin = skin; this.hr = hr; this.bd = bd; this.ht = ht; this.bk = bk; this.num = num;
        }
    }

    public sealed class Team
    {
        public string name, col;
        public Tuple[] ps;
        public Team(string name, string col, Tuple[] ps) { this.name = name; this.col = col; this.ps = ps; }
    }

    public sealed class Face { public double? w, jw, jl, nw, nl, eg, br, ba, ea, lp; }

    /// <summary>Shooting signature (see formOf). Numeric flags from SIG default to 0 like JS's undefined.</summary>
    public sealed class Form
    {
        public double a, f, l, k, g, w, dp, ft, lk, tw, gh, fr;
        public int[] ce;
        public double dk, gs, cl, off, lh;
        public double? hs;
        public Face face;
    }

    public readonly struct McRaw
    {
        public readonly double speed, stride;
        public readonly int dir, n;
        public readonly string d;
        public McRaw(double speed, double stride, int dir, int n, string d) { this.speed = speed; this.stride = stride; this.dir = dir; this.n = n; this.d = d; }
    }

    public static partial class Data
    {
        public static int Ovr(string n, int c, int i) => OV.TryGetValue(n ?? "", out var v) ? v : (int)Math.Round(68 + (Math.Max(c, i) - 75) * 0.4, MidpointRounding.AwayFromZero);
        public static int Ov2(Tuple p) => OV.TryGetValue(p.n, out var v) ? v : Ovr("", p.c, p.i);

        /// <summary>Dunks finish at the rim then hang; layup-type finishes use the short timing.</summary>
        public static bool IsDunkSv(int v) => v == 6 || (v >= 11 && v <= 15);
        public static bool IsLaySv(int v) => v == 5 || v == 7 || (v >= 16 && v <= 18) || v == 23 || IsDunkSv(v);

        static readonly Dictionary<string, Form> formCache = new();

        /// <summary>Deterministic shooting form from the name (same as the TS build: FNV-1a + murmur finalizer), SIG wins.
        /// Only the look changes; meter timing and the green window never do.</summary>
        public static Form FormOf(string name)
        {
            if (formCache.TryGetValue(name, out var c)) return c;
            uint h = 2166136261;
            unchecked
            {
                for (int i = 0; i < name.Length; i++) h = (h ^ name[i]) * 16777619u;
            }
            double R()
            {
                unchecked
                {
                    h = (h ^ (h >> 15)) * 2246822507u;
                    h = (h ^ (h >> 13)) * 3266489909u;
                    h ^= h >> 16;
                }
                return h / 4294967296.0;
            }
            var f = new Form();
            f.a = (R() - 0.5) * 0.36;
            f.f = (R() - 0.5) * 0.12;
            f.l = (R() - 0.5) * 0.16;
            f.k = R() * 0.16;
            f.g = R() * 0.35;
            f.w = (R() - 0.5) * 0.3;
            f.dp = R() * 0.45;
            f.ft = R();
            f.lk = R() < 0.3 ? 0.15 + R() * 0.25 : 0;
            f.tw = (R() - 0.5) * 0.3;
            f.gh = R() < 0.25 ? 0.3 + R() * 0.3 : 0;
            int Pk(int[] a) => a[(int)(R() * a.Length)];
            f.ce = new[] { Pk(new[] { 1, 4, 7, 8 }), Pk(new[] { 3, 5, 6 }), Pk(new[] { 2, 6, 7, 8 }) };
            f.dk = (int)(R() * 4);
            f.gs = (int)(R() * 6);
            f.fr = R();
            ApplySig(name, f);
            formCache[name] = f;
            return f;
        }
    }
}
