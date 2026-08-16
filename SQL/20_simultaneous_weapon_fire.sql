-- Simultaneous Weapon Attack eligibility and exact ammunition-bin accounting.
-- Run after SQL/19_authoritative_missile_attacks.sql.

CREATE OR REPLACE FUNCTION public.btech_consume_simultaneous_ammo(p_live jsonb,p_start jsonb,p_type text,p_bin_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE live_mech jsonb:=p_live;start_bin jsonb;live_bin jsonb;position bigint;eligible boolean:=false;found_live boolean:=false;
BEGIN
 IF p_type IS NULL THEN RETURN live_mech;END IF;
 IF p_bin_id IS NULL THEN RAISE EXCEPTION 'An ammunition bin must be selected for %',p_type;END IF;
 FOR start_bin IN SELECT value FROM jsonb_array_elements(coalesce(p_start->'ammoBins','[]'::jsonb)) LOOP
  IF start_bin->>'id'=p_bin_id AND start_bin->>'type'=p_type AND coalesce((start_bin->>'shots')::int,0)>0 AND NOT coalesce((start_bin->>'destroyed')::boolean,false) THEN eligible:=true;EXIT;END IF;
 END LOOP;
 IF NOT eligible THEN RAISE EXCEPTION 'Selected % ammunition bin was empty, destroyed or incompatible at the start of this phase',p_type;END IF;
 FOR live_bin,position IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(live_mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF live_bin->>'id'=p_bin_id AND live_bin->>'type'=p_type THEN
   found_live:=true;
   -- A bin destroyed by earlier simultaneous damage was valid when declared;
   -- it has no surviving ammunition state to decrement.
   IF coalesce((live_bin->>'destroyed')::boolean,false) THEN RETURN live_mech;END IF;
   IF coalesce((live_bin->>'shots')::int,0)<=0 THEN RAISE EXCEPTION 'Selected % ammunition bin has no shots remaining',p_type;END IF;
   RETURN jsonb_set(live_mech,ARRAY['ammoBins',(position-1)::text,'shots'],to_jsonb((live_bin->>'shots')::int-1),true);
  END IF;
 END LOOP;
 IF NOT found_live THEN RAISE EXCEPTION 'Selected % ammunition bin no longer exists',p_type;END IF;
 RETURN live_mech;
END $$;

DROP FUNCTION IF EXISTS public.resolve_standard_weapon_attack(uuid,text,text,text[]);
CREATE OR REPLACE FUNCTION public.resolve_standard_weapon_attack(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[],p_ammo_bins jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;selected_mount_id text;
 mount_location text;selected_weapon_key text;weapon jsonb;weapon_name text;weapon_damage int;weapon_heat int;selected_ammo_type text;ammo_bin_id text;
 short_range int;medium_range int;long_range int;minimum_range int;cluster_size int;damage_per_missile int;
 dist int;range_mod int;move_mod int;target_mod int;woods int;base_tn int;tn int;sensor_mod int;heat_mod int;component_mod int;
 da int;db int;angle text:='front';damage_result jsonb;results jsonb:='[]'::jsonb;heat_added int:=0;event_id uuid;sequence_no int;units jsonb;
 firing_facing int;firing_direction int;facing_diff int;target_direction int;target_diff int;map_id text;critical_label text;
 location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your weapon-attack turn';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This development build accepts catalogue-pinned matches only';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 -- Capture all units before the first attack of each Weapon Attack phase. This
 -- is the eligibility state for simultaneous fire; live damage still persists.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') value WHERE coalesce(value->'weaponPhaseStart'->>'round','-1')::int<>g.current_round) THEN
  SELECT jsonb_agg(jsonb_set(value,'{weaponPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'weaponPhaseStart'),true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
  UPDATE btech_games SET state=st WHERE id=p_game_id;
 END IF;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;
 attacker_start:=attacker->'weaponPhaseStart'->'mech';target_start:=target->'weaponPhaseStart'->'mech';
 IF attacker IS NULL OR target IS NULL OR (attacker->>'owner')::int<>player.seat_number OR (target->>'owner')::int=player.seat_number OR coalesce((attacker->>'hasFired')::boolean,false) OR coalesce((attacker_start->>'destroyed')::boolean,false) OR coalesce((target_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or target';END IF;
 IF attacker->>'catalogueVersion' IS DISTINCT FROM g.catalogue_version OR target->>'catalogueVersion' IS DISTINCT FROM g.catalogue_version THEN RAISE EXCEPTION 'Unit catalogue does not match the pinned match catalogue';END IF;
 IF btech_critical_label_count(attacker_start,'Sensors')>=2 THEN RAISE EXCEPTION 'Destroyed sensors prevent weapon attacks';END IF;
 IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RAISE EXCEPTION 'Choose at least one weapon mount';END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_weapon_mounts) selected(mount_id) GROUP BY selected.mount_id HAVING count(*)>1) THEN RAISE EXCEPTION 'A weapon mount may be declared only once';END IF;
 IF jsonb_typeof(coalesce(p_ammo_bins,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Ammunition choices must be an object keyed by weapon mount';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_ammo_bins,'{}'::jsonb)) chosen(mount_id) WHERE NOT chosen.mount_id=ANY(p_weapon_mounts)) THEN RAISE EXCEPTION 'An ammunition choice was supplied for an undeclared weapon';END IF;

 dist:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);map_id:=coalesce(st->>'map_id','training-grounds');
 move_mod:=CASE attacker->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target->>'hexesMoved')::int,0)>=25 THEN 6 WHEN coalesce((target->>'hexesMoved')::int,0)>=18 THEN 5 WHEN coalesce((target->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END+CASE WHEN target->>'movementMode'='jump' THEN 1 ELSE 0 END;
 woods:=btech_intervening_woods(map_id,(attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int)+CASE btech_terrain(map_id,lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 IF woods>=3 THEN RAISE EXCEPTION 'Line of sight is blocked by intervening woods';END IF;
 sensor_mod:=CASE btech_critical_label_count(attacker_start,'Sensors') WHEN 1 THEN 2 ELSE 0 END;
 heat_mod:=CASE WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=24 THEN 4 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=17 THEN 3 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=13 THEN 2 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=8 THEN 1 ELSE 0 END;
 base_tn:=4+move_mod+target_mod+woods+sensor_mod+heat_mod;
 SELECT coalesce(max(sequence),0)+1 INTO sequence_no FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='weapon_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration)
 VALUES(p_game_id,g.current_round,'weapon_attack',sequence_no,player.id,p_attacker_instance_id,p_target_instance_id,jsonb_build_object('weapon_mounts',p_weapon_mounts,'ammo_bins',p_ammo_bins,'catalogue_version',g.catalogue_version)) RETURNING id INTO event_id;

 FOREACH selected_mount_id IN ARRAY p_weapon_mounts LOOP
  SELECT mount.location,mount.weapon_key,mount.definition,mount.raw_name INTO mount_location,selected_weapon_key,weapon,weapon_name
  FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=g.catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=selected_mount_id;
  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION 'Unsupported weapon mount: %',selected_mount_id;END IF;
  weapon_damage:=(weapon->>'damage')::int;weapon_heat:=(weapon->>'heat')::int;short_range:=(weapon->'range'->>0)::int;medium_range:=(weapon->'range'->>1)::int;long_range:=(weapon->'range'->>2)::int;
  minimum_range:=coalesce((weapon->>'minimumRange')::int,0);selected_ammo_type:=weapon->>'ammoType';cluster_size:=(weapon->>'clusterSize')::int;
  damage_per_missile:=coalesce((weapon->>'damagePerMissile')::int,CASE WHEN selected_weapon_key LIKE 'lrm%' THEN 1 WHEN selected_weapon_key LIKE 'srm%' THEN 2 END);
  IF cluster_size IS NOT NULL AND (damage_per_missile IS NULL OR btech_cluster_hits(cluster_size,7) IS NULL) THEN RAISE EXCEPTION '% cluster rules are not supported by this build',weapon_name;END IF;
  ammo_bin_id:=p_ammo_bins->>selected_mount_id;
  IF selected_ammo_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=g.catalogue_version AND bin.unit_id=attacker_start->>'unitId' AND bin.bin_id=ammo_bin_id AND bin.ammo_type=selected_ammo_type) THEN RAISE EXCEPTION 'Selected ammunition bin is not compatible with %',weapon_name;END IF;
  attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);

  IF coalesce((attacker_start->'structure'->>mount_location)::int,0)<=0 THEN RAISE EXCEPTION '% was mounted in a location destroyed before this phase',weapon_name;END IF;
  critical_label:=CASE selected_weapon_key WHEN 'ac20' THEN 'Autocannon/20' WHEN 'ac10' THEN 'Autocannon/10' WHEN 'ac5' THEN 'Autocannon/5' ELSE weapon_name END;
  IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=critical_label AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index)) THEN RAISE EXCEPTION '% was destroyed by a critical hit',weapon_name;END IF;
  component_mod:=0;
  IF mount_location IN ('la','ra') THEN
   IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND slot.label='Shoulder' AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index)) THEN component_mod:=4;
   ELSE SELECT count(*)::int INTO component_mod FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND slot.label IN ('Upper Arm Actuator','Lower Arm Actuator') AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index);END IF;
  END IF;
  firing_facing:=CASE WHEN mount_location IN ('lt','rt','ct','head') THEN coalesce((attacker->>'torsoFacing')::int,(attacker->>'facing')::int) ELSE (attacker->>'facing')::int END;
  firing_direction:=btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);facing_diff:=(firing_direction-firing_facing+6)%6;
  IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION '% target is outside its firing arc',weapon_name;END IF;
  target_direction:=btech_direction_to((target->>'col')::int,(target->>'row')::int,(attacker->>'col')::int,(attacker->>'row')::int);target_diff:=(target_direction-(target->>'facing')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN 'front' WHEN target_diff IN (1,5) THEN 'side' ELSE 'rear' END;
  IF dist>long_range THEN RAISE EXCEPTION '% is beyond long range',weapon_name;END IF;
  range_mod:=CASE WHEN dist<=short_range THEN 0 WHEN dist<=medium_range THEN 2 ELSE 4 END;IF minimum_range>0 AND dist<=minimum_range THEN range_mod:=range_mod+(minimum_range-dist+1);END IF;
  tn:=base_tn+range_mod+component_mod;da:=floor(random()*6+1);db:=floor(random()*6+1);
  IF da+db>=tn AND tn<=12 THEN
   IF cluster_size IS NULL THEN
    location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_direct_damage(target,weapon_damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';
    results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'location_roll',location_roll,'location',location_roll->>'location','damage',weapon_damage,'critical_checks',damage_result->'critical_checks'));
   ELSE
    cluster_da:=floor(random()*6+1);cluster_db:=floor(random()*6+1);missiles_hit:=btech_cluster_hits(cluster_size,cluster_da+cluster_db);missiles_remaining:=missiles_hit;groups:='[]'::jsonb;
    WHILE missiles_remaining>0 LOOP
     group_damage:=CASE WHEN selected_weapon_key LIKE 'lrm%' THEN least(5,missiles_remaining) ELSE damage_per_missile END;
     location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_direct_damage(target,group_damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';
     groups:=groups||jsonb_build_array(jsonb_build_object('location_roll',location_roll,'location',location_roll->>'location','damage',group_damage,'critical_checks',damage_result->'critical_checks'));
     missiles_remaining:=missiles_remaining-CASE WHEN selected_weapon_key LIKE 'lrm%' THEN least(5,missiles_remaining) ELSE 1 END;
    END LOOP;
    results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'cluster_roll',jsonb_build_object('die_a',cluster_da,'die_b',cluster_db,'total',cluster_da+cluster_db),'missiles_hit',missiles_hit,'groups',groups));
   END IF;
  ELSE results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',false));END IF;
  heat_added:=heat_added+weapon_heat;
 END LOOP;
 attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);attacker:=jsonb_set(attacker,'{weaponHeat}',to_jsonb(coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 attacker:=jsonb_set(attacker,'{heat}',to_jsonb(coalesce((attacker->>'roundStartingHeat')::int,0)+coalesce((attacker->>'movementHeat')::int,0)+coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker WHEN value->>'instanceId'=p_target_instance_id THEN target ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
 UPDATE btech_combat_events SET status='resolved',resolution=jsonb_build_object('results',results,'state_version','simultaneous-weapon-fire-01','catalogue_version',g.catalogue_version),resolved_at=now() WHERE id=event_id;
 RETURN jsonb_build_object('event_id',event_id,'results',results,'catalogue_version',g.catalogue_version);
EXCEPTION WHEN OTHERS THEN
 IF event_id IS NOT NULL THEN UPDATE btech_combat_events SET status='rejected',resolution=jsonb_build_object('error',SQLERRM),resolved_at=now() WHERE id=event_id;END IF;RAISE;
END $$;
REVOKE ALL ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[],jsonb) TO authenticated;

-- Capture the simultaneous-fire baseline at the Reaction -> Weapon Attack
-- transition, and do not consider a newly destroyed eligible unit complete
-- until it has submitted its Weapon Attack choice.
CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid, p_mech_instances jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game btech_games%ROWTYPE; v_player btech_players%ROWTYPE; v_state jsonb; v_instances jsonb;
  v_next uuid; v_next_phase text; v_complete boolean;
BEGIN
  IF jsonb_typeof(p_mech_instances) <> 'array' THEN RAISE EXCEPTION 'Mech state must be an array'; END IF;
  SELECT * INTO v_game FROM btech_games WHERE id = p_game_id FOR UPDATE;
  SELECT * INTO v_player FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid() AND role = 'player';
  IF NOT FOUND OR v_game.active_player_id IS DISTINCT FROM v_player.id THEN RAISE EXCEPTION 'It is not your turn'; END IF;
  IF v_game.current_phase NOT IN ('movement','reaction','weapon_attack','physical_attack','heat') THEN RAISE EXCEPTION 'This phase does not accept unit actions'; END IF;
  v_state := CASE jsonb_typeof(v_game.state) WHEN 'string' THEN COALESCE((v_game.state #>> '{}')::jsonb, '{}'::jsonb) WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
  SELECT COALESCE(jsonb_agg(COALESCE(incoming.value, existing.value)), '[]'::jsonb) INTO v_instances
  FROM jsonb_array_elements(COALESCE(v_state->'mech_instances','[]'::jsonb)) existing(value)
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_mech_instances) value WHERE value->>'instanceId' = existing.value->>'instanceId' AND (value->>'owner')::int = v_player.seat_number LIMIT 1) incoming ON (existing.value->>'owner')::int = v_player.seat_number;
  v_state := jsonb_set(v_state, '{mech_instances}', v_instances, true);
  SELECT CASE v_game.current_phase WHEN 'movement' THEN bool_and(COALESCE((value->>'hasMoved')::boolean,false)) WHEN 'reaction' THEN bool_and(COALESCE((value->>'hasReacted')::boolean,false)) WHEN 'weapon_attack' THEN bool_and(COALESCE((value->>'hasFired')::boolean,false)) WHEN 'physical_attack' THEN bool_and(COALESCE((value->>'hasPhysicalAttacked')::boolean,false)) ELSE bool_and(COALESCE((value->>'hasManagedHeat')::boolean,false)) END INTO v_complete FROM jsonb_array_elements(v_instances) value WHERE (value->>'owner')::int = v_player.seat_number AND CASE WHEN v_game.current_phase='weapon_attack' AND coalesce(value->'weaponPhaseStart'->>'round','-1')::int=v_game.current_round THEN NOT coalesce((value->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false) ELSE NOT coalesce((value->>'destroyed')::boolean,false) END;
  IF NOT COALESCE(v_complete, true) THEN UPDATE btech_games SET state = v_state WHERE id = p_game_id; RETURN; END IF;
  SELECT (entry->>'player_id')::uuid INTO v_next FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY ordered(entry, pos) WHERE pos > COALESCE((SELECT pos FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY mine(entry, pos) WHERE mine.entry->>'player_id' = v_player.id::text), 999) ORDER BY pos LIMIT 1;
  IF v_next IS NOT NULL THEN
    v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb(v_next), true);
    UPDATE btech_games SET active_player_id = v_next, state = v_state WHERE id = p_game_id; RETURN;
  END IF;
  v_next_phase := CASE v_game.current_phase WHEN 'movement' THEN 'reaction' WHEN 'reaction' THEN 'weapon_attack' WHEN 'weapon_attack' THEN 'physical_attack' WHEN 'physical_attack' THEN 'heat' ELSE 'initiative' END;
  IF v_next_phase = 'initiative' THEN
    v_state := jsonb_set(v_state, '{initiative_order}', '[]'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_rolls}', '[]'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_round}', 'null'::jsonb, true); v_state := jsonb_set(v_state, '{initiative_pending}', '[]'::jsonb, true);
    SELECT jsonb_agg(jsonb_set(value, '{torsoFacing}', COALESCE(value->'facing', '0'::jsonb), true)) INTO v_instances FROM jsonb_array_elements(v_instances) value;
    v_state := jsonb_set(v_state, '{mech_instances}', COALESCE(v_instances, '[]'::jsonb), true);
    UPDATE btech_games SET current_round = v_game.current_round + 1, current_phase = 'initiative', active_player_id = NULL, initiative_winner = NULL, state = v_state WHERE id = p_game_id;
  ELSE
    SELECT jsonb_agg(CASE v_next_phase WHEN 'reaction' THEN jsonb_set(value,'{hasReacted}','false'::jsonb,true) WHEN 'weapon_attack' THEN jsonb_set(jsonb_set(value,'{hasFired}','false'::jsonb,true),'{weaponPhaseStart}',jsonb_build_object('round',v_game.current_round,'mech',value-'weaponPhaseStart'),true) WHEN 'physical_attack' THEN jsonb_set(value,'{hasPhysicalAttacked}','false'::jsonb,true) ELSE jsonb_set(value,'{hasManagedHeat}','false'::jsonb,true) END) INTO v_instances FROM jsonb_array_elements(v_instances) value;
    v_state := jsonb_set(v_state, '{mech_instances}', v_instances, true);
    SELECT (v_state->'initiative_order'->0->>'player_id')::uuid INTO v_next;
    v_state := jsonb_set(v_state, '{active_player_player_id}', to_jsonb(v_next), true);
    UPDATE btech_games SET current_phase = v_next_phase, active_player_id = v_next, state = v_state WHERE id = p_game_id;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;
