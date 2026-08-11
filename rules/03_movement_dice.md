# BattleTech Quick Start --- Movement Record

Movement dice are recommended by the rules as a way to record how each
'Mech moved.

## Meaning

-   White: walked
-   Black: ran
-   Red: jumped
-   White showing 6 traditionally represents standing still / 0 movement
    modifier.

The movement mode is represented by the die colour. The number records
the movement result used later for the target movement modifier.

## For the VTT

A digital implementation does not need physical dice, but should
preserve equivalent state:

``` text
movementMode
hexesMoved
movementModifier
```

Do not replace `hexesMoved` with MP spent. The rules explicitly
distinguish the two.
