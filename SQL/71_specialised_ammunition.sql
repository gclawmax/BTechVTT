-- Round-one specialised ammunition for standard SRM and autocannon bins.
-- Existing LB-X slug/cluster declarations remain compatible. Older matches
-- without special_ammo_setup_v1 retain standard ammunition automatically.

CREATE OR REPLACE FUNCTION public.btech_special_ammo_load_types(p_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_type='lb10x' THEN ARRAY['slug','cluster']::text[]
  WHEN p_type IN ('srm2','srm4','srm6') THEN ARRAY['standard','inferno']::text[]
  WHEN p_type IN ('ac2','ac5','ac10','ac20') THEN ARRAY['standard','precision']::text[]
  ELSE ARRAY[]::text[] END
$$;

CREATE OR REPLACE FUNCTION public.btech_set_ammo_load_type(p_mech jsonb,p_bin_id text,p_load_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_mech;bin jsonb;position bigint;allowed text[];standard_shots int;loaded_shots int;
BEGIN
 FOR bin,position IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(p_mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF bin->>'id'=p_bin_id THEN
   allowed:=btech_special_ammo_load_types(bin->>'type');
   IF NOT (p_load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid % ammunition load: %',bin->>'type',p_load_type;END IF;
   IF bin ? 'loadType' AND bin->>'loadType' IS DISTINCT FROM p_load_type THEN RAISE EXCEPTION 'Selected bin is already loaded with % ammunition',bin->>'loadType';END IF;
   standard_shots:=coalesce((bin->>'standardShots')::int,(bin->>'maxShots')::int,(bin->>'shots')::int,0);
   loaded_shots:=CASE WHEN p_load_type='precision' THEN greatest(1,floor(standard_shots/2.0)::int) ELSE standard_shots END;
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'standardShots'],to_jsonb(standard_shots),true);
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'maxShots'],to_jsonb(loaded_shots),true);
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'shots'],to_jsonb(loaded_shots),true);
   RETURN jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'loadType'],to_jsonb(p_load_type),true);
  END IF;
 END LOOP;
 RAISE EXCEPTION 'Selected ammunition bin no longer exists';
END $$;

CREATE OR REPLACE FUNCTION public.submit_round_one_ammo_loadout(p_game_id uuid,p_loadouts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;allowed text[];expected int:=0;provided int:=0;special_setup boolean;
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
     expected:=expected+1;bin_key:=(mech->>'instanceId')||':'||(bin->>'id');load_type:=p_loadouts->>bin_key;
     IF load_type IS NULL OR NOT (load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Choose a valid ammunition type for every configurable bin';END IF;
     updated:=btech_set_ammo_load_type(updated,bin->>'id',load_type);provided:=provided+1;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF provided<>expected THEN RAISE EXCEPTION 'Every configurable ammunition bin must receive one ammunition type';END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;

REVOKE ALL ON FUNCTION public.btech_special_ammo_load_types(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_set_ammo_load_type(jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) TO authenticated;

-- Require configuration only for new special-ammunition matches; the older
-- LB-X requirement continues independently for legacy matches.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_initiative_roll(uuid,smallint,smallint)');IF fn IS NULL THEN RAISE EXCEPTION 'Initiative resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('special_ammo_setup_guard_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF v_game.current_round=1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((CASE jsonb_typeof(v_game.state) WHEN ''string'' THEN (v_game.state#>>''{}'')::jsonb ELSE v_game.state END)->''mech_instances'',''[]''::jsonb)) mech CROSS JOIN LATERAL jsonb_array_elements(coalesce(mech->''ammoBins'',''[]''::jsonb)) bin WHERE bin->>''type''=''lb10x'' AND NOT (bin ? ''loadType'')) THEN RAISE EXCEPTION ''LB-X ammunition must be declared before initiative is rolled'';END IF;',
  '/* special_ammo_setup_guard_v1 */ IF v_game.current_round=1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((CASE jsonb_typeof(v_game.state) WHEN ''string'' THEN (v_game.state#>>''{}'')::jsonb ELSE v_game.state END)->''mech_instances'',''[]''::jsonb)) mech CROSS JOIN LATERAL jsonb_array_elements(coalesce(mech->''ammoBins'',''[]''::jsonb)) bin WHERE (bin->>''type''=''lb10x'' OR (coalesce(((CASE jsonb_typeof(v_game.state) WHEN ''string'' THEN (v_game.state#>>''{}'')::jsonb ELSE v_game.state END)->>''special_ammo_setup_v1'')::boolean,false) AND cardinality(btech_special_ammo_load_types(bin->>''type''))>1)) AND NOT (bin ? ''loadType'')) THEN RAISE EXCEPTION ''Ammunition must be declared before initiative is rolled'';END IF;');
 IF patched=source OR position('special_ammo_setup_guard_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install specialised ammunition initiative guard';END IF;EXECUTE patched;
END $$;

-- Extend the canonical simultaneous resolver. Inferno missiles deliver two
-- heat per surviving missile (subject to the existing 15-point external-heat
-- cap); Precision rounds reduce TMM by up to two and halve bin capacity.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialised_ammunition_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'mode text;','mode text;ammo_load_type text;special_ammo_mod int:=0; /* specialised_ammunition_v1 */');
 patched:=replace(patched,
  'ammo_bin_id:=p_ammo_bins->>selected_mount_id;',
  'ammo_bin_id:=p_ammo_bins->>selected_mount_id;SELECT value->>''loadType'' INTO ammo_load_type FROM jsonb_array_elements(coalesce(attacker_start->''ammoBins'',''[]''::jsonb)) value WHERE value->>''id''=ammo_bin_id;ammo_load_type:=coalesce(ammo_load_type,CASE WHEN selected_weapon_key=''lb10x'' THEN mode ELSE ''standard'' END);IF ammo_load_type=''inferno'' AND selected_weapon_key NOT IN (''srm2'',''srm4'',''srm6'') THEN RAISE EXCEPTION ''Inferno ammunition requires a standard SRM launcher'';END IF;IF ammo_load_type=''precision'' AND selected_weapon_key NOT IN (''ac2'',''ac5'',''ac10'',''ac20'') THEN RAISE EXCEPTION ''Precision ammunition requires a standard autocannon'';END IF;IF ammo_load_type=''inferno'' THEN damage_per_missile:=0;END IF;');
 patched:=replace(patched,
  'tn:=base_tn+range_mod+component_mod+accuracy_mod;',
  'special_ammo_mod:=CASE WHEN ammo_load_type=''precision'' THEN -least(2,target_mod) ELSE 0 END;tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod;');
 patched:=replace(patched,
  'results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''fire_mode'',mode,''ammo_bin_id'',ammo_bin_id,',
  'IF ammo_load_type=''inferno'' AND hit THEN heat_inflicted:=least(greatest(0,15-coalesce((target->>''externalHeat'')::int,0)),missiles_hit*2);target:=jsonb_set(target,''{externalHeat}'',to_jsonb(coalesce((target->>''externalHeat'')::int,0)+heat_inflicted),true);target:=jsonb_set(target,''{heat}'',to_jsonb(coalesce((target->>''heat'')::int,0)+heat_inflicted),true);END IF;results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''fire_mode'',mode,''ammo_bin_id'',ammo_bin_id,''ammo_load_type'',ammo_load_type,''heat_inflicted'',heat_inflicted,');
 patched:=replace(patched,
  '''weapon_accuracy'',accuracy_mod',
  '''weapon_accuracy'',accuracy_mod,''special_ammunition'',special_ammo_mod');
 IF patched=source OR position('specialised_ammunition_v1' IN patched)=0 OR position('ammo_load_type=''inferno''' IN patched)=0 OR position('special_ammo_mod:=' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install specialised ammunition resolution';END IF;EXECUTE patched;
END $$;
