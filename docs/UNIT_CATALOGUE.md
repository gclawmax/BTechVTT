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
match state. The lobby, record sheets and authoritative resolver read the
pinned versioned tables. The six browser definitions remain for AI testing.

`btech_games.catalogue_version` pins a match to one immutable release. Every
new human lobby sets it when created. `SQL/18_pin_versioned_catalogue.sql`
prevents a pinned match from being repointed to different definitions.
`SQL/69_repair_legacy_catalogue_pins.sql` can safely recover a participant's
older unpinned match when every selected or deployed unit exists together in
one installed release; ambiguous matches remain unchanged.

The `megamek-2026-08-missiles-01` release adds explicit per-missile damage to
supported LRM/SRM mount definitions. Install its generated content pack before
testing authoritative missile attacks; new lobbies automatically choose it as
the latest release.

## Current expanded release

`megamek-2026-08-curated-05` contains 75 playable BattleMechs. It retains the
balanced expansion of 15 Inner Sphere and 15 Clan BattleMechs, and adds the
Dragon DRG-7N, Grand Dragon DRG-7K and Grand Dragon DRG-9KC. The release is
installed from `SQL/97_expanded_75_unit_catalogue.sql.parts`: run numbered
parts 001 through 004 in order, then run `005_verify.sql`.

The Dragon-family records in this release are Dragon DRG-1C, Dragon DRG-1N,
Grand Dragon DRG-1G, Dragon DRG-5N, Grand Dragon DRG-5K-DC, Grand Dragon
DRG-5K, Grand Dragon DRG-C, Dragon DRG-7N, Grand Dragon DRG-7K and Grand
Dragon DRG-9KC. MRM, MML, Snub-Nose PPC, C3 Master TAG and rear-mounted weapon
profiles are included in the playable catalogue.

New matches pin this release after installation. Existing matches deliberately
retain their original immutable catalogue so saved record sheets cannot change
underneath an active game.

Prototype ID aliases remain only as inexpensive developer diagnostics; they do
not make old matches supported gameplay data.
