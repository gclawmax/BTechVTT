# BTech VTT — Diagnostic Build

Build: 20260812-diagnostic-01

This build keeps the existing database relationship:

- `btech_players.user_id` = authenticated user's UUID for humans.
- AI `btech_players.user_id` = NULL and `is_ai = true`.
- `btech_games.active_player_id` = authenticated user's UUID, because the existing FK references `auth.users(id)`.
- `btech_games.state.active_player_player_id` = `btech_players.id` for the active seat, including the AI.
- `initiative_order` contains `btech_players.id` records plus `user_id`/`is_ai`.

No additional SQL migration is required for this build.

The build also cache-busts all JS files, reports any Supabase REST request that leaves this build without an `apikey` header, and does not automatically navigate back to the lobby when a game status changes. A database status change is logged instead for diagnosis.

Current phase order:

Initiative → Movement → Reaction → Weapon Attack → Physical Attack → Heat → End
