-- Versioned, server-authoritative telemetry and sealed-report foundation.
-- This observes durable combat resolutions and authoritative game-state
-- updates, so later statistics and replay code never need to parse prose logs.

ALTER TABLE public.btech_games
 ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'skirmish',
 ADD COLUMN IF NOT EXISTS telemetry_version text NOT NULL DEFAULT 'btvtt-telemetry-1',
 ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='btech_games_match_type_check') THEN
  ALTER TABLE public.btech_games ADD CONSTRAINT btech_games_match_type_check
   CHECK (match_type IN ('skirmish','career')) NOT VALID;
  ALTER TABLE public.btech_games VALIDATE CONSTRAINT btech_games_match_type_check;
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.btech_match_telemetry (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 game_id uuid NOT NULL REFERENCES public.btech_games(id) ON DELETE CASCADE,
 event_index integer NOT NULL,
 round integer NOT NULL,
 phase text NOT NULL,
 event_type text NOT NULL,
 actor_seat integer,
 actor_instance_id text,
 target_instance_id text,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(game_id,event_index)
);
CREATE INDEX IF NOT EXISTS idx_btech_match_telemetry_timeline
 ON public.btech_match_telemetry(game_id,event_index);
CREATE INDEX IF NOT EXISTS idx_btech_match_telemetry_round_phase
 ON public.btech_match_telemetry(game_id,round,phase,event_type);

CREATE TABLE IF NOT EXISTS public.btech_match_reports (
 game_id uuid PRIMARY KEY REFERENCES public.btech_games(id) ON DELETE CASCADE,
 report_version text NOT NULL,
 match_type text NOT NULL,
 catalogue_version text,
 completed_at timestamptz NOT NULL,
 event_count integer NOT NULL,
 initial_state jsonb NOT NULL,
 final_state jsonb NOT NULL,
 result jsonb NOT NULL,
 report jsonb NOT NULL,
 sealed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.btech_match_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_match_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants can view match telemetry" ON public.btech_match_telemetry;
CREATE POLICY "Participants can view match telemetry" ON public.btech_match_telemetry FOR SELECT
 USING (EXISTS (SELECT 1 FROM public.btech_players p WHERE p.game_id=btech_match_telemetry.game_id AND p.user_id=auth.uid()));
DROP POLICY IF EXISTS "Participants can view match reports" ON public.btech_match_reports;
CREATE POLICY "Participants can view match reports" ON public.btech_match_reports FOR SELECT
 USING (EXISTS (SELECT 1 FROM public.btech_players p WHERE p.game_id=btech_match_reports.game_id AND p.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.btech_replay_state_snapshot(p_state jsonb,p_round int,p_phase text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'schema_version','btvtt-state-1','round',p_round,'phase',p_phase,
  'map_id',p_state->'map_id','custom_scenario',p_state->'custom_scenario',
  'terrain_overrides',p_state->'terrain_overrides','elevation_overrides',p_state->'elevation_overrides',
  'building_cf',p_state->'building_cf','generated_smoke_hexes',p_state->'generated_smoke_hexes',
  'wind_direction',p_state->'wind_direction','victory_mode',p_state->'victory_mode',
  'objective_hexes',p_state->'objective_hexes','objective_scores',p_state->'objective_scores',
  'minefields',p_state->'minefields','mech_instances',coalesce(p_state->'mech_instances','[]'::jsonb),
  'match_result',p_state->'match_result'
 ))
$$;

CREATE OR REPLACE FUNCTION public.btech_collect_dice_rolls(
 p_value jsonb,p_path text[] DEFAULT ARRAY[]::text[],p_inherited_outcome text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE collected jsonb:='[]'::jsonb;child_key text;child_value jsonb;item jsonb;position int:=0;local_outcome text:=p_inherited_outcome;
BEGIN
 IF p_value IS NULL THEN RETURN collected;END IF;
 IF jsonb_typeof(p_value)='object' THEN
  IF p_value ? 'hit' THEN local_outcome:=CASE WHEN coalesce((p_value->>'hit')::boolean,false) THEN 'hit' ELSE 'miss' END;
  ELSIF p_value ? 'passed' THEN local_outcome:=CASE WHEN coalesce((p_value->>'passed')::boolean,false) THEN 'passed' ELSE 'failed' END;
  ELSIF p_value ? 'consciousness' THEN local_outcome:=p_value->>'consciousness';END IF;
  IF (p_value ? 'total' OR p_value ? 'roll') AND (p_value ? 'die_a' OR p_value ? 'die_b') THEN
   collected:=collected||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'purpose',array_to_string(p_path,'.'),'dice',jsonb_build_array(p_value->'die_a',p_value->'die_b'),
    'total',coalesce(p_value->'total',p_value->'roll'),'target_number',p_value->'target','outcome',local_outcome
   )));
  END IF;
  FOR child_key,child_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
   IF jsonb_typeof(child_value)='number' AND (child_key='roll' OR child_key LIKE '%\_roll') AND NOT (child_key='roll' AND (p_value ? 'die_a' OR p_value ? 'die_b')) THEN
    collected:=collected||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
     'purpose',array_to_string(p_path||child_key,'.'),'dice',jsonb_build_array(child_value),
     'total',child_value,'outcome',local_outcome
    )));
   ELSIF child_key NOT IN ('die_a','die_b','total','target') THEN
    collected:=collected||btech_collect_dice_rolls(child_value,p_path||child_key,local_outcome);
   END IF;
  END LOOP;
 ELSIF jsonb_typeof(p_value)='array' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
   collected:=collected||btech_collect_dice_rolls(item,p_path||position::text,p_inherited_outcome);position:=position+1;
  END LOOP;
 END IF;
 RETURN collected;
END $$;

CREATE OR REPLACE FUNCTION public.btech_jsonb_changed_values(p_before jsonb,p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE changed jsonb:='{}'::jsonb;key_name text;after_value jsonb;nested jsonb;
BEGIN
 IF p_before IS NOT DISTINCT FROM p_after THEN RETURN changed;END IF;
 IF jsonb_typeof(p_before)='object' AND jsonb_typeof(p_after)='object' THEN
  FOR key_name,after_value IN SELECT key,value FROM jsonb_each(p_after) LOOP
   IF p_before->key_name IS DISTINCT FROM after_value THEN
    nested:=btech_jsonb_changed_values(p_before->key_name,after_value);
    changed:=jsonb_set(changed,ARRAY[key_name],CASE WHEN nested='{}'::jsonb THEN after_value ELSE nested END,true);
   END IF;
  END LOOP;
  RETURN changed;
 END IF;
 RETURN p_after;
END $$;

CREATE OR REPLACE FUNCTION public.btech_combat_damage_attribution(p_resolution jsonb,p_default_target text,p_state jsonb,p_attacker_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE attribution jsonb:='[]'::jsonb;result jsonb;damage_total int;target_id text;distance_now int;attacker jsonb;target jsonb;
BEGIN
 SELECT value INTO attacker FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=p_attacker_id;
 FOR result IN SELECT value FROM jsonb_array_elements(coalesce(p_resolution->'results','[]'::jsonb)) LOOP
  damage_total:=coalesce((result->>'damage')::int,0);
  IF jsonb_typeof(result->'groups')='array' THEN
   SELECT coalesce(sum(coalesce((value->>'damage')::int,0)),0)::int INTO damage_total FROM jsonb_array_elements(result->'groups') value;
  END IF;
  target_id:=coalesce(result->>'target_instance_id',p_default_target);
  SELECT value INTO target FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=target_id;
  distance_now:=NULL;IF attacker IS NOT NULL AND target IS NOT NULL THEN distance_now:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);END IF;
  attribution:=attribution||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
   'target_instance_id',target_id,'weapon',result->>'weapon','mount_id',result->>'mount_id',
   'attack_type',result->>'attack_type','hit',result->'hit','damage',damage_total,
   'distance',distance_now,'heat_inflicted',result->'heat_inflicted'
  )));
  IF coalesce((result->>'self_damage')::int,0)>0 THEN
   attribution:=attribution||jsonb_build_array(jsonb_build_object('target_instance_id','self','attack_type',result->>'attack_type','damage',(result->>'self_damage')::int));
  END IF;
 END LOOP;
 RETURN attribution;
END $$;

CREATE OR REPLACE FUNCTION public.btech_append_match_telemetry(
 p_game_id uuid,p_round int,p_phase text,p_event_type text,p_actor_seat int,p_actor_instance_id text,p_target_instance_id text,p_payload jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE next_index int;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(p_game_id::text));
 SELECT coalesce(max(event_index),0)+1 INTO next_index FROM btech_match_telemetry WHERE game_id=p_game_id;
 INSERT INTO btech_match_telemetry(game_id,event_index,round,phase,event_type,actor_seat,actor_instance_id,target_instance_id,payload)
 VALUES(p_game_id,next_index,greatest(1,coalesce(p_round,1)),coalesce(p_phase,'unknown'),p_event_type,p_actor_seat,p_actor_instance_id,p_target_instance_id,coalesce(p_payload,'{}'::jsonb));
 RETURN next_index;
END $$;
REVOKE ALL ON FUNCTION public.btech_append_match_telemetry(uuid,int,text,text,int,text,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_seal_match_report(p_game_id uuid,p_final_state jsonb,p_round int,p_phase text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;initial_snapshot jsonb;final_snapshot jsonb;count_events int;survivors jsonb;completed timestamptz;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM btech_match_reports WHERE game_id=p_game_id) THEN RETURN;END IF;
 SELECT payload->'snapshot' INTO initial_snapshot FROM btech_match_telemetry
  WHERE game_id=p_game_id AND event_type='match_started' ORDER BY event_index LIMIT 1;
 initial_snapshot:=coalesce(initial_snapshot,btech_replay_state_snapshot(p_final_state,p_round,p_phase));
 final_snapshot:=btech_replay_state_snapshot(p_final_state,p_round,p_phase);
 SELECT count(*)::int INTO count_events FROM btech_match_telemetry WHERE game_id=p_game_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('instance_id',value->>'instanceId','unit_id',value->>'unitId','owner',(value->>'owner')::int)),'[]'::jsonb)
 INTO survivors FROM jsonb_array_elements(coalesce(p_final_state->'mech_instances','[]'::jsonb)) value
 WHERE NOT coalesce((value->>'destroyed')::boolean,false);
 completed:=coalesce(g.completed_at,now());
 INSERT INTO btech_match_reports(game_id,report_version,match_type,catalogue_version,completed_at,event_count,initial_state,final_state,result,report)
 VALUES(p_game_id,'btvtt-match-report-1',g.match_type,g.catalogue_version,completed,count_events,initial_snapshot,final_snapshot,p_result,
  jsonb_build_object('report_version','btvtt-match-report-1','telemetry_version',g.telemetry_version,'match_type',g.match_type,
   'completed_at',completed,'rounds',p_round,'result',p_result,'survivors',survivors,
   'objective_scores',coalesce(p_final_state->'objective_scores','{}'::jsonb),'event_count',count_events));
END $$;
REVOKE ALL ON FUNCTION public.btech_seal_match_report(uuid,jsonb,int,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_stamp_match_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE old_state jsonb:=CASE jsonb_typeof(OLD.state) WHEN 'string' THEN (OLD.state#>>'{}')::jsonb ELSE OLD.state END;
 new_state jsonb:=CASE jsonb_typeof(NEW.state) WHEN 'string' THEN (NEW.state#>>'{}')::jsonb ELSE NEW.state END;
BEGIN
 IF (old_state->'match_result' IS NULL OR old_state->'match_result'='null'::jsonb)
    AND new_state->'match_result' IS NOT NULL AND new_state->'match_result'<>'null'::jsonb THEN
  NEW.completed_at:=coalesce(NEW.completed_at,now());
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS btech_stamp_match_completion_trigger ON public.btech_games;
CREATE TRIGGER btech_stamp_match_completion_trigger BEFORE UPDATE OF state ON public.btech_games
 FOR EACH ROW EXECUTE FUNCTION btech_stamp_match_completion();

CREATE OR REPLACE FUNCTION public.btech_capture_game_state_telemetry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_state jsonb:=CASE jsonb_typeof(OLD.state) WHEN 'string' THEN (OLD.state#>>'{}')::jsonb ELSE OLD.state END;
 new_state jsonb:=CASE jsonb_typeof(NEW.state) WHEN 'string' THEN (NEW.state#>>'{}')::jsonb ELSE NEW.state END;
 new_unit jsonb;old_unit jsonb;kinds jsonb;changes jsonb;result_now jsonb;initiative_public jsonb;
BEGIN
 IF OLD.status<>'in-progress' AND NEW.status<>'in-progress' THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM btech_match_telemetry WHERE game_id=NEW.id) THEN
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'match_started',NULL,NULL,NULL,
   jsonb_build_object('snapshot',btech_replay_state_snapshot(CASE WHEN OLD.status='in-progress' THEN old_state ELSE new_state END,NEW.current_round,NEW.current_phase),'baseline_after_install',OLD.status='in-progress'));
 END IF;
 IF OLD.current_round IS DISTINCT FROM NEW.current_round OR OLD.current_phase IS DISTINCT FROM NEW.current_phase THEN
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'phase_transition',NULL,NULL,NULL,
   jsonb_build_object('from',jsonb_build_object('round',OLD.current_round,'phase',OLD.current_phase),'to',jsonb_build_object('round',NEW.current_round,'phase',NEW.current_phase)));
 END IF;
 IF old_state->'initiative_rolls' IS DISTINCT FROM new_state->'initiative_rolls' THEN
  SELECT coalesce(jsonb_agg(value-'player_id'-'user_id'),'[]'::jsonb) INTO initiative_public FROM jsonb_array_elements(coalesce(new_state->'initiative_rolls','[]'::jsonb)) value;
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'initiative_updated',NULL,NULL,NULL,
   jsonb_build_object('rolls',initiative_public,'dice',btech_collect_dice_rolls(initiative_public,ARRAY['initiative_rolls'])));
 END IF;
 FOR new_unit IN SELECT value FROM jsonb_array_elements(coalesce(new_state->'mech_instances','[]'::jsonb)) value LOOP
  SELECT value INTO old_unit FROM jsonb_array_elements(coalesce(old_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=new_unit->>'instanceId';
  IF old_unit IS NULL OR old_unit=new_unit THEN CONTINUE;END IF;
  kinds:='[]'::jsonb;
  IF (old_unit->'col') IS DISTINCT FROM (new_unit->'col') OR (old_unit->'row') IS DISTINCT FROM (new_unit->'row') OR (old_unit->'facing') IS DISTINCT FROM (new_unit->'facing') OR (old_unit->'torsoFacing') IS DISTINCT FROM (new_unit->'torsoFacing') THEN kinds:=kinds||'"movement_or_facing"'::jsonb;END IF;
  IF (old_unit->'heat') IS DISTINCT FROM (new_unit->'heat') OR (old_unit->'roundStartingHeat') IS DISTINCT FROM (new_unit->'roundStartingHeat') OR (old_unit->'movementHeat') IS DISTINCT FROM (new_unit->'movementHeat') OR (old_unit->'weaponHeat') IS DISTINCT FROM (new_unit->'weaponHeat') THEN kinds:=kinds||'"heat"'::jsonb;END IF;
  IF (old_unit->'pilot') IS DISTINCT FROM (new_unit->'pilot') THEN kinds:=kinds||'"pilot"'::jsonb;END IF;
  IF (old_unit->'armor') IS DISTINCT FROM (new_unit->'armor') OR (old_unit->'structure') IS DISTINCT FROM (new_unit->'structure') OR (old_unit->'criticalSlotDamage') IS DISTINCT FROM (new_unit->'criticalSlotDamage') OR (old_unit->'destroyed') IS DISTINCT FROM (new_unit->'destroyed') THEN kinds:=kinds||'"damage"'::jsonb;END IF;
  IF jsonb_array_length(kinds)=0 THEN kinds:=kinds||'"phase_state"'::jsonb;END IF;
  changes:=btech_jsonb_changed_values(old_unit,new_unit);
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'unit_state_changed',coalesce((new_unit->>'owner')::int,(old_unit->>'owner')::int),new_unit->>'instanceId',NULL,
   jsonb_build_object('change_kinds',kinds,'changes',changes,'before',old_unit,'after',new_unit,'dice',btech_collect_dice_rolls(changes,ARRAY['unit_state'])));
 END LOOP;
 IF OLD.current_round IS DISTINCT FROM NEW.current_round THEN
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'state_checkpoint',NULL,NULL,NULL,
   jsonb_build_object('reason','round_start','snapshot',btech_replay_state_snapshot(new_state,NEW.current_round,NEW.current_phase)));
 END IF;
 result_now:=new_state->'match_result';
 IF (old_state->'match_result' IS NULL OR old_state->'match_result'='null'::jsonb) AND result_now IS NOT NULL AND result_now<>'null'::jsonb THEN
  PERFORM btech_append_match_telemetry(NEW.id,NEW.current_round,NEW.current_phase,'match_completed',NULL,NULL,NULL,
   jsonb_build_object('result',result_now,'snapshot',btech_replay_state_snapshot(new_state,NEW.current_round,NEW.current_phase)));
  PERFORM btech_seal_match_report(NEW.id,new_state,NEW.current_round,NEW.current_phase,result_now);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS btech_capture_game_state_telemetry_trigger ON public.btech_games;
CREATE TRIGGER btech_capture_game_state_telemetry_trigger AFTER UPDATE ON public.btech_games
 FOR EACH ROW EXECUTE FUNCTION btech_capture_game_state_telemetry();

CREATE OR REPLACE FUNCTION public.btech_capture_combat_event_telemetry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;seat int;attacker jsonb;target jsonb;distance int;payload jsonb;telemetry_type text;
BEGIN
 IF NEW.status<>'resolved' OR NEW.resolution IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='resolved' AND OLD.resolution IS NOT DISTINCT FROM NEW.resolution THEN RETURN NEW;END IF;
 END IF;
 SELECT * INTO g FROM btech_games WHERE id=NEW.game_id;IF NOT FOUND THEN RETURN NEW;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF NOT EXISTS(SELECT 1 FROM btech_match_telemetry WHERE game_id=NEW.game_id) THEN
  PERFORM btech_append_match_telemetry(NEW.game_id,g.current_round,g.current_phase,'match_started',NULL,NULL,NULL,
   jsonb_build_object('snapshot',btech_replay_state_snapshot(st,g.current_round,g.current_phase),'baseline_after_install',true));
 END IF;
 SELECT seat_number INTO seat FROM btech_players WHERE id=NEW.player_id;
 SELECT value INTO attacker FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=NEW.attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=NEW.target_instance_id;
 IF attacker IS NOT NULL AND target IS NOT NULL THEN distance:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);END IF;
 payload:=jsonb_build_object('combat_event_id',NEW.id,'declaration',NEW.declaration,'resolution',NEW.resolution,
  'distance',distance,'rolls',btech_collect_dice_rolls(NEW.resolution,ARRAY[NEW.phase]),
  'damage_attribution',btech_combat_damage_attribution(NEW.resolution,NEW.target_instance_id,st,NEW.attacker_instance_id));
 telemetry_type:=NEW.phase||'_resolved';
 IF TG_OP='UPDATE' THEN
  IF OLD.status='resolved' THEN telemetry_type:=NEW.phase||'_resolution_amended';END IF;
 END IF;
 PERFORM btech_append_match_telemetry(NEW.game_id,NEW.round,NEW.phase,telemetry_type,seat,NEW.attacker_instance_id,NEW.target_instance_id,payload);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS btech_capture_combat_event_telemetry_insert_trigger ON public.btech_combat_events;
DROP TRIGGER IF EXISTS btech_capture_combat_event_telemetry_update_trigger ON public.btech_combat_events;
CREATE TRIGGER btech_capture_combat_event_telemetry_insert_trigger AFTER INSERT ON public.btech_combat_events
 FOR EACH ROW WHEN (NEW.status='resolved') EXECUTE FUNCTION btech_capture_combat_event_telemetry();
CREATE TRIGGER btech_capture_combat_event_telemetry_update_trigger AFTER UPDATE OF status,resolution ON public.btech_combat_events
 FOR EACH ROW WHEN (NEW.status='resolved') EXECUTE FUNCTION btech_capture_combat_event_telemetry();

CREATE OR REPLACE FUNCTION public.get_btech_match_report(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE row_report btech_match_reports%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Only match participants may view its report';END IF;
 SELECT * INTO row_report FROM btech_match_reports WHERE game_id=p_game_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('report_version',row_report.report_version,'match_type',row_report.match_type,'catalogue_version',row_report.catalogue_version,
  'completed_at',row_report.completed_at,'event_count',row_report.event_count,'initial_state',row_report.initial_state,
  'final_state',row_report.final_state,'result',row_report.result,'report',row_report.report,'sealed_at',row_report.sealed_at);
END $$;
REVOKE ALL ON FUNCTION public.get_btech_match_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_match_report(uuid) TO authenticated;
