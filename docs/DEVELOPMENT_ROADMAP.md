# BTechVTT — Development Roadmap

Status: **authoritative roadmap**  
Last updated: **2026-09-21**

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

### Open defect — client/server hex-convention mismatch (found 2026-09-24, Step 0 acceptance)

The client converts hex coordinates with the **odd-r** offset convention
(`offsetToAxial`, `js/game/board.js:101`; `hexToPixel`,
`js/movement/rules.js:82`), while the server's authoritative distance
function `btech_hex_distance` (`SQL/15_authoritative_direct_fire.sql:50`)
uses **even-r**. The two disagree on every odd-row→even-row neighbour
pair: (7,4)→(8,5) is client=1 / server=2, and (1,0)→(0,1) is
client=2 / server=1. Consequences: the rendered board, client-side
adjacency/range checks (physical attacks, facing arcs, movement
planning) and the server authority can disagree, and the server
rejection "Physical attacks require an adjacent target" has been
observed live (games BT-YVY8, BT-BKC6 stalled in the physical phase).
The acceptance harness now uses the server's even-r math as the
adjacency authority so testing proceeds. Fix requires choosing one
convention and migrating the other side (server is the authority; the
less invasive migration is fixing the client's `offsetToAxial` /
`hexToPixel` / `pixelToHex` and every consumer — pending sign-off, then
regression: rendered board, facing arcs, movement paths, physical
adjacency, weapon range and all distance-based checks).

### Fixed — prone (or otherwise ineligible) attacker cannot pass in the physical phase (found 2026-09-24, Step 0 acceptance; fixed 2026-09-25, migration 157)

`btech_process_physical_declaration` (installed by SQL 60, lines
238–245 — the SQL 23 definition is superseded) checked the eligibility
gate — destroyed, **prone**, shutdown, unconscious — *before* the
`pass` branch. A prone 'Mech therefore cannot punch/kick/push **and**
cannot pass. The client's own auto-pass
(`autoPassIneligiblePhysicalAttackers`, `js/game/phases.js:881`)
submits exactly that pass on every load and is rejected. Verified live
twice (games BT-L5ED round 2, BT-DY4P round 4): with the only
remaining declarer of the active seat ineligible,
`skip_empty_physical_phase` correctly refuses (the opposing side's
living 'Mechs still have legal options) and the phase wedges until the
deadline — a hard deadlock with no UI escape hatch.

Fixed by `SQL/157_prone_physical_pass.sql`: the pass branch now runs
before the attack-eligibility gate, so any living (non-destroyed)
'Mech may declare "no physical attack"; the destroyed/prone/shutdown/
unconscious rejection is retained for actual attacks. The migration
re-installs the complete resolver body from SQL 60 (arm physical
weapons, heat, fumbles) so nothing else changes;
`btech_has_remaining_physical_option` (SQL 106) already returns false
for ineligible attackers, so the recovery predicate stays consistent.
Companion client fix in `js/game/physical-attack.js`:
`selectPhysicalAttacker` no longer requires a legal target (destroyed
'Mechs are excluded), the declaration panel lists every living,
undeclared 'Mech of the active seat, and a 'Mech with no legal attack
sees a pass-only panel with the existing
"No Physical Attack / Complete" button.

Applied and verified live (2026-09-25, Battle A re-run BT-PNHF): with
migration 157 on Supabase, the physical phase no longer rejects passes —
the run went clean through 12 rounds to an annihilation (guest Timber
Wolf vs host Grand Dragon + Victor, winner seat 2), the mid-battle
reconnect passed, and the sealed report was produced. This confirms 157
closes the deadlock.

### Harness fix — Step 0 finish detection watched the wrong column (found + fixed 2026-09-25)

After 157 unblocked the battle, the acceptance harness still reported a
false "stalled after 12 rounds." Root cause: `finishedRow()` (and its
callers `drivePhase`/`waitFinished`/the final probe) waited for
`btech_games.status === 'finished'`. A **natural** victory resolves via
`resolve_btech_match_end` (SQL 33), which writes `state.match_result` and
sets `current_phase='end'` + `active_player_id=NULL` but never flips
`status` — that column is only set to `'finished'` on the Career
settlement path (SQL 135). A plain skirmish annihilation therefore leaves
`status='in-progress'` forever. The harness now keys off `state.match_result`
(the authoritative terminal signal, mirroring SQL 33's own
`match_result IS NOT NULL` check) and treats `status='finished'` as a
secondary marker for Career matches. Report rows for the match are
verified in-run by querying `btech_match_reports` **as the authenticated
participant** (RLS: *"Participants can view match reports"*,
`user_id=auth.uid()`); probing that table with the raw anon key returns 0
rows by design and is not a defect.

### Observation (non-blocking) — `btech_games.status` stays `in-progress` after a natural skirmish win

Same root as the harness fix above, but worth noting for tooling: a
decided natural skirmish leaves `btech_games.status='in-progress'`
(only `state.match_result` marks it decided; `status` is flipped by
Career settlement only). Players are unaffected — clients and rejoiners
read `match_result` — but any list/analytics keyed on `status` would show
a won skirmish as still running. Deliberately **not** changed under Step 0
(zero game-code changes); revisit if a games list or analytics surface
needs it.

### Fixed — AI club search deadlocks the Weapon Attack phase (found 2026-09-25, Step 0 Battle B v11; fixed by migrations 158 + 159, pending apply)

In a vs-AI annihilation run (game BT-M6YC, round 10), the AI planned its
legal `find_club` action in its Weapon Attack slot (`js/ai/engine.js`
`AI_ACTIONS_BY_PHASE.weapon_attack` includes `'find_club'`; designed so the
club search consumes the weapon declaration). The live
`find_improvised_club` rejected it with
*“It is not your Weapon Attack activation”* — the SQL 88 human-only actor
check — and the shipped AI latch then paused the whole activation (*“AI
activation paused after a failed action”*), so the AI never fired and the
phase could never close: a hard deadlock for the human opponent.

Root cause: SQL 126's actor-authorization loop is not wrapped in an
explicit transaction, so a substitution failure aborts the remaining
statements while earlier `EXECUTE`d functions stay installed. Live evidence
shows the weapon package (SQL 124) and the first SQL 126 functions patched
(AI weapons and physical attacks succeed) while `find_improvised_club`
carries no `ai5_authoritative_phase_actor_v1` marker at all — the partial
application left the club function (and, likely, everything after it in the
loop plus the `submit_ai_phase_state` contract extension) unpatched.

`SQL/158_ai_club_search_authority.sql` reinstalls `find_improvised_club`
from the SQL 88 body with the exact actor line SQL 126 was supposed to
install (`btech_authorized_ai_phase_player`, AI-5 marker) and audits it.
Nothing else in the club roll or the nested
`submit_multi_target_weapon_declaration('[]')` consumption changes.
`SQL/159_ai_authority_convergence.sql` re-applies the rest of SQL 126's
scope idempotently (the other six patched functions plus the
`ai5_action_contract_v1` decision-contract extension) and audits that all
markers are present; if any live definition has drifted from the expected
pre-patch text it raises naming that function so the drift is resolved
deliberately.

**Applied and verified (2026-09-25, Battle B v12, game BT-4KYR):** 158
then 159 applied by Matt (one 159 audit-block scoping typo fixed in
`c12f88e`); both final audits passed live. v12 ran clean end-to-end —
23/23 checks, annihilation at round 9 (winner seat 2), sealed report row
present, mid-AI-turn reload rejoin with zero duplicated combat events, no
`weapon_attack` stall and no “not your Weapon Attack activation”
rejection anywhere in the log. Honest scope note: the AI never planned a
club search in this particular match (no club events in the log; the
battle ended at round 9, before v11's round-10 wedge point), so the
fix is verified at the function level (audits confirm the
AI-authoritative actor and the extended decision contract are live) and
by the deadlock no longer reproducing — not by an observed live
`find_club` execution. `find_club` terrain eligibility is data-dependent
(woods/rubble hex), so a future run may or may not exercise it.

**Observation (non-blocking) — transient AI pause latches:** v12's log
shows a few “AI activation paused after a failed action” BT-LOG entries
(R1/R2 movement and physical races, R3/R7 heat) that self-cleared on the
next state change without stalling any phase. The latch is behaving as
designed (fail-safe, release-on-state-change); the underlying rejections
(e.g. “A weapon fired from la this round”) are normal legal-rule
enforcement during recovery replays.

## Design decisions — recorded 2026-09-25

Decided with Matt while scoping the polished-skirmish acceptance and the
Coop Skirmish programme. These govern the implementation of the relevant
slices.

1. **Skirmish tonnage cap is a soft cap with explicit confirmation.** The
   host sets a tonnage cap for the skirmish and the team's selections are
   expected to fit under it, but an over-tonnage deployment is permitted
   after an explicit confirmation prompt at setup ("You are over tonnage, do
   you wish to continue anyway?"). The confirmed overage is recorded in the
   match state and surfaced in the sealed match report (After Action).
   This mirrors MW5 over-tonnage drops; persistent-campaign contract drops
   may later apply a cost/penalty, but skirmish stays confirmation +
   record only. Implementation replaces the current hard rejection in
   `update_skirmish_hangar` (SQL 132) when that code path is next touched —
   not a standalone migration ahead of the skirmish milestone.
2. **Spectator seats and mid-match ownership transfer.** A player may
   deploy zero chassis and remain in the match as a spectator — present,
   able to follow the game, with no activations. The host can transfer
   control of a deployed mech to another seated player mid-match, so a
   player can step out and hand their Mech over. A player who deployed
   multiple chassis keeps the activations of any that survive, staying
   involved after some of their Mechs are destroyed. Transfer of custom
   designs and pilot progression (XP) is deliberately deferred to a later
   patch — the intended context is persistent-resource duels such as
   salvage rights, where those rules need to exist first.
3. **Coop Skirmish slicing.** Two humans on the same team ships as slice
   **1-a**; up-to-four humans remains slice **1-b**, scheduled after 1-a
   acceptance.
4. **Team assignment is data, not seat arithmetic.** Which side a seat
   belongs to is written in the match record at match creation (e.g.
   `team_assignments = { teamA: [seats...], teamB: [AI] }` in match state)
   and read by a single seat-team helper used everywhere sides are
   compared — never inline seat arithmetic. Today's modes (two friendly
   seats, AI on the opposing force) are simply the default creation
   payload; different shapes (1v3, three humans vs AI, a future 2v2 PvP)
   are different creation data with no changes to game logic, RLS,
   reports, or the AI stack. A full `force_id` schema migration stays
   deferred to Company Drop scope.
5. **Lobby loadout permission model — no in-game draft.** Each friendly
   seat builds its own loadout from the catalogue; there is no shared
   finite pool and no in-game draft board (any drafting happens
   out-of-game at the host's table), and nothing restricts two players
   from selecting the same chassis. The lobby dropdown is a *permission*
   model, not a draft mechanic:
   - **A — Host assigns:** only the host may edit any seat's loadout.
   - **B — Pick own:** a player may edit only their own seat.
   - **C — Pick any:** any player may edit any seat, until that seat is
     Readied.
   Ready locks a seat's loadout from everyone, including the host, until
   it is Unready; the host may force a seat Ready or Unready. Edit
   permissions and the ready lock are enforced server-side, not only in
   the UI.
6. **Pilot-identity stamp in the sealed report.** Every sealed match
   report records the operating identity per seat (`user_id` → seat →
   unit), from day one, record only — no settlement, XP, or persistence
   of any kind. This keeps the future persistent MechWarrior / XP design
   viable: per-unit attribution to a real person plus a stable identity
   to hang future development on. An "open-cockpit / no-owner"
   deployment model is explicitly ruled out, as it would silently
   destroy that option.
7. **AI force shape — host-picked preset or Custom.** At match
   creation the host selects the AI force in the lobby, alongside the
   tonnage cap: one of three auto-composed presets, or **Custom**.
   - **Presets auto-compose the roster from a BV budget:** target AI
     total BV is a ratio of the friendly team's total BV (starting
     points ~1.0 / 1.1 / 1.3 — to be tested and adjusted with live
     matches), filled with light-class chassis; unit count emerges
     from the budget, capped in 1-a.
   - **Composition caps:** Light — lights only; Standard — at most two
     mediums; Heavy — a heavy mech is permitted. Rationale: a friendly
     lance of two assault 'Mechs needs a credible challenge. Caps are
     starting points and may be tweaked later.
   - **Custom** — the host hand-picks the specific AI line-up from the
     catalogue, bypassing the budget and caps entirely.
   - Roster selection is seeded (seed derived from the match ID) and
     materialised at creation as ordinary units owned by the AI seat —
     the same mechanism as Vs-AI; no new runtime mechanics. The sealed
     After Action report lists the exact AI chassis and loadouts.
   - 1-b scaling is automatic via the BV ratio (bigger friendly team,
     bigger AI force); Custom scales by host choice. No per-seat
     sizing knobs.
   - Prerequisite: the catalogue gains a small batch of light-class
     chassis (static data) so auto-composition has variety.
   - No AI behaviour changes in 1-a: the existing AI stack fights the
     wave; pack/formation tactics are later behaviour-layer polish.

## Next development programme — Coop Skirmish

After the polished human skirmish / Vs AI reliability milestone is accepted,
the next product step is **Coop Skirmish**: two (later up to four) humans on
the **same team**, dropping against AI on existing large/dual-sheet maps, with
a shared lance **sensor picture** on enemy tokens (LOS + sensor range; not full
hex fog of war yet). No Career persistence in this phase — prove same-side
seats, unit-level activation ownership, and shared visibility first.
Slicing: **1-a** ships two humans on the same team; **1-b** (up to four
humans) follows after 1-a acceptance (see Design decisions 2026-09-25).

Design and later Company Drop / career co-op scope:
[MW5 Co-op Company Drop Proposal](MW5_COOP_COMPANY_DROP_PROPOSAL.md).

Acceptance sketch (refine in the design doc as implementation starts):

1. Two human accounts join one match on the same force; AI occupies the opposing force.
2. Each human is assigned one or more BattleMechs; activation is by unit owner.
3. Enemies are shown only when any allied unit has LOS within sensor range
   (probe / ECM interactions reuse existing rules).
4. Existing Annihilation / Control / Breakthrough scenarios remain playable.
5. Skirmish isolation is preserved: no Career credits, damage, or salvage.

Career memberships, shared hangar drops, and non-BattleMech unit families are
**out of scope** for Coop Skirmish; they follow in later Company Drop slices.


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
2. **Company Drop (career co-op):** after Coop Skirmish, shared-company
   memberships, explicit drop lists, and single-company settlement for
   multi-human Career contracts. Distinct from Career-4b. See
   [MW5 Co-op Company Drop Proposal](MW5_COOP_COMPANY_DROP_PROPOSAL.md).
3. **Career-4b:** optional PvP tenders with explicit two-company consent,
   withdrawal rules and idempotent dual settlement. Mechanics to carry into
   the slice (tender lifecycle, committed-force escrow, stakes, opt-in
   Mech-forfeit flag) are recorded in `docs/PERSISTENT_CAMPAIGN_DESIGN.md`.
4. **Non-BattleMech opponents/allies:** vehicles, VTOLs and infantry are a
   separate rules/data programme, not required for Coop Skirmish. See the
   Company Drop proposal for effort ordering.
5. **Level 2 catalogue additions:** curated, catalogue-led systems not already
   covered by the specialist-rules programme below. Each remains gated by an
   authoritative resolver and a representative live battle.
6. **Operations:** scheduled retention cleanup verification, deployment
   observability/backups, and production monitoring.
7. **Presentation:** accessibility, mobile, map/editor and audio polish driven
   by player feedback.
8. **Career backlog (post-Career-4b):** career transitions (desertion,
   exile, honourable discharge, high-reputation recruitment — origins are
   currently immutable), Clan progression flavour (Bloodnames, patrons, PvP
   Trial of Possession), and terrain-seeded map selection with
   industrial-level repair/supply gating. All deferred concepts are
   consolidated in `docs/PERSISTENT_CAMPAIGN_DESIGN.md`; the original local
   `CAREER_MODE_DESIGN.md` proposal has been retired and removed.

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
- `docs/MW5_COOP_COMPANY_DROP_PROPOSAL.md` — MW5-style co-op / Company Drop design; Coop Skirmish is the first implementation slice.
- `docs/PERSISTENT_CAMPAIGN_DESIGN.md` — authoritative Career persistence design.
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

### Empty Vs AI Physical Attack recovery — build 117

- Apply the existing authoritative empty-physical-phase recovery when loading Vs AI matches, including already stuck games. Server legality checks and pending declaration resolution remain intact.
- Live disposable match BT-HNDK recovered an empty Physical Attack phase into Heat with Auto-next disabled; human heat confirmation remained pending. Fixture removed. No migration required.

### Gauss ammunition and shared Vs AI combat — build 119 / SQL 153–154

Plan and implementation:
1. Remove the human Vs AI local firing path (which omitted ammunition deduction), and route weapon declarations through the same server resolver as skirmishes and AI weapons.
2. Use individual Gauss mounts for once-only explosions; use the shared ammunition-explosion damage path for internal transfer, CASE and pilot injury. Struck Gauss ammunition bins lose their shots without exploding. SQL 153 is a new migration; older migrations remain unchanged.
3. Route human Vs AI movement, standing/facing and physical declarations through the existing server rules so heat and critical damage do not diverge by mode. Route AI and human heat through the same heat ledger and checks, with AI shutdown overrides and decision audit completion. Include engine and terrain heat in the AI firing budget.
4. Show the signed-in profile name in the skirmish hangar and new AI setup. Replace native scaled SVG focus outlines with hex strokes; reproduced the reported blue/white circle on neutral deployment hexes.
5. Validate real-server Gauss firing in both browser modes and by the AI, selected-bin deduction, one heat, duplicate rejection, movement and physical declaration persistence. Validate new explosion/heat SQL locally; verify installed SQL separately after application.

Focused checks passed: live Gauss ammo 8 to 7 and weapon heat +1 across all three firing routes; human Vs AI movement and physical server resolution; local PostgreSQL per-mount explosions, CASE/transfer, pilot hits, inert/empty ammo bins, heat ledger, cooling-before-shutdown and actor guards. Browser focus regression covers friendly, enemy and neutral hexes. Complete-match endurance and refresh recovery remain separate pending acceptance work. Historical ammo missed by the old local path is not silently guessed or retroactively deducted.

Follow-up SQL 154 adds CASE protection at each reached location, covering an arm explosion transferring into a protected torso. SQL 153 remains unchanged after its initial handoff. Both migrations pass repeat-application checks. The original blue/white focus artifact was reproduced in Chromium with the native SVG focus outline enabled and disappears with the corrected hex focus style. Live AI weapon-package regression also passed (BT-ZZXP, removed).

Live acceptance on 2026-09-11: Gauss shots and heat passed for human skirmish mode, human Vs AI and AI firing; shared human/AI heat ignored a stale aggregate of 999, cooled the correct ledger of 8 once, finalized the AI audit and advanced to the next round. All disposable matches were removed. Pure JSON live probes confirmed the 153 Gauss explosion (20 internal damage, two pilot hits). The 154 transferred-CASE probe reproduced the outstanding live defect (0 vented, 12 damage reached CT); 154 is tested locally and awaits application. No match state was written by these probes.

SQL 154 live verification completed after user application: the hosted build 119 probe confirmed a Gauss explosion causes 20 internal damage and two pilot hits; an arm explosion transferred into DRG-5N torso CASE vented the remaining 12 damage and left the centre torso unchanged. These were pure JSON resolver calls; no match state was modified. The 153–154 database deployment gate is complete.


### Round 1 ammunition recovery — build 121

Reported lock: BT-NC5W. SQL 98 replaced Initiative without retaining SQL 71’s ammunition gate. SQL 155 restores the gate for both forces and lets a seated player confirm exactly one pending bin in Round 1 Initiative, clearing premature rolls atomically so setup can finish. Already confirmed bins cannot be overwritten; later phases cannot use this recovery. Human Vs AI confirmation now uses the same server function as skirmish. Each UI bin shows its identifier and pending/confirmed state; duplicate saves are disabled.

Validation: PostgreSQL tests cover independent bins, null load types, ownership, duplicate rejection, both-side readiness, premature-roll recovery, later-phase rejection and repeat migration application. Browser tests exercise the real controls in human and Vs AI modes. SQL 155 still requires user application; BT-NC5W recovery has not been verified live.
