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

This produces two Git-ignored files:

```text
local-data/btech-supported-registry.json
local-data/btech-supported-content-pack.sql
```

Run `SQL/17_versioned_unit_catalogue.sql` once to create the generic schema.
The generated content pack can then be loaded independently. Adding units
regenerates the pack; it does not require another numbered schema migration.

Catalogue versions are immutable. Increment `catalogue_version` in the
allowlist whenever its contents change, allowing active and saved matches to
retain the definitions with which they started.

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
node tools/build-megamek-content-pack.mjs --config local-data/mw5-skirmish-import-candidates.json --skip-unsupported --registry-output local-data/mw5-skirmish-registry.json --sql-output local-data/mw5-skirmish-content-pack.sql
```

Without `--skip-unsupported`, the content-pack build stops and names every
unit whose weapons or ammunition are not yet implemented by the VTT. With it,
the compatible portion is generated while those variants are named and held
back for rules development; no unit receives substitute weapon values.

## Attribution and licence

Source: [MegaMek Data Repository](https://github.com/MegaMek/mm-data)

MegaMek Data © 2025-2026 by The MegaMek Team is licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

Keeping this cache out of Git avoids copying a large external dataset into
BT-VTT, but it does not remove the licence obligations. If a transformed
catalogue is later delivered to players, it must carry appropriate attribution,
the CC BY-NC-SA 4.0 terms, and an indication of the changes made.
