# MegaMek local unit import

BT-VTT can use a local MegaMek checkout to build a developer-only catalogue of
BattleMech records. The MegaMek source checkout and the generated catalogue
are ignored by Git and are not loaded by the deployed game.

## One-time local setup

Clone the MegaMek data repository into the ignored local-data directory:

```sh
git clone --depth 1 https://github.com/MegaMek/mm-data.git local-data/megamek-mm-data
```

Then run:

```text
node tools/import-megamek-mechs.mjs
```

This writes `local-data/megamek-catalogue.json`. The importer recognises the
current MegaMek MTF headers (including `chassis`, `model`, armour, movement,
and weapon locations) and creates a searchable local catalogue. It does not
make each record playable in BT-VTT. A unit needs supported movement, weapons,
armour, and equipment rules before it can be selected in a game.

## Build the playable, versioned content pack

The discovery catalogue is useful for searching the full data set. Playable
units use the reviewed allowlist in
`config/supported-megamek-units.json`. Generate their normalized registry and
Supabase content pack with:

```text
node tools/build-megamek-content-pack.mjs
```

This produces Git-ignored registry and SQL outputs:

```text
local-data/btech-supported-registry.json
local-data/btech-supported-content-pack.sql
local-data/btech-supported-content-pack.sql.parts/
```

Run `SQL/17_versioned_unit_catalogue.sql` once to create the generic schema.
The generated content pack can then be loaded independently. Adding units
regenerates the pack; it does not require another numbered schema migration.

Catalogue versions are immutable. Increment `catalogue_version` in the
allowlist whenever its contents change, allowing active and saved matches to
retain the definitions with which they started.

## Import verified BV2 values

BV2 is calculated by MegaMek; it is not an MTF header. Use MegaMek's
`MekCacheCSVTool` to export its pipe-delimited `Units.txt` file from the same
release as the unit data. Place that file at `local-data/megamek-bv2/Units.txt`
and create the reviewed fixture:

```text
node tools/import-megamek-bv2.mjs \
  --megamek-release 0.51.01 \
  --source-revision <MegaMek-client-commit>
```

The importer joins every reviewed unit by its exact MegaMek source file. It
fails on a missing, duplicate, malformed or unverified value; it never
estimates Battle Value from tonnage or weapons. The generated fixture remains
in ignored `local-data/` because it derives from MegaMek data.

The current `megamek-2026-09-bv2-01` catalogue configuration requires that
fixture. Run the normal content-pack builder with the same local data checkout:

```text
node tools/build-megamek-content-pack.mjs \
  --bv-input local-data/megamek-bv2/supported-bv2.json
```

The generated release embeds each unit's BV2 stock value, standard G4/P5
reference skills and MegaMek provenance into the pinned unit definition. This
is data preparation only: BV match limits are delivered in BV-2 and BV-3.

Unknown equipment makes supported-pack generation fail visibly instead of
silently producing an incorrect playable BattleMech.

## MW5 skirmish shortlist

The supplied MW5 chassis/variant list can be resolved against the local
MegaMek checkout without guessing source files:

```text
node tools/select-mw5-megamek-units.mjs
```

It writes the ignored `local-data/mw5-skirmish-import-candidates.json` report.
That file is directly usable as the content-pack configuration:

```text
node tools/build-megamek-content-pack.mjs --config local-data/mw5-skirmish-import-candidates.json --registry-output local-data/mw5-skirmish-registry.json --sql-output local-data/mw5-skirmish-content-pack.sql
```

The full list currently validates with the expanded weapon profiles. The
optional `--skip-unsupported` flag remains available for future lists: it
generates only supported records while naming any held-back variants, rather
than assigning substitute weapon values.

## Import the official unit artwork

MegaMek's data repository contains unit records, not the deployed unit
sprites. Download an official MegaMek release and extract its
`data/images/units` directory locally. The release supplies `mekset.txt` and
`imgFileAtlasMap.yml`; together they map units to either individual files or
coordinates within the release's sprite atlases.

Run the importer with those release paths:

```text
node tools/import-megamek-sprites.mjs \
  --source local-data/megamek-release/data/images/units \
  --mekset local-data/megamek-release/data/images/units/mekset.txt \
  --atlas-map local-data/megamek-release/data/images/imgFileAtlasMap.yml \
  --release 0.51.00.1 \
  --additional-catalogue config/supported-megamek-units.json
```

Atlas extraction uses the optional `sharp` package. Exact and chassis mappings
come from MegaMek's own files; unresolved or ambiguous units are reported in
the generated manifest and are never guessed. Deliberate exceptions belong in
`config/megamek-sprite-overrides.json`. The committed web manifest records the
source file, atlas crop, attribution, and licence for every imported sprite.

## Supabase deployment order

For the expanded roster, run `SQL/50_extended_weapon_profiles.sql` and then
`SQL/51_canonical_special_equipment_resolver.sql`. SQL/50 is an intentionally
safe compatibility waypoint; SQL/51 installs the complete maintained weapon,
critical-slot, and heat resolvers without inspecting or rewriting an older
function. Finally run the generated `local-data/mw5-skirmish-content-pack.sql`.
New matches pin the new catalogue version; existing matches retain the version
with which they began.

The single SQL file is intended for a direct database connection. Supabase's
browser SQL Editor may reject it as too large. In that case, open
`local-data/mw5-skirmish-content-pack.sql.parts/` and run each numbered `.sql`
file in order, finishing with `_verify.sql`. Every data part is transactional
and safe to rerun. The verification file reports the four table counts and
fails clearly if any part was missed.

## Attribution and licence

Source: [MegaMek Data Repository](https://github.com/MegaMek/mm-data)

MegaMek Data © 2025-2026 by The MegaMek Team is licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

Keeping this cache out of Git avoids copying a large external dataset into
BT-VTT, but it does not remove the licence obligations. If a transformed
catalogue is later delivered to players, it must carry appropriate attribution,
the CC BY-NC-SA 4.0 terms, and an indication of the changes made.

Unit sprites are imported from an official MegaMek release and retain their
separate CC BY-NC 4.0 attribution recorded in `docs/MEGAMEK_ATTRIBUTION.md` and
`assets/mechs/manifest.json`.
