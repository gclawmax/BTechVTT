-- Immutable custom battlefield snapshots for the Map & Scenario Editor.
-- Run after SQL/88_arm_flipping_and_improvised_clubs.sql.

CREATE TABLE IF NOT EXISTS public.btech_custom_scenarios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 definition jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.btech_custom_scenarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.btech_custom_scenarios FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_btech_custom_scenario(p_definition jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE scenario_id uuid;terrain_code text;terrain_type text;elevation_code text;elevation_value jsonb;zone_one jsonb;zone_two jsonb;valid_code text:='^(0[0-9]|1[0-5])(0[0-9]|1[01])$';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before saving a custom scenario';END IF;
 IF jsonb_typeof(p_definition)<>'object' THEN RAISE EXCEPTION 'Scenario definition must be an object';END IF;
 IF length(trim(coalesce(p_definition->>'name',''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Scenario name must contain 1 to 80 characters';END IF;
 IF length(coalesce(p_definition->>'description',''))>240 OR length(coalesce(p_definition->>'instructions',''))>600 THEN RAISE EXCEPTION 'Scenario description or instructions are too long';END IF;
 IF coalesce((p_definition->>'dropship_tonnage')::int,0) NOT IN (100,150,200,250) THEN RAISE EXCEPTION 'Choose a supported dropship tonnage';END IF;
 IF coalesce(p_definition->>'victory_mode','') NOT IN ('annihilation','control','breakthrough') THEN RAISE EXCEPTION 'Choose a supported victory condition';END IF;
 IF jsonb_typeof(coalesce(p_definition->'terrain','{}'::jsonb))<>'object' OR jsonb_typeof(coalesce(p_definition->'elevation','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Terrain and elevation must be objects';END IF;
 FOR terrain_code,terrain_type IN SELECT key,value#>>'{}' FROM jsonb_each(coalesce(p_definition->'terrain','{}'::jsonb)) LOOP
  IF terrain_code !~ valid_code OR terrain_type NOT IN ('clear','light_woods','heavy_woods','rough','rubble','pavement','shallow_water','deep_water','building','fire','light_smoke','heavy_smoke','ice','deep_snow','mud','sand','swamp','bridge','magma_crust','magma_liquid','impassable') THEN RAISE EXCEPTION 'Unsupported terrain at hex %',terrain_code;END IF;
 END LOOP;
 FOR elevation_code,elevation_value IN SELECT key,value FROM jsonb_each(coalesce(p_definition->'elevation','{}'::jsonb)) LOOP
  IF elevation_code !~ valid_code OR jsonb_typeof(elevation_value)<>'number' OR (elevation_value#>>'{}')::int NOT BETWEEN 0 AND 3 THEN RAISE EXCEPTION 'Elevation at % must be level 0 to 3',elevation_code;END IF;
 END LOOP;
 zone_one:=p_definition->'deployment_zones'->'1';zone_two:=p_definition->'deployment_zones'->'2';
 IF coalesce(jsonb_typeof(zone_one),'null')<>'array' OR coalesce(jsonb_typeof(zone_two),'null')<>'array' THEN RAISE EXCEPTION 'Both players need deployment zones';END IF;
 IF jsonb_array_length(zone_one)=0 OR jsonb_array_length(zone_two)=0 THEN RAISE EXCEPTION 'Both players need deployment zones';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(zone_one||zone_two) AS zone_codes(code) WHERE zone_codes.code !~ valid_code) THEN RAISE EXCEPTION 'A deployment zone contains an invalid hex';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(zone_one) AS zone_one_codes(code) JOIN jsonb_array_elements_text(zone_two) AS zone_two_codes(code) ON zone_one_codes.code=zone_two_codes.code) THEN RAISE EXCEPTION 'Player deployment zones cannot overlap';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(zone_one) AS zone_codes(code) WHERE coalesce(p_definition->'terrain'->>zone_codes.code,'clear') NOT IN ('building','impassable','magma_liquid')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(zone_two) AS zone_codes(code) WHERE coalesce(p_definition->'terrain'->>zone_codes.code,'clear') NOT IN ('building','impassable','magma_liquid')) THEN RAISE EXCEPTION 'Each deployment zone needs a passable hex';END IF;
 IF jsonb_typeof(coalesce(p_definition->'objective_hexes','[]'::jsonb))<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_definition->'objective_hexes','[]'::jsonb)) AS objective_codes(code) WHERE objective_codes.code !~ valid_code) THEN RAISE EXCEPTION 'Objective hexes must be valid battlefield hexes';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_definition->'objective_hexes','[]'::jsonb)) AS objective_codes(code) WHERE coalesce(p_definition->'terrain'->>objective_codes.code,'clear') IN ('building','impassable','magma_liquid')) THEN RAISE EXCEPTION 'Objectives must be placed on passable hexes';END IF;
 IF p_definition->>'victory_mode'='control' AND jsonb_array_length(coalesce(p_definition->'objective_hexes','[]'::jsonb))=0 THEN RAISE EXCEPTION 'Objective Control requires at least one objective hex';END IF;
 INSERT INTO btech_custom_scenarios(owner_id,definition) VALUES(auth.uid(),p_definition) RETURNING id INTO scenario_id;
 RETURN scenario_id;
END $$;
REVOKE ALL ON FUNCTION public.save_btech_custom_scenario(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_btech_custom_scenario(jsonb) TO authenticated;

-- Existing rules continue to call these two map functions. Custom IDs resolve
-- their immutable server snapshot, so movement, LOS, displacement and physical
-- attacks all consume the same authored terrain and elevation automatically.
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
 ELSE 'clear' END;
END $$;

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
 ELSE 0 END;
END $$;

CREATE OR REPLACE FUNCTION public.btech_scenario_zone_contains(p_state jsonb,p_seat int,p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN jsonb_typeof(p_state->'deployment_zones'->p_seat::text)='array'
  THEN (p_state->'deployment_zones'->p_seat::text) ? p_code
  ELSE CASE WHEN p_seat=1 THEN left(p_code,2)::int<=4 ELSE left(p_code,2)::int>=11 END END
$$;
REVOKE ALL ON FUNCTION public.btech_scenario_zone_contains(jsonb,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_match_deployment(p_game_id uuid,p_positions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;roster jsonb;all_positions jsonb;count_required int;
BEGIN
 IF jsonb_typeof(p_positions)<>'array' THEN RAISE EXCEPTION 'Deployment positions must be an array';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Deployment can be changed only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 roster:=coalesce(st->'rosters'->player.seat_number::text,'[]'::jsonb);count_required:=jsonb_array_length(roster);
 IF jsonb_array_length(p_positions)>count_required THEN RAISE EXCEPTION 'Deployment includes more BattleMechs than the roster';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) position WHERE jsonb_typeof(position)<>'object' OR (position->>'col') !~ '^[0-9]+$' OR (position->>'row') !~ '^[0-9]+$' OR (position->>'facing') !~ '^[0-5]$') THEN RAISE EXCEPTION 'Each deployment needs col, row and facing';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) position WHERE (position->>'col')::int NOT BETWEEN 0 AND 15 OR (position->>'row')::int NOT BETWEEN 0 AND 11 OR NOT btech_scenario_zone_contains(st,player.seat_number,lpad(position->>'col',2,'0')||lpad(position->>'row',2,'0')) OR btech_state_terrain(st,lpad(position->>'col',2,'0')||lpad(position->>'row',2,'0')) IN ('building','impassable','magma_liquid')) THEN RAISE EXCEPTION 'A BattleMech must deploy in a passable hex inside its own deployment zone';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_positions))<>(SELECT count(DISTINCT (position->>'col')||','||(position->>'row')) FROM jsonb_array_elements(p_positions) position) THEN RAISE EXCEPTION 'Two BattleMechs cannot occupy the same hex';END IF;
 all_positions:=coalesce(st->'deployment_positions','{}'::jsonb);
 IF EXISTS(SELECT 1 FROM jsonb_each(all_positions) owner,jsonb_array_elements(owner.value) occupied,jsonb_array_elements(p_positions) mine WHERE owner.key<>player.seat_number::text AND occupied->>'col'=mine->>'col' AND occupied->>'row'=mine->>'row') THEN RAISE EXCEPTION 'That deployment hex is already occupied';END IF;
 st:=jsonb_set(st,'{deployment_positions}',jsonb_set(coalesce(st->'deployment_positions','{}'::jsonb),ARRAY[player.seat_number::text],p_positions,true),true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN p_positions;
END $$;
REVOKE ALL ON FUNCTION public.set_match_deployment(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_deployment(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_score_scenario_round(p_game_id uuid,p_completed_round int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;mode text;scores jsonb;objectives jsonb;objective_hex text;owner_count int;holder int;unit jsonb;unit_id text;unit_owner int;unit_hex text;scored jsonb;winner int:=NULL;result jsonb:=NULL;threshold int;score_one int;score_two int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF g.current_round<=p_completed_round OR coalesce((st->>'objectives_scored_after_round')::int,0)>=p_completed_round OR st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN RETURN st->'match_result';END IF;
 mode:=coalesce(st->>'victory_mode','annihilation');scores:=coalesce(st->'objective_scores','{"1":0,"2":0}'::jsonb);objectives:=coalesce(st->'objective_hexes',btech_scenario_objective_hexes(coalesce(st->>'map_id','training-grounds')));scored:=coalesce(st->'breakthrough_scored_units','[]'::jsonb);
 IF mode='control' THEN
  FOR objective_hex IN SELECT jsonb_array_elements_text(objectives) LOOP
   SELECT count(DISTINCT (value->>'owner')::int),min((value->>'owner')::int) INTO owner_count,holder FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE NOT coalesce((value->>'destroyed')::boolean,false) AND lpad(value->>'col',2,'0')||lpad(value->>'row',2,'0')=objective_hex;
   IF owner_count=1 THEN scores:=jsonb_set(scores,ARRAY[holder::text],to_jsonb(coalesce((scores->>holder::text)::int,0)+1),true);END IF;
  END LOOP;threshold:=5;
 ELSIF mode='breakthrough' THEN
  FOR unit IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE NOT coalesce((value->>'destroyed')::boolean,false) LOOP
   unit_id:=unit->>'instanceId';unit_owner:=(unit->>'owner')::int;unit_hex:=lpad(unit->>'col',2,'0')||lpad(unit->>'row',2,'0');
   IF NOT (scored ? unit_id) AND btech_scenario_zone_contains(st,CASE WHEN unit_owner=1 THEN 2 ELSE 1 END,unit_hex) THEN scores:=jsonb_set(scores,ARRAY[unit_owner::text],to_jsonb(coalesce((scores->>unit_owner::text)::int,0)+1),true);scored:=scored||to_jsonb(unit_id);END IF;
  END LOOP;threshold:=2;
 ELSE threshold:=NULL;END IF;
 score_one:=coalesce((scores->>'1')::int,0);score_two:=coalesce((scores->>'2')::int,0);
 IF threshold IS NOT NULL AND (score_one>=threshold OR score_two>=threshold) THEN winner:=CASE WHEN score_one=score_two THEN NULL WHEN score_one>score_two THEN 1 ELSE 2 END;result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason',mode,'objective_scores',scores,'completed_round',p_completed_round);st:=jsonb_set(st,'{match_result}',result,true);st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);END IF;
 st:=jsonb_set(st,'{objective_scores}',scores,true);st:=jsonb_set(st,'{objective_hexes}',objectives,true);st:=jsonb_set(st,'{breakthrough_scored_units}',scored,true);st:=jsonb_set(st,'{objectives_scored_after_round}',to_jsonb(p_completed_round),true);
 IF result IS NULL THEN UPDATE btech_games SET state=st WHERE id=p_game_id;ELSE UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_score_scenario_round(uuid,int) FROM PUBLIC;
