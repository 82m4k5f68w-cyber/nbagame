// Player (port of sim.ts mkP + every field the sim/pose/modes code hangs on a player). Partial: each ported file may
// add the fields only it uses in its own `partial class Player` block (see unity/PORTING.md).
namespace Hoops.Core
{
    public partial class Player
    {
        // ---- identity / ratings (mkP) ----
        public string n, col, skin;
        public double c, i, s, d, j, st, tm, k, hr, bd, ht, bk, no;
        public double rid;
        public double hJ = -9; // time of the human's own last jump press (goaltending)
        public Form sg;
        public bool my;
        // ---- kinematics ----
        public double x, y, z, vx, vy, vz, f, ph;
        public string mode = "i"; // i idle/move, c charge, s shot, ...
        public double t, cd, rl, mt, slow, sbw, sv, pf, bn = 1, bx, by, en = 1, cold;
        public double? tp;
        public double[] hzm = new double[6];
        public PlayerAi ai = new PlayerAi();
        public Input @in = new Input();
        public Stats stt = new Stats();
        public Scout sk;
    }

    /// <summary>The player's AI memory (sim.ts p.ai = {}). Reset by assigning a new instance.</summary>
    public partial class PlayerAi { }
}
