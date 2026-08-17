-- Damage-triggered Piloting Skill Rolls and falls after simultaneous weapon fire.
-- Run after SQL/33_authoritative_match_end.sql.

CREATE OR REPLACE FUNCTION public.btech_resolve_weapon_piloting_checks(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;pending jsonb:='{}'::jsonb;
 candidate jsonb;unit_id text;unit_mech jsonb;unit_mass int;gyro_hits int;damage_taken int;
 die_a int;die_b int;target_number int;passed boolean;fall_die int;fall_angle text;
 remaining int;group_damage int;location_roll jsonb;damage_result jsonb;fall_groups jsonb;checks jsonb:='[]'::jsonb;units jsonb;
BEGIN
 -- The combat ledger is the source of truth. Cluster groups are summed before
 -- testing the phase's 20-point damage threshold.
 FOR event_row IN
  SELECT event.target_instance_id,event.resolution FROM btech_combat_events event
  WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack' AND event.status='resolved'
  ORDER BY event.sequence
 LOOP
  FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP
   IF NOT coalesce((attack->>'hit')::boolean,false) THEN CONTINUE;END IF;
   damage_taken:=coalesce((attack->>'damage')::int,0);
   IF attack ? 'groups' THEN
    SELECT coalesce(sum(coalesce((value->>'damage')::int,0)),0)::int INTO damage_taken
    FROM jsonb_array_elements(coalesce(attack->'groups','[]'::jsonb)) value;
   END IF;
   candidate:=coalesce(pending->event_row.target_instance_id,'{"damage":0}'::jsonb);
   candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+damage_taken),true);
   pending:=jsonb_set(pending,ARRAY[event_row.target_instance_id],candidate,true);
  END LOOP;
 END LOOP;

 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  IF coalesce((candidate->>'damage')::int,0)<20 THEN CONTINUE;END IF;
  SELECT value INTO unit_mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=unit_id;
  IF unit_mech IS NULL OR coalesce((unit_mech->>'destroyed')::boolean,false) OR coalesce((unit_mech->>'prone')::boolean,false) THEN CONTINUE;END IF;
  SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=unit_mech->>'unitId';
  SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=unit_mech->>'unitId'
    AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
    AND btech_critical_slot_is_damaged(unit_mech,slot.location,slot.slot_index);
  target_number:=greatest(2,coalesce((unit_mech->>'pilotingSkill')::int,5)+(gyro_hits*3));
  die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);
  fall_groups:='[]'::jsonb;
  IF NOT passed THEN
   fall_die:=floor(random()*6+1);fall_angle:=CASE WHEN fall_die<=2 THEN 'front' WHEN fall_die<=4 THEN 'left' ELSE 'right' END;
   unit_mech:=jsonb_set(unit_mech,'{prone}','true'::jsonb,true);remaining:=ceil(coalesce(unit_mass,0)/10.0)::int;
   WHILE remaining>0 AND NOT coalesce((unit_mech->>'destroyed')::boolean,false) LOOP
    group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location(fall_angle);
    damage_result:=btech_apply_direct_damage(unit_mech,group_damage,location_roll->>'location',false);unit_mech:=damage_result->'mech';
    fall_groups:=fall_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location_roll',location_roll,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
   END LOOP;
  END IF;
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
  st:=jsonb_set(st,'{mech_instances}',units,true);
  checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',unit_id,'reasons',jsonb_build_array('20+ weapon damage'),'damage_taken',(candidate->>'damage')::int,
   'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number,'gyro_modifier',gyro_hits*3),
   'passed',passed,'fell',NOT passed,'fall_direction_die',CASE WHEN passed THEN NULL ELSE fall_die END,'fall_angle',CASE WHEN passed THEN NULL ELSE fall_angle END,
   'fall_damage',CASE WHEN passed THEN 0 ELSE ceil(coalesce(unit_mass,0)/10.0)::int END,'fall_groups',fall_groups));
 END LOOP;
 RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_weapon_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;

-- Resolve the damage-triggered checks only after every simultaneous weapon
-- attack has applied. Store the shared result on the final weapon event.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_resolve_weapon_piloting_checks' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E' END LOOP;\n\n units:=st->''mech_instances'';',
  E' END LOOP;\n checked:=btech_resolve_weapon_piloting_checks(p_game_id,g.catalogue_version,g.current_round,st);st:=checked->''state'';\n IF jsonb_array_length(coalesce(checked->''checks'',''[]''::jsonb))>0 THEN\n  UPDATE btech_combat_events SET resolution=jsonb_set(coalesce(resolution,''{}''::jsonb),''{piloting_checks}'',checked->''checks'',true)\n   WHERE id=(SELECT event.id FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase=''weapon_attack'' ORDER BY event.sequence DESC LIMIT 1);\n END IF;\n\n units:=st->''mech_instances'';');
 IF patched=source OR position('btech_resolve_weapon_piloting_checks' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver definition did not contain the expected final-resolution marker';END IF;
 EXECUTE patched;
END $$;
