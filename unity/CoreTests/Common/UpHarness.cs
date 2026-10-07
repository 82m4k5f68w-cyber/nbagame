// Shared helpers for the animation tests (Blend.cs, Limits.cs, FootSlide.cs, Features.cs): argument parsing, a seeded
// CPU game, per-feature buckets (Sim.upTag) for jerk / limit / slide numbers. Included with //@include.
using System;
using System.Collections.Generic;
using System.Globalization;
using Hoops.Core;
using static Hoops.Core.Sim;

public static class UH
{
    public static string Arg(string[] a, string k, string d)
    {
        foreach (var s in a) if (s.StartsWith(k + "=")) return s.Substring(k.Length + 1);
        return d;
    }
    public static int ArgI(string[] a, string k, int d) => int.Parse(Arg(a, k, d.ToString()));
    public static double W(double a) => a - Math.Round(a / (2 * Math.PI), MidpointRounding.AwayFromZero) * 2 * Math.PI;
    public static string F(double v, int n = 3) => v.ToString("F" + n, CultureInfo.InvariantCulture);

    /// <summary>A fresh seeded CPU-vs-CPU game (legacy ball physics: the harness has no engine).</summary>
    public static void Game(ulong seed, int up, int teamA = 0, int teamB = 1, double ql = 180)
    {
        Rng.Seed(seed);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.hand = true; cfg.MYM = 0; cfg.PRO = 1; cfg.UP = up;
        cfg.input = c => new Input();
        setQtrLen(ql);
        setCtrls(new List<Ctrl>());
        start(teamA, new StartOpts { j = teamB });
        UPC.Clear();
    }
    /// <summary>One tick with replays skipped and halftime resumed. False when the game is over.</summary>
    public static bool Tick()
    {
        if (S == "over") return false;
        upd(1 / 60.0);
        if (RPL != null) skipReplay();
        FX.Clear();
        if (S == "half") setS("play");
        return true;
    }
    public static string Counts()
    {
        var l = new List<string>();
        foreach (var kv in UPC) l.Add(kv.Key + ":" + kv.Value);
        l.Sort(StringComparer.Ordinal);
        return string.Join(" ", l);
    }
}

/// <summary>Values per bucket with percentile / max / mean.</summary>
public sealed class Buckets
{
    public readonly Dictionary<string, List<double>> B = new Dictionary<string, List<double>>();
    public readonly List<double> All = new List<double>();
    public void Add(string k, double v)
    {
        if (!B.TryGetValue(k, out var l)) B[k] = l = new List<double>();
        l.Add(v);
        All.Add(v);
    }
    public static double Pct(List<double> l, double q)
    {
        if (l.Count == 0) return 0;
        var c = new List<double>(l);
        c.Sort();
        return c[Math.Min(c.Count - 1, (int)Math.Floor(c.Count * q))];
    }
    public static double Max(List<double> l) { double m = 0; foreach (var v in l) m = Math.Max(m, v); return m; }
    public static double Mean(List<double> l) { double s = 0; foreach (var v in l) s += v; return l.Count > 0 ? s / l.Count : 0; }
}

/// <summary>Joint jerk (2nd difference per tick) of chosen channels, bucketed by feature; teleports and hits skipped.</summary>
public sealed class Jerk
{
    readonly int[] ch;
    readonly double tpDist;
    readonly Dictionary<Player, double[]> prev = new Dictionary<Player, double[]>();
    readonly Dictionary<Player, int> cool = new Dictionary<Player, int>();
    public readonly Buckets J = new Buckets();
    public readonly Dictionary<string, string> WorstAt = new Dictionary<string, string>();
    public Jerk(int[] channels, double tp) { ch = channels; tpDist = tp; }
    public void Reset() => prev.Clear();
    public void Track(Player p, string tag)
    {
        var q = p.q;
        if (q == null) return;
        prev.TryGetValue(p, out var pq);
        bool tp = pq != null && Math.Sqrt((p.x - pq[62]) * (p.x - pq[62]) + (p.y - pq[63]) * (p.y - pq[63])) > tpDist;
        cool.TryGetValue(p, out int cd);
        cd = tp ? 4 : Math.Max(0, cd - 1);
        cool[p] = cd;
        if (pq != null && !tp && cd == 0 && !(p.hitT > 0) && pq[64] > 0)
        {
            double worst = 0; int wj = -1;
            foreach (int j in ch)
            {
                double v = Math.Abs(UH.W(q[j] - pq[j]) - UH.W(pq[j] - pq[31 + j]));
                if (j == 9) v = Math.Abs(q[j] - 2 * pq[j] + pq[31 + j]);
                if (v > worst) { worst = v; wj = j; }
                J.Add(tag, v);
            }
            string k = tag;
            if (!WorstAt.ContainsKey(k) || worst > double.Parse(WorstAt[k].Split(' ')[0], CultureInfo.InvariantCulture))
                WorstAt[k] = UH.F(worst) + " " + (wj >= 0 ? Pose.QK[wj] : "?") + " t" + UH.F(Sim.T, 2) + " " + p.n + " md " + p.mode + " sv " + p.sv;
        }
        var nq = pq ?? new double[65];
        for (int j = 0; j < 31; j++) { nq[31 + j] = pq != null && !tp ? nq[j] : q[j]; nq[j] = q[j]; }
        nq[62] = p.x; nq[63] = p.y; nq[64] = pq != null && !tp ? 1 : 0;
        prev[p] = nq;
    }
    public string Report(int minN = 200)
    {
        var keys = new List<string>(J.B.Keys);
        keys.Sort(StringComparer.Ordinal);
        var s = new System.Text.StringBuilder();
        foreach (var k in keys)
        {
            var l = J.B[k];
            if (l.Count < minN) continue;
            s.Append("  ").Append(k.PadRight(11)).Append(" p99.9 ").Append(UH.F(Buckets.Pct(l, 0.999))).Append("  max ").Append(UH.F(Buckets.Max(l), 2)).Append("  n ").Append(l.Count).Append('\n');
        }
        return s.ToString();
    }
}
