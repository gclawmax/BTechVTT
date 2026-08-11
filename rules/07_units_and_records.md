# BattleTech Quick Start --- Unit Data

Use record-sheet data as authoritative for each unit's: - Walking MP -
Running MP - Jumping MP - Gunnery Skill - Armor - Internal/critical data
as applicable - Weapon inventory - Weapon locations - Weapon damage -
Weapon short/medium/long ranges - Ammunition

## Quick-Start examples

### Locust LCT-1V

-   Walking: 8
-   Running: 12
-   Jumping: 0
-   Gunnery: 4
-   Weapons:
    -   Medium Laser: CT, 5 damage, ranges 3/6/9
    -   Machine Gun: RA, 2 damage, ranges 1/2/3
    -   Machine Gun: LA, 2 damage, ranges 1/2/3

### Griffin GRF-1N

-   Walking: 5
-   Running: 8
-   Jumping: 5
-   Gunnery: 4
-   Weapons:
    -   LRM 10: RT, 1/missile, ranges 7/14/21
    -   PPC: RA, 10 damage, ranges 6/12/18

Do not hard-code these values into generic movement logic; unit data
should remain data-driven.
