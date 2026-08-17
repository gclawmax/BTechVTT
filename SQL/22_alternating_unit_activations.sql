-- Total Warfare unequal-force activation order for Movement, Weapon Attack,
-- and Physical Attack.
-- Run after SQL/21_simultaneous_weapon_declarations.sql.

CREATE OR REPLACE FUNCTION public.btech_units_left_to_act(p_units jsonb,p_round int,p_phase text,p_seat int,p_flag text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT count(*)::int FROM jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) unit
 WHERE (unit->>'owner')::int=p_seat
 AND CASE WHEN p_phase='weapon_attack'
  THEN coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=p_round AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false)
  ELSE NOT coalesce((unit->>'destroyed')::boolean,false) END
 AND NOT coalesce((unit->>p_flag)::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.btech_units_left_to_act(jsonb,int,text,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_advance_unit_activation(
 p_state jsonb,p_before_units jsonb,p_round int,p_phase text,p_current_player uuid,p_current_seat int,p_flag text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE st jsonb:=p_state;tracker jsonb:=p_state->'phase_activation';first_id uuid;second_id uuid;first_seat int;second_seat int;
 other_id uuid;other_seat int;pair_first uuid;current_remaining int;next_quota int;before_current int;after_current int;
 before_other int;after_other int;completed int;first_after int;second_after int;new_active uuid;new_seat int;new_other int;quota int;
BEGIN
 SELECT (entry->>'player_id')::uuid,(entry->>'seat_number')::int INTO first_id,first_seat FROM jsonb_array_elements(st->'initiative_order') WITH ORDINALITY ordered(entry,pos) WHERE pos=1;
 SELECT (entry->>'player_id')::uuid,(entry->>'seat_number')::int INTO second_id,second_seat FROM jsonb_array_elements(st->'initiative_order') WITH ORDINALITY ordered(entry,pos) WHERE pos=2;
 IF first_id IS NULL OR second_id IS NULL THEN RAISE EXCEPTION 'Two initiative players are required for alternating activations';END IF;
 IF p_current_player=first_id THEN other_id:=second_id;other_seat:=second_seat;ELSE other_id:=first_id;other_seat:=first_seat;END IF;
 before_current:=btech_units_left_to_act(p_before_units,p_round,p_phase,p_current_seat,p_flag);
 after_current:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,p_current_seat,p_flag);
 before_other:=btech_units_left_to_act(p_before_units,p_round,p_phase,other_seat,p_flag);
 after_other:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,other_seat,p_flag);
 completed:=before_current-after_current;
 IF completed<>1 THEN RAISE EXCEPTION 'Exactly one BattleMech must act per submission';END IF;

 IF tracker IS NULL OR coalesce((tracker->>'round')::int,-1)<>p_round OR tracker->>'phase'<>p_phase OR tracker->>'current_player_id'<>p_current_player::text THEN
  current_remaining:=CASE WHEN before_other=0 THEN before_current ELSE greatest(1,before_current/before_other) END;
  next_quota:=CASE WHEN before_current=0 THEN before_other ELSE greatest(1,before_other/before_current) END;
  pair_first:=p_current_player;
 ELSE
  current_remaining:=(tracker->>'remaining')::int;
  next_quota:=coalesce((tracker->>'next_quota')::int,1);
  pair_first:=(tracker->>'pair_first_player_id')::uuid;
 END IF;
 current_remaining:=current_remaining-1;
 IF current_remaining>0 AND after_current>0 THEN
  tracker:=jsonb_build_object('round',p_round,'phase',p_phase,'current_player_id',p_current_player,'remaining',current_remaining,'pair_first_player_id',pair_first,'next_quota',next_quota);
  st:=jsonb_set(st,'{phase_activation}',tracker,true);
  RETURN jsonb_build_object('state',st,'active_player_id',p_current_player,'phase_complete',false,'remaining',current_remaining);
 END IF;

 IF p_current_player=pair_first AND after_other>0 THEN
  current_remaining:=least(next_quota,after_other);
  tracker:=jsonb_build_object('round',p_round,'phase',p_phase,'current_player_id',other_id,'remaining',current_remaining,'pair_first_player_id',pair_first,'next_quota',1);
  st:=jsonb_set(st,'{phase_activation}',tracker,true);
  RETURN jsonb_build_object('state',st,'active_player_id',other_id,'phase_complete',false,'remaining',current_remaining);
 END IF;

 first_after:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,first_seat,p_flag);
 second_after:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,second_seat,p_flag);
 IF first_after+second_after=0 THEN
  RETURN jsonb_build_object('state',st-'phase_activation','active_player_id',NULL,'phase_complete',true,'remaining',0);
 END IF;
 IF first_after>0 THEN new_active:=first_id;new_seat:=first_seat;new_other:=second_after;
 ELSE new_active:=second_id;new_seat:=second_seat;new_other:=first_after;END IF;
 after_current:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,new_seat,p_flag);
 quota:=CASE WHEN new_other=0 THEN after_current ELSE greatest(1,after_current/new_other) END;
 other_id:=CASE WHEN new_active=first_id THEN second_id ELSE first_id END;
 before_other:=btech_units_left_to_act(st->'mech_instances',p_round,p_phase,CASE WHEN new_active=first_id THEN second_seat ELSE first_seat END,p_flag);
 next_quota:=CASE WHEN after_current=0 THEN before_other ELSE greatest(1,before_other/after_current) END;
 tracker:=jsonb_build_object('round',p_round,'phase',p_phase,'current_player_id',new_active,'remaining',quota,'pair_first_player_id',new_active,'next_quota',next_quota);
 st:=jsonb_set(st,'{phase_activation}',tracker,true);
 RETURN jsonb_build_object('state',st,'active_player_id',new_active,'phase_complete',false,'remaining',quota);
END $$;
REVOKE ALL ON FUNCTION public.btech_advance_unit_activation(jsonb,jsonb,int,text,uuid,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid,p_mech_instances jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_game btech_games%ROWTYPE;v_player btech_players%ROWTYPE;v_state jsonb;v_instances jsonb;v_before jsonb;
 v_next uuid;v_next_phase text;v_complete boolean;activation jsonb;
BEGIN
 IF jsonb_typeof(p_mech_instances)<>'array' THEN RAISE EXCEPTION 'Mech state must be an array';END IF;
 SELECT * INTO v_game FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO v_player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR v_game.active_player_id IS DISTINCT FROM v_player.id THEN RAISE EXCEPTION 'It is not your turn';END IF;
 IF v_game.current_phase NOT IN ('movement','reaction','weapon_attack','physical_attack','heat') THEN RAISE EXCEPTION 'This phase does not accept unit actions';END IF;
 v_state:=CASE jsonb_typeof(v_game.state) WHEN 'string' THEN coalesce((v_game.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN v_game.state ELSE '{}'::jsonb END;
 v_before:=coalesce(v_state->'mech_instances','[]'::jsonb);
 SELECT coalesce(jsonb_agg(coalesce(incoming.value,existing.value)),'[]'::jsonb) INTO v_instances
 FROM jsonb_array_elements(v_before) existing(value)
 LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(p_mech_instances) value WHERE value->>'instanceId'=existing.value->>'instanceId' AND (value->>'owner')::int=v_player.seat_number LIMIT 1) incoming ON (existing.value->>'owner')::int=v_player.seat_number;
 v_state:=jsonb_set(v_state,'{mech_instances}',v_instances,true);

 IF v_game.current_phase IN ('movement','physical_attack') THEN
  activation:=btech_advance_unit_activation(v_state,v_before,v_game.current_round,v_game.current_phase,v_player.id,v_player.seat_number,
   CASE WHEN v_game.current_phase='movement' THEN 'hasMoved' ELSE 'hasPhysicalAttacked' END);
  v_state:=activation->'state';v_complete:=coalesce((activation->>'phase_complete')::boolean,false);
  IF NOT v_complete THEN
   v_next:=(activation->>'active_player_id')::uuid;
   v_state:=jsonb_set(v_state,'{active_player_player_id}',to_jsonb(v_next),true);
   UPDATE btech_games SET active_player_id=v_next,state=v_state WHERE id=p_game_id;RETURN;
  END IF;
 ELSE
  SELECT CASE v_game.current_phase WHEN 'reaction' THEN bool_and(coalesce((value->>'hasReacted')::boolean,false)) WHEN 'weapon_attack' THEN bool_and(coalesce((value->>'hasFired')::boolean,false)) WHEN 'physical_attack' THEN bool_and(coalesce((value->>'hasPhysicalAttacked')::boolean,false)) ELSE bool_and(coalesce((value->>'hasManagedHeat')::boolean,false)) END INTO v_complete
  FROM jsonb_array_elements(v_instances) value WHERE (value->>'owner')::int=v_player.seat_number AND NOT coalesce((value->>'destroyed')::boolean,false);
  IF NOT coalesce(v_complete,true) THEN UPDATE btech_games SET state=v_state WHERE id=p_game_id;RETURN;END IF;
  SELECT (entry->>'player_id')::uuid INTO v_next FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY ordered(entry,pos)
  WHERE pos>coalesce((SELECT pos FROM jsonb_array_elements(v_state->'initiative_order') WITH ORDINALITY mine(entry,pos) WHERE mine.entry->>'player_id'=v_player.id::text),999) ORDER BY pos LIMIT 1;
  IF v_next IS NOT NULL THEN v_state:=jsonb_set(v_state,'{active_player_player_id}',to_jsonb(v_next),true);UPDATE btech_games SET active_player_id=v_next,state=v_state WHERE id=p_game_id;RETURN;END IF;
 END IF;

 v_next_phase:=CASE v_game.current_phase WHEN 'movement' THEN 'reaction' WHEN 'reaction' THEN 'weapon_attack' WHEN 'weapon_attack' THEN 'physical_attack' WHEN 'physical_attack' THEN 'heat' ELSE 'initiative' END;
 v_state:=v_state-'phase_activation';
 IF v_next_phase='initiative' THEN
  v_state:=jsonb_set(v_state,'{initiative_order}','[]'::jsonb,true);v_state:=jsonb_set(v_state,'{initiative_rolls}','[]'::jsonb,true);v_state:=jsonb_set(v_state,'{initiative_round}','null'::jsonb,true);v_state:=jsonb_set(v_state,'{initiative_pending}','[]'::jsonb,true);
  SELECT jsonb_agg(jsonb_set(value,'{torsoFacing}',coalesce(value->'facing','0'::jsonb),true)) INTO v_instances FROM jsonb_array_elements(v_instances) value;
  v_state:=jsonb_set(v_state,'{mech_instances}',coalesce(v_instances,'[]'::jsonb),true);
  UPDATE btech_games SET current_round=v_game.current_round+1,current_phase='initiative',active_player_id=NULL,initiative_winner=NULL,state=v_state WHERE id=p_game_id;
 ELSE
  SELECT jsonb_agg(CASE v_next_phase WHEN 'reaction' THEN jsonb_set(value,'{hasReacted}','false'::jsonb,true)
   WHEN 'weapon_attack' THEN jsonb_set(jsonb_set(value,'{hasFired}','false'::jsonb,true),'{weaponPhaseStart}',jsonb_build_object('round',v_game.current_round,'mech',value-'weaponPhaseStart'),true)
   WHEN 'physical_attack' THEN jsonb_set(value,'{hasPhysicalAttacked}','false'::jsonb,true)
   ELSE jsonb_set(value,'{hasManagedHeat}','false'::jsonb,true) END) INTO v_instances FROM jsonb_array_elements(v_instances) value;
  v_state:=jsonb_set(v_state,'{mech_instances}',v_instances,true);
  SELECT (v_state->'initiative_order'->0->>'player_id')::uuid INTO v_next;
  v_state:=jsonb_set(v_state,'{active_player_player_id}',to_jsonb(v_next),true);
  UPDATE btech_games SET current_phase=v_next_phase,active_player_id=v_next,state=v_state WHERE id=p_game_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;

-- Queue one Weapon Attack declaration, then hand activation to the side
-- selected by the same unequal-force scheduler. Resolve only after every
-- eligible unit on both sides has declared, preserving simultaneous fire.
CREATE OR REPLACE FUNCTION public.submit_simultaneous_weapon_declaration(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[] DEFAULT ARRAY[]::text[],p_ammo_bins jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;attacker jsonb;attacker_start jsonb;units jsonb;before_units jsonb;
 checked jsonb;event_id uuid;sequence_no int;next_player uuid;combat_event btech_combat_events%ROWTYPE;
 resolution_payload jsonb;first_player uuid;activation jsonb;phase_complete boolean;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your weapon-attack turn';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This development build accepts catalogue-pinned matches only';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') value WHERE coalesce(value->'weaponPhaseStart'->>'round','-1')::int<>g.current_round) THEN
  SELECT jsonb_agg(jsonb_set(value,'{weaponPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'weaponPhaseStart'),true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
 END IF;
 before_units:=st->'mech_instances';
 SELECT value INTO attacker FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_attacker_instance_id;
 attacker_start:=attacker->'weaponPhaseStart'->'mech';
 IF attacker IS NULL OR attacker_start IS NULL OR (attacker->>'owner')::int<>player.seat_number OR coalesce((attacker->>'hasFired')::boolean,false) OR coalesce((attacker_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or duplicate declaration';END IF;
 IF EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack' AND event.attacker_instance_id=p_attacker_instance_id) THEN RAISE EXCEPTION 'This BattleMech already has a Weapon Attack declaration';END IF;

 checked:=btech_process_weapon_declaration(g.catalogue_version,g.current_round,st,p_attacker_instance_id,p_target_instance_id,coalesce(p_weapon_mounts,ARRAY[]::text[]),coalesce(p_ammo_bins,'{}'::jsonb),false);
 SELECT coalesce(max(sequence),0)+1 INTO sequence_no FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='weapon_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration)
 VALUES(p_game_id,g.current_round,'weapon_attack',sequence_no,player.id,p_attacker_instance_id,p_target_instance_id,jsonb_build_object('weapon_mounts',coalesce(p_weapon_mounts,ARRAY[]::text[]),'ammo_bins',coalesce(p_ammo_bins,'{}'::jsonb),'catalogue_version',g.catalogue_version)) RETURNING id INTO event_id;
 attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
 st:=jsonb_set(st,'{mech_instances}',units,true);

 activation:=btech_advance_unit_activation(st,before_units,g.current_round,'weapon_attack',player.id,player.seat_number,'hasFired');
 st:=activation->'state';phase_complete:=coalesce((activation->>'phase_complete')::boolean,false);
 IF NOT phase_complete THEN
  next_player:=(activation->>'active_player_id')::uuid;
  st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(next_player),true);
  UPDATE btech_games SET active_player_id=next_player,state=st WHERE id=p_game_id;
  RETURN jsonb_build_object('status','waiting_for_activation','event_id',event_id,'remaining_in_activation',coalesce((activation->>'remaining')::int,0));
 END IF;

 FOR combat_event IN SELECT * FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase='weapon_attack' AND event.status='declared' ORDER BY event.sequence FOR UPDATE LOOP
  checked:=btech_process_weapon_declaration(g.catalogue_version,g.current_round,st,combat_event.attacker_instance_id,combat_event.target_instance_id,
   ARRAY(SELECT jsonb_array_elements_text(combat_event.declaration->'weapon_mounts')),coalesce(combat_event.declaration->'ammo_bins','{}'::jsonb),true);
  st:=checked->'state';resolution_payload:=jsonb_build_object('results',checked->'results','state_version','alternating-activations-01','catalogue_version',g.catalogue_version);
  UPDATE btech_combat_events SET status='resolved',resolution=resolution_payload,resolved_at=now() WHERE id=combat_event.id;
 END LOOP;

 units:=st->'mech_instances';
 SELECT jsonb_agg(jsonb_set(value,'{hasPhysicalAttacked}','false'::jsonb,true)) INTO units FROM jsonb_array_elements(units) value;
 st:=jsonb_set(st-'phase_activation','{mech_instances}',units,true);
 SELECT (st->'initiative_order'->0->>'player_id')::uuid INTO first_player;
 st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);
 UPDATE btech_games SET current_phase='physical_attack',active_player_id=first_player,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','event_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb) TO authenticated;
