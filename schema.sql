-- ============================================================================
-- BTechVTT Database Schema
-- ============================================================================
-- Run this in Supabase SQL Editor:
--   https://app.supabase.com/project/ffztxyeevdqlhvxzcopn/sql
-- ============================================================================

-- 1. Profiles table (BTech-specific user accounts)
--    Links auth.users to BTech profile data
CREATE TABLE IF NOT EXISTS btech_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Games table (game sessions)
CREATE TABLE IF NOT EXISTS btech_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_code TEXT NOT NULL UNIQUE,
  state JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'in-progress', 'finished')),
  current_round INT NOT NULL DEFAULT 1,
  current_phase TEXT NOT NULL DEFAULT 'initiative' CHECK (current_phase IN ('initiative', 'movement', 'weapon_attack', 'physical_attack', 'heat', 'end')),
  active_player_id UUID REFERENCES btech_players(id),
  initiative_winner UUID REFERENCES btech_players(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Players table (player seats + spectators)
CREATE TABLE IF NOT EXISTS btech_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seat_number INT CHECK (seat_number BETWEEN 1 AND 4),
  player_color TEXT,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'spectator')),
  ready BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Turn plans (per-turn planning)
CREATE TABLE IF NOT EXISTS btech_turn_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  turn_number INT NOT NULL,
  player_id UUID REFERENCES btech_players(id) ON DELETE CASCADE NOT NULL,
  plan JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Game events (event log)
CREATE TABLE IF NOT EXISTS btech_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  turn_number INT NOT NULL,
  event JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_btech_games_host_id ON btech_games(host_id);
CREATE INDEX IF NOT EXISTS idx_btech_games_game_code ON btech_games(game_code);
CREATE INDEX IF NOT EXISTS idx_btech_games_status ON btech_games(status);

CREATE INDEX IF NOT EXISTS idx_btech_players_game_id ON btech_players(game_id);
CREATE INDEX IF NOT EXISTS idx_btech_players_user_id ON btech_players(user_id);
CREATE INDEX IF NOT EXISTS idx_btech_players_seat ON btech_players(game_id, seat_number);

CREATE INDEX IF NOT EXISTS idx_btech_turn_plans_game_id ON btech_turn_plans(game_id);
CREATE INDEX IF NOT EXISTS idx_btech_turn_plans_player ON btech_turn_plans(player_id);

CREATE INDEX IF NOT EXISTS idx_btech_events_game_id ON btech_events(game_id);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Profiles: users can read/write their own profile
ALTER TABLE btech_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON btech_profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON btech_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON btech_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Games: anyone can read, only host can update/delete
ALTER TABLE btech_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view games"
  ON btech_games FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create games"
  ON btech_games FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Host can update their game"
  ON btech_games FOR UPDATE
  USING (auth.uid() = host_id);

CREATE POLICY "Host can delete their game"
  ON btech_games FOR DELETE
  USING (auth.uid() = host_id);

-- Players: anyone in a game can read, players manage their own seat
ALTER TABLE btech_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view players in a game"
  ON btech_players FOR SELECT
  USING (true);

CREATE POLICY "Players can insert themselves"
  ON btech_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can update their own seat"
  ON btech_players FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Players can delete their own seat"
  ON btech_players FOR DELETE
  USING (auth.uid() = user_id);

-- Turn plans: participants can read/write
ALTER TABLE btech_turn_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view turn plans"
  ON btech_turn_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM btech_players
      WHERE btech_players.game_id = btech_turn_plans.game_id
    )
  );

CREATE POLICY "Players can insert their own plan"
  ON btech_turn_plans FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM btech_players WHERE id = player_id));

CREATE POLICY "Players can update their own plan"
  ON btech_turn_plans FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM btech_players WHERE id = player_id));

-- Events: anyone can read, only the game host can write
ALTER TABLE btech_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view events"
  ON btech_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM btech_games
      WHERE btech_games.id = btech_events.game_id
    )
  );

CREATE POLICY "Host can insert events"
  ON btech_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM btech_games
      WHERE btech_games.id = btech_events.game_id
      AND btech_games.host_id = auth.uid()
    )
  );

-- ============================================================================
-- Realtime
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE btech_games;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_players;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_turn_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_events;
