# Unity layer tasks (one agent per part)

Context: the browser game (TypeScript, src/) is ported to Unity 6 (URP, WebGL/WebGPU builds). The simulation and
animation core is pure C# in unity/Assets/Scripts/Core (namespace Hoops.Core; static classes `Sim`, `Pose`, `Modes`,
`Data`; verified tick-for-tick against the TS). The Unity layer is unity/Assets/Scripts/Game (namespace Hoops.Game):
GameMain.cs (60 Hz loop, input, camera, OnGUI HUD + meter), PhysXBall.cs (ball physics; `PhysXBall.U(x,y,z)` maps game
coords to Unity feet: ((x-470)*.1, z*.1, -(y-250)*.1)), PlayerDraw.cs (placeholder instanced-capsule players + ball),
CourtBuilder.cs (court/hoops/stands/lights), Editor/Build.cs (build settings; URP asset created in code).

Common rules:
- Everything is built from code at runtime (no hand-made assets, no shader compilation: use URP Lit / URP Unlit /
  URP Particles shaders via Shader.Find; if you need a shader in the build, add it to the always-included list in
  Editor/Build.cs the same way URP Lit is added).
- No per-frame allocations in Update paths; GPU instancing (Graphics.RenderMeshInstanced) for repeated objects.
- Do not edit unity/Assets/Scripts/Core (the verified port). Read the TS reference in src/client for what to build.
- Own only the files listed for your part. GameMain.cs is shared: re-read it right before editing and keep your
  change to a few hook lines (e.g. `arena.Tick(dt)`), so parallel agents don't clobber each other.
- Verify by compiling against Unity's managed assemblies (no license needed here):
  cd /home/user/testing/unity && U=/home/user/unity/Editor/Data; M=$U/Managed; NS=$U/NetStandard/ref/2.1.0/netstandard.dll; \
  $U/NetCoreRuntime/dotnet $U/DotNetSdkRoslyn/csc.dll -nologo -t:library -nostdlib -langversion:9 -nullable:disable \
  -warn:0 -out:/tmp/game_$RANDOM.dll -r:$NS $(ls $M/UnityEngine/UnityEngine.*Module.dll | sed 's/^/-r:/') \
  -r:$M/UnityEngine/UnityEngine.dll Assets/Scripts/Core/*.cs Assets/Scripts/Game/*.cs Assets/Scripts/Game/*/*.cs
  (zero errors). URP-only APIs (Volume, UniversalAdditionalCameraData, ...) are not in those DLLs: put that code in
  files under Assets/Scripts/Game/Urp/ and guard nothing - just note in your report that it was not compile-checked,
  and keep it small and standard.
- Final report: what you built, files, what was compile-checked, what is left.

## R — player model (Game/Rig.cs, Game/RigDraw.cs; switch GameMain to it)
Port src/client/rig3d.ts (makeRig, applyPose, faceRest/applyFace, clothStep, footIK, roundBox/shade/isDark) to one
SkinnedMeshRenderer per player built from code: same bone hierarchy and rest offsets (pose.ts RIG is in
Core/Pose.Rest.cs), lathed parts merged into one mesh with bone weights like rig3d's two-bone blends, face bones +
expressions (p.fc), jersey number/name on small quads (Texture2D painted at runtime, digits drawn from a tiny bitmap
font you define), shorts flap cloth bones, foot IK. Colors: bake into a palette Texture2D, per-part UVs to the palette
texel, URP Lit with that as _BaseMap (jersey fabric may use a second knit texture). Rotations: three.js is right-handed
(W3 = [(x-470)*.1, z*.1, (y-250)*.1]); Unity here uses Z flipped, so convert three Euler rotations into the Z-mirrored
frame (negate the X and Y rotation components, keep Euler order semantics) and VERIFY numerically: write
unity/CoreTests/RigCheck.cs (pure C#, run with scripts/unity/cs.sh unity/CoreTests/RigCheck.cs) replicating your bone
chain math and comparing hand/head/foot positions with Core Pose.skeleton()/handPos for several poses. Rebuild a rig
when the player in a slot changes (Sim.SUBV). Keep PlayerDraw for the ball or move the ball into RigDraw.

## A — arena & look (Game/Arena.cs, Game/CameraDirector.cs, Game/Urp/PostFx.cs; may edit CourtBuilder.cs)
Match then beat src/client/render3d.ts + fx3d.ts: instanced crowd (bodies/heads/arms, team colors, stand + wave on
excitement from Fx "x"/makes), courtside row, benches + coaches, referees (render3d refs; whistle on Fx "whistle"),
jumbotron with score (RenderTexture or painted Texture2D), arena lights (catwalk spot lights, light shafts as additive
cones with URP Particles Unlit), net (Core Sim.NETS strands as instanced thin capsules), floor reflections
(Reflection probe / planar via a second camera into a RenderTexture only on High), URP post: Volume with Bloom,
Tonemapping ACES, ColorAdjustments, Vignette, DepthOfField during replays; SSAO via the URP asset renderer feature
(set in Build.cs if possible). Quality tiers + an FPS guard like the browser (drop effects when frames are slow).
CameraDirector: broadcast cam (current), 2K-style low cam, baseline, player lock (cycle with K), replay director
(nearest player to the ball, low angle at the rim) while Sim.RPL != null, huddle/final-buzzer drifts.

## N — online (Game/Net/*.cs, Assets/Plugins/WebGL/HoopsNet.jslib)
Port src/net (transport.ts, protocol.ts, host.ts, guest.ts) and src/client/net (room.ts RoomTransport incl. v5.1
reliability, session.ts lobby flow) to C#. Transport in WebGL: a .jslib bridge calling the page's JavaScript —
the claude.ai room capability when published as an artifact (see how client/net/room.ts calls it) or a WebSocket to
server/relay.ts (same JSON presence protocol, so Unity and browser builds could even share rooms: keep the wire format
identical to PROTO 10). Presence JSON via a small hand-written JSON writer/reader (no Newtonsoft; JsonUtility can't do
dictionaries). In the Editor / non-WebGL, use System.Net.WebSockets.ClientWebSocket for the relay. Host = authoritative
Core sim; guest = prediction + reconciliation exactly like guest.ts. Lobby UI can be minimal IMGUI (create / join by
code, seats, ready). Add a pure-C# loopback test in unity/CoreTests/NetLoop.cs (two in-memory transports, host + guest,
a few seconds of play, guest state close to host) runnable with scripts/unity/cs.sh — keep the protocol/host/guest code
free of UnityEngine so it compiles there (put the Unity/jslib glue in separate files).

## M — menus (Game/Menus.cs) [next batch]
Matchup screen (teams, lineups, difficulty, quarter length), settings (graphics tier, camera, meter style, rules
toggles), pause (resume, replay, matchups, quit), final screen (box score, player of the game, rematch), mode select
(Modes.*). uGUI built from code or IMGUI with a clean skin.
