// Physics backend seam (port of the src/core/physics.ts API the sim uses: RAP, rapStep, rapSyncPlayers).
// Unity provides a PhysX implementation (Assets/Scripts/Game/PhysXBall.cs); tests run with null = the sim's legacy ball.
using System.Collections.Generic;

namespace Hoops.Core
{
    public interface IBallPhysics
    {
        /// <summary>Advance the airborne ball with drag + Magnus from its spin (B.wv), then the engine step.</summary>
        void Step(double dt, Ball b);
        /// <summary>Kinematic torso capsules so a loose / shot ball can bounce off bodies.</summary>
        void SyncPlayers(List<Player> p, Ball b);
    }

    public static class Phys
    {
        /// <summary>The engine (RAP in TS). Null = not ready / legacy physics.</summary>
        public static IBallPhysics RAP;
    }
}
