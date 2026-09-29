-- Run after 159. Coop Skirmish 1-a data model (design doc APPROVED 2026-09-29).
--
-- Two things, one logical unit:
--   1. Extend btech_games.match_type to admit 'coop_skirmish'. The column and
--      its check already exist (SQL/100, values 'skirmish'/'career'); we widen
--      the allowed set. match_type stays NOT NULL DEFAULT 'skirmish', so every
--      existing and future game keeps a valid value.
--   2. public.btech_seat_team(game_id, seat) -- the SINGLE place a seat's side
--      is read. It reads state.team_assignments (written by the creating client
--      at match creation) and FAILS CLOSED: if no assignment is recorded it
--      RAISEs instead of guessing a side. No code path may infer a side from
--      seat-number arithmetic; this is the only reader (decision 1 / design
--      doc section 4).
--
-- Per-unit ownership is intentionally untouched: units already store owner =
-- seat_number, so two humans on team A each own their own units (decision 2).
-- No seat arithmetic anywhere; the field, not the index, decides the side.

DO $$ BEGIN
  -- Drop the existing check (created by SQL/100) if present, then add a
  -- widened one. Re-adding is safe: the new set is a superset, so no existing
  -- row can newly violate it. NOT VALID + VALIDATE mirrors the house style and
  -- avoids blocking concurrent inserts while the constraint is applied.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='btech_games_match_type_check') THEN
    ALTER TABLE public.btech_games DROP CONSTRAINT btech_games_match_type_check;
  END IF;
  ALTER TABLE public.btech_games ADD CONSTRAINT btech_games_match_type_check
   CHECK (match_type IN ('skirmish','career','coop_skirmish')) NOT VALID;
  ALTER TABLE public.btech_games VALIDATE CONSTRAINT btech_games_match_type_check;
END $$;

-- The only seat-to-side reader. Reads team_assignments from the game record
-- and refuses to infer a side when the data is missing (fail-closed).
CREATE OR REPLACE FUNCTION public.btech_seat_team(p_game_id uuid,p_seat_number int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  st jsonb;
  ta jsonb;
  in_a boolean;
  in_b boolean;
BEGIN
  SELECT * INTO g FROM btech_games WHERE id=p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found';END IF;
  IF p_seat_number IS NULL OR p_seat_number < 1 THEN RAISE EXCEPTION 'Invalid seat number';END IF;

  -- btech_games.state is stored as text json; parse defensively (house style).
  st := CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
  ta := st->'team_assignments';

  in_a := jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'A')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'A') a WHERE (a->>0)::int = p_seat_number);
  in_b := jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'B')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'B') b WHERE (b->>0)::int = p_seat_number);

  -- Fail closed: no recorded assignment means we must not guess a side.
  IF NOT in_a AND NOT in_b THEN
    RAISE EXCEPTION 'Seat % has no recorded team assignment in this match; refusing to infer a side', p_seat_number;
  END IF;
  -- A seat recorded on both teams is corrupt; refuse rather than pick one.
  IF in_a AND in_b THEN
    RAISE EXCEPTION 'Seat % is recorded on both teams A and B; refusing to guess', p_seat_number;
  END IF;

  IF in_a THEN
    -- Cross-check the stored assignment against btech_players for the coop
    -- mode: a friendly (team A) seat must belong to a human player, never to
    -- the AI. This keeps the sealed "user_id -> seat -> unit" stamp truthful
    -- (design doc section 2.4) and prevents an AI from being seated as a
    -- friendly pilot.
    IF coalesce(g.match_type,'skirmish')='coop_skirmish' THEN
      IF NOT EXISTS(SELECT 1 FROM btech_players pl WHERE pl.game_id=p_game_id AND pl.seat_number=p_seat_number AND pl.role='player' AND NOT coalesce(pl.is_ai,false)) THEN
        RAISE EXCEPTION 'Team A (friendly) seat % has no human player in a coop skirmish', p_seat_number;
      END IF;
    END IF;
    RETURN 'A';
  END IF;
  RETURN 'B';
END $$;

REVOKE ALL ON FUNCTION public.btech_seat_team(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_seat_team(uuid,int) TO authenticated;

NOTIFY pgrst,'reload schema';