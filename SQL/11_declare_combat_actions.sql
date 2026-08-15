-- Accept a combat declaration only from the player currently taking the
-- Weapon or Physical Attack turn. This does not resolve dice or damage yet;
-- it creates the immutable input for the authoritative resolver.

CREATE OR REPLACE FUNCTION public.declare_combat_action(
  p_game_id uuid,
  p_attacker_instance_id text,
  p_target_instance_id text,
  p_declaration jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game btech_games%ROWTYPE;
  v_player btech_players%ROWTYPE;
  v_state jsonb;
  v_attacker jsonb;
  v_target jsonb;
  v_sequence integer;
  v_event_id uuid;
BEGIN
  IF jsonb_typeof(p_declaration) <> 'object' THEN
    RAISE EXCEPTION 'Combat declaration must be an object';
  END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status <> 'in-progress'
     OR v_game.current_phase NOT IN ('weapon_attack', 'physical_attack') THEN
    RAISE EXCEPTION 'Combat declarations are not available in this phase';
  END IF;
  SELECT * INTO v_player FROM btech_players
    WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND OR v_game.active_player_id IS DISTINCT FROM v_player.id THEN
    RAISE EXCEPTION 'It is not your combat turn';
  END IF;
  v_state := CASE jsonb_typeof(v_game.state)
    WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb)
    WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
  SELECT value INTO v_attacker FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value
    WHERE value->>'instanceId' = p_attacker_instance_id;
  IF p_target_instance_id IS NOT NULL THEN
    SELECT value INTO v_target FROM jsonb_array_elements(COALESCE(v_state->'mech_instances', '[]'::jsonb)) value
      WHERE value->>'instanceId' = p_target_instance_id;
  END IF;
  IF v_attacker IS NULL OR (v_attacker->>'owner')::integer <> v_player.seat_number
     OR COALESCE((v_attacker->>'destroyed')::boolean, false) THEN
    RAISE EXCEPTION 'Attacker must be one of your active units';
  END IF;
  IF p_target_instance_id IS NOT NULL AND (v_target IS NULL OR (v_target->>'owner')::integer = v_player.seat_number
     OR COALESCE((v_target->>'destroyed')::boolean, false)) THEN
    RAISE EXCEPTION 'Target must be an active opposing unit';
  END IF;
  IF v_game.current_phase = 'weapon_attack'
     AND jsonb_typeof(COALESCE(p_declaration->'weapon_mounts', 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Weapon declarations require weapon_mounts';
  END IF;
  IF v_game.current_phase = 'weapon_attack'
     AND jsonb_array_length(p_declaration->'weapon_mounts') > 0
     AND p_target_instance_id IS NULL THEN
    RAISE EXCEPTION 'Weapon declarations with mounts require a target';
  END IF;
  IF v_game.current_phase = 'physical_attack'
     AND COALESCE(p_declaration->>'attack_type', '') NOT IN ('punch', 'kick', 'pass') THEN
    RAISE EXCEPTION 'Physical declarations require punch, kick, or pass';
  END IF;
  IF v_game.current_phase = 'physical_attack'
     AND COALESCE(p_declaration->>'attack_type', '') IN ('punch', 'kick')
     AND p_target_instance_id IS NULL THEN
    RAISE EXCEPTION 'Physical attacks require a target';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO v_sequence
    FROM btech_combat_events
    WHERE game_id = p_game_id AND round = v_game.current_round AND phase = v_game.current_phase;
  INSERT INTO btech_combat_events (
    game_id, round, phase, sequence, player_id, attacker_instance_id,
    target_instance_id, declaration
  ) VALUES (
    p_game_id, v_game.current_round, v_game.current_phase, v_sequence,
    v_player.id, p_attacker_instance_id, p_target_instance_id, p_declaration
  ) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.declare_combat_action(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_combat_action(uuid, text, text, jsonb) TO authenticated;
