-- Allow each authenticated player to update only their own pre-game roster.
-- This keeps the normal btech_games host-only UPDATE policy intact, so a
-- player cannot alter the map, phase, turn state, or the other player's roster.

CREATE OR REPLACE FUNCTION public.update_lobby_roster(
  p_game_id uuid,
  p_roster jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat_number integer;
BEGIN
  IF jsonb_typeof(p_roster) <> 'array'
     OR jsonb_array_length(p_roster) > 6
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_roster) AS entry(value)
       WHERE jsonb_typeof(entry.value) <> 'string'
     ) THEN
    RAISE EXCEPTION 'Roster must be an array of at most six unit IDs';
  END IF;

  SELECT seat_number
  INTO v_seat_number
  FROM btech_players
  WHERE game_id = p_game_id
    AND user_id = auth.uid()
    AND role = 'player'
    AND seat_number IS NOT NULL;

  IF v_seat_number IS NULL THEN
    RAISE EXCEPTION 'Only a seated player may update a roster';
  END IF;

  UPDATE btech_games
  SET state = jsonb_set(
    COALESCE(state, '{}'::jsonb),
    ARRAY['rosters', v_seat_number::text],
    p_roster,
    true
  )
  WHERE id = p_game_id
    AND status = 'lobby';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster updates are available only while the game is in the lobby';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_lobby_roster(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lobby_roster(uuid, jsonb) TO authenticated;
