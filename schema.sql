-- ============================================================================
-- BTechVTT Database Schema  (Classic BattleTech — Initiative / I-Go-U-Go)
-- ============================================================================
-- Run this in Supabase SQL Editor:
--   https://app.supabase.com/project/ffztxyeevdqlhvxzcopn/sql
--
-- Identity: shared with Ironfield/Bandit Cards via the existing `profiles`
-- table (profiles.id = auth.users.id). No BTech-specific profile table —
-- one callsign across all games. If BTech ever needs its own fields
-- (e.g. faction), add nullable columns to `profiles`, don't fork a new table.
--
-- Turn model: IGOUGO. Matches the app's current_round/current_phase/
-- active_player_id/advancePhase() logic. Individual unit actions are
-- logged one at a time in btech_actions (round, phase, sequence) rather
-- than as one big per-turn plan blob (that was the WeGo/Ironfield shape).
-- ============================================================================

-- 1. Players table (player seats + spectators)
--    Created before btech_games so btech_games can FK into it.
CREATE TABLE IF NOT EXISTS btech_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL,   -- FK added after btech_games exists (see below)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seat_number INT CHECK (seat_number BETWEEN 1 AND 4),
  player_color TEXT,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'spectator')),
  ready BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (game_id, user_id)
);

-- 2. Games table (game sessions)
CREATE TABLE IF NOT EXISTS btech_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  game_code TEXT NOT NULL UNIQUE,
  state JSONB DEFAULT '{}',                 -- units, map, everything not phase/turn bookkeeping
  status TEXT NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'in-progress', 'finished')),

  -- ── Round / phase tracking (IGOUGO) ─────────────────────────────
  current_round INT NOT NULL DEFAULT 1,
  current_phase TEXT NOT NULL DEFAULT 'initiative'
    CHECK (current_phase IN (
      'initiative', 'movement', 'weapon_attack', 'physical_attack', 'heat', 'end'
    )),
  -- Which SEAT (btech_players.id) is "on the clock" right now within the
  -- current phase. References the seat, not auth.users, because that's
  -- what the app's profiles(username) lookups key off.
  active_player_id UUID REFERENCES btech_players(id),
  -- Winner of this round's initiative roll (also a seat id).
  initiative_winner UUID REFERENCES btech_players(id),

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Now that btech_games exists, wire up the game_id FK on btech_players.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'btech_players_game_id_fkey') THEN
    ALTER TABLE btech_players
      ADD CONSTRAINT btech_players_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES btech_games(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Initiative rolls — one row per player per round.
--    Kept as its own table so ties, re-rolls, and history are queryable
--    without fighting over the state JSONB blob.
CREATE TABLE IF NOT EXISTS btech_initiative (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  round INT NOT NULL,
  player_id UUID REFERENCES btech_players(id) ON DELETE CASCADE NOT NULL,
  roll NUMERIC NOT NULL,          -- e.g. 2d6, or your die + seat-tiebreak scheme
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (game_id, round, player_id)
);

-- 4. Actions — one row per individual unit action within a phase.
--    `sequence` orders actions within (round, phase) for replay and for
--    determining whose turn it is next.
CREATE TABLE IF NOT EXISTS btech_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  round INT NOT NULL,
  phase TEXT NOT NULL
    CHECK (phase IN ('movement', 'weapon_attack', 'physical_attack', 'heat', 'end')),
  sequence INT NOT NULL,
  player_id UUID REFERENCES btech_players(id) ON DELETE CASCADE NOT NULL,
  unit_id TEXT,                   -- id of the unit acting, if applicable
  action_type TEXT NOT NULL,      -- e.g. 'move', 'declare_target', 'fire', 'physical', 'pass'
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (game_id, round, phase, sequence)
);

-- 5. Game events (event log)
CREATE TABLE IF NOT EXISTS btech_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES btech_games(id) ON DELETE CASCADE NOT NULL,
  round INT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_btech_initiative_game_round ON btech_initiative(game_id, round);

CREATE INDEX IF NOT EXISTS idx_btech_actions_game_round_phase ON btech_actions(game_id, round, phase);
CREATE INDEX IF NOT EXISTS idx_btech_actions_player ON btech_actions(player_id);

CREATE INDEX IF NOT EXISTS idx_btech_events_game_id ON btech_events(game_id);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Games: anyone can read, only host can update/delete
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'btech_games' AND rowsecurity = true) THEN
    ALTER TABLE btech_games ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view games" ON btech_games;
CREATE POLICY "Anyone can view games"
  ON btech_games FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can create games" ON btech_games;
CREATE POLICY "Authenticated users can create games"
  ON btech_games FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Host can update their game" ON btech_games;
CREATE POLICY "Host can update their game"
  ON btech_games FOR UPDATE
  USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "Host can delete their game" ON btech_games;
CREATE POLICY "Host can delete their game"
  ON btech_games FOR DELETE
  USING (auth.uid() = host_id);

-- Players: anyone in a game can read, players manage their own seat
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'btech_players' AND rowsecurity = true) THEN
    ALTER TABLE btech_players ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view players in a game" ON btech_players;
CREATE POLICY "Anyone can view players in a game"
  ON btech_players FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Players can insert themselves" ON btech_players;
CREATE POLICY "Players can insert themselves"
  ON btech_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Players can update their own seat" ON btech_players;
CREATE POLICY "Players can update their own seat"
  ON btech_players FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Players can delete their own seat" ON btech_players;
CREATE POLICY "Players can delete their own seat"
  ON btech_players FOR DELETE
  USING (auth.uid() = user_id);

-- Initiative: participants (checked against auth.uid(), not just "a" player)
-- can read; a player can only insert/update their own roll.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'btech_initiative' AND rowsecurity = true) THEN
    ALTER TABLE btech_initiative ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Participants can view initiative rolls" ON btech_initiative;
CREATE POLICY "Participants can view initiative rolls"
  ON btech_initiative FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM btech_players
      WHERE btech_players.game_id = btech_initiative.game_id
      AND btech_players.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Players can insert their own initiative roll" ON btech_initiative;
CREATE POLICY "Players can insert their own initiative roll"
  ON btech_initiative FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM btech_players WHERE id = player_id));

DROP POLICY IF EXISTS "Players can update their own initiative roll" ON btech_initiative;
CREATE POLICY "Players can update their own initiative roll"
  ON btech_initiative FOR UPDATE
  USING (auth.uid() IN (SELECT user_id FROM btech_players WHERE id = player_id));

-- Actions: same participant-scoped read; players write only their own actions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'btech_actions' AND rowsecurity = true) THEN
    ALTER TABLE btech_actions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Participants can view actions" ON btech_actions;
CREATE POLICY "Participants can view actions"
  ON btech_actions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM btech_players
      WHERE btech_players.game_id = btech_actions.game_id
      AND btech_players.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Players can insert their own actions" ON btech_actions;
CREATE POLICY "Players can insert their own actions"
  ON btech_actions FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT user_id FROM btech_players WHERE id = player_id));

-- Events: participants can read, only the game host can write
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'btech_events' AND rowsecurity = true) THEN
    ALTER TABLE btech_events ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS "Participants can view events" ON btech_events;
CREATE POLICY "Participants can view events"
  ON btech_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM btech_players
      WHERE btech_players.game_id = btech_events.game_id
      AND btech_players.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Host can insert events" ON btech_events;
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

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_games') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE btech_games;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_games;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_players') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE btech_players;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_players;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_initiative') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE btech_initiative;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_initiative;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_actions') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE btech_actions;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_actions;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_events') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE btech_events;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE btech_events;
