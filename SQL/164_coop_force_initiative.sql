-- SQL/164 — Coop initiative = ONE ROLL PER FORCE (owner ruling 4 Oct, issue #21).
--
-- The per-seat submit_initiative_roll (SQL/09) stays live and byte-identical for
-- non-coop matches. In coop, each side (force) rolls once; either pilot of the
-- friendly force may roll for the team. When the friendly force submits, the enemy
-- force's roll is generated authoritatively on the server (deterministic
-- 2d6-equivalent split, re-seeded per attempt so ties genuinely re-roll). Ties
-- clear both rolls and require a re-roll. Activation stays seat-ordered inside
-- the force ordering, so the submit_phase_state turn-advancement contract is
-- untouched.

ALTER TABLE public.btech_initiative ADD COLUMN IF NOT EXISTS force_key text;

CREATE UNIQUE INDEX IF NOT EXISTS btech_initiative_force_uidx
  ON public.btech_initiative (game_id, round, force_key)
  WHERE force_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.btech_coop_force_of_seat(p_state jsonb, p_seat int)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    p_state #>> ARRAY['coop','force_of_seat', p_seat::text],
    CASE WHEN p_seat <= 2 THEN 'friendly' ELSE 'enemy' END
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_coop_initiative_roll(
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
  v_my_force text;
  v_enemy_force text;
  v_enemy_roll int;
  v_attempts int;
  v_cnt int;
  v_distinct int;
  v_tie_roll int;
  v_order jsonb;
  v_mechs jsonb;
BEGIN
  IF p_die_a NOT BETWEEN 1 AND 6 OR p_die_b NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Initiative dice must be between 1 and 6';
  END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'in-progress' OR v_game.current_phase <> 'initiative' THEN
    RAISE EXCEPTION 'Initiative is not currently available';
  END IF;
  v_state := CASE jsonb_typeof(v_game.state)
    WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb)
    WHEN 'object' THEN v_game.state
    ELSE '{}'::jsonb END;
  -- Coop-only gate. NOTE: jsonb_typeof(NULL) IS NULL and NULL <> 'object' is NULL
  -- (not TRUE), so without COALESCE the AND collapses to NULL and the IF never
  -- fires — a non-coop game would slip through. Force non-NULL logic.
  IF COALESCE(v_state->>'coop','false') <> 'true'
     AND COALESCE(jsonb_typeof(v_state->'coop'->'force_of_seat'),'null') <> 'object' THEN
    RAISE EXCEPTION 'Per-force initiative is only available in coop matches';
  END IF;
  SELECT * INTO v_player FROM btech_players
   WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a seated pilot may roll initiative'; END IF;
  v_my_force := public.btech_coop_force_of_seat(v_state, v_player.seat_number);
  v_enemy_force := CASE WHEN v_my_force = 'friendly' THEN 'enemy' ELSE 'friendly' END;
  v_attempts := COALESCE((v_state->>'initiative_attempts')::int, 0);

  IF EXISTS (SELECT 1 FROM btech_initiative
             WHERE game_id = p_game_id AND round = v_game.current_round
               AND force_key = v_my_force) THEN
    RAISE EXCEPTION 'Your force has already rolled this round';
  END IF;

  INSERT INTO btech_initiative (game_id, round, player_id, roll, die_a, die_b, force_key)
  VALUES (p_game_id, v_game.current_round, v_player.id,
          p_die_a + p_die_b, p_die_a, p_die_b, v_my_force);

  IF NOT EXISTS (SELECT 1 FROM btech_initiative
                 WHERE game_id = p_game_id AND round = v_game.current_round
                   AND force_key = v_enemy_force) THEN
    v_enemy_roll := 2 + abs(hashtext(p_game_id::text || ':' || v_game.current_round::text
                                      || ':' || (v_attempts + 1)::text)) % 11;
    INSERT INTO btech_initiative (game_id, round, player_id, roll, die_a, die_b, force_key)
    SELECT p_game_id, v_game.current_round, ap.id, v_enemy_roll,
           (v_enemy_roll + 1) / 2, v_enemy_roll - (v_enemy_roll + 1) / 2, v_enemy_force
      FROM btech_players ap
     WHERE ap.game_id = p_game_id AND ap.role = 'player'
       AND public.btech_coop_force_of_seat(v_state, ap.seat_number) = v_enemy_force
     ORDER BY ap.seat_number LIMIT 1;
  END IF;

  WITH fr AS (
    SELECT DISTINCT ON (force_key) force_key, roll
    FROM btech_initiative
    WHERE game_id = p_game_id AND round = v_game.current_round AND force_key IS NOT NULL
    ORDER BY force_key, roll DESC
  )
  SELECT count(*), count(DISTINCT roll) INTO v_cnt, v_distinct FROM fr;

  IF v_cnt < 2 THEN
    RETURN jsonb_build_object('status','waiting');
  END IF;

  IF v_distinct < 2 THEN
    SELECT max(roll) INTO v_tie_roll FROM btech_initiative
     WHERE game_id = p_game_id AND round = v_game.current_round AND force_key IS NOT NULL;
    DELETE FROM btech_initiative
     WHERE game_id = p_game_id AND round = v_game.current_round;
    v_state := jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true);
    v_state := jsonb_set(v_state, '{initiative_attempts}', to_jsonb(v_attempts + 1), true);
    UPDATE btech_games SET state = v_state WHERE id = p_game_id;
    RETURN jsonb_build_object('status','tie',
      'summary','Both forces rolled ' || v_tie_roll || '. Re-roll required.');
  END IF;

  WITH fr AS (
    SELECT DISTINCT ON (force_key) force_key, roll, die_a, die_b
    FROM btech_initiative
    WHERE game_id = p_game_id AND round = v_game.current_round AND force_key IS NOT NULL
    ORDER BY force_key, roll DESC
  )
  SELECT jsonb_agg(jsonb_build_object(
           'player_id', p.id, 'roll', fr.roll, 'die_a', fr.die_a, 'die_b', fr.die_b,
           'seat_number', p.seat_number, 'is_ai', p.is_ai, 'force_key', fr.force_key)
         ORDER BY fr.roll ASC, p.seat_number ASC)
    INTO v_order
  FROM btech_players p
  JOIN fr ON fr.force_key = public.btech_coop_force_of_seat(v_state, p.seat_number)
  WHERE p.game_id = p_game_id AND p.role = 'player';

  v_state := jsonb_set(v_state, '{initiative_order}', v_order, true);
  v_state := jsonb_set(v_state, '{initiative_rolls}', v_order, true);
  v_state := jsonb_set(v_state, '{initiative_round}', to_jsonb(v_game.current_round), true);
  v_state := jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true);
  v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb((v_order->0->>'player_id')::uuid), true);
  SELECT jsonb_agg(jsonb_set(jsonb_set(value, '{hasMoved}', 'false'::jsonb, true),
                             '{torsoFacing}', COALESCE(value->'facing', '0'::jsonb), true))
    INTO v_mechs
  FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value;
  v_state := jsonb_set(v_state, '{mech_instances}', COALESCE(v_mechs, '[]'::jsonb), true);

  UPDATE btech_games
     SET current_phase = 'movement',
         active_player_id = (v_order->0->>'player_id')::uuid,
         initiative_winner = (v_order->(jsonb_array_length(v_order)-1)->>'player_id')::uuid,
         state = v_state
   WHERE id = p_game_id;

  RETURN jsonb_build_object('status','resolved',
    'summary', (SELECT string_agg('S' || (e->>'seat_number') || '=' || (e->>'die_a') || ' + ' || (e->>'die_b') || ' = ' || (e->>'roll'), ', ')
                FROM jsonb_array_elements(v_order) e));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_coop_initiative_roll(uuid, smallint, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_coop_initiative_roll(uuid, smallint, smallint) TO authenticated;
REVOKE ALL ON FUNCTION public.btech_coop_force_of_seat(jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_coop_force_of_seat(jsonb, int) TO authenticated;
