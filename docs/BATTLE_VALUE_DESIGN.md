# Battle Value Design

Status: **BV-1 complete; BV-2/BV-3 ready for SQL deployment.** No existing match
becomes a BV match automatically: tonnage remains the default format.

## Purpose

Battle Value provides a second, optional way to balance forces. It does not
replace tonnage: existing skirmishes, scenarios and Career prototypes remain
tonnage-limited unless a creator explicitly selects a BV format.

The playable standard is **BV2** (the modern revised Battle Value system,
usually shown simply as “BV”).

## Product decisions

- The initial supported rule is **BV2.1 stock value at Gunnery 4 / Piloting
  5**, with a separately displayed adjusted value for the assigned pilot.
- MegaMek is the calculation/reference tool used by the catalogue importer.
  A pinned catalogue release stores the result it imported; a browser must
  never calculate a different value for the same pinned design.
- A match records its BV rules version, source catalogue version, limit,
  stock values and pilot-adjusted values at the time the roster is readied.
  Later catalogue imports cannot alter an existing match or replay.
- BV checks are server-authoritative. The browser can show totals and prevent
  obvious mistakes, but it cannot make an over-limit force legal.
- Pilot skill changes alter **adjusted BV**, using a versioned table/calculator
  validated against a MegaMek fixture export. Damage during a battle never
  changes that match’s declared BV.
- Custom BattleMech designs stay tonnage-only until the MechLab can produce a
  validated BV2 breakdown. They are labelled **BV pending**, not assigned an
  invented approximation.

## Data model

Each imported catalogue unit receives a compact, versioned value object:

```json
{
  "bv": {
    "version": "BV2.1",
    "stock": 1397,
    "reference_pilot": { "gunnery": 4, "piloting": 5 },
    "source": "megamek-import",
    "source_release": "<pinned MegaMek data release>",
    "verified_at": "<ISO timestamp>"
  }
}
```

The actual match state stores a sealed force-format snapshot:

```json
{
  "force_limit": { "mode": "bv2", "limit": 5000, "bv_version": "BV2.1" },
  "force_values": {
    "1": { "stock": 4820, "adjusted": 5106, "entries": [] },
    "2": { "stock": 4874, "adjusted": 5064, "entries": [] }
  }
}
```

An entry records unit ID, catalogue version, imported stock BV, pilot skills,
adjusted BV and the calculator/table revision. It is an audit record, not a
new authority separate from the pinned catalogue.

## Match formats

| Format | Default | Limit check | Availability |
|---|---:|---|---|
| Tonnage | Yes | Existing tons per player | All supported units/designs |
| BV2 | Opt-in | Sum of pilot-adjusted BV | Catalogue units with verified BV2 |

Initial BV presets should be 2,500, 5,000, 7,500 and 10,000 BV. Scenario
authors may choose a custom whole-number cap. “Comparable AI force” means the
AI is generated at or under the same cap, with a configurable small unused-BV
tolerance published in the match state.

## Delivery slices

### BV-1 — catalogue provenance and validation

**Complete.** The `megamek-2026-09-bv2-01` pinned catalogue release carries
verified MegaMek BV2 stock values for all reviewed supported BattleMechs.

1. Extend the MegaMek import pipeline to capture stock BV2 and source-release
   provenance for every supported catalogue unit.
2. Backfill a new catalogue release; do not mutate old pinned releases.
3. Produce a machine-readable fixture export covering light, medium, heavy,
   assault, Clan, Inner Sphere and Dragon acceptance variants.
4. Mark designs missing a verified value as `BV pending`, with an import report
   rather than a guessed number.

**Acceptance:** a server query and browser catalogue read the same stock BV
for every verified fixture; no legacy match changes after the backfill.

### BV-2 — shared calculator and authoritative roster checks

**Ready for deployment.** SQL 132 supplies the published pilot-skill factors,
sealed per-entry BV records, server-side cap checks, and Hangar preflight
display. BV2 creation controls remain BV-3 work.

1. Add a versioned Gunnery/Piloting adjustment implementation with fixtures
   checked against MegaMek for the supported skill range.
2. Add server helpers that resolve a pinned unit plus pilot to one detailed
   BV record and total a roster.
3. Extend the Hangar-ready RPC and lobby readiness validation to enforce
   `tonnage` or `bv2` according to the sealed match format.
4. Show stock BV, adjusted BV, total and remaining budget in the Hangar.

**Acceptance:** an over-cap roster is rejected by the server even if browser
state is changed; an equivalent tonnage match behaves exactly as it does now;
rejoin and exported reports preserve the original BV declaration.

### BV-3 — match creation, scenarios and Vs AI

**Ready for deployment.** Create Match, Play vs AI, and the scenario editor
offer Tonnage or BV2; BV2 provides 2,500 / 5,000 / 7,500 / 10,000 presets and
a bounded custom whole-number cap. AI selection is seed-deterministic and the
server seals both sides' final values before play begins.

1. Add a “Force format” choice to Create Match, Play vs AI and the scenario
   editor. Tonnage remains preselected for backward-compatible play.
2. Add the BV presets and validate custom caps.
3. Make deterministic AI force generation target the sealed BV cap and save
   its selected unit values, tolerance and seed.
4. Present BV on lobby setup, roster cards, AARs and replay metadata.

**Acceptance:** seeded AI generation is repeatable, legal and comparable;
all objective modes work under both formats; a BV match cannot contain an
unrated custom design.

### BV-4 — Career integration

**Implementation status: implemented in SQL 140 and build
`20260908-career-bv4-94`.**

Career contracts may advertise a BV band after Career-1 settlement exists.
Contract eligibility uses the owned unit’s pinned **stock configuration plus
current pilot skills**, not battle damage. This avoids making unrepaired damage
an exploitable way to obtain an easier contract. Repair and salvage economics
remain independent of BV.

**Acceptance:** changing a persistent pilot’s skills changes the displayed
contract force value; battle damage does not rewrite the signed contract value;
settlement/rejoin remains idempotent.

Company HQ now shows the pilot-adjusted value of the assigned operational
lance and the BV2.1 band on every offer. The launch RPC recalculates eligibility
from the pinned catalogue, seals both the value and band into `career_context`,
and never reads current armour, structure, critical damage, or ammunition.

### BV-5 — custom design BV2 (deferred)

Add a server-side BV2 breakdown calculator only after MechLab construction and
equipment data are complete enough to validate it against MegaMek. It must
return a readable defensive/offensive breakdown, not an opaque total. Until
then custom designs continue to work in tonnage games only.

## Regression matrix

- Imported stock BV fixtures: representative Inner Sphere/Clan units plus all
  Dragon acceptance variants.
- Skill-adjustment fixtures: each supported Gunnery/Piloting boundary and
  several mixed-skill pairs.
- Roster enforcement: exact cap, one point over, unverified unit, stale client
  total and changed pilot skills.
- Game modes: human-vs-human and Vs AI, all three victory conditions, rejoin,
  export/import replay and AAR sealing.
- Compatibility: old tonnage games and pre-BV catalogue releases remain
  readable and do not gain a false BV value.

## Explicit non-goals

- Using Alpha Strike Point Value as a substitute for BV.
- Estimating BV from tonnage, damage, or AI performance.
- Altering BV after damage, ammunition expenditure, or a battle result.
