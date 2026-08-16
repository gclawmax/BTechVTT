-- Advance past Physical Attack only when no living opposing pair is adjacent.
-- Any participant may request the check; the database owns the decision.

CREATE OR REPLACE FUNCTION public.skip_empty_physical_phase(p_game_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_game btech_games%ROWTYPE; v_state jsonb; v_first_player uuid; v_has_adjacent boolean;
BEGIN
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.current_phase <> 'physical_attack' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only a game participant may check the Physical Attack phase';
  END IF;
  v_state := CASE jsonb_typeof(v_game.state)
    WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb)
    WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) a,
         jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) b
    WHERE (a->>'owner')::integer <> (b->>'owner')::integer
      AND NOT COALESCE((a->>'destroyed')::boolean, false)
      AND NOT COALESCE((b->>'destroyed')::boolean, false)
      AND GREATEST(
        abs(((a->>'col')::integer - (((a->>'row')::integer - ((a->>'row')::integer % 2)) / 2)) - ((b->>'col')::integer - (((b->>'row')::integer - ((b->>'row')::integer % 2)) / 2))),
        abs((a->>'row')::integer - (b->>'row')::integer),
        abs(-((a->>'col')::integer - (((a->>'row')::integer - ((a->>'row')::integer % 2)) / 2)) - (a->>'row')::integer + ((b->>'col')::integer - (((b->>'row')::integer - ((b->>'row')::integer % 2)) / 2)) + (b->>'row')::integer)
      ) = 1
  ) INTO v_has_adjacent;
  IF v_has_adjacent THEN RETURN false; END IF;
  SELECT (v_state->'initiative_order'->0->>'player_id')::uuid INTO v_first_player;
  v_state := jsonb_set(v_state, '{mech_instances}', (
    SELECT jsonb_agg(jsonb_set(value, '{hasManagedHeat}', 'false'::jsonb, true))
    FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value
  ), true);
  v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb(v_first_player), true);
  UPDATE btech_games SET current_phase = 'heat', active_player_id = v_first_player, state = v_state WHERE id = p_game_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.skip_empty_physical_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skip_empty_physical_phase(uuid) TO authenticated;
