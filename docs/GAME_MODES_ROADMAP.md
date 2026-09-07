# Game modes and minefield development roadmap

This roadmap covers the three current victory modes—Annihilation, Objective
Control and Breakthrough—and pre-battle minefield planning. Elimination remains
an immediate victory in every mode. Underwater combat and sea mines remain out
of scope.

## Audit findings

- Objective AI valued only an exact objective hex. It did not value progress
  toward that hex, and Breakthrough provided no strategic destination at all.
- Play vs AI still creates one fixed demonstration battle, so players cannot
  yet select an objective mode, map or force for the computer opponent.
- The AI-7 evaluator used one BattleMech per side and treated one unit reaching
  the far side as a Breakthrough win, while the real mode requires two distinct
  BattleMechs to enter the enemy deployment zone.
- Server default deployment zones used fixed 16-column boundaries. Those
  boundaries were wrong for 32×17 maps and therefore affected deployment,
  Breakthrough scoring and minefield legality.
- Minefields were appended one click at a time with no reviewable plan or
  individual removal. Changing them also did not explicitly withdraw Ready.

## GM-1 — mode contract and planning foundation

**Implemented in build `20260907-game-modes-74`; SQL 127 is required.**

- Give every mode one shared label, target and plain-language scoring contract.
- Show control objectives or Breakthrough goal zones in match setup and on the
  live battlefield.
- Make AI movement value progress, proximity and arrival for Control and
  Breakthrough; units which have already scored a breakthrough resume normal
  tactics.
- Make AI-7 objective tests use two-unit forces, two unique breakthrough
  scorers and end-of-round scoring after Heat.
- Make authoritative built-in map dimensions and default edge deployment zones
  map-aware.
- Replace minefield append operations with one atomic, per-seat plan. Show the
  plan, permit individual removal, retain the placement tool between placements
  and withdraw Ready whenever the plan changes.

Acceptance: static mode regressions pass; AI evaluation records no illegal or
stalled objective plans; SQL 127 installs; live Control, Breakthrough and
minefield-plan acceptance passes.

## GM-2 — configurable Play vs AI scenarios

- **Implemented in build `20260907-gm2-ai-skirmish-75`.** Route Play vs AI
  through a setup screen for map, ruleset, force budget, victory mode,
  difficulty and personality instead of the fixed demonstration battle.
- Seed a legal suggested human force into the normal match-only Hangar; the
  player can alter it, then deploy every BattleMech in the existing lobby.
- Generate a deterministic, legal, comparable AI force and map-aware formation.
  Formations spread toward Control objectives or Breakthrough lanes where the
  selected mission has them.
- Let the Map & Scenario Editor launch its saved custom battlefield directly
  into this same Play vs AI lobby.
- AI minefields deliberately remain deferred: the present browser-hosted AI
  cannot keep an unrevealed field private from the human-controlled browser.
  GM-4 will add the required private authoritative delivery before enabling
  computer mine placement.

Acceptance: a player can complete all three modes against AI on standard,
dual-board and custom maps without manual database setup. This is covered by
the GM-2 setup regression; live mode-matrix coverage remains GM-3.

## GM-3 — authoritative live mode matrix

- Add dedicated live fixtures for uncontested and contested Control scoring,
  threshold victory, simultaneous threshold draws and elimination fallback.
- Test two unique Breakthrough scorers, repeat-entry idempotence, custom
  deployment zones and destroyed-unit handling.
- Verify phase closure, game banners, telemetry, replay export and After Action
  Reports for each result reason.

Acceptance: every rules case is proven through the deployed server functions,
not only browser simulation.

## GM-4 — complete minefield setup and counterplay

- Replace the temporary field-count allowance with an explicit scenario budget
  and document how density spends that budget.
- Add scenario-editor controls for allowance, permitted mine types, density and
  vibrabomb sensitivity.
- Audit private-state delivery so unrevealed enemy fields are not present in a
  player-readable payload.
- Add legal deployment, trigger, depletion, probe detection, ECM interference,
  replay and AAR live fixtures.

Acceptance: setup choices, hidden information and every supported trigger are
authoritative and reproducible.

## GM-5 — balance and long-run evaluation

- Add per-mode AI-7 completion, score differential and time-to-objective
  baselines.
- Rotate standard, procedural and custom maps with asymmetric and symmetric
  objective layouts.
- Flag modes that routinely time out, never score, favour one seat or cause AI
  units to ignore viable objectives.

Acceptance: release soaks publish meaningful per-mode pass and balance results,
with failures retaining compact replays.
