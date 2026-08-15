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

1. Server-side declaration/event and random-dice foundation.
2. Standard direct-fire weapons: legal arcs/range/minimum range, ammunition,
   grouped damage, locations, transfer, and critical checks.
3. Missile cluster resolution and ammunition-bin selection.
4. Complete punches/kicks, limb availability, physical location tables, and
   piloting consequences.
5. Heat, shutdown/ammunition interactions, End Phase effects, and advanced
   equipment.

Do not expose a rule in the UI until its resolution and persistent record are
implemented together.
