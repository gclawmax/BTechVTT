-- Server-authoritative Piloting Skill Rolls and falls after physical attacks.
-- Run after SQL/24_fix_combat_resolution_name_collision.sql.
--
-- This completes the first physical-combat slice: the resolver combines all
-- physical-phase triggers for each BattleMech into one PSR, rolls it on the
-- server, and applies standing-fall damage before Heat Management begins.

CREATE OR REPLACE FUNCTION public.btech_resolve_physical_piloting_checks(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;pending jsonb:='{}'::jsonb;
 candidate jsonb;unit_id text;reason text;unit_mech jsonb;unit_mass int;gyro_hits int;
 die_a int;die_b int;target_number int;passed boolean;fall_die int;fall_angle text;
 remaining int;group_damage int;location_roll jsonb;damage_result jsonb;fall_groups jsonb;checks jsonb:='[]'::jsonb;
 units jsonb;
BEGIN
 -- Gather the phase's triggers from the saved, server-resolved physical events.
 FOR event_row IN
  SELECT event.attacker_instance_id,event.target_instance_id,event.resolution
  FROM btech_combat_events event
  WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='physical_attack'
    AND event.status='resolved'
  ORDER BY event.sequence
 LOOP
  FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP
   IF attack->>'attack_type'='kick' THEN
    unit_id:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN event_row.target_instance_id ELSE event_row.attacker_instance_id END;
    reason:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN 'successful kick' ELSE 'missed kick' END;
    candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(candidate->'reasons') item WHERE item=reason) THEN
     candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||to_jsonb(reason),true);
    END IF;
    pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   END IF;
   IF coalesce((attack->>'hit')::boolean,false) THEN
    unit_id:=event_row.target_instance_id;
    candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);
    candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+coalesce((attack->>'damage')::int,0)),true);
    pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   END IF;
  END LOOP;
 END LOOP;

 -- Damage of 20 or more in this physical phase is a distinct trigger. It is
 -- combined with any kick trigger so the player sees one clear PSR outcome.
 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  IF coalesce((candidate->>'damage')::int,0)>=20
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(candidate->'reasons') item WHERE item='20+ physical damage') THEN
   candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||jsonb_build_array('20+ physical damage'),true);
   pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
  END IF;
 END LOOP;

 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  SELECT value INTO unit_mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=unit_id;
  IF unit_mech IS NULL OR coalesce((unit_mech->>'destroyed')::boolean,false) THEN CONTINUE;END IF;
  SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units
   WHERE catalogue_version=p_catalogue_version AND unit_id=unit_mech->>'unitId';
  SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=unit_mech->>'unitId'
    AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
    AND btech_critical_slot_is_damaged(unit_mech,slot.location,slot.slot_index);
  target_number:=greatest(2,coalesce((unit_mech->>'pilotingSkill')::int,5)+(gyro_hits*3));
  die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);
  passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);
  fall_groups:='[]'::jsonb;
  IF NOT passed THEN
   -- A standing fall is face/left/right. Damage is mass ÷ 10 (round up), in
   -- five-point groups, each using the corresponding standard hit table.
   fall_die:=floor(random()*6+1);
   fall_angle:=CASE WHEN fall_die<=2 THEN 'front' WHEN fall_die<=4 THEN 'left' ELSE 'right' END;
   unit_mech:=jsonb_set(unit_mech,'{prone}','true'::jsonb,true);
   remaining:=ceil(coalesce(unit_mass,0)/10.0)::int;
   WHILE remaining>0 AND NOT coalesce((unit_mech->>'destroyed')::boolean,false) LOOP
    group_damage:=least(5,remaining);remaining:=remaining-group_damage;
    location_roll:=btech_roll_mech_hit_location(fall_angle);
    damage_result:=btech_apply_direct_damage(unit_mech,group_damage,location_roll->>'location',false);
    unit_mech:=damage_result->'mech';
    fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object(
      'damage',group_damage,'location_roll',location_roll,'location',location_roll->>'location',
      'critical_checks',damage_result->'critical_checks'));
   END LOOP;
  END IF;
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END)
   INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
  checks:=checks||jsonb_build_array(jsonb_build_object(
   'instance_id',unit_id,'reasons',candidate->'reasons','damage_taken',(candidate->>'damage')::int,
   'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number,'gyro_modifier',gyro_hits*3),
   'passed',passed,'fell',NOT passed,'fall_direction_die',CASE WHEN passed THEN NULL ELSE fall_die END,
   'fall_angle',CASE WHEN passed THEN NULL ELSE fall_angle END,'fall_damage',CASE WHEN passed THEN 0 ELSE ceil(coalesce(unit_mass,0)/10.0)::int END,
   'fall_groups',fall_groups));
 END LOOP;
 RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_physical_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;

-- Insert the PSR resolution immediately after the existing physical resolver
-- has resolved every declared attack and before it advances to Heat. Keeping
-- this patch around the established resolver avoids duplicating its activation
-- and simultaneous-declaration safeguards.
DO $$
DECLARE function_oid regprocedure;original_definition text;fixed_definition text;
BEGIN
 function_oid:=to_regprocedure('public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[])');
 IF function_oid IS NULL THEN RAISE EXCEPTION 'Physical resolver is missing; run SQL 23 and 24 first';END IF;
 SELECT pg_get_functiondef(function_oid) INTO original_definition;
 IF position('btech_resolve_physical_piloting_checks' IN original_definition)>0 THEN RETURN;END IF;
 fixed_definition:=replace(original_definition,
  E' END LOOP;\n SELECT jsonb_agg(jsonb_set(value-''physicalPhaseStart'',' ,
  E' END LOOP;\n checked:=btech_resolve_physical_piloting_checks(p_game_id,g.catalogue_version,g.current_round,st);st:=checked->''state'';\n IF jsonb_array_length(coalesce(checked->''checks'',''[]''::jsonb))>0 THEN\n  UPDATE btech_combat_events SET resolution=jsonb_set(coalesce(resolution,''{}''::jsonb),''{piloting_checks}'',checked->''checks'',true)\n   WHERE id=(SELECT event.id FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase=''physical_attack'' ORDER BY event.sequence DESC LIMIT 1);\n END IF;\n SELECT jsonb_agg(jsonb_set(value-''physicalPhaseStart'',');
 IF fixed_definition=original_definition OR position('btech_resolve_physical_piloting_checks' IN fixed_definition)=0 THEN
  RAISE EXCEPTION 'Physical resolver definition did not contain the expected final-resolution marker';
 END IF;
 EXECUTE fixed_definition;
END $$;
