# Porting src/core (TypeScript) to C# — conventions

Goal: a faithful, fast C# port of the shared simulation (`src/core/sim.ts`, `pose.ts`, `modes.ts`) that runs in Unity
(IL2CPP / WebGL) and in the plain .NET test harness (`scripts/unity/cs.sh`, Unity's bundled Roslyn + .NET 6, C# 9).
The TS stays the reference: same names, same order of operations, same constants, same comments (shortened is fine).

## Layout
- Namespace `Hoops.Core`, folder `unity/Assets/Scripts/Core/`. No `UnityEngine` in Core.
- `sim.ts` -> `public static partial class Sim`, split across files `Sim.<Part>.cs`.
- `pose.ts` -> `public static partial class Pose` (`Pose.<Part>.cs`); `modes.ts` -> `public static partial class Modes`.
- Every TS module-level `let/const/function` becomes a `public static` member with the SAME identifier (lowercase is
  fine: `start`, `setup`, `bstep`, `cfg`, `P`, `B`, `TS`, ...). Exported or not, make it `public static`.
- At the top of every Core file:
  ```csharp
  using System; using System.Collections.Generic;
  using static Hoops.Core.Util; using static Hoops.Core.Data;
  using static Hoops.Core.Sim; using static Hoops.Core.Pose;   // (Modes too where needed)
  ```
  so other parts are referenced by bare name exactly like the TS imports.
- Already written (do not redefine): `Types.cs` (Input, Ctrl, Stats, Scout, Fx, Rng), `Ball.cs` (Ball, PassPlan),
  `Player.cs` (Player core fields from mkP, `PlayerAi`), `Util.cs`, `BallPhysics.cs` (`Phys.RAP`, `IBallPhysics`),
  `Data.cs` / `Data.Gen.cs` (TM, SP, OV, CL, CK, SIG -> `FormOf`, `Ov2`, `IsDunkSv`, `IsLaySv`, Tuple fields
  `n c i s d j st skin hr bd ht bk num` = TS a[0..12]).

## Types
- Numbers are `double` (JS semantics). Use `int` only for loop counters / indices.
- Player / Ball / AI fields: plain `double` when TS reads `undefined` as 0 (`p.x || 0`, `(p.heat || 0) >= 3`,
  `if (p.helpT > 0)`), `double?` when TS distinguishes undefined (`p.mvEnd != null`, `p.en ?? 1` *and* it can be
  unset). Booleans used only as booleans -> `bool`. Strings stay strings (`mode == "s"`).
- A field your part needs that is not in Player.cs: add it in YOUR file inside `public partial class Player { ... }`
  (same for `PlayerAi`, and any new helper class). List the fields you added at the end of your report.
  Duplicates across parts are merged at integration - that is fine.
- Ad-hoc TS object literals become small classes (e.g. `TS` -> `public sealed class TeamState` + `public static TeamState TS`,
  `JB` -> `JumpBall`). `STAT` (dynamic keys) -> `Dictionary<string, double>` with a `stat(key)` / `statAdd(key, v)` helper.
- Arrays: fixed-size numeric -> `double[]`; growable / spliced -> `List<T>`. `P` is `List<Player>`.
- Player / object identity comparisons (`a === b`) are reference equality - same in C#.

## Semantics that bite
- `Math.random()` -> `Rng.R()` ALWAYS (deterministic parity tests). Call it in the SAME order as the TS
  (watch `a && Math.random() < x`, ternaries, and argument evaluation order).
- `Math.round` -> `Round` (JS rounds .5 up). `x | 0` -> `I(x)`. `Math.sign` -> `Sign`. `Math.hypot` -> `Hypot`.
  `Math.max(...arr)` -> `Max(arr)`. `>>> 0` -> `uint` math in `unchecked`. `Math.imul` -> `unchecked((int)a * b)`.
- JS `sort` is stable: use `SortStable(list, (a, b) => Cmp(expr))`. Never `List.Sort`.
- Truthiness: `if (x)` on a number -> `T(x)` (0 and NaN are false). `a || b` on numbers -> `T(a) ? a : b`.
  `a ?? b` -> `a ?? b` with nullable, or just `a` when the field is always initialised.
- `arr.find`, `some`, `filter`, `indexOf`: write simple loops in per-tick code (no LINQ / lambdas allocating every
  tick - this is the "highest performance" part: zero GC in `upd`). LINQ is fine in one-off setup code.
- String concatenation for FX texts is fine (only on events).
- Optional chaining `a?.b` -> `a?.b` or explicit null checks.
- Closures that capture loop variables: C# `foreach` captures per iteration like JS `let`; classic `for` does NOT.

## Physics
`useRap()` = `Phys.RAP != null && cfg.physics == "rapier"`; `rapStep(dt, B)` -> `Phys.RAP.Step(dt, B)`;
`rapSyncPlayers(P, B)` -> `Phys.RAP.SyncPlayers(P, B)`. The aim pre-sim inside `launch` stays as TS (it mirrors the
engine step; Unity's PhysX backend implements the same integration).

## Checking your part
Compile everything with `scripts/unity/cs.sh unity/CoreTests/Compile.cs` (a no-op Main). Other parts may still be
missing while ports run in parallel: errors about identifiers that belong to OTHER parts are expected; fix every
error inside your own file(s).
