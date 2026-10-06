// Cameras (port of the render3d.ts camera block): broadcast (high on the near sideline, following the ball), 2K-style
// low sideline cam, baseline cam, player lock - cycled with K (saved in PlayerPrefs h2k_cam) - plus the replay
// director while Sim.RPL != null (clutch replays: three shots at release / flight / rim; otherwise a slow low orbit on
// the player nearest the ball, looking up when the play is at the rim, with depth of field focused on him), the
// timeout-huddle cut, the final-buzzer drift onto the winners' top scorer, screen shake (Fx "shake") and motion blur
// for the big moments. Targets are computed in three.js world feet like the browser, then mirrored into Unity (Gfx.V3).
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class CameraDirector
    {
        /// <summary>0 broadcast, 1 2K low, 2 baseline, 3 player lock.</summary>
        public static int Mode;
        static readonly string[] NAMES = { "BROADCAST", "2K", "BASELINE", "PLAYER LOCK" };
        static float shake;
        /// <summary>Screen shake (dunks, posterizers): amplitude in feet, decays.</summary>
        public static void Shake(float a) => shake = Mathf.Max(shake, a);

        readonly Camera cam;
        Vector3 camPos, look, bLook;
        bool init;
        float rpT, rpA, fov = 38, lastDof = -1, lastMb = -1;

        public CameraDirector(Camera cam)
        {
            this.cam = cam;
            Mode = Mathf.Clamp(PlayerPrefs.GetInt("h2k_cam", 0), 0, 3);
        }

        static Player Focus()
        {
            var c = CT.Count > 0 ? CT[0] : null;
            return c != null && c.idx >= 0 && c.idx < P.Count ? P[c.idx] : P.Count > 0 ? P[0] : null;
        }

        public void Tick(float dt)
        {
            if (UnityEngine.Input.GetKeyDown(KeyCode.K))
            {
                Mode = (Mode + 1) % 4;
                PlayerPrefs.SetInt("h2k_cam", Mode);
                FX.Add(new Fx { k = "t", s = "CAMERA: " + NAMES[Mode], c = "#9fe7ff" });
            }
            var p0 = Focus();
            int cm = RPL != null ? 1 : Mode;
            float hx = (float)(hoop(pos) - 470) * 0.1f, tf = 38, lerpK = 0.1f, lookK = 0.14f, dofF = 0;
            Vector3 tp, tl;
            // broadcast: follow the ball, a little ahead toward the hoop it attacks
            var o = B.owner;
            double ax = B.x + (o != null ? (hoop(o.tm) - B.x) * 0.25 : 0);
            var bl = PhysXBall.U(Util.Clamp(ax, 180, 760), 250 + (B.y - 250) * 0.3, 0);
            bLook = init ? Vector3.Lerp(bLook, bl, 1 - Mathf.Exp(-3f * dt)) : bl;
            tp = bLook + new Vector3(0, 30f, -68f);
            tl = bLook + new Vector3(0, 2f, 0);
            if (cm == 1 && p0 != null)
            {
                float mx = (float)((p0.x - 470) * 0.1 * 0.5 + (B.x - 470) * 0.1 * 0.5);
                tp = Gfx.V3(mx, 11.5f, 24);
                tl = Gfx.V3(mx, 2.8f, 2);
                tf = 42;
            }
            else if (cm == 2)
            {
                float sg = hx > 0 ? 1 : -1;
                tp = Gfx.V3(sg * 60, 12, 0);
                tl = Gfx.V3(sg * 22, 3.5f, 0);
                tf = 40;
            }
            else if (cm == 3 && p0 != null)
            {
                float px = (float)(p0.x - 470) * 0.1f, pz = (float)(p0.y - 250) * 0.1f, dr = hoop(p0.tm) > 470 ? 1 : -1;
                tp = Gfx.V3(px - dr * 13, 8.5f, pz + (pz > 0 ? -4 : 4) + 10);
                tl = Gfx.V3(px + dr * 9, 3, pz * 0.6f);
                tf = 46;
            }
            if (RPL == null && TS.hud > 0 && TS.hud < 2.5 && p0 != null && cfg.HALF == 0)
            {
                // timeout: the broadcast cuts to your team's huddle in front of its bench
                float hx2 = (p0.tm == 1 ? 1 : -1) * 13;
                tp = Gfx.V3(hx2 + 4, 8, -8);
                tl = Gfx.V3(hx2, 3.2f, -21.6f);
                tf = 40;
            }
            if (RPL != null) rpT += dt;
            else rpT = 0;
            if (RPL != null && P.Count > 0 && RPK != 0 && B.last != null)
            {
                // clutch replay, three shots: low behind the shooter at the release, wide and high following the
                // ball's flight, then a tight look up at the rim as it drops through the net
                var s0 = B.last;
                float sx = (float)(s0.x - 470) * 0.1f, sz = (float)(s0.y - 250) * 0.1f, hx3 = (float)(hoop(s0.tm) - 470) * 0.1f, dirx = Mathf.Sign(hx3 - sx);
                if (dirx == 0) dirx = 1;
                if (rpT < 1.6f) { tp = Gfx.V3(sx - dirx * 7, 4.2f, sz + 3.5f); tl = Gfx.V3(sx + dirx * 4, 6.5f, sz); dofF = 8; }
                else if (rpT < 3.4f) { tp = Gfx.V3((sx + hx3) / 2, 19, sz + 26); tl = PhysXBall.U(B.x, B.y, B.z); }
                else { tp = Gfx.V3(hx3 - dirx * 6, 6.5f, 5); tl = Gfx.V3(hx3, 9.8f, 0); dofF = Mathf.Sqrt(36 + 3.3f * 3.3f + 25); }
                lerpK = lookK = 0.35f;
                tf = 38;
            }
            else if (RPL != null && P.Count > 0)
            {
                Player sub = P[0];
                double sd2 = 1e9;
                foreach (var q in P)
                {
                    double d = Util.Hypot(q.x - B.x, q.y - B.y);
                    if (d < sd2 && !Util.T(q.off)) { sd2 = d; sub = q; }
                }
                float sx = (float)(sub.x - 470) * 0.1f, sy = (float)sub.z * 0.1f, sz = (float)(sub.y - 250) * 0.1f;
                bool rim = System.Math.Min(System.Math.Abs(B.x - HXs[0]), System.Math.Abs(B.x - HXs[1])) < 110 && (B.z > 45 || sub.z > 10);
                float a = rpA + (float)T * 0.22f, dist = rim ? 11 : 14;
                tp = Gfx.V3(sx + Mathf.Cos(a) * dist, rim ? 2.6f : 6, sz + Mathf.Sin(a) * dist);
                tl = Gfx.V3(sx, sy + (rim ? 6.5f : 3.6f), sz);
                dofF = (tp - Gfx.V3(sx, tl.y, sz)).magnitude;
                tf = 36;
            }
            else rpA = Random.value * 6.283f; // a fresh angle for the next replay
            if (RPL == null && S == "over" && sc[0] != sc[1])
            {
                // final buzzer: the camera drifts in to the winners' top scorer (face close-up: the grin, the roar)
                int wt = sc[0] > sc[1] ? 0 : 1;
                Player st = null;
                foreach (var q in P) if (q.tm == wt && !Util.T(q.off) && (st == null || q.stt.pts > st.stt.pts)) st = q;
                if (st != null)
                {
                    float wx = (float)(st.x - 470) * 0.1f, wz = (float)(st.y - 250) * 0.1f, hh = (float)(st.ht / 6.4 * 5.9 + st.z * 0.1),
                        a = -(float)st.f + Mathf.Sin((float)T * 0.25f) * 0.5f; // in front of him, slow sway
                    tp = Gfx.V3(wx + Mathf.Sin(a + Mathf.PI / 2) * 6.5f, hh + 0.6f, wz + Mathf.Cos(a + Mathf.PI / 2) * 6.5f);
                    tl = Gfx.V3(wx, hh - 0.5f, wz);
                    lerpK = 0.03f;
                    lookK = 0.05f;
                    tf = 34;
                }
            }
            if (!init) { camPos = tp; look = tl; fov = tf; init = true; }
            float k1 = 1 - Mathf.Pow(1 - lerpK, dt * 60), k2 = 1 - Mathf.Pow(1 - lookK, dt * 60);
            camPos = Vector3.Lerp(camPos, tp, k1);
            look = Vector3.Lerp(look, tl, k2);
            fov = Mathf.Lerp(fov, tf, k2);
            var cp = camPos;
            if (shake > 0.001f)
            {
                cp.x += (Random.value - 0.5f) * shake;
                cp.y += (Random.value - 0.5f) * shake;
                shake *= Mathf.Pow(0.86f, dt * 60);
            }
            cam.transform.position = cp;
            cam.transform.LookAt(look);
            cam.fieldOfView = fov;
            // replay depth of field + motion blur only for the big moments (dribble moves of the followed player, dunks)
            float dof = Arena.FxOn && Arena.QL >= 1 ? dofF : 0;
            if (dof != lastDof) { lastDof = dof; Arena.Post?.Dof(dof); }
            bool fast = p0 != null && ((p0.mvT > 0 && p0 == B.owner) || (Util.T(B.dk) && B.age < 0.4));
            float mb = fast && Arena.FxOn && Arena.QL >= 2 && Arena.Lvl >= 5 ? 1 : 0;
            if (mb != lastMb) { lastMb = mb; Arena.Post?.Motion(mb); }
        }
    }
}
