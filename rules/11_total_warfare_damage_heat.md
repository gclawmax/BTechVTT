# BattleTech Total Warfare --- Damage, Physical Attack and Heat Scope

Source authority: the local Total Warfare PDF. This is a development boundary
for the VTT, not an exhaustive rules transcription.

## Damage pipeline

Damage resolution needs a durable event record:

```text
attackId, targetId, hitLocation, damageGroup, armorBefore, armorAfter,
internalBefore, internalAfter, transfer, criticalChecks, destructionState
```

- Apply armor before internal structure.
- Apply overflow through the correct location-transfer path.
- Record critical-hit checks only when their prerequisites are met.
- Do not remove destroyed units until the rules-defined resolution point.

## Physical attacks

Implement after basic weapon attacks are reliable. Keep declarations separate
from resolution and validate target arc, range, eligible limbs, prior weapon
use, and special consequences before applying damage.

`SQL/23_authoritative_physical_attacks.sql` implements the first trustworthy
standard-biped slice: one- or two-arm punches and a chosen-leg kick, actuator
and weapon-use restrictions, attack modifiers, the dedicated 1D6 punch/kick
location tables, simultaneous damage, transfer and critical results.

`SQL/25_authoritative_physical_piloting.sql` completes its immediate
consequences: kick, missed-kick, and 20+ physical-damage triggers are combined
per BattleMech; Supabase rolls the Piloting Skill Roll; and a failed roll
persists a prone state plus grouped fall damage and critical results.

## Heat

Heat should be a per-unit round ledger, not a single opaque number:

```text
startingHeat, movementHeat, weaponHeat, engineHeat,
environmentalHeat, heatDissipated, endingHeat, triggeredEffects
```

Add basic movement and weapon heat first. Shutdown, ammunition explosions,
pilot effects, and critical interactions should follow only with their
corresponding Total Warfare checks and user-visible roll logs.
