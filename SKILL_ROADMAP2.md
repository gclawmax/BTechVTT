# BTechVTT — Roadmap (current)

> Supersedes the roadmap in `README.md` and the roadmap table in the `bttech-vtt`
> skill, both of which predate the completion of Phases 2–6.
> Last updated: 2026-08-21 (commit `63ee467`).

## Phase status

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Hex Grid + Unit Placement | ✅ Done | Flat-top hex grid, odd-q offset, unit tokens with facing, click-to-inspect, hex code labels, mobile-responsive |
| 2 — Movement | ✅ Done | Pathfinding, walk/run/jump ranges, facing changes, movement preview, terrain/elevation movement, rough-ground piloting checks, elevation LOS |
| 3 — Combat | ✅ Done | To-hit resolution (range/facing/hit-location), armor/structure damage, criticals with per-chassis layouts, heat management, reactions, LB-X ammo modes, Ultra AC rapid fire, hatchets, flamers, piloting checks after damage |
| 4 — Multiplayer Sync | ✅ Done | Supabase Realtime sync, turn management (Initiative → Movement → Reaction → Weapon Attack → Physical Attack → Heat → End), shared battlefield, game codes, lobby |
| 5 — Full Unit Roster | ✅ Done | Curated IS + Clan roster, MegaMek-derived records, canonical equipment resolver, MegaMek sprites, hangar search, variant favourites, lance-style skirmish hangars, per-mech skirmish pilots |
| 6 — Supabase Backend | ✅ Done | Auth (username/password), DB schema (players/games/state incl. AI seats), API layer, split SQL migrations for the Supabase SQL Editor |
| 7 — Polish & Deployment | 🔲 Not started | Sound effects, map editor, campaign mode, production deployment beyond GitHub Pages |

## Rule and data verification

Issues #1–#4 were fixed in commit `e7a8a33` with matching browser and SQL
changes: hit-location tables, per-pilot gunnery, and jump landing facing.
The live release `megamek-2026-08-mw5-expanded-weapons-03` was also checked
with a normal player session: Clan weapon mounts retain their own profiles,
including Clan ER Medium Lasers at 7 damage and 5/10/15 range.

## Suggested next steps (priority order)

1. Run the human-vs-human regression smoke test before gameplay changes.
2. Phase 7 polish: sound effects → map editor → campaign mode → production
   deployment.
3. Documentation: replace `README.md`'s stale roadmap with `README2.md` /
   this file when ready.

## Key conventions

- **Hex coordinates:** Flat-top, odd-q vertical offset (matches printed BT maps)
- **Hex codes:** 2-digit col + 2-digit row (e.g., "0304")
- **Facing:** 0–300° in 60° increments, mapped to axial neighbor vectors
- **Unit data:** Hand-entered stat blocks + MegaMek-derived records (CC BY-NC-SA 4.0)
- **AI model:** AI is a `btech_players` row with `is_ai = true`, `user_id = NULL`
  (no fake UUIDs) — see `AI_PLAYER_DATABASE.md`
- **Phase order:** Initiative → Movement → Reaction → Weapon Attack → Physical Attack → Heat → End

## Pitfalls

- **GitHub Pages rebuild delay:** After pushing, the live site takes 30–60s to
  rebuild. Verify with
  `curl -s https://raw.githubusercontent.com/gclawmax/BTechVTT/main/index.html`
  before assuming the live page is stale.
- **Armor diagram layout:** 3×3 grid — LA HD RA / LT CT RT / LL (empty) RL.
  Head centered top, legs on bottom corners.
- **Rules migrations:** Client JS and SQL must stay in parity; use the safe
  migration patching approach from the `e7a8a33`/`a682f78` commits when touching
  hit-location or to-hit rules.
- **Supabase SQL Editor size limit:** Large catalogue imports are split into
  `local-data/*.sql.parts` for manual execution.
