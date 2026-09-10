-- Run after 151. Reuses the maintained hangar validation for the AI seat.
CREATE OR REPLACE FUNCTION public.update_ai_skirmish_force(p_game_id uuid,p_hangar jsonb,p_deployed jsonb,p_positions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;avatars jsonb;avatar jsonb;unit_ids jsonb;rosters jsonb;total_tonnage int;ruleset text;entry jsonb;pilot jsonb;normalized_hangar jsonb:='[]'::jsonb;bv_limit int;bv_value jsonb;
BEGIN
 IF jsonb_typeof(p_hangar)<>'array' OR jsonb_typeof(p_deployed)<>'array' THEN RAISE EXCEPTION 'Hangar and deployment must be arrays';END IF;
 IF jsonb_array_length(p_hangar)>12 OR jsonb_array_length(p_deployed)>6 THEN RAISE EXCEPTION 'A Skirmish Hangar may hold 12 BattleMechs and deploy 6';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_hangar) item WHERE jsonb_typeof(item)<>'object' OR coalesce(item->>'id','')='' OR coalesce(item->>'unit_id','')='') THEN RAISE EXCEPTION 'Each hangar entry needs an id and unit id';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_hangar))<>(SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_hangar) item) THEN RAISE EXCEPTION 'Each Hangar BattleMech needs a unique id';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_hangar) LOOP
  pilot:=entry->'pilot';IF pilot IS NULL THEN pilot:=jsonb_build_object('id','pilot-'||(entry->>'id'),'name','MechWarrior','gunnery',4,'piloting',5);ELSE IF jsonb_typeof(pilot)<>'object' THEN RAISE EXCEPTION 'Each BattleMech pilot must be an object';END IF;IF length(btrim(coalesce(pilot->>'name','')))<1 OR length(btrim(pilot->>'name'))>48 THEN RAISE EXCEPTION 'Pilot names must be between 1 and 48 characters';END IF;IF coalesce(pilot->>'gunnery','') !~ '^[0-8]$' OR coalesce(pilot->>'piloting','') !~ '^[0-8]$' THEN RAISE EXCEPTION 'Gunnery and Piloting must be whole numbers from 0 to 8';END IF;pilot:=jsonb_build_object('id',coalesce(nullif(pilot->>'id',''),'pilot-'||(entry->>'id')),'name',btrim(pilot->>'name'),'gunnery',(pilot->>'gunnery')::int,'piloting',(pilot->>'piloting')::int);END IF;normalized_hangar:=normalized_hangar||jsonb_build_array(jsonb_set(entry,'{pilot}',pilot,true));
 END LOOP;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.host_id IS DISTINCT FROM auth.uid() OR g.status IS DISTINCT FROM 'lobby' OR NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player' AND NOT coalesce(is_ai,false)) THEN RAISE EXCEPTION 'Only the seated host may edit an AI force before the match starts';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}') END;
 IF NOT coalesce((st->>'vs_ai_mode')::boolean,false) OR coalesce(g.match_type,'skirmish')<>'skirmish' THEN RAISE EXCEPTION 'AI editing is only available in solo skirmishes';END IF;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND is_ai=true AND seat_number=2 AND role='player';
 IF NOT FOUND THEN RAISE EXCEPTION 'AI seat not found';END IF;
 ruleset:=coalesce(st->>'ruleset','advanced_3060');
 IF p_hangar IS NULL OR p_deployed IS NULL OR p_positions IS NULL OR jsonb_typeof(p_positions)<>'array' OR jsonb_array_length(p_deployed)<1 OR jsonb_array_length(p_positions)<>jsonb_array_length(p_deployed) THEN RAISE EXCEPTION 'Choose one to six AI mechs with deployment positions';END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_deployed))<>jsonb_array_length(p_deployed) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_deployed) d WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) h WHERE h->>'id'=d)) THEN RAISE EXCEPTION 'Invalid deployed entries';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) p WHERE coalesce(p->>'col','') !~ '^[0-9]{1,2}$' OR coalesce(p->>'row','') !~ '^[0-9]{1,2}$' OR coalesce(p->>'facing','') !~ '^[0-5]$' OR coalesce((p->>'hidden')::boolean,false)) THEN RAISE EXCEPTION 'Invalid AI deployment position';END IF;
 IF (SELECT count(DISTINCT (p->>'col',p->>'row')) FROM jsonb_array_elements(p_positions) p)<>jsonb_array_length(p_positions) THEN RAISE EXCEPTION 'AI deployment positions overlap';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_positions) p WHERE NOT btech_scenario_zone_contains(st,2,lpad(p->>'col',2,'0')||lpad(p->>'row',2,'0')) OR btech_state_terrain(st,lpad(p->>'col',2,'0')||lpad(p->>'row',2,'0')) IN ('building','impassable','magma_liquid','deep_water')) THEN RAISE EXCEPTION 'AI deployment must use legal hexes in its own zone';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT EXISTS(SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=g.catalogue_version AND unit.unit_id=item->>'unit_id' AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false) AND (NOT coalesce((unit.definition->>'custom_design')::boolean,false) OR (unit.definition->>'custom_owner_id'=auth.uid()::text AND NOT coalesce((unit.definition->>'custom_archived')::boolean,false))))) THEN RAISE EXCEPTION 'A hangar contains an unsupported, archived, or another player''s custom BattleMech';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT btech_ruleset_unit_allowed(g.catalogue_version,item->>'unit_id',ruleset)) THEN RAISE EXCEPTION 'A hangar contains a BattleMech unavailable under the % ruleset',ruleset;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE item->>'id'=deployment.entry_id)) THEN RAISE EXCEPTION 'Only BattleMechs in your Hangar may be deployed';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements_text(p_deployed))<>(SELECT count(DISTINCT entry_id) FROM jsonb_array_elements_text(p_deployed) deployment(entry_id)) THEN RAISE EXCEPTION 'A Hangar BattleMech may be deployed once';END IF;
 SELECT coalesce(jsonb_agg(item.entry->>'unit_id' ORDER BY deployment.ordinality),'[]'::jsonb) INTO unit_ids FROM jsonb_array_elements_text(p_deployed) WITH ORDINALITY deployment(entry_id,ordinality) JOIN LATERAL(SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>'id'=deployment.entry_id)item ON true;
 SELECT coalesce(sum((unit.definition->>'mass')::int),0) INTO total_tonnage FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) JOIN LATERAL(SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>'id'=deployment.entry_id)item ON true JOIN btech_catalogue_units unit ON unit.catalogue_version=g.catalogue_version AND unit.unit_id=item.entry->>'unit_id';
 bv_limit:=btech_bv2_limit_for_state(st);
 IF bv_limit IS NULL AND total_tonnage>coalesce((st->>'dropship_tonnage')::int,0) THEN RAISE EXCEPTION 'Deployed BattleMechs exceed the dropship tonnage limit';END IF;
 IF bv_limit IS NOT NULL THEN bv_value:=btech_bv2_hangar_value(g.catalogue_version,normalized_hangar,p_deployed);IF (bv_value->>'adjusted')::int>bv_limit THEN RAISE EXCEPTION 'Deployed BattleMechs exceed the BV2 limit (% / % BV)',bv_value->>'adjusted',bv_limit;END IF;st:=jsonb_set(st,ARRAY['force_values',player.seat_number::text],bv_value,true);END IF;
 avatars:=coalesce(st->'skirmish_avatars','{}'::jsonb);avatar:=coalesce(avatars->player.seat_number::text,jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||player.seat_number::text,'callsign','Skirmish Commander P'||player.seat_number::text,'gunnery',4,'piloting',5));avatar:=jsonb_set(jsonb_set(avatar,'{hangar}',normalized_hangar,true),'{deployed}',p_deployed,true);avatars:=jsonb_set(avatars,ARRAY[player.seat_number::text],avatar,true);rosters:=jsonb_set(coalesce(st->'rosters','{}'::jsonb),ARRAY[player.seat_number::text],unit_ids,true);st:=jsonb_set(jsonb_set(st,'{skirmish_avatars}',avatars,true),'{rosters}',rosters,true);
 st:=jsonb_set(st,'{deployment_positions}',coalesce(st->'deployment_positions','{}')||jsonb_build_object('2',p_positions),true);
 st:=jsonb_set(st,'{ai_setup}',coalesce(st->'ai_setup','{}')||jsonb_build_object('edited_by_host',true,'generated_force',unit_ids,'generated_deployment',p_positions),true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
 UPDATE btech_players SET ready=coalesce(is_ai,false) WHERE game_id=p_game_id AND role='player';
 RETURN avatar;
END $$;
REVOKE ALL ON FUNCTION public.update_ai_skirmish_force(uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_ai_skirmish_force(uuid,jsonb,jsonb,jsonb) TO authenticated;


NOTIFY pgrst,'reload schema';
