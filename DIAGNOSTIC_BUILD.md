# BTech VTT Diagnostic Build

Build: 20260812-diagnostic-01

Purpose: diagnose the Supabase `No API key found` request and prevent phase/lobby state from being obscured by automatic navigation.

Important: this build keeps `btech_games.active_player_id` compatible with its current FK to `auth.users(id)`. The local/state active player is stored as `state.active_player_player_id`, referencing the `btech_players.id` represented in initiative_order.
