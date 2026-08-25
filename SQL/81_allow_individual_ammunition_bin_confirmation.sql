-- A loadout control belongs to one physical ammunition bin.  Let a player
-- commit one bin at a time; initiative remains guarded until every required
-- bin on both forces has a permanent loadType.

CREATE OR REPLACE FUNCTION public.submit_round_one_ammo_loadout(p_game_id uuid,p_loadouts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;allowed text[];provided int:=0;special_setup boolean;accepted_keys text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(coalesce(p_loadouts,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Ammunition loadouts must be an object';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_round<>1 OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'Ammunition is selected only during Round 1 initiative setup';END IF;
 IF EXISTS (SELECT 1 FROM btech_initiative WHERE game_id=p_game_id AND round=1) THEN RAISE EXCEPTION 'Ammunition must be declared before initiative is rolled';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;special_setup:=coalesce((st->>'special_ammo_setup_v1')::boolean,false);
 FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value LOOP
  updated:=mech;
  IF (mech->>'owner')::int=player.seat_number THEN
   FOR bin IN SELECT value FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) value LOOP
    allowed:=btech_special_ammo_load_types(bin->>'type');
    IF cardinality(allowed)>1 AND (bin->>'type'='lb10x' OR special_setup) THEN
     bin_key:=(mech->>'instanceId')||':'||(bin->>'id');accepted_keys:=array_append(accepted_keys,bin_key);load_type:=p_loadouts->>bin_key;
     IF load_type IS NOT NULL THEN
      IF NOT (load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Choose a valid ammunition type for every configurable bin';END IF;
      updated:=btech_set_ammo_load_type(updated,bin->>'id',load_type);provided:=provided+1;
     END IF;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_loadouts) requested(bin_key) WHERE NOT requested.bin_key=ANY(accepted_keys)) THEN RAISE EXCEPTION 'An ammunition selection does not belong to one of your configurable bins';END IF;
 IF provided=0 THEN RAISE EXCEPTION 'Choose ammunition for a configurable bin';END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;

REVOKE ALL ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) TO authenticated;
