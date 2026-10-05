// JS-compatible helpers for the port: rounding, stable sorts, spread-max, angle wrap.
using System;
using System.Collections.Generic;

namespace Hoops.Core
{
    public static class Util
    {
        /// <summary>JS Math.round: halves round toward +infinity.</summary>
        public static double Round(double v) => Math.Floor(v + 0.5);
        public static double Clamp(double v, double a, double b) => Math.Max(a, Math.Min(b, v));
        public static double Sign(double v) => v > 0 ? 1 : v < 0 ? -1 : 0; // JS Math.sign (NaN aside)
        /// <summary>JS Array.prototype.sort is stable; List.Sort is not. Insertion sort for the small lists the sim sorts.</summary>
        public static void SortStable<T>(List<T> l, Comparison<T> cmp)
        {
            for (int i = 1; i < l.Count; i++)
            {
                var v = l[i];
                int j = i - 1;
                while (j >= 0 && cmp(l[j], v) > 0) { l[j + 1] = l[j]; j--; }
                l[j + 1] = v;
            }
        }
        public static void SortStable<T>(T[] l, Comparison<T> cmp)
        {
            for (int i = 1; i < l.Length; i++)
            {
                var v = l[i];
                int j = i - 1;
                while (j >= 0 && cmp(l[j], v) > 0) { l[j + 1] = l[j]; j--; }
                l[j + 1] = v;
            }
        }
        /// <summary>Comparison from a JS numeric comparator result (sign of a double).</summary>
        public static int Cmp(double d) => d < 0 ? -1 : d > 0 ? 1 : 0;
        public static double Max(double[] a) { double m = double.NegativeInfinity; foreach (var v in a) if (v > m || double.IsNaN(v)) m = v; return m; }
        public static double Min(double[] a) { double m = double.PositiveInfinity; foreach (var v in a) if (v < m || double.IsNaN(v)) m = v; return m; }
        public static double Hypot(double a, double b) => Math.Sqrt(a * a + b * b);
        public static double Hypot(double a, double b, double c) => Math.Sqrt(a * a + b * b + c * c);
        /// <summary>JS `x | 0` (truncate toward zero to int32).</summary>
        public static int I(double v) => double.IsNaN(v) || double.IsInfinity(v) ? 0 : (int)(long)v;
        /// <summary>JS truthiness of a number.</summary>
        public static bool T(double v) => v != 0 && !double.IsNaN(v);
        public static bool T(double? v) => v.HasValue && T(v.Value);
    }
}
