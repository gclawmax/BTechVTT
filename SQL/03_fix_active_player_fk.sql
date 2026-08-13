-- BTech VTT: active player is a btech_players row, not an auth user.
-- Safe for the current model: both columns are UUID and active_player_id
-- is nullable during Initiative/End-of-round.

ALTER TABLE btech_games
DROP CONSTRAINT IF EXISTS btech_games_active_player_id_fkey;

ALTER TABLE btech_games
ADD CONSTRAINT btech_games_active_player_id_fkey
FOREIGN KEY (active_player_id)
REFERENCES btech_players(id) ON DELETE SET NULL;
