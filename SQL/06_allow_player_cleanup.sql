-- BTech VTT: a player may leave a game after winning initiative. Keep the
-- game record, but clear any seat references when that player row is removed.
-- Run once on existing Supabase projects after SQL/03 and SQL/05.

ALTER TABLE btech_games
DROP CONSTRAINT IF EXISTS btech_games_active_player_id_fkey;

ALTER TABLE btech_games
ADD CONSTRAINT btech_games_active_player_id_fkey
FOREIGN KEY (active_player_id)
REFERENCES btech_players(id) ON DELETE SET NULL;

ALTER TABLE btech_games
DROP CONSTRAINT IF EXISTS btech_games_initiative_winner_fkey;

ALTER TABLE btech_games
ADD CONSTRAINT btech_games_initiative_winner_fkey
FOREIGN KEY (initiative_winner)
REFERENCES btech_players(id) ON DELETE SET NULL;
