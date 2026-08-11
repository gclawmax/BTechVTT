# BT-VTT Reaction Phase Update

Incremental update to the separated VTT.

## Implemented
- Distinct `reaction` phase between Movement and Weapon Attack.
- Movement and Reaction use Initiative order: loser first, winner second.
- Next Phase passes to the next player within Movement/Reaction before changing phase.
- Explicit Movement facing controls cost 1 MP per hexside and do not increase `hexesMoved`.
- Separate `torsoFacing` state and first-pass Reaction/Torso Twist UI.
- Existing algorithmic AI is phase-scoped: movement actions only in Movement; attacks only in Weapon Attack; Reaction does not fall through to weapons fire.

## Provisional rule boundary
The supplied Beginner Box Quick-Start Rules do not define the Reaction/Torso Twist phase. The VTT phase/UI therefore follows the project's stated ruleset; exact torso-twist limits and firing-arc interactions should be refined when their applicable rules text is added.
