// JS Math, bit for bit: the transcendental functions as V8 computes them (fdlibm, src/base/ieee754.cc), so the C# core
// gives exactly the same doubles as the TypeScript reference in Node / Chrome. System.Math (the platform libm) differs
// in the last bit for ~3-18% of arguments (sin, cos, tan, atan, atan2, acos, asin, exp): the lockstep twins drifted
// apart by 1e-15 a tick, a held ball (float32) amplified it, and a branch flipped a few thousand ticks in.
// Verified against V8 on 200k+ random arguments per function (0 mismatches).
using System;

namespace Hoops.Core
{
    public static class JsMath
    {
        static int Hi(double x) => (int)(BitConverter.DoubleToInt64Bits(x) >> 32);
        static uint Lo(double x) => (uint)BitConverter.DoubleToInt64Bits(x);
        static double Words(int hi, uint lo) => BitConverter.Int64BitsToDouble(((long)hi << 32) | lo);
        static double ZeroLo(double x) => BitConverter.Int64BitsToDouble(BitConverter.DoubleToInt64Bits(x) & unchecked((long)0xFFFFFFFF00000000UL));

        // ---- argument reduction (|x| up to 2^19 pi/2; beyond that - never in a game - System.Math) ----
        const double invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
            pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
            pio2_3t = 8.47842766036889956997e-32;
        static readonly int[] npio2_hw = {
            0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
            0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A,
            0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
            0x404858EB, 0x404921FB };
        /// <summary>x = n pi/2 + (y0 + y1); returns n. Valid while |x| &lt;= 2^19 pi/2 (else returns int.MinValue).</summary>
        static int RemPio2(double x, out double y0, out double y1)
        {
            int hx = Hi(x), ix = hx & 0x7fffffff;
            double z;
            if (ix <= 0x3fe921fb) { y0 = x; y1 = 0; return 0; }
            if (ix < 0x4002d97c)
            {
                if (hx > 0)
                {
                    z = x - pio2_1;
                    if (ix != 0x3ff921fb) { y0 = z - pio2_1t; y1 = (z - y0) - pio2_1t; }
                    else { z -= pio2_2; y0 = z - pio2_2t; y1 = (z - y0) - pio2_2t; }
                    return 1;
                }
                z = x + pio2_1;
                if (ix != 0x3ff921fb) { y0 = z + pio2_1t; y1 = (z - y0) + pio2_1t; }
                else { z += pio2_2; y0 = z + pio2_2t; y1 = (z - y0) + pio2_2t; }
                return -1;
            }
            if (ix <= 0x413921fb)
            {
                double t = Math.Abs(x);
                int n = (int)(t * invpio2 + 0.5);
                double fn = n, r = t - fn * pio2_1, w = fn * pio2_1t;
                if (n < 32 && ix != npio2_hw[n - 1]) y0 = r - w;
                else
                {
                    int j = ix >> 20;
                    y0 = r - w;
                    int i = j - ((Hi(y0) >> 20) & 0x7ff);
                    if (i > 16)
                    {
                        t = r;
                        w = fn * pio2_2;
                        r = t - w;
                        w = fn * pio2_2t - ((t - r) - w);
                        y0 = r - w;
                        i = j - ((Hi(y0) >> 20) & 0x7ff);
                        if (i > 49)
                        {
                            t = r;
                            w = fn * pio2_3;
                            r = t - w;
                            w = fn * pio2_3t - ((t - r) - w);
                            y0 = r - w;
                        }
                    }
                }
                y1 = (r - y0) - w;
                if (hx < 0) { y0 = -y0; y1 = -y1; return -n; }
                return n;
            }
            y0 = y1 = 0;
            return int.MinValue;
        }

        const double S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
            S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
        static double KSin(double x, double y, int iy)
        {
            int ix = Hi(x) & 0x7fffffff;
            if (ix < 0x3e400000 && (int)x == 0) return x;
            double z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
            if (iy == 0) return x + v * (S1 + z * r);
            return x - ((z * (0.5 * y - v * r) - y) - v * S1);
        }
        const double C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
            C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
        static double KCos(double x, double y)
        {
            int ix = Hi(x) & 0x7fffffff;
            if (ix < 0x3e400000 && (int)x == 0) return 1.0;
            double z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
            if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y));
            double qx = ix > 0x3fe90000 ? 0.28125 : Words(ix - 0x00200000, 0);
            double hz = 0.5 * z - qx, a = 1.0 - qx;
            return a - (hz - (z * r - x * y));
        }
        static readonly double[] TT = {
            3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02,
            8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
            2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
            2.59073051863633712884e-05 };
        const double pio4 = 7.85398163397448278999e-01, pio4lo = 3.06161699786838301793e-17;
        static double KTan(double x, double y, int iy)
        {
            double z, r, v, w, s;
            int hx = Hi(x), ix = hx & 0x7fffffff;
            if (ix < 0x3e300000 && (int)x == 0)
            {
                if (((ix | (int)Lo(x)) | (iy + 1)) == 0) return 1.0 / Math.Abs(x);
                if (iy == 1) return x;
                double a0, t0;
                z = w = x + y;
                z = ZeroLo(z);
                v = y - (z - x);
                t0 = a0 = -1.0 / w;
                t0 = ZeroLo(t0);
                s = 1.0 + t0 * z;
                return t0 + a0 * (s + t0 * v);
            }
            if (ix >= 0x3FE59428)
            {
                if (hx < 0) { x = -x; y = -y; }
                z = pio4 - x;
                w = pio4lo - y;
                x = z + w;
                y = 0.0;
            }
            z = x * x;
            w = z * z;
            r = TT[1] + w * (TT[3] + w * (TT[5] + w * (TT[7] + w * (TT[9] + w * TT[11]))));
            v = z * (TT[2] + w * (TT[4] + w * (TT[6] + w * (TT[8] + w * (TT[10] + w * TT[12])))));
            s = z * x;
            r = y + z * (s * (r + v) + y);
            r += TT[0] * s;
            w = x + r;
            if (ix >= 0x3FE59428)
            {
                v = iy;
                return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
            }
            if (iy == 1) return w;
            double a, t;
            z = ZeroLo(w);
            v = r - (z - x);
            t = a = -1.0 / w;
            t = ZeroLo(t);
            s = 1.0 + t * z;
            return t + a * (s + t * v);
        }

        public static double Sin(double x)
        {
            int ix = Hi(x) & 0x7fffffff;
            if (ix <= 0x3fe921fb) return KSin(x, 0, 0);
            if (ix >= 0x7ff00000) return x - x;
            int n = RemPio2(x, out double y0, out double y1);
            if (n == int.MinValue) return Math.Sin(x);
            switch (n & 3)
            {
                case 0: return KSin(y0, y1, 1);
                case 1: return KCos(y0, y1);
                case 2: return -KSin(y0, y1, 1);
                default: return -KCos(y0, y1);
            }
        }
        public static double Cos(double x)
        {
            int ix = Hi(x) & 0x7fffffff;
            if (ix <= 0x3fe921fb) return KCos(x, 0);
            if (ix >= 0x7ff00000) return x - x;
            int n = RemPio2(x, out double y0, out double y1);
            if (n == int.MinValue) return Math.Cos(x);
            switch (n & 3)
            {
                case 0: return KCos(y0, y1);
                case 1: return -KSin(y0, y1, 1);
                case 2: return -KCos(y0, y1);
                default: return KSin(y0, y1, 1);
            }
        }
        public static double Tan(double x)
        {
            int ix = Hi(x) & 0x7fffffff;
            if (ix <= 0x3fe921fb) return KTan(x, 0, 1);
            if (ix >= 0x7ff00000) return x - x;
            int n = RemPio2(x, out double y0, out double y1);
            if (n == int.MinValue) return Math.Tan(x);
            return KTan(y0, y1, 1 - ((n & 1) << 1));
        }

        static readonly double[] atanhi = { 4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00 },
            atanlo = { 2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17 },
            aT = { 3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
                9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
                4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02 };
        public static double Atan(double x)
        {
            int hx = Hi(x), ix = hx & 0x7fffffff, id;
            if (ix >= 0x44100000)
            {
                if (double.IsNaN(x)) return x + x;
                return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
            }
            if (ix < 0x3fdc0000)
            {
                if (ix < 0x3e400000) return x;
                id = -1;
            }
            else
            {
                x = Math.Abs(x);
                if (ix < 0x3ff30000)
                {
                    if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
                    else { id = 1; x = (x - 1.0) / (x + 1.0); }
                }
                else
                {
                    if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); }
                    else { id = 3; x = -1.0 / x; }
                }
            }
            double z = x * x, w = z * z,
                s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10]))))),
                s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
            if (id < 0) return x - x * (s1 + s2);
            z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
            return hx < 0 ? -z : z;
        }
        const double tiny = 1.0e-300, pi_o_2 = 1.5707963267948965580E+00, pi = 3.1415926535897931160E+00, pi_lo = 1.2246467991473531772E-16;
        public static double Atan2(double y, double x)
        {
            if (double.IsNaN(x) || double.IsNaN(y)) return x + y;
            if (double.IsInfinity(x) || double.IsInfinity(y)) return Math.Atan2(y, x); // (never in a game; ieee754 agrees there)
            int hx = Hi(x), ix = hx & 0x7fffffff, hy = Hi(y), iy = hy & 0x7fffffff;
            uint lx = Lo(x), ly = Lo(y);
            if (((hx - 0x3ff00000) | (int)lx) == 0) return Atan(y);
            int m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
            if ((iy | (int)ly) == 0)
            {
                switch (m)
                {
                    case 0:
                    case 1: return y;
                    case 2: return pi + tiny;
                    default: return -pi - tiny;
                }
            }
            if ((ix | (int)lx) == 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
            int k = (iy - ix) >> 20;
            double z;
            if (k > 60) { z = pi_o_2 + 0.5 * pi_lo; m &= 1; }
            else if (hx < 0 && k < -60) z = 0.0;
            else z = Atan(Math.Abs(y / x));
            switch (m)
            {
                case 0: return z;
                case 1: return -z;
                case 2: return pi - (z - pi_lo);
                default: return (z - pi_lo) - pi;
            }
        }

        const double pio2_hi = 1.57079632679489655800e+00, pio2_lo = 6.12323399573676603587e-17, pio4_hi = 7.85398163397448278999e-01,
            pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01,
            pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05,
            qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01,
            qS4 = 7.70381505559019352791e-02;
        public static double Acos(double x)
        {
            int hx = Hi(x), ix = hx & 0x7fffffff;
            double z, p, q, r, w, s, c, df;
            if (ix >= 0x3ff00000)
            {
                if (((ix - 0x3ff00000) | (int)Lo(x)) == 0) return hx > 0 ? 0.0 : pi + 2.0 * pio2_lo;
                return double.NaN;
            }
            if (ix < 0x3fe00000)
            {
                if (ix <= 0x3c600000) return pio2_hi + pio2_lo;
                z = x * x;
                p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
                q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
                r = p / q;
                return pio2_hi - (x - (pio2_lo - x * r));
            }
            if (hx < 0)
            {
                z = (1.0 + x) * 0.5;
                p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
                q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
                s = Math.Sqrt(z);
                r = p / q;
                w = r * s - pio2_lo;
                return pi - 2.0 * (s + w);
            }
            z = (1.0 - x) * 0.5;
            s = Math.Sqrt(z);
            df = ZeroLo(s);
            c = (z - df * df) / (s + df);
            p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
            q = 1.0 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
            r = p / q;
            w = r * s + c;
            return 2.0 * (df + w);
        }
        public static double Asin(double x)
        {
            int hx = Hi(x), ix = hx & 0x7fffffff;
            double t, w, p, q, c, r, s;
            if (ix >= 0x3ff00000)
            {
                if (((ix - 0x3ff00000) | (int)Lo(x)) == 0) return x * pio2_hi + x * pio2_lo;
                return double.NaN;
            }
            if (ix < 0x3fe00000)
            {
                if (ix < 0x3e400000) return x;
                t = x * x;
                p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
                q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
                w = p / q;
                return x + x * w;
            }
            w = 1.0 - Math.Abs(x);
            t = w * 0.5;
            p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
            q = 1.0 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
            s = Math.Sqrt(t);
            if (ix >= 0x3FEF3333)
            {
                w = p / q;
                t = pio2_hi - (2.0 * (s + s * w) - pio2_lo);
            }
            else
            {
                w = ZeroLo(s);
                c = (t - w * w) / (s + w);
                r = p / q;
                p = 2.0 * s * r - (pio2_lo - 2.0 * c);
                q = pio4_hi - 2.0 * w;
                t = pio4_hi - (p - q);
            }
            return hx > 0 ? t : -t;
        }

        const double o_threshold = 7.09782712893383973096e+02, u_threshold = -7.45133219101941108420e+02, invln2 = 1.44269504088896338700e+00,
            P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
            P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, twom1000 = 9.33263618503218878990e-302,
            two1023 = 8.988465674311579539e307;
        static readonly double[] halF = { 0.5, -0.5 }, ln2HI = { 6.93147180369123816490e-01, -6.93147180369123816490e-01 },
            ln2LO = { 1.90821492927058770002e-10, -1.90821492927058770002e-10 };
        public static double Exp(double x)
        {
            double y, hi = 0, lo = 0, c, t, twopk;
            int k = 0, hx = Hi(x), xsb = (hx >> 31) & 1;
            hx &= 0x7fffffff;
            if (hx >= 0x40862E42)
            {
                if (hx >= 0x7ff00000) return Math.Exp(x); // NaN / +-inf
                if (x > o_threshold) return double.PositiveInfinity;
                if (x < u_threshold) return 0.0;
            }
            if (hx > 0x3fd62e42)
            {
                if (hx < 0x3FF0A2B2)
                {
                    if (x == 1.0) return 2.718281828459045; // (V8: E exactly)
                    hi = x - ln2HI[xsb];
                    lo = ln2LO[xsb];
                    k = 1 - xsb - xsb;
                }
                else
                {
                    k = (int)(invln2 * x + halF[xsb]);
                    t = k;
                    hi = x - t * ln2HI[0];
                    lo = t * ln2LO[0];
                }
                x = hi - lo;
            }
            else if (hx < 0x3e300000) return 1.0 + x;
            else k = 0;
            t = x * x;
            twopk = k >= -1021 ? Words(0x3ff00000 + (k << 20), 0) : Words(0x3ff00000 + ((k + 1000) << 20), 0);
            c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
            if (k == 0) return 1.0 - ((x * c) / (c - 2.0) - x);
            y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
            if (k >= -1021)
            {
                if (k == 1024) return y * 2.0 * two1023;
                return y * twopk;
            }
            return y * twopk * twom1000;
        }
    }
}
