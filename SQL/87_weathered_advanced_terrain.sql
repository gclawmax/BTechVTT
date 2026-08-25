-- Additional BattleMech terrain: ice, snow, mud, sand, swamp, magma and bridges.
-- Run after SQL/86_authoritative_startup_pilot_rules.sql.

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code='0703' THEN 'light_woods' WHEN p_code='0903' THEN 'heavy_woods' WHEN p_code IN ('0604','0704','0904','0805') THEN 'rough' WHEN p_code='0804' THEN 'pavement' WHEN p_code IN ('0605','0705') THEN 'shallow_water' WHEN p_code='0905' THEN 'impassable' ELSE 'clear' END
 WHEN 'flatlands-open-terrain' THEN CASE WHEN p_code IN ('0202','0303','0104','0907','1008','1108','0211') THEN 'heavy_woods' WHEN p_code IN ('0102','0302','0103','0203','0204','0906','0908','1007','1009','1109','0111','0311') THEN 'light_woods' ELSE 'clear' END
 WHEN 'desert-hills' THEN CASE WHEN p_code IN ('0600','0601','0602','0603','0705','0706','0707','0708','0709','0809','0810','1308') THEN 'rough' ELSE 'clear' END
 WHEN 'industrial-crossing' THEN CASE WHEN p_code IN ('0700','0800','0701','0801','0702','0802','0703','0803','0704','0804','0705','0805','0706','0806','0707','0807','0708','0808','0709','0809','0710','0810','0711','0811') THEN 'pavement' WHEN p_code IN ('0305','0405','0505') THEN 'deep_water' WHEN p_code IN ('0205','0605') THEN 'shallow_water' WHEN p_code IN ('0503','1008') THEN 'rubble' WHEN p_code IN ('0603','0903','0608','0908') THEN 'building' WHEN p_code='1004' THEN 'fire' WHEN p_code='1104' THEN 'light_smoke' WHEN p_code='1204' THEN 'heavy_smoke' ELSE 'clear' END
 WHEN 'weathered-frontier' THEN CASE
  WHEN p_code IN ('0102','0202','0502','1209') THEN 'deep_snow' WHEN p_code IN ('0302','0402','1009','1109') THEN 'ice'
  WHEN p_code IN ('0203','0303','1010') THEN 'mud' WHEN p_code IN ('0403','0503','1110') THEN 'swamp'
  WHEN p_code IN ('0700','0701','0702','0800','0801','0802') THEN 'sand'
  WHEN p_code IN ('0905','1105','1305') THEN 'shallow_water' WHEN p_code IN ('1005','1205') THEN 'bridge'
  WHEN p_code IN ('0308','0408','0309','0409') THEN 'magma_crust' WHEN p_code='0508' THEN 'impassable' ELSE 'clear' END
 ELSE 'clear' END
$$;

CREATE OR REPLACE FUNCTION public.btech_scenario_objective_hexes(p_map_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map_id WHEN 'industrial-crossing' THEN '["0703","0806","0809"]'::jsonb WHEN 'desert-hills' THEN '["0302","0906","1108"]'::jsonb WHEN 'flatlands-open-terrain' THEN '["0505","0806","1108"]'::jsonb WHEN 'ridge-and-ford' THEN '["0704","0804","0805"]'::jsonb WHEN 'weathered-frontier' THEN '["0403","1005","0408"]'::jsonb ELSE '["0704","0806","0808"]'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.btech_scenario_objective_hexes(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_magma_crust(p_state jsonb,p_mech jsonb,p_mode text,p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;m jsonb:=p_mech;die int:=floor(random()*6+1);target int:=CASE WHEN p_mode='jump' THEN 4 ELSE 6 END;breached boolean;damage int;result jsonb;events jsonb:='[]'::jsonb;
BEGIN
 breached:=die>=target;
 IF breached THEN
  st:=jsonb_set(st,'{terrain_overrides}',coalesce(st->'terrain_overrides','{}'::jsonb),true);
  st:=jsonb_set(st,ARRAY['terrain_overrides',p_code],'"impassable"'::jsonb,true);
  damage:=floor(random()*6+1)+floor(random()*6+1);result:=btech_apply_direct_damage(m,damage,'ll',false);m:=result->'mech';events:=events||jsonb_build_array(jsonb_build_object('location','ll','damage',damage,'critical_checks',result->'critical_checks'));
  damage:=floor(random()*6+1)+floor(random()*6+1);result:=btech_apply_direct_damage(m,damage,'rl',false);m:=result->'mech';events:=events||jsonb_build_array(jsonb_build_object('location','rl','damage',damage,'critical_checks',result->'critical_checks'));
 END IF;
 RETURN jsonb_build_object('state',st,'mech',m,'hex',p_code,'die',die,'target',target,'breached',breached,'damage',events);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_magma_crust(jsonb,jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_battlemech_terrain_cost(p_terrain text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_terrain WHEN 'light_woods' THEN 1 WHEN 'heavy_woods' THEN 2 WHEN 'rough' THEN 1 WHEN 'rubble' THEN 1 WHEN 'shallow_water' THEN 1 WHEN 'deep_water' THEN 3 WHEN 'mud' THEN 1 WHEN 'deep_snow' THEN 1 WHEN 'ice' THEN 1 WHEN 'swamp' THEN 1 ELSE 0 END
$$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('weathered_terrain_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'/* advanced_terrain_interactions_v1 */','/* advanced_terrain_interactions_v1 */ extreme_terrain_check boolean:=false;magma_result jsonb;magma_events jsonb:=''[]''::jsonb;');
 patched:=replace(patched,'IN (''impassable'', ''building'')','IN (''impassable'', ''building'', ''magma_liquid'')');
 patched:=replace(patched,'IN (''impassable'',''building'')','IN (''impassable'',''building'',''magma_liquid'')');
 patched:=replace(patched,'IF terrain_name IN (''shallow_water'',''deep_water'') THEN water_entry:=true;END IF;', 'IF terrain_name IN (''shallow_water'',''deep_water'') THEN water_entry:=true;END IF;IF p_mode<>''jump'' AND terrain_name IN (''ice'',''swamp'') THEN extreme_terrain_check:=true;END IF; /* weathered_terrain_v1 */');
 patched:=replace(patched,'IF terrain_name=''fire'' THEN fire_hexes:=fire_hexes+1;END IF;','IF terrain_name IN (''fire'',''magma_crust'') THEN fire_hexes:=fire_hexes+1;END IF;');
 patched:=replace(patched,'IF terrain_name IN (''fire'',''magma_crust'') THEN fire_hexes:=fire_hexes+1;END IF;', 'IF terrain_name IN (''fire'',''magma_crust'') THEN fire_hexes:=fire_hexes+1;END IF;IF terrain_name=''magma_crust'' THEN magma_result:=btech_resolve_magma_crust(st,mech,p_mode,lpad(next_col::text,2,''0'')||lpad(next_row::text,2,''0''));st:=magma_result->''state'';mech:=magma_result->''mech'';magma_events:=magma_events||jsonb_build_array(magma_result-''state''-''mech'');END IF;');
 patched:=replace(patched,'IF water_entry THEN reasons:=array_append(reasons,''entering water'');END IF;', 'IF water_entry THEN reasons:=array_append(reasons,''entering water'');END IF;IF extreme_terrain_check THEN reasons:=array_append(reasons,''crossing unstable terrain'');END IF;');
 patched:=replace(patched,'CASE WHEN water_entry OR rubble_entry OR pavement_turn THEN check_payload END','CASE WHEN water_entry OR rubble_entry OR pavement_turn OR extreme_terrain_check THEN check_payload END');
 patched:=replace(patched,')=''fire'' THEN 5 ELSE 0 END',') IN (''fire'',''magma_crust'') THEN 5 ELSE 0 END');
 patched:=replace(patched,'SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END)', 'IF jsonb_array_length(magma_events)>0 THEN UPDATE btech_games SET state=st WHERE id=p_game_id;END IF; SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END)');
 patched:=replace(patched,'''movement_profile'',mobility', '''magma_crust_checks'',magma_events,''movement_profile'',mobility');
 patched:=replace(patched,'''movement_profile'', mobility', '''magma_crust_checks'',magma_events,''movement_profile'', mobility');
 IF patched=source OR position('weathered_terrain_v1' IN patched)=0 OR position('extreme_terrain_check' IN patched)=0 OR position('btech_resolve_magma_crust' IN patched)=0 OR position('magma_crust_checks' IN patched)=0 OR position('jsonb_array_length(magma_events)>0' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend the authoritative movement terrain rules';END IF;
 EXECUTE patched;
END $$;

-- SQL/85 installs the maintained heat resolver after the earlier fire patch.
-- Restore terrain heat against that exact current resolver and clear it once.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('weathered_heat_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5);','before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0); /* weathered_heat_v1 */');
 patched:=replace(patched,'mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);','mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);mech:=jsonb_set(mech,''{pendingTerrainHeat}'',''0''::jsonb,true);mech:=jsonb_set(mech,''{externalHeat}'',''0''::jsonb,true);');
 IF patched=source OR position('weathered_heat_v1' IN patched)=0 OR position('pendingTerrainHeat' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely restore terrain heat to the maintained heat resolver';END IF;
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public.btech_battlemech_terrain_cost(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_battlemech_terrain_cost(text) TO authenticated;
