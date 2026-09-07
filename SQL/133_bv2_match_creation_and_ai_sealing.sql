-- BV-3: seal every BV2 force immediately before a match begins. Run after SQL/132.
-- This also protects deterministic AI setup from a modified browser state.

CREATE OR REPLACE FUNCTION public.seal_bv2_match_force_values(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;seat_no int;roster jsonb;avatar jsonb;value jsonb;limit_value int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Match not found';END IF;
 IF NOT EXISTS(SELECT 1 FROM btech_players player WHERE player.game_id=p_game_id AND player.user_id=auth.uid() AND player.role='player') THEN RAISE EXCEPTION 'Only a seated player may seal a BV2 force';END IF;
 IF g.status<>'lobby' THEN RAISE EXCEPTION 'BV2 forces may be sealed only while the match is in the lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
 limit_value:=btech_bv2_limit_for_state(st);IF limit_value IS NULL THEN RETURN st;END IF;
 FOR seat_no IN SELECT player.seat_number FROM btech_players player WHERE player.game_id=p_game_id AND player.role='player' LOOP
  roster:=coalesce(st->'rosters'->seat_no::text,'[]'::jsonb);IF jsonb_array_length(roster)=0 THEN RAISE EXCEPTION 'Player % needs at least one BattleMech for a BV2 match',seat_no;END IF;
  avatar:=st->'skirmish_avatars'->seat_no::text;
  IF avatar IS NOT NULL AND jsonb_typeof(avatar->'hangar')='array' AND jsonb_typeof(avatar->'deployed')='array' THEN value:=btech_bv2_hangar_value(g.catalogue_version,avatar->'hangar',avatar->'deployed');ELSE value:=btech_bv2_roster_value(g.catalogue_version,roster);END IF;
  IF (value->>'adjusted')::int>limit_value THEN RAISE EXCEPTION 'Player % exceeds the BV2 limit (% / % BV)',seat_no,value->>'adjusted',limit_value;END IF;
  st:=jsonb_set(st,ARRAY['force_values',seat_no::text],value,true);
 END LOOP;
 UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN st;
END $$;
REVOKE ALL ON FUNCTION public.seal_bv2_match_force_values(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seal_bv2_match_force_values(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
