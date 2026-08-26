# Custom map and scenario editor

`SQL/89_custom_map_and_scenario_editor.sql` and
`js/game/scenario-editor.js` add player-created scenarios without bypassing the
normal two-player lobby or authoritative rules.

## Editor scope

- The battlefield remains the VTT's standard 16 × 12 flat-top hex board.
- Authors can paint every supported terrain type and levels 0–3.
- Player 1 and Player 2 deployment zones are explicit, non-overlapping sets of
  hexes. Each side must have at least one passable deployment hex.
- Objective Control scenarios require at least one marked objective.
- Annihilation, Objective Control and Breakthrough use the existing victory
  rules. Breakthrough uses the opponent's authored deployment zone.
- Drafts are browser-local. JSON import/export is available for sharing or
  backup.

## Authoritative snapshot

Launching creates an immutable server record and embeds the same definition in
the match state. Terrain and elevation lookups resolve the immutable custom map
ID, while deployment and victory functions validate the authored zones.
Dynamic terrain changes remain in `terrain_overrides`, exactly as they do on
built-in maps.
