// Hoops 2K27 - Unity engine test: one half court, a hoop, one player, a physics ball and a shot meter.
// Everything is built from code at startup (no imported assets), so it compares engines, not art.
// Controls: WASD / arrows move, hold SPACE to charge the meter, release at the top (green) to shoot.
using UnityEngine;

public class HoopsTest : MonoBehaviour
{
    const float FT = 0.3048f;
    static readonly Vector3 RimC = new Vector3(0f, 10f * FT, 41.75f * FT); // rim center (feet -> meters)
    const float RimR = 0.75f * FT, BallR = 0.39f * FT;

    Transform player, cam;
    Rigidbody ball;
    bool held = true, charging;
    float meter, shotT, fps = 60f;
    int made, taken;
    string msg = "";
    bool wasAbove;

    void Awake()
    {
        Application.targetFrameRate = 60;
        QualitySettings.vSyncCount = 0;
        Physics.gravity = new Vector3(0, -9.81f, 0);
        BuildCourt();
        BuildHoop();
        BuildPlayer();
        BuildBall();
        var c = new GameObject("Camera").AddComponent<Camera>();
        c.clearFlags = CameraClearFlags.SolidColor;
        c.backgroundColor = new Color(0.05f, 0.06f, 0.09f);
        c.fieldOfView = 50;
        cam = c.transform;
        var sun = new GameObject("Key").AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.intensity = 1.3f;
        sun.shadows = LightShadows.Soft;
        sun.transform.rotation = Quaternion.Euler(70, 30, 0);
        RenderSettings.ambientLight = new Color(0.35f, 0.35f, 0.4f);
    }

    static GameObject Box(string n, Vector3 pos, Vector3 size, Color col, bool collider = true)
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
        g.name = n;
        g.transform.position = pos;
        g.transform.localScale = size;
        g.GetComponent<Renderer>().material.color = col;
        if (!collider) Destroy(g.GetComponent<Collider>());
        return g;
    }

    void BuildCourt()
    {
        var floor = Box("Floor", new Vector3(0, -0.05f, 20 * FT), new Vector3(50 * FT, 0.1f, 50 * FT), new Color(0.78f, 0.55f, 0.32f));
        floor.GetComponent<Collider>().material = new PhysicsMaterial { bounciness = 0.8f, bounceCombine = PhysicsMaterialCombine.Maximum, dynamicFriction = 0.6f };
        var line = new Color(0.95f, 0.95f, 0.95f);
        Box("Lane", new Vector3(0, 0.002f, 35.5f * FT), new Vector3(16 * FT, 0.004f, 19 * FT), new Color(0.6f, 0.15f, 0.15f), false);
        // three-point arc (23.75 ft) as small tiles
        for (int k = 0; k <= 60; k++)
        {
            float a = Mathf.Lerp(-1.25f, 1.25f, k / 60f);
            Box("Arc", new Vector3(Mathf.Sin(a) * 23.75f * FT, 0.003f, RimC.z - Mathf.Cos(a) * 23.75f * FT), new Vector3(0.12f, 0.004f, 0.12f), line, false);
        }
    }

    void BuildHoop()
    {
        Box("Board", new Vector3(0, 11.5f * FT, 43f * FT), new Vector3(6 * FT, 3.5f * FT, 0.05f), new Color(1, 1, 1, 0.9f));
        Box("Pole", new Vector3(0, 5f * FT, 47f * FT), new Vector3(0.25f, 10f * FT, 0.25f), new Color(0.2f, 0.2f, 0.25f));
        var iron = new PhysicsMaterial { bounciness = 0.55f, bounceCombine = PhysicsMaterialCombine.Average, dynamicFriction = 0.4f };
        var orange = new Color(1f, 0.35f, 0.05f);
        for (int k = 0; k < 24; k++)
        {
            float a0 = k / 24f * Mathf.PI * 2, a1 = (k + 1) / 24f * Mathf.PI * 2;
            Vector3 p0 = RimC + new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)) * RimR, p1 = RimC + new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1)) * RimR;
            var g = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            g.name = "Rim";
            g.transform.position = (p0 + p1) / 2;
            g.transform.rotation = Quaternion.FromToRotation(Vector3.up, (p1 - p0).normalized);
            g.transform.localScale = new Vector3(0.018f, (p1 - p0).magnitude / 2 + 0.009f, 0.018f);
            g.GetComponent<Renderer>().material.color = orange;
            g.GetComponent<Collider>().material = iron;
        }
    }

    void BuildPlayer()
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        g.name = "Player";
        g.transform.localScale = new Vector3(0.55f, 1f, 0.45f); // ~6'6"
        g.transform.position = new Vector3(0, 1f, 20 * FT);
        g.GetComponent<Renderer>().material.color = new Color(0.33f, 0.15f, 0.55f);
        Destroy(g.GetComponent<Collider>());
        var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        head.transform.SetParent(g.transform, false);
        head.transform.localPosition = new Vector3(0, 1.05f, 0);
        head.transform.localScale = new Vector3(0.45f, 0.24f, 0.55f);
        head.GetComponent<Renderer>().material.color = new Color(0.45f, 0.3f, 0.2f);
        Destroy(head.GetComponent<Collider>());
        player = g.transform;
    }

    void BuildBall()
    {
        var g = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        g.name = "Ball";
        g.transform.localScale = Vector3.one * BallR * 2;
        g.GetComponent<Renderer>().material.color = new Color(0.85f, 0.4f, 0.12f);
        g.GetComponent<Collider>().material = new PhysicsMaterial { bounciness = 0.72f, bounceCombine = PhysicsMaterialCombine.Maximum, dynamicFriction = 0.55f };
        ball = g.AddComponent<Rigidbody>();
        ball.mass = 0.62f;
        ball.linearDamping = 0.1f;
        ball.angularDamping = 0.3f;
        ball.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        ball.interpolation = RigidbodyInterpolation.Interpolate;
        ball.isKinematic = true;
    }

    void Update()
    {
        fps = Mathf.Lerp(fps, 1f / Mathf.Max(0.001f, Time.unscaledDeltaTime), 0.05f);
        var mv = new Vector3(Input.GetAxisRaw("Horizontal"), 0, Input.GetAxisRaw("Vertical"));
        if (!charging && mv.sqrMagnitude > 0)
        {
            player.position += mv.normalized * 5.5f * Time.deltaTime;
            var p = player.position;
            p.x = Mathf.Clamp(p.x, -7f, 7f);
            p.z = Mathf.Clamp(p.z, 0f, RimC.z - 1f);
            player.position = p;
        }
        var toRim = RimC - player.position;
        toRim.y = 0;
        player.rotation = Quaternion.Slerp(player.rotation, Quaternion.LookRotation(toRim), 10 * Time.deltaTime);

        if (held)
        {
            ball.transform.position = player.position + player.forward * 0.35f + Vector3.up * (charging ? 1.35f : 0.1f + Mathf.Abs(Mathf.Sin(Time.time * 7)) * 0.75f);
            if (Input.GetKeyDown(KeyCode.Space)) (charging, meter) = (true, 0f);
            if (charging) meter = Mathf.Min(1.2f, meter + Time.deltaTime / 0.75f);
            if (charging && Input.GetKeyUp(KeyCode.Space)) Shoot();
        }
        else if ((shotT += Time.deltaTime) > 3.2f)
        {
            held = true;
            ball.isKinematic = true;
        }
        // make detection: ball center passes down through the rim plane inside the ring
        if (!held)
        {
            var bp = ball.position;
            bool above = bp.y > RimC.y;
            if (wasAbove && !above && ball.linearVelocity.y < 0 && Vector2.Distance(new Vector2(bp.x, bp.z), new Vector2(RimC.x, RimC.z)) < RimR)
            {
                made++;
                msg = "BUCKET!";
            }
            wasAbove = above;
        }
        // broadcast-ish camera behind the player
        var want = player.position - toRim.normalized * 6f + Vector3.up * 3.2f;
        cam.position = Vector3.Lerp(cam.position, want, 4 * Time.deltaTime);
        cam.LookAt(Vector3.Lerp(player.position, RimC, 0.6f) + Vector3.up * 0.5f);
    }

    void Shoot()
    {
        charging = false;
        held = false;
        shotT = 0;
        taken++;
        float err = meter - 0.95f; // green window at the TOP of the meter
        bool green = Mathf.Abs(err) < 0.06f;
        msg = green ? "GREEN" : err < 0 ? "EARLY" : "LATE";
        Vector3 start = ball.transform.position;
        ball.isKinematic = false;
        ball.position = start;
        // ballistic solve at a fixed release angle; a miss is aimed long / short by the timing error
        Vector3 target = RimC + (green ? Vector3.zero : (RimC - start).normalized * Mathf.Clamp(err, -0.3f, 0.3f) * 1.4f);
        Vector3 d = target - start;
        float h = new Vector2(d.x, d.z).magnitude, dy = d.y, ang = 52f * Mathf.Deg2Rad, g = 9.81f;
        float v2 = g * h * h / (2 * Mathf.Cos(ang) * Mathf.Cos(ang) * (h * Mathf.Tan(ang) - dy));
        float v = Mathf.Sqrt(Mathf.Max(1f, v2)) * 1.012f; // a little extra for the linear damping
        var flat = new Vector3(d.x, 0, d.z).normalized;
        ball.linearVelocity = flat * v * Mathf.Cos(ang) + Vector3.up * v * Mathf.Sin(ang);
        ball.angularVelocity = Vector3.Cross(Vector3.up, flat) * -15f; // backspin
        wasAbove = true;
    }

    void OnGUI()
    {
        var s = new GUIStyle(GUI.skin.label) { fontSize = 22, fontStyle = FontStyle.Bold };
        GUI.Label(new Rect(16, 12, 600, 30), $"UNITY TEST   FPS {fps:0}   {made}/{taken}   {msg}", s);
        GUI.Label(new Rect(16, 40, 800, 30), "WASD move · hold SPACE, release at the top (green)", new GUIStyle(s) { fontSize = 14 });
        if (charging)
        {
            float x = Screen.width / 2 + 60, y = Screen.height / 2 - 80;
            GUI.color = Color.black;
            GUI.DrawTexture(new Rect(x, y, 16, 160), Texture2D.whiteTexture);
            // the bar spans meter 0..1.2; green = 0.89..1.01
            GUI.color = new Color(0.2f, 0.9f, 0.3f);
            GUI.DrawTexture(new Rect(x, y + 160 * (1 - 1.01f / 1.2f), 16, 160 * 0.12f / 1.2f), Texture2D.whiteTexture);
            GUI.color = Color.white;
            float f = meter / 1.2f;
            GUI.DrawTexture(new Rect(x + 5, y + 160 * (1 - f), 6, 160 * f), Texture2D.whiteTexture);
        }
    }
}
