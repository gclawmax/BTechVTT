# BT-VTT unit catalogue

`js/game/unit-catalogue.js` is the single shipped source of gameplay data for
tested BT-VTT units. Unit instances store only a catalogue ID, so the game
does not duplicate armour, movement, or weapon statistics per match.

`BT_UNIT_SUPPORT` is intentionally separate and contains only catalogue IDs
and support status. It answers whether a record is playable without copying
any unit statistics.

The complete MegaMek-derived catalogue remains developer-local and ignored by
Git. A future import review can add a tested unit to the shipped catalogue and
then mark that ID supported. Raw MegaMek data is never loaded by the deployed
game through this workflow.

Prototype IDs used in earlier saved games are translated through
`BT_UNIT_ID_ALIASES`, so existing games continue to load during the migration.
