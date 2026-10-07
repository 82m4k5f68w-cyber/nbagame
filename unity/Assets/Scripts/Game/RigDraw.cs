// Draws every player as a skinned PlayerRig (Rig.cs) and the ball. Rigs are kept per slot of Sim.P and rebuilt only
// when the player in a slot changes (new game, substitution: Sim.SUBV, mode rosters); the per-frame path allocates
// nothing: pose -> foot IK -> cloth for each visible rig, then the ball (pinned to the shooting palm while he holds
// it for a shot, spinning with its real angular velocity otherwise; render3d ballSpin).
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class RigDraw
    {
        readonly Transform root;
        readonly List<PlayerRig> rigs = new();
        List<Player> pset;
        double subv = double.NaN;
        readonly Mesh ballMesh;
        readonly Material ballMat;
        RenderParams ballRp;
        Quaternion ballRot = Quaternion.identity;
        /// <summary>Drawn ball centre (Unity feet) this frame, for cameras / effects.</summary>
        public Vector3 BallPos { get; private set; }

        public RigDraw()
        {
            root = new GameObject("Players").transform;
            var g = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            ballMesh = g.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(g);
            ballMat = PlayerDraw.Mat(Color.white, 0.32f);
            var bt = BallTex();
            ballMat.mainTexture = bt;
            if (ballMat.HasProperty("_BaseMap")) ballMat.SetTexture("_BaseMap", bt);
            ballRp = new RenderParams(ballMat) { worldBounds = new Bounds(Vector3.zero, new Vector3(2000f, 2000f, 2000f)), shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On, receiveShadows = true };
        }

        /// <summary>Pebbled orange leather with black channels (equirectangular on Unity's sphere UVs).</summary>
        static Texture2D BallTex()
        {
            const int W = 256, H = 128;
            var px = new Color32[W * H];
            var rnd = new System.Random(7);
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    float u = (x + 0.5f) / W, v = (y + 0.5f) / H, lat = (v - 0.5f) * Mathf.PI;
                    // meridian channels every quarter turn + the equator + two curved channels
                    float du = Mathf.Abs(Mathf.Repeat(u * 4 + 0.5f, 1) - 0.5f) / 4 * 2 * Mathf.PI * Mathf.Cos(lat),
                        de = Mathf.Abs(lat),
                        dc = Mathf.Abs(Mathf.Abs(lat) - (0.95f - 0.55f * Mathf.Abs(Mathf.Cos(u * 2 * Mathf.PI))));
                    float d = Mathf.Min(du, Mathf.Min(de, dc * 0.8f));
                    float line = Mathf.Clamp01((d - 0.018f) / 0.012f);
                    float peb = 0.9f + 0.1f * (float)rnd.NextDouble();
                    var c = Color.Lerp(new Color(0.06f, 0.04f, 0.03f), new Color(0.82f * peb, 0.36f * peb, 0.11f * peb), line);
                    px[y * W + x] = c;
                }
            var t = new Texture2D(W, H, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 4, name = "Ball" };
            t.SetPixels32(px);
            t.Apply(true, true);
            return t;
        }

        void Sync()
        {
            if (P != pset || SUBV != subv || rigs.Count != P.Count)
            {
                subv = SUBV;
                if (P != pset)
                {
                    foreach (var r in rigs) r?.Destroy();
                    rigs.Clear();
                    pset = P;
                }
                while (rigs.Count > P.Count) { rigs[rigs.Count - 1]?.Destroy(); rigs.RemoveAt(rigs.Count - 1); }
                while (rigs.Count < P.Count) rigs.Add(null);
            }
            // a slot whose player changed (substitution, mode rosters) gets that player's own rig
            for (int k = 0; k < P.Count; k++)
                if (rigs[k] == null || rigs[k].p != P[k])
                {
                    rigs[k]?.Destroy();
                    rigs[k] = PlayerRig.Build(P[k], root);
                }
        }

        public void Draw(float dt)
        {
            Sync();
            bool ik = RPL == null;
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                var r = rigs[k];
                bool vis = !Util.T(p.off) && p.q != null;
                if (r.go.activeSelf != vis) r.go.SetActive(vis);
                if (!vis) continue;
                r.ApplyPose(p);
                r.FootIK(p, dt, ik);
                r.ClothStep(p, dt);
            }
            DrawBall(dt);
        }

        void DrawBall(float dt)
        {
            var pos = PhysXBall.U(B.x, B.y, B.z);
            var o = B.owner;
            if (RPL == null && o != null && (o.mode == "c" || o.mode == "s"))
            {
                int k = P.IndexOf(o);
                if (k >= 0 && k < rigs.Count && rigs[k] != null && rigs[k].go.activeSelf) pos = rigs[k].Palm(o);
            }
            BallPos = pos;
            if (RPL == null) Spin(dt);
            float d = (float)(BR * 2 * 0.1);
            Graphics.RenderMesh(ballRp, ballMesh, 0, Matrix4x4.TRS(pos, ballRot, new Vector3(d, d, d)));
        }

        void Spin(float dt)
        {
            double wx = 0, wy = 0, wz = 0, sp = Util.Hypot(B.vx, B.vy);
            var o = B.owner;
            if (o != null)
            {
                double v = Util.Hypot(o.vx, o.vy), dv = B.dvv;
                if (v > 1) { wx = -o.vy / v * (v / 39 + System.Math.Abs(dv) * 0.02); wy = o.vx / v * (v / 39 + System.Math.Abs(dv) * 0.02); }
            }
            else if (B.wv != null && (B.mode == "air" || B.mode == "pass")) { wx = B.wv[0]; wy = B.wv[1]; wz = B.wv[2]; }
            else if (sp > 1)
            {
                double kk = B.z > 4.5 ? -16 / sp : 1 / 3.9; // backspin in flight, pure roll on the floor
                wx = -B.vy * kk;
                wy = B.vx * kk;
            }
            // game (x, y, z) -> Unity (x, z, -y) is a proper rotation: the angular velocity maps with the same matrix
            var w = new Vector3((float)wx, (float)wz, -(float)wy);
            float m = w.magnitude;
            if (m > 1e-4f) ballRot = Quaternion.AngleAxis(m * dt * Mathf.Rad2Deg, w / m) * ballRot;
        }
    }
}
