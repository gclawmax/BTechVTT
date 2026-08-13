-- BTech VTT: initiative_winner records a btech_players seat id, not auth.users.
-- Run once against existing Supabase projects created before this relationship changed.

ALTER TABLE btech_games
DROP CONSTRAINT IF EXISTS btech_games_initiative_winner_fkey;

ALTER TABLE btech_games
ADD CONSTRAINT btech_games_initiative_winner_fkey
FOREIGN KEY (initiative_winner)
REFERENCES btech_players(id);
