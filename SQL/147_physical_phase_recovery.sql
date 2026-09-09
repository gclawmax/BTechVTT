-- Run after SQL 146. Completes pending physical events before Heat.
BEGIN;
CREATE OR REPLACE FUNCTION public.btech_has_remaining_physical_option(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb,p_attacker jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE attacker_start jsonb:=CASE WHEN coalesce((p_attacker->'physicalPhaseStart'->>'round')::int,-1)=p_round THEN coalesce(p_attacker->'physicalPhaseStart'->'mech',p_attacker) ELSE p_attacker END;target jsonb;target_start jsonb;
 attack_direction int;attack_diff int;level_difference int;limb text;arm_weapon_fired boolean;has_physical_weapon boolean;
BEGIN
 IF p_attacker ? 'dfaDeclaration' OR p_attacker ? 'chargeDeclaration' OR coalesce((attacker_start->>'improvisedClub')::boolean,false) THEN RETURN true;END IF;
 IF coalesce((p_attacker->>'hasPhysicalAttacked')::boolean,false) OR coalesce((attacker_start->>'destroyed')::boolean,false)
  OR coalesce((attacker_start->>'prone')::boolean,false) OR coalesce((attacker_start->>'shutdown')::boolean,false)
  OR coalesce(attacker_start->'pilot'->>'consciousness','conscious')<>'conscious' THEN RETURN false;END IF;
 -- Do not auto-skip a BattleMech that has a catalogue-defined physical weapon;
 -- its detailed installation and actuator tests are performed on declaration.
 SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>'unitId'
   AND btech_physical_weapon_profile(lower(replace(slot.label,' ', '_'))) IS NOT NULL) INTO has_physical_weapon;
 IF has_physical_weapon THEN RETURN true;END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value LOOP
  target_start:=CASE WHEN coalesce((target->'physicalPhaseStart'->>'round')::int,-1)=p_round THEN coalesce(target->'physicalPhaseStart'->'mech',target) ELSE target END;
  IF (target_start->>'owner')::int=(attacker_start->>'owner')::int OR coalesce((target_start->>'destroyed')::boolean,false) THEN CONTINUE;END IF;
  IF btech_hex_distance((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int)<>1 THEN CONTINUE;END IF;
  attack_direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);
  attack_diff:=(attack_direction-(attacker_start->>'facing')::int+6)%6;
  level_difference:=btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0'))
   - btech_elevation(coalesce(p_state->>'map_id','training-grounds'),lpad(attacker_start->>'col',2,'0')||lpad(attacker_start->>'row',2,'0'));
  IF abs(level_difference)>1 THEN CONTINUE;END IF;
  -- A kick remains legal when a target is prone, but not when it is higher
  -- than the attacker; no arm-weapon use can prevent a kick.
  IF attack_diff IN (0,1,5) AND (coalesce((target_start->>'prone')::boolean,false) OR level_difference<=0)
   AND NOT (btech_physical_component_damaged(p_catalogue_version,attacker_start,'ll','Hip') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,'rl','Hip'))
   AND (coalesce((attacker_start->'structure'->>'ll')::int,0)>0 OR coalesce((attacker_start->'structure'->>'rl')::int,0)>0) THEN RETURN true;END IF;
  -- Standard punches need a standing target, a non-rear arc, the matching
  -- surviving arm/shoulder, and an arm that did not fire in Weapon Attack.
  IF NOT coalesce((target_start->>'prone')::boolean,false) AND level_difference>=0 AND attack_diff<>3 THEN
   FOREACH limb IN ARRAY CASE WHEN attack_diff IN (1,2) THEN ARRAY['la']::text[] WHEN attack_diff IN (4,5) THEN ARRAY['ra']::text[] ELSE ARRAY['la','ra']::text[] END LOOP
    IF coalesce((attacker_start->'structure'->>limb)::int,0)<=0 OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,'Shoulder') THEN CONTINUE;END IF;
    SELECT EXISTS (SELECT 1 FROM btech_combat_events event CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(event.declaration->'weapon_mounts','[]'::jsonb)) chosen(mount_id)
     JOIN btech_catalogue_mounts mount ON mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=chosen.mount_id
     WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack' AND event.attacker_instance_id=p_attacker->>'instanceId' AND mount.location=limb) INTO arm_weapon_fired;
    IF NOT arm_weapon_fired THEN RETURN true;END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.btech_has_remaining_physical_option(uuid,text,int,jsonb,jsonb) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.recover_stalled_physical_phase(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;units jsonb;checked jsonb;ev btech_combat_events%ROWTYPE;first_player uuid;resolved_count int:=0;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player') THEN RAISE EXCEPTION 'Only seated players may recover this match';END IF;
 IF g.status<>'in-progress' OR g.current_phase<>'physical_attack' THEN RETURN jsonb_build_object('status','not_physical');END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) WHERE btech_has_remaining_physical_option(g.id,g.catalogue_version,g.current_round,st,value)) THEN
  RETURN jsonb_build_object('status','actions_remaining','message','Legal physical actions remain. Complete or pass those actions first.');
 END IF;
 -- Preserve current-round declaration snapshots. Capture a fresh snapshot only
 -- for units whose previous-round snapshot survived the old empty-phase skip.
 SELECT jsonb_agg(jsonb_set(CASE WHEN coalesce((value->'physicalPhaseStart'->>'round')::int,-1)=g.current_round THEN value
  ELSE jsonb_set(value,'{physicalPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'physicalPhaseStart'),true) END,
  '{hasPhysicalAttacked}','true'::jsonb,true)) INTO units FROM jsonb_array_elements(st->'mech_instances');
 st:=jsonb_set(st,'{mech_instances}',coalesce(units,'[]'::jsonb),true);
 FOR ev IN SELECT * FROM btech_combat_events event WHERE event.game_id=g.id AND event.round=g.current_round AND event.phase='physical_attack' AND event.status='declared' ORDER BY event.sequence FOR UPDATE LOOP
  checked:=btech_process_physical_declaration(g.id,g.catalogue_version,g.current_round,st,ev.attacker_instance_id,ev.target_instance_id,ev.declaration->>'attack_type',ARRAY(SELECT jsonb_array_elements_text(coalesce(ev.declaration->'limbs','[]'::jsonb))),true);
  st:=checked->'state';
  UPDATE btech_combat_events SET status='resolved',resolution=jsonb_build_object('results',checked->'results','state_version','physical-recovery-147','catalogue_version',g.catalogue_version),resolved_at=now() WHERE id=ev.id;
  resolved_count:=resolved_count+1;
 END LOOP;
 checked:=btech_resolve_physical_piloting_checks(g.id,g.catalogue_version,g.current_round,st);st:=checked->'state';
 IF jsonb_array_length(coalesce(checked->'checks','[]'::jsonb))>0 THEN
  UPDATE btech_combat_events SET resolution=jsonb_set(coalesce(resolution,'{}'::jsonb),'{piloting_checks}',checked->'checks',true)
   WHERE id=(SELECT event.id FROM btech_combat_events event WHERE event.game_id=g.id AND event.round=g.current_round AND event.phase='physical_attack' ORDER BY event.sequence DESC LIMIT 1);
 END IF;
 SELECT jsonb_agg((value-'physicalPhaseStart')||'{"hasManagedHeat":false}'::jsonb) INTO units FROM jsonb_array_elements(st->'mech_instances');
 SELECT (st->'initiative_order'->0->>'player_id')::uuid INTO first_player;
 IF first_player IS NULL THEN RAISE EXCEPTION 'Cannot recover without an initiative order';END IF;
 st:=jsonb_set(st-'phase_activation','{mech_instances}',coalesce(units,'[]'::jsonb),true);
 st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);
 UPDATE btech_games SET current_phase='heat',active_player_id=first_player,state=st WHERE id=g.id;
 RETURN jsonb_build_object('status','recovered','resolved_events',resolved_count);
END $$;
REVOKE ALL ON FUNCTION public.recover_stalled_physical_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stalled_physical_phase(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.skip_empty_physical_phase(p_game_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN coalesce(recover_stalled_physical_phase(p_game_id)->>'status'='recovered',false);
END $$;
REVOKE ALL ON FUNCTION public.skip_empty_physical_phase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skip_empty_physical_phase(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
