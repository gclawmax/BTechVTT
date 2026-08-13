# BattleTech Total Warfare --- Weapon Attack Implementation Scope

Source authority: the local Total Warfare PDF. This file defines the order in
which the VTT should add weapon-attack features; it does not reproduce the
full tables or special-equipment rules.

## Recommended feature order

1. Select an eligible attacker and target.
2. Validate line of sight, distance, and the weapon's legal firing arc.
3. Create declarations for all weapons before resolving their effects.
4. Show projected heat and ammunition use before confirmation.
5. Resolve each declared shot using the applicable to-hit modifiers.
6. Queue and apply damage only at the appropriate resolution point.

## Required persistent state

For each declared weapon attack retain:

```text
attackerId, targetId, weaponId, weaponLocation, ammoSource,
declaredMode, range, firingArc, toHitBreakdown, roll, result
```

This makes the game log explainable and prevents a late UI refresh from
changing an already-declared attack.

## Arc and torso integration

- Use leg facing for leg-based restrictions.
- Use torso facing for weapons mounted in the torso and head where the rules
  permit torso twist to affect their arc.
- Use the applicable arm rules for arm-mounted weapons; arm flipping is a
  later, unit-specific feature.
- Reject invalid declarations before any ammo, heat, or damage state changes.

## Scope discipline

Start with the standard weapons on the supported unit records. Keep advanced
weapon modes and optional equipment data-driven and disabled until their rules
and data are implemented together.
