# BTechVTT — Development Roadmap

Status: **authoritative roadmap**  
Last updated: **2026-09-10**

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
| After Action / Replay | Done | Sealed telemetry, statistics, report/replay exports, 30-day skirmish retention and offline replay viewer |
| Game modes | Done | Authoritative Control/Breakthrough, custom and variable maps, private minefields, Play vs AI and GM-5 balance evaluation |
| Career | Done: founding arcs | Persistent company, settlement, repairs, BV bands, salvage, markets, pilot advancement, travel, factions, immutable origins and three-operation arcs; skirmishes remain isolated |

## Current development priority — polished human skirmish

The acceptance match is two Inner Sphere BattleMechs against one Clan
BattleMech at comparable pilot-adjusted BV, with minefields disabled.
Persistent Career expansion is secondary to this player-tested workflow.

1. Verify stock BV provenance, pilot adjustments, server cap enforcement and
   live deployment status. Compare both forces visibly in the lobby.
2. Simplify setup, ammunition confirmation and deployment; use callsigns and
   clear readiness prompts. Remove the extra Hangar-to-Dropship selection
   step for skirmishes after updating the authoritative roster workflow.
3. Improve map readability, tree rendering, chassis imagery and token labels.
4. Improve movement trails, undo/reset, movement status, turn allocation,
   expandable combat logs and Alpha Strike selection.
5. Complete a two-browser three-Mech battle, including reconnect coverage.
6. Final milestone: contextual instructions and gradual, replayable beginner
   tutorials for skirmish and campaign play.

Career-4b and further persistent progression are deferred until this
skirmish milestone is accepted. Existing Career functionality is retained.

## Completed recent programmes

- **AAR and replay:** implemented through SQL 103, including sealed reports,
  exports, skirmish retention, a non-persistent Career preview, and the
  Dropship Replay Viewer.
- **AI-1 through AI-7:** implemented through SQL 126. AI now has complete
  legal planning across all phases, difficulty/personality policies, and a
  deterministic evaluator. Future AI changes must be baseline-led rather than
  speculative; see `docs/AI_OPPONENT_ROADMAP.md` and `docs/AI_EVALUATION.md`.
- **GM-1 through GM-5:** implemented through SQL 127–130 and build
  `20260907-gm5-decisive-pairs-81`. The modes roadmap records the acceptance
  commands and the paired balance methodology.
- **BV-1 through BV-4:** implemented through SQL 132–133 and SQL 140, ending
  at build `20260908-career-bv4-94`. Verified MegaMek BV2 values, pilot-adjusted
  server checks, selectable match formats, deterministic BV-limited AI forces,
  final force sealing, and Career contract bands are now available. BV-5
  remains deferred custom-design work.

## Later work

1. **BV-5:** validated custom-design BV2 breakdowns, deferred until MechLab support is
   sufficiently complete. See [Battle Value Design](BATTLE_VALUE_DESIGN.md).
2. **Career-4b:** optional PvP tenders with explicit two-company consent,
   withdrawal rules and idempotent dual settlement.
3. **Level 2 catalogue additions:** curated, catalogue-led systems not already
   covered by the specialist-rules programme below. Each remains gated by an
   authoritative resolver and a representative live battle.
4. **Operations:** scheduled retention cleanup verification, deployment
   observability/backups, and production monitoring.
5. **Presentation:** accessibility, mobile, map/editor and audio polish driven
   by player feedback.

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

Implementation status: **Talon kick damage and Mechanical Jump Boosters implemented in
SQL 121; shield and AES equipment remains deliberately catalogued as later-era
Open/Experimental work until selectable defensive modes and their full
authoritative damage interactions are introduced.** This prevents a future
catalogue import from quietly treating those systems as cosmetic.

### Slice SR-7 — Catalogue completion and rules audit

After the preceding slices, run an import audit against the desired Inner
Sphere/Clan roster. Categorise every excluded BattleMech as either:

- now fully supported and safe to import;
- blocked by one named future BattleMech rule; or
- blocked because it belongs to an excluded non-BattleMech subsystem.

The output is a small, reviewed import batch rather than a large untestable
catalogue dump. Re-run the Human-versus-human battle regression with at least
one representative unit from every specialist family.

Implementation status: **implemented in SQL 122.** The SR-7 release extends
curated-05 to 85 BattleMechs with a reviewed Inner Sphere/Clan batch. Its
strict builder and `test-sr7-catalogue-audit.mjs` keep any unknown equipment
out of the playable catalogue; the full audit is recorded in
`docs/SR7_CATALOGUE_AUDIT.md`.

## Supporting documents

- `README2.md` — current architecture and implemented-feature overview.
- `docs/HOW_TO_PLAY_PROPOSAL.md` — player-facing rules and UI guidance source.
- `docs/AI_OPPONENT_ROADMAP.md` — authoritative Play vs AI development slices.
- `SKILL_ROADMAP2.md` — retained as historical roadmap context only.
- `README.md` — legacy project overview; its roadmap is obsolete.

## Vs AI playtest and polish programme

Human skirmish remains primary; AI work must strengthen the shared rules path.
Prioritise reliable turn completion and understandable decisions before harder Expert tactics.

1. **Implemented locally — editable solo setup (build 113, SQL 152; live setup acceptance passed 2026-09-11).** Host can change AI mechs and pilot names/skills before starting. Clan defaults 3/4, IS 4/5 on both suggested forces; all BV budgets use adjusted values. Mines default off and are unavailable in Standard 3060. Server rejects non-host, non-AI and started-match edits.
2. **Fixture verified — repeatable acceptance match.** Verify catalogue variants and adjusted BV for Dragon/Wolverine 4/5 versus Puma Prime 3/4; save a reproducible fixture with mines disabled. Do not assume the remembered 3,500 BV is correct.
3. **Next — full live lifecycle.** Ammo-bin confirmations, initiative ties, uneven activation allowances, standing/facing, destroyed weapons, physical attacks, heat, victory and initiative totals in the report. Refresh midway through an AI turn; prove resume cannot duplicate an action. Keep failed game codes and structured traces.
4. **Next — terrain coverage.** Repeat with water and hills, then single, wide and deep maps; validate legal movement, no stalls and usable paths. Include both human/AI force orientations.
5. **Next — clear feedback.** Thinking/acting/finished states, callsigns, pending actions and concise expandable decision explanations, including rejection/retry feedback.
6. **Then — tactics and release soak.** Turn every reproduced defect into a regression. Run complete live matches on each release, record stalls/illegal actions and tune strategy only after reliability gates pass. Local planner tests alone do not count as live-match acceptance.

SQL deployment and live acceptance must be reported separately from local implementation/testing.

### AI polish validation — 2026-09-11, build 115

- Critical Damage track is compact and placed below the Centre Torso, with desktop/mobile layout checks.
- AI force picker searches chassis/variant and shows default adjusted BV plus live per-unit adjusted BV while skills are edited.
- Deployment maps consume middle-click autoscroll and support middle/right-button drag panning.
- Live weapon acceptance passed: complete mount package, server dice, exact ammo use, heat once, phase hand-off.
- Live specialist acceptance passed on hosted build 113: difficulty/personality persistence, Reaction, physical resolution and completed decision records. Replaced an obsolete build-name whitelist with capability checks. Disposable fixtures were removed.
- Live setup acceptance for tools/fixtures/ai-clan-vs-is.json passed with the installed catalogue: DRG-5N + WVR-7K at 4/5 = 2554 BV; Puma Prime at 3/4 = 2750 BV. The 196 BV difference is intentional, not claimed equal. DRG-5K substitution gives 2689 BV (61 difference). Saved pilots, adjusted values and no-mines state survive start. Fixture removed after verification.
- These are focused live checks, not a complete played match. Full lifecycle, recovery after refresh and all-map endurance remain pending.

### Auto-next phase repair — 2026-09-11, build 116

- Auto-next observes completed steps throughout a Vs AI match, including resolved initiative and server hand-offs, rather than only the immediate AI completion callback. Required player choices and physical skip confirmations remain manual.
- Empty AI plans report successful completion; stale callbacks, duplicate advances and repeated failed requests are guarded.
- Focused scheduler regressions passed. Live-server acceptance advanced resolved initiative into Movement without a Next Phase click and preserved unconfirmed human movement. Disposable match BT-T53K removed. No SQL migration. Full-match lifecycle acceptance remains pending.
