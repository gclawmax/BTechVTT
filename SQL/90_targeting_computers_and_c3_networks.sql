-- Total Warfare Targeting Computers and electronic-warfare networks.
-- Run after SQL/89_custom_map_and_scenario_editor.sql.
--
-- Standard skirmishes automatically place every compatible C3-equipped unit
-- in the same force network (up to the TW limits: 12 standard C3 or 6 C3i).
-- This avoids a separate pre-game wiring screen while retaining the combat
-- rules: physical maximum/minimum range, shooter LOS, network range sharing,
-- equipment criticals, and hostile ECM interruption.

CREATE OR REPLACE FUNCTION public.btech_ecm_interferes_line(
 p_catalogue_version text,p_state jsonb,p_owner int,p_from_col int,p_from_row int,p_to_col int,p_to_row int
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE current_hex jsonb:=jsonb_build_object('col',p_from_col,'row',p_from_row);steps int:=btech_hex_distance(p_from_col,p_from_row,p_to_col,p_to_row);step_no int;direction int;
BEGIN
 FOR step_no IN 0..steps LOOP
  IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) live
   CROSS JOIN LATERAL (SELECT coalesce(live->'weaponPhaseStart'->'mech',live) AS mech) snapshot
   WHERE (snapshot.mech->>'owner')::int<>p_owner AND NOT coalesce((snapshot.mech->>'destroyed')::boolean,false) AND NOT coalesce((snapshot.mech->>'shutdown')::boolean,false)
    AND btech_equipment_operational(p_catalogue_version,snapshot.mech,ARRAY['guardianecmsuite','ecmsuite'])
    AND btech_hex_distance((snapshot.mech->>'col')::int,(snapshot.mech->>'row')::int,(current_hex->>'col')::int,(current_hex->>'row')::int)<=6
  ) THEN RETURN true;END IF;
  EXIT WHEN step_no=steps;
  direction:=btech_direction_to((current_hex->>'col')::int,(current_hex->>'row')::int,p_to_col,p_to_row);
  current_hex:=btech_neighbor_hex((current_hex->>'col')::int,(current_hex->>'row')::int,direction);
 END LOOP;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.btech_ecm_interferes_line(text,jsonb,int,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_c3_role(p_catalogue_version text,p_mech jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
 IF coalesce((p_mech->>'shutdown')::boolean,false) THEN RETURN NULL;END IF;
 IF btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['c3icomputer','improvedc3computer']) THEN RETURN 'c3i';END IF;
 IF btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['c3mastercomputer','c3master']) THEN RETURN 'master';END IF;
 IF btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['c3slavecomputer','c3slave']) THEN RETURN 'slave';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.btech_c3_role(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_c3_range_distance(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS int LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE physical_distance int:=btech_hex_distance((p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int);best_distance int;role text;owner_no int:=(p_attacker->>'owner')::int;master jsonb;live jsonb;candidate jsonb;candidate_role text;member_count int:=0;network_limit int;
BEGIN
 role:=btech_c3_role(p_catalogue_version,p_attacker);IF role IS NULL THEN RETURN physical_distance;END IF;
 network_limit:=CASE WHEN role='c3i' THEN 6 ELSE 12 END;
 IF btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_attacker->>'col')::int,(p_attacker->>'row')::int) THEN RETURN physical_distance;END IF;
 best_distance:=physical_distance;
 IF role<>'c3i' THEN
  SELECT coalesce(value->'weaponPhaseStart'->'mech',value) INTO master FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value
   WHERE (coalesce(value->'weaponPhaseStart'->'mech',value)->>'owner')::int=owner_no
    AND btech_c3_role(p_catalogue_version,coalesce(value->'weaponPhaseStart'->'mech',value))='master'
    AND NOT btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int,(coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int,(coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int,(coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int)
   ORDER BY value->>'instanceId' LIMIT 1;
  IF master IS NULL OR btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(master->>'col')::int,(master->>'row')::int) THEN RETURN physical_distance;END IF;
 END IF;
 FOR live IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value ORDER BY value->>'instanceId' LOOP
  candidate:=coalesce(live->'weaponPhaseStart'->'mech',live);candidate_role:=btech_c3_role(p_catalogue_version,candidate);
  CONTINUE WHEN (candidate->>'owner')::int<>owner_no OR coalesce((candidate->>'destroyed')::boolean,false) OR candidate_role IS NULL;
  CONTINUE WHEN (role='c3i')<>(candidate_role='c3i');member_count:=member_count+1;EXIT WHEN member_count>network_limit;
  CONTINUE WHEN btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(candidate->>'col')::int,(candidate->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);
  CONTINUE WHEN btech_intervening_terrain(p_state,(candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)>=3 OR btech_elevation_blocks_los(coalesce(p_state->>'map_id','training-grounds'),(candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int);
  IF role='c3i' THEN
   CONTINUE WHEN btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);
  ELSE
   CONTINUE WHEN btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(candidate->>'col')::int,(candidate->>'row')::int,(master->>'col')::int,(master->>'row')::int);
  END IF;
  best_distance:=least(best_distance,btech_hex_distance((candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int));
 END LOOP;
 RETURN best_distance;
END $$;
REVOKE ALL ON FUNCTION public.btech_c3_range_distance(text,jsonb,jsonb,jsonb) FROM PUBLIC;

-- ECM affects electronic guidance when either endpoint or the traced attack
-- line enters the hostile six-hex bubble, rather than only at the target hex.
CREATE OR REPLACE FUNCTION public.btech_target_guidance_ecm(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT btech_ecm_interferes_line(p_catalogue_version,p_state,(p_attacker->>'owner')::int,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)
$$;
REVOKE ALL ON FUNCTION public.btech_target_guidance_ecm(text,jsonb,jsonb,jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('targeting_computer_c3_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'/* electronic_warfare_targeting_v1 */','/* electronic_warfare_targeting_v1 */ targeting_computer boolean:=false;targeting_mod int:=0;aimed_location text;aimed_da int;aimed_db int;aimed_success boolean:=false;c3_distance int; /* targeting_computer_c3_v1 */');
 patched:=replace(patched,
  '''__spotter_fired'',''__spotting_while_firing'',''__secondary_modifier'',''__arms_flipped'')',
  '''__spotter_fired'',''__spotting_while_firing'',''__secondary_modifier'',''__arms_flipped'',''__aim_locations'')');
 patched:=replace(patched,
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');',
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');c3_distance:=CASE WHEN indirect THEN dist ELSE btech_c3_range_distance(p_catalogue_version,st,attacker_start,target_start) END;');
 patched:=replace(patched,'heat_inflicted:=0;ams_used:=false;ams_modifier:=0;','heat_inflicted:=0;ams_used:=false;ams_modifier:=0;aimed_location:=NULL;aimed_da:=NULL;aimed_db:=NULL;aimed_success:=false;targeting_mod:=0;');
 patched:=replace(patched,
  'streak:=coalesce((weapon->>''streak'')::boolean,false);narc_attack:=selected_weapon_key=''narc'';tag_attack:=selected_weapon_key=''tag'';mode:=coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,CASE WHEN selected_weapon_key=''lb10x'' THEN ''slug'' ELSE ''single'' END);',
  'streak:=coalesce((weapon->>''streak'')::boolean,false);narc_attack:=selected_weapon_key=''narc'';tag_attack:=selected_weapon_key=''tag'';mode:=coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,CASE WHEN selected_weapon_key=''lb10x'' THEN ''slug'' ELSE ''single'' END);targeting_computer:=btech_equipment_operational(p_catalogue_version,attacker_start,ARRAY[''targetingcomputer'']);aimed_location:=NULLIF(p_ammo_bins->''__aim_locations''->>selected_mount_id,'''');IF aimed_location IS NOT NULL THEN IF NOT targeting_computer OR coalesce((weapon->>''missileWeapon'')::boolean,false) OR coalesce((weapon->>''supportOnly'')::boolean,false) OR selected_weapon_key IN (''tag'',''narc'',''ams'') OR weapon_name ILIKE ''%pulse%'' OR mode IN (''rapid'',''cluster'') THEN RAISE EXCEPTION ''% cannot make a Targeting Computer aimed shot in this firing mode'',weapon_name;END IF;IF aimed_location NOT IN (''ct'',''lt'',''rt'',''la'',''ra'',''ll'',''rl'') OR coalesce((target_start->''structure''->>aimed_location)::int,0)<=0 THEN RAISE EXCEPTION ''Choose an intact non-head location for the aimed shot'';END IF;targeting_mod:=3;ELSIF targeting_computer AND NOT coalesce((weapon->>''missileWeapon'')::boolean,false) AND NOT coalesce((weapon->>''supportOnly'')::boolean,false) AND selected_weapon_key NOT IN (''tag'',''narc'',''ams'') AND NOT (selected_weapon_key=''lb10x'' AND mode=''cluster'') THEN targeting_mod:=-1;END IF;');
 patched:=replace(patched,
  'IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;range_mod:=CASE WHEN dist<=short_range THEN 0 WHEN dist<=medium_range THEN 2 ELSE 4 END;IF minimum_range>0 AND dist<=minimum_range THEN range_mod:=range_mod+(minimum_range-dist+1);END IF;',
  'IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;range_mod:=CASE WHEN c3_distance<=short_range THEN 0 WHEN c3_distance<=medium_range THEN 2 ELSE 4 END;IF minimum_range>0 AND dist<=minimum_range THEN range_mod:=range_mod+(minimum_range-dist+1);END IF;');
 patched:=replace(patched,
  'tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod;',
  'tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod+targeting_mod;');
 patched:=replace(patched,
  'ELSIF hit AND cluster_size IS NULL THEN location_roll:=btech_roll_mech_hit_location(angle);IF shallow_water_cover',
  'ELSIF hit AND cluster_size IS NULL THEN IF aimed_location IS NOT NULL THEN aimed_da:=floor(random()*6+1);aimed_db:=floor(random()*6+1);aimed_success:=(aimed_da+aimed_db BETWEEN 6 AND 8);location_roll:=CASE WHEN aimed_success THEN jsonb_build_object(''die_a'',aimed_da,''die_b'',aimed_db,''total'',aimed_da+aimed_db,''location'',aimed_location) ELSE btech_roll_mech_hit_location(angle) END;ELSE location_roll:=btech_roll_mech_hit_location(angle);END IF;IF shallow_water_cover');
 patched:=replace(patched,
  '''weapon'',weapon_name,',
  '''weapon'',weapon_name,''physical_distance'',dist,''range_distance'',c3_distance,''aimed_location'',aimed_location,''aimed_roll'',CASE WHEN aimed_location IS NOT NULL AND aimed_da IS NOT NULL THEN jsonb_build_object(''die_a'',aimed_da,''die_b'',aimed_db,''total'',aimed_da+aimed_db) END,''aimed_success'',aimed_success,');
 patched:=replace(patched,
  '''weapon_accuracy'',accuracy_mod',
  '''weapon_accuracy'',accuracy_mod,''targeting_computer'',targeting_mod');
 IF patched=source OR position('targeting_computer_c3_v1' IN patched)=0 OR position('__aim_locations' IN patched)=0 OR position('btech_c3_range_distance' IN patched)=0 OR position('targeting_mod:=-1' IN patched)=0 OR position('aimed_success:=(aimed_da+aimed_db BETWEEN 6 AND 8)' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install Targeting Computer and C3 weapon rules';
 END IF;
 EXECUTE patched;
END $$;
