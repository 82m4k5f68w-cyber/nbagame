# Hoops 2K27 LIFE: Unreal Engine 5 build brief

The Unreal project is **LIFE mode only**: an open-world basketball career. There is no standalone quick play, 5v5
menu or online mode. Basketball happens *inside* the life (practices, pickup, games) the way it does in a 2K
"The City / MyCareer" story, but deeper on the life side.

The web version (this repo) is the reference design. Port its rules; don't reinvent them:
- `src/life/state.ts`: needs, clock, schedule, school, money, followers, career stages.
- `src/life/places.ts`: the town.
- `src/life/social.ts`: Hoopr.
- `src/life/questions.ts` and `src/life/qbank.ts`: classes.
- `src/core/sim.ts`: basketball.
- Roadmap: `docs/LIFE_FEATURES.md` and `docs/LIFE_FEATURES_5K.md`.
- The CLAUDE.md "LIFE" section explains all of it.

## Quality bar
- **Feel first.** Movement is responsive (no input lag over 100 ms) and every action has an animation, a sound and feedback.
- **Seamless world.** No loading screens inside the town:
  - World Partition streaming.
  - Doors open into real interiors.
  - Elevators really move.
- **The world lives without you:**
  - NPCs have schedules.
  - Traffic stops at lights.
  - Shops open and close.
  - Day/night and weather change it.
- **Your choices stick.** Every system feeds the save and shows up later: texts, posts, grades, money, relationships.
- **Fits a MacBook Air (Apple silicon).**
  - Scalability presets.
  - Lumen with a cheaper fallback.
  - Nanite for static meshes.
  - Keep the project under ~60 GB on disk.
  - Tell the user before anything needs more than 20 GB.

## Engine features to use (UE 5.8)
- **World and lighting:** World Partition + Level Instances for interiors; Lumen; Nanite; Virtual Shadow Maps;
  Sky Atmosphere + Volumetric Clouds for the day/night cycle.
- **Characters:**
  - MetaHuman Creator / MetaHuman Generator for the player and every NPC.
  - Motion Matching (Pose Search) + Chooser for locomotion; Control Rig for foot IK and hand IK on the ball.
- **Crowds, traffic and NPCs:** Mass Entity + ZoneGraph for pedestrians and traffic; Chaos Vehicles for drivable rides;
  Smart Objects for "sit, eat, work out, read mail".
- **Input and UI:**
  - Enhanced Input for gamepad and keyboard.
  - CommonUI + UMG for menus and the phone.
- **Game framework:** GameplayAbilitySystem for player stats, buffs and fatigue if useful; SaveGame plus a versioned
  JSON export so web and Unreal saves can share data later.
- **Testing:** Automation Tests for the C++ rules, with parity against the TypeScript (export seeded runs from Node,
  compare in Unreal).

## Milestones
Order matters. Each milestone ends with: a commit, a screenshot or video, a short report (works / broken / next),
and the **acceptance** line passing.

### M1. Core rules in C++
- Port `state.ts` into a `LifeCore` module (no Actors, no rendering) covering:
  - **Time and needs:** clock (game minutes, 1 game min per real second x speed), energy, hunger, mood.
  - **Schedule:** events and their join windows, lateness.
  - **School:** classes, quizzes, homework, exams, GPA, probation.
  - **Money:** paychecks, deals.
  - **Social:** followers, relationships.
  - **Career:** stages (HS -> Signing Day -> college -> draft -> NBA).
  - **Saving:** save, load and migrate.
- **Acceptance:** automation tests reproduce `tests/life.ts` results for the same seeds.

### M2. You
- A character creator: MetaHuman face, height, build, hair, skin, number, archetype, hometown.
- Third-person camera, motion-matched walk, jog, sprint, turns and stops.
- Idles (phone, stretch, look around); sitting and doors through Smart Objects.
- **Acceptance:** walking a 200 m loop looks natural with no foot sliding or popping, on gamepad and keyboard.

### M3. The town
Build `places.ts` at real scale:
- Campus (Hale, Wren and Lab halls, library, dining hall, dorm).
- Summit Arena.
- Iron Temple Gym, Burrito Barn, Slice Society, Morning Grind, Green Leaf.
- Threads, Corner Mart, Fade Factory.
- Central High, The Cage street court, your home and a street of houses.

The world around it:
- Streets with lights and crosswalks, parked and moving cars, pedestrians with day schedules.
- Day/night cycle with lit windows and street lamps; rain.

**Acceptance:** you walk from the dorm to the arena to The Cage with no loading screen, steady frame rate on Medium.

### M4. Interiors
**Every** building in M3 is enterable and walkable:
- **Dorm:** your room (bed, desk, closet, TV, mirror for outfits), hallway, lounge, laundry, roommate.
- **Classrooms:** lecture hall, labs.
- **Library.**
- **Dining hall:** a food line you pick from.
- **Gym:** weights and treadmills as Smart Objects.
- **Shops:** clothing try-on, barber chair, convenience store checkout.
- **Restaurants:** order at the counter, sit and eat.
- **Houses:** front door, living room, kitchen.

**Acceptance:** each place has at least one thing to do that changes your stats.

### M5. Summit Arena, fully walkable
- **Front of house:** plaza and box office, concourse ring with concession stands, team store, seating bowl with
  real sightlines, suites level.
- **Elevators:** working, with call buttons and floor buttons, doors opening and closing.
- **Back of house:** tunnel, home and away locker rooms, training room, media room, two practice courts, a weight room.
- **On game nights:** fans fill the concourse and the bowl, and you walk from the locker room through the tunnel to the court.

**Acceptance:** a full walk from the plaza to a suite to the court, game-night crowd on.

### M6. Phone
- **Behaviour:** works in-world (your character holds it) and as a full-screen UI; notifications vibrate and slide in.
- **Apps:**
  - Lock screen.
  - Messages (reply choices change relationships).
  - Calendar and Map (pins and directions; the gold beacon and HUD arrow lead you to your next event).
  - Bank, Hoopr (feed, posts, replies, trending), School, Stats, Contacts.
  - Settings (day length, alarm, difficulty).

**Acceptance:** every app in the web version (`src/life/phone.ts`) exists and works.

### M7. ZipRide
1. Order a ride in the app.
2. It searches, then **finds** a driver (name, rating, car, plate; a random wait time).
3. The car drives to you through traffic (shown live on the map).
4. You get in.
5. Watch the whole ride (seat camera, the city passing, radio) **or** skip it (time still passes).
6. Pay with a saved card (auto-filled) or PhonePay, then rate the driver.

Prices go up at rush hour, rain and night, and rides can be cancelled.

**Acceptance:** a ride from the dorm to the arena, watched and skipped, both bill correctly.

### M8. Mail, packages and shopping
- **Mailboxes:** realistic mailboxes at houses and dorm mail slots. Open the flag or door, take out the mail, and read
  each letter in-world:
  - letters, bills, recruiting letters, fan mail, coupons;
  - school notices, contract papers, magazines.
- **BoxBay** (everything) and **GameVault** (games and consoles): browse categories, cart, checkout.
- **Delivery and tracking:** Ordered -> Shipped -> Out for delivery -> Delivered, over realistic in-game days.
  The courier van comes to your door.
- **Packages:** the box sits at the door or mail room. You pick it up and open it (cardboard, packing, item reveal),
  and items become usable (clothes in the closet, a console on your TV, gym gear gives buffs).

**Acceptance:** order, wait two in-game days, and the van delivers. Open the package and use the item.

### M9. Basketball inside LIFE
- **Engine:** port `src/core/sim.ts` (ratings, shooting with `greenWin`, contest, fouls, shot clock, AI) into a
  `HoopsCore` module.
- **Modes, all played in the real place:**
  - Practices that are **playable**: you move, run drills and scrimmage.
  - Open gym and pickup at The Cage.
  - HS, college and NBA games in Summit Arena with crowd, broadcast camera, score bug and replays.
- **Results:** your stats feed grades, coach trust, followers and draft stock.

**Acceptance:** playable 5v5 game in the arena.

### M10. Career
- **Stages:**
  - High school season → Signing Day (visits, offers, commit, pick a major).
  - College seasons with March Madness → declare.
  - Combine, interviews, agent → Draft Night.
  - NBA seasons: contracts, All-Star, awards, free agency, trades.
- **Story moments:** shown as in-engine cutscenes.

**Acceptance:** the whole path, from HS to signing an NBA second contract, is playable in one save.

### M11+. Roadmap
- Work through `docs/LIFE_FEATURES_5K.md` tier by tier.
- Add an apartment and car you can buy, jobs, a family story, endorsements, a social life and side activities.

## Workflow for the agent
- Use the unreal-mcp tools to build in the live editor. Use C++ for rules, Blueprints for glue and content.
- Use Blender headless (`blender -b --python Tools/...py`) for props, clothes and mail/package models; export FBX.
- Before each milestone, write a short plan in `Docs/Plan_Mx.md`; after it, update `Docs/Status.md`.
- Keep `CLAUDE.md` in the Unreal project up to date with layout, systems and lessons learned, like the web repo does.
