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

`SQL/26_authoritative_standing.sql` makes the resulting prone state playable:
a prone BattleMech spends its Movement activation attempting to stand, with a
server-rolled Piloting Skill Roll and a saved success or failure outcome.

`SQL/56_correct_dfa_movement_declaration.sql` and
`SQL/57_resolve_declared_dfa.sql` supersede the provisional SQL/55 DFA slice.
A Death From Above attack is declared while jumping in the Movement Phase,
after stopping one hex short of a target that has completed movement. The
attacker cannot fire weapons, remains staged during weapon fire, and enters
the target hex only when the attack resolves in the Physical Attack Phase.
Successful damage is grouped in five-point clusters, the target is displaced,
and the attacker's landing damage and Piloting Skill Roll are server-resolved.
A miss applies the corresponding elevated fall and leaves the attacker prone.

`SQL/58_charge_attacks.sql` adds Movement-declared charges. A walking or
running BattleMech stops one hex short of a standing target that has completed
movement, cannot fire weapons, and resolves impact damage, counter-damage,
displacement and both Piloting checks during Physical Attacks.

`SQL/59_push_attacks.sql` adds server-resolved pushes against a standing
BattleMech directly ahead at the same level. Both arms are required, arm-fired
weapons are checked from the combat ledger, successful attacks displace the
target and advance the attacker, and the target rolls to avoid falling.

`SQL/60_complete_displacement_physical_falls.sql` completes the supported
BattleMech physical-combat edge layer. Occupied displacement destinations now
resolve recursively as domino effects; downward displacement can produce an
accidental fall from above; prohibited destinations and DFA fallback hexes are
resolved before either unit moves. The migration also centralises fall facing,
five-point damage groups, gyro modifiers and the second Piloting Skill Roll
that determines whether a fall injures the pilot.

Physical weapons are driven by the Total Warfare equipment table rather than
by a Hatchetman exception. A supported catalogue record that mounts a backhoe,
chainsaw, combine, dual saw, hatchet, heavy-duty pile driver, mining drill,
retractable blade, rock cutter, spot welder, sword or wrecking ball receives
the appropriate attack option, arc, modifier, damage and actuator effects.

`SQL/61_critical_hit_consequences.sql` connects critical damage to the rest of
the turn. New gyro, hip, upper/lower leg actuator and foot actuator hits now
trigger their end-of-phase Piloting consequences. A newly destroyed leg or
gyro causes an automatic fall, while the shared fall resolver includes all
current damage modifiers in the pilot-injury avoidance roll. Walking, running
and jumping MP are recalculated from surviving hips, actuators and jump jets;
running or jump landing with relevant damage makes the required server roll.
A one-legged BattleMech may make its single +5 stand attempt and, if upright,
has 1 Walking MP and cannot run; two destroyed legs or a destroyed gyro prevent
standing.

## Heat

Heat should be a per-unit round ledger, not a single opaque number:

```text
startingHeat, movementHeat, weaponHeat, engineHeat,
environmentalHeat, heatDissipated, endingHeat, triggeredEffects
```

`SQL/27_authoritative_heat_effects.sql` resolves dissipation, heat-scale
movement and gunnery modifiers, shutdown checks, and heat ammunition-explosion
checks on Supabase, recording each outcome in the shared log. Pilot damage and
consciousness are added by SQL/29 and complete fall injury checks by SQL/60.

`SQL/28_authoritative_startup.sql` lets a shut-down BattleMech use its
Movement activation for a server-rolled restart attempt, rather than blocking
the alternating activation order.

`SQL/29_authoritative_pilot_injuries.sql` adds head-hit and damaged-life-support
heat injuries, consciousness checks, End Phase recovery checks, pilot death,
and activation blocking for unconscious pilots.

`SQL/30_prone_weapon_fire.sql` requires a prone BattleMech to choose a
supporting arm before firing, prevents that arm's weapons firing, and applies
the prone attacker/target to-hit modifiers on Supabase.

`SQL/31_authoritative_movement.sql` makes human BattleMech movement server
authoritative: the proposed route, map bounds, occupied hexes, movement points,
woods entry cost, facing, heat, and alternating activation are validated and
saved atomically.

`SQL/32_authoritative_torso_twist.sql` makes confirmed Reaction Phase torso
twists server-authoritative and advances the alternating Reaction activation.

`SQL/33_authoritative_match_end.sql` makes victory and draw detection
server-authoritative, including the simultaneous-fire safeguard.

`SQL/34_authoritative_weapon_piloting.sql` adds a server-side Piloting Skill
Roll and fall outcome for a standing BattleMech taking 20 or more weapon or
missile damage during the simultaneous Weapon Attack phase.

`SQL/35_terrain_and_elevation.sql` adds the Ridge and Ford built-in map and
server-validated rough ground, shallow water, impassable hexes, and one-level
elevation changes for authoritative movement.
