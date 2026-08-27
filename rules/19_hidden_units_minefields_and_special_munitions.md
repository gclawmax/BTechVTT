# Hidden units, minefields, detection and specialist munitions

This release deliberately excludes underwater combat, underwater concealment and sea mines.

## Hidden BattleMechs

- A BattleMech may deploy hidden only in concealing, passable terrain; clear, paved, bridge and water hexes are not legal.
- The owning player can see a `HIDDEN` marker. The opposing player cannot see or target the unit.
- A hidden unit is revealed when it moves or fires, when an enemy finishes adjacent, or when an active probe detects it with line of sight.
- Ground movement attempting to enter a concealed enemy’s hex stops in the preceding hex and reveals the contact. Stacking remains prohibited.
- Beagle Active Probes use a four-hex range; Clan Active Probes use five.

## Minefields

- Each standard custom skirmish side receives two pre-placed ground minefields inside its own deployment zone. The state allowance remains scenario-configurable.
- Conventional and vibrabomb fields may have density 10, 20 or 30. Vibrabombs also record their configured weight sensitivity.
- Minefields cannot be placed in occupied, building, impassable, magma or water hexes.
- Every traversed ground-movement hex is checked. Trigger numbers are 9+ at density 10, 8+ at density 20 and 7+ at density 30.
- Damage equals the field’s pre-trigger density, applied in 5-point groups using the kick location table. A detonation reduces density by five and reveals the field to both sides.
- At the end of Movement, an operational, unjammed probe rolls 10+ to detect a nearby pre-placed minefield, or 7+ for a future weapon-delivered field. Hostile ECM suppresses probe detection.

## Specialist ammunition and weapons

- Standard AC armour-piercing ammunition has +1 to hit, half bin capacity, normal damage and the weapon-specific chance of a critical effect through armour.
- Standard AC flechette ammunition inflicts half damage against BattleMechs.
- LRM and SRM fragmentation ammunition does no damage to BattleMechs.
- Precision ammunition retains half bin capacity and reduces up to two points of target movement modifier.
- A TAG-guided semi-guided LRM direct attack ignores target movement. An indirect attack additionally ignores indirect-fire, spotter-movement, spotter-firing and intervening-terrain modifiers.
- Plasma rifles add 1D6 heat to a BattleMech on a successful hit. Plasma cannons add 2D6 heat. Flamers retain their existing two-heat effect.

## Deferred advanced interactions

Hidden-unit point-blank reaction fire and weapon-delivered minefield placement require a dedicated hex-target declaration flow. The database schema already distinguishes weapon-delivered minefields so their 7+ probe detection rule can be used when that declaration UI is added.
