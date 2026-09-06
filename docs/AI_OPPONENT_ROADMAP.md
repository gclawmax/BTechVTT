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

Enumerate legal paths and final facings, then score range bands, line of sight,
cover, terrain, movement modifiers, heat, hazards, objectives and next-round
options. Add explicit standing, remaining-prone and shutdown-startup choices.

## AI-4 — force coordination and initiative

Coordinate targeting, activation order, firing lanes, scouts, indirect-fire
spotters, C3, TAG/Narc, ECM cover, objectives and withdrawal of crippled units.

## AI-5 — reactions, physical attacks and specialist equipment

Plan torso twists, arm flips, prone support, punches, kicks, pushes, clubs,
charges and DFA. Add tactics for hidden units, probes, minefields and all
supported specialist equipment.

## AI-6 — difficulty and personality

All levels use the same legal information. Beginner samples several reasonable
actions; Intermediate manages range and heat; Advanced coordinates the force;
Expert receives more search depth. Optional personalities alter risk and
objective preferences without granting bonuses.

## AI-7 — evaluation and tuning

Run deterministic AI-versus-AI battles across catalogue units, maps and
victory conditions. Track illegal actions, stalls, heat efficiency, viable
weapons left unused, objective performance, decision time and win-rate changes.
Retain only failures and representative replays.
