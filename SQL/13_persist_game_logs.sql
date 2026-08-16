-- Store player-visible log entries independently of btech_games.state.
-- Server stamps the entry with authoritative phase/round and caller identity.

CREATE OR REPLACE FUNCTION public.append_game_log(p_game_id uuid, p_entry jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_game btech_games%ROWTYPE; v_player btech_players%ROWTYPE; v_entry jsonb;
BEGIN
  IF jsonb_typeof(p_entry) <> 'object' OR length(COALESCE(p_entry->>'msg', '')) = 0
     OR length(COALESCE(p_entry->>'msg', '')) > 2000
     OR COALESCE(p_entry->>'cat', '') NOT IN ('system','phase','roll','move','attack','error','info') THEN
    RAISE EXCEPTION 'Invalid game log entry';
  END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id;
  SELECT * INTO v_player FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a game participant may append a log entry'; END IF;
  v_entry := jsonb_build_object('id', COALESCE(p_entry->>'id', gen_random_uuid()::text),
    'ts', floor(extract(epoch FROM clock_timestamp()) * 1000), 'time', to_char(clock_timestamp(), 'HH24:MI:SS'),
    'round', v_game.current_round, 'phase', v_game.current_phase, 'cat', p_entry->>'cat',
    'msg', p_entry->>'msg', 'author_player_id', v_player.id);
  INSERT INTO btech_events (game_id, round, event) VALUES (p_game_id, v_game.current_round, v_entry);
END; $$;

REVOKE ALL ON FUNCTION public.append_game_log(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_game_log(uuid, jsonb) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'btech_events') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.btech_events;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.btech_events;
