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

## Attribution and licence

Source: [MegaMek Data Repository](https://github.com/MegaMek/mm-data)

MegaMek Data © 2025 by The MegaMek Team is licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

Keeping this cache out of Git avoids copying a large external dataset into
BT-VTT, but it does not remove the licence obligations. If a transformed
catalogue is later delivered to players, it must carry appropriate attribution,
the CC BY-NC-SA 4.0 terms, and an indication of the changes made.
