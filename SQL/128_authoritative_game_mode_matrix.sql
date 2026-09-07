-- GM-3: durable, server-authoritative outcome accounting for every scenario
-- victory mode. Run after SQL/127_game_modes_and_minefield_planning.sql.
-- The scorer is called only by the authoritative round-end lifecycle.

CREATE OR REPLACE FUNCTION public.btech_score_scenario_round(p_game_id uuid,p_completed_round int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;mode text;scores jsonb;objectives jsonb;
 objective_hex text;owner_count int;holder int;unit jsonb;unit_id text;unit_owner int;
 unit_hex text;scored jsonb;score_events jsonb;round_events jsonb:='[]'::jsonb;
 winner int:=NULL;result jsonb:=NULL;threshold int;score_one int;score_two int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 -- A round can reach this function only once. Retries and reconnects are safe.
 IF g.current_round<=p_completed_round
    OR coalesce((st->>'objectives_scored_after_round')::int,0)>=p_completed_round
    OR (st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb) THEN
  RETURN st->'match_result';
 END IF;
 mode:=coalesce(st->>'victory_mode','annihilation');
 scores:=coalesce(st->'objective_scores','{"1":0,"2":0}'::jsonb);
 objectives:=coalesce(st->'objective_hexes',btech_scenario_objective_hexes(coalesce(st->>'map_id','training-grounds')));
 scored:=coalesce(st->'breakthrough_scored_units','[]'::jsonb);
 score_events:=coalesce(st->'scenario_score_events','[]'::jsonb);
 IF mode='control' THEN
  FOR objective_hex IN SELECT value FROM jsonb_array_elements_text(objectives) value LOOP
   SELECT count(DISTINCT (value->>'owner')::int),min((value->>'owner')::int)
   INTO owner_count,holder FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value
   WHERE NOT coalesce((value->>'destroyed')::boolean,false)
     AND lpad(value->>'col',2,'0')||lpad(value->>'row',2,'0')=objective_hex;
   -- Exactly one side in an objective hex earns one point. A contested or
   -- empty objective is deliberately not written as a scoring event.
   IF owner_count=1 AND holder IN (1,2) THEN
    scores:=jsonb_set(scores,ARRAY[holder::text],to_jsonb(coalesce((scores->>holder::text)::int,0)+1),true);
    round_events:=round_events||jsonb_build_array(jsonb_build_object('round',p_completed_round,'mode','control','type','objective_controlled','seat',holder,'hex',objective_hex,'points',1));
   END IF;
  END LOOP;
  threshold:=5;
 ELSIF mode='breakthrough' THEN
  FOR unit IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value
   WHERE NOT coalesce((value->>'destroyed')::boolean,false) LOOP
   unit_id:=unit->>'instanceId';unit_owner:=NULLIF(unit->>'owner','')::int;
   unit_hex:=lpad(unit->>'col',2,'0')||lpad(unit->>'row',2,'0');
   -- A BattleMech can score only once and must be alive in its opponent's
   -- explicit custom zone or map-aware default edge zone.
   IF unit_id IS NOT NULL AND unit_owner IN (1,2) AND NOT (scored ? unit_id)
      AND btech_scenario_zone_contains(st,CASE WHEN unit_owner=1 THEN 2 ELSE 1 END,unit_hex) THEN
    scores:=jsonb_set(scores,ARRAY[unit_owner::text],to_jsonb(coalesce((scores->>unit_owner::text)::int,0)+1),true);
    scored:=scored||to_jsonb(unit_id);
    round_events:=round_events||jsonb_build_array(jsonb_build_object('round',p_completed_round,'mode','breakthrough','type','unit_broke_through','seat',unit_owner,'instance_id',unit_id,'hex',unit_hex,'points',1));
   END IF;
  END LOOP;
  threshold:=2;
 ELSE threshold:=NULL;
 END IF;
 score_one:=coalesce((scores->>'1')::int,0);score_two:=coalesce((scores->>'2')::int,0);
 IF threshold IS NOT NULL AND (score_one>=threshold OR score_two>=threshold) THEN
  winner:=CASE WHEN score_one=score_two THEN NULL WHEN score_one>score_two THEN 1 ELSE 2 END;
  result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason',mode,
   'objective_scores',scores,'completed_round',p_completed_round,'threshold',threshold,
   'outcome',CASE WHEN winner IS NULL THEN 'draw' ELSE 'victory' END);
  st:=jsonb_set(st,'{match_result}',result,true);st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);
 END IF;
 st:=jsonb_set(st,'{objective_scores}',scores,true);st:=jsonb_set(st,'{objective_hexes}',objectives,true);
 st:=jsonb_set(st,'{breakthrough_scored_units}',scored,true);st:=jsonb_set(st,'{scenario_score_events}',score_events||round_events,true);
 st:=jsonb_set(st,'{objectives_scored_after_round}',to_jsonb(p_completed_round),true);
 IF result IS NULL THEN UPDATE btech_games SET state=st WHERE id=p_game_id;
 ELSE UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_score_scenario_round(uuid,int) FROM PUBLIC;

-- Preserve scenario decisions in immutable replay snapshots. Minefields are
-- intentionally omitted: a shared snapshot must never expose unrevealed
-- enemy minefields. GM-4 will provide private, per-player minefield views.
CREATE OR REPLACE FUNCTION public.btech_replay_state_snapshot(p_state jsonb,p_round int,p_phase text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'schema_version','btvtt-state-1','round',p_round,'phase',p_phase,
  'map_id',p_state->'map_id','custom_scenario',p_state->'custom_scenario',
  'terrain_overrides',p_state->'terrain_overrides','elevation_overrides',p_state->'elevation_overrides',
  'building_cf',p_state->'building_cf','generated_smoke_hexes',p_state->'generated_smoke_hexes',
  'wind_direction',p_state->'wind_direction','victory_mode',p_state->'victory_mode',
  'objective_hexes',p_state->'objective_hexes','objective_scores',p_state->'objective_scores',
  'deployment_zones',p_state->'deployment_zones','scenario_score_events',p_state->'scenario_score_events',
  'mech_instances',coalesce(p_state->'mech_instances','[]'::jsonb),'match_result',p_state->'match_result'
 ))
$$;
REVOKE ALL ON FUNCTION public.btech_replay_state_snapshot(jsonb,int,text) FROM PUBLIC;
