-- Original built-in tactical maps for the Vs AI and human skirmish catalogues.
-- Run after SQL/130_private_minefield_rules_and_delivery.sql.
-- The browser and server intentionally share these named layouts so movement,
-- LOS, objectives, deployment and previews use the same terrain.

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE custom_id uuid;definition jsonb;
BEGIN
 IF p_map LIKE 'custom:%' THEN
  BEGIN custom_id:=substring(p_map FROM 8)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN 'clear';END;
  SELECT scenario.definition INTO definition FROM btech_custom_scenarios scenario WHERE scenario.id=custom_id;
  RETURN coalesce(definition->'terrain'->>p_code,'clear');
 END IF;
 RETURN CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code='0703' THEN 'light_woods' WHEN p_code='0903' THEN 'heavy_woods' WHEN p_code IN ('0604','0704','0904','0805') THEN 'rough' WHEN p_code='0804' THEN 'pavement' WHEN p_code IN ('0605','0705') THEN 'shallow_water' WHEN p_code='0905' THEN 'impassable' ELSE 'clear' END
 WHEN 'flatlands-open-terrain' THEN CASE WHEN p_code IN ('0202','0303','0104','0907','1008','1108','0211') THEN 'heavy_woods' WHEN p_code IN ('0102','0302','0103','0203','0204','0906','0908','1007','1009','1109','0111','0311') THEN 'light_woods' ELSE 'clear' END
 WHEN 'desert-hills' THEN CASE WHEN p_code IN ('0600','0601','0602','0603','0705','0706','0707','0708','0709','0809','0810','1308') THEN 'rough' ELSE 'clear' END
 WHEN 'industrial-crossing' THEN CASE WHEN p_code IN ('0700','0800','0701','0801','0702','0802','0703','0803','0704','0804','0705','0805','0706','0806','0707','0807','0708','0808','0709','0809','0710','0810','0711','0811') THEN 'pavement' WHEN p_code IN ('0305','0405','0505') THEN 'deep_water' WHEN p_code IN ('0205','0605') THEN 'shallow_water' WHEN p_code IN ('0503','1008') THEN 'rubble' WHEN p_code IN ('0603','0903','0608','0908') THEN 'building' WHEN p_code='1004' THEN 'fire' WHEN p_code='1104' THEN 'light_smoke' WHEN p_code='1204' THEN 'heavy_smoke' ELSE 'clear' END
 WHEN 'weathered-frontier' THEN CASE WHEN p_code IN ('0102','0202','0502','1209') THEN 'deep_snow' WHEN p_code IN ('0302','0402','1009','1109') THEN 'ice' WHEN p_code IN ('0203','0303','1010') THEN 'mud' WHEN p_code IN ('0403','0503','1110') THEN 'swamp' WHEN p_code IN ('0700','0701','0702','0800','0801','0802') THEN 'sand' WHEN p_code IN ('0905','1105','1305') THEN 'shallow_water' WHEN p_code IN ('1005','1205') THEN 'bridge' WHEN p_code IN ('0308','0408','0309','0409') THEN 'magma_crust' WHEN p_code='0508' THEN 'impassable' ELSE 'clear' END
 WHEN 'river-delta' THEN CASE WHEN p_code IN ('0400','0401','0501','1004','1005','1106','1209') THEN 'shallow_water' WHEN p_code IN ('0502','0602','0703','0803','0904','1107','1208') THEN 'deep_water' WHEN p_code IN ('0704','1105') THEN 'bridge' WHEN p_code IN ('0203','0303','0304','0404','1202','1402','1203','1303','0709','0909','0808','0908') THEN 'light_woods' WHEN p_code IN ('0204','1302','0809') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'city-ruins' THEN CASE WHEN p_code IN ('0302','0402','0303','1107','1207','0309','0408') THEN 'building' WHEN p_code IN ('0403','0503','1203','1108','1208','0409','0308') THEN 'rubble' WHEN p_code IN ('0603','0703','0803','0903','1003','1103','0604','0704','0804','0904','1004','0605','0705','0805','0905','1005','0606','0706','0806','0906','1006','0607','0707','0807','0907','1007','0608','0708','0808','0908','1008','0609','0709','0809','0909','1009','0610','0710','0810','0910','1010') THEN 'pavement' WHEN p_code='0206' THEN 'fire' WHEN p_code='1305' THEN 'light_smoke' WHEN p_code='1306' THEN 'heavy_smoke' ELSE 'clear' END
 WHEN 'forest-lanes' THEN CASE WHEN p_code IN ('0301','0501','0502','0203','0403','0804','1004','0705','1005','0806','1006','0309','0509','0510','0211','0411','1311','1412') THEN 'light_woods' WHEN p_code IN ('0401','0302','0402','0303','0904','0805','0905','0906','0409','0310','0410','0311','1411','1312') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'rolling-highlands' THEN CASE WHEN p_code IN ('0404','0504','0604','0405','0505','0605','1006','1106','1206','1007','1107','1207','0710','0810','0910','0811') THEN 'rough' ELSE 'clear' END
 WHEN 'badlands-run' THEN CASE WHEN p_code IN ('0202','0302','0402','0203','0303','0403','0503') THEN 'sand' WHEN p_code IN ('0802','0902','1002','0803','0903','1003','1103','0904','1004') THEN 'rough' WHEN p_code IN ('0509','0609','0709','0710','0810','0711') THEN 'magma_crust' WHEN p_code='0610' THEN 'magma_liquid' WHEN p_code IN ('1208','1408','1209','1309') THEN 'light_woods' WHEN p_code IN ('1308','1409') THEN 'heavy_woods' ELSE 'clear' END
 ELSE 'clear' END;
END $$;
REVOKE ALL ON FUNCTION public.btech_terrain(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_elevation(p_map text,p_code text)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE custom_id uuid;definition jsonb;
BEGIN
 IF p_map LIKE 'custom:%' THEN
  BEGIN custom_id:=substring(p_map FROM 8)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN 0;END;
  SELECT scenario.definition INTO definition FROM btech_custom_scenarios scenario WHERE scenario.id=custom_id;
  RETURN coalesce((definition->'elevation'->>p_code)::int,0);
 END IF;
 RETURN CASE p_map
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code IN ('0703','0803','0903','0704','0804','0904','0805') THEN 1 ELSE 0 END
 WHEN 'desert-hills' THEN CASE WHEN p_code IN ('1108','1109') THEN 3 WHEN p_code IN ('0301','0202','0302','0203','0303','1101','1002','1102','1003','1004','1107','1207','1008','1208','1009','1209','1110','1210','1406','1307','1407','1308') THEN 2 WHEN p_code IN ('0200','0300','0400','0201','0401','0402','0403','0204','0304','0305','0405','1000','1100','1001','1103','1104','0904','0905','0805','0806','0906','1007','1306','0911','1011','1111','1211','1311') THEN 1 ELSE 0 END
 WHEN 'rolling-highlands' THEN CASE WHEN p_code IN ('0505','1106') THEN 3 WHEN p_code IN ('0404','0504','0604','0405','0605','0506','1006','1206','1007','1107','1207') THEN 2 WHEN p_code IN ('0403','0503','0603','0304','0704','0305','0705','0406','0606','1005','1105','1205','0906','1306','0907','1307','1008','1108','0709','0809','0909','0710','0910','0811') THEN 1 ELSE 0 END
 ELSE 0 END;
END $$;
REVOKE ALL ON FUNCTION public.btech_elevation(text,text) FROM PUBLIC;

-- Initialise every printed building, not just the older Industrial Crossing
-- fixtures. This keeps collision, destruction and LOS state authoritative on
-- the new City Ruins layout and on future built-in maps with structures.
CREATE OR REPLACE FUNCTION public.btech_initialise_terrain_state(p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE st jsonb:=coalesce(p_state,'{}'::jsonb);code text;cf jsonb:=coalesce(st->'building_cf','{}'::jsonb);dimensions jsonb;col_number int;row_number int;
BEGIN
 dimensions:=btech_map_dimensions(coalesce(st->>'map_id','training-grounds'));
 FOR col_number IN 0..greatest(0,(dimensions->>'columns')::int-1) LOOP
  FOR row_number IN 0..greatest(0,(dimensions->>'rows')::int-1) LOOP
   code:=lpad(col_number::text,2,'0')||lpad(row_number::text,2,'0');
   IF btech_state_terrain(st,code)='building' AND NOT (cf ? code) THEN cf:=jsonb_set(cf,ARRAY[code],'40'::jsonb,true);END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_set(jsonb_set(st,'{building_cf}',cf,true),'{terrain_overrides}',coalesce(st->'terrain_overrides','{}'::jsonb),true);
END $$;
REVOKE ALL ON FUNCTION public.btech_initialise_terrain_state(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_scenario_objective_hexes(p_map_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map_id
  WHEN 'standard-single-sheet' THEN '["0406","0808","1110"]'::jsonb WHEN 'standard-dual-vertical' THEN '["0408","0816","1125"]'::jsonb WHEN 'standard-dual-horizontal' THEN '["0806","1508","2310"]'::jsonb
  WHEN 'industrial-crossing' THEN '["0703","0806","0809"]'::jsonb WHEN 'desert-hills' THEN '["0302","0906","1108"]'::jsonb WHEN 'flatlands-open-terrain' THEN '["0505","0806","1108"]'::jsonb WHEN 'ridge-and-ford' THEN '["0704","0804","0805"]'::jsonb WHEN 'weathered-frontier' THEN '["0403","1005","0408"]'::jsonb
  WHEN 'river-delta' THEN '["0704","1105","0909"]'::jsonb WHEN 'city-ruins' THEN '["0705","0908","1207"]'::jsonb WHEN 'forest-lanes' THEN '["0503","0905","0410"]'::jsonb WHEN 'rolling-highlands' THEN '["0505","1106","0810"]'::jsonb WHEN 'badlands-run' THEN '["0903","0709","1308"]'::jsonb
  ELSE '["0704","0806","0808"]'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.btech_scenario_objective_hexes(text) FROM PUBLIC;
