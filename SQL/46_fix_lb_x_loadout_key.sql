-- Fix the LB-X loadout object key expression.
-- Run this once on existing deployments after SQL/45.

CREATE OR REPLACE FUNCTION public.submit_round_one_ammo_loadout(p_game_id uuid,p_loadouts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;expected int:=0;provided int:=0;
BEGIN
 IF jsonb_typeof(coalesce(p_loadouts,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'LB-X loadouts must be an object';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_round<>1 OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'LB-X ammunition is selected only during Round 1 initiative setup';END IF;
 IF EXISTS (SELECT 1 FROM btech_initiative WHERE game_id=p_game_id AND round=1) THEN RAISE EXCEPTION 'LB-X ammunition must be declared before initiative is rolled';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value LOOP
  updated:=mech;
  IF (mech->>'owner')::int=player.seat_number THEN
   FOR bin IN SELECT value FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) value LOOP
    IF bin->>'type'='lb10x' THEN
     expected:=expected+1;bin_key:=(mech->>'instanceId')||':'||(bin->>'id');load_type:=p_loadouts->>bin_key;
     IF load_type NOT IN ('slug','cluster') THEN RAISE EXCEPTION 'Choose slug or cluster ammunition for every LB-X bin';END IF;
     updated:=btech_set_ammo_load_type(updated,bin->>'id',load_type);provided:=provided+1;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF provided<>expected THEN RAISE EXCEPTION 'Every LB-X bin must receive one ammunition type';END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) TO authenticated;
