-- Server-authoritative, simultaneous standard biped punches and kicks.
-- Run after SQL/22_alternating_unit_activations.sql.

CREATE OR REPLACE FUNCTION public.btech_physical_component_damaged(
 p_version text,p_mech jsonb,p_location text,p_label text
) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_version AND slot.unit_id=p_mech->>'unitId'
   AND slot.location=p_location AND slot.label=p_label
   AND btech_critical_slot_is_damaged(p_mech,p_location,slot.slot_index))
$$;
REVOKE ALL ON FUNCTION public.btech_physical_component_damaged(text,jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_physical_component_exists(
 p_version text,p_mech jsonb,p_location text,p_label text
) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_version AND slot.unit_id=p_mech->>'unitId'
   AND slot.location=p_location AND slot.label=p_label)
$$;
REVOKE ALL ON FUNCTION public.btech_physical_component_exists(text,jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_roll_physical_location(p_attack text,p_angle text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE die_roll int:=floor(random()*6+1);location_id text;
BEGIN
 IF p_attack='punch' THEN
  location_id:=CASE p_angle
   WHEN 'left' THEN CASE WHEN die_roll<=2 THEN 'lt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'la' ELSE 'head' END
   WHEN 'right' THEN CASE WHEN die_roll<=2 THEN 'rt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'ra' ELSE 'head' END
   ELSE CASE die_roll WHEN 1 THEN 'la' WHEN 2 THEN 'lt' WHEN 3 THEN 'ct' WHEN 4 THEN 'rt' WHEN 5 THEN 'ra' ELSE 'head' END END;
 ELSIF p_attack='kick' THEN
  location_id:=CASE p_angle WHEN 'left' THEN 'll' WHEN 'right' THEN 'rl'
   ELSE CASE WHEN die_roll<=3 THEN 'rl' ELSE 'll' END END;
 ELSE RAISE EXCEPTION 'Unsupported physical attack type';END IF;
 RETURN jsonb_build_object('die',die_roll,'location',location_id);
END $$;
REVOKE ALL ON FUNCTION public.btech_roll_physical_location(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_process_physical_declaration(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb,p_attacker_id text,p_target_id text,
 p_attack_type text,p_limbs text[],p_resolve boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;units jsonb;
 unit_mass int;attack_direction int;attack_diff int;target_direction int;target_diff int;angle text;
 attacker_mod int;target_mod int;terrain_mod int;base_tn int;limb text;tn int;damage int;reduction int;
 die_a int;die_b int;location_roll jsonb;damage_result jsonb;results jsonb:='[]'::jsonb;
 upper_label text;lower_label text;hand_or_foot text;weapon_fired boolean;hit boolean;
BEGIN
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_id;
 attacker_start:=attacker->'physicalPhaseStart'->'mech';
 IF attacker IS NULL OR attacker_start IS NULL OR coalesce(attacker->'physicalPhaseStart'->>'round','-1')::int<>p_round
  OR coalesce((attacker_start->>'destroyed')::boolean,false) OR coalesce((attacker_start->>'prone')::boolean,false)
 THEN RAISE EXCEPTION 'Attacker is not eligible for a standard physical attack';END IF;
 IF p_attack_type='pass' THEN
  IF p_target_id IS NOT NULL OR coalesce(array_length(p_limbs,1),0)>0 THEN RAISE EXCEPTION 'A pass cannot include a target or limb';END IF;
  RETURN jsonb_build_object('state',st,'results',results);
 END IF;
 IF p_attack_type NOT IN ('punch','kick') THEN RAISE EXCEPTION 'Choose punch, kick, or pass';END IF;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_id;
 target_start:=target->'physicalPhaseStart'->'mech';
 IF target IS NULL OR target_start IS NULL OR (target_start->>'owner')::int=(attacker_start->>'owner')::int
  OR coalesce((target_start->>'destroyed')::boolean,false) OR coalesce((target_start->>'prone')::boolean,false)
 THEN RAISE EXCEPTION 'Choose an eligible standing enemy target';END IF;
 IF btech_hex_distance((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int)<>1
 THEN RAISE EXCEPTION 'Standard punches and kicks require an adjacent target';END IF;
 SELECT (unit.definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units unit
  WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=attacker_start->>'unitId';
 IF unit_mass IS NULL THEN RAISE EXCEPTION 'Attacker is missing from the pinned catalogue';END IF;

 attack_direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);
 attack_diff:=(attack_direction-(attacker_start->>'facing')::int+6)%6;
 target_direction:=btech_direction_to((target_start->>'col')::int,(target_start->>'row')::int,(attacker_start->>'col')::int,(attacker_start->>'row')::int);
 target_diff:=(target_direction-(target_start->>'facing')::int+6)%6;
 angle:=CASE WHEN target_diff=1 THEN 'left' WHEN target_diff=5 THEN 'right' WHEN target_diff IN (2,3,4) THEN 'rear' ELSE 'front' END;
 IF p_attack_type='kick' AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION 'Kick target is outside the three forward hexes';END IF;
 IF p_attack_type='punch' AND attack_diff=3 THEN RAISE EXCEPTION 'Punch target is in the rear arc';END IF;
 IF p_attack_type='punch' AND (coalesce(array_length(p_limbs,1),0)<1 OR array_length(p_limbs,1)>2 OR EXISTS (SELECT 1 FROM unnest(p_limbs) x WHERE x NOT IN ('la','ra')) OR (SELECT count(DISTINCT x) FROM unnest(p_limbs) x)<>array_length(p_limbs,1))
 THEN RAISE EXCEPTION 'Choose one or both unique arms for a punch';END IF;
 IF p_attack_type='kick' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN ('ll','rl'))
 THEN RAISE EXCEPTION 'Choose one leg for a kick';END IF;
 IF p_attack_type='kick' AND (btech_physical_component_damaged(p_catalogue_version,attacker_start,'ll','Hip') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,'rl','Hip'))
 THEN RAISE EXCEPTION 'A damaged hip prevents all kick attacks';END IF;

 attacker_mod:=CASE attacker_start->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target_start->>'hexesMoved')::int,0)>=25 THEN 6 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=18 THEN 5 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END+CASE WHEN target_start->>'movementMode'='jump' THEN 1 ELSE 0 END;
 terrain_mod:=CASE btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 base_tn:=coalesce((attacker_start->>'pilotingSkill')::int,5)+attacker_mod+target_mod+terrain_mod+CASE WHEN p_attack_type='kick' THEN -2 ELSE 0 END;

 FOREACH limb IN ARRAY p_limbs LOOP
  IF coalesce((attacker_start->'structure'->>limb)::int,0)<=0 THEN RAISE EXCEPTION '% is destroyed',limb;END IF;
  IF p_attack_type='punch' AND ((attack_diff IN (1,2) AND limb<>'la') OR (attack_diff IN (4,5) AND limb<>'ra')) THEN RAISE EXCEPTION 'Only the arm facing the target side may punch';END IF;
  SELECT EXISTS (SELECT 1 FROM btech_combat_events event CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(event.declaration->'weapon_mounts','[]'::jsonb)) chosen(mount_id)
   JOIN btech_catalogue_mounts mount ON mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=chosen.mount_id
   WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack' AND event.attacker_instance_id=p_attacker_id AND mount.location=limb) INTO weapon_fired;
  IF weapon_fired THEN RAISE EXCEPTION 'A weapon fired from % this round',limb;END IF;
  tn:=base_tn;reduction:=0;
  IF p_attack_type='punch' THEN
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,'Shoulder') THEN RAISE EXCEPTION 'A damaged shoulder prevents this punch';END IF;
   upper_label:='Upper Arm Actuator';lower_label:='Lower Arm Actuator';hand_or_foot:='Hand Actuator';damage:=ceil(unit_mass/10.0)::int;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,upper_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF NOT btech_physical_component_exists(p_catalogue_version,attacker_start,limb,lower_label) OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,lower_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF NOT btech_physical_component_exists(p_catalogue_version,attacker_start,limb,hand_or_foot) OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,hand_or_foot) THEN tn:=tn+1;END IF;
  ELSE
   upper_label:='Upper Leg Actuator';lower_label:='Lower Leg Actuator';hand_or_foot:='Foot Actuator';damage:=ceil(unit_mass/5.0)::int;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,upper_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,lower_label) THEN tn:=tn+2;reduction:=reduction+1;END IF;
   IF btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,hand_or_foot) THEN tn:=tn+1;END IF;
  END IF;
  WHILE reduction>0 LOOP damage:=floor(damage/2.0)::int;reduction:=reduction-1;END LOOP;damage:=greatest(1,damage);
  IF p_resolve THEN
   die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);hit:=tn<=2 OR (tn<=12 AND die_a+die_b>=tn);
   IF hit THEN
    location_roll:=btech_roll_physical_location(p_attack_type,angle);damage_result:=btech_apply_direct_damage(target,damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';
    results:=results||jsonb_build_array(jsonb_build_object('attack_type',p_attack_type,'limb',limb,'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',tn),'hit',true,'angle',angle,'location_roll',location_roll,'location',location_roll->>'location','damage',damage,'critical_checks',damage_result->'critical_checks','piloting_check_required',p_attack_type='kick','piloting_check_unit',CASE WHEN p_attack_type='kick' THEN p_target_id END));
   ELSE
    results:=results||jsonb_build_array(jsonb_build_object('attack_type',p_attack_type,'limb',limb,'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',tn),'hit',false,'piloting_check_required',p_attack_type='kick','piloting_check_unit',CASE WHEN p_attack_type='kick' THEN p_attacker_id END));
   END IF;
  END IF;
 END LOOP;
 IF p_resolve THEN
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_target_id THEN target ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
 END IF;
 RETURN jsonb_build_object('state',st,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.btech_process_physical_declaration(uuid,text,int,jsonb,text,text,text,text[],boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_simultaneous_physical_declaration(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text DEFAULT NULL,p_attack_type text DEFAULT 'pass',p_limbs text[] DEFAULT ARRAY[]::text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;attacker jsonb;
 checked jsonb;event_id uuid;sequence_no int;activation jsonb;phase_complete boolean;next_player uuid;combat_event btech_combat_events%ROWTYPE;resolution_payload jsonb;first_player uuid;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'physical_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Physical Attack activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This build accepts catalogue-pinned matches only';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') value WHERE coalesce(value->'physicalPhaseStart'->>'round','-1')::int<>g.current_round) THEN
  SELECT jsonb_agg(jsonb_set(value,'{physicalPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'physicalPhaseStart'),true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);
 END IF;
 before_units:=st->'mech_instances';
 SELECT value INTO attacker FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_attacker_instance_id;
 IF attacker IS NULL OR (attacker->>'owner')::int<>player.seat_number OR coalesce((attacker->>'hasPhysicalAttacked')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or duplicate declaration';END IF;
 IF EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='physical_attack' AND event.attacker_instance_id=p_attacker_instance_id) THEN RAISE EXCEPTION 'This BattleMech already declared a Physical Attack';END IF;
 checked:=btech_process_physical_declaration(p_game_id,g.catalogue_version,g.current_round,st,p_attacker_instance_id,p_target_instance_id,p_attack_type,coalesce(p_limbs,ARRAY[]::text[]),false);
 SELECT coalesce(max(sequence),0)+1 INTO sequence_no FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='physical_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration)
 VALUES(p_game_id,g.current_round,'physical_attack',sequence_no,player.id,p_attacker_instance_id,p_target_instance_id,jsonb_build_object('attack_type',p_attack_type,'limbs',coalesce(p_limbs,ARRAY[]::text[]),'catalogue_version',g.catalogue_version)) RETURNING id INTO event_id;
 attacker:=jsonb_set(attacker,'{hasPhysicalAttacked}','true'::jsonb,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;st:=jsonb_set(st,'{mech_instances}',units,true);
 activation:=btech_advance_unit_activation(st,before_units,g.current_round,'physical_attack',player.id,player.seat_number,'hasPhysicalAttacked');st:=activation->'state';phase_complete:=coalesce((activation->>'phase_complete')::boolean,false);
 IF NOT phase_complete THEN next_player:=(activation->>'active_player_id')::uuid;st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(next_player),true);UPDATE btech_games SET active_player_id=next_player,state=st WHERE id=p_game_id;RETURN jsonb_build_object('status','waiting_for_activation','event_id',event_id,'remaining_in_activation',coalesce((activation->>'remaining')::int,0));END IF;
 FOR combat_event IN SELECT * FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='physical_attack' AND event.status='declared' ORDER BY event.sequence FOR UPDATE LOOP
  checked:=btech_process_physical_declaration(p_game_id,g.catalogue_version,g.current_round,st,combat_event.attacker_instance_id,combat_event.target_instance_id,combat_event.declaration->>'attack_type',ARRAY(SELECT jsonb_array_elements_text(combat_event.declaration->'limbs')),true);st:=checked->'state';resolution_payload:=jsonb_build_object('results',checked->'results','state_version','authoritative-physical-01','catalogue_version',g.catalogue_version);
  UPDATE btech_combat_events SET status='resolved',resolution=resolution_payload,resolved_at=now() WHERE id=combat_event.id;
 END LOOP;
 SELECT jsonb_agg(jsonb_set(value-'physicalPhaseStart','{hasManagedHeat}','false'::jsonb,true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st-'phase_activation','{mech_instances}',units,true);
 SELECT (st->'initiative_order'->0->>'player_id')::uuid INTO first_player;st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);
 UPDATE btech_games SET current_phase='heat',active_player_id=first_player,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','event_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[]) TO authenticated;

-- Prevent an older browser from bypassing the combat ledger by posting a
-- whole physical-phase state through the legacy shared-state RPC.
DO $$ BEGIN
 IF to_regprocedure('public.submit_phase_state_nonphysical_core(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.submit_phase_state(uuid,jsonb) RENAME TO submit_phase_state_nonphysical_core;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state_nonphysical_core(uuid,jsonb) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid,p_mech_instances jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE phase_name text;
BEGIN
 SELECT current_phase INTO phase_name FROM btech_games WHERE id=p_game_id;
 IF phase_name='physical_attack' THEN
  RAISE EXCEPTION 'Physical Attacks must use the authoritative declaration resolver';
 END IF;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,p_mech_instances);
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;
