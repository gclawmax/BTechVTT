# Play vs AI development programme

The AI must obey the same rules as a human player, complete every required
activation and leave enough evidence to reproduce a bad decision or stalled
turn. Difficulty changes decision quality, never hidden information or rules.

## AI-1 — deterministic authority foundation

**Implemented in build `20260905-ai-foundation-65` and SQL 123; migration
confirmed live on 6 September 2026.**

- A stable battlefield snapshot records phase, map, ruleset, objectives,
  terrain, minefields and combat state for every BattleMech.
- Every decision derives a seeded random stream from the saved match seed,
  round, phase and snapshot hash. Replaying that state produces the same plan.
- Phase action contracts reject movement, reaction, fire, physical or heat
  actions submitted in the wrong phase.
- Every eligible AI BattleMech within the current activation allowance
  receives an explicit action or explicit pass.
- Each action outcome is attached to a bounded decision history in the match.
- SQL 123 verifies the human controller, active AI seat, round, phase, action
  ownership and immutable deployed-unit identities before accepting state.
- The durable `btech_ai_decisions` record is readable only by match
  participants and is updated as planned actions complete.

AI-1 deliberately retains the current simple tactical choices. It establishes
the boundary required for every later algorithm. SQL 123 must be installed
before this browser build is used for Play vs AI.

## AI-2 — complete weapon-package planning

**Implemented in SQL 124; dedicated live acceptance, soak coverage and AI
ammunition setup hardening are in build `20260906-ai-soak-fixes-68`.**

- Each activation chooses a complete declaration, not a single catalogue
  weapon. Legal mount/mode/bin combinations are evaluated against every
  visible target, including secondary-target penalties.
- Package selection scores hit probability, expected cluster damage, kill
  opportunities, range, arcs, Targeting Computer support, specialist
  ammunition, Ultra/Rotary/LB-X modes, jam risk and ammunition scarcity.
- A post-sink heat ceiling varies by difficulty. Shared ammunition-bin counts
  and destroyed heat-sink capacity constrain the final package.
- Useful mounts may split fire; the selected primary target and every mount's
  ammunition, mode and aimed location are carried in the audit envelope.
- SQL 124 allows only the seated human controller of a Play vs AI match to
  submit for the active AI seat. It then routes the declaration through the
  maintained human multi-target resolver, so the server owns dice, heat,
  ammunition, jams, criticals and damage.
- A rejected package falls back to an authoritative no-fire declaration so a
  planner defect cannot stall the match. The rejected reason remains in the
  audit record.
- `tools/test-ai-weapon-live.mjs` now verifies a real Play-vs-AI decision,
  authoritative declaration, server dice, heat, ammunition and hand-off.
  `tools/run-ai-weapon-soak.mjs` rotates supported catalogue forces and maps,
  deletes passing fixtures and retains failed game codes with JSON reports.
- Play-vs-AI assigns legal immutable Round 1 defaults to the AI force's LB-X,
  MML, ATM and specialist ammunition bins; no absent second human can block
  Initiative or cause an authoritative package rejection.
- The dedicated static regression verifies package composition, heat limits,
  rapid-fire ammunition, split fire, action contracts and the SQL boundary.

SQL 124 must be installed before this browser build is used for Play vs AI.

## AI-3 — tactical movement

**Implemented in build `20260906-ai3-tactical-movement-69` and SQL 125.**

The AI now enumerates rules-legal walking and running destinations, chooses a
deterministic final position from range, cover, terrain, movement, heat,
facing and damaged-unit preservation scores, and submits the chosen path to
the same authoritative movement resolver as a human. Prone and shutdown units
make explicit audited stand, remain-prone and startup choices. Movement plans
are limited to the current activation allowance so uneven forces cannot be
silently completed out of turn.

SQL 125 must be installed before this browser build is used for Play vs AI.

Enumerate legal paths and final facings, then score range bands, line of sight,
cover, terrain, movement modifiers, heat, hazards, objectives and next-round
options. Add explicit standing, remaining-prone and shutdown-startup choices.

## AI-4 — force coordination and initiative

**Implemented in build `20260906-ai4-force-coordination-70`.**

Advanced and Expert AI now produce one deterministic force doctrine for each
activation. It ranks enemy threats, selects a shared focus target, activates
TAG/Narc designators before damage dealers, preserves firing support, values
C3 and missile roles, keeps ECM protection near allies, avoids crowding,
contests objectives and withdraws critically depleted units. The doctrine,
target order, support order and withdrawal list are stored in the normal AI
decision audit envelope.

Coordinate targeting, activation order, firing lanes, scouts, indirect-fire
spotters, C3, TAG/Narc, ECM cover, objectives and withdrawal of crippled units.

## AI-5 — reactions, physical attacks and specialist equipment

**Implemented in build `20260906-ai5-specialist-tactics-71` and SQL 126.**

- Reaction and Physical Attack choices now use the same server-authoritative
  resolvers as human actions, including explicit passes and activation limits.
- The AI plans legal torso twists, rear arm flips and the least costly intact
  prone supporting arm before it selects a complete weapon package.
- It scores every legal punch, kick, push and catalogue physical-weapon limb,
  including carried improvised clubs, TSM and Talon-adjusted damage.
- Advanced and Expert units may declare Charge or Death From Above during
  Movement, then preserve and resolve that commitment in Physical Attacks.
- A unit with working hands can spend Weapon Attack searching woods or rubble
  for an improvised club when close combat makes that useful.
- Hidden enemies remain excluded from target selection. With no visible
  contact the force searches deterministic map sectors, gives active-probe
  units extra scouting value, and avoids enemy minefields only after its seat
  has actually detected them.
- SQL 126 narrowly authorizes the seated human controller to invoke Reaction,
  prone-support, club and physical/displacement resolvers for the active AI
  seat. It does not grant access to an opposing or inactive seat.

SQL 126 must be installed after SQL 125 before this browser build is used for
Play vs AI.

## AI-6 — difficulty and personality

**Implemented in build `20260906-ai6-difficulty-personality-72`.**

- The Dropship exposes four difficulty levels and six optional personalities;
  both choices are saved locally and pinned into the match state.
- Every level uses the same legal information, authoritative resolvers and
  unmodified dice. A lower difficulty no longer randomly declines an otherwise
  legal activation.
- Beginner deterministically samples a broad short-list of reasonable actions;
  Intermediate searches farther and manages range, heat and ammunition;
  Advanced narrows its choices and enables force coordination; Expert evaluates
  the deepest candidate set and consistently selects its highest-ranked choice.
- Balanced, Aggressive, Cautious, Brawler, Sniper and Objective Focused
  doctrines independently weight preferred range, heat ceiling, cover, hazards,
  formation, withdrawal, risky equipment, physical attacks and objectives.
- Difficulty, personality, search breadth and selected action remain in the
  replayable decision envelope, so a surprising choice can be reproduced.
- `tools/test-ai-difficulty-personality.mjs` verifies tier progression,
  unchanged action availability, doctrine differences, deterministic replay and
  the Dropship-to-match persistence path.

AI-6 is client-side decision policy. It adds no new combat authority or SQL.

## AI-7 — evaluation and tuning

Run deterministic AI-versus-AI battles across catalogue units, maps and
victory conditions. Track illegal actions, stalls, heat efficiency, viable
weapons left unused, objective performance, decision time and win-rate changes.
Retain only failures and representative replays.
