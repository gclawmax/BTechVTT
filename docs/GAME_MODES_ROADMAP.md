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

- **Implemented in build `20260907-gm3-authoritative-modes-76`; SQL 128 is
  required.** The server records each point-awarding Control objective and
  unique Breakthrough crossing in `scenario_score_events`. They become part of
  immutable replay snapshots and sealed reports, so an outcome can be
  explained without reconstructing it from the prose log. Minefields remain
  excluded from shared snapshots until GM-4 can provide private views.
- **SQL 129 is also required.** It restores the direct round-end call from the
  maintained Heat resolver to the scenario scorer. This is necessary because
  later Heat updates replaced the older SQL 75 injection point.
- Add dedicated live fixtures for uncontested and contested Control scoring,
  threshold victory, simultaneous threshold draws and elimination fallback.
- Test two unique Breakthrough scorers, repeat-entry idempotence, custom
  deployment zones and destroyed-unit handling.
- Verify phase closure, game banners, telemetry, replay export and After Action
  Reports for each result reason.

Acceptance: every rules case is proven through the deployed server functions,
not only browser simulation. Run `node tools/test-game-modes-live.mjs` after
SQL 128 to exercise the deployed Heat round-end lifecycle; passing fixtures
are deleted automatically and a failed fixture is retained by its game code.

## GM-4 — complete minefield setup and counterplay

- **Implemented in build `20260907-gm4-private-minefields-78`; SQL 130 is
  required.** Minefields are stored outside participant-readable match state.
  Each player receives only owned or detected fields; the server retains the
  complete field for movement, detection, ECM and detonation. Custom scenarios
  now define a per-side point budget (density costs 10/20/30 points), permitted
  mine types, densities and vibrabomb sensitivities.
- The ordinary deployment, movement, probe, ECM, detonation and replay/AAR
  regressions now cover the shared rules path; run the dedicated GM-4 static
  contract after each build, then the live soak after SQL 130 is deployed.

Acceptance: `node tools/test-private-minefields.mjs` verifies the release
contract locally; deployed soak and focused movement fixtures verify the
authoritative trigger path.

## GM-5 — balance and long-run evaluation

- **Implemented in build `20260907-gm5-balance-evaluation-79`.** The
  deterministic AI evaluator now records per-mode and per-map seat wins, score
  differential, time-to-first-objective, timeout rate and no-score rate.
- Coverage rotates built-in maps plus repeatable symmetric and asymmetric
  custom-map fixtures through the same registration path used by the scenario
  editor.
- Balance review flags call out a meaningful seat advantage, excessive
  round-limit adjudications, or objective modes that never score. They are
  informational by default; set `BT_GM5_FAIL_ON_FLAG=1` when using an agreed
  baseline as a release gate.

Acceptance: `node tools/test-ai-evaluation.mjs` protects the aggregation
contract. Run `BT_AI7_RUNS=100 node tools/run-ai-evaluation.mjs` for a release
sample; it writes `ai7-summary.json`, retains failures and bounded
representative replays, and prints every balance-review flag.
