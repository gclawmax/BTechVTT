-- Total Warfare authoritative-combat foundation.
-- Combat declarations/results are durable server records. There is purposely
-- no browser write policy: a later SECURITY DEFINER resolver will validate a
-- declaration, roll dice, consume ammunition, and write its resolution.

CREATE TABLE IF NOT EXISTS public.btech_combat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES public.btech_games(id) ON DELETE CASCADE NOT NULL,
  round integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('weapon_attack', 'physical_attack')),
  sequence integer NOT NULL,
  player_id uuid REFERENCES public.btech_players(id) ON DELETE CASCADE NOT NULL,
  attacker_instance_id text NOT NULL,
  target_instance_id text,
  declaration jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution jsonb,
  status text NOT NULL DEFAULT 'declared' CHECK (status IN ('declared', 'resolved', 'rejected')),
  declared_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (game_id, round, phase, sequence)
);

CREATE INDEX IF NOT EXISTS idx_btech_combat_events_game_round
  ON public.btech_combat_events(game_id, round, phase, sequence);

ALTER TABLE public.btech_combat_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants can view combat events" ON public.btech_combat_events;
CREATE POLICY "Participants can view combat events"
  ON public.btech_combat_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.btech_players
    WHERE btech_players.game_id = btech_combat_events.game_id
      AND btech_players.user_id = auth.uid()
  ));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_combat_events') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.btech_combat_events;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.btech_combat_events;
