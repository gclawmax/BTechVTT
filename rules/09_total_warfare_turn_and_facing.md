# BattleTech Total Warfare --- Turn, Activation and Facing Scope

Source authority: the local Total Warfare PDF. This is an implementation
brief, not a replacement for the rulebook.

## Current engine boundary

The VTT currently has a phase controller and a seat-based initiative order.
It must keep phases isolated: initiative, movement, reaction/torso selection,
weapon attacks, physical attacks, heat, and end-of-round resolution must not
run each other's actions.

## Initiative and activation

- Resolve initiative before a round's player actions.
- Record both the winning side and the activation order used for that round.
- The lower-initiative side acts first where the applicable rules require it.
- Movement, Weapon Attack declarations, and Physical Attacks alternate by
  activation group, beginning with the initiative loser.
- Before each pair of opposing activations, compare the number of eligible
  units each side still has left. A side activates at least one unit; when it
  has at least twice as many remaining it activates two, at least three times
  as many it activates three, and so on. In engine terms its allowance is
  `max(1, floor(own remaining / opposing remaining))`.
- Recalculate both sides' allowances at the start of every new pair. Do not
  reuse the opening force ratio for the entire phase.
- Ties must be resolved before creating a final activation order.

## Facing state

Keep leg and torso facing as independent six-direction values:

```text
legFacing:   0..5
torsoFacing: 0..5
```

- Movement changes `legFacing` and costs movement points.
- A torso twist changes only `torsoFacing`.
- The board must show both values whenever they differ: the main token shows
  leg facing; a smaller, visually distinct marker shows torso facing.
- The UI's left/right labels must follow the rendered board orientation, not
  merely the numeric direction sequence.

## Deferred precision

Exact twist limits, arm-flip eligibility, and firing-arc interactions must be
implemented only after checking the relevant Total Warfare pages for the unit
and rules level being supported.
