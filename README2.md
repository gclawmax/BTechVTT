# BTechVTT

A BattleTech tabletop simulator built as a browser-based VTT (Virtual Tabletop).

> **Note:** This file (`README2.md`) supersedes the roadmap section of `README.md`,
> which still lists Phases 2–6 as unimplemented. Everything in Phases 1–6 below is
> built and in use; see `SKILL_ROADMAP2.md` for the full status table.

## Architecture

- **Frontend:** Vanilla HTML/CSS/JS — single-page canvas game, no build step
- **Visible release marker:** update the single `data-build` value on the
  `<body>` in `index.html`; the fixed and dropship build stamps both use it
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Hosting:** GitHub Pages — https://gclawmax.github.io/BTechVTT/
- **Design:** Flat-top hex grid, odd-q offset coordinates, "phosphor" aesthetic (light bg, dark text, amber accents)

## What's implemented

### Core game loop
Full turn structure: **Initiative → Movement → Reaction → Weapon Attack → Physical Attack → Heat → End**, driven by `js/game/phases.js`.

### Movement (`js/movement/`)
- Walk/run/jump movement ranges with hex pathfinding
- Facing changes during movement and on jump landing
- Movement preview/highlighting
- Terrain and elevation movement rules, including woods, rough, rubble and water
- Elevation line-of-sight rules

### Combat (`js/game/`)
- Weapon attacks with range, facing, hit-location tables, shallow-water cover,
  prone firing, multiple declared targets and LRM indirect fire with simultaneous spotters
- Standard AMS missile-flight reduction and single-missile Narc interception
- Targeting Computer direct-fire bonuses and aimed shots; C3/C3i network range
  sharing with line-of-sight and physical-range safeguards
- Guardian/Clan ECM interruption of C3 and Artemis/Narc guidance,
  TAG-assisted semi-guided LRM fire, and Active Probe status reporting
- LB-X ammunition modes (cluster/shotgun fire derived from the selected ammunition bin)
- Ultra AC rapid fire, hatchet attacks, flamer heat
- Physical attacks (including Charge, Push and Death From Above), displacement,
  complete falls, and critical/destruction consequences from per-chassis layouts
- Heat management and heat sinks
- Reaction phase (counterattacks)
- Piloting checks applied after weapon damage

### Multiplayer (`js/network/`)
- Supabase Auth (username/password login)
- Game creation with shareable game codes, join flow
- Annihilation, Objective Control and Breakthrough victory conditions
- Lobby with roster selection, search, and persistent variant favourites
- Realtime state synchronization via Supabase Realtime
- Skirmish vs AI: the AI is a real game participant (`btech_players.is_ai = true`, `user_id = NULL`), with per-mech skirmish pilots and skirmish hangars

### Unit catalogue (`js/game/unit-catalogue.js`, `local-data/`)
- Curated Inner Sphere and Clan roster
- MegaMek-derived unit records (CC BY-NC-SA 4.0, see `docs/MEGAMEK_ATTRIBUTION.md`)
- Canonical equipment resolver and MegaMek sprites
- Hangar search (chassis, variant, tonnage, tech base), catalogue paging
- Player-owned MechLab designs with server-validated Inner Sphere and Clan
  construction, including XL engines, Endo Steel, Ferro-Fibrous armour and
  selected Clan weapons, with immutable catalogue revisions
- Split SQL imports sized for the Supabase SQL Editor (`local-data/*.sql.parts`)

### UI
- Canvas board with terrain rendering, scrollwheel zoom, map rotation
- Map & Scenario Editor with terrain/elevation painting, custom deployment
  zones and objectives, local drafts, JSON import/export and two-player launch
- Record sheet panel, unit detail panel, game log, resizable panels
- Mobile-responsive layout

## Repository layout

```
index.html              Single-page app entry point
css/                    Phosphor theme styles
js/
  core/                 auth, state, helpers, modal, screen, game-log
  game/                 phases, board, maps, movement rules, combat, heat,
                        criticals, reactions, unit catalogue, artwork
  movement/             movement engine + rules
  network/              Supabase client, lobby, create/join game, game codes
  ai/                   AI opponent state + decision logic
  ui/                   panels, record sheet, panel resize
SQL/                    Supabase migrations (run in order)
schema.sql              Full schema reference
local-data/             MegaMek source data, registries, content-pack SQL
docs/                   Unit catalogue, MegaMek attribution, local import notes
test-*.mjs              Node smoke tests (catalogue pagination, LB-X loadout,
                        skirmish hangar, special equipment, general fixes)
tools/test-human-vs-human*.mjs
                        Live two-player flow and focused authoritative-rules regressions
```

## Getting started

```bash
git clone https://github.com/gclawmax/BTechVTT.git
cd BTechVTT
# Open index.html in a browser — no build step required
```

For multiplayer/skirmish against the live Supabase project, run the supplied SQL
migrations in `SQL/` in their intended order (see `AI_PLAYER_DATABASE.md` for the
AI player schema requirements).

## Rule and data verification

The live catalogue release `megamek-2026-08-mw5-expanded-weapons-03` has been
checked with a normal player session: Clan weapon mounts retain their own
profiles. For example, Clan ER Medium Lasers use 7 damage and 5/10/15 range.

## Remaining work

- Expand remaining specialist equipment and scenario rules in catalogue-led batches
- Phase 7 polish: sound effects, campaign mode, production deployment
  beyond GitHub Pages
- Documentation refresh (this file and `SKILL_ROADMAP2.md` replace the stale
  roadmap in `README.md`)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML5 Canvas, CSS Grid |
| Backend | Supabase (PostgreSQL, Auth, Realtime) |
| Hosting | GitHub Pages |
| Tests | Node `.mjs` smoke scripts |

## Design notes

- **Hex coordinate system:** Flat-top hexes, odd-q vertical offset layout (matching printed BattleTech maps)
- **Hex codes:** 2-digit column + 2-digit row (e.g., "0304")
- **Facing:** 0–300° in 60° increments, mapped to axial neighbor vectors
- **Unit data:** Hand-entered stat blocks plus MegaMek-derived records matching canon BattleTech rules
- **Color scheme:** Minimalist "phosphor" aesthetic — light background, dark text, amber accents

## License

Private repository — all rights reserved.

Some supported unit records are derived from MegaMek Data and are separately
provided under CC BY-NC-SA 4.0; see [MegaMek data attribution](docs/MEGAMEK_ATTRIBUTION.md).
