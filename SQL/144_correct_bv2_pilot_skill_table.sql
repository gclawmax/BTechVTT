-- Correct the combined BV2 pilot-skill lookup. Apply before publishing the
-- matching browser build. Does not rewrite existing sealed force snapshots.
-- Reference: MegaMek BVCalculator.bvSkillMultiplier, TechManual p.315.
-- https://github.com/MegaMek/megamek/blob/main/megamek/src/megamek/common/battleValue/BVCalculator.java
BEGIN;
CREATE OR REPLACE FUNCTION public.btech_bv2_pilot_multiplier(p_gunnery int,p_piloting int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE factors numeric[][] := ARRAY[[2.42,2.31,2.21,2.1,1.93,1.75,1.68,1.59,1.5],[2.21,2.11,2.02,1.92,1.76,1.6,1.54,1.46,1.38],[1.93,1.85,1.76,1.68,1.54,1.4,1.35,1.28,1.21],[1.66,1.58,1.51,1.44,1.32,1.2,1.16,1.1,1.04],[1.38,1.32,1.26,1.2,1.1,1.0,0.95,0.9,0.85],[1.31,1.19,1.13,1.08,0.99,0.9,0.86,0.81,0.77],[1.24,1.12,1.07,1.02,0.94,0.85,0.81,0.77,0.72],[1.17,1.06,1.01,0.96,0.88,0.8,0.76,0.72,0.68],[1.1,0.99,0.95,0.9,0.83,0.75,0.71,0.68,0.64]];
BEGIN
 IF p_gunnery IS NULL OR p_piloting IS NULL OR p_gunnery NOT BETWEEN 0 AND 8 OR p_piloting NOT BETWEEN 0 AND 8 THEN
  RAISE EXCEPTION 'BV2 pilot skills must be whole Gunnery and Piloting values from 0 to 8';
 END IF;
 RETURN factors[p_gunnery+1][p_piloting+1];
END $$;
REVOKE ALL ON FUNCTION public.btech_bv2_pilot_multiplier(int,int) FROM PUBLIC;
DO $$ BEGIN
 IF public.btech_bv2_pilot_multiplier(4,5) <> 1 OR public.btech_bv2_pilot_multiplier(3,4) <> 1.32 OR public.btech_bv2_pilot_multiplier(0,0) <> 2.42 OR public.btech_bv2_pilot_multiplier(8,8) <> .64 THEN
  RAISE EXCEPTION 'BV2 skill table acceptance failed';
 END IF;
END $$;
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
 st:=jsonb_set(st,'{force_values}',coalesce(st->'force_values','{}'::jsonb),true);
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
COMMIT;
