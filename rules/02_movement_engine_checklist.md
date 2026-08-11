# BattleTech Quick Start --- Movement Engine Checklist

Use this file when implementing or debugging the VTT movement system.

## Preconditions

-   Current phase is `movement`.
-   Unit has not already completed movement.
-   Unit is alive and able to move.
-   Unit belongs to the side currently entitled to move.

## Validate mode

Allowed: - `stand` - `walk` - `run` - `jump`

Reject: - changing mode after movement has started - jump when Jumping
MP is 0 - walk/run/jump when the corresponding MP rating is 0

## Validate ground movement

For walk/run: 1. Destination must be adjacent for a single step. 2.
Determine direction relative to current facing. 3. Forward entry costs 1
MP plus terrain cost. 4. Rear entry is legal only when walking and costs
1 MP plus terrain cost. 5. Other directions require facing change,
costing 1 MP per hexside, then movement cost. 6. Running cannot move
into the rear hex. 7. Cannot move through an enemy 'Mech. 8. Cannot
finish in any occupied hex. 9. Total MP used must remain within the
selected mode's MP rating.

## Validate jumping

1.  Destination distance must be \<= remaining Jumping MP.
2.  Terrain does not affect cost.
3.  Intervening 'Mechs do not matter.
4.  Destination cannot contain another 'Mech.
5.  Initial facing does not restrict direction.
6.  Final facing may be chosen freely.

## Important state

Do not confuse: - MP spent - hexes travelled - movement mode

They are separate values.

The later attack system uses movement mode for the attacker's modifier
and hexes travelled for the target's movement modifier.

## Phase isolation

Movement code must NOT: - select weapons - calculate line of sight -
calculate range - roll attacks - roll hit locations - apply damage -
advance automatically into Weapon Attack Phase

The phase controller, not movement code, decides when the Movement Phase
ends.
