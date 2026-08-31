-- Server-calculated match statistics for the shared after-action report.
-- Run after SQL 100.  The client only presents this sealed result; it does
-- not recalculate combat outcomes or infer statistics from prose log lines.

CREATE OR REPLACE FUNCTION public.btech_two_d6_success_probability(p_target integer)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_target<=2 THEN 1::numeric
  WHEN p_target=3 THEN 35::numeric/36
  WHEN p_target=4 THEN 33::numeric/36
  WHEN p_target=5 THEN 30::numeric/36
  WHEN p_target=6 THEN 26::numeric/36
  WHEN p_target=7 THEN 21::numeric/36
  WHEN p_target=8 THEN 15::numeric/36
  WHEN p_target=9 THEN 10::numeric/36
  WHEN p_target=10 THEN 6::numeric/36
  WHEN p_target=11 THEN 3::numeric/36
  WHEN p_target=12 THEN 1::numeric/36
  ELSE 0::numeric
 END
$$;

CREATE OR REPLACE FUNCTION public.btech_stat_increment(p_document jsonb,p_path text[],p_amount numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT jsonb_set(coalesce(p_document,'{}'::jsonb),p_path,
  to_jsonb(coalesce((p_document#>>p_path)::numeric,0)+coalesce(p_amount,0)),true)
$$;

CREATE OR REPLACE FUNCTION public.btech_build_match_statistics(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 g btech_games%ROWTYPE;
 event_row record;roll_row jsonb;result_row jsonb;damage_row jsonb;unit_row jsonb;snapshot jsonb;
 players jsonb:=jsonb_build_object('1',jsonb_build_object('seat',1),'2',jsonb_build_object('seat',2));
 mechs jsonb:='{}'::jsonb;weapons jsonb:='{}'::jsonb;distribution jsonb:='{}'::jsonb;
 seat_key text;mech_key text;weapon_key text;weapon_name text;unit_id text;target_id text;
 total integer;target_number integer;distance_now integer;damage_now numeric;criticals_now numeric;
 expected_now numeric;successful boolean;is_two_d6 boolean;destroyed_now boolean;
 heat_now numeric;heat_sum numeric;heat_samples numeric;key_name text;value_row jsonb;
 longest jsonb:=NULL;highest_mech jsonb:=NULL;highest_weapon jsonb:=NULL;
 final_state jsonb;result_state jsonb;rounds integer;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Match not found';END IF;
 final_state:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 result_state:=coalesce(final_state->'match_result','{}'::jsonb);
 rounds:=greatest(1,coalesce(g.current_round,1));
 FOR total IN 2..12 LOOP distribution:=jsonb_set(distribution,ARRAY[total::text],jsonb_build_object('total',0,'1',0,'2',0),true);END LOOP;

 -- Establish stable unit identities from both ends of the match.  No account
 -- identifiers or private match codes are copied into the report.
 FOR event_row IN
  SELECT payload->'snapshot' AS snap FROM btech_match_telemetry
  WHERE game_id=p_game_id AND event_type IN ('match_started','match_completed') ORDER BY event_index
 LOOP
  FOR unit_row IN SELECT value FROM jsonb_array_elements(coalesce(event_row.snap->'mech_instances','[]'::jsonb)) LOOP
   mech_key:=unit_row->>'instanceId';IF mech_key IS NULL THEN CONTINUE;END IF;
   mechs:=jsonb_set(mechs,ARRAY[mech_key],coalesce(mechs->mech_key,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
    'instance_id',mech_key,'unit_id',unit_row->>'unitId','seat',(unit_row->>'owner')::int,
    'shots',coalesce((mechs->mech_key->>'shots')::numeric,0),'hits',coalesce((mechs->mech_key->>'hits')::numeric,0),
    'damage',coalesce((mechs->mech_key->>'damage')::numeric,0),'criticals',coalesce((mechs->mech_key->>'criticals')::numeric,0),
    'heat_sum',coalesce((mechs->mech_key->>'heat_sum')::numeric,0),'heat_samples',coalesce((mechs->mech_key->>'heat_samples')::numeric,0),
    'peak_heat',coalesce((mechs->mech_key->>'peak_heat')::numeric,0),'destroyed',coalesce((unit_row->>'destroyed')::boolean,false)
   )),true);
  END LOOP;
 END LOOP;

 -- Use only the newest authoritative resolution for each combat declaration.
 -- This prevents an amended event from counting both its old and new results.
 FOR event_row IN
  SELECT DISTINCT ON (payload->>'combat_event_id') actor_seat,actor_instance_id,target_instance_id,payload,event_index
  FROM btech_match_telemetry
  WHERE game_id=p_game_id AND event_type ~ '^(weapon_attack|physical_attack)_(resolved|resolution_amended)$'
  ORDER BY payload->>'combat_event_id',event_index DESC
 LOOP
  seat_key:=event_row.actor_seat::text;mech_key:=event_row.actor_instance_id;
  IF seat_key NOT IN ('1','2') THEN seat_key:=NULL;END IF;
  FOR result_row IN SELECT value FROM jsonb_array_elements(coalesce(event_row.payload->'resolution'->'results','[]'::jsonb)) LOOP
   IF result_row->'to_hit' IS NULL THEN CONTINUE;END IF;
   successful:=coalesce((result_row->>'hit')::boolean,false);
   target_number:=NULLIF(result_row->'to_hit'->>'target','')::integer;
   weapon_name:=coalesce(result_row->>'weapon',result_row->>'physical_weapon',result_row->>'attack_type','Attack');
   target_id:=coalesce(result_row->>'target_instance_id',event_row.target_instance_id);
   IF seat_key IS NOT NULL THEN
    players:=btech_stat_increment(players,ARRAY[seat_key,'shots'],1);
    IF successful THEN players:=btech_stat_increment(players,ARRAY[seat_key,'hits'],1);END IF;
    IF target_number IS NOT NULL THEN
     expected_now:=btech_two_d6_success_probability(target_number);
     players:=btech_stat_increment(players,ARRAY[seat_key,'expected_successes'],expected_now);
     players:=btech_stat_increment(players,ARRAY[seat_key,'actual_successes'],CASE WHEN successful THEN 1 ELSE 0 END);
     players:=btech_stat_increment(players,ARRAY[seat_key,'qualified_rolls'],1);
    END IF;
   END IF;
   IF mech_key IS NOT NULL THEN
    mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'shots'],1);
    IF successful THEN mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'hits'],1);END IF;
   END IF;
   weapon_key:=coalesce(seat_key,'0')||'|'||coalesce(weapon_name,'Attack');
   IF weapons->weapon_key IS NULL THEN
    weapons:=jsonb_set(weapons,ARRAY[weapon_key],jsonb_build_object('seat',event_row.actor_seat,'weapon',weapon_name,'shots',0,'hits',0,'damage',0),true);
   END IF;
   weapons:=btech_stat_increment(weapons,ARRAY[weapon_key,'shots'],1);
   IF successful THEN weapons:=btech_stat_increment(weapons,ARRAY[weapon_key,'hits'],1);END IF;
   IF successful THEN
    distance_now:=coalesce(NULLIF(result_row->>'distance','')::integer,NULLIF(event_row.payload->>'distance','')::integer);
    IF longest IS NULL OR coalesce(distance_now,-1)>coalesce((longest->>'distance')::integer,-1) THEN
     longest:=jsonb_strip_nulls(jsonb_build_object('seat',event_row.actor_seat,'instance_id',mech_key,'target_instance_id',target_id,'weapon',weapon_name,'distance',distance_now,'target_number',target_number));
    END IF;
   END IF;
  END LOOP;
  FOR damage_row IN SELECT value FROM jsonb_array_elements(coalesce(event_row.payload->'damage_attribution','[]'::jsonb)) LOOP
   damage_now:=greatest(0,coalesce(NULLIF(damage_row->>'damage','')::numeric,0));
   weapon_name:=coalesce(damage_row->>'weapon',damage_row->>'attack_type','Attack');
   weapon_key:=coalesce(seat_key,'0')||'|'||weapon_name;
   IF weapons->weapon_key IS NULL THEN weapons:=jsonb_set(weapons,ARRAY[weapon_key],jsonb_build_object('seat',event_row.actor_seat,'weapon',weapon_name,'shots',0,'hits',0,'damage',0),true);END IF;
   weapons:=btech_stat_increment(weapons,ARRAY[weapon_key,'damage'],damage_now);
   IF seat_key IS NOT NULL THEN players:=btech_stat_increment(players,ARRAY[seat_key,'damage'],damage_now);END IF;
   IF mech_key IS NOT NULL THEN mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'damage'],damage_now);END IF;
  END LOOP;
  SELECT coalesce(sum(coalesce(NULLIF(value->>'hits','')::numeric,0)),0) INTO criticals_now
  FROM jsonb_path_query(coalesce(event_row.payload->'resolution','{}'::jsonb),'$.**.critical_checks[*]') value;
  IF criticals_now>0 THEN
   IF seat_key IS NOT NULL THEN players:=btech_stat_increment(players,ARRAY[seat_key,'criticals'],criticals_now);END IF;
   IF mech_key IS NOT NULL THEN mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'criticals'],criticals_now);END IF;
  END IF;
 END LOOP;

 -- Count every recorded 2D6 outcome, while replacing amended combat events
 -- with their final form.  The expectation comparison above intentionally
 -- uses attack rolls only; a high raw roll average is not called luck.
 FOR event_row IN
  WITH latest_combat AS (
   SELECT DISTINCT ON (payload->>'combat_event_id') id FROM btech_match_telemetry
   WHERE game_id=p_game_id AND event_type ~ '^(weapon_attack|physical_attack)_(resolved|resolution_amended)$'
   ORDER BY payload->>'combat_event_id',event_index DESC
  )
  SELECT t.actor_seat,t.payload,t.event_type FROM btech_match_telemetry t
  WHERE t.game_id=p_game_id AND (
   t.event_type IN ('initiative_updated','unit_state_changed') OR t.id IN (SELECT id FROM latest_combat)
  ) ORDER BY t.event_index
 LOOP
  IF event_row.event_type='initiative_updated' THEN
   FOR roll_row IN SELECT value FROM jsonb_array_elements(coalesce(event_row.payload->'rolls','[]'::jsonb)) LOOP
    IF roll_row->'die_a' IS NULL OR roll_row->'die_b' IS NULL THEN CONTINUE;END IF;
    total:=coalesce(NULLIF(roll_row->>'roll','')::integer,(roll_row->>'die_a')::integer+(roll_row->>'die_b')::integer);
    seat_key:=roll_row->>'seat_number';
    IF total BETWEEN 2 AND 12 THEN
     distribution:=btech_stat_increment(distribution,ARRAY[total::text,'total'],1);
     IF seat_key IN ('1','2') THEN distribution:=btech_stat_increment(distribution,ARRAY[total::text,seat_key],1);END IF;
    END IF;
   END LOOP;
   CONTINUE;
  END IF;
  FOR roll_row IN SELECT value FROM jsonb_array_elements(coalesce(event_row.payload->'rolls',event_row.payload->'dice','[]'::jsonb)) LOOP
   is_two_d6:=jsonb_typeof(roll_row->'dice')='array' AND jsonb_array_length(roll_row->'dice')=2
    AND roll_row->'dice'->0<>'null'::jsonb AND roll_row->'dice'->1<>'null'::jsonb;
   IF NOT is_two_d6 THEN CONTINUE;END IF;
   total:=coalesce(NULLIF(roll_row->>'total','')::integer,(roll_row->'dice'->>0)::integer+(roll_row->'dice'->>1)::integer);
   IF total<2 OR total>12 THEN CONTINUE;END IF;
   seat_key:=event_row.actor_seat::text;
   distribution:=btech_stat_increment(distribution,ARRAY[total::text,'total'],1);
   IF seat_key IN ('1','2') THEN distribution:=btech_stat_increment(distribution,ARRAY[total::text,seat_key],1);END IF;
  END LOOP;
 END LOOP;

 -- Heat is sampled from immutable round/final snapshots rather than every
 -- intermediate increment, which would overweight units that fired more.
 FOR event_row IN
  SELECT payload->'snapshot' AS snap FROM btech_match_telemetry
  WHERE game_id=p_game_id AND event_type IN ('match_started','state_checkpoint','match_completed') ORDER BY event_index
 LOOP
  snapshot:=event_row.snap;
  FOR unit_row IN SELECT value FROM jsonb_array_elements(coalesce(snapshot->'mech_instances','[]'::jsonb)) LOOP
   mech_key:=unit_row->>'instanceId';seat_key:=unit_row->>'owner';heat_now:=greatest(0,coalesce(NULLIF(unit_row->>'heat','')::numeric,0));
   IF mech_key IS NULL THEN CONTINUE;END IF;
   mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'heat_sum'],heat_now);
   mechs:=btech_stat_increment(mechs,ARRAY[mech_key,'heat_samples'],1);
   IF heat_now>coalesce((mechs->mech_key->>'peak_heat')::numeric,0) THEN mechs:=jsonb_set(mechs,ARRAY[mech_key,'peak_heat'],to_jsonb(heat_now),true);END IF;
   IF seat_key IN ('1','2') THEN
    players:=btech_stat_increment(players,ARRAY[seat_key,'heat_sum'],heat_now);
    players:=btech_stat_increment(players,ARRAY[seat_key,'heat_samples'],1);
    IF heat_now>coalesce((players->seat_key->>'peak_heat')::numeric,0) THEN players:=jsonb_set(players,ARRAY[seat_key,'peak_heat'],to_jsonb(heat_now),true);END IF;
   END IF;
  END LOOP;
 END LOOP;

 -- Final survival/destruction totals and derived display values.
 FOR unit_row IN SELECT value FROM jsonb_array_elements(coalesce(final_state->'mech_instances','[]'::jsonb)) LOOP
  mech_key:=unit_row->>'instanceId';seat_key:=unit_row->>'owner';destroyed_now:=coalesce((unit_row->>'destroyed')::boolean,false);
  IF mech_key IS NULL THEN CONTINUE;END IF;
  mechs:=jsonb_set(mechs,ARRAY[mech_key,'destroyed'],to_jsonb(destroyed_now),true);
  IF seat_key IN ('1','2') THEN
   players:=btech_stat_increment(players,ARRAY[seat_key,CASE WHEN destroyed_now THEN 'lost' ELSE 'survivors' END],1);
   players:=btech_stat_increment(players,ARRAY[CASE seat_key WHEN '1' THEN '2' ELSE '1' END,'kills'],CASE WHEN destroyed_now THEN 1 ELSE 0 END);
  END IF;
 END LOOP;
 FOR seat_key IN SELECT unnest(ARRAY['1','2']) LOOP
  heat_sum:=coalesce((players->seat_key->>'heat_sum')::numeric,0);heat_samples:=coalesce((players->seat_key->>'heat_samples')::numeric,0);
  players:=jsonb_set(players,ARRAY[seat_key,'average_heat'],to_jsonb(CASE WHEN heat_samples>0 THEN round(heat_sum/heat_samples,1) ELSE 0 END),true);
  players:=jsonb_set(players,ARRAY[seat_key,'accuracy'],to_jsonb(CASE WHEN coalesce((players->seat_key->>'shots')::numeric,0)>0 THEN round((players->seat_key->>'hits')::numeric*100/(players->seat_key->>'shots')::numeric,1) ELSE 0 END),true);
  players:=jsonb_set(players,ARRAY[seat_key,'expectation_delta'],to_jsonb(round(coalesce((players->seat_key->>'actual_successes')::numeric,0)-coalesce((players->seat_key->>'expected_successes')::numeric,0),2)),true);
  players:=players #- ARRAY[seat_key,'heat_sum'];players:=players #- ARRAY[seat_key,'heat_samples'];
 END LOOP;
 FOR key_name,value_row IN SELECT key,value FROM jsonb_each(mechs) LOOP
  heat_sum:=coalesce((value_row->>'heat_sum')::numeric,0);heat_samples:=coalesce((value_row->>'heat_samples')::numeric,0);
  value_row:=jsonb_set(value_row,'{average_heat}',to_jsonb(CASE WHEN heat_samples>0 THEN round(heat_sum/heat_samples,1) ELSE 0 END),true)-'heat_sum'-'heat_samples';
  mechs:=jsonb_set(mechs,ARRAY[key_name],value_row,true);
  IF highest_mech IS NULL OR coalesce((value_row->>'damage')::numeric,0)>coalesce((highest_mech->>'damage')::numeric,0) THEN highest_mech:=value_row;END IF;
 END LOOP;
 FOR key_name,value_row IN SELECT key,value FROM jsonb_each(weapons) LOOP
  value_row:=jsonb_set(value_row,'{accuracy}',to_jsonb(CASE WHEN coalesce((value_row->>'shots')::numeric,0)>0 THEN round((value_row->>'hits')::numeric*100/(value_row->>'shots')::numeric,1) ELSE 0 END),true);
  weapons:=jsonb_set(weapons,ARRAY[key_name],value_row,true);
  IF highest_weapon IS NULL OR coalesce((value_row->>'damage')::numeric,0)>coalesce((highest_weapon->>'damage')::numeric,0) THEN highest_weapon:=value_row;END IF;
 END LOOP;

 RETURN jsonb_build_object(
  'schema_version','btvtt-statistics-1','rounds',rounds,'result',result_state,
  'objective_scores',coalesce(final_state->'objective_scores','{}'::jsonb),
  'players',players,'mechs',mechs,'weapons',weapons,
  'dice',jsonb_build_object('distribution',distribution,'scope','All recorded two-dice rolls; expectation compares attack rolls only.'),
  'standouts',jsonb_strip_nulls(jsonb_build_object('longest_successful_shot',longest,'highest_damage_mech',highest_mech,'highest_damage_weapon',highest_weapon))
 );
END $$;
REVOKE ALL ON FUNCTION public.btech_build_match_statistics(uuid) FROM PUBLIC;

-- Future completed matches seal statistics atomically with the report.
CREATE OR REPLACE FUNCTION public.btech_seal_match_report(p_game_id uuid,p_final_state jsonb,p_round int,p_phase text,p_result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;initial_snapshot jsonb;final_snapshot jsonb;count_events int;survivors jsonb;completed timestamptz;statistics jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM btech_match_reports WHERE game_id=p_game_id) THEN RETURN;END IF;
 SELECT payload->'snapshot' INTO initial_snapshot FROM btech_match_telemetry WHERE game_id=p_game_id AND event_type='match_started' ORDER BY event_index LIMIT 1;
 initial_snapshot:=coalesce(initial_snapshot,btech_replay_state_snapshot(p_final_state,p_round,p_phase));
 final_snapshot:=btech_replay_state_snapshot(p_final_state,p_round,p_phase);
 SELECT count(*)::int INTO count_events FROM btech_match_telemetry WHERE game_id=p_game_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('instance_id',value->>'instanceId','unit_id',value->>'unitId','owner',(value->>'owner')::int)),'[]'::jsonb)
 INTO survivors FROM jsonb_array_elements(coalesce(p_final_state->'mech_instances','[]'::jsonb)) value WHERE NOT coalesce((value->>'destroyed')::boolean,false);
 completed:=coalesce(g.completed_at,now());statistics:=btech_build_match_statistics(p_game_id);
 INSERT INTO btech_match_reports(game_id,report_version,match_type,catalogue_version,completed_at,event_count,initial_state,final_state,result,report)
 VALUES(p_game_id,'btvtt-match-report-2',g.match_type,g.catalogue_version,completed,count_events,initial_snapshot,final_snapshot,p_result,
  jsonb_build_object('report_version','btvtt-match-report-2','telemetry_version',g.telemetry_version,'match_type',g.match_type,'completed_at',completed,
   'rounds',p_round,'result',p_result,'survivors',survivors,'objective_scores',coalesce(p_final_state->'objective_scores','{}'::jsonb),
   'event_count',count_events,'statistics',statistics));
END $$;
REVOKE ALL ON FUNCTION public.btech_seal_match_report(uuid,jsonb,int,text,jsonb) FROM PUBLIC;

-- SQL 100 reports may have been sealed before this aggregation existed.
-- This one-time migration upgrades them from their immutable telemetry.
UPDATE public.btech_match_reports r SET
 report_version='btvtt-match-report-2',
 event_count=(SELECT count(*)::int FROM public.btech_match_telemetry t WHERE t.game_id=r.game_id),
 report=(r.report||jsonb_build_object(
  'report_version','btvtt-match-report-2',
  'event_count',(SELECT count(*)::int FROM public.btech_match_telemetry t WHERE t.game_id=r.game_id),
  'statistics',public.btech_build_match_statistics(r.game_id)
 ))
WHERE r.report_version='btvtt-match-report-1';

NOTIFY pgrst,'reload schema';
