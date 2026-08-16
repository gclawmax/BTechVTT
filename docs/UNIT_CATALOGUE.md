# BT-VTT unit catalogue

New human matches load their playable definitions from the latest installed
Supabase catalogue release. Unit instances store the stable catalogue ID and
mutable record-sheet state, so matches do not duplicate immutable definitions.

`BT_UNIT_SUPPORT` is intentionally separate and contains only catalogue IDs
and support status. It answers whether a record is playable without copying
any unit statistics.

The scalable source is the versioned database catalogue introduced by
`SQL/17_versioned_unit_catalogue.sql`. The allowlist in
`config/supported-megamek-units.json` is parsed by
`tools/build-megamek-content-pack.mjs`; raw MegaMek files and generated packs
remain developer-local and ignored by Git.

This separates MegaMek discovery data, reviewed supported content and mutable
match state. The lobby, record sheets and authoritative direct-fire resolver
read the pinned versioned tables. The six browser definitions remain only for
old unpinned saves and the AI testing mode.

`btech_games.catalogue_version` pins a match to one immutable release. Existing
matches remain nullable during the compatibility transition; every new human
lobby sets it when created. `SQL/18_pin_versioned_catalogue.sql` prevents a
pinned match from being repointed to different definitions.

Prototype IDs used in earlier saved games are translated through
`BT_UNIT_ID_ALIASES`, so existing games continue to load during the migration.
