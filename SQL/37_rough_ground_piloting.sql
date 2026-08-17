-- Server-authoritative rough-ground Piloting Skill Rolls during movement.
-- Run after SQL/35_terrain_and_elevation.sql.

CREATE OR REPLACE FUNCTION public.btech_resolve_rough_ground_piloting_check(
 p_catalogue_version text,p_mech jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE
 unit_mech jsonb:=p_mech;unit_mass int;gyro_hits int;die_a int;die_b int;target_number int;passed boolean;
 fall_die int;fall_angle text;remaining int;group_damage int;location_roll jsonb;damage_result jsonb;fall_groups jsonb:='[]'::jsonb;
BEGIN
 SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units
  WHERE catalogue_version=p_catalogue_version AND unit_id=unit_mech->>'unitId';
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=unit_mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
   AND btech_critical_slot_is_damaged(unit_mech,slot.location,slot.slot_index);
 target_number:=greatest(2,coalesce((unit_mech->>'pilotingSkill')::int,5)+(gyro_hits*3));
 die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);
 passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);
 IF NOT passed THEN
  fall_die:=floor(random()*6+1);fall_angle:=CASE WHEN fall_die<=2 THEN 'front' WHEN fall_die<=4 THEN 'left' ELSE 'right' END;
  unit_mech:=jsonb_set(unit_mech,'{prone}','true'::jsonb,true);
  remaining:=ceil(coalesce(unit_mass,0)/10.0)::int;
  WHILE remaining>0 AND NOT coalesce((unit_mech->>'destroyed')::boolean,false) LOOP
   group_damage:=least(5,remaining);remaining:=remaining-group_damage;
   location_roll:=btech_roll_mech_hit_location(fall_angle);
   damage_result:=btech_apply_direct_damage(unit_mech,group_damage,location_roll->>'location',false);
   unit_mech:=damage_result->'mech';
   fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object(
    'damage',group_damage,'location_roll',location_roll,'location',location_roll->>'location',
    'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
  END LOOP;
 END IF;
 RETURN jsonb_build_object('mech',unit_mech,'check',jsonb_build_object(
  'instance_id',unit_mech->>'instanceId','reasons',jsonb_build_array('running through rough ground'),
  'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number,'gyro_modifier',gyro_hits*3),
  'passed',passed,'fell',NOT passed,'fall_direction_die',CASE WHEN passed THEN NULL ELSE fall_die END,
  'fall_angle',CASE WHEN passed THEN NULL ELSE fall_angle END,
  'fall_damage',CASE WHEN passed THEN 0 ELSE ceil(coalesce(unit_mass,0)/10.0)::int END,'fall_groups',fall_groups));
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_rough_ground_piloting_check(text,jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Authoritative movement resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_resolve_rough_ground_piloting_check' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'current_level int;next_level int;',
  'current_level int;next_level int;rough_ground_run boolean:=false;terrain_check jsonb;');
 patched:=replace(patched,
  E'current_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''));',
  E'current_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''));rough_ground_run:=false;');
 patched:=replace(patched,
  E'terrain_cost:=CASE btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0'')) WHEN ''light_woods'' THEN 1 WHEN ''heavy_woods'' THEN 2 WHEN ''rough'' THEN 1 WHEN ''shallow_water'' THEN 1 ELSE 0 END;',
  E'terrain_cost:=CASE btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0'')) WHEN ''light_woods'' THEN 1 WHEN ''heavy_woods'' THEN 2 WHEN ''rough'' THEN 1 WHEN ''shallow_water'' THEN 1 ELSE 0 END;\n   IF p_mode=''run'' AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''))=''rough'' THEN rough_ground_run:=true;END IF;');
 patched:=replace(patched,
  E' SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;',
  E' IF rough_ground_run THEN terrain_check:=btech_resolve_rough_ground_piloting_check(g.catalogue_version,mech);mech:=terrain_check->''mech'';END IF;\n SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;');
 patched:=replace(patched,
  E'''movement_heat'',movement_heat);',
  E'''movement_heat'',movement_heat,''terrain_check'',terrain_check->''check'');');
 IF patched=source OR position('rough_ground_run' IN patched)=0 OR position('terrain_check' IN patched)=0 THEN RAISE EXCEPTION 'Movement resolver rough-ground markers were not found';END IF;
 EXECUTE patched;
END $$;
