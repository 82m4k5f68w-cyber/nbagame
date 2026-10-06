// Verifies the Unity rig's bone-chain math (unity/Assets/Scripts/Game/Rig.cs) against the core's FK: the rig mirrors
// three.js's right-handed frame into Unity's (z flipped), negating the X and Y Euler angles and keeping the order. This
// file replicates exactly what Rig.cs does to its Transforms (offsets with z negated, PlayerRig.E rotations, root
// position / yaw / scale, Unity's parent * T * R * S composition) in doubles, then compares hand, head, chest, knee,
// ankle, toe, elbow, wrist positions with Pose.skeleton() and the palm with Pose.handPos() for poses from real CPU
// games (incl. lefty mirrored shots) and random joint values. It also checks that the footIK solve (same sign
// conversions as PlayerRig.FootIK) puts the ankle on its plant.
//   scripts/unity/cs.sh unity/CoreTests/RigCheck.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class RigCheck
{
    struct V { public double x, y, z; public V(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
        public static V operator +(V a, V b) => new V(a.x + b.x, a.y + b.y, a.z + b.z);
        public static V operator -(V a, V b) => new V(a.x - b.x, a.y - b.y, a.z - b.z);
        public static V operator *(V a, double s) => new V(a.x * s, a.y * s, a.z * s); }
    struct Qd
    {
        public double x, y, z, w;
        public Qd(double x, double y, double z, double w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Qd I => new Qd(0, 0, 0, 1);
        public static Qd operator *(Qd a, Qd b) => new Qd(
            a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
        public V Rot(V v) // q v q*
        {
            double tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
            return new V(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
        }
        public Qd Inv => new Qd(-x, -y, -z, w);
    }
    // ---- PlayerRig.E (three Euler -> Z-mirrored Unity rotation) ----
    const int XYZ = 0, YXZ = 1, XZY = 2;
    static Qd AX(double a) => new Qd(Math.Sin(a / 2), 0, 0, Math.Cos(a / 2));
    static Qd AY(double a) => new Qd(0, Math.Sin(a / 2), 0, Math.Cos(a / 2));
    static Qd AZ(double a) => new Qd(0, 0, Math.Sin(a / 2), Math.Cos(a / 2));
    static Qd E(double x, double y, double z, int o)
    {
        Qd qx = AX(-x), qy = AY(-y), qz = AZ(z);
        return o == XYZ ? qx * qy * qz : o == YXZ ? qy * qx * qz : qx * qz * qy;
    }

    // bones used by the check (Rig.cs indices/parents/offsets, three space; z negated when placed)
    enum B { G, hips, bd, ch, nk, hd, tl, tr, kl, kr, al, ar, sL, sR, eL, eR, wL, wR, N }
    sealed class Node { public int par; public V off; public Qd lr = Qd.I; public V wp; public Qd wr; public double ws; }
    static Node[] nodes;

    static void Build(Player p)
    {
        var R = Pose.RIG;
        double k = p.bk;
        nodes = new Node[(int)B.N];
        void S(B b, B par, double x, double y, double z) => nodes[(int)b] = new Node { par = (int)par, off = new V(x, y, -z) };
        nodes[(int)B.G] = new Node { par = -1 };
        S(B.hips, B.G, 0, 0, 0);
        S(B.bd, B.hips, 0, R.hip, 0);
        S(B.ch, B.bd, 0, R.chest, 0);
        S(B.nk, B.ch, 0, R.neck, 0);
        S(B.hd, B.nk, 0, R.head, 0);
        S(B.tl, B.hips, -R.hipX, R.hip, 0);
        S(B.tr, B.hips, R.hipX, R.hip, 0);
        S(B.kl, B.tl, 0, -R.L1, 0);
        S(B.kr, B.tr, 0, -R.L1, 0);
        S(B.al, B.kl, 0, -R.L2, 0);
        S(B.ar, B.kr, 0, -R.L2, 0);
        S(B.sL, B.ch, -R.shX * k, R.sh, 0);
        S(B.sR, B.ch, R.shX * k, R.sh, 0);
        S(B.eL, B.sL, 0, -R.ua, 0);
        S(B.eR, B.sR, 0, -R.ua, 0);
        S(B.wL, B.eL, 0, -R.fa, 0);
        S(B.wR, B.eR, 0, -R.fa, 0);
    }
    static Qd EX(double a) => AX(-a);
    // ---- PlayerRig.ApplyPose ----
    static void Apply(Player p)
    {
        var q = p.q;
        var g = nodes[(int)B.G];
        g.off = new V((p.x - 470) * 0.1, p.z * 0.1 - q.cr * 0.4, -((p.y - 250) * 0.1));
        g.lr = AY(-(Math.PI / 2 - Pose.fv(p)));
        g.ws = p.ht / 6.4;
        L(B.tl).lr = E(-q.tL, 0, Pose.hipAb(q, -1), XYZ);
        L(B.tr).lr = E(-q.tR, 0, Pose.hipAb(q, 1), XYZ);
        L(B.kl).lr = EX(q.kL); L(B.kr).lr = EX(q.kR);
        L(B.al).lr = EX(q.fL); L(B.ar).lr = EX(q.fR);
        L(B.ch).lr = E(q.cx, q.cy, 0, YXZ);
        L(B.nk).lr = EX(q.nk);
        L(B.hd).lr = E(q.hp, q.hy, 0, YXZ);
        L(B.sL).lr = E(-q.aL, q.hL, -q.zL, XZY);
        L(B.sR).lr = E(-q.aR, -q.hR, q.sz, XZY);
        L(B.eL).lr = EX(-q.eL); L(B.eR).lr = EX(-q.eR);
        L(B.wL).lr = E(-q.wL, q.oL, 0, YXZ);
        L(B.wR).lr = E(-q.wR, q.oR, 0, YXZ);
        L(B.bd).lr = E(q.ln, q.ty, q.rz, YXZ);
        World();
    }
    static Node L(B b) => nodes[(int)b];
    // Unity Transform composition (uniform scale on the root only): world = parent.pos + parent.rot * (scale * off)
    static void World()
    {
        foreach (var n in nodes)
        {
            if (n.par < 0) { n.wp = n.off; n.wr = n.lr; continue; }
            var pa = nodes[n.par];
            n.ws = pa.ws;
            n.wp = pa.wp + pa.wr.Rot(n.off * pa.ws);
            n.wr = pa.wr * n.lr;
        }
    }
    static V TP(B b, double x, double y, double z) { var n = L(b); return n.wp + n.wr.Rot(new V(x, y, -z) * n.ws); } // Transform.TransformPoint of a three-space local point
    static V Game(V u) => new V(u.x * 10 + 470, -u.z * 10 + 250, u.y * 10);

    static double worst;
    static string worstAt = "";
    static void Cmp(string what, V a, float[] sk, int j)
    {
        double d = Math.Sqrt(Sq(a.x - sk[j * 3]) + Sq(a.y - sk[j * 3 + 1]) + Sq(a.z - sk[j * 3 + 2]));
        if (d > worst) { worst = d; worstAt = what; }
    }
    static void Cmp(string what, V a, double[] h)
    {
        double d = Math.Sqrt(Sq(a.x - h[0]) + Sq(a.y - h[1]) + Sq(a.z - h[2]));
        if (d > worst) { worst = d; worstAt = what; }
    }
    static double Sq(double v) => v * v;

    static readonly float[] SK = new float[60];
    static int checkedPoses, mirrored;
    static void Check(Player p, string tag)
    {
        if (p.q == null) return;
        Build(p);
        Apply(p);
        Pose.skeleton(p, SK);
        Cmp(tag + " pelvis", Game(TP(B.bd, 0, 0, 0)), SK, 0);
        Cmp(tag + " chest", Game(TP(B.ch, 0, 0.5, 0)), SK, 1);
        Cmp(tag + " neck", Game(TP(B.nk, 0, 0, 0)), SK, 2);
        Cmp(tag + " head", Game(TP(B.hd, 0, 0.44, 0)), SK, 3);
        for (int s = 0; s < 2; s++)
        {
            int j = 4 + s * 4, a = 12 + s * 4;
            B th = s == 0 ? B.tl : B.tr, kn = s == 0 ? B.kl : B.kr, an = s == 0 ? B.al : B.ar, sh = s == 0 ? B.sL : B.sR, el = s == 0 ? B.eL : B.eR, wr = s == 0 ? B.wL : B.wR;
            string sd = s == 0 ? " L" : " R";
            Cmp(tag + sd + " hip", Game(TP(th, 0, 0, 0)), SK, j);
            Cmp(tag + sd + " knee", Game(TP(kn, 0, 0, 0)), SK, j + 1);
            Cmp(tag + sd + " ankle", Game(TP(an, 0, 0, 0)), SK, j + 2);
            Cmp(tag + sd + " toe", Game(TP(an, 0, -0.06, 0.52)), SK, j + 3);
            Cmp(tag + sd + " shoulder", Game(TP(sh, 0, 0, 0)), SK, a);
            Cmp(tag + sd + " elbow", Game(TP(el, 0, 0, 0)), SK, a + 1);
            Cmp(tag + sd + " wrist", Game(TP(wr, 0, 0, 0)), SK, a + 2);
            Cmp(tag + sd + " hand", Game(TP(wr, 0, -0.32, 0.05)), SK, a + 3);
        }
        bool mir = Util.T(p.q.mir);
        if (mir) mirrored++;
        Cmp(tag + " palm" + (mir ? " (lefty)" : ""), Game(TP(mir ? B.wL : B.wR, 0, -0.62, 0.1)), Pose.handPos(p));
        checkedPoses++;
    }

    // ---- PlayerRig.FootIK's solve: unity-local target -> three angles -> rotations; the ankle must land on it ----
    static double IkWorst;
    static void IkCheck(Player p, Random r)
    {
        Build(p);
        var q = p.q;
        q.hz = q.hs = 0; // the IK works in the leg's sagittal plane
        Apply(p);
        for (int s = 0; s < 2; s++)
        {
            B th = s == 0 ? B.tl : B.tr, kn = s == 0 ? B.kl : B.kr;
            // target: where the ankle would be with other hip/knee angles
            double t0 = -0.6 + r.NextDouble() * 1.4, k0 = 0.2 + r.NextDouble() * 1.5; // within reach (the solve clamps to L1 + L2 - .01 ft)
            var keep = L(th).lr; var keepK = L(kn).lr;
            L(th).lr = E(-t0, 0, 0, XYZ); L(kn).lr = EX(k0); World();
            V target = TP(kn, 0, -Pose.RIG.L2, 0);
            L(th).lr = keep; L(kn).lr = keepK; World();
            // hip -> target in the hip's parent frame (InverseTransformPoint), minus the local position
            var par = nodes[L(th).par];
            V loc = par.wr.Inv.Rot(target - par.wp) * (1 / par.ws) - L(th).off;
            double L1 = Pose.RIG.L1, L2 = Pose.RIG.L2, dy = loc.y, dz = -loc.z,
                d = Math.Min(L1 + L2 - 0.01, Math.Max(0.4, Math.Sqrt(dy * dy + dz * dz))),
                a1 = Math.Acos(Math.Clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)),
                tIK = Math.Atan2(dz, -dy) + a1,
                kIK = Math.PI - Math.Acos(Math.Clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
            L(th).lr = E(-tIK, 0, 0, XYZ); // thx = -(tIK) at full weight
            L(kn).lr = EX(kIK);
            World();
            V got = TP(kn, 0, -L2, 0) - target;
            IkWorst = Math.Max(IkWorst, Math.Sqrt(got.x * got.x + got.y * got.y + got.z * got.z) * 10);
        }
    }

    static void Main()
    {
        Rng.Seed(77);
        cfg.NP = 5; cfg.physics = "legacy"; cfg.MYM = 0; cfg.DIFF = 2;
        cfg.input = c => new Input();
        var rnd = new Random(5);
        // 1) poses from CPU games (every team, so the lefty and the big/small builds all show up)
        for (int g = 0; g < 4; g++)
        {
            setQtrLen(60);
            setCtrls(new List<Ctrl>());
            start(g % 7, new StartOpts { j = (g + 3) % 7 });
            for (int t = 0; t < 2400 && S != "over"; t++)
            {
                upd(1 / 60.0);
                if (RPL != null) skipReplay();
                FX.Clear();
                if (S == "half") setS("play");
                if (t % 5 == 0) foreach (var p in P) Check(p, $"game {g} tick {t} {p.n} {p.mode}");
            }
        }
        double gameWorst = worst;
        string gameAt = worstAt;
        // 2) random joint values on every channel (wide ranges, odd facings / heights / builds, mirrored or not)
        worst = 0;
        var pr = P[0];
        for (int i = 0; i < 3000; i++)
        {
            var q = new Q();
            for (int j = 0; j < 31; j++) q[j] = (rnd.NextDouble() - 0.5) * (j == 9 ? 2 : 5);
            q.mir = rnd.NextDouble() < 0.3 ? 1 : 0;
            pr.q = q;
            pr.f = rnd.NextDouble() * 12 - 6;
            pr.ry = rnd.NextDouble() < 0.3 ? rnd.NextDouble() * 3 : 0;
            pr.ht = 5.8 + rnd.NextDouble() * 1.6;
            pr.bk = 0.85 + rnd.NextDouble() * 0.35;
            pr.x = rnd.NextDouble() * 940; pr.y = rnd.NextDouble() * 500; pr.z = rnd.NextDouble() * 40;
            Check(pr, $"random {i}");
            IkCheck(pr, rnd);
        }
        Console.WriteLine($"game poses: {checkedPoses} checked ({mirrored} lefty-mirrored so far), worst joint error {gameWorst:E2} px at {gameAt}");
        Console.WriteLine($"random poses: worst joint error {worst:E2} px at {worstAt}");
        Console.WriteLine($"foot IK reach error (planted ankle vs target): worst {IkWorst:E2} px");
        bool ok = gameWorst < 1e-3 && worst < 1e-3 && IkWorst < 1e-3;
        Console.WriteLine(ok ? "RIG CHECK OK" : "RIG CHECK FAILED");
        Environment.Exit(ok ? 0 : 1);
    }
}
