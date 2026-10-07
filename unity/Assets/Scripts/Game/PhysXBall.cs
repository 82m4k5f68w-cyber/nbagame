// Ball physics on Unity's PhysX (port of src/core/physics.ts): floor, walls, glass boards, 24-capsule rims, the ball,
// and kinematic player torso capsules. The sim calls Step() for an airborne ball; Physics runs in Script mode so the
// fixed 60 Hz sim owns time (two half-steps per tick, like Rapier in the browser build).
// Physics space = render space in feet: game (x, y, z) -> Unity (x - 470, z, -(y - 250)) * 0.1 (a proper rotation,
// so angular velocities map with the same matrix).
using System.Collections.Generic;
using Hoops.Core;
using UnityEngine;

namespace Hoops.Game
{
    public sealed class PhysXBall : IBallPhysics
    {
        const float S = 0.1f; // game px -> feet
        readonly Rigidbody ball;
        readonly PhysicsScene scene;
        readonly List<(Rigidbody b, CapsuleCollider c, double H, double r, double hh)> pl = new();
        readonly Transform root;

        public static Vector3 U(double x, double y, double z) => new Vector3((float)(x - 470) * S, (float)z * S, -(float)(y - 250) * S);
        static Vector3 Uv(double x, double y, double z) => new Vector3((float)x * S, (float)z * S, -(float)y * S); // vectors

        public PhysXBall()
        {
            Physics.simulationMode = SimulationMode.Script;
            Physics.gravity = new Vector3(0, -(float)Sim.g * S, 0);
            Physics.defaultContactOffset = 0.004f;
            Physics.bounceThreshold = 0.05f;
            Physics.defaultMaxAngularSpeed = 200f;
            // rim rattles: the iron is a ring of thin capsules and the ball hits it fast, so give the solver more
            // passes (PhysX default 6/1 let the ball sink into the iron and pop out with extra speed)
            Physics.defaultSolverIterations = 12;
            Physics.defaultSolverVelocityIterations = 4;
            Physics.defaultMaxDepenetrationVelocity = 6f; // ft/s: an overlap is resolved gently, never a launch
            Physics.queriesHitBackfaces = false;
            scene = Physics.defaultPhysicsScene;
            root = new GameObject("PhysX").transform;
            // Rapier's default combine rule is Average for both friction and restitution: same in PhysX.
            PhysicsMaterial Mat(float e, float f) => new PhysicsMaterial { bounciness = e, dynamicFriction = f, staticFriction = f, bounceCombine = PhysicsMaterialCombine.Average, frictionCombine = PhysicsMaterialCombine.Average };
            void Box(Vector3 c, Vector3 half, float e, float f)
            {
                var g = new GameObject("col");
                g.transform.SetParent(root, false);
                g.transform.position = U(c.x, c.y, c.z);
                var bc = g.AddComponent<BoxCollider>();
                bc.size = new Vector3(half.x * 2 * S, half.z * 2 * S, half.y * 2 * S);
                bc.sharedMaterial = Mat(e, f);
            }
            Box(new Vector3(470, 250, -10), new Vector3(700, 500, 10), 0.8f, 0.6f); // floor
            foreach (var w in new[] { new Vector4(-5, 250, 5, 500), new Vector4(945, 250, 5, 500), new Vector4(470, -5, 700, 5), new Vector4(470, 505, 700, 5) })
                Box(new Vector3(w.x, w.y, 300), new Vector3(w.z, w.w, 300), 0.5f, 0.5f);
            for (int b = 0; b < 2; b++)
            {
                double hx = Sim.HXs[b], bx = b == 1 ? 900 : 40;
                Box(new Vector3((float)(bx + (b == 1 ? 0.6 : -0.6)), (float)Sim.HY, 116), new Vector3(0.6f, 30, 20), 0.62f, 0.3f); // glass
                for (int k = 0; k < 24; k++)
                {
                    double a0 = k / 24.0 * 6.283, a1 = (k + 1) / 24.0 * 6.283,
                        x0 = hx + System.Math.Cos(a0) * Sim.RR, y0 = Sim.HY + System.Math.Sin(a0) * Sim.RR,
                        x1 = hx + System.Math.Cos(a1) * Sim.RR, y1 = Sim.HY + System.Math.Sin(a1) * Sim.RR;
                    var g = new GameObject("rim");
                    g.transform.SetParent(root, false);
                    Vector3 p0 = U(x0, y0, 100), p1 = U(x1, y1, 100);
                    g.transform.position = (p0 + p1) * 0.5f;
                    g.transform.rotation = Quaternion.FromToRotation(Vector3.up, (p1 - p0).normalized);
                    var cc = g.AddComponent<CapsuleCollider>();
                    cc.radius = 0.55f * S;
                    cc.height = (p1 - p0).magnitude + 2 * cc.radius; // Rapier capsule half-height excludes the caps
                    cc.sharedMaterial = Mat(0.55f, 0.4f);
                }
            }
            var bg = new GameObject("ballBody");
            bg.transform.SetParent(root, false);
            var sc = bg.AddComponent<SphereCollider>();
            sc.radius = (float)Sim.BR * S;
            sc.sharedMaterial = Mat(0.72f, 0.55f);
            ball = bg.AddComponent<Rigidbody>();
            ball.mass = 0.02f * (4f / 3f * Mathf.PI * Mathf.Pow((float)Sim.BR, 3)); // Rapier density 0.02 (mass only scales contacts with kinematics)
            ball.linearDamping = 0;
            ball.angularDamping = 0.3f;
            ball.maxAngularVelocity = 200f;
            ball.sleepThreshold = 0;
            ball.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic; // a fast shot can't tunnel through the iron
            ball.solverIterations = 16;
            ball.solverVelocityIterations = 8;
            ball.maxDepenetrationVelocity = 6f;
            ball.interpolation = RigidbodyInterpolation.None;
        }

        /// <summary>rapStep: drag + Magnus lift from the spin, then one engine step (same order as the browser build).</summary>
        public void Step(double dt, Ball B)
        {
            var W = B.wv ?? new double[3];
            const double k = 0.0032;
            B.vx *= 1 - 0.1 * dt;
            B.vy *= 1 - 0.1 * dt;
            B.vz += k * (W[0] * B.vy - W[1] * B.vx) * dt;
            ball.position = U(B.x, B.y, B.z);
            ball.linearVelocity = Uv(B.vx, B.vy, B.vz);
            ball.angularVelocity = Uv(W[0], W[1], W[2]) / S; // axial vector: same rotation, no length scale
            // a fast ball near the iron or the glass gets two sub-steps (the browser's net also sub-steps fast balls)
            double sp = System.Math.Sqrt(B.vx * B.vx + B.vy * B.vy + B.vz * B.vz);
            bool nearHoop = B.z > 70 && B.z < 160 && (Util.Hypot(B.x - Sim.HXs[0], B.y - Sim.HY) < 40 || Util.Hypot(B.x - Sim.HXs[1], B.y - Sim.HY) < 40);
            if (nearHoop && sp > 240) { scene.Simulate((float)dt * 0.5f); scene.Simulate((float)dt * 0.5f); }
            else scene.Simulate((float)dt);
            Vector3 t = ball.position, v = ball.linearVelocity, a = ball.angularVelocity;
            B.x = t.x / S + 470;
            B.y = -t.z / S + 250;
            B.z = t.y / S;
            B.vx = v.x / S;
            B.vy = -v.z / S;
            B.vz = v.y / S;
            if (B.wv == null) B.wv = new double[3];
            B.wv[0] = a.x;
            B.wv[1] = -a.z;
            B.wv[2] = a.y;
            B.a += System.Math.Sqrt(a.x * a.x + a.y * a.y + a.z * a.z) * dt * 0.5;
        }

        /// <summary>Kinematic torso capsules; only the airborne ball interacts, the shooter is ghosted 0.35 s after release.</summary>
        public void SyncPlayers(List<Player> P, Ball B)
        {
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                double H = p.ht * 10, r = 8.5 * p.bk, hh = System.Math.Max(4, (H * 0.78 - 2 * r) / 2);
                while (pl.Count <= k) pl.Add(default);
                var e = pl[k];
                if (e.b == null || e.H != H || e.r != r)
                {
                    if (e.b != null) Object.Destroy(e.b.gameObject);
                    var g = new GameObject("body");
                    g.transform.SetParent(root, false);
                    var rb = g.AddComponent<Rigidbody>();
                    rb.isKinematic = true;
                    var c = g.AddComponent<CapsuleCollider>();
                    c.direction = 1;
                    c.radius = (float)r * S;
                    c.height = (float)(2 * hh + 2 * r) * S;
                    c.sharedMaterial = new PhysicsMaterial { bounciness = 0.35f, dynamicFriction = 0.5f, staticFriction = 0.5f };
                    e = pl[k] = (rb, c, H, r, hh);
                    rb.position = U(p.x, p.y, p.z + hh + r);
                }
                var want = U(p.x, p.y, p.z + e.hh + e.r);
                if ((e.b.position - want).magnitude > 3f) e.b.position = want;
                else e.b.MovePosition(want);
                bool nearRim = B.z > 55 && (Util.Hypot(B.x - Sim.HXs[0], B.y - Sim.HY) < 30 || Util.Hypot(B.x - Sim.HXs[1], B.y - Sim.HY) < 30);
                e.c.enabled = B.mode == "air" && B.owner == null && !nearRim && !(B.last == p && B.age < 0.35) && B.age >= 0.12;
            }
            for (int k = P.Count; k < pl.Count; k++)
                if (pl[k].b != null) { Object.Destroy(pl[k].b.gameObject); pl[k] = default; }
        }
    }
}
