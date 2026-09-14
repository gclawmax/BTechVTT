# BTechVTT — MW5 Co-op Company Drop Proposal

Status: **proposal / design only** (not implemented)  
Date: **2026-09-14**  
Implementation order: governed by [`DEVELOPMENT_ROADMAP.md`](DEVELOPMENT_ROADMAP.md)

This document captures a MechWarrior 5: Mercenaries–inspired co-op direction for
BTechVTT: same-team multiplayer drops on large maps, sensor-limited awareness,
mission objectives, and the existing repair / salvage / customisation fantasy
extended into a shared company. It is a design note, not a shipping commitment.

Related documents:

- [`DEVELOPMENT_ROADMAP.md`](DEVELOPMENT_ROADMAP.md) — priority and next steps
- [`PERSISTENT_CAMPAIGN_DESIGN.md`](PERSISTENT_CAMPAIGN_DESIGN.md) — Career model
- [`AI_OPPONENT_ROADMAP.md`](AI_OPPONENT_ROADMAP.md) — Play vs AI slices
- [`REFERENCE_MAPS.md`](REFERENCE_MAPS.md) — dual sheets and map families
- [`GAME_MODES_ROADMAP.md`](GAME_MODES_ROADMAP.md) — Control / Breakthrough / modes

---

## Vision

The most fun MW5 loop is not a 1v1 duel. It is a lance on one radio net, walking
a large map, only seeing what sensors and line of sight allow, chewing through
lighter opposition, completing objectives, then going home to repair, salvage,
and kit the force.

BTechVTT today is a **two-seat BattleMech duel engine** with a **single-player
Career** bolted on. The MW5 loop is a new *mode* on that engine, not a settings
toggle.

**Product name (working):** Company Drop.

---

## Current baseline (grounded)

| Area | Today |
|---|---|
| Career | Single-player vs AI. One company per user. Launch = human seat 1 + AI seat 2. Contracts, credits, hangar, repair/reload, salvage (claim one wreck), market, travel, factions, and founding arcs exist. Lance is auto “first ≤4 operational mechs” — no explicit pick list. MechLab customisation is **not** wired to the Career hangar. |
| Teams | Schema allows seats 1–4; lobby and rules use **1 vs 2** only. Two humans cannot share a side. Unit ownership is `mech.owner === seat_number`. |
| Maps | Default 16×17; up to 48×48; dual sheets 32×17 / 16×34. Annihilation, Control, and Breakthrough exist. |
| Sensors | Hidden units, Active Probe, ECM, signature modes, authoritative LOS. **No hex fog of war** — terrain is fully visible. |
| Units | Biped BattleMechs only. Vehicles, VTOLs, and infantry are out of the BattleMech core; MegaMek non-mech data is unused. |
| Career-4b | Roadmap item for **two-company PvP tenders** — not co-op. Keep that distinction. |

---

## Proposed product: Company Drop

**Fantasy:** 2–4 players join **one company**. They pick a contract, assign who
pilots what from a **shared hangar**, and drop on the **same team**. Opposition
is AI (many lights). The map is large enough to travel. You only see enemies
your lance can detect. Complete the objective, settle once, then the usual HQ
loop.

### 1. Same-team multiplayer

Introduce a real **team** / `force_id`, not “seat number = side.”

- Seats 1–4 are humans (or empty) on **Team A**.
- Team B is AI (one logical opponent, many units).
- Each human is assigned one or more `mech_instances` from the company hangar
  (or, in Coop Skirmish, from the skirmish roster).
- Activation stays Total Warfare **alternating activations**, but “whose turn”
  is **unit owner**, not the entire seat-1 roster. When it is *your* mech, you
  move/fire it. Allies watch and share the sensor picture.

Simultaneous real-time (true MW5) would fight the existing phase/RPC stack —
do not start there.

**Lobby:** company commander hosts; others join via invite / membership, not as
the enemy seat.

### 2. Large maps

Prefer **stitched / dual reference maps** over an empty 48×48 grid for the first
feel of “crossing a valley.” Cap v1 at dual-sheet sizes plus Control /
Breakthrough so co-op maps feel large without a new map engine.

Deployment needs one **friendly zone** and one or more **enemy / objective
zones**, not only classic W/E strips.

### 3. Sensors and fog of war

Do not hide terrain first. Hide **enemy tokens**.

**v1 — Lance sensor picture (shared FoW on units):**

- Allies share one visibility set: an enemy is shown if **any** friendly unit
  has LOS **and** is within sensor range (base visual range + probe bonuses;
  ECM can punch holes).
- Hidden-unit and minefield `revealed_to` patterns already point at
  per-viewer / per-team concealment — use **per-team** for the lance so intel
  is not splintered.

**v2 — Hex fog of war:** unexplored hexes dark until a friendly unit has LOS.
Nice, expensive, optional if token FoW is enough.

Signature modes (void / chameleon) become more meaningful once enemies are not
painted on the map by default.

### 4. Missions

Reuse `victory_mode` and grow contract `terms`:

| Mission feel | Maps to |
|---|---|
| Search and destroy | Annihilation, with light pickets / swarms |
| Capture / hold | Control |
| Breakthrough / extract | Breakthrough |
| Raid / destroy site | New: target hexes / building CF (later) |
| Defend | Control, starting on objectives |

Career contracts already carry map, BV band, factions, and pay. Add
`mission_kind`, recommended sheet, and enemy composition templates (lights,
not a second assault company).

---

## Persistent Career — required changes

Today every HQ RPC is `company.user_id = auth.uid()`, one accepted contract, and
seat1+AI only.

### Must-have for career co-op

1. **Memberships** — company members (commander / mechwarrior); RLS and RPCs
   check membership, not only owner.
2. **Shared hangar + explicit drop list** — stop auto first-4 by `acquired_at`.
   Commander (or members with commander veto) picks who drops; BV is the
   **selected** force.
3. **Launch** — 2–4 human seats on Team A + AI Team B;
   `career_context.persistent_units` records every dropped mech/pilot and who
   pilots it.
4. **Settlement** — still **one company receipt** (one ledger, one salvage
   offer). Host may be any member; settle stays idempotent on `game_id`.
5. **Idle locks** — active contract means the company has a live match; repair /
   market / travel blocked for everyone until settle.
6. **Permissions** — who spends credits, claims salvage, travels, renames. Pick
   one clear rule (e.g. commander-only spend) and stick to it.

### Should-have (same loop, more MW5)

7. **Career refit** — wire MechLab to owned mechs.
8. **Parts / selective repair** — optional later; today repair restores to
   catalogue fresh condition.

### Explicitly not this proposal

**Career-4b** (two-company PvP tenders) remains a different product slice. Ship
**shared-company vs AI** first.

Ledger, settlement idempotency, salvage-one-wreck, market cycles, worlds,
faction standings, and arcs can stay if the **company** is the actor and humans
are members.

---

## Vehicles, VTOLs, and infantry

This is a **new rules/data line**, not a catalogue checkbox. Combat, movement,
crits, heat, physicals, Career hangar, and AI assume **8-location biped
BattleMechs**. Import pipelines read biped `.mtf` only.

| Scope | Extra work | Notes |
|---|---|---|
| AI opponents only (one family, e.g. combat vehicles) | Large | New hit/motive tables, movement modes, AI, sprites, `unit_type`, parsers. Cannot fake a tank as an 8-loc ’Mech. |
| Player-piloted allies | Larger | Record sheets, movement UI, lobby filters, LOS/cover differences. |
| Career salvage / customisation for them | Very large | Hangar and MechLab are mech-shaped; needs polymorphic owned units. |

For the MW5 fantasy, **AI lights can remain BattleMechs** for Coop Skirmish and
early Company Drop. Vehicles as cannon-fodder opponents are the first non-mech
slice *if* pursued later — not on the critical path for co-op + FoW + career
memberships. Infantry and VTOLs are additional families (stacking, elevation);
do not bundle them with the first vehicle pass.

---

## Suggested build order

1. **Coop Skirmish** (roadmap next programme) — two humans, one side, shared
   sensor picture, existing maps/objectives, **no Career**.
2. Career memberships + explicit lance + shared settle.
3. Mission templates + larger dual-sheet contracts.
4. Career refit.
5. Hex FoW only if token FoW is not enough.
6. Vehicles as AI opponents — only after the above feels good.

Host-side debug tooling (field patches / force phase) remains relevant: co-op on
large maps will create more stuck-state moments, not fewer. Prefer fixing
phase-skip bugs alongside any debug escape hatches.

---

## Honest cost

| Slice | Rough size | Value |
|---|---|---|
| Coop Skirmish (team model + unit FoW + same-side lobby) | Real feature arc | Produces the MW5 drop feel without touching Career RLS |
| Career memberships + shared settle | Real feature arc on top | Persistent co-op loop |
| Full hex FoW + mega-maps + career refit | Another arc | Polish / depth |
| Vehicles + VTOLs + infantry (opponents *and* allies + career) | Larger than the co-op Career project | Sequel ruleset |

Treat Company Drop as a **narrow product path**: prove same-side play first,
then hang the Career loop on it, and keep non-BattleMech families as a
deliberate later programme.

---

## Coop Skirmish acceptance (phase 1)

See also the roadmap section **Next development programme — Coop Skirmish**.

Minimum:

1. Two human accounts on the same force; AI on the opposing force.
2. Unit-level control assignment and activation.
3. Shared lance visibility of enemy tokens via LOS + sensor range.
4. Playable with existing victory modes on dual-sheet / large maps.
5. No Career side effects (skirmish isolation preserved).

Out of scope for phase 1: company memberships, salvage/repair from the drop,
hex FoW, vehicles/VTOLs/infantry, and Career-4b PvP.
