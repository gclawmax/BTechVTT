# Persistent Campaign Design

Status: **approved design baseline — Career-1b contract launch and settlement in progress**

This is the authoritative design for persistent play. It supersedes the scope
of the older local `CAREER_MODE_DESIGN.md` proposal for implementation order;
that proposal remains useful background research but deliberately includes
later features that are not part of the first release.

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

## Longer campaign roadmap

### Career-2 — mercenary growth

Add salvage decisions, a curated purchase/hire market, richer contract
variety, pilot experience/advancement, and reputation-gated company capacity.
Every reward remains a server-side consequence of a sealed Career battle.

### Career-3 — regional operations

Add a small curated star map, travel, faction standing, repair/supply
differences, and map/contract theming. Start with a handful of readable worlds
and expand only when the economic loop is balanced.

### Career-4 — optional multiplayer and origins

Add PvP arena tenders, campaign arcs, and alternate Inner Sphere/Clan origins
only after the default mercenary loop is stable. These are extensions to the
same settlement contract, never parallel persistence systems.

## Acceptance criteria

- A new company can finish a complete low-risk contract against AI.
- The match starts from the persistent condition of each selected BattleMech.
- One result creates exactly one settlement receipt and one set of ledger
  entries, even after retry/rejoin.
- Damage and ammunition persist; repair/reload restores only what is paid for.
- A completed skirmish, imported replay, or modified browser state cannot
  mutate a Career company.
- All monetary changes, rewards, injuries and repairs are explainable from
  immutable server records.

## Deferred decisions

The broader proposal's planetary logistics, faction standing, arena tenders,
alternate origins, campaigns, salvage choice and advanced markets remain
desirable, but each depends on the Career-1 settlement contract. They should
be designed as Career-2+ additions rather than silently expanding the first
persistent release.
