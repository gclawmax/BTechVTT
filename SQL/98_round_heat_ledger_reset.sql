-- Promote post-sink heat into the next round and clear the previous round's
-- movement/weapon/external ledgers when Initiative resolves.
-- Run after the complete SQL 97 catalogue batch.

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
  v_instances jsonb;
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
  SELECT jsonb_agg(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      value,
      '{roundStartingHeat}', to_jsonb(COALESCE((value->>'heat')::int, 0)), true),
      '{movementHeat}', '0'::jsonb, true),
      '{weaponHeat}', '0'::jsonb, true),
      '{externalHeat}', '0'::jsonb, true),
      '{pendingTerrainHeat}', '0'::jsonb, true),
      '{heatDissipated}', '0'::jsonb, true),
      '{hasMoved}', 'false'::jsonb, true),
      '{torsoFacing}', COALESCE(value->'facing', '0'::jsonb), true)
  ) INTO v_instances FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value;
  v_state := jsonb_set(v_state, '{mech_instances}', COALESCE(v_instances, '[]'::jsonb), true);
  UPDATE btech_games SET current_phase = 'movement', active_player_id = (v_order->0->>'player_id')::uuid,
    initiative_winner = (v_order->(jsonb_array_length(v_order)-1)->>'player_id')::uuid, state = v_state WHERE id = p_game_id;
  RETURN jsonb_build_object('status', 'resolved', 'summary', (SELECT string_agg('P' || (entry->>'seat_number') || '=' || (entry->>'die_a') || ' + ' || (entry->>'die_b') || ' = ' || (entry->>'roll'), ', ') FROM jsonb_array_elements(v_order) entry));
END; $$;

REVOKE ALL ON FUNCTION public.submit_initiative_roll(uuid, smallint, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_initiative_roll(uuid, smallint, smallint) TO authenticated;

-- Safe repair for matches that have not yet begun Movement in their current
-- round. Once a unit has moved, its pre-movement thermal baseline cannot be
-- reconstructed exactly, so this deliberately leaves such matches alone.
DO $$
DECLARE game_row record;st jsonb;units jsonb;
BEGIN
 FOR game_row IN SELECT id,state FROM btech_games WHERE status='in-progress' AND current_phase IN ('initiative','movement') FOR UPDATE LOOP
  st:=CASE jsonb_typeof(game_row.state) WHEN 'string' THEN (game_row.state#>>'{}')::jsonb ELSE game_row.state END;
  IF game_row.id IS NULL OR jsonb_typeof(st->'mech_instances')<>'array' THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(st->'mech_instances') unit WHERE coalesce((unit->>'hasMoved')::boolean,false)) THEN CONTINUE;END IF;
  SELECT jsonb_agg(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    unit,'{roundStartingHeat}',to_jsonb(coalesce((unit->>'heat')::int,0)),true),
    '{movementHeat}','0'::jsonb,true),'{weaponHeat}','0'::jsonb,true),
    '{externalHeat}','0'::jsonb,true),'{pendingTerrainHeat}','0'::jsonb,true),
    '{heatDissipated}','0'::jsonb,true)) INTO units FROM jsonb_array_elements(st->'mech_instances') unit;
  UPDATE btech_games SET state=jsonb_set(st,'{mech_instances}',coalesce(units,'[]'::jsonb),true) WHERE id=game_row.id;
 END LOOP;
END $$;
