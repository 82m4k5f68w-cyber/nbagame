// Sound for the Unity build: the browser's WebAudio synths (src/client/audio.ts) rendered into AudioClips from code -
// tones for the sim's "s" effects, ball bounces (heard by watching the ball's height, like the browser), whistle,
// the crowd's "ooh" and a looping crowd bed that swells with excitement. No audio assets. Crowd chants (DE-FENSE,
// LET'S GO, M-V-P, AIR BALL, boos, roars ...) live in Chants.cs: every FX is forwarded there.
using System;
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class GameAudio : MonoBehaviour
    {
        const int SR = 44100;
        AudioSource fx, bed;
        AudioClip bounce, whistle, ooh;
        readonly Dictionary<long, AudioClip> tones = new();
        public static float EXC = 0.3f;
        public static float CrowdVol = 1f; // crowd level: bed, "ooh" and chants (page Audio settings "vc", PageBridge)
        public static float Hush = 1f; // Chants: the bed goes quiet for a clutch home free throw
        double lastBz;
        bool wasDown;
        System.Random rnd = new System.Random(5);

        void Awake()
        {
            fx = gameObject.AddComponent<AudioSource>();
            fx.playOnAwake = false;
            bed = gameObject.AddComponent<AudioSource>();
            bed.loop = true;
            bed.volume = 0.15f;
            bed.clip = Make("crowd", 2f, (i, t) => Noise(), bp: (700, 0.6f));
            bed.Play();
            bounce = Bounce();
            whistle = Make("whistle", 0.5f, (i, t) => Math.Sin(2 * Math.PI * (2900 * t + 140 / (2 * Math.PI * 38) * -Math.Cos(2 * Math.PI * 38 * t))) * Env(t, 0.02, 0.32, 0.45) * 0.6);
            ooh = Ooh();
            if (GetComponent<Chants>() == null) gameObject.AddComponent<Chants>();
        }

        double Noise() => rnd.NextDouble() * 2 - 1;
        static double Env(double t, double att, double hold, double end) => t < att ? t / att : t < hold ? 1 : Math.Max(0, 1 - (t - hold) / (end - hold));

        /// <summary>Render a mono clip; optional RBJ band-pass (centre Hz, Q).</summary>
        AudioClip Make(string name, float sec, Func<int, double, double> f, (double f, float q)? bp = null, Func<double, double> bpf = null)
        {
            int n = (int)(SR * sec);
            var d = new float[n];
            double b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
            void Coef(double fc, double q)
            {
                double w = 2 * Math.PI * fc / SR, al = Math.Sin(w) / (2 * q), a0 = 1 + al;
                b0 = al / a0; b1 = 0; b2 = -al / a0; a1 = -2 * Math.Cos(w) / a0; a2 = (1 - al) / a0;
            }
            if (bp.HasValue) Coef(bp.Value.f, bp.Value.q);
            for (int i = 0; i < n; i++)
            {
                double t = (double)i / SR, x = f(i, t), y = x;
                if (bp.HasValue)
                {
                    if (bpf != null && (i & 63) == 0) Coef(bpf(t), bp.Value.q);
                    y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                    x2 = x1; x1 = x; y2 = y1; y1 = y;
                }
                d[i] = (float)y;
            }
            var c = AudioClip.Create(name, n, 1, SR, false);
            c.SetData(d, 0);
            return c;
        }

        AudioClip Bounce()
        {
            // pitched-down thump (150 -> 55 Hz) + a slap of band-passed noise
            var thump = Make("thump", 0.12f, (i, t) => Math.Sin(2 * Math.PI * (150 * 0.09 / Math.Log(150 / 55.0)) * (1 - Math.Exp(-Math.Log(150 / 55.0) * t / 0.09))) * Math.Exp(-t * 60) * 1.6);
            var slap = Make("slap", 0.03f, (i, t) => Noise() * (1 - t / 0.03), bp: (1800, 0.9f));
            var a = new float[thump.samples];
            var b = new float[slap.samples];
            thump.GetData(a, 0);
            slap.GetData(b, 0);
            for (int i = 0; i < b.Length; i++) a[i] += b[i] * 0.5f;
            var c = AudioClip.Create("bounce", a.Length, 1, SR, false);
            c.SetData(a, 0);
            return c;
        }

        AudioClip Ooh() => Make("ooh", 1.4f, (i, t) => Noise() * (t < 0.25 ? t / 0.25 : Math.Exp(-(t - 0.25) * 4)) * 1.6, bp: (520, 6f), bpf: t => 520 * Math.Pow(330 / 520.0, Math.Min(1, t / 1.2)));

        /// <summary>The sim's snd(f, d, type, v): an oscillator with an exponential decay (cached per sound).</summary>
        public void Tone(double f, double d, string ty, double v)
        {
            long key = ((long)Math.Round(f) << 24) ^ ((long)Math.Round(d * 1000) << 4) ^ (ty?.GetHashCode() ?? 0) & 15;
            if (!tones.TryGetValue(key, out var c))
            {
                double k = Math.Log(0.0001) / d;
                c = Make("tone", (float)d, (i, t) =>
                {
                    double ph = (f * t) % 1.0;
                    double w = ty == "square" ? (ph < 0.5 ? 1 : -1) : ty == "sawtooth" ? 2 * ph - 1 : ty == "triangle" ? 1 - 4 * Math.Abs(ph - 0.5) : Math.Sin(2 * Math.PI * ph);
                    return w * Math.Exp(k * t);
                });
                tones[key] = c;
            }
            fx.PlayOneShot(c, Mathf.Clamp01((float)v * 4f));
        }

        /// <summary>Consume the sim's sound effects (called before GameMain drains FX).</summary>
        public void OnFx(Fx f)
        {
            Chants.OnFx(f);
            switch (f.k)
            {
                case "s": Tone(f.f, f.d, f.ty, f.v); break;
                case "whistle": fx.PlayOneShot(whistle, 0.8f); break;
                case "ooh": fx.PlayOneShot(ooh, 0.9f * CrowdVol); break;
                case "x": EXC = Mathf.Min(1, EXC + (float)Math.Max(0.15, f.v) * 0.6f); break;
            }
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            EXC = Mathf.Max(0.2f, EXC - dt * 0.25f);
            bed.volume = (0.08f + 0.45f * EXC) * CrowdVol * Hush;
            // dribble / loose-ball bounces: the ball reached the floor this frame
            bool down = B.z < BR + 1.5;
            if (down && !wasDown && lastBz > B.z && (S == "play" || RPL != null))
                fx.PlayOneShot(bounce, Mathf.Clamp01((float)(0.4 + Math.Min(1, Math.Abs(B.vz) / 200))));
            wasDown = down;
            lastBz = B.z;
        }
    }
}
