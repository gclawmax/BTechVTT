# BattleTech Total Warfare - Authoritative Combat Engine

Source authority: the local Total Warfare PDF. This file is a development
contract; it deliberately does not reproduce published game tables.

## Non-negotiable model

- A player submits decisions only: attacker, target, legal weapons/ammo bins,
  and applicable choices.
- The Supabase resolver validates the declared action against the persisted
  board state, generates all dice, consumes ammunition, and applies results.
- Each result is stored in `btech_combat_events` before the board state is
  updated. Browsers render that result; they never calculate the authoritative
  outcome.

## Resolution record

Each event must preserve the declaration, to-hit breakdown, 2D6 rolls,
cluster rolls where applicable, hit-location rolls, grouped damage, armour and
structure changes, transfer, critical checks, ammunition changes, heat, and
all follow-up checks.

## Delivery order

1. Server-side declaration/event and random-dice foundation. Declarations are
   accepted only from the active player and persisted in the combat ledger.
   The server now attaches an immutable 2D6 to-hit roll to each declaration.
2. Standard direct-fire weapons: legal arcs/range/minimum range, ammunition,
   grouped damage, locations, transfer, and critical checks.
3. Missile cluster resolution and ammunition-bin selection. Implemented for
   the currently supported standard LRM-10, LRM-20 and SRM-6 launchers in
   `SQL/19_authoritative_missile_attacks.sql`.
   Human matches now persist every eligible unit's declaration before any
   dice or damage are resolved; the final declaration resolves the complete
   Weapon Attack batch atomically via `SQL/21_simultaneous_weapon_declarations.sql`.
4. Complete punches/kicks, limb availability, physical location tables, and
   piloting consequences.
5. Heat, shutdown/ammunition interactions, End Phase effects, and advanced
   equipment.

Do not expose a rule in the UI until its resolution and persistent record are
implemented together.
