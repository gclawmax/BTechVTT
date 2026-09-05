# SR-7 — Catalogue Completion Audit

SR-7 releases `megamek-2026-09-sr7-01`, an immutable 85-unit BattleMech
catalogue. It extends the curated-05 release rather than replacing it, so
existing games remain pinned to their original records.

## Reviewed import batch

The following ten MegaMek records passed the real content-pack builder: all
weapons, ammunition bins, biped structure and occupied critical slots resolve
through the authoritative game catalogue.

| Tech base | BattleMech | Representative rules coverage |
| --- | --- | --- |
| Inner Sphere | Bushwacker BSW-X1 / X2 | AC, LRM, ER and pulse laser |
| Inner Sphere | Axman AXM-1N | AC/20, pulse laser, hatchet critical layout |
| Inner Sphere | King Crab KGC-000 | paired AC/20 and LRM |
| Inner Sphere | Wraith TR1 | pulse lasers and jump movement |
| Inner Sphere | Nightsky NGS-5S | pulse lasers and advanced mobility layout |
| Inner Sphere | Axman AXM-2N | LRM, pulse laser and established hatchet-family layout |
| Clan | Nova Cat Prime / A | Clan ER PPC and ER laser |
| Clan | Nova Cat B | Clan LRM and ER medium laser |

The release is intentionally small: a unit enters only after the pack builder
can resolve every mounted weapon and ammunition bin. `test-sr7-catalogue-audit.mjs`
verifies the immutable version, all table counts and representative weapon
families before deployment.

## Held-back categories

| Category | Treatment |
| --- | --- |
| Fully supported BattleMech records | Review in a small future batch and run the content-pack builder. |
| Shields and Actuator Enhancement Systems | Held for their own authoritative defensive/physical rules slice; never admitted as cosmetic equipment. |
| Other unrecognised weapons or ammunition | Held against the named missing weapon/ammunition rule reported by the pack builder. |
| Vehicles, infantry, aerospace, ProtoMechs, underwater-only systems and non-biped chassis | Outside the BattleMech-duel ruleset unless a later scenario slice explicitly adopts that subsystem. |

## Deployment

Run `SQL/122_sr7_catalogue_completion.sql.parts/001_of_004.sql` through
`004_of_004.sql`, then `005_verify.sql`, in order. The verification expects
85 units, 423 mounts, 4,534 occupied critical slots and 189 ammunition bins.
New matches select the SR-7 catalogue automatically after it becomes the latest
release; existing matches remain pinned.
