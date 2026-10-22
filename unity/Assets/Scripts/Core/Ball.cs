// The ball (port of sim.ts `B`). Fields the TS code null-checks are nullable; the rest read undefined as 0.
namespace Hoops.Core
{
    public sealed class PassPlan { public Player p; public double t; } // B.pp (pass bookkeeping)

    public sealed class Ball
    {
        public double gd, ghx; // green guide: an intended green make (bstep greenGuide) and its rim x
        public double x, y, z, vx, vy, vz, a, age;
        public string mode = "held"; // held | air | pass
        public Player owner, last, to, flBy, dho, dho2, hold, tgo;
        public bool dhoNull; // TS distinguishes B.dho === null (cleared when the ball is held) from never set (undefined)
        public double sh, sc, three, ptype, fl, ft, gt, gtc, gn, sc2, fb, kk, kick, q, abv, dcd, dh, dhd, dhn = 1, dk, dlat, dmv, dsw, dswd, dswk, dsz, dfl, dvv, dvx, dvy, stk, duckT, tgx, tgy, tgz, oop;
        public double? clk, ctl, cx, d0, dtop, dswf, fr0, lx, ly, rim, gl; // gl: when the shot touched the glass (airball check)
        public double[] wv = new double[3];
        public PassPlan pp;
        public Ball Clone()
        {
            var b = (Ball)MemberwiseClone();
            b.wv = (double[])wv.Clone();
            return b;
        }
    }
}
