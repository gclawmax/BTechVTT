-- The final Heat activation advances terrain and scores objectives.  Two
-- round-end helpers used "code" both as a PL/pgSQL variable and as a SQL
-- column alias, which PostgreSQL rejects when the second player ends Heat.

CREATE OR REPLACE FUNCTION public.btech_advance_terrain_round(p_game_id uuid,p_completed_round int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;smoke_code text;fire_code text;building_code text;fire_hex jsonb;smoke_hex jsonb;light_hex jsonb;cf int;events jsonb:='[]'::jsonb;wind int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.current_round<=p_completed_round THEN RETURN;END IF;
 st:=btech_initialise_terrain_state(CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END);
 IF coalesce((st->>'terrain_advanced_after_round')::int,0)>=p_completed_round THEN RETURN;END IF;
 wind:=coalesce((st->>'wind_direction')::int,0)%6;
 FOR smoke_code IN SELECT jsonb_array_elements_text(coalesce(st->'generated_smoke_hexes','[]'::jsonb)) LOOP st:=jsonb_set(st,ARRAY['terrain_overrides',smoke_code],'"clear"'::jsonb,true);END LOOP;
 st:=jsonb_set(st,'{generated_smoke_hexes}','[]'::jsonb,true);
 FOR fire_code IN
  SELECT override_key FROM jsonb_each(coalesce(st->'terrain_overrides','{}'::jsonb)) overrides(override_key,override_value) WHERE overrides.override_value='"fire"'::jsonb
  UNION SELECT base.base_hex FROM (VALUES ('1004')) base(base_hex) WHERE btech_terrain(coalesce(st->>'map_id','training-grounds'),base.base_hex)='fire'
 LOOP
  fire_hex:=jsonb_build_object('col',left(fire_code,2)::int,'row',right(fire_code,2)::int);
  smoke_hex:=btech_neighbor_hex((fire_hex->>'col')::int,(fire_hex->>'row')::int,wind);light_hex:=btech_neighbor_hex((smoke_hex->>'col')::int,(smoke_hex->>'row')::int,wind);
  IF (smoke_hex->>'col')::int BETWEEN 0 AND 15 AND (smoke_hex->>'row')::int BETWEEN 0 AND 11 THEN smoke_code:=lpad(smoke_hex->>'col',2,'0')||lpad(smoke_hex->>'row',2,'0');st:=jsonb_set(st,ARRAY['terrain_overrides',smoke_code],'"heavy_smoke"'::jsonb,true);st:=jsonb_set(st,'{generated_smoke_hexes}',st->'generated_smoke_hexes'||to_jsonb(smoke_code),true);END IF;
  IF (light_hex->>'col')::int BETWEEN 0 AND 15 AND (light_hex->>'row')::int BETWEEN 0 AND 11 THEN smoke_code:=lpad(light_hex->>'col',2,'0')||lpad(light_hex->>'row',2,'0');st:=jsonb_set(st,ARRAY['terrain_overrides',smoke_code],'"light_smoke"'::jsonb,true);st:=jsonb_set(st,'{generated_smoke_hexes}',st->'generated_smoke_hexes'||to_jsonb(smoke_code),true);END IF;
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

CREATE OR REPLACE FUNCTION public.btech_score_scenario_round(p_game_id uuid,p_completed_round int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;mode text;scores jsonb;objectives jsonb;objective_hex text;owner_count int;holder int;unit jsonb;unit_id text;unit_owner int;scored jsonb;winner int:=NULL;result jsonb:=NULL;threshold int;score_one int;score_two int;
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
   unit_id:=unit->>'instanceId';unit_owner:=(unit->>'owner')::int;
   IF NOT (scored ? unit_id) AND ((unit_owner=1 AND (unit->>'col')::int>=11) OR (unit_owner=2 AND (unit->>'col')::int<=4)) THEN scores:=jsonb_set(scores,ARRAY[unit_owner::text],to_jsonb(coalesce((scores->>unit_owner::text)::int,0)+1),true);scored:=scored||to_jsonb(unit_id);END IF;
  END LOOP;threshold:=2;
 ELSE threshold:=NULL;END IF;
 score_one:=coalesce((scores->>'1')::int,0);score_two:=coalesce((scores->>'2')::int,0);
 IF threshold IS NOT NULL AND (score_one>=threshold OR score_two>=threshold) THEN winner:=CASE WHEN score_one=score_two THEN NULL WHEN score_one>score_two THEN 1 ELSE 2 END;result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason',mode,'objective_scores',scores,'completed_round',p_completed_round);st:=jsonb_set(st,'{match_result}',result,true);st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);END IF;
 st:=jsonb_set(st,'{objective_scores}',scores,true);st:=jsonb_set(st,'{objective_hexes}',objectives,true);st:=jsonb_set(st,'{breakthrough_scored_units}',scored,true);st:=jsonb_set(st,'{objectives_scored_after_round}',to_jsonb(p_completed_round),true);
 IF result IS NULL THEN UPDATE btech_games SET state=st WHERE id=p_game_id;ELSE UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_score_scenario_round(uuid,int) FROM PUBLIC;
