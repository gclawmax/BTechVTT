-- Built-in terrain and elevation support for authoritative movement.
-- Run after SQL/34_authoritative_weapon_piloting.sql.

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code='0703' THEN 'light_woods' WHEN p_code='0903' THEN 'heavy_woods' WHEN p_code IN ('0604','0704','0904','0805') THEN 'rough' WHEN p_code='0804' THEN 'pavement' WHEN p_code IN ('0605','0705') THEN 'shallow_water' WHEN p_code='0905' THEN 'impassable' ELSE 'clear' END
 ELSE 'clear' END $$;

CREATE OR REPLACE FUNCTION public.btech_elevation(p_map text,p_code text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_map='ridge-and-ford' AND p_code IN ('0703','0803','0903','0704','0804','0904','0805') THEN 1 ELSE 0 END
$$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Authoritative movement resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_elevation' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'unit_definition jsonb;action jsonb;action_type text;next_col int;next_row int;direction int;terrain_cost int;','unit_definition jsonb;action jsonb;action_type text;next_col int;next_row int;direction int;terrain_cost int;current_level int;next_level int;');
 patched:=replace(patched,'current_col:=(mech->>''col'')::int;current_row:=(mech->>''row'')::int;current_facing:=coalesce((mech->>''facing'')::int,0);','current_col:=(mech->>''col'')::int;current_row:=(mech->>''row'')::int;current_facing:=coalesce((mech->>''facing'')::int,0);current_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(current_col::text,2,''0'')||lpad(current_row::text,2,''0''));');
 patched:=replace(patched,
  E'   terrain_cost:=CASE btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0'')) WHEN ''light_woods'' THEN 1 WHEN ''heavy_woods'' THEN 2 ELSE 0 END;',
  E'   IF btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''))=''impassable'' THEN RAISE EXCEPTION ''That terrain is impassable'';END IF;
   next_level:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''));
   IF abs(next_level-current_level)>1 THEN RAISE EXCEPTION ''A BattleMech can climb or descend only one elevation level at a time'';END IF;
   terrain_cost:=CASE btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0'')) WHEN ''light_woods'' THEN 1 WHEN ''heavy_woods'' THEN 2 WHEN ''rough'' THEN 1 WHEN ''shallow_water'' THEN 1 ELSE 0 END;');
 patched:=replace(patched,
  E'   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 THEN RAISE EXCEPTION ''Jump landing is outside the map'';END IF;',
  E'   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 THEN RAISE EXCEPTION ''Jump landing is outside the map'';END IF;
   IF btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''))=''impassable'' THEN RAISE EXCEPTION ''That terrain cannot be used as a jump landing'';END IF;');
 patched:=replace(patched,'current_col:=next_col;current_row:=next_row;hexes_moved:=hexes_moved+1;','current_col:=next_col;current_row:=next_row;current_level:=next_level;hexes_moved:=hexes_moved+1;');
 IF patched=source OR position('current_level' IN patched)=0 OR position('shallow_water' IN patched)=0 THEN RAISE EXCEPTION 'Movement resolver markers were not found';END IF;
 EXECUTE patched;
END $$;
