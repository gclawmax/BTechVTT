# BattleMech Equipment Audit

This is the short SR-6 implementation audit for the 3060 duel rulesets. It
keeps future catalogue imports tied to named, testable mechanics rather than
silently admitting a unit whose equipment has no game effect.

## Already represented

- Physical weapons and attacks: punches, kicks, hatchets, swords, clubs,
  improvised clubs, charges and Death From Above.
- Mobility equipment: MASC, Superchargers and Triple-Strength Myomer.
- Electronic and signature equipment: ECM, Active Probes, Angel ECM, Watchdog,
  Targeting Computers, Null Signature and Chameleon LPS.

## Next BattleMech mechanics to audit before importing dependent designs

1. Shields and their distinct defensive/physical-attack effects.
2. Talons and their kick-damage and piloting interactions.
3. Actuator Enhancement Systems.
4. Jump boosters and their movement restrictions.

Vehicle, infantry, aerospace and underwater-only equipment remains outside the
BattleMech duel scope unless a future scenario slice explicitly adopts it.
