-- Complete the common BattleMech terrain rules used by the bundled maps.
-- Run after SQL/62_complete_destruction_consequences.sql.

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code='0703' THEN 'light_woods' WHEN p_code='0903' THEN 'heavy_woods' WHEN p_code IN ('0604','0704','0904','0805') THEN 'rough' WHEN p_code='0804' THEN 'pavement' WHEN p_code IN ('0605','0705') THEN 'shallow_water' WHEN p_code='0905' THEN 'impassable' ELSE 'clear' END
 WHEN 'flatlands-open-terrain' THEN CASE
  WHEN p_code IN ('0202','0303','0104','0907','1008','1108','0211') THEN 'heavy_woods'
  WHEN p_code IN ('0102','0302','0103','0203','0204','0906','0908','1007','1009','1109','0111','0311') THEN 'light_woods' ELSE 'clear' END
 WHEN 'desert-hills' THEN CASE WHEN p_code IN ('0600','0601','0602','0603','0705','0706','0707','0708','0709','0809','0810','1308') THEN 'rough' ELSE 'clear' END
 ELSE 'clear' END
$$;

CREATE OR REPLACE FUNCTION public.btech_elevation(p_map text,p_code text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code IN ('0703','0803','0903','0704','0804','0904','0805') THEN 1 ELSE 0 END
 WHEN 'desert-hills' THEN CASE
  WHEN p_code IN ('1108','1109') THEN 3
  WHEN p_code IN ('0301','0202','0302','0203','0303','1101','1002','1102','1003','1004','1107','1207','1008','1208','1009','1209','1110','1210','1406','1307','1407','1308') THEN 2
  WHEN p_code IN ('0200','0300','0400','0201','0401','0402','0403','0204','0304','0305','0405','1000','1100','1001','1103','1104','0904','0905','0805','0806','0906','1007','1306','0911','1011','1111','1211','1311') THEN 1 ELSE 0 END
 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.btech_battlemech_level(p_map text,p_code text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE public.btech_terrain(p_map,p_code) WHEN 'shallow_water' THEN -1 WHEN 'deep_water' THEN -2 ELSE public.btech_elevation(p_map,p_code) END
$$;

CREATE OR REPLACE FUNCTION public.btech_battlemech_terrain_cost(p_terrain text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_terrain WHEN 'light_woods' THEN 1 WHEN 'heavy_woods' THEN 2 WHEN 'rough' THEN 1 WHEN 'rubble' THEN 1 WHEN 'shallow_water' THEN 1 WHEN 'deep_water' THEN 3 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.btech_submerged_leg_jump_jets(p_version text,p_mech jsonb)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT count(*)::int FROM btech_catalogue_critical_slots slot
 WHERE slot.catalogue_version=p_version AND slot.unit_id=p_mech->>'unitId' AND slot.location IN ('ll','rl')
   AND btech_equipment_label_key(slot.label)='jumpjet'
   AND NOT btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index)
$$;

-- SQL/61 installed the maintained movement resolver in full.  Apply this
-- tightly checked terrain extension to that known revision.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('complete_common_terrain_v1' IN source)>0 THEN RETURN;END IF;
 IF position('btech_critical_movement_profile' IN source)=0 THEN RAISE EXCEPTION 'Run SQL/61 before SQL/63';END IF;
 patched:=replace(source,'movement_heat int;path_length int;mobility jsonb;rough_ground_run boolean:=false;critical_check boolean:=false;',
  'movement_heat int;path_length int;mobility jsonb;water_entry boolean:=false;rubble_entry boolean:=false;critical_check boolean:=false; /* complete_common_terrain_v1 */');
 patched:=replace(patched,
  'current_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''));',
  'current_level:=btech_battlemech_level(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''));IF p_mode=''jump'' AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''))=''deep_water'' THEN RAISE EXCEPTION ''A submerged BattleMech cannot use its jump jets'';ELSIF p_mode=''jump'' AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''))=''shallow_water'' THEN mp_max:=greatest(0,mp_max-btech_submerged_leg_jump_jets(g.catalogue_version,mech));IF mp_max=0 THEN RAISE EXCEPTION ''No torso jump jets remain available above the water'';END IF;END IF;');
 patched:=replace(patched,
  'next_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''));',
  'next_level:=btech_battlemech_level(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''));');
 patched:=replace(patched,
  'IF abs(next_level-current_level)>1 THEN RAISE EXCEPTION ''A BattleMech can climb or descend only one elevation level at a time'';END IF;',
  'IF abs(next_level-current_level)>2 THEN RAISE EXCEPTION ''A BattleMech cannot cross a level change greater than two'';END IF;IF direction=(current_facing+3)%6 AND next_level<>current_level THEN RAISE EXCEPTION ''A BattleMech cannot change levels while moving backward'';END IF;IF p_mode=''run'' AND terrain_name IN (''shallow_water'',''deep_water'') THEN RAISE EXCEPTION ''A running BattleMech cannot enter water'';END IF;');
 patched:=replace(patched,
  'terrain_cost:=CASE terrain_name WHEN ''light_woods'' THEN 1 WHEN ''heavy_woods'' THEN 2 WHEN ''rough'' THEN 1 WHEN ''shallow_water'' THEN 1 ELSE 0 END;',
  'terrain_cost:=btech_battlemech_terrain_cost(terrain_name)+abs(next_level-current_level);');
 patched:=replace(patched,
  'IF p_mode=''run'' AND terrain_name=''rough'' THEN rough_ground_run:=true;END IF;',
  'IF terrain_name IN (''shallow_water'',''deep_water'') THEN water_entry:=true;END IF;IF terrain_name=''rubble'' THEN rubble_entry:=true;END IF;');
 patched:=replace(patched,
  'IF rough_ground_run THEN reasons:=array_append(reasons,''running through rough ground'');END IF;',
  'IF water_entry THEN reasons:=array_append(reasons,''entering water'');END IF;IF rubble_entry THEN reasons:=array_append(reasons,''entering rubble'');END IF;');
 patched:=replace(patched,
  '''terrain_check'',CASE WHEN rough_ground_run THEN check_payload END)',
  '''terrain_check'',CASE WHEN water_entry OR rubble_entry THEN check_payload END)');
 IF patched=source OR position('complete_common_terrain_v1' IN patched)=0 OR position('rough_ground_run' IN patched)>0 THEN RAISE EXCEPTION 'Could not safely install the common terrain rules';END IF;
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public.btech_battlemech_level(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_battlemech_terrain_cost(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_submerged_leg_jump_jets(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_battlemech_level(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_battlemech_terrain_cost(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_submerged_leg_jump_jets(text,jsonb) TO authenticated;
