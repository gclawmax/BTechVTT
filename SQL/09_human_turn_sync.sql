-- Human-v-human game flow: each player rolls their own initiative, and each
-- active seat can save only its own 'Mechs.  These RPCs keep the authoritative
-- game record synchronized without granting players unrestricted game updates.

ALTER TABLE public.btech_initiative ADD COLUMN IF NOT EXISTS die_a smallint;
ALTER TABLE public.btech_initiative ADD COLUMN IF NOT EXISTS die_b smallint;

CREATE OR REPLACE FUNCTION public.submit_initiative_roll(
  p_game_id uuid,
  p_die_a smallint,
  p_die_b smallint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game btech_games%ROWTYPE;
  v_player btech_players%ROWTYPE;
  v_state jsonb;
  v_rolls jsonb;
  v_order jsonb;
  v_tied boolean;
BEGIN
  IF p_die_a NOT BETWEEN 1 AND 6 OR p_die_b NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'Initiative dice must be between 1 and 6'; END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'in-progress' OR v_game.current_phase <> 'initiative' THEN RAISE EXCEPTION 'Initiative is not currently available'; END IF;
  SELECT * INTO v_player FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a seated player may roll initiative'; END IF;
  INSERT INTO btech_initiative (game_id, round, player_id, roll, die_a, die_b)
  VALUES (p_game_id, v_game.current_round, v_player.id, p_die_a + p_die_b, p_die_a, p_die_b)
  ON CONFLICT (game_id, round, player_id) DO UPDATE SET roll = EXCLUDED.roll, die_a = EXCLUDED.die_a, die_b = EXCLUDED.die_b, created_at = now();
  SELECT jsonb_agg(jsonb_build_object('player_id', i.player_id, 'roll', i.roll, 'die_a', i.die_a, 'die_b', i.die_b, 'seat_number', p.seat_number, 'is_ai', p.is_ai) ORDER BY i.roll ASC)
    INTO v_rolls FROM btech_initiative i JOIN btech_players p ON p.id = i.player_id
    WHERE i.game_id = p_game_id AND i.round = v_game.current_round;
  v_state := CASE jsonb_typeof(v_game.state) WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb) WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
  IF jsonb_array_length(COALESCE(v_rolls, '[]'::jsonb)) < 2 THEN
    UPDATE btech_games SET state = jsonb_set(v_state, '{initiative_pending}', COALESCE(v_rolls, '[]'::jsonb), true) WHERE id = p_game_id;
    RETURN jsonb_build_object('status', 'waiting');
  END IF;
  SELECT count(DISTINCT (entry->>'roll')) < count(*) INTO v_tied FROM jsonb_array_elements(v_rolls) entry;
  IF v_tied THEN
    DELETE FROM btech_initiative WHERE game_id = p_game_id AND round = v_game.current_round;
    UPDATE btech_games SET state = jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true) WHERE id = p_game_id;
    RETURN jsonb_build_object('status', 'tie', 'summary', (SELECT string_agg('P' || (entry->>'seat_number') || '=' || (entry->>'die_a') || ' + ' || (entry->>'die_b') || ' = ' || (entry->>'roll'), ', ') FROM jsonb_array_elements(v_rolls) entry));
  END IF;
  v_order := v_rolls;
  v_state := jsonb_set(v_state, '{initiative_order}', v_order, true);
  v_state := jsonb_set(v_state, '{initiative_rolls}', v_rolls, true);
  v_state := jsonb_set(v_state, '{initiative_round}', to_jsonb(v_game.current_round), true);
  v_state := jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true);
  v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb((v_order->0->>'player_id')::uuid), true);
  -- A fresh round starts with clean movement flags before the first seat acts.
  SELECT jsonb_agg(jsonb_set(jsonb_set(value, '{hasMoved}', 'false'::jsonb, true), '{torsoFacing}', COALESCE(value->'facing', '0'::jsonb), true))
    INTO v_rolls FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value;
  v_state := jsonb_set(v_state, '{mech_instances}', COALESCE(v_rolls, '[]'::jsonb), true);
  UPDATE btech_games SET current_phase = 'movement', active_player_id = (v_order->0->>'player_id')::uuid,
    initiative_winner = (v_order->(jsonb_array_length(v_order)-1)->>'player_id')::uuid, state = v_state WHERE id = p_game_id;
  RETURN jsonb_build_object('status', 'resolved', 'summary', (SELECT string_agg('P' || (entry->>'seat_number') || '=' || (entry->>'die_a') || ' + ' || (entry->>'die_b') || ' = ' || (entry->>'roll'), ', ') FROM jsonb_array_elements(v_order) entry));
END; $$;

CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid, p_mech_instances jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game btech_games%ROWTYPE; v_player btech_players%ROWTYPE; v_state jsonb; v_instances jsonb;
  v_next uuid; v_next_phase text; v_complete boolean;
BEGIN
  IF jsonb_typeof(p_mech_instances) <> 'array' THEN RAISE EXCEPTION 'Mech state must be an array'; END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  SELECT * INTO v_player FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND OR v_game.active_player_id IS DISTINCT FROM v_player.id THEN RAISE EXCEPTION 'It is not your turn'; END IF;
  IF v_game.current_phase NOT IN ('movement','reaction','weapon_attack','physical_attack','heat') THEN RAISE EXCEPTION 'This phase does not accept unit actions'; END IF;
  v_state := CASE jsonb_typeof(v_game.state) WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb) WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
  SELECT COALESCE(jsonb_agg(COALESCE(incoming.value, existing.value)), '[]'::jsonb) INTO v_instances
  FROM jsonb_array_elements(COALESCE(v_state->'mech_instances','[]'::jsonb)) existing(value)
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_mech_instances) value WHERE value->>'instanceId' = existing.value->>'instanceId' AND (value->>'owner')::int = v_player.seat_number LIMIT 1) incoming ON (existing.value->>'owner')::int = v_player.seat_number;
  v_state := jsonb_set(v_state, '{mech_instances}', v_instances, true);
  SELECT CASE v_game.current_phase WHEN 'movement' THEN bool_and(COALESCE((value->>'hasMoved')::boolean,false)) WHEN 'reaction' THEN bool_and(COALESCE((value->>'hasReacted')::boolean,false)) WHEN 'weapon_attack' THEN bool_and(COALESCE((value->>'hasFired')::boolean,false)) WHEN 'physical_attack' THEN bool_and(COALESCE((value->>'hasPhysicalAttacked')::boolean,false)) ELSE bool_and(COALESCE((value->>'hasManagedHeat')::boolean,false)) END INTO v_complete FROM jsonb_array_elements(v_instances) value WHERE (value->>'owner')::int = v_player.seat_number AND COALESCE((value->>'destroyed')::boolean,false) = false;
  IF NOT COALESCE(v_complete, true) THEN UPDATE btech_games SET state = v_state WHERE id = p_game_id; RETURN; END IF;
  SELECT (entry->>'player_id')::uuid INTO v_next FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY ordered(entry, pos) WHERE pos > COALESCE((SELECT pos FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY mine(entry, pos) WHERE mine.entry->>'player_id' = v_player.id::text), 999) ORDER BY pos LIMIT 1;
  IF v_next IS NOT NULL THEN
    v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb(v_next), true);
    UPDATE btech_games SET active_player_id = v_next, state = v_state WHERE id = p_game_id; RETURN;
  END IF;
  v_next_phase := CASE v_game.current_phase WHEN 'movement' THEN 'reaction' WHEN 'reaction' THEN 'weapon_attack' WHEN 'weapon_attack' THEN 'physical_attack' WHEN 'physical_attack' THEN 'heat' ELSE 'initiative' END;
  IF v_next_phase = 'initiative' THEN
    v_state := jsonb_set(v_state, '{initiative_order}', '[]'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_rolls}', '[]'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_round}', 'null'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true);
    SELECT jsonb_agg(jsonb_set(value, '{torsoFacing}', COALESCE(value->'facing', '0'::jsonb), true)) INTO v_instances FROM jsonb_array_elements(v_instances) value;
    v_state := jsonb_set(v_state, '{mech_instances}', COALESCE(v_instances, '[]'::jsonb), true);
    UPDATE btech_games SET current_round = v_game.current_round + 1, current_phase = 'initiative', active_player_id = NULL, initiative_winner = NULL, state = v_state WHERE id = p_game_id;
  ELSE
    SELECT jsonb_agg(CASE v_next_phase WHEN 'reaction' THEN jsonb_set(value,'{hasReacted}','false'::jsonb,true) WHEN 'weapon_attack' THEN jsonb_set(value,'{hasFired}','false'::jsonb,true) WHEN 'physical_attack' THEN jsonb_set(value,'{hasPhysicalAttacked}','false'::jsonb,true) ELSE jsonb_set(value,'{hasManagedHeat}','false'::jsonb,true) END) INTO v_instances FROM jsonb_array_elements(v_instances) value;
    v_state := jsonb_set(v_state, '{mech_instances}', v_instances, true);
    SELECT (v_state->'initiative_order'->0->>'player_id')::uuid INTO v_next;
    v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb(v_next), true);
    UPDATE btech_games SET current_phase = v_next_phase, active_player_id = v_next, state = v_state WHERE id = p_game_id;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.submit_initiative_roll(uuid, smallint, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_initiative_roll(uuid, smallint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid, jsonb) TO authenticated;
