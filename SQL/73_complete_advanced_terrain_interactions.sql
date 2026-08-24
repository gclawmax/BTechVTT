-- Stateful advanced terrain interactions for BattleMech matches.
-- Run after SQL/72_complete_critical_effect_edges.sql.
--
-- Completes pavement skids (including skid damage, collisions, water stops and
-- building CF), makes collapsed buildings become rubble for movement/LOS, and
-- advances fire-generated smoke and burning-building damage once per round.

CREATE OR REPLACE FUNCTION public.btech_state_terrain(p_state jsonb,p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN coalesce(p_state->'terrain_overrides','{}'::jsonb) ? p_code
  THEN p_state->'terrain_overrides'->>p_code
  ELSE btech_terrain(coalesce(p_state->>'map_id','training-grounds'),p_code) END
$$;
REVOKE ALL ON FUNCTION public.btech_state_terrain(jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_initialise_terrain_state(p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE st jsonb:=coalesce(p_state,'{}'::jsonb);code text;cf jsonb:=coalesce(st->'building_cf','{}'::jsonb);
BEGIN
 IF coalesce(st->>'map_id','training-grounds')='industrial-crossing' THEN
  FOREACH code IN ARRAY ARRAY['0603','0903','0608','0908'] LOOP
   IF btech_state_terrain(st,code)='building' AND NOT (cf ? code) THEN cf:=jsonb_set(cf,ARRAY[code],'40'::jsonb,true);END IF;
  END LOOP;
 END IF;
 st:=jsonb_set(st,'{building_cf}',cf,true);
 st:=jsonb_set(st,'{terrain_overrides}',coalesce(st->'terrain_overrides','{}'::jsonb),true);
 RETURN st;
END $$;
REVOKE ALL ON FUNCTION public.btech_initialise_terrain_state(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_intervening_terrain(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;terrain text;points int:=0;guard int:=0;
 dq int[]:=ARRAY[1,1,0,-1,-1,0];dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br);aq:=c-(r-(r&1))/2;nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;
  terrain:=btech_state_terrain(p_state,lpad(c::text,2,'0')||lpad(r::text,2,'0'));
  points:=points+CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 WHEN 'building' THEN 3 ELSE 0 END;
  guard:=guard+1;
 END LOOP;
 RETURN points;
END $$;
REVOKE ALL ON FUNCTION public.btech_intervening_terrain(jsonb,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_apply_skid(
 p_state jsonb,p_catalogue_version text,p_mech jsonb,p_direction int,p_hexes_moved int,p_fall_angle text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=btech_initialise_terrain_state(p_state);units jsonb:=st->'mech_instances';m jsonb:=p_mech;occupant jsonb;displaced jsonb;
 map_id text:=coalesce(st->>'map_id','training-grounds');remaining int:=ceil(greatest(0,p_hexes_moved)/2.0)::int;skidded int:=0;
 dest jsonb;dc int;dr int;code text;terrain text;current_level int;dest_level int;mass int;target_mass int;per_hex int;skid_damage int:=0;
 cf int;building_damage int;collision_damage int;group_damage int;damage_left int;location_roll jsonb;damage_result jsonb;
 collisions jsonb:='[]'::jsonb;damage_groups jsonb:='[]'::jsonb;stop_reason text:=NULL;
BEGIN
 SELECT (definition->>'mass')::int INTO mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=m->>'unitId';
 IF mass IS NULL THEN RAISE EXCEPTION 'Skidding BattleMech is missing from the pinned catalogue';END IF;
 per_hex:=ceil(ceil(mass/10.0)/2.0)::int;
 WHILE remaining>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  dest:=btech_neighbor_hex((m->>'col')::int,(m->>'row')::int,p_direction);dc:=(dest->>'col')::int;dr:=(dest->>'row')::int;
  IF dc NOT BETWEEN 0 AND 15 OR dr NOT BETWEEN 0 AND 11 THEN stop_reason:='map edge';EXIT;END IF;
  code:=lpad(dc::text,2,'0')||lpad(dr::text,2,'0');terrain:=btech_state_terrain(st,code);
  current_level:=btech_elevation(map_id,lpad(m->>'col',2,'0')||lpad(m->>'row',2,'0'));dest_level:=btech_elevation(map_id,code);
  IF dest_level>current_level THEN
   collision_damage:=ceil(mass/20.0)::int;damage_left:=collision_damage;
   WHILE damage_left>0 LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',false);m:=damage_result->'mech';END LOOP;
   stop_reason:='higher terrain';EXIT;
  END IF;
  m:=jsonb_set(m,'{col}',to_jsonb(dc),true);m:=jsonb_set(m,'{row}',to_jsonb(dr),true);skidded:=skidded+1;skid_damage:=skid_damage+per_hex;remaining:=remaining-1;

  IF terrain='building' THEN
   cf:=coalesce((st->'building_cf'->>code)::int,40);building_damage:=ceil(mass/10.0)::int*greatest(1,p_hexes_moved);
   st:=jsonb_set(st,ARRAY['building_cf',code],to_jsonb(greatest(0,cf-building_damage)),true);
   damage_left:=ceil(cf/10.0)::int;
   WHILE damage_left>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_mech_hit_location(coalesce(p_fall_angle,'front'));damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',p_fall_angle='rear');m:=damage_result->'mech';END LOOP;
   collisions:=collisions||jsonb_build_array(jsonb_build_object('type','building','hex',code,'construction_factor_before',cf,'damage',building_damage,'construction_factor_after',greatest(0,cf-building_damage)));
   IF building_damage>=cf THEN st:=jsonb_set(st,ARRAY['terrain_overrides',code],'"rubble"'::jsonb,true);remaining:=greatest(0,remaining-2);ELSE stop_reason:='building survived';EXIT;END IF;
  ELSIF terrain IN ('shallow_water','deep_water') THEN stop_reason:='water';remaining:=0;
  ELSIF terrain NOT IN ('clear','pavement','fire','light_smoke','heavy_smoke') THEN remaining:=greatest(0,remaining-btech_battlemech_terrain_cost(terrain));END IF;

  SELECT value INTO occupant FROM jsonb_array_elements(units) value WHERE value->>'instanceId'<>m->>'instanceId' AND (value->>'col')::int=dc AND (value->>'row')::int=dr AND NOT coalesce((value->>'destroyed')::boolean,false) LIMIT 1;
  IF occupant IS NOT NULL THEN
   SELECT (definition->>'mass')::int INTO target_mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=occupant->>'unitId';
   collision_damage:=ceil(mass/10.0)::int*greatest(1,p_hexes_moved);damage_left:=collision_damage;
   WHILE damage_left>0 AND NOT coalesce((occupant->>'destroyed')::boolean,false) LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_physical_location('kick','front');damage_result:=btech_apply_direct_damage(occupant,group_damage,location_roll->>'location',false);occupant:=damage_result->'mech';END LOOP;
   damage_left:=ceil(coalesce(target_mass,0)/10.0)::int;
   WHILE damage_left>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',false);m:=damage_result->'mech';END LOOP;
   SELECT jsonb_agg(CASE WHEN value->>'instanceId'=occupant->>'instanceId' THEN occupant ELSE value END) INTO units FROM jsonb_array_elements(units) value;
   displaced:=btech_displace_battlemech_chain(p_catalogue_version,map_id,units,occupant->>'instanceId',p_direction,0);units:=displaced->'units';
   collisions:=collisions||jsonb_build_array(jsonb_build_object('type','unit','target_instance_id',occupant->>'instanceId','damage_to_target',collision_damage,'damage_to_skidding_unit',ceil(coalesce(target_mass,0)/10.0)::int,'displacement',displaced));
   stop_reason:='unit collision';remaining:=0;
  END IF;
 END LOOP;
 damage_left:=skid_damage;
 WHILE damage_left>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  group_damage:=least(5,damage_left);damage_left:=damage_left-group_damage;location_roll:=btech_roll_mech_hit_location(coalesce(p_fall_angle,'front'));damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',p_fall_angle='rear');m:=damage_result->'mech';
  damage_groups:=damage_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks'));
 END LOOP;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=m->>'instanceId' THEN m ELSE value END) INTO units FROM jsonb_array_elements(units) value;
 st:=jsonb_set(st,'{mech_instances}',units,true);
 RETURN jsonb_build_object('state',st,'mech',m,'direction',p_direction,'hexes_required',ceil(greatest(0,p_hexes_moved)/2.0)::int,'hexes_skidded',skidded,'damage',skid_damage,'damage_groups',damage_groups,'collisions',collisions,'stop_reason',stop_reason);
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_skid(jsonb,text,jsonb,int,int,text) FROM PUBLIC;

-- Install state-aware terrain and the completed skid consequence in the
-- authoritative movement resolver without discarding later critical fixes.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_terrain_interactions_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'check_payload jsonb:=NULL;','check_payload jsonb:=NULL;skid_direction int:=NULL;skid_result jsonb; /* advanced_terrain_interactions_v1 */');
 patched:=replace(patched,'btech_terrain(coalesce(st->>''map_id'',''training-grounds''),','btech_state_terrain(st,');
 patched:=replace(patched,'btech_terrain(coalesce(st->>''map_id'', ''training-grounds''::text),','btech_state_terrain(st,');
 patched:=replace(patched,'btech_terrain(COALESCE((st ->> ''map_id''::text), ''training-grounds''::text),','btech_state_terrain(st,');
 patched:=replace(patched,'THEN pavement_turn:=true;','THEN skid_direction:=coalesce(skid_direction,current_facing);pavement_turn:=true;');
 patched:=replace(patched,'THEN pavement_turn := true;','THEN skid_direction:=coalesce(skid_direction,current_facing);pavement_turn := true;');
 patched:=replace(patched,'array_to_string(reasons,'', ''),0)','array_to_string(reasons,'', ''),CASE WHEN pavement_turn THEN CASE WHEN hexes_moved<=2 THEN -1 WHEN hexes_moved<=4 THEN 0 WHEN hexes_moved<=7 THEN 1 WHEN hexes_moved<=10 THEN 2 WHEN hexes_moved<=17 THEN 4 WHEN hexes_moved<=24 THEN 5 ELSE 6 END ELSE 0 END)');
 patched:=replace(patched,'array_to_string(reasons, '', ''::text), 0)','array_to_string(reasons, '', ''::text), CASE WHEN pavement_turn THEN CASE WHEN hexes_moved<=2 THEN -1 WHEN hexes_moved<=4 THEN 0 WHEN hexes_moved<=7 THEN 1 WHEN hexes_moved<=10 THEN 2 WHEN hexes_moved<=17 THEN 4 WHEN hexes_moved<=24 THEN 5 ELSE 6 END ELSE 0 END)');
 patched:=replace(patched,'SELECT jsonb_agg(', 'IF pavement_turn AND raw_check IS NOT NULL AND NOT coalesce((raw_check->>''passed'')::boolean,false) THEN skid_result:=btech_apply_skid(jsonb_set(st,''{mech_instances}'',jsonb_set(before_units,ARRAY[(SELECT (ordinality-1)::text FROM jsonb_array_elements(before_units) WITH ORDINALITY WHERE value->>''instanceId''=p_instance_id)],mech,true),true),g.catalogue_version,mech,coalesce(skid_direction,current_facing),hexes_moved,fall_result->>''fall_angle'');st:=skid_result->''state'';mech:=skid_result->''mech'';check_payload:=jsonb_set(check_payload,''{skid}'',skid_result-''state''-''mech'',true);UPDATE btech_games SET state=st WHERE id=p_game_id;END IF; SELECT jsonb_agg(');
 IF patched=source OR position('advanced_terrain_interactions_v1' IN patched)=0 OR position('btech_apply_skid' IN patched)=0 OR position('btech_state_terrain(st,' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install completed advanced movement terrain';END IF;
 EXECUTE patched;
END $$;

-- Make weapon LOS consume the same terrain overlay (not the immutable printed
-- map), so a collapsed building stops blocking sight immediately.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('stateful_terrain_los_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'btech_intervening_woods(map_id,','btech_intervening_terrain(st,');
 patched:=replace(patched,'btech_terrain(map_id,','btech_state_terrain(st,');
 patched:=replace(patched,'DECLARE ', 'DECLARE /* stateful_terrain_los_v1 */ ');
 IF patched=source OR position('btech_intervening_terrain(st,' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install stateful terrain LOS';END IF;EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.btech_advance_terrain_round(p_game_id uuid,p_completed_round int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;code text;fire_code text;building_code text;fire_hex jsonb;smoke_hex jsonb;light_hex jsonb;cf int;events jsonb:='[]'::jsonb;wind int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.current_round<=p_completed_round THEN RETURN;END IF;
 st:=btech_initialise_terrain_state(CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END);
 IF coalesce((st->>'terrain_advanced_after_round')::int,0)>=p_completed_round THEN RETURN;END IF;
 wind:=coalesce((st->>'wind_direction')::int,0)%6;
 -- Remove last round's generated smoke before rebuilding the trail downwind.
 FOR code IN SELECT jsonb_array_elements_text(coalesce(st->'generated_smoke_hexes','[]'::jsonb)) LOOP st:=jsonb_set(st,ARRAY['terrain_overrides',code],'"clear"'::jsonb,true);END LOOP;
 st:=jsonb_set(st,'{generated_smoke_hexes}','[]'::jsonb,true);
 FOR fire_code IN SELECT key FROM jsonb_each(coalesce(st->'terrain_overrides','{}'::jsonb)) WHERE value='"fire"'::jsonb
                   UNION SELECT code FROM (VALUES ('1004')) base(code) WHERE btech_terrain(coalesce(st->>'map_id','training-grounds'),code)='fire' LOOP
  fire_hex:=jsonb_build_object('col',left(fire_code,2)::int,'row',right(fire_code,2)::int);
  smoke_hex:=btech_neighbor_hex((fire_hex->>'col')::int,(fire_hex->>'row')::int,wind);light_hex:=btech_neighbor_hex((smoke_hex->>'col')::int,(smoke_hex->>'row')::int,wind);
  IF (smoke_hex->>'col')::int BETWEEN 0 AND 15 AND (smoke_hex->>'row')::int BETWEEN 0 AND 11 THEN code:=lpad(smoke_hex->>'col',2,'0')||lpad(smoke_hex->>'row',2,'0');st:=jsonb_set(st,ARRAY['terrain_overrides',code],'"heavy_smoke"'::jsonb,true);st:=jsonb_set(st,'{generated_smoke_hexes}',st->'generated_smoke_hexes'||to_jsonb(code),true);END IF;
  IF (light_hex->>'col')::int BETWEEN 0 AND 15 AND (light_hex->>'row')::int BETWEEN 0 AND 11 THEN code:=lpad(light_hex->>'col',2,'0')||lpad(light_hex->>'row',2,'0');st:=jsonb_set(st,ARRAY['terrain_overrides',code],'"light_smoke"'::jsonb,true);st:=jsonb_set(st,'{generated_smoke_hexes}',st->'generated_smoke_hexes'||to_jsonb(code),true);END IF;
  FOR building_code IN SELECT key FROM jsonb_each(st->'building_cf') WHERE btech_hex_distance((fire_hex->>'col')::int,(fire_hex->>'row')::int,left(key,2)::int,right(key,2)::int)=1 LOOP
   cf:=coalesce((st->'building_cf'->>building_code)::int,40);st:=jsonb_set(st,ARRAY['building_cf',building_code],to_jsonb(greatest(0,cf-5)),true);
   events:=events||jsonb_build_array(jsonb_build_object('type','building_fire_damage','hex',building_code,'damage',5,'construction_factor_after',greatest(0,cf-5)));
   IF cf<=5 THEN st:=jsonb_set(st,ARRAY['terrain_overrides',building_code],'"rubble"'::jsonb,true);events:=events||jsonb_build_array(jsonb_build_object('type','building_collapse','hex',building_code));END IF;
  END LOOP;
 END LOOP;
 st:=jsonb_set(st,'{terrain_advanced_after_round}',to_jsonb(p_completed_round),true);st:=jsonb_set(st,'{terrain_events}',events,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.btech_advance_terrain_round(uuid,int) FROM PUBLIC;

-- The last Heat activation advances the round inside the shared phase core.
-- Advance terrain immediately afterwards, exactly once for that completed round.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('terrain_round_lifecycle_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'PERFORM submit_phase_state_nonphysical_core(p_game_id,units);','PERFORM submit_phase_state_nonphysical_core(p_game_id,units);PERFORM btech_advance_terrain_round(p_game_id,g.current_round); /* terrain_round_lifecycle_v1 */');
 patched:=replace(patched,'PERFORM submit_phase_state_nonphysical_core(p_game_id, units);','PERFORM submit_phase_state_nonphysical_core(p_game_id, units);PERFORM btech_advance_terrain_round(p_game_id,g.current_round); /* terrain_round_lifecycle_v1 */');
 IF patched=source OR position('terrain_round_lifecycle_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install terrain round lifecycle';END IF;EXECUTE patched;
END $$;
