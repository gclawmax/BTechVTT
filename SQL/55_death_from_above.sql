-- Death From Above for the server-authoritative two-player Physical Attack
-- phase. Run after SQL/54_match_deployment.sql (and the prior combat SQL).
--
-- A DFA is declared after a BattleMech has jumped at least one hex. The
-- target must be adjacent in a forward hex. On a hit, it takes mass / 5
-- damage and the attacker takes mass / 10 leg damage. The physical piloting
-- resolver then makes the attacker check in all cases and the target check
-- after a successful hit, applying its existing prone/fall system.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical attack resolver is missing; run SQL/23 through SQL/54 first';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('Death From Above requires a jump' IN source)>0 THEN RETURN;END IF;
 IF position('''hatchet''' IN source)=0 THEN RAISE EXCEPTION 'Physical attack resolver is not at the expected Hatchet revision';END IF;
 patched:=replace(source,
  E'p_attack_type NOT IN (''punch'',''kick'',''hatchet'')',
  E'p_attack_type NOT IN (''punch'',''kick'',''hatchet'',''dfa'')');
 patched:=replace(patched,
  E'Choose punch, kick, hatchet, or pass',
  E'Choose punch, kick, hatchet, Death From Above, or pass');
 patched:=replace(patched,
  E'Standard punches, kicks, and hatchet attacks require an adjacent target',
  E'Standard physical attacks and Death From Above require an adjacent target');
 patched:=replace(patched,
  E'IF p_attack_type=''kick'' AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''Kick target is outside the three forward hexes'';END IF;',
  E'IF p_attack_type IN (''kick'',''dfa'') AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''Kick and Death From Above targets are outside the three forward hexes'';END IF;');
 patched:=replace(patched,
  E'IF p_attack_type=''punch'' AND (coalesce(array_length(p_limbs,1),0)<1',
  E'IF p_attack_type=''dfa'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1]<>''dfa'') THEN RAISE EXCEPTION ''Death From Above does not use a limb selection'';END IF;\n IF p_attack_type=''dfa'' AND (attacker_start->>''movementMode''<>''jump'' OR coalesce((attacker_start->>''hexesMoved'')::int,0)<1) THEN RAISE EXCEPTION ''Death From Above requires a jump this turn'';END IF;\n IF p_attack_type=''punch'' AND (coalesce(array_length(p_limbs,1),0)<1');
 patched:=replace(patched,
  E'die_a int;die_b int;location_roll jsonb;damage_result jsonb;results jsonb:=''[]''::jsonb;',
  E'die_a int;die_b int;location_roll jsonb;damage_result jsonb;self_location text;self_damage_result jsonb;results jsonb:=''[]''::jsonb;');
 patched:=replace(patched,
  E' FOREACH limb IN ARRAY p_limbs LOOP\n  IF coalesce((attacker_start->''structure''->>limb)::int,0)<=0 THEN RAISE EXCEPTION ''% is destroyed'',limb;END IF;',
  E' FOREACH limb IN ARRAY p_limbs LOOP\n  IF p_attack_type=''dfa'' THEN\n   IF limb<>''dfa'' THEN RAISE EXCEPTION ''Death From Above does not use a limb selection'';END IF;\n   tn:=base_tn;damage:=ceil(unit_mass/5.0)::int;\n   IF p_resolve THEN\n    die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);hit:=tn<=2 OR (tn<=12 AND die_a+die_b>=tn);\n    IF hit THEN\n     location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_direct_damage(target,damage,location_roll->>''location'',angle=''rear'');target:=damage_result->''mech'';\n     self_location:=CASE WHEN floor(random()*6+1)<=3 THEN ''ll'' ELSE ''rl'' END;self_damage_result:=btech_apply_direct_damage(attacker,ceil(unit_mass/10.0)::int,self_location,false);attacker:=self_damage_result->''mech'';\n     results:=results||jsonb_build_array(jsonb_build_object(''attack_type'',''dfa'',''limb'',''dfa'',''to_hit'',jsonb_build_object(''die_a'',die_a,''die_b'',die_b,''total'',die_a+die_b,''target'',tn),''hit'',true,''angle'',angle,''location_roll'',location_roll,''location'',location_roll->>''location'',''damage'',damage,''critical_checks'',damage_result->''critical_checks'',''pilot_check'',damage_result->''pilot_check'',''self_damage'',ceil(unit_mass/10.0)::int,''self_location'',self_location,''self_critical_checks'',self_damage_result->''critical_checks'',''self_pilot_check'',self_damage_result->''pilot_check''));\n    ELSE\n     results:=results||jsonb_build_array(jsonb_build_object(''attack_type'',''dfa'',''limb'',''dfa'',''to_hit'',jsonb_build_object(''die_a'',die_a,''die_b'',die_b,''total'',die_a+die_b,''target'',tn),''hit'',false));\n    END IF;\n   END IF;\n   CONTINUE;\n  END IF;\n  IF coalesce((attacker_start->''structure''->>limb)::int,0)<=0 THEN RAISE EXCEPTION ''% is destroyed'',limb;END IF;');
 patched:=replace(patched,
  E'SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_target_id THEN target ELSE value END) INTO units FROM jsonb_array_elements(st->''mech_instances'') value;',
  E'SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_target_id THEN target WHEN value->>''instanceId''=p_attacker_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(st->''mech_instances'') value;');
 IF patched=source OR position('Death From Above requires a jump' IN patched)=0 OR position('''self_damage''' IN patched)=0 THEN
  RAISE EXCEPTION 'Physical resolver did not contain the expected Death From Above markers';
 END IF;
 EXECUTE patched;
END $$;

-- Extend the existing physical-phase Piloting Skill Roll resolver. Keeping
-- this as a replacement makes the complete set of triggers easy to audit:
-- kicks, 20+ physical damage and DFA all become one saved check per 'Mech.
CREATE OR REPLACE FUNCTION public.btech_resolve_physical_piloting_checks(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;pending jsonb:='{}'::jsonb;
 candidate jsonb;unit_id text;reason text;unit_mech jsonb;unit_mass int;gyro_hits int;
 die_a int;die_b int;target_number int;passed boolean;fall_die int;fall_angle text;
 remaining int;group_damage int;location_roll jsonb;damage_result jsonb;fall_groups jsonb;checks jsonb:='[]'::jsonb;units jsonb;
BEGIN
 FOR event_row IN SELECT event.attacker_instance_id,event.target_instance_id,event.resolution FROM btech_combat_events event
  WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='physical_attack' AND event.status='resolved' ORDER BY event.sequence LOOP
  FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP
   IF attack->>'attack_type'='kick' THEN
    unit_id:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN event_row.target_instance_id ELSE event_row.attacker_instance_id END;
    reason:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN 'successful kick' ELSE 'missed kick' END;
    candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||to_jsonb(reason),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   ELSIF attack->>'attack_type'='dfa' THEN
    unit_id:=event_row.attacker_instance_id;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||jsonb_build_array('Death From Above'),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
    IF coalesce((attack->>'hit')::boolean,false) THEN
     unit_id:=event_row.target_instance_id;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||jsonb_build_array('hit by Death From Above'),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
    END IF;
   END IF;
   IF coalesce((attack->>'hit')::boolean,false) THEN
    unit_id:=event_row.target_instance_id;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+coalesce((attack->>'damage')::int,0)),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   END IF;
  END LOOP;
 END LOOP;
 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  IF coalesce((candidate->>'damage')::int,0)>=20 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(candidate->'reasons') item WHERE item='20+ physical damage') THEN candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||jsonb_build_array('20+ physical damage'),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);END IF;
 END LOOP;
 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  SELECT value INTO unit_mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=unit_id;
  IF unit_mech IS NULL OR coalesce((unit_mech->>'destroyed')::boolean,false) THEN CONTINUE;END IF;
  SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=unit_mech->>'unitId';
  SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=unit_mech->>'unitId' AND regexp_replace(slot.label,'[[:space:]]*\\([A-Z]\\)$','')='Gyro' AND btech_critical_slot_is_damaged(unit_mech,slot.location,slot.slot_index);
  target_number:=greatest(2,coalesce((unit_mech->>'pilotingSkill')::int,5)+(gyro_hits*3));die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);fall_groups:='[]'::jsonb;
  IF NOT passed THEN
   fall_die:=floor(random()*6+1);fall_angle:=CASE WHEN fall_die<=2 THEN 'front' WHEN fall_die<=4 THEN 'left' ELSE 'right' END;unit_mech:=jsonb_set(unit_mech,'{prone}','true'::jsonb,true);remaining:=ceil(coalesce(unit_mass,0)/10.0)::int;
   WHILE remaining>0 AND NOT coalesce((unit_mech->>'destroyed')::boolean,false) LOOP
    group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location(fall_angle);damage_result:=btech_apply_direct_damage(unit_mech,group_damage,location_roll->>'location',false);unit_mech:=damage_result->'mech';fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location_roll',location_roll,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
   END LOOP;
  END IF;
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);
  checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',unit_id,'reasons',candidate->'reasons','damage_taken',(candidate->>'damage')::int,'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number,'gyro_modifier',gyro_hits*3),'passed',passed,'fell',NOT passed,'fall_direction_die',CASE WHEN passed THEN NULL ELSE fall_die END,'fall_angle',CASE WHEN passed THEN NULL ELSE fall_angle END,'fall_damage',CASE WHEN passed THEN 0 ELSE ceil(coalesce(unit_mass,0)/10.0)::int END,'fall_groups',fall_groups));
 END LOOP;
 RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_physical_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;
