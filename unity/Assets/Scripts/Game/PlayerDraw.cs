// Draws every player from the core's 20-joint skeleton (Pose.skeleton, the same FK the browser's 2D view and release
// point use) as GPU-instanced capsules/spheres: one RenderMeshInstanced call per colour, no GameObjects per bone, no
// per-frame allocation. Joints: 0 pelvis, 1 chest, 2 neck, 3 head top, 4-7 L hip/knee/ankle/toe, 8-11 R,
// 12-15 L shoulder/elbow/wrist/hand, 16-19 R.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class PlayerDraw
    {
        readonly Mesh capsule, sphere;
        readonly float[] sk = new float[60];
        readonly Dictionary<Color, Batch> caps = new(), balls = new();
        readonly List<Batch> used = new();
        static Shader lit;

        sealed class Batch
        {
            public Material m;
            public readonly Matrix4x4[] mx = new Matrix4x4[1023];
            public int n;
            public RenderParams rp;
            public bool cap;
        }

        public PlayerDraw()
        {
            capsule = Prim(PrimitiveType.Capsule);
            sphere = Prim(PrimitiveType.Sphere);
        }
        static Mesh Prim(PrimitiveType t)
        {
            var g = GameObject.CreatePrimitive(t);
            var m = g.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(g);
            return m;
        }
        public static Material Mat(Color c, float smooth = 0.35f)
        {
            if (lit == null) lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(lit) { enableInstancing = true, color = c };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            return m;
        }
        Batch Get(Dictionary<Color, Batch> d, Color c)
        {
            if (!d.TryGetValue(c, out var b))
            {
                b = new Batch { m = Mat(c), cap = d == caps };
                b.rp = new RenderParams(b.m) { worldBounds = new Bounds(Vector3.zero, new Vector3(2000f, 2000f, 2000f)), shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On, receiveShadows = true };
                d[c] = b;
            }
            if (b.n == 0) used.Add(b);
            return b;
        }

        Vector3 J(int i) => PhysXBall.U(sk[i * 3], sk[i * 3 + 1], sk[i * 3 + 2]);

        void Seg(Color c, int a, int b, float r) => Seg(c, J(a), J(b), r);
        void Seg(Color c, Vector3 a, Vector3 b, float r)
        {
            var bt = Get(caps, c);
            if (bt.n >= bt.mx.Length) return;
            var d = b - a;
            float len = d.magnitude;
            var rot = len > 1e-5f ? Quaternion.FromToRotation(Vector3.up, d / len) : Quaternion.identity;
            bt.mx[bt.n++] = Matrix4x4.TRS((a + b) * 0.5f, rot, new Vector3(2 * r, (len + 2 * r) * 0.5f, 2 * r));
        }
        void Ball(Color c, Vector3 p, Vector3 s, Quaternion r)
        {
            var bt = Get(balls, c);
            if (bt.n < bt.mx.Length) bt.mx[bt.n++] = Matrix4x4.TRS(p, r, s);
        }

        static readonly Dictionary<string, Color> hexC = new();
        static Color Hex(string h)
        {
            if (h == null) return Color.gray;
            if (!hexC.TryGetValue(h, out var c)) hexC[h] = c = ColorUtility.TryParseHtmlString(h, out var cc) ? cc : Color.gray;
            return c;
        }

        public void Draw()
        {
            used.Clear();
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                if (Util.T(p.off)) continue;
                Hoops.Core.Pose.skeleton(p, sk);
                float b = (float)p.bk;
                Color jer = Hex(p.col), skin = Hex(p.skin), shorts = jer * 0.9f, shoe = (k & 1) == 0 ? new Color(0.95f, 0.95f, 0.95f) : new Color(0.08f, 0.08f, 0.09f);
                shorts.a = 1;
                // torso + jersey
                Seg(jer, 0, 1, 0.5f * b);
                Seg(jer, 12, 16, 0.26f * b);
                Seg(shorts, 4, 8, 0.36f * b);
                Seg(skin, 1, 2, 0.17f);
                // head
                Vector3 nk = J(2), top = J(3), hc = Vector3.Lerp(nk, top, 0.55f);
                Ball(skin, hc, new Vector3(0.62f, 0.78f, 0.68f), Quaternion.identity);
                if (p.hr > 0) Ball(new Color(0.07f, 0.06f, 0.05f), hc + (top - nk).normalized * 0.12f, new Vector3(0.66f, 0.5f, 0.7f), Quaternion.identity);
                for (int s = 0; s < 2; s++)
                {
                    int h = 4 + s * 4, sh = 12 + s * 4;
                    // shorts over the thigh, then the thigh, calf, sneaker
                    Vector3 hip = J(h), kn = J(h + 1);
                    Seg(shorts, hip, Vector3.Lerp(hip, kn, 0.55f), 0.3f * b);
                    Seg(skin, Vector3.Lerp(hip, kn, 0.45f), kn, 0.24f);
                    Seg(skin, h + 1, h + 2, 0.18f);
                    Seg(shoe, h + 2, h + 3, 0.17f);
                    // arm: jersey cap, upper arm, forearm, hand
                    Ball(jer, J(sh), Vector3.one * 0.5f * b, Quaternion.identity);
                    Seg(skin, sh, sh + 1, 0.15f * b);
                    Seg(skin, sh + 1, sh + 2, 0.12f * b);
                    Seg(skin, sh + 2, sh + 3, 0.1f);
                }
            }
            // the ball
            Ball(new Color(0.85f, 0.38f, 0.1f), PhysXBall.U(B.x, B.y, B.z), Vector3.one * (float)(BR * 2 * 0.1), Quaternion.Euler(0, 0, (float)(B.a * Mathf.Rad2Deg)));
            foreach (var bt in used)
            {
                if (SystemInfo.supportsInstancing) Graphics.RenderMeshInstanced(bt.rp, bt.cap ? capsule : sphere, 0, bt.mx, bt.n);
                else for (int i = 0; i < bt.n; i++) Graphics.RenderMesh(bt.rp, bt.cap ? capsule : sphere, 0, bt.mx[i]);
                bt.n = 0;
            }
        }
    }
}
