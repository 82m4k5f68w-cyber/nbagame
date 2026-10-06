// Arena dressing and look for the Unity build (port of src/client/render3d.ts + the fx3d.ts quality ladder):
// tiered stands with an instanced crowd (bodies / heads / arms / towels in team colours; they stand on excitement and do
// the wave), signs, a courtside row on chairs that reacts ("ooh", ducking a ball into the seats, arms up when loud),
// benches + pacing head coaches, two referees (whistle arm on Fx "whistle"), LED ribbons, a painted jumbotron with the
// score and rotating team stats, shot clocks on the glass, catwalk spot lights with additive light shafts, HDR ceiling
// panels, the net (Sim.NETS strands as instanced thin capsules), contact-shadow blobs, glints, the on-fire ball trail,
// rim shake on dunks, final-buzzer confetti, the street set for half-court modes, a realtime reflection probe on High,
// and the adaptive quality ladder / frame-rate guard. URP post (Volume, SSAO toggle, render scale) lives behind IPostFx
// (Urp/PostFx.cs registers itself) so this file compiles against the plain UnityEngine assemblies.
// Everything is built from code; repeated objects are GPU instanced (Graphics.RenderMeshInstanced), one batch per
// colour (stock URP shaders have no per-instance colour), and Tick() allocates nothing.
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;
using UnityEngine.Rendering;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    /// <summary>URP post-processing hooks (implemented in Urp/PostFx.cs, which needs the URP assemblies).</summary>
    public interface IPostFx
    {
        void Init(Camera cam);
        /// <summary>ql 0 Low .. 2 High, lvl = frame-rate ladder rung 6 (everything) .. 0, on = effects enabled.</summary>
        void Apply(int ql, int lvl, bool on);
        /// <summary>Replay depth of field focus distance (ft); off when &lt;= 0.</summary>
        void Dof(float focus);
        /// <summary>Per-arena colour grade tint (a whisper of the home team's colour).</summary>
        void Tint(Color c);
        /// <summary>Motion blur amount 0..1 (big moments only).</summary>
        void Motion(float amt);
    }

    /// <summary>Meshes and materials made from code (stock URP shaders only).</summary>
    public static class Gfx
    {
        static Shader lit, unlit, part;
        static Mesh cube;

        /// <summary>three.js world (feet, right-handed) -> Unity (Z mirrored).</summary>
        public static Vector3 V3(double x, double y, double z) => new Vector3((float)x, (float)y, -(float)z);

        static readonly Dictionary<string, Color> hexC = new Dictionary<string, Color>();
        public static Color Hex(string h, Color fb)
        {
            if (string.IsNullOrEmpty(h)) return fb;
            if (!hexC.TryGetValue(h, out var c)) hexC[h] = c = ColorUtility.TryParseHtmlString(h, out var cc) ? cc : fb;
            return c;
        }
        public static Color32 C32(Color c) => (Color32)c;

        public static Material Lit(Color c, float smooth = 0.35f, float metal = 0f)
        {
            if (lit == null) lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(lit) { enableInstancing = true, color = c };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metal);
            return m;
        }
        public static Material Unlit(Color c, Texture t = null)
        {
            if (unlit == null) unlit = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Texture");
            var m = new Material(unlit) { enableInstancing = true };
            SetColor(m, c);
            if (t != null) SetTex(m, t);
            return m;
        }
        /// <summary>Additive (URP Particles/Unlit): light shafts, glints, fire.</summary>
        public static Material Additive(Color c, Texture t)
        {
            if (part == null) part = Shader.Find("Universal Render Pipeline/Particles/Unlit") ?? Shader.Find("Legacy Shaders/Particles/Additive");
            var m = new Material(part) { enableInstancing = true };
            SetColor(m, c);
            if (t != null) SetTex(m, t);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 2); // additive
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.One);
            m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_DstBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_ZWrite", 0);
            m.SetFloat("_Cull", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.SetOverrideTag("RenderType", "Transparent");
            m.renderQueue = (int)RenderQueue.Transparent + 5;
            return m;
        }
        /// <summary>Alpha-blended (premul = keep the specular of glass at low alpha). Works for URP Lit and Unlit.</summary>
        public static Material Transparent(Material m, bool premul = false)
        {
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", premul ? 1 : 0);
            m.SetFloat("_SrcBlend", premul ? (float)BlendMode.One : (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            m.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (premul) m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            m.SetOverrideTag("RenderType", "Transparent");
            m.renderQueue = (int)RenderQueue.Transparent;
            return m;
        }
        /// <summary>Alpha-tested (chain-link fence).</summary>
        public static Material Cutout(Material m, float cut)
        {
            m.SetFloat("_AlphaClip", 1);
            m.SetFloat("_Cutoff", cut);
            m.EnableKeyword("_ALPHATEST_ON");
            m.renderQueue = (int)RenderQueue.AlphaTest;
            return TwoSided(m);
        }
        public static Material TwoSided(Material m)
        {
            m.SetFloat("_Cull", 0);
            m.doubleSidedGI = true;
            return m;
        }
        public static void SetColor(Material m, Color c)
        {
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
        }
        public static void SetTex(Material m, Texture t)
        {
            m.mainTexture = t;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", t);
        }

        public static Mesh Cube()
        {
            if (cube != null) return cube;
            var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube = g.GetComponent<MeshFilter>().sharedMesh;
            Object.Destroy(g);
            return cube;
        }

        /// <summary>Surface of revolution about +Y from a (radius, y) profile running upward; outward normals from the
        /// profile tangent, u around, v along the profile, white vertex colours (the particles shader multiplies them).</summary>
        public static Mesh Lathe(Vector2[] pr, int seg)
        {
            int n = pr.Length, W = seg + 1;
            var v = new Vector3[n * W];
            var nm = new Vector3[n * W];
            var uv = new Vector2[n * W];
            var col = new Color32[n * W];
            var tri = new int[(n - 1) * seg * 6];
            for (int i = 0; i < n; i++)
            {
                Vector2 t = pr[Mathf.Min(n - 1, i + 1)] - pr[Mathf.Max(0, i - 1)];
                var n2 = new Vector2(t.y, -t.x).normalized;
                for (int j = 0; j <= seg; j++)
                {
                    float a = j / (float)seg * Mathf.PI * 2, ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                    int k = i * W + j;
                    v[k] = new Vector3(pr[i].x * ca, pr[i].y, pr[i].x * sa);
                    nm[k] = new Vector3(n2.x * ca, n2.y, n2.x * sa);
                    uv[k] = new Vector2(j / (float)seg, i / (float)(n - 1));
                    col[k] = new Color32(255, 255, 255, 255);
                }
            }
            int q = 0;
            for (int i = 0; i < n - 1; i++)
                for (int j = 0; j < seg; j++)
                {
                    int a = i * W + j, b = a + 1, c = a + W + 1, d = a + W;
                    tri[q++] = a; tri[q++] = d; tri[q++] = c;
                    tri[q++] = a; tri[q++] = c; tri[q++] = b;
                }
            var m = new Mesh { vertices = v, normals = nm, uv = uv, colors32 = col, triangles = tri };
            m.RecalculateBounds();
            m.RecalculateTangents();
            return m;
        }
        /// <summary>Unit capsule like Unity's primitive (radius .5, height 2, along Y), low poly.</summary>
        public static Mesh Capsule(int seg = 8, int rings = 3)
        {
            var pr = new Vector2[(rings + 1) * 2];
            for (int i = 0; i <= rings; i++)
            {
                float a = -Mathf.PI / 2 + i / (float)rings * Mathf.PI / 2;
                pr[i] = new Vector2(0.5f * Mathf.Cos(a), -0.5f + 0.5f * Mathf.Sin(a));
                float b = i / (float)rings * Mathf.PI / 2;
                pr[rings + 1 + i] = new Vector2(0.5f * Mathf.Cos(b), 0.5f + 0.5f * Mathf.Sin(b));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Unit sphere (radius .5).</summary>
        public static Mesh Sphere(int seg = 10, int rings = 8)
        {
            var pr = new Vector2[rings + 1];
            for (int i = 0; i <= rings; i++)
            {
                float a = -Mathf.PI / 2 + i / (float)rings * Mathf.PI;
                pr[i] = new Vector2(0.5f * Mathf.Cos(a), 0.5f * Mathf.Sin(a));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Open cylinder / cone from y0 (radius r0) to y1 (radius r1).</summary>
        public static Mesh Tube(float r0, float y0, float r1, float y1, int seg) => Lathe(new[] { new Vector2(r0, y0), new Vector2(r1, y1) }, seg);
        /// <summary>Closed cylinder (caps) centred at the origin.</summary>
        public static Mesh Cylinder(float rTop, float rBot, float h, int seg) =>
            Lathe(new[] { new Vector2(0, -h / 2), new Vector2(rBot, -h / 2), new Vector2(rBot, -h / 2), new Vector2(rTop, h / 2), new Vector2(rTop, h / 2), new Vector2(0, h / 2) }, seg);
        /// <summary>Horizontal ring (about +Y): ring radius R, tube radius r.</summary>
        public static Mesh Torus(float R, float r, int seg, int tube)
        {
            var pr = new Vector2[tube + 1];
            for (int i = 0; i <= tube; i++)
            {
                float a = -Mathf.PI + i / (float)tube * Mathf.PI * 2;
                pr[i] = new Vector2(R + r * Mathf.Cos(a), r * Mathf.Sin(a));
            }
            return Lathe(pr, seg);
        }
        /// <summary>Unit quad in XY facing -Z (seen from -Z: u right, v up). Orient with LookRotation(-normal, up).</summary>
        public static Mesh Quad()
        {
            var m = new Mesh
            {
                vertices = new[] { new Vector3(-0.5f, -0.5f, 0), new Vector3(0.5f, -0.5f, 0), new Vector3(0.5f, 0.5f, 0), new Vector3(-0.5f, 0.5f, 0) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) },
                normals = new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back },
                colors32 = new[] { new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255), new Color32(255, 255, 255, 255) },
                triangles = new[] { 0, 3, 2, 0, 2, 1 },
            };
            m.RecalculateBounds();
            m.RecalculateTangents();
            return m;
        }
        /// <summary>Rotation that turns Quad() to face the outward direction n.</summary>
        public static Quaternion Facing(Vector3 n) => Quaternion.LookRotation(-n, Mathf.Abs(n.y) > 0.9f ? Vector3.forward : Vector3.up);

        public static GameObject Obj(string name, Mesh mesh, Material mat, Vector3 pos, Quaternion rot, Vector3 scale, Transform parent, bool shadows = true)
        {
            var g = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            g.transform.SetParent(parent, false);
            g.transform.localPosition = pos;
            g.transform.localRotation = rot;
            g.transform.localScale = scale;
            g.GetComponent<MeshFilter>().sharedMesh = mesh;
            var r = g.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            r.receiveShadows = true;
            return g;
        }

        /// <summary>A runtime-painted texture with its pixel buffer (paint, then Upload()).</summary>
        public sealed class Paint
        {
            public readonly int W, H;
            public readonly Color32[] px;
            public readonly Texture2D tex;
            public Paint(int w, int h, bool mips = true, TextureWrapMode wrap = TextureWrapMode.Clamp)
            {
                W = w; H = h;
                px = new Color32[w * h];
                tex = new Texture2D(w, h, TextureFormat.RGBA32, mips) { wrapMode = wrap, anisoLevel = 4, filterMode = FilterMode.Bilinear };
            }
            public void Clear(Color32 c) { for (int i = 0; i < px.Length; i++) px[i] = c; }
            /// <summary>Rect in y-down pixel coords (row 0 = top of the image as seen on a quad).</summary>
            public void Rect(int x, int y, int w, int h, Color32 c)
            {
                for (int yy = Mathf.Max(0, y); yy < Mathf.Min(H, y + h); yy++)
                    for (int xx = Mathf.Max(0, x); xx < Mathf.Min(W, x + w); xx++) px[(H - 1 - yy) * W + xx] = c;
            }
            public void Text(string s, int cx, int cy, int sc, Color32 c, int align = 0, float italic = 0) => BitFont.Draw(px, W, H, s, cx, cy, sc, c, true, align, italic);
            public void Upload() { tex.SetPixels32(px); tex.Apply(tex.mipmapCount > 1); }
        }
    }

    /// <summary>One instanced draw list: mesh + material + matrices (drawn in chunks of 1023).</summary>
    public sealed class Batch
    {
        public readonly Mesh mesh;
        public readonly Material mat;
        public RenderParams rp;
        public readonly Matrix4x4[] mx;
        public int n;
        public Batch(Mesh mesh, Material mat, int cap, bool cast = true, bool recv = true)
        {
            this.mesh = mesh;
            this.mat = mat;
            mx = new Matrix4x4[Mathf.Max(1, cap)];
            rp = new RenderParams(mat) { shadowCastingMode = cast ? ShadowCastingMode.On : ShadowCastingMode.Off, receiveShadows = recv, worldBounds = new Bounds(Vector3.zero, new Vector3(400, 200, 400)) };
        }
        public void Add(in Matrix4x4 m) { if (n < mx.Length) mx[n++] = m; }
        public void Add(Vector3 p, Quaternion r, Vector3 s) { if (n < mx.Length) mx[n++] = Matrix4x4.TRS(p, r, s); }
        /// <summary>A segment a -> b drawn with a unit capsule/cylinder (radius .5, height 2 along Y).</summary>
        public void Seg(Vector3 a, Vector3 b, float r)
        {
            var d = b - a;
            float len = d.magnitude;
            var rot = len > 1e-5f ? Quaternion.FromToRotation(Vector3.up, d / len) : Quaternion.identity;
            Add((a + b) * 0.5f, rot, new Vector3(2 * r, (len + 2 * r) * 0.5f, 2 * r));
        }
        public void Draw()
        {
            for (int s = 0; s < n; s += 1023) Graphics.RenderMeshInstanced(rp, mesh, 0, mx, Mathf.Min(1023, n - s), s);
        }
    }

    /// <summary>Tiny 5x7 bitmap font (digits, A-Z, a little punctuation) for painted textures.</summary>
    public static class BitFont
    {
        static Dictionary<char, byte[]> G;
        static void Init()
        {
            G = new Dictionary<char, byte[]>();
            void D(char c, params byte[] rows) => G[c] = rows;
            D('0', 0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E); D('1', 0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E);
            D('2', 0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F); D('3', 0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E);
            D('4', 0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02); D('5', 0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E);
            D('6', 0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E); D('7', 0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08);
            D('8', 0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E); D('9', 0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C);
            D('A', 0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11); D('B', 0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E);
            D('C', 0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E); D('D', 0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C);
            D('E', 0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F); D('F', 0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10);
            D('G', 0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F); D('H', 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11);
            D('I', 0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E); D('J', 0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C);
            D('K', 0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11); D('L', 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F);
            D('M', 0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11); D('N', 0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11);
            D('O', 0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E); D('P', 0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10);
            D('Q', 0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D); D('R', 0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11);
            D('S', 0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E); D('T', 0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04);
            D('U', 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E); D('V', 0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04);
            D('W', 0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A); D('X', 0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11);
            D('Y', 0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04); D('Z', 0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F);
            D('-', 0, 0, 0, 0x1F, 0, 0, 0); D(':', 0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0);
            D('%', 0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03); D('/', 0, 0x01, 0x02, 0x04, 0x08, 0x10, 0);
            D('.', 0, 0, 0, 0, 0, 0x0C, 0x0C); D('!', 0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04);
            D('#', 0x0A, 0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0x0A); D('\'', 0x04, 0x04, 0x08, 0, 0, 0, 0);
            D('*', 0, 0x04, 0x15, 0x0E, 0x15, 0x04, 0); D('?', 0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04);
            D('&', 0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D); D(' ', 0, 0, 0, 0, 0, 0, 0);
        }
        public static int Width(string s, int sc) => s.Length == 0 ? 0 : s.Length * 6 * sc - sc;

        /// <summary>Draw s anchored at (x, cy): align 0 = x is the centre, -1 = left edge, 1 = right edge; cy = vertical
        /// centre (y down). flip: the buffer's row 0 is the bottom (Texture2D on a quad). rot 1 / -1 turns the text 90
        /// degrees (canvas rotate(+-pi/2)) about the anchor. italic = x shear per row.</summary>
        public static void Draw(Color32[] px, int W, int H, string s, int x, int cy, int sc, Color32 c, bool flip, int align = 0, float italic = 0, int rot = 0)
        {
            if (G == null) Init();
            if (string.IsNullOrEmpty(s)) return;
            int w = Width(s, sc), h = 7 * sc;
            int ox0 = align == 0 ? -w / 2 : align < 0 ? 0 : -w, oy0 = -h / 2;
            for (int k = 0; k < s.Length; k++)
            {
                char ch = char.ToUpperInvariant(s[k]);
                if (!G.TryGetValue(ch, out var g)) g = G['?'];
                for (int r = 0; r < 7; r++)
                {
                    int bits = g[r];
                    if (bits == 0) continue;
                    for (int col = 0; col < 5; col++)
                    {
                        if ((bits & (0x10 >> col)) == 0) continue;
                        int sh = (int)((6 - r) * sc * italic);
                        for (int yy = 0; yy < sc; yy++)
                            for (int xx = 0; xx < sc; xx++)
                            {
                                int ox = ox0 + k * 6 * sc + col * sc + xx + sh, oy = oy0 + r * sc + yy, X, Y;
                                if (rot == 0) { X = x + ox; Y = cy + oy; }
                                else if (rot > 0) { X = x - oy; Y = cy + ox; }
                                else { X = x + oy; Y = cy - ox; }
                                if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                                px[(flip ? H - 1 - Y : Y) * W + X] = c;
                            }
                    }
                }
            }
        }
    }
}
