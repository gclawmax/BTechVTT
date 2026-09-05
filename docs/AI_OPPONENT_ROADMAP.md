# Play vs AI development programme

The AI must obey the same rules as a human player, complete every required
activation and leave enough evidence to reproduce a bad decision or stalled
turn. Difficulty changes decision quality, never hidden information or rules.

## AI-1 — deterministic authority foundation

**Implemented in build `20260905-ai-foundation-65` and SQL 123; live migration
validation pending.**

- A stable battlefield snapshot records phase, map, ruleset, objectives,
  terrain, minefields and combat state for every BattleMech.
- Every decision derives a seeded random stream from the saved match seed,
  round, phase and snapshot hash. Replaying that state produces the same plan.
- Phase action contracts reject movement, reaction, fire, physical or heat
  actions submitted in the wrong phase.
- Every eligible AI BattleMech receives an explicit action or explicit pass.
- Each action outcome is attached to a bounded decision history in the match.
- SQL 123 verifies the human controller, active AI seat, round, phase, action
  ownership and immutable deployed-unit identities before accepting state.
- The durable `btech_ai_decisions` record is readable only by match
  participants and is updated as planned actions complete.

AI-1 deliberately retains the current simple tactical choices. It establishes
the boundary required for every later algorithm. SQL 123 must be installed
before this browser build is used for Play vs AI.

## AI-2 — complete weapon-package planning

Choose complete, legal declarations rather than one weapon. Score expected
damage, heat, ammunition, range, arcs, firing modes, specialist ammunition,
targeting support and split fire. Move weapon/damage resolution onto shared
authoritative server routines rather than trusting client-calculated outcomes.

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
