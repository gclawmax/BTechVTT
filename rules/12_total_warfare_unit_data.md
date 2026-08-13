# BattleTech Total Warfare --- Unit Data and Construction Scope

Source authority: the local Total Warfare PDF and authorised unit records.

## Match-time data

The live game should consume validated unit data rather than calculate a
'Mech's construction during a match. A unit record needs at least:

```text
movement ratings, pilot skills, armor and internal structure by location,
critical-slot layout, weapons with locations/ranges/heat, ammunition,
actuators, and destruction flags
```

## Data strategy

- Keep unit records data-driven; do not place unit-specific values in phase
  logic.
- Give each weapon and ammunition type a stable identifier.
- Treat advanced equipment and alternate firing modes as optional capabilities
  on a unit record, not hard-coded UI exceptions.
- Validate imported or hand-authored records before they can be selected for a
  game.

## Construction tools

Custom construction is a separate future product area. It should not block
the core VTT loop. If added, it requires dedicated validation for mass,
armor limits, critical slots, engine, structure, and equipment legality, plus
an import/export decision for supported record formats.
