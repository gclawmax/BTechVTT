# Arm flipping and improvised clubs

`SQL/88_arm_flipping_and_improvised_clubs.sql` keeps both actions inside the
normal simultaneous human-versus-human phase flow.

## Arm flipping

- A standing BattleMech may flip both arms only when neither arm is fitted
  with a lower-arm actuator or hand actuator.
- Arm flipping and torso twisting are mutually exclusive in the same turn.
- When flipped, every arm-mounted weapon uses the three-hex rear arc. Torso,
  head and leg weapon arcs are unchanged.
- A torso twist rotates all upper-body weapon arcs, including normal arm arcs.

## Improvised clubs

- Finding a club is a Weapon Attack action. Woods provide a tree club
  automatically; generic rubble provides a girder club on a 2D6 roll of 7+.
- The BattleMech needs two intact arms with working shoulders and hand
  actuators. It cannot fire weapons with that BattleMech while searching.
- The club is used in the Physical Attack phase against an adjacent target in
  the forward arc. It requires both arms, has a -1 to-hit modifier, and deals
  `floor(BattleMech tonnage / 5)` damage on the standard hit-location table.
- Either arm firing a weapon that turn prevents the club attack. Damaged arm
  actuators apply their normal physical-attack modifiers and damage reduction.
