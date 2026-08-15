-- Server-side combat dice. The first caller resolves a declared combat event;
-- row locking makes subsequent calls return the same immutable result.

ALTER TABLE public.btech_combat_events
  DROP CONSTRAINT IF EXISTS btech_combat_events_status_check;
ALTER TABLE public.btech_combat_events
  ADD CONSTRAINT btech_combat_events_status_check
  CHECK (status IN ('declared', 'rolled', 'resolved', 'rejected'));

CREATE OR REPLACE FUNCTION public.resolve_combat_roll(
  p_game_id uuid,
  p_combat_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event btech_combat_events%ROWTYPE;
  v_game btech_games%ROWTYPE;
  v_player btech_players%ROWTYPE;
  v_die_a smallint;
  v_die_b smallint;
  v_resolution jsonb;
BEGIN
  SELECT * INTO v_event FROM btech_combat_events
    WHERE id = p_combat_event_id AND game_id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Combat declaration was not found'; END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id;
  SELECT * INTO v_player FROM btech_players
    WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND OR v_player.id <> v_event.player_id THEN
    RAISE EXCEPTION 'Only the declaring player may resolve this combat event';
  END IF;
  IF v_event.status IN ('rolled', 'resolved') THEN RETURN v_event.resolution; END IF;
  IF v_event.status <> 'declared' THEN RAISE EXCEPTION 'Combat event cannot be resolved'; END IF;
  IF v_game.current_round <> v_event.round OR v_game.current_phase <> v_event.phase THEN
    RAISE EXCEPTION 'Combat event is no longer in the active phase';
  END IF;
  v_die_a := floor(random() * 6 + 1)::smallint;
  v_die_b := floor(random() * 6 + 1)::smallint;
  v_resolution := jsonb_build_object(
    'server_rolls', jsonb_build_object(
      'to_hit', jsonb_build_object('die_a', v_die_a, 'die_b', v_die_b, 'total', v_die_a + v_die_b)
    ),
    'rules_status', 'pending_rules_resolution'
  );
  UPDATE btech_combat_events
  SET status = 'rolled', resolution = v_resolution
  WHERE id = v_event.id;
  RETURN v_resolution;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_combat_roll(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_combat_roll(uuid, uuid) TO authenticated;
