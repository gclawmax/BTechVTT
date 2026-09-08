# Wolverine catalogue expansion

Apply the six files in `SQL/145_wolverine_variants_catalogue.sql.parts/`
in numerical order, from `001_of_005.sql` through `005_of_005.sql`, then
`006_verify.sql`. These are a versioned content pack, not a schema change.
All files are required. New matches then use the expanded catalogue;
existing matches keep their original pinned catalogue.

The release retains all 88 previously supported units and adds five
Wolverines, for 93 playable units. Unknown equipment fails generation.

| Wolverine | Stock BV2, G4/P5 | Status |
|---|---:|---|
| WVR-6R | 1101 | Existing |
| WVR-6K | 1248 | Added |
| WVR-6M | 1291 | Added |
| WVR-7D | 1314 | Added |
| WVR-7K | 1331 | Added |
| WVR-7M | 1673 | Added |

Sources: local MegaMek MTF records and MegaMek 0.51.01 Units.txt BV export,
client revision a222ef540288e079e577de6525762125165b8a45.
New catalogue: `megamek-2026-09-wolverine-variants-01`.

Official MegaMek 0.51.00.1 sprite mappings were imported for all five new
Wolverines and thirteen recently added Puma variants. All 93 playable units now have verified sprite mappings. Existing Dragon
and other catalogue IDs that previously lacked matching artwork are covered.
Their source files,
atlas coordinates and CC-BY-NC attribution are in `assets/mechs/manifest.json`.
The WVR-7D uses MegaMek's Wolverine chassis fallback; the other added
Wolverines have exact variant mappings. These are tactical sprites, not
large illustrated record-sheet portraits.

The signed-in UI displays a circular initials avatar and callsign in a
reserved top-right header, using an account callsign or saved commander
callsign where available, with username as fallback. It hides on logout.
Hangar cards now show available unit sprites.
