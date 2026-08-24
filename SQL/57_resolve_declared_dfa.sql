-- Resolve Movement-declared DFA attacks during the Physical Attack Phase.
-- Run after SQL/56_correct_dfa_movement_declaration.sql.

CREATE OR REPLACE FUNCTION public.btech_neighbor_hex(p_col int,p_row int,p_direction int)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE (p_direction%6+6)%6
  WHEN 0 THEN jsonb_build_object('col',p_col+1,'row',p_row)
  WHEN 1 THEN jsonb_build_object('col',p_col+(p_row%2),'row',p_row-1)
  WHEN 2 THEN jsonb_build_object('col',p_col-1+(p_row%2),'row',p_row-1)
  WHEN 3 THEN jsonb_build_object('col',p_col-1,'row',p_row)
  WHEN 4 THEN jsonb_build_object('col',p_col-1+(p_row%2),'row',p_row+1)
  ELSE jsonb_build_object('col',p_col+(p_row%2),'row',p_row+1) END
$$;
REVOKE ALL ON FUNCTION public.btech_neighbor_hex(int,int,int) FROM PUBLIC;

-- A DFA attacker must still submit its Weapon activation, but may only pass.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('A BattleMech executing Death From Above cannot fire weapons' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RETURN jsonb_build_object(''state'',st,''results'',results);END IF;',
  E'IF attacker_start ? ''dfaDeclaration'' AND coalesce(array_length(p_weapon_mounts,1),0)>0 THEN RAISE EXCEPTION ''A BattleMech executing Death From Above cannot fire weapons'';END IF;\n IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RETURN jsonb_build_object(''state'',st,''results'',results);END IF;');
 IF patched=source THEN RAISE EXCEPTION 'Could not add the DFA weapon-fire restriction safely';END IF;
 EXECUTE patched;
END $$;

-- Corrected DFA resolves its own specialised landing and 20-damage checks.
-- Keep the ordinary physical checker from repeating them at phase end.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_physical_piloting_checks(uuid,text,integer,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical piloting resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('corrected DFA owns its checks' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->''results'',''[]''::jsonb)) LOOP',
  E'FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->''results'',''[]''::jsonb)) LOOP\n   -- corrected DFA owns its checks\n   IF attack->>''attack_type''=''death_from_above'' THEN CONTINUE;END IF;');
 IF patched=source THEN RAISE EXCEPTION 'Could not isolate corrected DFA piloting checks';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_declared_death_from_above(p_game_id uuid,p_attacker_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;units jsonb;attacker jsonb;target jsonb;declaration jsonb;
 attacker_mass int;target_mass int;attacker_piloting int;target_piloting int;target_mod int;terrain_mod int;tn int;da int;db int;hit boolean;
 target_damage int;self_damage int;remaining int;group_damage int;location_roll jsonb;damage_result jsonb;
 target_groups jsonb:='[]'::jsonb;self_groups jsonb:='[]'::jsonb;fall_groups jsonb:='[]'::jsonb;target_fall_groups jsonb:='[]'::jsonb;
 attack_direction int;target_direction int;target_diff int;angle text;destination jsonb;dest_col int;dest_row int;
 psr_da int;psr_db int;psr_target int;psr_passed boolean;target_psr_da int;target_psr_db int;target_psr_target int;target_psr_passed boolean;target_fall_damage int;fall_damage int;event_id uuid;sequence_no int;submission jsonb;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'physical_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Physical Attack activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 declaration:=attacker->'dfaDeclaration';
 IF attacker IS NULL OR (attacker->>'owner')::int<>player.seat_number OR declaration IS NULL OR coalesce((attacker->>'hasPhysicalAttacked')::boolean,false) THEN RAISE EXCEPTION 'This BattleMech has no unresolved Death From Above declaration';END IF;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=declaration->>'target_instance_id';
 SELECT (definition->>'mass')::int INTO attacker_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=attacker->>'unitId';
 IF attacker_mass IS NULL THEN RAISE EXCEPTION 'DFA attacker is missing from the pinned catalogue';END IF;

 -- If the target was destroyed before Physical Attacks, the DFA becomes an
 -- ordinary jump into its former hex and causes no attack or fall.
 IF target IS NULL OR coalesce((target->>'destroyed')::boolean,false) THEN
  attacker:=jsonb_set(attacker,'{col}',declaration->'target_col',true);attacker:=jsonb_set(attacker,'{row}',declaration->'target_row',true);attacker:=attacker-'dfaDeclaration';
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
  SELECT submit_simultaneous_physical_declaration(p_game_id,p_attacker_instance_id,NULL,'pass',ARRAY[]::text[]) INTO submission;
  RETURN jsonb_build_object('status','target_destroyed','submission',submission);
 END IF;

 attacker_piloting:=coalesce((attacker->'pilot'->>'piloting')::int,(attacker->>'pilotingSkill')::int,5);
 target_piloting:=coalesce((target->'pilot'->>'piloting')::int,(target->>'pilotingSkill')::int,5);
 target_mod:=CASE WHEN coalesce((target->>'hexesMoved')::int,0)>=25 THEN 6 WHEN coalesce((target->>'hexesMoved')::int,0)>=18 THEN 5 WHEN coalesce((target->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END+CASE WHEN target->>'movementMode'='jump' THEN 1 ELSE 0 END;
 terrain_mod:=CASE btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 tn:=greatest(2,attacker_piloting+(attacker_piloting-target_piloting)+3+target_mod+terrain_mod);
 da:=floor(random()*6+1);db:=floor(random()*6+1);hit:=coalesce(attacker->'pilot'->>'consciousness','conscious')='conscious' AND tn<=12 AND da+db>=tn;
 attack_direction:=btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);
 target_direction:=btech_direction_to((target->>'col')::int,(target->>'row')::int,(attacker->>'col')::int,(attacker->>'row')::int);target_diff:=(target_direction-(target->>'facing')::int+6)%6;
 angle:=CASE WHEN coalesce((target->>'prone')::boolean,false) THEN 'rear' WHEN target_diff=1 THEN 'left' WHEN target_diff=5 THEN 'right' WHEN target_diff IN (2,3,4) THEN 'rear' ELSE 'front' END;

 IF hit THEN
  target_damage:=ceil(attacker_mass*3/10.0)::int;remaining:=target_damage;
  WHILE remaining>0 AND NOT coalesce((target->>'destroyed')::boolean,false) LOOP
   group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_physical_location('punch',angle);damage_result:=btech_apply_direct_damage(target,group_damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';target_groups:=target_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','location_roll',location_roll,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
  END LOOP;
  self_damage:=ceil(attacker_mass/5.0)::int;remaining:=self_damage;
  WHILE remaining>0 AND NOT coalesce((attacker->>'destroyed')::boolean,false) LOOP
   group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_physical_location('kick','front');damage_result:=btech_apply_direct_damage(attacker,group_damage,location_roll->>'location',false);attacker:=damage_result->'mech';self_groups:=self_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','location_roll',location_roll,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
  END LOOP;
  destination:=btech_neighbor_hex((target->>'col')::int,(target->>'row')::int,attack_direction);dest_col:=(destination->>'col')::int;dest_row:=(destination->>'row')::int;
  IF dest_col BETWEEN 0 AND 15 AND dest_row BETWEEN 0 AND 11 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') unit WHERE unit->>'instanceId' NOT IN (p_attacker_instance_id,target->>'instanceId') AND (unit->>'col')::int=dest_col AND (unit->>'row')::int=dest_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN target:=jsonb_set(target,'{col}',to_jsonb(dest_col),true);target:=jsonb_set(target,'{row}',to_jsonb(dest_row),true);END IF;
  attacker:=jsonb_set(attacker,'{col}',declaration->'target_col',true);attacker:=jsonb_set(attacker,'{row}',declaration->'target_row',true);
  psr_target:=attacker_piloting+4;psr_da:=floor(random()*6+1);psr_db:=floor(random()*6+1);psr_passed:=psr_target<=12 AND psr_da+psr_db>=psr_target;
  IF NOT psr_passed AND NOT coalesce((attacker->>'destroyed')::boolean,false) THEN
   attacker:=jsonb_set(attacker,'{prone}','true'::jsonb,true);fall_damage:=ceil(attacker_mass/10.0)::int;remaining:=fall_damage;
   WHILE remaining>0 AND NOT coalesce((attacker->>'destroyed')::boolean,false) LOOP group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(attacker,group_damage,location_roll->>'location',false);attacker:=damage_result->'mech';fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));END LOOP;
  END IF;
  IF target_damage>=20 AND NOT coalesce((target->>'destroyed')::boolean,false) AND NOT coalesce((target->>'prone')::boolean,false) THEN
   SELECT (definition->>'mass')::int INTO target_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=target->>'unitId';target_psr_target:=target_piloting;target_psr_da:=floor(random()*6+1);target_psr_db:=floor(random()*6+1);target_psr_passed:=target_psr_target<=12 AND target_psr_da+target_psr_db>=target_psr_target;
   IF NOT target_psr_passed THEN target:=jsonb_set(target,'{prone}','true'::jsonb,true);target_fall_damage:=ceil(coalesce(target_mass,0)/10.0)::int;remaining:=target_fall_damage;WHILE remaining>0 AND NOT coalesce((target->>'destroyed')::boolean,false) LOOP group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(target,group_damage,location_roll->>'location',false);target:=damage_result->'mech';target_fall_groups:=target_fall_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));END LOOP;END IF;
  END IF;
 ELSE
  -- A failed DFA is a two-level fall. Keep the attacker in the staging hex,
  -- mark it prone and apply three times ordinary standing-fall damage.
  target_damage:=0;self_damage:=0;attacker:=jsonb_set(attacker,'{prone}','true'::jsonb,true);fall_damage:=ceil(attacker_mass/10.0)::int*3;remaining:=fall_damage;
  WHILE remaining>0 AND NOT coalesce((attacker->>'destroyed')::boolean,false) LOOP
   group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location('front');damage_result:=btech_apply_direct_damage(attacker,group_damage,location_roll->>'location',false);attacker:=damage_result->'mech';fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','location_roll',location_roll,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
  END LOOP;
  psr_target:=NULL;psr_da:=NULL;psr_db:=NULL;psr_passed:=false;
 END IF;
 attacker:=attacker-'dfaDeclaration';
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker WHEN value->>'instanceId'=target->>'instanceId' THEN target ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
 SELECT submit_simultaneous_physical_declaration(p_game_id,p_attacker_instance_id,NULL,'pass',ARRAY[]::text[]) INTO submission;
 SELECT coalesce(max(sequence),0)+1 INTO sequence_no FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='physical_attack';
 -- Use the corrected name rather than SQL/55's obsolete `dfa` marker so its
 -- superseded generic piloting hook cannot roll a second landing check.
 result:=jsonb_build_object('attack_type','death_from_above','to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',hit,'damage',target_damage,'groups',target_groups,'self_damage',self_damage,'self_groups',self_groups,'fall_damage',coalesce(fall_damage,0),'fall_groups',fall_groups,'attacker_piloting_check',CASE WHEN hit THEN jsonb_build_object('target',psr_target,'die_a',psr_da,'die_b',psr_db,'total',psr_da+psr_db,'passed',psr_passed) ELSE NULL END,'target_piloting_check',CASE WHEN target_psr_target IS NULL THEN NULL ELSE jsonb_build_object('target',target_psr_target,'die_a',target_psr_da,'die_b',target_psr_db,'total',target_psr_da+target_psr_db,'passed',target_psr_passed,'fall_damage',coalesce(target_fall_damage,0),'fall_groups',target_fall_groups) END);
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration,status,resolution,resolved_at)
 VALUES(p_game_id,g.current_round,'physical_attack',sequence_no,player.id,p_attacker_instance_id,target->>'instanceId',jsonb_build_object('attack_type','dfa','declared_phase','movement'), 'resolved',jsonb_build_object('results',jsonb_build_array(result),'state_version','authoritative-dfa-02','catalogue_version',g.catalogue_version),now()) RETURNING id INTO event_id;
 RETURN jsonb_build_object('status','resolved','event_id',event_id,'hit',hit,'result',result,'submission',submission);
END $$;
REVOKE ALL ON FUNCTION public.resolve_declared_death_from_above(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_declared_death_from_above(uuid,text) TO authenticated;
