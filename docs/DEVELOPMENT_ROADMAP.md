# BTechVTT — Development Roadmap

Status: **authoritative roadmap**  
Last updated: **2026-09-02**

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

Implementation status: **implemented through SQL 103; live migration and
battle validation pending**. Telemetry records ordered combat results,
purpose-labelled dice, damage attribution, unit state changes, phase changes,
round checkpoints and a sealed report envelope. SQL 101 calculates statistics,
and SQL 103 adds the isolated preview, portable exports and skirmish retention.

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

Implementation status: **implemented; live battle validation pending**.

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

Implementation status: **implemented; deliberately read-only**.

- Assess recoverable wrecks and their condition.
- Estimate repairs, rearming and salvage value.
- Calculate illustrative pilot experience and possible skill advancement.
- Mark the entire section **Skirmish preview only — nothing here is saved**.
- Prove with server tests that a skirmish cannot mutate company, hangar, pilot,
  credit, reputation or salvage records.

### 4. Export and retention

Implementation status: **implemented; scheduler activation and live cleanup
validation pending**. SQL 103 schedules the daily cleanup automatically when
the database has `pg_cron`; otherwise the same server-only function can be
scheduled by the hosting environment.

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

- Expand remaining specialist equipment and catalogue-led rule batches (see
  **BattleMech specialist-rules programme** below).
- Improve AI decision-making without delaying Human-versus-human rules work.
- Production hosting, observability, backups and deployment beyond the current
  GitHub Pages/Supabase development setup.
- Further visual, audio, accessibility and mobile polish.

## BattleMech specialist-rules programme

This is the authoritative plan for completing the remaining **BattleMech duel**
rules from the local Total Warfare reference. It deliberately excludes vehicles,
infantry, aerospace, artillery, underwater combat and sea mines: those are
separate game modes, not additions to the Human-versus-human BattleMech core.

### Target rules era and acceptance force

The intended play baseline is **Level 2 / circa 3060 BattleTech**: standard
BattleMech duels should support the technologies commonly encountered in that
era before later or niche systems are prioritised. The Dragon family is the
standing acceptance force because it crosses the eras without requiring a
separate game mode:

- Grand Dragon DRG-5K: ER PPC, rear-mounted lasers and LRM;
- Dragon DRG-5N: Ultra AC/5;
- Dragon DRG-7N: Gauss Rifle and MRM 10;
- Grand Dragon DRG-7K: ER lasers, ER PPC and MRM 10; and
- Grand Dragon DRG-9KC: Snub-Nose PPC, MML 5, rear-mounted laser and C3
  Master TAG.

These variants are already imported. Each catalogue or rules change affecting
one of their systems must be checked against a live Dragon acceptance battle,
not merely verified as loadable catalogue data.

### Already supported

Do not re-open these as speculative rule work. They need ordinary regression and
live-battle validation, but their core rules are already in the authoritative
engine: MASC; arm flipping and improvised clubs; Charge, Push and Death From
Above; critical effects, falling and displacement; AMS; ECM, Active Probe,
Targeting Computers and C3/C3i; TAG, Narc and Artemis guidance; LB-X cluster
fire; Ultra AC rapid fire; Streak missiles; MRM, MML and Snub-Nose PPCs; plasma
weapons; Inferno, Precision, armour-piercing, flechette, fragmentation and
semi-guided ammunition; indirect LRM fire; advanced terrain, concealment and
minefields.

### Rules delivery standard

Every slice must be catalogue-led and release together with:

1. server-authoritative declaration and resolution rules;
2. critical-slot destruction, ammunition, heat, arcs, range and terrain
   interactions where applicable;
3. MechLab construction support only after the rules resolve correctly;
4. a small curated set of affected BattleMech variants; and
5. focused automated rules regressions plus a two-player live smoke battle.

No unsupported MegaMek record should be selectable merely because its static
weapon profile resembles a supported weapon.

### Quality slice Q-1.1 — Repeatable BattleMech duel regression

Before SR-1 expands the equipment catalogue, extend the existing test facility
into a repeatable **duel soak harness**. It will create isolated disposable
two-player matches, run bounded turns through the real browser and public
authoritative RPC paths, and retain the game code/report only when a run fails.

The harness must rotate supported one-on-one custom skirmishes across the
Training Grounds, Woodland Approach, Open Engagement, Flatlands and Ridge and
Ford maps. Each normal iteration chooses a seeded-random pair from the pinned
catalogue's fully supported, non-custom BattleMechs that fit the test force
limit and movement path; the seed is reported so a failure is reproducible. A
small fixed force matrix remains available only for isolating a known failure.
It must cover
standing, walking, running and jumping; weapon fire and ammunition expenditure;
Heat Management; physical attacks where legal;
destruction/end conditions; rejoin; and a Dragon acceptance matrix. It must
assert phase termination, no uncaught browser or server error, non-negative
armour/structure/ammunition, valid heat-ledger reconciliation and a sealed
report at battle end. Random dice are expected; rule invariants, not a
particular roll result, determine success.

Run the fast deterministic tests on every change, the one-pass live battle
suite before release, and the repeated soak suite against dedicated disposable
test accounts before importing a specialist equipment batch.

### Slice SR-1 — Rotary AC and ballistic fire modes

Add Rotary Autocannon 2/5/10/20 with selectable firing rates, ammunition use,
the correct hit and jam behaviour, and destruction/jam state that persists for
the battle. Finish any remaining standard ballistic fire-mode edge cases at the
same time, but do not broaden this into vehicle flak or anti-infantry rules.

**Why first:** it is a self-contained declaration/resolution problem and opens
many classic Inner Sphere variants without changing movement or targeting.

### Slice SR-2 — Advanced missile families

Add ATM ammunition bands and payload choices, Thunderbolt missiles, and
Streak-LRM behaviour, including their ranges, cluster/damage grouping,
ammunition capacity, indirect-fire eligibility and AMS interaction. Extend only
the guidance interactions that these launchers actually need; TAG, Narc,
Artemis and conventional LRM/SRM support remain the shared base.

**Boundary:** do not add artillery missiles, vehicle-only launchers or aerospace
interception in this slice.

### Slice SR-3 — Advanced direct-fire weapons

Add the remaining BattleMech-relevant Gauss and laser/PPC families in a curated
batch: Light and Heavy Gauss Rifles, relevant pulse/ER variants, and specialised
direct-fire weapons whose range, damage, heat, explosion or to-hit behaviour is
not already expressible by a normal profile. Each weapon is added only alongside
a canonical variant that exercises it.

**Boundary:** a simple canon stat variation can be imported as data; a new
special rule must have its own resolution test before it appears in the hangar.

### Slice SR-4 — Heat and mobility equipment

Add Superchargers and Triple-Strength Myomer. This covers activation timing,
movement changes, failure/critical consequences, heat thresholds, physical-damage
modifiers and interactions with existing MASC, shutdown and piloting checks.

Implementation status: **implemented in SQL 118; live migration and soak
validation pending**. The MechLab, local AI battle path and shared authoritative
resolver use the same heat threshold, movement ratings and physical-damage rules.

**Why isolated:** this is the highest-risk slice because it spans Movement,
Physical Attacks, Heat Management and critical damage.

### Slice SR-5 — Signature and advanced electronic defence

Add the BattleMech-facing stealth/signature systems and the remaining electronic
variants only where the Total Warfare rules give them a meaningful duel effect.
They must share the existing authoritative ECM/LOS/heat framework, display their
current state clearly and fail safely when damaged. This includes any supported
advanced ECM or signature equipment, not a new generic modifier system.

Implementation status: **implemented in SQL 119; live migration and soak
validation pending**. Angel ECM, Watchdog CEWS, Clan Light Active Probes, and
selectable Null Signature, Void Signature and Chameleon LPS modes now share the
authoritative ECM, weapon-targeting and Heat Management paths.

### Slice SR-6 — Ruleset controls and equipment audit

Add a match-level ruleset choice to make the intended 3060 BattleMech game
explicit: Standard 3060, Advanced 3060, or Open / Experimental. The client
must explain the choice and filter the Hangar; the authoritative roster and
Hangar functions must independently enforce it against the match's pinned
catalogue.

Implementation status: **implemented in SQL 120; live migration and soak
validation pending**. Standard 3060 excludes custom designs and the currently
supported advanced booster/signature systems; Advanced 3060 permits supported
equipment introduced by 3060; Open permits all supported catalogue units.

### Slice SR-6b — Remaining physical equipment and specialist defensive gear

Complete the curated BattleMech physical-equipment table and defensive equipment
that affects a duel: for example, remaining melee implements or shields where
their published rules differ from the existing hatchet/sword/club framework.
Each item must state its required actuators, usable arc, attack phase, damage and
critical-slot failure behaviour.

### Slice SR-7 — Catalogue completion and rules audit

After the preceding slices, run an import audit against the desired Inner
Sphere/Clan roster. Categorise every excluded BattleMech as either:

- now fully supported and safe to import;
- blocked by one named future BattleMech rule; or
- blocked because it belongs to an excluded non-BattleMech subsystem.

The output is a small, reviewed import batch rather than a large untestable
catalogue dump. Re-run the Human-versus-human battle regression with at least
one representative unit from every specialist family.

## Supporting documents

- `README2.md` — current architecture and implemented-feature overview.
- `docs/HOW_TO_PLAY_PROPOSAL.md` — player-facing rules and UI guidance source.
- `SKILL_ROADMAP2.md` — retained as historical roadmap context only.
- `README.md` — legacy project overview; its roadmap is obsolete.
