# BTech VTT — Consolidated Build

This build consolidates the latest AI identity, Reaction Phase, Movement Facing, and phase-state synchronisation work.

## Database migration required before testing

The VTT uses `btech_games.active_player_id` as the **active btech_players row ID**. The existing database foreign key incorrectly points to `auth.users(id)`, which causes phase transitions to fail when the VTT writes a `btech_players.id`.

Run `SQL/03_fix_active_player_fk.sql` once in Supabase SQL Editor.

Do not disable RLS.

## Current model

- Human `btech_players.user_id` = authenticated user's UUID.
- AI `btech_players.user_id` = NULL and `is_ai = true`.
- `btech_games.active_player_id` = `btech_players.id`.
- `initiative_order` contains `btech_players.id` values.
- Initiative order is lowest 2D6 roll first.
- Movement and Reaction pass between players in initiative order.

## Current phase order

Initiative → Movement → Reaction → Weapon Attack → Physical Attack → Heat → End

## Testing order

1. Run the SQL migration.
2. Deploy this complete project to GitHub Pages.
3. Log out/in once after the earlier exposed session token.
4. Play vs AI.
5. Roll Initiative.
6. Advance to Movement.
7. Confirm the active player is shown and the Atlas is selectable.
8. Confirm movement works.

Do not troubleshoot Reaction or torso twist until Movement is confirmed working again.
