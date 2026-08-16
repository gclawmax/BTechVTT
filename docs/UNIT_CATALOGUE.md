# BT-VTT unit catalogue

`js/game/unit-catalogue.js` remains the browser runtime source for the initial
tested units. Unit instances store only a catalogue ID, so matches do not
duplicate immutable unit definitions.

`BT_UNIT_SUPPORT` is intentionally separate and contains only catalogue IDs
and support status. It answers whether a record is playable without copying
any unit statistics.

The scalable source is the versioned database catalogue introduced by
`SQL/17_versioned_unit_catalogue.sql`. The allowlist in
`config/supported-megamek-units.json` is parsed by
`tools/build-megamek-content-pack.mjs`; raw MegaMek files and generated packs
remain developer-local and ignored by Git.

This separates MegaMek discovery data, reviewed supported content and mutable
match state. The browser constants can be retired once the lobby and resolver
read the versioned tables directly; until then, the six established units stay
available through the existing compatibility layer.

`btech_games.catalogue_version` pins a match to one immutable release. Existing
matches remain nullable during the compatibility transition; new catalogue-
backed games will set it when their lobby is created.

Prototype IDs used in earlier saved games are translated through
`BT_UNIT_ID_ALIASES`, so existing games continue to load during the migration.
