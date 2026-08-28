-- Hidden BattleMechs, pre-placed minefields, probe detection and the remaining
-- standard Total Warfare BattleMech special munitions.
-- Run after SQL/92_complete_line_of_sight_and_cover.sql.
-- Underwater concealment, sea mines and underwater weapon fire are excluded.

CREATE OR REPLACE FUNCTION public.set_match_deployment(p_game_id uuid,p_positions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;roster jsonb;all_positions jsonb;count_required int;
BEGIN
 IF jsonb_typeof(p_positions)<>'array' THEN RAISE EXCEPTION 'Deployment positions must be an array';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Deployment can be changed only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;roster:=coalesce(st->'rosters'->player.seat_number::text,'[]'::jsonb);count_required:=jsonb_array_length(roster);
 IF jsonb_array_length(p_positions)>count_required THEN RAISE EXCEPTION 'Deployment includes more BattleMechs than the roster';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) position WHERE jsonb_typeof(position)<>'object' OR (position->>'col') !~ '^[0-9]+$' OR (position->>'row') !~ '^[0-9]+$' OR (position->>'facing') !~ '^[0-5]$') THEN RAISE EXCEPTION 'Each deployment needs col, row and facing';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) position WHERE (position->>'col')::int NOT BETWEEN 0 AND 15 OR (position->>'row')::int NOT BETWEEN 0 AND 11 OR NOT btech_scenario_zone_contains(st,player.seat_number,lpad(position->>'col',2,'0')||lpad(position->>'row',2,'0')) OR btech_state_terrain(st,lpad(position->>'col',2,'0')||lpad(position->>'row',2,'0')) IN ('building','impassable','magma_liquid')) THEN RAISE EXCEPTION 'A BattleMech must deploy in a passable hex inside its own deployment zone';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) position WHERE coalesce((position->>'hidden')::boolean,false) AND btech_state_terrain(st,lpad(position->>'col',2,'0')||lpad(position->>'row',2,'0')) IN ('clear','pavement','bridge','shallow_water','deep_water')) THEN RAISE EXCEPTION 'A hidden BattleMech must deploy in legal concealing terrain';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_positions))<>(SELECT count(DISTINCT (position->>'col')||','||(position->>'row')) FROM jsonb_array_elements(p_positions) position) THEN RAISE EXCEPTION 'Two BattleMechs cannot occupy the same hex';END IF;
 all_positions:=coalesce(st->'deployment_positions','{}'::jsonb);IF EXISTS(SELECT 1 FROM jsonb_each(all_positions) owner,jsonb_array_elements(owner.value) occupied,jsonb_array_elements(p_positions) mine WHERE owner.key<>player.seat_number::text AND occupied->>'col'=mine->>'col' AND occupied->>'row'=mine->>'row') THEN RAISE EXCEPTION 'That deployment hex is already occupied';END IF;
 st:=jsonb_set(st,'{deployment_positions}',jsonb_set(coalesce(st->'deployment_positions','{}'::jsonb),ARRAY[player.seat_number::text],p_positions,true),true);UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN p_positions;
END $$;
REVOKE ALL ON FUNCTION public.set_match_deployment(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_deployment(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_match_minefields(p_game_id uuid,p_minefields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;field jsonb;fields jsonb:='[]'::jsonb;allowance int;code text;
BEGIN
 IF jsonb_typeof(p_minefields)<>'array' OR jsonb_array_length(p_minefields)>4 THEN RAISE EXCEPTION 'Minefields must be supplied as a short array';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Minefields can be placed only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;allowance:=coalesce((st->'minefield_allowance'->>player.seat_number::text)::int,2);
 FOR field IN SELECT value FROM jsonb_array_elements(coalesce(st->'minefields','[]'::jsonb)) value WHERE (value->>'owner')::int<>player.seat_number LOOP fields:=fields||jsonb_build_array(field);END LOOP;
 IF jsonb_array_length(p_minefields)=0 THEN st:=jsonb_set(st,'{minefields}',fields,true);UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN fields;END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(st->'minefields','[]'::jsonb)) value WHERE (value->>'owner')::int=player.seat_number)+jsonb_array_length(p_minefields)>allowance THEN RAISE EXCEPTION 'This side has no unplaced minefields remaining';END IF;
 FOR field IN SELECT value FROM jsonb_array_elements(coalesce(st->'minefields','[]'::jsonb)) value WHERE (value->>'owner')::int=player.seat_number LOOP fields:=fields||jsonb_build_array(field);END LOOP;
 FOR field IN SELECT value FROM jsonb_array_elements(p_minefields) value LOOP
  IF (field->>'col') !~ '^[0-9]+$' OR (field->>'row') !~ '^[0-9]+$' OR (field->>'col')::int NOT BETWEEN 0 AND 15 OR (field->>'row')::int NOT BETWEEN 0 AND 11 OR field->>'type' NOT IN ('conventional','vibrabomb') OR coalesce((field->>'density')::int,0) NOT IN (10,20,30) THEN RAISE EXCEPTION 'Invalid minefield declaration';END IF;
  code:=lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0');IF NOT btech_scenario_zone_contains(st,player.seat_number,code) THEN RAISE EXCEPTION 'A pre-placed minefield must be inside your deployment zone';END IF;IF btech_state_terrain(st,code) IN ('shallow_water','deep_water','building','impassable','magma_liquid') THEN RAISE EXCEPTION 'That terrain cannot contain this ground minefield';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(st->'deployment_positions','{}'::jsonb)) owner,jsonb_array_elements(owner.value) position WHERE position->>'col'=field->>'col' AND position->>'row'=field->>'row') OR EXISTS(SELECT 1 FROM jsonb_array_elements(fields) existing WHERE existing->>'col'=field->>'col' AND existing->>'row'=field->>'row') THEN RAISE EXCEPTION 'A minefield cannot be placed in an occupied or already mined hex';END IF;
  fields:=fields||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'owner',player.seat_number,'col',(field->>'col')::int,'row',(field->>'row')::int,'type',field->>'type','density',(field->>'density')::int,'sensitivity',CASE WHEN field->>'type'='vibrabomb' THEN greatest(20,least(100,coalesce((field->>'sensitivity')::int,50))) ELSE NULL END,'weapon_delivered',false,'revealed_to',jsonb_build_array(player.seat_number)));
 END LOOP;
 st:=jsonb_set(st,'{minefields}',fields,true);UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN fields;
END $$;
REVOKE ALL ON FUNCTION public.set_match_minefields(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_minefields(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_active_probe_range(p_catalogue_version text,p_mech jsonb)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['activeprobe','clanactiveprobe']) THEN 5 WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['beagleactiveprobe']) THEN 4 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.btech_active_probe_range(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_hidden_mines(p_game_id uuid,p_catalogue_version text,p_moved_id text,p_path jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;units jsonb;moved jsonb;candidate jsonb;field jsonb;action jsonb;updated_fields jsonb:='[]'::jsonb;events jsonb:='[]'::jsonb;probe_range int;distance int;roll int;detection_target int;trigger int;mass int;damage_left int;mine_damage int;group_damage int;location_roll jsonb;damage_result jsonb;hit boolean;seen_ids text[]:=ARRAY[]::text[];traversed_hexes text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;units:=coalesce(st->'mech_instances','[]'::jsonb);
 SELECT value INTO moved FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_moved_id;IF moved IS NULL THEN RETURN;END IF;
 IF coalesce((moved->>'hidden')::boolean,false) AND jsonb_array_length(coalesce(p_path,'[]'::jsonb))>0 THEN moved:=jsonb_set(moved,'{hidden}','false'::jsonb,true);events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',p_moved_id,'reason','moved'));END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int<>(moved->>'owner')::int AND coalesce((value->>'hidden')::boolean,false) LOOP
  IF btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int)<=1 THEN candidate:=jsonb_set(candidate,'{hidden}','false'::jsonb,true);seen_ids:=array_append(seen_ids,candidate->>'instanceId');events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',candidate->>'instanceId','reason','adjacent enemy'));END IF;
 END LOOP;
 probe_range:=btech_active_probe_range(p_catalogue_version,moved);IF probe_range>0 THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(units) value WHERE (value->>'owner')::int<>(moved->>'owner')::int AND coalesce((value->>'hidden')::boolean,false) AND NOT ((value->>'instanceId')=ANY(seen_ids)) LOOP
   distance:=btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);IF distance<=probe_range AND NOT btech_ecm_interferes_line(p_catalogue_version,st,(moved->>'owner')::int,(moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int) AND NOT coalesce((btech_los_analysis(st,(moved->>'col')::int,(moved->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int)->>'blocked')::boolean,false) THEN seen_ids:=array_append(seen_ids,candidate->>'instanceId');events:=events||jsonb_build_array(jsonb_build_object('type','unit_revealed','instance_id',candidate->>'instanceId','reason','active probe'));END IF;
  END LOOP;
 END IF;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_moved_id THEN moved WHEN (value->>'instanceId')=ANY(seen_ids) THEN jsonb_set(value,'{hidden}','false'::jsonb,true) ELSE value END) INTO units FROM jsonb_array_elements(units) value;
 SELECT value INTO moved FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_moved_id;SELECT (definition->>'mass')::int INTO mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=moved->>'unitId';
 FOR action IN SELECT value FROM jsonb_array_elements(coalesce(p_path,'[]'::jsonb)) value LOOP IF action->>'action' IN ('step','jump') THEN traversed_hexes:=array_append(traversed_hexes,lpad(action->>'col',2,'0')||lpad(action->>'row',2,'0'));END IF;END LOOP;
 FOR field IN SELECT value FROM jsonb_array_elements(coalesce(st->'minefields','[]'::jsonb)) value LOOP
  IF (field->>'owner')::int=(moved->>'owner')::int THEN updated_fields:=updated_fields||jsonb_build_array(field);CONTINUE;END IF;
  distance:=btech_hex_distance((moved->>'col')::int,(moved->>'row')::int,(field->>'col')::int,(field->>'row')::int);
  IF probe_range>0
   AND distance<=probe_range
   AND NOT btech_ecm_interferes_line(p_catalogue_version,st,(moved->>'owner')::int,(moved->>'col')::int,(moved->>'row')::int,(field->>'col')::int,(field->>'row')::int)
   AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(coalesce(field->'revealed_to','[]'::jsonb)) AS revealed(seat)
    WHERE revealed.seat=(moved->>'owner')
   )
  THEN
   roll:=floor(random()*6+1)+floor(random()*6+1);
   detection_target:=CASE WHEN coalesce((field->>'weapon_delivered')::boolean,false) THEN 7 ELSE 10 END;
   IF roll>=detection_target THEN
    field:=jsonb_set(field,'{revealed_to}',coalesce(field->'revealed_to','[]'::jsonb)||to_jsonb((moved->>'owner')::int),true);
    events:=events||jsonb_build_array(jsonb_build_object('type','minefield_detected','hex',lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0'),'roll',roll,'target',detection_target));
   END IF;
  END IF;
  hit:=(lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0'))=ANY(traversed_hexes) AND (field->>'type'='conventional' OR (field->>'type'='vibrabomb' AND mass>=coalesce((field->>'sensitivity')::int,50)));
  IF hit THEN trigger:=CASE WHEN (field->>'density')::int<15 THEN 9 WHEN (field->>'density')::int<25 THEN 8 ELSE 7 END;roll:=floor(random()*6+1)+floor(random()*6+1);hit:=roll>=trigger;END IF;
  IF hit THEN mine_damage:=(field->>'density')::int;damage_left:=mine_damage;WHILE damage_left>0 AND NOT coalesce((moved->>'destroyed')::boolean,false) LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_physical_location('kick','front');damage_result:=btech_apply_direct_damage(moved,group_damage,location_roll->>'location',false);moved:=damage_result->'mech';END LOOP;field:=jsonb_set(field,'{density}',to_jsonb(greatest(0,mine_damage-5)),true);field:=jsonb_set(field,'{revealed_to}','[1,2]'::jsonb,true);events:=events||jsonb_build_array(jsonb_build_object('type','minefield_triggered','instance_id',p_moved_id,'hex',lpad(field->>'col',2,'0')||lpad(field->>'row',2,'0'),'mine_type',field->>'type','roll',roll,'target',trigger,'damage',mine_damage));END IF;
  IF (field->>'density')::int>0 THEN updated_fields:=updated_fields||jsonb_build_array(field);END IF;
 END LOOP;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_moved_id THEN moved ELSE value END) INTO units FROM jsonb_array_elements(units) value;st:=jsonb_set(st,'{mech_instances}',units,true);st:=jsonb_set(st,'{minefields}',updated_fields,true);st:=jsonb_set(st,'{detection_events}',events,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_hidden_mines(uuid,text,text,jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;IF position('hidden_mine_movement_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'PERFORM submit_phase_state_nonphysical_core(p_game_id,units);','PERFORM submit_phase_state_nonphysical_core(p_game_id,units);PERFORM btech_resolve_hidden_mines(p_game_id,g.catalogue_version,p_instance_id,CASE WHEN hidden_contact IS NULL THEN p_path ELSE ''[]''::jsonb END); /* hidden_mine_movement_v1 */');
 patched:=replace(patched,'PERFORM submit_phase_state_nonphysical_core(p_game_id, units);','PERFORM submit_phase_state_nonphysical_core(p_game_id, units);PERFORM btech_resolve_hidden_mines(p_game_id,g.catalogue_version,p_instance_id,CASE WHEN hidden_contact IS NULL THEN p_path ELSE ''[]''::jsonb END); /* hidden_mine_movement_v1 */');
 patched:=replace(patched,'check_payload jsonb:=NULL;','check_payload jsonb:=NULL;hidden_contact jsonb:=NULL;');
 patched:=replace(patched,'IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>''instanceId''<>p_instance_id AND (unit->>''col'')::int=next_col AND (unit->>''row'')::int=next_row AND NOT coalesce((unit->>''destroyed'')::boolean,false)) THEN RAISE EXCEPTION ''A BattleMech cannot enter an occupied hex'';END IF;','SELECT value INTO hidden_contact FROM jsonb_array_elements(before_units) unit WHERE unit->>''instanceId''<>p_instance_id AND (unit->>''owner'')::int<>(mech->>''owner'')::int AND (unit->>''col'')::int=next_col AND (unit->>''row'')::int=next_row AND coalesce((unit->>''hidden'')::boolean,false) AND NOT coalesce((unit->>''destroyed'')::boolean,false);IF hidden_contact IS NOT NULL THEN SELECT jsonb_agg(CASE WHEN value->>''instanceId''=hidden_contact->>''instanceId'' THEN jsonb_set(value,''{hidden}'',''false''::jsonb,true) ELSE value END) INTO before_units FROM jsonb_array_elements(before_units) value;EXIT;END IF;IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>''instanceId''<>p_instance_id AND (unit->>''col'')::int=next_col AND (unit->>''row'')::int=next_row AND NOT coalesce((unit->>''destroyed'')::boolean,false)) THEN RAISE EXCEPTION ''A BattleMech cannot enter an occupied hex'';END IF;');
 patched:=replace(patched,'''terrain_check'',CASE WHEN water_entry OR rubble_entry OR pavement_turn THEN check_payload END);','''terrain_check'',CASE WHEN water_entry OR rubble_entry OR pavement_turn THEN check_payload END,''hidden_contact'',hidden_contact->>''instanceId'');');
 IF patched=source OR position('hidden_mine_movement_v1' IN patched)=0 OR position('hidden_contact jsonb' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install hidden-unit and minefield movement resolution';END IF;EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.btech_special_ammo_load_types(p_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN p_type='lb10x' THEN ARRAY['slug','cluster']::text[] WHEN p_type IN ('srm2','srm4','srm6') THEN ARRAY['standard','inferno','fragmentation']::text[] WHEN p_type IN ('ac2','ac5','ac10','ac20') THEN ARRAY['standard','precision','armor_piercing','flechette']::text[] WHEN p_type IN ('lrm5','lrm10','lrm15','lrm20') THEN ARRAY['standard','semi_guided','fragmentation']::text[] ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.btech_special_ammo_load_types(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_set_ammo_load_type(p_mech jsonb,p_bin_id text,p_load_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_mech;bin jsonb;position bigint;allowed text[];standard_shots int;loaded_shots int;
BEGIN
 FOR bin,position IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(p_mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP IF bin->>'id'=p_bin_id THEN allowed:=btech_special_ammo_load_types(bin->>'type');IF NOT (p_load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid % ammunition load: %',bin->>'type',p_load_type;END IF;IF bin ? 'loadType' AND bin->>'loadType' IS DISTINCT FROM p_load_type THEN RAISE EXCEPTION 'Selected bin is already loaded with % ammunition',bin->>'loadType';END IF;standard_shots:=coalesce((bin->>'standardShots')::int,(bin->>'maxShots')::int,(bin->>'shots')::int,0);loaded_shots:=CASE WHEN p_load_type IN ('precision','armor_piercing') THEN greatest(1,floor(standard_shots/2.0)::int) ELSE standard_shots END;result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'standardShots'],to_jsonb(standard_shots),true);result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'maxShots'],to_jsonb(loaded_shots),true);result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'shots'],to_jsonb(loaded_shots),true);RETURN jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'loadType'],to_jsonb(p_load_type),true);END IF;END LOOP;RAISE EXCEPTION 'Selected ammunition bin no longer exists';
END $$;

-- Make the remaining anti-BattleMech plasma weapons constructible so their
-- specialist effects are reachable without relying on a future imported unit.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_custom_equipment(text)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom equipment catalogue is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialist_plasma_construction_v1' IN source)=0 THEN
  patched:=regexp_replace(source,E'(WHEN ''flamer'' THEN [^\\n]+)',E'\\1\n  WHEN ''plasma_rifle'' THEN ''{"name":"Plasma Rifle","weight":6,"slots":2,"damage":10,"heat":10,"range":[5,10,15],"ammoType":"plasma_rifle","label":"Plasma Rifle"}'' /* specialist_plasma_construction_v1 */\n  WHEN ''plasma_cannon'' THEN ''{"name":"Clan Plasma Cannon","weight":3,"slots":1,"damage":0,"heat":7,"range":[6,12,18],"ammoType":"plasma_cannon","clan":true,"label":"Clan Plasma Cannon"}''');
  IF patched=source OR position('specialist_plasma_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add plasma weapons to MechLab';END IF;EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.btech_custom_ammo(text)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom ammunition catalogue is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialist_plasma_ammo_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',' WHEN ''plasma_rifle'' THEN ''{"name":"IS Ammo Plasma Rifle","shots":10}'' /* specialist_plasma_ammo_v1 */ WHEN ''plasma_cannon'' THEN ''{"name":"Clan Ammo Plasma Cannon","shots":10,"clan":true}'' END::jsonb');
  IF patched=source OR position('specialist_plasma_ammo_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add plasma ammunition to MechLab';END IF;EXECUTE patched;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_special_ammo_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean,p_load_type text,p_weapon_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE result jsonb;armor_key text:=CASE WHEN p_rear AND p_location IN ('ct','lt','rt') THEN p_location||'_rear' ELSE p_location END;armor_before int:=coalesce((p_mech->'armor'->>armor_key)::int,0);critical_roll int;critical_result jsonb;modifier int;
BEGIN
 IF p_load_type='fragmentation' THEN RETURN jsonb_build_object('mech',p_mech,'critical_checks','[]'::jsonb);END IF;
 result:=btech_apply_weapon_damage(p_mech,p_damage,p_location,p_rear);
 IF p_load_type='armor_piercing' AND armor_before>=p_damage THEN modifier:=CASE p_weapon_key WHEN 'ac20' THEN -1 WHEN 'ac10' THEN -2 WHEN 'ac5' THEN -3 ELSE -4 END;critical_roll:=floor(random()*6+1)+floor(random()*6+1)+modifier;IF critical_roll>=8 THEN critical_result:=btech_resolve_critical_slots(result->'mech',p_location,least(12,critical_roll));result:=jsonb_set(result,'{mech}',critical_result->'mech',true);result:=jsonb_set(result,'{armor_piercing_critical}',jsonb_build_object('roll',critical_roll,'modifier',modifier,'events',critical_result->'events'),true);END IF;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_special_ammo_damage(jsonb,int,text,boolean,text,text) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;IF position('hidden_special_munitions_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'IF target IS NULL OR target_start IS NULL OR','IF target IS NULL OR target_start IS NULL OR coalesce((target_start->>''hidden'')::boolean,false) OR');
 patched:=replace(patched,'IF ammo_load_type=''semi_guided'' AND selected_weapon_key NOT LIKE ''lrm%'' THEN RAISE EXCEPTION ''Semi-guided ammunition requires an LRM launcher'';END IF;','IF ammo_load_type=''semi_guided'' AND selected_weapon_key NOT LIKE ''lrm%'' THEN RAISE EXCEPTION ''Semi-guided ammunition requires an LRM launcher'';END IF;IF ammo_load_type IN (''armor_piercing'',''flechette'') AND selected_weapon_key NOT IN (''ac2'',''ac5'',''ac10'',''ac20'') THEN RAISE EXCEPTION ''That special ammunition requires a standard autocannon'';END IF;IF ammo_load_type=''fragmentation'' AND selected_weapon_key NOT LIKE ''lrm%'' AND selected_weapon_key NOT LIKE ''srm%'' THEN RAISE EXCEPTION ''Fragmentation ammunition requires a standard missile launcher'';END IF;');
 patched:=replace(patched,'ammo_load_type:=coalesce(selected_bin->>''loadType'',''standard'');','ammo_load_type:=coalesce(selected_bin->>''loadType'',''standard'');IF ammo_load_type=''flechette'' THEN weapon_damage:=floor(weapon_damage/2.0)::int;damage_per_missile:=floor(damage_per_missile/2.0)::int;ELSIF ammo_load_type=''fragmentation'' THEN weapon_damage:=0;damage_per_missile:=0;END IF;');
 patched:=regexp_replace(patched,'special_ammo_mod\s*:=\s*CASE WHEN ammo_load_type=''precision''[^;]+;','special_ammo_mod:=CASE WHEN ammo_load_type=''precision'' THEN -least(2,target_mod) WHEN ammo_load_type=''armor_piercing'' THEN 1 WHEN ammo_load_type=''semi_guided'' AND tag_guided THEN CASE WHEN coalesce((p_ammo_bins->>''__indirect'')::boolean,false) THEN -(target_mod+woods+indirect_mod+spotter_move_mod+spotter_firing_mod) ELSE -target_mod END ELSE 0 END; /* hidden_special_munitions_v1 */','i');
 patched:=replace(patched,'btech_apply_weapon_damage(target,weapon_damage,location_roll->>''location'',angle=''rear'')','btech_apply_special_ammo_damage(target,weapon_damage,location_roll->>''location'',angle=''rear'',ammo_load_type,selected_weapon_key)');
 patched:=replace(patched,'btech_apply_weapon_damage(target,group_damage,location_roll->>''location'',angle=''rear'')','btech_apply_special_ammo_damage(target,group_damage,location_roll->>''location'',angle=''rear'',ammo_load_type,selected_weapon_key)');
 patched:=replace(patched,'''critical_checks'',damage_result->''critical_checks''','''critical_checks'',damage_result->''critical_checks'',''armor_piercing_critical'',damage_result->''armor_piercing_critical''');
 patched:=replace(patched,'attacker:=jsonb_set(attacker,''{hasFired}'',''true''::jsonb,true);','attacker:=jsonb_set(attacker,''{hasFired}'',''true''::jsonb,true);attacker:=jsonb_set(attacker,''{hidden}'',''false''::jsonb,true);');
 patched:=replace(patched,'IF selected_weapon_key=''flamer'' THEN heat_inflicted:=2;','IF selected_weapon_key=''plasma_rifle'' THEN heat_inflicted:=floor(random()*6+1); /* specialist_plasma_v1 */ ELSIF selected_weapon_key=''plasma_cannon'' THEN heat_inflicted:=floor(random()*6+1)+floor(random()*6+1);ELSIF selected_weapon_key=''flamer'' THEN heat_inflicted:=2;');
 IF patched=source OR position('hidden_special_munitions_v1' IN patched)=0 OR position('btech_apply_special_ammo_damage' IN patched)=0 OR position('target_start->>''hidden''' IN patched)=0 OR position('specialist_plasma_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install hidden targeting and specialist weapon/munition resolution';END IF;EXECUTE patched;
END $$;
