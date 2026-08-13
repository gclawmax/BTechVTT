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

## Heat

Heat should be a per-unit round ledger, not a single opaque number:

```text
startingHeat, movementHeat, weaponHeat, engineHeat,
environmentalHeat, heatDissipated, endingHeat, triggeredEffects
```

Add basic movement and weapon heat first. Shutdown, ammunition explosions,
pilot effects, and critical interactions should follow only with their
corresponding Total Warfare checks and user-visible roll logs.
