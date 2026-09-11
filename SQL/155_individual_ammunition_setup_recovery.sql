-- Run after SQL 154. Safe to rerun. No matches beyond Round 1 setup are changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.btech_ammunition_setup_pending(p_state jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (
 SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) mech
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) bin
 WHERE (bin->>'type'='lb10x' OR (coalesce((p_state->>'special_ammo_setup_v1')::boolean,false)
 AND cardinality(btech_special_ammo_load_types(bin->>'type'))>1))
 AND coalesce(bin->>'loadType','')='');
$$;
REVOKE ALL ON FUNCTION public.btech_ammunition_setup_pending(jsonb) FROM PUBLIC;
DO $$
DECLARE source text;patched text;marker text := '  SELECT * INTO v_player FROM btech_players';
BEGIN
 SELECT pg_get_functiondef('public.submit_initiative_roll(uuid,smallint,smallint)'::regprocedure) INTO source;
 IF position('ammunition_setup_guard_v2' IN source)=0 THEN
  patched:=replace(source,marker,
   '  /* ammunition_setup_guard_v2 */ IF v_game.current_round=1 AND btech_ammunition_setup_pending(CASE jsonb_typeof(v_game.state) WHEN ''string'' THEN (v_game.state#>>''{}'')::jsonb ELSE v_game.state END) THEN RAISE EXCEPTION ''Confirm every required ammunition bin on both sides before Initiative'';END IF;'||chr(10)||marker);
  IF patched=source THEN RAISE EXCEPTION 'Cannot locate Initiative guard insertion point';END IF;
  EXECUTE patched;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.confirm_round_one_ammunition_bin(p_game_id uuid,p_bin_key text,p_load_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p_loadouts jsonb:=jsonb_build_object(p_bin_key,p_load_type);g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;allowed text[];provided int:=0;special_setup boolean;accepted_keys text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(coalesce(p_loadouts,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Ammunition loadouts must be an object';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_round<>1 OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'Ammunition is selected only during Round 1 initiative setup';END IF;

 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;special_setup:=coalesce((st->>'special_ammo_setup_v1')::boolean,false);
 FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value LOOP
  updated:=mech;
  IF (mech->>'owner')::int=player.seat_number THEN
   FOR bin IN SELECT value FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) value LOOP
    allowed:=btech_special_ammo_load_types(bin->>'type');
    IF cardinality(allowed)>1 AND (bin->>'type'='lb10x' OR special_setup) THEN
     bin_key:=(mech->>'instanceId')||':'||(bin->>'id');accepted_keys:=array_append(accepted_keys,bin_key);load_type:=p_loadouts->>bin_key;
     IF load_type IS NOT NULL THEN
      IF coalesce(bin->>'loadType','')<>'' THEN RAISE EXCEPTION 'This ammunition bin is already confirmed';END IF;
      IF NOT (load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Choose a valid ammunition type for every configurable bin';END IF;
      updated:=btech_set_ammo_load_type(jsonb_set(updated,ARRAY['ammoBins',(SELECT (ordinality-1)::text FROM jsonb_array_elements(updated->'ammoBins') WITH ORDINALITY b(value,ordinality) WHERE value->>'id'=bin->>'id')],bin-'loadType'),bin->>'id',load_type);provided:=provided+1;
     END IF;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_loadouts) requested(bin_key) WHERE NOT requested.bin_key=ANY(accepted_keys)) THEN RAISE EXCEPTION 'An ammunition selection does not belong to one of your configurable bins';END IF;
 IF provided<>1 THEN RAISE EXCEPTION 'Choose ammunition for a configurable bin';END IF;
 -- Only a still-pending bin can reach here. In Round 1 Initiative no
 -- movement has begun; discard premature rolls, never guess ammunition.
 IF EXISTS (SELECT 1 FROM btech_initiative WHERE game_id=p_game_id AND round=1) THEN
  DELETE FROM btech_initiative WHERE game_id=p_game_id AND round=1;
  st:=st- 'initiative_round' - 'active_player_player_id';
  st:=st||jsonb_build_object('initiative_pending','[]'::jsonb,'initiative_order','[]'::jsonb,'initiative_rolls','[]'::jsonb,'ammunition_setup_recovered',true);
 END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;

REVOKE ALL ON FUNCTION public.confirm_round_one_ammunition_bin(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_round_one_ammunition_bin(uuid,text,text) TO authenticated;


COMMIT;
