-- Scenario objectives and alternative victory conditions.
-- Run after SQL/74_multi_target_fire_and_ams.sql.

CREATE OR REPLACE FUNCTION public.btech_scenario_objective_hexes(p_map_id text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map_id
  WHEN 'industrial-crossing' THEN '["0703","0806","0809"]'::jsonb
  WHEN 'desert-hills' THEN '["0302","0906","1108"]'::jsonb
  WHEN 'flatlands-open-terrain' THEN '["0505","0806","1108"]'::jsonb
  WHEN 'ridge-and-ford' THEN '["0704","0804","0805"]'::jsonb
  ELSE '["0704","0806","0808"]'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.btech_scenario_objective_hexes(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_score_scenario_round(p_game_id uuid,p_completed_round int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;mode text;scores jsonb;objectives jsonb;code text;owner_count int;holder int;unit jsonb;unit_id text;unit_owner int;scored jsonb;winner int:=NULL;result jsonb:=NULL;threshold int;score_one int;score_two int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;IF NOT FOUND THEN RETURN NULL;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF g.current_round<=p_completed_round OR coalesce((st->>'objectives_scored_after_round')::int,0)>=p_completed_round OR st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN RETURN st->'match_result';END IF;
 mode:=coalesce(st->>'victory_mode','annihilation');scores:=coalesce(st->'objective_scores','{"1":0,"2":0}'::jsonb);objectives:=coalesce(st->'objective_hexes',btech_scenario_objective_hexes(coalesce(st->>'map_id','training-grounds')));scored:=coalesce(st->'breakthrough_scored_units','[]'::jsonb);
 IF mode='control' THEN
  FOR code IN SELECT jsonb_array_elements_text(objectives) LOOP
   SELECT count(DISTINCT (value->>'owner')::int),min((value->>'owner')::int) INTO owner_count,holder FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE NOT coalesce((value->>'destroyed')::boolean,false) AND lpad(value->>'col',2,'0')||lpad(value->>'row',2,'0')=code;
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

-- Elimination remains an immediate win in every scenario; objective results
-- already stored at round end are returned without being overwritten.
CREATE OR REPLACE FUNCTION public.resolve_btech_match_end(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;survivors int[];winner int;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' THEN RAISE EXCEPTION 'Only a seated player in an active game may check its result';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN RETURN jsonb_build_object('status','resolved','result',st->'match_result');END IF;
 IF g.current_phase='weapon_attack' AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) unit WHERE coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=g.current_round AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false) AND NOT coalesce((unit->>'hasFired')::boolean,false)) THEN RETURN jsonb_build_object('status','pending_weapon_declarations');END IF;
 SELECT array_agg(DISTINCT (unit->>'owner')::int ORDER BY (unit->>'owner')::int) INTO survivors FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) unit WHERE NOT coalesce((unit->>'destroyed')::boolean,false);
 IF coalesce(array_length(survivors,1),0)>1 THEN RETURN jsonb_build_object('status','ongoing','victory_mode',coalesce(st->>'victory_mode','annihilation'),'objective_scores',coalesce(st->'objective_scores','{"1":0,"2":0}'::jsonb));END IF;
 winner:=CASE WHEN coalesce(array_length(survivors,1),0)=1 THEN survivors[1] ELSE NULL END;result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason','annihilation','objective_scores',coalesce(st->'objective_scores','{"1":0,"2":0}'::jsonb));st:=jsonb_set(st,'{match_result}',result,true);st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;RETURN jsonb_build_object('status','resolved','result',result);
END $$;
REVOKE ALL ON FUNCTION public.resolve_btech_match_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_btech_match_end(uuid) TO authenticated;

-- Score only after both players finish Heat and the shared phase core advances
-- the round.  This composes with SQL 73's terrain lifecycle.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('scenario_objectives_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'PERFORM btech_advance_terrain_round(p_game_id,g.current_round); /* terrain_round_lifecycle_v1 */','PERFORM btech_advance_terrain_round(p_game_id,g.current_round);PERFORM btech_score_scenario_round(p_game_id,g.current_round); /* terrain_round_lifecycle_v1 scenario_objectives_v1 */');
 IF patched=source OR position('scenario_objectives_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install round-end objective scoring; run SQL 73 first';END IF;EXECUTE patched;
END $$;
