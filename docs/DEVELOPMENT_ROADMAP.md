# BTechVTT — Development Roadmap

Status: **authoritative roadmap**  
Last updated: **2026-08-31**

This document is the single source of truth for development priorities. It
supersedes the roadmap sections in `README.md`, `README2.md`, and
`SKILL_ROADMAP2.md`. Detailed feature proposals may remain in their own design
documents, but their implementation order is governed here.

## Product priorities

1. Human-versus-human play is the primary game mode.
2. Shared-match rules and results must be server-authoritative.
3. Skirmish systems must not create persistent Career rewards, damage, or
   progression.
4. Saved/exported formats must be versioned and remain readable after game
   rules or catalogue data change.
5. Every deployed build has a visible release marker and regression coverage
   proportionate to its risk.

## Completed foundations

| Area | Status | Current capability |
|---|---|---|
| Battlefield | Done | Flat-top hex maps, deployment, facing, terrain, elevation, LOS and cover |
| Turn structure | Done | Initiative, Movement, Reaction, Weapon, Physical, Heat and End phases |
| Combat | Done | Server-authoritative weapon/physical resolution, critical effects, falls, displacement and destruction |
| Multiplayer | Done | Two-player lobbies, realtime synchronization, rejoin and alternating activations |
| Scenarios | Done | Annihilation, Objective Control, Breakthrough and custom map/scenario editor |
| Construction | Done | Custom IS/Clan BattleMechs and supported advanced construction equipment |
| Presentation | In progress | Record sheets, combat-log pacing, sound effects, resizable panels and accessibility improvements |
| Career | Design only | Persistent company proposal exists; no skirmish currently awards persistent progression |

## Current development slice — After-Action Report and Replay Foundation

### Objective

Replace the minimal victory message with a trustworthy, replay-ready match
report. Skirmishes may demonstrate salvage, repairs, injuries and advancement,
but must never apply those outcomes to a persistent player record.

### 1. Authoritative match telemetry

- Record every dice result with its owner, purpose, target number and outcome.
- Record movement, facing, reaction, heat and pilot-state changes as structured
  events rather than relying on prose log parsing.
- Add shot distance, weapon identity, attacker/target identity and damage
  attribution at resolution time.
- Record per-round heat checkpoints so average and peak heat are reproducible.
- Seal a versioned match report when a victory condition resolves.
- Include periodic state checkpoints so a future viewer can seek through a
  replay without rerunning the rules.

### 2. Victory and statistics screen

- Show the correct result for Annihilation, Objective Control, Breakthrough or
  a draw.
- Summarize rounds, survivors, objective scores and total damage.
- Show damage, accuracy, criticals, kills, longest successful shot, highest
  damage BattleMech/weapon, average heat and peak heat.
- Show a 2D6 distribution chart split by player and roll type.
- Compare actual successes with their expected probabilities; do not label a
  player lucky merely because their raw average roll was high.
- Keep the complete battle log available from the result screen.

### 3. Non-persistent Career Preview

- Assess recoverable wrecks and their condition.
- Estimate repairs, rearming and salvage value.
- Calculate illustrative pilot experience and possible skill advancement.
- Mark the entire section **Skirmish preview only — nothing here is saved**.
- Prove with server tests that a skirmish cannot mutate company, hangar, pilot,
  credit, reputation or salvage records.

### 4. Export and retention

- Add **Export Battle Replay** and **Export Battle Report** actions.
- Use a self-contained, versioned `.btvtt-replay.json` format containing the
  map/scenario snapshot, catalogue version, initial forces, ordered events,
  checkpoints, final state and report.
- Exclude authentication IDs, game codes and other private database values.
- Add explicit match type and completion time instead of inferring retention
  eligibility from mutable state.
- Retain completed non-Career skirmishes online for 30 days.
- Run a daily cleanup which never removes an active match or Career battle;
  related combat/log records should be deleted through database cascades.
- Explain the retention period on the victory screen before the player leaves.

### Acceptance criteria

- Both players receive the same sealed report and calculated statistics.
- Reloading or rejoining a completed match reproduces the same report.
- Exported replay data is sufficient to reproduce the battle without rerolling
  dice or invoking contemporary combat rules.
- A replay/report export still opens after its online skirmish is deleted.
- Cleanup tests cover active, recent, expired and Career matches.
- Existing Human-v-Human and focused rules regressions remain green.

## Next slice — Battle Replay Viewer

Place **Battle Replay Viewer** under the Dropship's Editors submenu. It will:

- Import `.btvtt-replay.json` files without uploading them.
- Validate the replay format and report unsupported/corrupt files clearly.
- Reconstruct the exported map and initial forces.
- Play recorded events without rerolling or recalculating rules.
- Provide play/pause, speed, previous/next event, round/phase navigation and
  timeline scrubbing.
- Synchronize battlefield animation, unit inspection and the combat log.
- Prefer recorded unit/map snapshots when current catalogue content differs.

The viewer is deliberately separate from the current slice. The current slice
must nevertheless produce the complete file and event contract it will use.

## Following slice — Persistent Career settlement

Implement the persistent company, hangar, pilot, contract, economy and repair
model after its detailed design has been reviewed. Career settlement will
consume the same sealed match report used by skirmishes:

```text
Completed battle
      ↓
Sealed match report
      ↓
Skirmish → report and preview only
Career   → authoritative settlement
             ├─ salvage ownership
             ├─ persistent damage and repairs
             ├─ pilot injuries and advancement
             └─ contract pay and reputation
```

No persistent Career mutation should be implemented until the report contract
and skirmish isolation tests are complete.

## Later work

- Expand remaining specialist equipment and catalogue-led rule batches.
- Improve AI decision-making without delaying Human-versus-human rules work.
- Production hosting, observability, backups and deployment beyond the current
  GitHub Pages/Supabase development setup.
- Further visual, audio, accessibility and mobile polish.

## Supporting documents

- `README2.md` — current architecture and implemented-feature overview.
- `docs/HOW_TO_PLAY_PROPOSAL.md` — player-facing rules and UI guidance source.
- `SKILL_ROADMAP2.md` — retained as historical roadmap context only.
- `README.md` — legacy project overview; its roadmap is obsolete.
