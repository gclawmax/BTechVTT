# Persistent Campaign Design

Status: **Career-4a complete — Career-4b PvP tenders under review**

This is the authoritative design for persistent play. It supersedes the
older local `CAREER_MODE_DESIGN.md` proposal, which has been retired: its
useful concepts (arena tender mechanics, economy reference values and
deferred origin features) are consolidated here and in
`docs/DEVELOPMENT_ROADMAP.md`, and the proposal file has been removed.

## Product promise

A Campaign is an opt-in, persistent Mercenary Company. BattleTech battles use
the existing authoritative engine, but Campaign BattleMechs, pilots, credits,
and outcomes persist only when the match was explicitly created as a Campaign
contract. A skirmish is always isolated: it may display a Career preview, but
it can never change a company.

## Experience target

The intended player experience is a **MechWarrior 5: Mercenaries-style
mercenary career loop**, adapted for a turn-based tabletop VTT: manage a small
company from an HQ, choose contracts, deploy a finite hangar, bring damaged
machines home, repair and rearm them, hire and develop pilots, and grow into
more demanding work. The game should make the consequences of a battle visible
and understandable without pretending to be a real-time action simulation.

This is a gameplay direction, not a promise to copy MW5's interface, content,
economy, or presentation. BT-VTT's differentiator remains transparent,
authoritative BattleTech resolution and replayable reports.

## Career-1 scope

Career-1 delivers one complete loop:

1. Create a Mercenary Company.
2. Receive a small, clearly documented starter force and pilot.
3. Choose an AI contract, assign an owned force, and launch a Campaign match.
4. Settle the sealed result once: pay, reputation, pilot state, ammunition,
   armour, structure, and critical damage persist.
5. Inspect the outcome in the Company HQ and repair/reload with an
   authoritative price before taking the next contract.

It does **not** include planets, travel, faction standing, PvP tenders,
campaign arcs, custom design purchases, markets with real-time prices, or
Inner Sphere/Clan origin variants. Those are later additions after the core
loop is proven.

## Non-negotiable rules

- Campaign state is server-owned. Browser state, replay imports, and Battle
  Report downloads are never settlement authorities.
- A sealed, completed match report is the only input to settlement.
- Every settlement is idempotent: retrying a request or rejoining a completed
  game cannot pay, damage, or advance a company twice.
- A Career battle stores a signed mapping from persistent BattleMech/pilot IDs
  to its match instances. Settlement rejects missing, foreign, duplicate, or
  changed mappings.
- A company can only mutate its own rows, through narrowly scoped RPCs. RLS
  permits read access to its owner and no direct client-side writes.
- Catalogue version and unit identity remain pinned on every owned BattleMech.
  Repair calculations compare persistent condition against the matching
  catalogue maximum, never a newer release.
- A destroyed BattleMech remains a recoverable wreck. It is not silently
  deleted, replaced, or restored.

## Core records

| Record | Ownership | Purpose |
|---|---|---|
| Company | one per user | name, credits, reputation, capacity and timestamps |
| Owned BattleMech | company | pinned catalogue identity, condition, ammunition and status |
| Pilot | company | skills, injuries, experience, availability and assignment |
| Contract | company | generated AI mission, terms, status and launch parameters |
| Career battle | company + match | immutable settlement receipt and idempotency key |
| Ledger entry | company | immutable signed credit/debit audit trail |

Persistent BattleMech condition mirrors the battle instance already used by
the game: armour, structure, critical-slot damage, ammunition bins, destroyed
state and pilot consequences. This avoids a lossy translation at settlement.

## Lifecycle

```text
Company HQ → select contract → choose owned force → authoritative Career match
     ↑                                                       ↓
repair / reload ← settlement receipt ← sealed battle report and final state
```

At launch, the server verifies ownership, availability, pilot assignment,
tonnage, catalogue version and current condition; it then creates a normal
Play-vs-AI match with a `career_context` snapshot. At completion, the match-end
resolver calls one settlement function. That function writes the battle
receipt, updates the matched records, records the ledger entries, and marks the
contract complete. Any later call returns the same receipt unchanged.

## Economy defaults (intentionally tunable)

Career-1 uses transparent credits in the UI. Values are configuration
constants, not client inputs:

- Armour repair: 10 credits per point restored.
- Structure repair: 50 credits per point restored.
- Ammunition: price per round by ammunition family.
- Critical component replacement: a catalogue-derived component price.
- Low, medium, and high contracts pay a base reward, success bonus, and
  reputation reward scaled by force risk.

The first release must publish all applied costs and rewards in the settlement
receipt. Economy balancing follows measured play rather than an assumed canon
price list.

## Campaign UI

The Dropship's **Start Career** opens Company HQ. It shows credits,
reputation, available BattleMechs, pilots, active contract, and recent ledger
entries. A Campaign contract reuses the existing Hangar/deployment flow, but
labels every selected unit as persistent and displays its current condition.
The completion screen distinguishes the sealed battle report from the Career
settlement receipt and offers repair/reload actions only after settlement.
Persistent pilots can be renamed and given an optional callsign from HQ; this
changes their identity only and cannot alter an already-running battle copy.

## Delivery plan

### Career-1a — persistence and isolation

Create company, owned-BattleMech, pilot, ledger, contract, and settlement
receipt tables; RLS; owner-only read RPCs; and a regression proving an ordinary
skirmish cannot write any Career row.

### Career-1b — launch and settlement

Create a small deterministic AI contract board, launch a Career match from
owned units, and settle sealed outcomes idempotently. Persist damage, ammo,
pilot injury, credits, reputation and receipt/ledger entries.

### Career-1c — HQ and repair bay

Add Company HQ, condition-aware Hangar cards, ledger/history, repair/reload
estimates and confirmed authoritative repairs. Include a completed Career
battle acceptance test from creation through repair.

**Implementation status: implemented in SQL 139.** The Repair Bay derives
armour, structure, critical-component and ammunition quotes from the
BattleMech's pinned catalogue record. It locks the owner company, refuses an
active contract, records each debit in the immutable ledger, and leaves a
destroyed BattleMech as a recoverable wreck.

### BV-4 — Career force bands

Advertise a BV2.1 band on each contract, show the assigned operational lance's
pilot-adjusted value in HQ, enforce that band at launch, and seal the signed
value with the match. Valuation reads pinned stock configurations and current
pilot skills only; damage, expended ammunition, and browser totals are never
inputs.

**Implementation status: implemented in SQL 140.** The same slice adds the
owner-only pilot name/callsign action used by Company HQ.

## Longer campaign roadmap

### Career-2 — mercenary growth

Add salvage decisions, a curated purchase/hire market, richer contract
variety, pilot experience/advancement, and reputation-gated company capacity.
Every reward remains a server-side consequence of a sealed Career battle.

**Implementation status: implemented in SQL 141 and build
`20260908-career2-growth-95`.** Settlement creates experience awards and a
single salvage decision idempotently from the sealed report. Company HQ adds
the rotating market, pilot assignment and advancement, and reputation-gated
capacity upgrades. Contract boards rotate Annihilation, Control, and
Breakthrough missions without modifying signed offers.

### Career-3 — regional operations

Add a small curated star map, travel, faction standing, repair/supply
differences, and map/contract theming. Start with a handful of readable worlds
and expand only when the economic loop is balanced.

**Implementation status: implemented in SQL 142 and build
`20260908-career3-regions-96`.** Five connected worlds provide local map
sets, supply and market multipliers. Travel consumes credits and campaign days
and refreshes unsigned local offers. New settlements adjust employer and
opposition standing exactly once.

### Career-4 — optional multiplayer and origins

Add PvP arena tenders, campaign arcs, and alternate Inner Sphere/Clan origins
only after the default mercenary loop is stable. These are extensions to the
same settlement contract, never parallel persistence systems.

#### Career-4a — origins and founding arcs

**Implementation status: implemented in SQL 143 and build
`20260908-career4a-arcs-97`.** New companies permanently choose Independent,
Inner Sphere, or Clan origin. Origin selects a starting world, a suitable
starter force, and one three-operation founding arc. A featured operation
advances only after its sealed victory and is protected by a unique settlement
award. A defeat immediately reoffers the same operation; a victory immediately
offers the next, and settlement retries cannot duplicate either. Existing
companies retain their original affiliation and force.

#### Career-4b — consensual PvP tenders

Still pending. This requires invitation/acceptance, force escrow, withdrawal,
two-company settlement, disconnect handling and explicit stakes. It must not
reuse ordinary skirmish joining as implied consent.

Mechanics to carry into the slice, adapted from the retired
`CAREER_MODE_DESIGN.md` proposal (§4.7) to the consent-first rule:

- **Tender lifecycle:** `open → countered → accepted`, or `declined` /
  `expired` / `cancelled` at any point. At most three counter rounds;
  exceeding that auto-expires the tender.
- **Committed forces:** each side commits specific owned BattleMechs and
  pilots (respecting dropship tonnage). Committed records are locked while
  the tender is live — no sale, repair, reassignment, or re-spend — and are
  released on decline, expiry, or cancellation.
- **Stakes:** each side wagers credits held in escrow once the tender is
  accepted. The winner collects the full pot plus a reputation gain; the
  loser forfeits the stake and some reputation. Battle losses are a real
  cost on top of the wager: both companies keep their Mech damage and pay
  their own repairs.
- **Dual settlement:** committed Mechs seed the match in their current
  (possibly damaged) persistent state; on match end, settlement runs once
  per company, idempotently, from the sealed report.
- **Disconnect handling:** a disconnected side neither auto-accepts nor
  auto-forfeits; the tender holds in escrow, and a timeout refunds both
  stakes and releases committed forces (exact timeout policy is a slice
  decision).
- **Opt-in Mech-forfeit flag:** a tender term may allow a defeated Mech to
  be forfeited to the winner. This is opt-in by both companies and defaults
  off.


## Acceptance criteria

- A new company can finish a complete low-risk contract against AI.
- The match starts from the persistent condition of each selected BattleMech.
- One result creates exactly one settlement receipt and one set of ledger
  entries, even after retry/rejoin.
- Damage and ammunition persist; repair/reload restores only what is paid for.
- A completed skirmish, imported replay, or modified browser state cannot
  mutate a Career company.
- All monetary changes, rewards, injuries, progression, salvage and repairs are explainable from
  immutable server records.

## Deferred decisions

Longer career systems remain desirable but must be explicit later
additions, never silent scope expansion of the first persistent release.
Consolidated from the retired `CAREER_MODE_DESIGN.md` proposal:

- **Planetary logistics depth:** terrain-seeded map selection from planet
  profiles, and industrial-level gating on component replacement and supply
  quality. Logistics is currently represented by the regional travel and
  supply loop from Career-3.
- **Career transitions:** origins are immutable in Career-4a. The
  proposal's transitions — desertion, exile, honourable discharge, and
  high-reputation recruitment into a nation or Clan — remain a candidate
  for a later slice if player feedback wants them.
- **Clan and patron flavour:** Bloodname at a status threshold, patron
  flavour for campaigns, and a PvP Trial of Possession with an opt-in
  Mech-forfeit stake.
- **Economy reference values (tuning baseline):** pay-by-tonnage-tier
  contracts (low 20,000 / medium 60,000 / high 150,000 base plus per-kill
  and success bonuses), per-shot reload rates by ammunition family, and
  per-part component multipliers (actuator 5 · gyro 10 · weapon 3 · sensor
  2 · life support 4 · other 1).

