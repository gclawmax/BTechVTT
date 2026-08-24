-- Multiple weapon targets and complete standard Anti-Missile System defence.
-- Run after SQL/73_complete_advanced_terrain_interactions.sql.

-- One standard AMS mount may engage one successful missile attack per turn.
-- Multiple mounts may each engage once.  Resolution order is deterministic:
-- available mounts automatically protect against successful attacks in combat
-- event order, because the browser has no hidden defender-choice interrupt.
CREATE OR REPLACE FUNCTION public.btech_resolve_standard_ams(
 p_catalogue_version text,p_round int,p_target jsonb,p_target_start jsonb,p_attack_direction int,p_single_missile boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_target;mount_id text;mount_location text;bin_id text;intercept_roll int:=NULL;intercepted boolean:=false;used jsonb;
BEGIN
 IF p_attack_direction NOT IN (0,1,5) THEN RETURN jsonb_build_object('mech',m,'engaged',false,'modifier',0);END IF;
 used:=CASE WHEN coalesce((m->'amsEngagements'->>'round')::int,-1)=p_round THEN coalesce(m->'amsEngagements'->'mounts','[]'::jsonb) ELSE '[]'::jsonb END;
 SELECT mount.mount_id,mount.location INTO mount_id,mount_location
 FROM btech_catalogue_mounts mount
 WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=p_target_start->>'unitId' AND mount.weapon_key='ams'
  AND NOT (used ? mount.mount_id)
  AND coalesce((p_target_start->'structure'->>mount.location)::int,0)>0
  AND NOT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_target_start->>'unitId' AND slot.location=mount.location
    AND btech_weapon_slot_matches(slot.label,'ams','Anti-Missile System') AND btech_critical_slot_is_damaged(p_target_start,slot.location,slot.slot_index))
 ORDER BY mount.mount_id LIMIT 1;
 IF mount_id IS NULL THEN RETURN jsonb_build_object('mech',m,'engaged',false,'modifier',0);END IF;
 SELECT value->>'id' INTO bin_id FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) value
  WHERE value->>'type'='ams' AND coalesce((value->>'shots')::int,0)>0 AND NOT coalesce((value->>'destroyed')::boolean,false) ORDER BY value->>'id' LIMIT 1;
 IF bin_id IS NULL THEN RETURN jsonb_build_object('mech',m,'engaged',false,'modifier',0);END IF;
 m:=btech_consume_one_live_ammo(m,'ams',bin_id);
 m:=jsonb_set(m,'{amsEngagements}',jsonb_build_object('round',p_round,'mounts',used||to_jsonb(mount_id)),true);
 m:=jsonb_set(m,'{weaponHeat}',to_jsonb(coalesce((m->>'weaponHeat')::int,0)+1),true);
 m:=jsonb_set(m,'{heat}',to_jsonb(coalesce((m->>'heat')::int,0)+1),true);
 IF p_single_missile THEN intercept_roll:=floor(random()*6+1);intercepted:=intercept_roll<=3;END IF;
 RETURN jsonb_build_object('mech',m,'engaged',true,'modifier',-4,'mount_id',mount_id,'mount_location',mount_location,'bin_id',bin_id,'single_missile_roll',intercept_roll,'intercepted',intercepted);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_standard_ams(text,int,jsonb,jsonb,int,boolean) FROM PUBLIC;

-- Extend the maintained single-target resolver with secondary-target and AMS
-- state.  Later migrations remain intact because this patches the live body.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('multi_target_ams_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'mode text;ammo_load_type text;special_ammo_mod int:=0;','mode text;ammo_load_type text;special_ammo_mod int:=0;secondary_target_mod int:=coalesce((p_ammo_bins->>''__secondary_modifier'')::int,0);ams_result jsonb;ams_intercepted boolean:=false; /* multi_target_ams_v1 */');
 patched:=replace(patched,
  '''__spotter_fired'',''__spotting_while_firing'')',
  '''__spotter_fired'',''__spotting_while_firing'',''__secondary_modifier'')');
 patched:=replace(patched,
  '+indirect_mod+spotter_move_mod+spotter_firing_mod+shallow_cover_mod;',
  '+indirect_mod+spotter_move_mod+spotter_firing_mod+shallow_cover_mod+secondary_target_mod;');
 patched:=replace(patched,
  'ELSIF hit AND narc_attack THEN target:=jsonb_set(target,''{narcPod}'',jsonb_build_object(''round'',p_round,''source'',p_attacker_instance_id),true);results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''ammo_bin_id'',ammo_bin_id,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',true,''narc_attached'',true));',
  'ELSIF hit AND narc_attack THEN ams_result:=btech_resolve_standard_ams(p_catalogue_version,p_round,target,target_start,target_diff,true);target:=ams_result->''mech'';ams_intercepted:=coalesce((ams_result->>''intercepted'')::boolean,false);IF NOT ams_intercepted THEN target:=jsonb_set(target,''{narcPod}'',jsonb_build_object(''round'',p_round,''source'',p_attacker_instance_id),true);END IF;results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''ammo_bin_id'',ammo_bin_id,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',NOT ams_intercepted,''narc_attached'',NOT ams_intercepted,''ams'',CASE WHEN coalesce((ams_result->>''engaged'')::boolean,false) THEN ams_result-''mech'' END,''intercepted'',ams_intercepted));');
 patched:=replace(patched,
  'SELECT bin->>''id'' INTO ams_bin_id FROM jsonb_array_elements(coalesce(target->''ammoBins'',''[]''::jsonb)) bin WHERE bin->>''type''=''ams'' AND coalesce((bin->>''shots'')::int,0)>0 AND NOT coalesce((bin->>''destroyed'')::boolean,false) LIMIT 1;\n    SELECT mount.location INTO ams_mount_location FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=target_start->>''unitId'' AND mount.weapon_key=''ams'' AND NOT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=target_start->>''unitId'' AND slot.location=mount.location AND btech_weapon_slot_matches(slot.label,''ams'',''Anti-Missile System'') AND btech_critical_slot_is_damaged(target_start,slot.location,slot.slot_index)) LIMIT 1;\n    IF coalesce((weapon->>''missileWeapon'')::boolean,false) AND ams_bin_id IS NOT NULL AND ams_mount_location IS NOT NULL AND target_diff IN (0,1,5) THEN target:=btech_consume_one_live_ammo(target,''ams'',ams_bin_id);target:=jsonb_set(target,''{heat}'',to_jsonb(coalesce((target->>''heat'')::int,0)+1),true);ams_used:=true;ams_modifier:=-4;END IF;',
  'ams_result:=btech_resolve_standard_ams(p_catalogue_version,p_round,target,target_start,target_diff,false);target:=ams_result->''mech'';ams_used:=coalesce((ams_result->>''engaged'')::boolean,false);ams_modifier:=coalesce((ams_result->>''modifier'')::int,0);ams_bin_id:=ams_result->>''bin_id'';');
 patched:=replace(patched,
  'SELECT bin->>''id'' INTO ams_bin_id FROM jsonb_array_elements(coalesce(target->''ammoBins'',''[]''::jsonb)) bin WHERE bin->>''type''=''ams'' AND coalesce((bin->>''shots'')::int,0)>0 AND NOT coalesce((bin->>''destroyed'')::boolean,false) LIMIT 1;',
  'ams_result:=CASE WHEN coalesce((weapon->>''missileWeapon'')::boolean,false) THEN btech_resolve_standard_ams(p_catalogue_version,p_round,target,target_start,target_diff,false) ELSE jsonb_build_object(''mech'',target,''engaged'',false,''modifier'',0) END; /* ams_cluster_state_v1 */ target:=ams_result->''mech'';ams_used:=coalesce((ams_result->>''engaged'')::boolean,false);ams_modifier:=coalesce((ams_result->>''modifier'')::int,0);ams_bin_id:=ams_result->>''bin_id'';');
 patched:=replace(patched,
  'SELECT mount.location INTO ams_mount_location FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=target_start->>''unitId'' AND mount.weapon_key=''ams'' AND NOT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=target_start->>''unitId'' AND slot.location=mount.location AND btech_weapon_slot_matches(slot.label,''ams'',''Anti-Missile System'') AND btech_critical_slot_is_damaged(target_start,slot.location,slot.slot_index)) LIMIT 1;',
  '');
 patched:=replace(patched,
  'IF coalesce((weapon->>''missileWeapon'')::boolean,false) AND ams_bin_id IS NOT NULL AND ams_mount_location IS NOT NULL AND target_diff IN (0,1,5) THEN target:=btech_consume_one_live_ammo(target,''ams'',ams_bin_id);target:=jsonb_set(target,''{heat}'',to_jsonb(coalesce((target->>''heat'')::int,0)+1),true);ams_used:=true;ams_modifier:=-4;END IF;',
  '');
 patched:=replace(patched,'CASE WHEN streak THEN greatest(2,12+ams_modifier)','CASE WHEN streak THEN greatest(2,11+ams_modifier)');
 patched:=replace(patched,
  '''spotter_firing'',spotter_firing_mod,''partial_cover'',shallow_cover_mod)',
  '''spotter_firing'',spotter_firing_mod,''partial_cover'',shallow_cover_mod,''multiple_targets'',secondary_target_mod)');
 patched:=replace(patched,
  'CASE WHEN ams_used THEN jsonb_build_object(''bin_id'',ams_bin_id,''modifier'',ams_modifier) END',
  'CASE WHEN ams_used THEN ams_result-''mech'' END');
 IF patched=source OR position('multi_target_ams_v1' IN patched)=0 OR position('ams_cluster_state_v1' IN patched)=0 OR position('secondary_target_mod' IN patched)=0 OR position('11+ams_modifier' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install multiple-target and AMS weapon consequences';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.btech_process_multi_target_declaration(
 p_catalogue_version text,p_round int,p_state jsonb,p_attacker_instance_id text,p_allocations jsonb,p_resolve boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;allocation jsonb;checked jsonb;results jsonb:='[]'::jsonb;mounts text[];ammo jsonb;target_id text;primary_count int;
 attacker jsonb;attacker_start jsonb;target jsonb;direction int;facing_diff int;secondary_mod int;usage jsonb:='{}'::jsonb;mount_id text;bin_id text;shots_needed int;available int;
BEGIN
 IF jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Target allocations must be an array';END IF;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;attacker_start:=attacker->'weaponPhaseStart'->'mech';
 IF jsonb_array_length(coalesce(p_allocations,'[]'::jsonb))=0 THEN RETURN btech_process_weapon_declaration(p_catalogue_version,p_round,st,p_attacker_instance_id,NULL,ARRAY[]::text[],'{}'::jsonb,p_resolve);END IF;
 SELECT count(*) INTO primary_count FROM jsonb_array_elements(p_allocations) value WHERE coalesce((value->>'primary')::boolean,false);
 IF primary_count<>1 THEN RAISE EXCEPTION 'Choose exactly one primary target';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_allocations))<>(SELECT count(DISTINCT value->>'target_instance_id') FROM jsonb_array_elements(p_allocations) value) THEN RAISE EXCEPTION 'Each target may appear only once';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) value WHERE jsonb_typeof(coalesce(value->'weapon_mounts','[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(value->'weapon_mounts','[]'::jsonb))=0) THEN RAISE EXCEPTION 'Each declared target must have at least one allocated weapon';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) allocation CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(allocation->'weapon_mounts','[]'::jsonb)) mount GROUP BY mount HAVING count(*)>1) THEN RAISE EXCEPTION 'A weapon mount may be allocated only once';END IF;
 -- Reserve ammunition across every target before accepting the declaration.
 FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value LOOP
  FOR mount_id IN SELECT jsonb_array_elements_text(coalesce(allocation->'weapon_mounts','[]'::jsonb)) LOOP
   bin_id:=allocation->'ammo_bins'->>mount_id;IF bin_id IS NULL THEN CONTINUE;END IF;
   shots_needed:=CASE WHEN allocation->'ammo_bins'->'__fire_modes'->>mount_id='rapid' THEN 2 ELSE 1 END;
   usage:=jsonb_set(usage,ARRAY[bin_id],to_jsonb(coalesce((usage->>bin_id)::int,0)+shots_needed),true);
  END LOOP;
 END LOOP;
 FOR bin_id,shots_needed IN SELECT key,(value#>>'{}')::int FROM jsonb_each(usage) LOOP
  SELECT coalesce((value->>'shots')::int,0) INTO available FROM jsonb_array_elements(coalesce(attacker_start->'ammoBins','[]'::jsonb)) value WHERE value->>'id'=bin_id;
  IF coalesce(available,0)<shots_needed THEN RAISE EXCEPTION 'Ammunition bin % does not contain enough rounds for every allocated weapon',bin_id;END IF;
 END LOOP;
 -- If any declared target is in the torso-forward arc, Total Warfare requires
 -- one of those targets to be primary.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a JOIN LATERAL jsonb_array_elements(st->'mech_instances') t ON t->>'instanceId'=a->>'target_instance_id'
   WHERE (btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(t->>'col')::int,(t->>'row')::int)-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6 IN (0,1,5))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a JOIN LATERAL jsonb_array_elements(st->'mech_instances') t ON t->>'instanceId'=a->>'target_instance_id'
   WHERE coalesce((a->>'primary')::boolean,false) AND (btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(t->>'col')::int,(t->>'row')::int)-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6 IN (0,1,5))
 THEN RAISE EXCEPTION 'A target in the forward arc must be the primary target';END IF;
 FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value ORDER BY CASE WHEN coalesce((value->>'primary')::boolean,false) THEN 0 ELSE 1 END LOOP
  target_id:=allocation->>'target_instance_id';mounts:=ARRAY(SELECT jsonb_array_elements_text(coalesce(allocation->'weapon_mounts','[]'::jsonb)));ammo:=coalesce(allocation->'ammo_bins','{}'::jsonb);
  SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=target_id;
  direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target->>'col')::int,(target->>'row')::int);facing_diff:=(direction-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6;
  secondary_mod:=CASE WHEN coalesce((allocation->>'primary')::boolean,false) THEN 0 WHEN facing_diff IN (0,1,5) THEN 1 ELSE 2 END;ammo:=jsonb_set(ammo,'{__secondary_modifier}',to_jsonb(secondary_mod),true);
  checked:=btech_process_weapon_declaration(p_catalogue_version,p_round,st,p_attacker_instance_id,target_id,mounts,ammo,p_resolve);
  IF p_resolve THEN st:=checked->'state';results:=results||(SELECT coalesce(jsonb_agg(jsonb_set(value,'{target_instance_id}',to_jsonb(target_id),true)),'[]'::jsonb) FROM jsonb_array_elements(coalesce(checked->'results','[]'::jsonb)) value);END IF;
 END LOOP;
 RETURN jsonb_build_object('state',st,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.btech_process_multi_target_declaration(text,int,jsonb,text,jsonb,boolean) FROM PUBLIC;

-- Preserve the indirect-fire consequences introduced by SQL 65.  The
-- collector stores several target allocations in one event, so its spotting
-- metadata must be derived across those nested declarations before resolution.
CREATE OR REPLACE FUNCTION public.btech_prepare_multi_target_spotters(
 p_game_id uuid,p_round int,p_attacker_instance_id text,p_allocations jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE prepared jsonb:='[]'::jsonb;allocation jsonb;ammo jsonb;spotter text;spotter_fired boolean;attacker_is_spotter boolean;
BEGIN
 SELECT EXISTS (
  SELECT 1 FROM btech_combat_events event
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(event.declaration->'target_allocations','[]'::jsonb)) declared
  WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack'
   AND declared->'ammo_bins'->>'__indirect'='true' AND declared->'ammo_bins'->>'__spotter'=p_attacker_instance_id
 ) INTO attacker_is_spotter;
 FOR allocation IN SELECT value FROM jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) value LOOP
  ammo:=coalesce(allocation->'ammo_bins','{}'::jsonb);spotter:=ammo->>'__spotter';
  IF coalesce((ammo->>'__indirect')::boolean,false) AND spotter IS NOT NULL THEN
   SELECT EXISTS (
    SELECT 1 FROM btech_combat_events event
    WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack'
     AND event.attacker_instance_id=spotter AND jsonb_array_length(coalesce(event.declaration->'weapon_mounts','[]'::jsonb))>0
   ) INTO spotter_fired;
   ammo:=jsonb_set(ammo,'{__spotter_fired}',to_jsonb(spotter_fired),true);
  END IF;
  ammo:=jsonb_set(ammo,'{__spotting_while_firing}',to_jsonb(attacker_is_spotter),true);
  prepared:=prepared||jsonb_build_array(jsonb_set(allocation,'{ammo_bins}',ammo,true));
 END LOOP;
 RETURN prepared;
END $$;
REVOKE ALL ON FUNCTION public.btech_prepare_multi_target_spotters(uuid,int,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_multi_target_weapon_declaration(p_game_id uuid,p_attacker_instance_id text,p_target_allocations jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;attacker jsonb;attacker_start jsonb;units jsonb;before_units jsonb;checked jsonb;event_id uuid;sequence_no int;next_player uuid;combat_event btech_combat_events%ROWTYPE;resolution_payload jsonb;first_player uuid;activation jsonb;phase_complete boolean;primary_target text;all_mounts jsonb;pilot_resolution jsonb;declared_allocations jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your weapon-attack turn';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') value WHERE coalesce(value->'weaponPhaseStart'->>'round','-1')::int<>g.current_round) THEN SELECT jsonb_agg(jsonb_set(value,'{weaponPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'weaponPhaseStart'),true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);END IF;
 before_units:=st->'mech_instances';SELECT value INTO attacker FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_attacker_instance_id;attacker_start:=attacker->'weaponPhaseStart'->'mech';
 IF attacker IS NULL OR attacker_start IS NULL OR (attacker->>'owner')::int<>player.seat_number OR coalesce((attacker->>'hasFired')::boolean,false) OR coalesce((attacker_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or duplicate declaration';END IF;
 IF EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack' AND event.attacker_instance_id=p_attacker_instance_id) THEN RAISE EXCEPTION 'This BattleMech already has a Weapon Attack declaration';END IF;
 -- A spotter may support fire against only one target in a phase.  Enforce it
 -- both inside this split-fire declaration and against earlier declarations.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_target_allocations,'[]'::jsonb)) allocation WHERE allocation->'ammo_bins'->>'__indirect'='true' GROUP BY allocation->'ammo_bins'->>'__spotter' HAVING count(DISTINCT allocation->>'target_instance_id')>1) THEN RAISE EXCEPTION 'A spotter may designate only one target per Weapon Attack phase';END IF;
 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(coalesce(p_target_allocations,'[]'::jsonb)) incoming
  JOIN btech_combat_events event ON event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack'
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(event.declaration->'target_allocations','[]'::jsonb)) prior
  WHERE incoming->'ammo_bins'->>'__indirect'='true' AND prior->'ammo_bins'->>'__indirect'='true'
   AND incoming->'ammo_bins'->>'__spotter'=prior->'ammo_bins'->>'__spotter'
   AND incoming->>'target_instance_id'<>prior->>'target_instance_id'
 ) THEN RAISE EXCEPTION 'A spotter may designate only one target per Weapon Attack phase';END IF;
 checked:=btech_process_multi_target_declaration(g.catalogue_version,g.current_round,st,p_attacker_instance_id,coalesce(p_target_allocations,'[]'::jsonb),false);
 SELECT value->>'target_instance_id' INTO primary_target FROM jsonb_array_elements(coalesce(p_target_allocations,'[]'::jsonb)) value WHERE coalesce((value->>'primary')::boolean,false) LIMIT 1;
 SELECT coalesce(jsonb_agg(mount),'[]'::jsonb) INTO all_mounts FROM jsonb_array_elements(coalesce(p_target_allocations,'[]'::jsonb)) allocation CROSS JOIN LATERAL jsonb_array_elements(coalesce(allocation->'weapon_mounts','[]'::jsonb)) mount;
 SELECT coalesce(max(sequence),0)+1 INTO sequence_no FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='weapon_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration) VALUES(p_game_id,g.current_round,'weapon_attack',sequence_no,player.id,p_attacker_instance_id,primary_target,jsonb_build_object('target_allocations',coalesce(p_target_allocations,'[]'::jsonb),'weapon_mounts',all_mounts,'catalogue_version',g.catalogue_version)) RETURNING id INTO event_id;
 attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;st:=jsonb_set(st,'{mech_instances}',units,true);
 activation:=btech_advance_unit_activation(st,before_units,g.current_round,'weapon_attack',player.id,player.seat_number,'hasFired');st:=activation->'state';phase_complete:=coalesce((activation->>'phase_complete')::boolean,false);
 IF NOT phase_complete THEN next_player:=(activation->>'active_player_id')::uuid;st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(next_player),true);UPDATE btech_games SET active_player_id=next_player,state=st WHERE id=p_game_id;RETURN jsonb_build_object('status','waiting_for_activation','event_id',event_id,'remaining_in_activation',coalesce((activation->>'remaining')::int,0));END IF;
 FOR combat_event IN SELECT * FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack' AND event.status='declared' ORDER BY event.sequence FOR UPDATE LOOP
  declared_allocations:=coalesce(combat_event.declaration->'target_allocations',jsonb_build_array(jsonb_build_object('target_instance_id',combat_event.target_instance_id,'primary',true,'weapon_mounts',coalesce(combat_event.declaration->'weapon_mounts','[]'::jsonb),'ammo_bins',coalesce(combat_event.declaration->'ammo_bins','{}'::jsonb))));
  declared_allocations:=btech_prepare_multi_target_spotters(p_game_id,g.current_round,combat_event.attacker_instance_id,declared_allocations);
  checked:=btech_process_multi_target_declaration(g.catalogue_version,g.current_round,st,combat_event.attacker_instance_id,declared_allocations,true);st:=checked->'state';
  resolution_payload:=jsonb_build_object('results',checked->'results','state_version','multi-target-01','catalogue_version',g.catalogue_version);UPDATE btech_combat_events SET status='resolved',resolution=resolution_payload,resolved_at=now() WHERE id=combat_event.id;
 END LOOP;
 pilot_resolution:=btech_resolve_weapon_piloting_checks(p_game_id,g.catalogue_version,g.current_round,st);st:=pilot_resolution->'state';IF jsonb_array_length(coalesce(pilot_resolution->'checks','[]'::jsonb))>0 THEN UPDATE btech_combat_events SET resolution=jsonb_set(coalesce(resolution,'{}'::jsonb),'{piloting_checks}',pilot_resolution->'checks',true) WHERE id=(SELECT event.id FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack' ORDER BY event.sequence DESC LIMIT 1);END IF;
 units:=st->'mech_instances';SELECT jsonb_agg(jsonb_set(value,'{hasPhysicalAttacked}','false'::jsonb,true)) INTO units FROM jsonb_array_elements(units) value;st:=jsonb_set(st-'phase_activation','{mech_instances}',units,true);SELECT (st->'initiative_order'->0->>'player_id')::uuid INTO first_player;st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);UPDATE btech_games SET current_phase='physical_attack',active_player_id=first_player,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','event_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.submit_multi_target_weapon_declaration(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_multi_target_weapon_declaration(uuid,text,jsonb) TO authenticated;

-- Old clients remain compatible, but all declarations now enter the same
-- multi-target collector so mixed browser versions cannot resolve differently.
CREATE OR REPLACE FUNCTION public.submit_simultaneous_weapon_declaration(p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[] DEFAULT ARRAY[]::text[],p_ammo_bins jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN submit_multi_target_weapon_declaration(p_game_id,p_attacker_instance_id,CASE WHEN coalesce(array_length(p_weapon_mounts,1),0)=0 THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('target_instance_id',p_target_instance_id,'primary',true,'weapon_mounts',to_jsonb(p_weapon_mounts),'ammo_bins',coalesce(p_ammo_bins,'{}'::jsonb))) END);
END $$;
REVOKE ALL ON FUNCTION public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb) TO authenticated;

-- Attribute phase damage to each result's actual target instead of the event's
-- primary-target compatibility column.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_phase_critical_piloting(uuid,text,integer,jsonb,text,text)');IF fn IS NULL THEN RAISE EXCEPTION 'Phase piloting resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('multi_target_piloting_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'unit_id:=event_row.target_instance_id;candidate:=coalesce(pending->unit_id','unit_id:=coalesce(attack->>''target_instance_id'',event_row.target_instance_id); /* multi_target_piloting_v1 */ candidate:=coalesce(pending->unit_id');
 IF patched=source OR position('multi_target_piloting_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely make weapon piloting target-aware';END IF;EXECUTE patched;
END $$;
