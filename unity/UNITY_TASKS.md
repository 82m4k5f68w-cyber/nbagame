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

## B — broadcast, HUD & music (Game/Broadcast.cs, Game/Hud.cs, Game/Music.cs, Assets/Plugins/WebGL/HoopsSpeech.jslib)
Port the browser presentation: src/client/broadcast.ts (banners with slide-in animation, two-part commentary captions
from Fx "cm" + optional voice via the browser's speechSynthesis through a tiny .jslib (no-op outside WebGL), player
intro card at tip-off (S == "intro" is browser-shell state: emulate with a short timer before play starts), momentum
bug, timing card from Fx "tg" (Fx.o fields), rumble), src/client/hud.ts (all 4 meter styles with green at the TOP,
assignMark ring under the focused human's man, stick HUD can be skipped), src/client/music.ts (procedural arena
music: pregame / organ / hype / clutch / calm modes chosen like game.ts loop, riffs, rendered with OnAudioFilterRead
or pre-rendered AudioClips - no assets), halftime: Sim S == "half" -> show halftime stats (TS.qs, TS.xs splits) for a
few seconds then continue (GameMain currently skips "half" immediately; replace that with a hook into Broadcast),
floating world-space texts (Fx "t" with x/y/z) projected with the camera. Move the scoreboard/HUD drawing out of
GameMain.OnGUI into Hud.cs (keep GameMain edits to hook lines). IMGUI or uGUI built from code; scale with
Screen.height (design at 1080p). Coordinate with Menus.cs (S == "menu"/"pause"/"over" screens are Menus').

## N+ — online rework (after the faithful port of part N works; NetLoop test passing)
Each behind a clear flag, with NetLoop.cs tests where possible:
1. Direct P2P: WebRTC DataChannel (unordered, maxRetransmits 0) via the jslib, signaled through presence (temporary
   `rtc` field: compact SDP, non-trickle ICE, STUN stun:stun.l.google.com:19302); while open, send every presence update
   over it too with a sequence number (receivers keep the newest of room/RTC copies); automatic fallback to room/relay,
   retry every 5 s. Must keep working on Wi-Fi with client isolation (fallback). HUD shows DIRECT / RELAY.
2. Latency: adaptive interpolation delay from measured jitter (smallest delay with <2% late snapshots), input
   redundancy (each guest input packet carries the last 3 inputs), snapshots up to 60 Hz on direct (30 Hz relay).
3. Reconciliation: mispredict corrected over 100-150 ms via a decaying render offset; snap only if error > 40 px.
4. Lag compensation for guest shot contests and pass interceptions (host rewinds by RTT/2, max 150 ms; ctrl.lag/LAGBUF).
5. Connection HUD: ping, jitter, loss %, link type; warning icon when bad.
6. Quick rematch + host migration lite: if the host leaves mid-game, the longest-connected guest takes over from the
   last full snapshot instead of the game ending.
Keep it UnityEngine-free where testable.
Status (Oct 2026): N and N+ done. All six items are flags in `NetOpts` (Transport.cs; false = the faithful PROTO 10 port).
`scripts/unity/cs.sh unity/CoreTests/NetLoop.cs [scenario] [lag= jitter= drop= seconds=]` runs RoomTransport retries +
scenarios faithful / improved / improved+rtc / +isolation / +flap (direct dies, relay, retry) / +migration / improved+rematch.
Not testable here: the real WebRTC / room in a browser (HoopsNet.jslib), and a hidden WebGL host tab stops ticking (Unity's
loop is rAF-driven; the browser build keeps a timer).

## U — the browser's menus on top of the Unity game (WebGL template + bridge)
Goal: the Unity WebGL build looks like the current HTML game outside of play: the same hub page, mode cards, patch
notes, matchup screen (team arrows, lineup cards with drawn avatar portraits, team ratings, difficulty, quarter
length, settings drawer), pause menu and final screen (record, player of the game, stat bars, shot charts if cheap,
rematch). Unity renders the game + in-game HUD underneath (Hud.cs / Broadcast.cs stay).
- Unity WebGL template: unity/Assets/WebGLTemplates/Hoops/index.html (+ TemplateData/). Reuse the real markup/CSS from
  index.html and src/client/main.ts (hub) and src/client/game.ts (menu(), settings drawer #sd, pause, final screen):
  copy the CSS and port the DOM-building code to a small plain-JS (or TS compiled by a script in scripts/unity/) file
  in TemplateData — no dependency on the TS sim. Roster data: generate TemplateData/roster.js from src/core/data.ts
  (TM, OV, formOf avatars need name/skin/hair/number/height) with a script in scripts/unity/.
- Bridge: page -> Unity via unityInstance.SendMessage("Hoops2K27", "FromPage", json) ({cmd:"start", mode, sel, opp,
  diff, ql, np, settings...}, {cmd:"resume"}, {cmd:"quit"}, {cmd:"setting", k, v}); Unity -> page via a new
  Assets/Plugins/WebGL/HoopsUi.jslib (e.g. HoopsUi_Show(screen, json) for "pause"/"final"/"menu", HoopsUi_Has()).
  Add a public `FromPage(string json)` handler (GameMain or a new PageBridge.cs MonoBehaviour on the "Hoops2K27"
  object) that maps to the same calls Menus.Go()/settings use. Esc in game -> page pause overlay.
- Menus.cs: when HoopsUi_Has() returns true (WebGL with this template), don't draw the IMGUI screens; otherwise keep
  them (editor / other platforms).
- Editor/Build.cs: PlayerSettings.WebGL.template = "PROJECT:Hoops". The canvas fills the window under the overlays.
- Keep the page light (no frameworks). Test the template page's JS in Node/Playwright with a stub unityInstance
  (no Unity build here): hub renders, clicking a mode opens the matchup screen, Play sends the right JSON, a
  HoopsUi_Show("final", ...) call renders the final screen. Put that test in tests/unity_page.mjs.

## PH — custom deterministic ball physics (Core/BallSim.cs implementing IBallPhysics; Unity uses it instead of PhysX)
Pure C# (no UnityEngine) so it runs in Unity AND in the scripts/unity/cs.sh harness. Mirror the browser Rapier world
(src/core/physics.ts): floor, 4 walls, two glass boards, 24-capsule rims (radius .55 px), kinematic player torso
capsules (same enable rule as rapSyncPlayers), ball radius BR, restitution/friction values and the Average combine
rule. Integrate exactly like the aim pre-simulation in launch() (Sim.B.cs: h = 1/120, symplectic Euler, drag + Magnus
from B.wv, spin decaying with angular damping .3) so free flight is bit-identical to what launch predicts; contacts:
sphere vs capsule/box with restitution on the normal, Coulomb friction coupling linear and angular velocity (spin
grabs the floor/rim/glass: backspin bites on bounce passes, rim english), rolling resistance on the floor, swept-sphere
CCD (sub-steps or conservative advancement) so nothing tunnels, a little rim flex (spring) on dunks/hard hits exposed
for the renderer (BallSim.RimFlex[2]), kinematic forearm/hand capsules from the last skeleton (p.skel joints 13-15,
17-19) that only touch a LOOSE ball (rebound tips), never a shot in flight (cylinder/blocks stay rule-based).
Hook: Sim/upd keep calling Phys.RAP.Step/SyncPlayers; GameMain sets Phys.RAP = new BallSim() (keep PhysXBall.cs as
an option, `cfg` flag or constant). Tests (unity/CoreTests): Greens.cs (port tests/greens.ts: 400 perfect releases
from random spots, expect >= 95% made with BallSim), Bounce.cs (drop test energy loss per bounce vs e, a backspin
bounce pass slows/reverses, a rolling ball stops within a few seconds, a fast ball never passes through the iron),
and GameRun with BallSim (no NaN / stuck clock). Report greens % and before/after numbers.

## AP — Pro Play + animation upgrades (Core, behind `cfg.UP` = 1 in Unity, 0 by default so the TS parity tests hold)
Review Core (Sim.C step / Sim.D ai / Pose.Pose3) against NBA 2K-style move sets and add the biggest gaps, e.g.:
in-and-out dribble, double crossover / combo chains, snatch-back, sky hook and floater variants, contest reactions
(shooter leans away / adjusts release vs a late contest), stronger landings and gathers. Each new move: input mapping
(keep the existing keys; reuse mv codes with new values or modifier keys, document them), CPU usage where it fits,
pose/clip data, blending that passes the jerk/limits/foot-slide budgets. Port the needed TS tests to C# in
unity/CoreTests (Blend.cs jerk budget like tests/blend.ts, Limits.cs joint limits, FootSlide.cs) and run them with
UP=0 and UP=1. Do not change behaviour when cfg.UP == 0 (the Trace.cs lockstep test vs TS must stay identical for the
first 3000 ticks). Report the moves added, keys, and test numbers.
Status (Oct 2026): done. Sim side Core/Sim.UP.cs, poses Core/Pose.UP.cs (hooks in Sim.C/D/E/F/G, Pose.Pose3, Pose.Rest
are all `cfg.UP != 0` guarded; Trace.cs stays identical to the TS). Keys unchanged, the stick picks the variant when the
move key is pressed: C hesitation | C + stick sideways = in-and-out | C + stick pulled back = snatch-back; X spin; V behind
the back | V + stick sideways = crossover; flick at speed = crossover, again within .5 s = double crossover (any move
within .5 s of the last chains a combo); Space driving at the rim from 8-16 ft = gather (two-step / hop-step / spin
gather by the defender's spot, floater vs a rim protector, off-hand reverse on the baseline); post (hold B) + C = sky hook for
tall / skilled bigs. CPU: signature dribble packages (formOf dk), snatch-back vs hard closeouts, drive gathers, floor
putbacks, V-cuts. Defense: slide hips, swipe-downs, hand checks, contest variety; shooters lean away from late
closeouts. Guide hand: post-blend solve keeps the off palm on the ball until the release.
Tests (scripts/unity/cs.sh unity/CoreTests/X.cs UP=0|1): Blend, Limits, FootSlide, GuideHand; GameRun ... up=1; Greens.

## Wave 2 (start when PH / AP / U are merged)
- PH2 physics: ball-vs-player full-body contact for loose balls (all skeleton bones as capsules), rebound physics with
  box-out pushes (bodies as kinematic movers that shove each other via Core collide), shot blocks resolved physically
  (hand capsule vs ball, still gated by the block roll), ball-in-hand dribble with real floor contact + spin (dribble
  sound/feel), tunable "arcade vs sim" physics slider.
- AP2 animation: more motion-capture (CMU) clips retargeted with scripts/mocap/retarget.ts for layups, dunks, defensive
  slides, celebrations; foot-locking / ground-contact solver for every state; look-at + eye-dart improvements;
  full-body IK for rebounds and loose-ball dives; secondary motion (jersey, shorts, hair).
- U2 menus: MyPlayer builder (face/hair/body/ratings, saved), Season / King ladder progress screens, online lobby in
  the same HTML style (create/join, seats, ready, DIRECT/RELAY quality), replay theater (saved highlights), stats
  history, achievements.

## RIG changes (animation pass, Oct 2026)
- None to `RIG` (pose.ts / Pose.Rest.cs `Rig`): checked against adult male anthropometry at 6.4 ft and kept - hip joint
  0.50 H (3.2), shoulder joints 0.80 H (5.1), fingertips hanging 0.39 H, biacromial 1.67 ft (shX .836 x2), hip joints
  0.64 ft apart, thigh 1.58 / shank 1.60. The mannequin look came from the poses (locked knees, poles for arms, feet
  under the hips), not the skeleton. Mesh work should keep these joint positions (fk.ts checks the rig against them).
- Pose-side changes the mesh should expect: standing players now keep soft knees (crouch 0.16), elbows ~0.3 rad,
  hands half curled (g .35), feet slightly wider than the hips; crouched stances put the feet up to 5 px ahead of the
  hip joints (hips sit back); armIK now follows pelvis + chest pitch (ln, cx).
