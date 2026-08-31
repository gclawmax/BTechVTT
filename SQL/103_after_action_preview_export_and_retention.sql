-- Complete the skirmish after-action slice.  Everything exposed here is
-- derived from an already sealed report; no company, hangar, pilot, credit,
-- reputation, or salvage table is created or changed by a skirmish.

CREATE OR REPLACE FUNCTION public.btech_public_replay_json(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cleaned jsonb;entry_key text;entry_value jsonb;
BEGIN
 IF p_value IS NULL THEN RETURN NULL;END IF;
 IF jsonb_typeof(p_value)='array' THEN
  SELECT coalesce(jsonb_agg(btech_public_replay_json(value)),'[]'::jsonb) INTO cleaned FROM jsonb_array_elements(p_value);
  RETURN cleaned;
 END IF;
 IF jsonb_typeof(p_value)<>'object' THEN RETURN p_value;END IF;
 cleaned:='{}'::jsonb;
 FOR entry_key,entry_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
  IF entry_key IN ('player_id','user_id','author_player_id','active_player_id','active_player_player_id','game_code','code') THEN CONTINUE;END IF;
  cleaned:=jsonb_set(cleaned,ARRAY[entry_key],btech_public_replay_json(entry_value),true);
 END LOOP;
 RETURN cleaned;
END $$;

CREATE OR REPLACE FUNCTION public.get_btech_skirmish_career_preview(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;r btech_match_reports%ROWTYPE;initial_unit jsonb;final_unit jsonb;unit_stat jsonb;unit_definition jsonb;
 units jsonb:='[]'::jsonb;wrecks jsonb:='[]'::jsonb;armor_loss int;structure_loss int;critical_loss int;ammo_spent int;repair_cost int;xp int;mass int;is_destroyed boolean;
 total_repair int:=0;total_salvage int:=0;total_xp int:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Only match participants may view this preview';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id;
 SELECT * INTO r FROM btech_match_reports WHERE game_id=p_game_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF g.match_type<>'skirmish' THEN RAISE EXCEPTION 'Career previews are available only for non-persistent skirmishes';END IF;
 FOR final_unit IN SELECT value FROM jsonb_array_elements(coalesce(r.final_state->'mech_instances','[]'::jsonb)) value LOOP
  SELECT value INTO initial_unit FROM jsonb_array_elements(coalesce(r.initial_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=final_unit->>'instanceId';
  SELECT value INTO unit_stat FROM jsonb_each(coalesce(r.report->'statistics'->'mechs','{}'::jsonb)) WHERE value->>'instance_id'=final_unit->>'instanceId' LIMIT 1;
  SELECT definition INTO unit_definition FROM btech_catalogue_units WHERE catalogue_version=r.catalogue_version AND unit_id=final_unit->>'unitId';
  mass:=coalesce((unit_definition->>'mass')::int,0);
  SELECT coalesce(sum(greatest(0,coalesce((before_value#>>'{}')::int,0)-coalesce((after_value#>>'{}')::int,0))),0)::int INTO armor_loss
   FROM jsonb_each(coalesce(initial_unit->'armor','{}'::jsonb)) before_row(key,before_value)
   LEFT JOIN LATERAL (SELECT final_unit->'armor'->before_row.key AS after_value) after_row ON true;
  SELECT coalesce(sum(greatest(0,coalesce((before_value#>>'{}')::int,0)-coalesce((after_value#>>'{}')::int,0))),0)::int INTO structure_loss
   FROM jsonb_each(coalesce(initial_unit->'structure','{}'::jsonb)) before_row(key,before_value)
   LEFT JOIN LATERAL (SELECT final_unit->'structure'->before_row.key AS after_value) after_row ON true;
  SELECT count(*)::int INTO critical_loss FROM jsonb_path_query(coalesce(final_unit->'criticalSlotDamage','{}'::jsonb),'$.** ? (@ == true)');
  SELECT greatest(0,
   coalesce((SELECT sum(coalesce((value->>'shots')::int,0)) FROM jsonb_array_elements(coalesce(initial_unit->'ammoBins','[]'::jsonb)) value),0)-
   coalesce((SELECT sum(coalesce((value->>'shots')::int,0)) FROM jsonb_array_elements(coalesce(final_unit->'ammoBins','[]'::jsonb)) value),0)
  )::int INTO ammo_spent;
  is_destroyed:=coalesce((final_unit->>'destroyed')::boolean,false);
  repair_cost:=CASE WHEN is_destroyed THEN greatest(50000,mass*150000) ELSE armor_loss*500+structure_loss*3000+critical_loss*10000+ammo_spent*100 END;
  xp:=greatest(0,coalesce((unit_stat->>'hits')::int,0)+ceil(coalesce((unit_stat->>'damage')::numeric,0)/10.0)::int+coalesce((unit_stat->>'criticals')::int,0)*2);
  units:=units||jsonb_build_array(jsonb_build_object('instance_id',final_unit->>'instanceId','unit_id',final_unit->>'unitId','seat',(final_unit->>'owner')::int,
   'destroyed',is_destroyed,'armor_lost',armor_loss,'structure_lost',structure_loss,'critical_slots_damaged',critical_loss,'ammunition_spent',ammo_spent,
   'illustrative_repair_c_bills',repair_cost,'illustrative_pilot_xp',xp,'pilot',jsonb_strip_nulls(jsonb_build_object('name',final_unit->'pilot'->>'name','hits',coalesce((final_unit->'pilot'->>'hits')::int,0),'consciousness',final_unit->'pilot'->>'consciousness'))));
  total_repair:=total_repair+repair_cost;total_xp:=total_xp+xp;
  IF is_destroyed THEN
   total_salvage:=total_salvage+mass*25000;
   wrecks:=wrecks||jsonb_build_array(jsonb_build_object('instance_id',final_unit->>'instanceId','unit_id',final_unit->>'unitId','original_owner',(final_unit->>'owner')::int,'mass',mass,'illustrative_recovery_value',mass*25000,'condition','Destroyed wreck — components may be recoverable'));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('schema_version','btvtt-skirmish-preview-1','skirmish_only',true,
  'notice','Illustrative only. Nothing in this preview is saved to a Career company, hangar, pilot, credits, reputation, or salvage inventory.',
  'units',units,'recoverable_wrecks',wrecks,'summary',jsonb_build_object('illustrative_repairs_c_bills',total_repair,'illustrative_salvage_value',total_salvage,'illustrative_pilot_xp',total_xp));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_skirmish_career_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_skirmish_career_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_match_report_export(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE r btech_match_reports%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Only match participants may export this report';END IF;
 SELECT * INTO r FROM btech_match_reports WHERE game_id=p_game_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('format','btvtt-battle-report-1','exported_at',clock_timestamp(),'report_version',r.report_version,'match_type',r.match_type,'catalogue_version',r.catalogue_version,'completed_at',r.completed_at,'report',btech_public_replay_json(r.report));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_match_report_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_match_report_export(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_btech_match_replay_export(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE r btech_match_reports%ROWTYPE;events jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Only match participants may export this replay';END IF;
 SELECT * INTO r FROM btech_match_reports WHERE game_id=p_game_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('event_index',event_index,'round',round,'phase',phase,'event_type',event_type,'actor_seat',actor_seat,'actor_instance_id',actor_instance_id,'target_instance_id',target_instance_id,'payload',btech_public_replay_json(payload)) ORDER BY event_index),'[]'::jsonb)
 INTO events FROM btech_match_telemetry WHERE game_id=p_game_id;
 RETURN jsonb_build_object('format','btvtt-replay-1','exported_at',clock_timestamp(),'match_type',r.match_type,'catalogue_version',r.catalogue_version,
  'initial_state',btech_public_replay_json(r.initial_state),'events',events,'final_state',btech_public_replay_json(r.final_state),'report',btech_public_replay_json(r.report));
END $$;
REVOKE ALL ON FUNCTION public.get_btech_match_replay_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_btech_match_replay_export(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_btech_skirmish_retention_cleanup(p_before timestamptz DEFAULT now()-interval '30 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE expired_ids uuid[];removed_logs int:=0;removed_games int:=0;
BEGIN
 SELECT coalesce(array_agg(g.id),'{}'::uuid[]) INTO expired_ids FROM btech_games g
 WHERE g.match_type='skirmish' AND g.completed_at IS NOT NULL AND g.completed_at<p_before
  AND EXISTS(SELECT 1 FROM btech_match_reports r WHERE r.game_id=g.id);
 IF cardinality(expired_ids)=0 THEN RETURN jsonb_build_object('deleted_matches',0,'deleted_log_entries',0,'cutoff',p_before);END IF;
 DELETE FROM btech_events WHERE game_id=ANY(expired_ids);GET DIAGNOSTICS removed_logs=ROW_COUNT;
 DELETE FROM btech_games WHERE id=ANY(expired_ids) AND status<>'in-progress';GET DIAGNOSTICS removed_games=ROW_COUNT;
 RETURN jsonb_build_object('deleted_matches',removed_games,'deleted_log_entries',removed_logs,'cutoff',p_before);
END $$;
REVOKE ALL ON FUNCTION public.run_btech_skirmish_retention_cleanup(timestamptz) FROM PUBLIC;

-- Supabase projects with pg_cron enabled receive the daily job automatically.
-- Projects without pg_cron can call the same no-argument function from their
-- scheduled database job; it is deliberately not client-callable.
DO $retention$ DECLARE already_scheduled boolean:=false;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=''btvtt-skirmish-retention'')' INTO already_scheduled;
  IF NOT already_scheduled THEN EXECUTE $cron$SELECT cron.schedule('btvtt-skirmish-retention','15 3 * * *','SELECT public.run_btech_skirmish_retention_cleanup()')$cron$;END IF;
 END IF;
END $retention$;

NOTIFY pgrst,'reload schema';
