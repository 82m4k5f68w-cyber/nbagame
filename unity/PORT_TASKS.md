# Port tasks (one agent per part)

Common rules for every part:
- Read `unity/PORTING.md` first and the existing C# in `unity/Assets/Scripts/Core/` (Types.cs, Ball.cs, Player.cs,
  Util.cs, BallPhysics.cs, Data.cs, Data.Gen.cs). Follow the conventions exactly.
- Write ONLY your own output file. Other parts are ported in parallel into their own files; reference their
  functions/state by bare name exactly as the TS does (`using static` makes that work).
- Player / PlayerAi fields missing from Player.cs: declare them in YOUR file inside `public partial class Player { }`
  (or `PlayerAi`). Ball is sealed: list Ball fields you need that Ball.cs lacks in your report.
- Faithful: same logic, constants and order; `Rng.R()` in the same call order as `Math.random()`; stable sorts; JS
  rounding / truthiness / nullables. Per-tick code allocates nothing (no LINQ, no per-tick lambdas or arrays).
- Check: `cd /home/user/testing && scripts/unity/cs.sh unity/CoreTests/Compile.cs 2>&1 | grep "<YourFile>" | head -60`
  and fix every error located in your file that is not merely a missing identifier owned by another part.
- If your output file already exists (an earlier run was interrupted), continue it instead of starting over.
- Final report (concise): what you ported, fields/classes you declared, Ball fields you need, unsure TS constructs.

## A -> Sim.A.cs — src/core/sim.ts lines 1-1037
Header, `cfg` (a static instance of a class with the TS key names; `input` is `Func<Ctrl, Input>`), module state
(S, P List<Player>, B Ball, sc, q, clock, shot, pos, T, rs, pend, fin, cl, PC, PCNT, LASTP, DT, fc, ftq, tf, inb, RQ,
RPL, QTRLEN, CT List<Ctrl>), FX helpers (fx/txt/txtW/snd/exc/fxp/HOOK with pre Action<double>, post Func<double,bool>,
end Action), setters, mkCtrl, setScalars, rosters (ALL, MYP, mkT, nChoices, RO, allStar, RS, ovr), SHOTS, start, jump
ball (JB class JumpBall, tallest, beginJB, TOSS, jbStep), mkP, RNAME, reserves, BENCH/ROST, BADGE/hasB/badgesOf,
zoneOf, ZN, clutchTime, TS (class TeamState), scoutNew, GPN/DSN/PCN, resetRules, cm/ban, winMul, zoneRes, rngOf, scout,
PRI/pps/form, hotNow, gamePlan, halftimeAdjust, runAdd, callTO, challenge, whistle, subs, swap, SUBV, lineup,
applyLineup, rulesTick, violation, setupAt, INB/inbMove, TEND/tendOf/TW/baseTend, gameLike, bcast, autoMatch,
guardOf, cpuK, nearest. If STAT is declared in this range, make it `Dictionary<string,double>` + helpers.

## B -> Sim.B.cs — sim.ts lines 1038-1554
setup, setupHalf, nearestFree, ctrlOf, isH, tempoOf, pass, pick, useRap, shotRat, launch (incl. the aim
pre-simulation that mirrors the engine step — port exactly), LAGBUF, lagFrame, lagRec.

## C -> Sim.C.cs — sim.ts lines 1555-2026
step (player movement / shooting state machine), mv, NOIN.

## D -> Sim.D.cs — sim.ts lines 2027-2773
ai (CPU brain), helpPlan + HPL, ZS, zoneMan, stepLen, celebrate, dribTop, dz, FTCUT, ftStyle, heldBall, HSK, HOLDP,
heldZ, dribHand.

## E -> Sim.E.cs — sim.ts lines 2774-3246
SORTP, bstep (ball state machine; `rapStep(dt, B)` -> `Phys.RAP.Step(dt, B)`), ZIN, ZERO_IN, zin.

## F -> Sim.F.cs — sim.ts lines 3247-3668
upd (the 60 Hz tick; `rapSyncPlayers` -> `Phys.RAP.SyncPlayers`), deadBall, postGame, endGame, foul, tech, startFT,
ftLay, ftTick, ftIn. Define a class for `ftq` (see startFT) if Sim.A.cs did not.

## G -> Sim.G.cs — sim.ts lines 3669-4449
manOf, starOf, isoNow, newPlay/PLAY, offBall, SPA, loose, cut, pickClip, FLAG, shootingFoul, contestRaw, contestOf,
collide, net (NS, NETS, SEGR, netSim, inNet), replays/highlights (RCAP, FST, REC float[], recS, recN, RPK, recClear,
hlClear, recFrame, recApply, LIVE, RSP, RSPD, setRplSpeed, HL, HLN, saveHL, playClip, startReplay, skipReplay,
rplStep, setRPL).

## P1 -> Pose.Pose3.cs — src/core/pose.ts lines 113-1735
The whole `pose3(p)` function. Joint values `p.q` are class `Q` (defined by P2: double fields per QK channel + `mir`,
indexer by channel index, Get/Set by name). Reuse a static target instance instead of allocating per call.

## P2 -> Pose.Rest.cs — pose.ts lines 1-112 and 1736-2380
Mocap helpers (MCC, MI, MO, mcSample, mcBlend, smp; decode Data.MC_RAW base64 -> sbyte like atob + Int8Array),
CLIPK, CO, clip, fv, AV, segDist, avoidBodies, plantFeet, PSK, SWA/setSWA, stepSolve, FT/face, wrapPi, inert, IK,
armIK, armN, RELK, NQ/QK, HEADX..., ST/BLEND, RIG, hipAb, rx/ry/rz/add, QT, palmAt, handPos, mm, rot, MP pool / M(),
euler, FP pool / child / pt, SKF, skeleton (allocation-free). Define `public sealed class Q` (see P1) and
`public Q q` on Player.

## M -> Modes.cs — all of src/core/modes.ts
`public static partial class Modes` (+ helper classes). Dates: System.DateTime (JS getMonth is 0-based).
