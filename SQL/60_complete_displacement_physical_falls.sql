-- Complete BattleMech displacement, physical-weapon and fall edge handling.
-- Run after SQL/59_push_attacks.sql.

-- Total Warfare requires every fall to change facing, apply damage in five-point
-- groups, and make a second Piloting Skill Roll to avoid injuring the pilot.
CREATE OR REPLACE FUNCTION public.btech_resolve_complete_fall(
 p_catalogue_version text,p_mech jsonb,p_levels int DEFAULT 0,p_forced_angle text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;unit_mass int;gyro_hits int;fall_die int;facing_delta int;damage_angle text;
 damage_total int;remaining int;group_damage int;location_roll jsonb;damage_result jsonb;
 groups jsonb:='[]'::jsonb;pilot_target int;pilot_a int;pilot_b int;pilot_passed boolean;
 pilot_automatic boolean;pilot_result jsonb:=NULL;pilot_checks jsonb:='[]'::jsonb;
BEGIN
 SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units
  WHERE catalogue_version=p_catalogue_version AND unit_id=m->>'unitId';
 IF unit_mass IS NULL THEN RAISE EXCEPTION 'Falling BattleMech is missing from the pinned catalogue';END IF;
 fall_die:=floor(random()*6+1);
 IF p_forced_angle IS NULL THEN
  facing_delta:=CASE fall_die WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 ELSE 5 END;
  damage_angle:=CASE fall_die WHEN 1 THEN 'front' WHEN 2 THEN 'right' WHEN 3 THEN 'right' WHEN 4 THEN 'rear' WHEN 5 THEN 'left' ELSE 'left' END;
 ELSE
  damage_angle:=p_forced_angle;
  facing_delta:=CASE p_forced_angle WHEN 'right' THEN 1 WHEN 'rear' THEN 3 WHEN 'left' THEN 5 ELSE 0 END;
 END IF;
 m:=jsonb_set(m,'{facing}',to_jsonb((coalesce((m->>'facing')::int,0)+facing_delta)%6),true);
 m:=jsonb_set(m,'{torsoFacing}',m->'facing',true);m:=jsonb_set(m,'{prone}','true'::jsonb,true);
 damage_total:=ceil(unit_mass/10.0)::int*(greatest(0,p_levels)+1);remaining:=damage_total;
 WHILE remaining>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  group_damage:=least(5,remaining);remaining:=remaining-group_damage;
  location_roll:=btech_roll_mech_hit_location(damage_angle);
  damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',damage_angle='rear');m:=damage_result->'mech';
  groups:=groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','location_roll',location_roll,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
 END LOOP;
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
   AND btech_critical_slot_is_damaged(m,slot.location,slot.slot_index);
 pilot_target:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+gyro_hits*3+greatest(0,p_levels-1);
 pilot_automatic:=coalesce(m->'pilot'->>'consciousness','conscious')<>'conscious' OR coalesce((m->>'shutdown')::boolean,false) OR pilot_target>12;
 IF pilot_automatic THEN pilot_a:=NULL;pilot_b:=NULL;pilot_passed:=false;
 ELSE pilot_a:=floor(random()*6+1);pilot_b:=floor(random()*6+1);pilot_passed:=pilot_a+pilot_b>=pilot_target;END IF;
 IF NOT pilot_passed AND coalesce(m->'pilot'->>'consciousness','conscious')<>'dead' THEN
  pilot_result:=btech_apply_pilot_hit(m,'fall');m:=pilot_result->'mech';pilot_checks:=pilot_checks||jsonb_build_array(pilot_result->'check');
 END IF;
 RETURN jsonb_build_object('mech',m,'fell',true,'levels',greatest(0,p_levels),'fall_direction_die',fall_die,
  'fall_angle',damage_angle,'fall_damage',damage_total,'fall_groups',groups,
  'pilot_injury_avoidance',jsonb_build_object('target',pilot_target,'die_a',pilot_a,'die_b',pilot_b,'total',CASE WHEN pilot_a IS NULL THEN NULL ELSE pilot_a+pilot_b END,'automatic',pilot_automatic,'passed',pilot_passed),
  'pilot_checks',pilot_checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_complete_fall(text,jsonb,int,text) FROM PUBLIC;

-- Older special-attack resolvers already applied their fall damage. This
-- companion finishes the missing facing and pilot-injury roll without dealing
-- that damage a second time.
CREATE OR REPLACE FUNCTION public.btech_finalize_existing_fall(p_catalogue_version text,p_mech jsonb,p_levels int DEFAULT 0,p_forced_angle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;fall_die int;facing_delta int;damage_angle text;gyro_hits int;pilot_target int;pilot_a int;pilot_b int;pilot_passed boolean;pilot_automatic boolean;pilot_result jsonb:=NULL;
BEGIN fall_die:=floor(random()*6+1);IF p_forced_angle IS NULL THEN facing_delta:=CASE fall_die WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 ELSE 5 END;damage_angle:=CASE fall_die WHEN 1 THEN 'front' WHEN 2 THEN 'right' WHEN 3 THEN 'right' WHEN 4 THEN 'rear' WHEN 5 THEN 'left' ELSE 'left' END;ELSE damage_angle:=p_forced_angle;facing_delta:=CASE p_forced_angle WHEN 'right' THEN 1 WHEN 'rear' THEN 3 WHEN 'left' THEN 5 ELSE 0 END;END IF;m:=jsonb_set(m,'{facing}',to_jsonb((coalesce((m->>'facing')::int,0)+facing_delta)%6),true);m:=jsonb_set(m,'{torsoFacing}',m->'facing',true);m:=jsonb_set(m,'{prone}','true'::jsonb,true);
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId' AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro' AND btech_critical_slot_is_damaged(m,slot.location,slot.slot_index);pilot_target:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+gyro_hits*3+greatest(0,p_levels-1);pilot_automatic:=coalesce(m->'pilot'->>'consciousness','conscious')<>'conscious' OR coalesce((m->>'shutdown')::boolean,false) OR pilot_target>12;IF pilot_automatic THEN pilot_a:=NULL;pilot_b:=NULL;pilot_passed:=false;ELSE pilot_a:=floor(random()*6+1);pilot_b:=floor(random()*6+1);pilot_passed:=pilot_a+pilot_b>=pilot_target;END IF;IF NOT pilot_passed AND coalesce(m->'pilot'->>'consciousness','conscious')<>'dead' THEN pilot_result:=btech_apply_pilot_hit(m,'fall');m:=pilot_result->'mech';END IF;RETURN jsonb_build_object('mech',m,'fall_direction_die',fall_die,'fall_angle',damage_angle,'pilot_injury_avoidance',jsonb_build_object('target',pilot_target,'die_a',pilot_a,'die_b',pilot_b,'total',CASE WHEN pilot_a IS NULL THEN NULL ELSE pilot_a+pilot_b END,'automatic',pilot_automatic,'passed',pilot_passed),'pilot_check',pilot_result->'check');END $$;
REVOKE ALL ON FUNCTION public.btech_finalize_existing_fall(text,jsonb,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_displacement_psr(
 p_catalogue_version text,p_mech jsonb,p_reason text,p_modifier int DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;gyro_hits int;target_number int;da int;db int;passed boolean;fall_result jsonb:=NULL;
BEGIN
 IF coalesce((m->>'destroyed')::boolean,false) OR coalesce((m->>'prone')::boolean,false) THEN
  RETURN jsonb_build_object('mech',m,'check',NULL);
 END IF;
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
   AND btech_critical_slot_is_damaged(m,slot.location,slot.slot_index);
 target_number:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+gyro_hits*3+p_modifier;
 da:=floor(random()*6+1);db:=floor(random()*6+1);passed:=target_number<=2 OR (target_number<=12 AND da+db>=target_number);
 IF NOT passed THEN fall_result:=btech_resolve_complete_fall(p_catalogue_version,m,0,NULL);m:=fall_result->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'check',jsonb_build_object('reason',p_reason,'target',target_number,'die_a',da,'die_b',db,'total',da+db,'passed',passed,'fall',fall_result));
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_displacement_psr(text,jsonb,text,int) FROM PUBLIC;

-- Reuse the complete fall sequence for rough-ground movement checks.
CREATE OR REPLACE FUNCTION public.btech_resolve_rough_ground_piloting_check(p_catalogue_version text,p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE resolved jsonb;check_result jsonb;fall_result jsonb;BEGIN resolved:=btech_resolve_displacement_psr(p_catalogue_version,p_mech,'running through rough ground',0);check_result:=resolved->'check';fall_result:=check_result->'fall';RETURN jsonb_build_object('mech',resolved->'mech','check',jsonb_build_object('instance_id',p_mech->>'instanceId','reasons',jsonb_build_array('running through rough ground'),'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target'),'passed',check_result->'passed','fell',NOT coalesce((check_result->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb)));END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_rough_ground_piloting_check(text,jsonb) FROM PUBLIC;

-- Complete failed stand attempts. The first PSR determines whether the unit
-- stands; failure is a new zero-level fall and therefore has its own facing,
-- damage and pilot-injury avoidance roll.
CREATE OR REPLACE FUNCTION public.attempt_stand_battlemech(p_game_id uuid,p_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;resolved jsonb;check_result jsonb;fall_result jsonb;passed boolean;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=st->'mech_instances';SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR NOT coalesce((mech->>'prone')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Choose one of your conscious prone BattleMechs that has not moved';END IF;
 IF coalesce((mech->'structure'->>'ll')::int,0)<=0 OR coalesce((mech->'structure'->>'rl')::int,0)<=0 THEN RAISE EXCEPTION 'A BattleMech with a destroyed leg cannot stand';END IF;
 -- The unit starts prone, but the generic PSR only rolls falls for standing
 -- units. Temporarily clear prone for the stand roll, then restore on failure.
 mech:=jsonb_set(mech,'{prone}','false'::jsonb,true);resolved:=btech_resolve_displacement_psr(g.catalogue_version,mech,'attempting to stand',0);check_result:=resolved->'check';passed:=coalesce((check_result->>'passed')::boolean,false);mech:=resolved->'mech';fall_result:=check_result->'fall';
 IF NOT passed THEN mech:=jsonb_set(mech,'{prone}','true'::jsonb,true);END IF;
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);mech:=jsonb_set(mech,'{movementMode}','"stand"'::jsonb,true);mech:=jsonb_set(mech,'{mpUsed}','2'::jsonb,true);mech:=jsonb_set(mech,'{hexesMoved}','0'::jsonb,true);mech:=jsonb_set(mech,'{movementHeat}','0'::jsonb,true);mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+coalesce((mech->>'weaponHeat')::int,0)),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 result:=jsonb_build_object('instance_id',p_instance_id,'passed',passed,'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target'),'movement_points_spent',2,'fall',fall_result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attempt_stand_battlemech(uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.attempt_stand_battlemech(uuid,text) TO authenticated;

-- Rebuild the standard physical-phase PSR collector around the shared fall
-- resolver. Corrected DFA and Charge own their specialised checks.
CREATE OR REPLACE FUNCTION public.btech_resolve_physical_piloting_checks(p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;pending jsonb:='{}'::jsonb;candidate jsonb;unit_id text;reason text;unit_mech jsonb;resolved jsonb;check_result jsonb;fall_result jsonb;checks jsonb:='[]'::jsonb;units jsonb;
BEGIN
 FOR event_row IN SELECT event.attacker_instance_id,event.target_instance_id,event.resolution FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='physical_attack' AND event.status='resolved' ORDER BY event.sequence LOOP
  FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP
   IF attack->>'attack_type' IN ('death_from_above','charge_attack','push_attack') THEN CONTINUE;END IF;
   IF attack->>'attack_type'='kick' AND NOT coalesce((attack->>'target_prone')::boolean,false) THEN unit_id:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN event_row.target_instance_id ELSE event_row.attacker_instance_id END;reason:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN 'successful kick' ELSE 'missed kick' END;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidate->'reasons') value WHERE value=reason) THEN candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||to_jsonb(reason),true);END IF;pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);END IF;
   IF coalesce((attack->>'hit')::boolean,false) THEN unit_id:=event_row.target_instance_id;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[]}'::jsonb);candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+coalesce((attack->>'damage')::int,0)),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);END IF;
  END LOOP;
 END LOOP;
 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP
  IF coalesce((candidate->>'damage')::int,0)>=20 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(candidate->'reasons') value WHERE value='20+ physical damage') THEN candidate:=jsonb_set(candidate,'{reasons}',candidate->'reasons'||jsonb_build_array('20+ physical damage'),true);END IF;
  IF jsonb_array_length(candidate->'reasons')=0 THEN CONTINUE;END IF;SELECT value INTO unit_mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=unit_id;IF unit_mech IS NULL OR coalesce((unit_mech->>'destroyed')::boolean,false) OR coalesce((unit_mech->>'prone')::boolean,false) THEN CONTINUE;END IF;
  resolved:=btech_resolve_displacement_psr(p_catalogue_version,unit_mech,array_to_string(ARRAY(SELECT jsonb_array_elements_text(candidate->'reasons')),', '),0);unit_mech:=resolved->'mech';check_result:=resolved->'check';fall_result:=check_result->'fall';
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);
  checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',unit_id,'reasons',candidate->'reasons','damage_taken',coalesce((candidate->>'damage')::int,0),'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target'),'passed',check_result->'passed','fell',NOT coalesce((check_result->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb)));
 END LOOP;RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_physical_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;

-- Likewise, weapon-phase 20-point checks now receive complete falls.
CREATE OR REPLACE FUNCTION public.btech_resolve_weapon_piloting_checks(p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;pending jsonb:='{}'::jsonb;candidate jsonb;unit_id text;unit_mech jsonb;damage_taken int;resolved jsonb;check_result jsonb;fall_result jsonb;checks jsonb:='[]'::jsonb;units jsonb;
BEGIN
 FOR event_row IN SELECT event.target_instance_id,event.resolution FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase='weapon_attack' AND event.status='resolved' ORDER BY event.sequence LOOP FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP IF NOT coalesce((attack->>'hit')::boolean,false) THEN CONTINUE;END IF;damage_taken:=coalesce((attack->>'damage')::int,0);IF attack ? 'groups' THEN SELECT coalesce(sum(coalesce((value->>'damage')::int,0)),0)::int INTO damage_taken FROM jsonb_array_elements(coalesce(attack->'groups','[]'::jsonb)) value;END IF;candidate:=coalesce(pending->event_row.target_instance_id,'{"damage":0}'::jsonb);candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+damage_taken),true);pending:=jsonb_set(pending,ARRAY[event_row.target_instance_id],candidate,true);END LOOP;END LOOP;
 FOR unit_id,candidate IN SELECT key,value FROM jsonb_each(pending) LOOP IF coalesce((candidate->>'damage')::int,0)<20 THEN CONTINUE;END IF;SELECT value INTO unit_mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=unit_id;IF unit_mech IS NULL OR coalesce((unit_mech->>'destroyed')::boolean,false) OR coalesce((unit_mech->>'prone')::boolean,false) THEN CONTINUE;END IF;resolved:=btech_resolve_displacement_psr(p_catalogue_version,unit_mech,'20+ weapon damage',0);unit_mech:=resolved->'mech';check_result:=resolved->'check';fall_result:=check_result->'fall';SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',unit_id,'reasons',jsonb_build_array('20+ weapon damage'),'damage_taken',(candidate->>'damage')::int,'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target'),'passed',check_result->'passed','fell',NOT coalesce((check_result->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb)));END LOOP;RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_weapon_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;

-- Recursively clears occupied destination hexes. Same/one-level collisions
-- create a domino effect. Drops of two or more levels resolve as accidental
-- falls from above, including impact damage and falling-unit damage.
CREATE OR REPLACE FUNCTION public.btech_displace_battlemech_chain(
 p_catalogue_version text,p_map_id text,p_units jsonb,p_instance_id text,p_direction int,p_depth int DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE units jsonb:=p_units;moving jsonb;occupant jsonb;source_col int;source_row int;source_level int;dest jsonb;dest_col int;dest_row int;dest_level int;drop_levels int;
 nested jsonb;fall_result jsonb;moving_psr jsonb;occupant_psr jsonb;checks jsonb:='[]'::jsonb;impact_groups jsonb:='[]'::jsonb;
 moving_mass int;impact_damage int;remaining int;group_damage int;location_roll jsonb;damage_result jsonb;da int;db int;impact_target int;impact_hit boolean;
BEGIN
 IF p_depth>12 THEN RETURN jsonb_build_object('units',units,'moved',false,'reason','domino-depth','checks',checks);END IF;
 SELECT value INTO moving FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_instance_id;
 IF moving IS NULL THEN RETURN jsonb_build_object('units',units,'moved',false,'reason','missing-unit','checks',checks);END IF;
 source_col:=(moving->>'col')::int;source_row:=(moving->>'row')::int;source_level:=btech_elevation(p_map_id,lpad(source_col::text,2,'0')||lpad(source_row::text,2,'0'));
 dest:=btech_neighbor_hex(source_col,source_row,p_direction);dest_col:=(dest->>'col')::int;dest_row:=(dest->>'row')::int;
 IF dest_col NOT BETWEEN 0 AND 15 OR dest_row NOT BETWEEN 0 AND 11 OR btech_terrain(p_map_id,lpad(dest_col::text,2,'0')||lpad(dest_row::text,2,'0'))='impassable' THEN
  RETURN jsonb_build_object('units',units,'moved',false,'reason','prohibited-terrain','checks',checks);
 END IF;
 dest_level:=btech_elevation(p_map_id,lpad(dest_col::text,2,'0')||lpad(dest_row::text,2,'0'));
 IF dest_level-source_level>1 THEN RETURN jsonb_build_object('units',units,'moved',false,'reason','prohibited-elevation','checks',checks);END IF;
 drop_levels:=greatest(0,source_level-dest_level);
 SELECT value INTO occupant FROM jsonb_array_elements(units) value WHERE value->>'instanceId'<>p_instance_id AND (value->>'col')::int=dest_col AND (value->>'row')::int=dest_row AND NOT coalesce((value->>'destroyed')::boolean,false) LIMIT 1;
 IF occupant IS NOT NULL THEN
  IF drop_levels>=2 THEN
   impact_target:=7+CASE WHEN coalesce((occupant->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((occupant->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((occupant->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END
    +CASE btech_terrain(p_map_id,lpad(dest_col::text,2,'0')||lpad(dest_row::text,2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
   da:=floor(random()*6+1);db:=floor(random()*6+1);impact_hit:=impact_target<=12 AND da+db>=impact_target;
   IF impact_hit THEN
    SELECT (definition->>'mass')::int INTO moving_mass FROM btech_catalogue_units WHERE catalogue_version=p_catalogue_version AND unit_id=moving->>'unitId';
    impact_damage:=ceil(moving_mass/10.0*drop_levels)::int;remaining:=impact_damage;
    WHILE remaining>0 AND NOT coalesce((occupant->>'destroyed')::boolean,false) LOOP
     group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_physical_location('punch','front');
     damage_result:=btech_apply_direct_damage(occupant,group_damage,location_roll->>'location',false);occupant:=damage_result->'mech';
     impact_groups:=impact_groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
    END LOOP;
    SELECT jsonb_agg(CASE WHEN value->>'instanceId'=occupant->>'instanceId' THEN occupant ELSE value END) INTO units FROM jsonb_array_elements(units) value;
    nested:=btech_displace_battlemech_chain(p_catalogue_version,p_map_id,units,occupant->>'instanceId',p_direction,p_depth+1);units:=nested->'units';checks:=checks||coalesce(nested->'checks','[]'::jsonb);
    IF NOT coalesce((nested->>'moved')::boolean,false) AND NOT coalesce((occupant->>'destroyed')::boolean,false) THEN RETURN jsonb_build_object('units',units,'moved',false,'reason','blocked-accidental-fall','checks',checks,'impact_hit',true,'impact_damage',impact_damage,'impact_groups',impact_groups);END IF;
   ELSE
    RETURN jsonb_build_object('units',units,'moved',false,'reason','accidental-fall-missed-occupied-hex','checks',checks,'impact_hit',false,'impact_to_hit',jsonb_build_object('target',impact_target,'die_a',da,'die_b',db,'total',da+db));
   END IF;
  ELSE
   nested:=btech_displace_battlemech_chain(p_catalogue_version,p_map_id,units,occupant->>'instanceId',p_direction,p_depth+1);units:=nested->'units';checks:=checks||coalesce(nested->'checks','[]'::jsonb);
   IF NOT coalesce((nested->>'moved')::boolean,false) THEN RETURN jsonb_build_object('units',units,'moved',false,'reason','blocked-domino','checks',checks);END IF;
  END IF;
 END IF;
 SELECT value INTO moving FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_instance_id;
 moving:=jsonb_set(moving,'{col}',to_jsonb(dest_col),true);moving:=jsonb_set(moving,'{row}',to_jsonb(dest_row),true);
 IF drop_levels>=2 THEN fall_result:=btech_resolve_complete_fall(p_catalogue_version,moving,drop_levels,CASE WHEN occupant IS NULL THEN NULL ELSE 'rear' END);moving:=fall_result->'mech';checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',p_instance_id,'reason','accidental fall from above','fall',fall_result));
 ELSIF occupant IS NOT NULL THEN moving_psr:=btech_resolve_displacement_psr(p_catalogue_version,moving,'domino effect',0);moving:=moving_psr->'mech';checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',p_instance_id,'check',moving_psr->'check'));
  SELECT value INTO occupant FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=occupant->>'instanceId';occupant_psr:=btech_resolve_displacement_psr(p_catalogue_version,occupant,'domino effect',0);occupant:=occupant_psr->'mech';checks:=checks||jsonb_build_array(jsonb_build_object('instance_id',occupant->>'instanceId','check',occupant_psr->'check'));
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=occupant->>'instanceId' THEN occupant ELSE value END) INTO units FROM jsonb_array_elements(units) value;
 END IF;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN moving ELSE value END) INTO units FROM jsonb_array_elements(units) value;
 RETURN jsonb_build_object('units',units,'moved',true,'destination',dest,'drop_levels',drop_levels,'checks',checks,'impact_hit',impact_hit,'impact_damage',impact_damage,'impact_groups',impact_groups);
END $$;
REVOKE ALL ON FUNCTION public.btech_displace_battlemech_chain(text,text,jsonb,text,int,int) FROM PUBLIC;

-- Total Warfare physical-weapon table, stored as data so future catalogue
-- units gain their attacks without another resolver rewrite.
CREATE OR REPLACE FUNCTION public.btech_physical_weapon_profile(p_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_key
  WHEN 'backhoe' THEN '{"label":"Backhoe","to_hit":1,"damage":6,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'chainsaw' THEN '{"label":"Chainsaw","to_hit":0,"damage":5,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'combine' THEN '{"label":"Combine","to_hit":-2,"damage":3,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'dual_saw' THEN '{"label":"Dual Saw","to_hit":0,"damage":7,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'hatchet' THEN '{"label":"Hatchet","to_hit":-1,"damage_divisor":5,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'heavy_duty_pile_driver' THEN '{"label":"Heavy-Duty Pile Driver","to_hit":2,"damage":9,"arc":"forward","damage_actuators":false}'::jsonb
  WHEN 'mining_drill' THEN '{"label":"Mining Drill","to_hit":-1,"damage":4,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'retractable_blade' THEN '{"label":"Retractable Blade","to_hit":-2,"damage_divisor":10,"arc":"arm","damage_actuators":true,"ignore_hand":true}'::jsonb
  WHEN 'rock_cutter' THEN '{"label":"Rock Cutter","to_hit":1,"damage":5,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'spot_welder' THEN '{"label":"Spot Welder","to_hit":0,"damage":5,"arc":"arm","damage_actuators":false,"location_table":"punch","heat":2}'::jsonb
  WHEN 'sword' THEN '{"label":"Sword","to_hit":-2,"damage_divisor":10,"damage_bonus":1,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'wrecking_ball' THEN '{"label":"Wrecking Ball","to_hit":1,"damage":8,"arc":"forward","damage_actuators":false,"fumble":true}'::jsonb
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.btech_physical_weapon_profile(text) FROM PUBLIC;

-- Extend the authoritative standard declaration resolver. The UI submits
-- physical_<key>; the server derives every rule value from the table above.
DO $$ DECLARE fn regprocedure;source text;patched text;BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_physical_weapon_profile' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,' upper_label text;lower_label text;hand_or_foot text;weapon_fired boolean;hit boolean;',
  ' upper_label text;lower_label text;hand_or_foot text;weapon_fired boolean;hit boolean;physical_key text;physical_aim text;physical_profile jsonb;physical_label text;physical_heat int;level_difference int;fumble_psr jsonb;');
 patched:=replace(patched,E'IF p_attack_type NOT IN (''punch'',''kick'',''hatchet'') THEN RAISE EXCEPTION ''Choose punch, kick, hatchet, or pass'';END IF;',
  E'IF p_attack_type LIKE ''physical_%'' THEN physical_key:=split_part(substring(p_attack_type from 10),''__'',1);physical_aim:=nullif(split_part(substring(p_attack_type from 10),''__'',2),'''');IF physical_aim IS NOT NULL AND physical_aim NOT IN (''punch'',''kick'') THEN RAISE EXCEPTION ''Choose the standard, punch or kick location table'';END IF;physical_profile:=btech_physical_weapon_profile(physical_key);IF physical_profile IS NULL THEN RAISE EXCEPTION ''Unsupported physical weapon'';END IF;physical_label:=physical_profile->>''label'';ELSIF p_attack_type NOT IN (''punch'',''kick'',''hatchet'') THEN RAISE EXCEPTION ''Choose punch, kick, physical weapon, or pass'';END IF;');
 patched:=replace(patched,E' IF p_attack_type=''kick'' AND attack_diff NOT IN (0,1,5)',
  E' level_difference:=btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(target_start->>''col'',2,''0'')||lpad(target_start->>''row'',2,''0''))-btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(attacker_start->>''col'',2,''0'')||lpad(attacker_start->>''row'',2,''0''));IF abs(level_difference)>1 THEN RAISE EXCEPTION ''Physical target must be within one elevation level'';END IF;IF p_attack_type=''kick'' AND level_difference>0 THEN RAISE EXCEPTION ''A standing target one level higher cannot be kicked'';END IF;IF p_attack_type=''punch'' AND level_difference<0 THEN RAISE EXCEPTION ''A standing target one level lower cannot be punched'';END IF;\n IF p_attack_type=''kick'' AND attack_diff NOT IN (0,1,5)');
 patched:=replace(patched,E'IF p_attack_type IN (''punch'',''hatchet'') AND attack_diff=3',E'IF (p_attack_type IN (''punch'',''hatchet'') OR physical_profile->>''arc''=''arm'') AND attack_diff=3');
 patched:=replace(patched,E' IF p_attack_type=''hatchet'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1]<>''ra'')',
  E' IF physical_profile IS NOT NULL AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN (''la'',''ra'')) THEN RAISE EXCEPTION ''Choose the arm mounting the physical weapon'';END IF;\n IF physical_profile IS NOT NULL AND (NOT btech_physical_component_exists(p_catalogue_version,attacker_start,p_limbs[1],physical_label) OR btech_physical_component_damaged(p_catalogue_version,attacker_start,p_limbs[1],physical_label)) THEN RAISE EXCEPTION ''A functioning % is required'',physical_label;END IF;\n IF physical_profile->>''arc''=''forward'' AND attack_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''Physical weapon target is outside the forward arc'';END IF;\n IF p_attack_type=''hatchet'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1]<>''ra'')');
 patched:=replace(patched,E'IF p_attack_type IN (''punch'',''hatchet'') AND ((attack_diff IN (1,2) AND limb<>''la'') OR (attack_diff IN (4,5) AND limb<>''ra''))',
  E'IF (p_attack_type IN (''punch'',''hatchet'') OR physical_profile->>''arc''=''arm'') AND ((attack_diff IN (1,2) AND limb<>''la'') OR (attack_diff IN (4,5) AND limb<>''ra''))');
 patched:=replace(patched,E'IF p_attack_type IN (''punch'',''hatchet'') THEN\n   IF btech_physical_component_damaged',
  E'IF p_attack_type IN (''punch'',''hatchet'') OR physical_profile IS NOT NULL THEN\n   IF btech_physical_component_damaged');
 patched:=replace(patched,E'damage:=ceil(unit_mass/CASE WHEN p_attack_type=''hatchet'' THEN 5.0 ELSE 10.0 END)::int;',
  E'IF physical_profile IS NOT NULL THEN damage:=coalesce((physical_profile->>''damage'')::int,ceil(unit_mass/(physical_profile->>''damage_divisor'')::numeric)::int)+coalesce((physical_profile->>''damage_bonus'')::int,0);tn:=tn+coalesce((physical_profile->>''to_hit'')::int,0)+CASE WHEN physical_aim IS NULL THEN 0 ELSE 4 END;IF NOT coalesce((physical_profile->>''damage_actuators'')::boolean,false) THEN reduction:=0;END IF;IF coalesce((physical_profile->>''ignore_hand'')::boolean,false) THEN tn:=tn-CASE WHEN NOT btech_physical_component_exists(p_catalogue_version,attacker_start,limb,''Hand Actuator'') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,limb,''Hand Actuator'') THEN 1 ELSE 0 END;END IF;ELSE damage:=ceil(unit_mass/CASE WHEN p_attack_type=''hatchet'' THEN 5.0 ELSE 10.0 END)::int;END IF;');
 patched:=replace(patched,E'location_roll:=btech_roll_physical_location(p_attack_type,angle);',
  E'location_roll:=CASE WHEN coalesce((target_start->>''prone'')::boolean,false) THEN btech_roll_mech_hit_location(angle) WHEN physical_aim=''punch'' OR (physical_profile IS NOT NULL AND physical_aim IS NULL AND level_difference<0) OR (p_attack_type=''kick'' AND level_difference<0) THEN btech_roll_physical_location(''punch'',angle) WHEN physical_aim=''kick'' OR (physical_profile IS NOT NULL AND physical_aim IS NULL AND level_difference>0) OR (p_attack_type=''punch'' AND level_difference>0) THEN btech_roll_physical_location(''kick'',angle) WHEN physical_profile IS NULL THEN btech_roll_physical_location(p_attack_type,angle) WHEN physical_profile->>''location_table''=''punch'' THEN btech_roll_physical_location(''punch'',angle) ELSE btech_roll_mech_hit_location(angle) END;');
 patched:=replace(patched,E'''attack_type'',p_attack_type,''limb'',limb',E'''attack_type'',CASE WHEN physical_profile IS NULL THEN p_attack_type ELSE ''physical_weapon'' END,''physical_weapon'',physical_label,''physical_location_table'',coalesce(physical_aim,''standard''),''limb'',limb');
 patched:=replace(patched,E'   IF hit THEN\n    location_roll:=',
  E'   IF physical_profile IS NOT NULL AND coalesce((physical_profile->>''fumble'')::boolean,false) AND die_a+die_b=2 THEN location_roll:=btech_roll_mech_hit_location(''front'');damage_result:=btech_apply_direct_damage(attacker,ceil(damage/2.0)::int,location_roll->>''location'',false);attacker:=damage_result->''mech'';fumble_psr:=btech_resolve_displacement_psr(p_catalogue_version,attacker,''wrecking ball fumble'',0);attacker:=fumble_psr->''mech'';results:=results||jsonb_build_array(jsonb_build_object(''attack_type'',''physical_weapon'',''physical_weapon'',physical_label,''limb'',limb,''to_hit'',jsonb_build_object(''die_a'',die_a,''die_b'',die_b,''total'',die_a+die_b,''target'',tn),''hit'',false,''fumble'',true,''self_damage'',ceil(damage/2.0)::int,''location'',location_roll->>''location'',''critical_checks'',damage_result->''critical_checks'',''piloting_check'',fumble_psr->''check''));CONTINUE;ELSIF hit THEN\n    location_roll:=');
 patched:=replace(patched,E'OR coalesce((target_start->>''destroyed'')::boolean,false) OR coalesce((target_start->>''prone'')::boolean,false)',
  E'OR coalesce((target_start->>''destroyed'')::boolean,false) OR (coalesce((target_start->>''prone'')::boolean,false) AND p_attack_type<>''kick'')');
 patched:=replace(patched,E'''piloting_check_required'',p_attack_type=''kick''',E'''piloting_check_required'',p_attack_type=''kick'' AND NOT coalesce((target_start->>''prone'')::boolean,false)');
 patched:=replace(patched,E'IF p_resolve THEN\n  SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_target_id THEN target ELSE value END)',
  E'IF p_resolve THEN\n  IF physical_profile IS NOT NULL AND coalesce((physical_profile->>''heat'')::int,0)>0 THEN physical_heat:=(physical_profile->>''heat'')::int;attacker:=jsonb_set(attacker,''{weaponHeat}'',to_jsonb(coalesce((attacker->>''weaponHeat'')::int,0)+physical_heat),true);attacker:=jsonb_set(attacker,''{heat}'',to_jsonb(coalesce((attacker->>''heat'')::int,0)+physical_heat),true);END IF;\n  SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_target_id THEN target WHEN value->>''instanceId''=p_attacker_id THEN attacker ELSE value END)');
 IF patched=source OR position('btech_physical_weapon_profile' IN patched)=0 OR position('Physical target must be within one elevation level' IN patched)=0 OR position('physical_location_table' IN patched)=0 OR position('wrecking ball fumble' IN patched)=0 OR position('physical_heat:=' IN patched)=0 OR position('p_attack_type<>''kick''' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend every required physical declaration rule';END IF;EXECUTE patched;
END $$;

-- Ensure the legacy one-hex special-attack move cannot enter prohibited
-- terrain or climb more than one level. The shared wrapper below handles an
-- occupied destination and any resulting domino chain.
DO $$ DECLARE fn regprocedure;source text;patched text;BEGIN
 FOREACH fn IN ARRAY ARRAY[to_regprocedure('public.resolve_declared_charge(uuid,text)'),to_regprocedure('public.resolve_declared_death_from_above(uuid,text)')] LOOP
  SELECT pg_get_functiondef(fn) INTO source;patched:=source;
  patched:=replace(patched,E'IF dest_col BETWEEN 0 AND 15 AND dest_row BETWEEN 0 AND 11 AND NOT EXISTS',
   E'IF dest_col BETWEEN 0 AND 15 AND dest_row BETWEEN 0 AND 11 AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(dest_col::text,2,''0'')||lpad(dest_row::text,2,''0''))<>''impassable'' AND btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(dest_col::text,2,''0'')||lpad(dest_row::text,2,''0''))-btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(target->>''col'',2,''0'')||lpad(target->>''row'',2,''0''))<=1 AND NOT EXISTS');
  IF patched<>source THEN EXECUTE patched;END IF;
 END LOOP;
END $$;

DO $$ DECLARE fn regprocedure;source text;patched text;BEGIN
 fn:=to_regprocedure('public.resolve_push_attack(uuid,text,text)');SELECT pg_get_functiondef(fn) INTO source;
 patched:=replace(source,E'AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(dest_col::text,2,''0'')||lpad(dest_row::text,2,''0''))<>''impassable'' AND NOT EXISTS',
  E'AND btech_terrain(coalesce(st->>''map_id'',''training-grounds''),lpad(dest_col::text,2,''0'')||lpad(dest_row::text,2,''0''))<>''impassable'' AND btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(dest_col::text,2,''0'')||lpad(dest_row::text,2,''0''))-btech_elevation(coalesce(st->>''map_id'',''training-grounds''),lpad(target->>''col'',2,''0'')||lpad(target->>''row'',2,''0''))<=1 AND NOT EXISTS');
 IF patched<>source THEN EXECUTE patched;END IF;
END $$;

DO $$ DECLARE fn regprocedure;source text;patched text;BEGIN
 fn:=to_regprocedure('public.resolve_declared_death_from_above(uuid,text)');SELECT pg_get_functiondef(fn) INTO source;patched:=source;
 patched:=replace(patched,E'IF target_damage>=20 AND NOT coalesce((target->>''destroyed'')::boolean,false) AND NOT coalesce((target->>''prone'')::boolean,false) THEN',E'IF NOT coalesce((target->>''destroyed'')::boolean,false) AND NOT coalesce((target->>''prone'')::boolean,false) THEN');
 patched:=replace(patched,E'target_psr_target:=target_piloting;',E'target_psr_target:=target_piloting+2;');
 IF patched<>source THEN EXECUTE patched;END IF;
END $$;

-- Preserve the old special-attack implementations behind wrappers. The
-- wrappers only intervene when their legacy one-hex move was blocked.
DO $$ BEGIN
 IF to_regprocedure('public.resolve_push_attack_legacy(uuid,text,text)') IS NULL THEN ALTER FUNCTION public.resolve_push_attack(uuid,text,text) RENAME TO resolve_push_attack_legacy;END IF;
 IF to_regprocedure('public.resolve_declared_charge_legacy(uuid,text)') IS NULL THEN ALTER FUNCTION public.resolve_declared_charge(uuid,text) RENAME TO resolve_declared_charge_legacy;END IF;
 IF to_regprocedure('public.resolve_declared_death_from_above_legacy(uuid,text)') IS NULL THEN ALTER FUNCTION public.resolve_declared_death_from_above(uuid,text) RENAME TO resolve_declared_death_from_above_legacy;END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_complete_blocked_special_displacement(p_game_id uuid,p_attacker_id text,p_target_id text,p_advance boolean,p_direction int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;units jsonb;attacker jsonb;target jsonb;direction int;candidate_direction int;old_col int;old_row int;displacement jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;units:=st->'mech_instances';
 SELECT value INTO attacker FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_attacker_id;SELECT value INTO target FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_target_id;
 IF attacker IS NULL OR target IS NULL THEN RETURN jsonb_build_object('state',st,'moved',false);END IF;
 direction:=coalesce(p_direction,(attacker->>'facing')::int,btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int));old_col:=(target->>'col')::int;old_row:=(target->>'row')::int;
 displacement:=btech_displace_battlemech_chain(g.catalogue_version,coalesce(st->>'map_id','training-grounds'),units,p_target_id,direction,0);units:=displacement->'units';
 IF NOT p_advance AND NOT coalesce((displacement->>'moved')::boolean,false) THEN
  FOREACH candidate_direction IN ARRAY ARRAY[(direction+5)%6,(direction+1)%6,(direction+4)%6,(direction+2)%6,(direction+3)%6] LOOP
   displacement:=btech_displace_battlemech_chain(g.catalogue_version,coalesce(st->>'map_id','training-grounds'),units,p_target_id,candidate_direction,0);units:=displacement->'units';EXIT WHEN coalesce((displacement->>'moved')::boolean,false);END LOOP;
 END IF;
 IF coalesce((displacement->>'moved')::boolean,false) AND p_advance THEN SELECT value INTO attacker FROM jsonb_array_elements(units) value WHERE value->>'instanceId'=p_attacker_id;attacker:=jsonb_set(attacker,'{col}',to_jsonb(old_col),true);attacker:=jsonb_set(attacker,'{row}',to_jsonb(old_row),true);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(units) value;END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN displacement||jsonb_build_object('state',st);
END $$;
REVOKE ALL ON FUNCTION public.btech_complete_blocked_special_displacement(uuid,text,text,boolean,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_finalize_saved_fall(p_game_id uuid,p_instance_id text,p_levels int DEFAULT 0,p_forced_angle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;units jsonb;mech jsonb;finished jsonb;BEGIN SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_instance_id;IF mech IS NULL OR NOT coalesce((mech->>'prone')::boolean,false) THEN RETURN NULL;END IF;finished:=btech_finalize_existing_fall(g.catalogue_version,mech,p_levels,p_forced_angle);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN finished->'mech' ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN finished-'mech';END $$;
REVOKE ALL ON FUNCTION public.btech_finalize_saved_fall(uuid,text,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_mark_mech_destroyed(p_game_id uuid,p_instance_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;st jsonb;units jsonb;BEGIN SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN jsonb_set(value,'{destroyed}','true'::jsonb,true) ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;END $$;
REVOKE ALL ON FUNCTION public.btech_mark_mech_destroyed(uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_push_attack(p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;completion jsonb;fall_edge jsonb;BEGIN result:=resolve_push_attack_legacy(p_game_id,p_attacker_instance_id,p_target_instance_id);IF result->'result'->'target_piloting_check' IS NOT NULL AND NOT coalesce((result->'result'->'target_piloting_check'->>'passed')::boolean,false) THEN fall_edge:=btech_finalize_saved_fall(p_game_id,p_target_instance_id,0,NULL);result:=jsonb_set(result,'{result,fall_edge}',fall_edge,true);END IF;IF coalesce((result->'result'->>'hit')::boolean,false) AND NOT coalesce((result->'result'->>'displaced')::boolean,false) THEN completion:=btech_complete_blocked_special_displacement(p_game_id,p_attacker_instance_id,p_target_instance_id,true,NULL);result:=jsonb_set(result,'{result,displacement}',completion,true);END IF;RETURN result;END $$;
REVOKE ALL ON FUNCTION public.resolve_push_attack(uuid,text,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.resolve_push_attack(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_declared_charge(p_game_id uuid,p_attacker_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_target text;before_col int;before_row int;attack_direction int;after_target jsonb;g btech_games%ROWTYPE;st jsonb;attacker jsonb;result jsonb;completion jsonb;attacker_fall jsonb;target_fall jsonb;BEGIN SELECT * INTO g FROM btech_games WHERE id=p_game_id;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;before_target:=attacker->'chargeDeclaration'->>'target_instance_id';attack_direction:=(attacker->>'facing')::int;SELECT value INTO after_target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=before_target;before_col:=(after_target->>'col')::int;before_row:=(after_target->>'row')::int;result:=resolve_declared_charge_legacy(p_game_id,p_attacker_instance_id);IF result->'result'->'attacker_piloting_check' IS NOT NULL AND NOT coalesce((result->'result'->'attacker_piloting_check'->>'passed')::boolean,false) THEN attacker_fall:=btech_finalize_saved_fall(p_game_id,p_attacker_instance_id,0,NULL);END IF;IF result->'result'->'target_piloting_check' IS NOT NULL AND NOT coalesce((result->'result'->'target_piloting_check'->>'passed')::boolean,false) THEN target_fall:=btech_finalize_saved_fall(p_game_id,before_target,0,NULL);END IF;result:=jsonb_set(result,'{result,fall_edges}',jsonb_build_object('attacker',attacker_fall,'target',target_fall),true);SELECT * INTO g FROM btech_games WHERE id=p_game_id;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT value INTO after_target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=before_target;IF coalesce((result->>'hit')::boolean,false) AND before_target IS NOT NULL AND (after_target->>'col')::int=before_col AND (after_target->>'row')::int=before_row THEN completion:=btech_complete_blocked_special_displacement(p_game_id,p_attacker_instance_id,before_target,true,attack_direction);result:=jsonb_set(result,'{result,displacement}',completion,true);END IF;RETURN result;END $$;
REVOKE ALL ON FUNCTION public.resolve_declared_charge(uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.resolve_declared_charge(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_declared_death_from_above(p_game_id uuid,p_attacker_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before_target text;before_col int;before_row int;attack_direction int;after_target jsonb;g btech_games%ROWTYPE;st jsonb;attacker jsonb;result jsonb;completion jsonb;attacker_fall jsonb;target_fall jsonb;BEGIN SELECT * INTO g FROM btech_games WHERE id=p_game_id;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;before_target:=attacker->'dfaDeclaration'->>'target_instance_id';attack_direction:=(attacker->>'facing')::int;SELECT value INTO after_target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=before_target;before_col:=(after_target->>'col')::int;before_row:=(after_target->>'row')::int;result:=resolve_declared_death_from_above_legacy(p_game_id,p_attacker_instance_id);IF NOT coalesce((result->>'hit')::boolean,false) OR (result->'result'->'attacker_piloting_check' IS NOT NULL AND NOT coalesce((result->'result'->'attacker_piloting_check'->>'passed')::boolean,false)) THEN attacker_fall:=btech_finalize_saved_fall(p_game_id,p_attacker_instance_id,CASE WHEN coalesce((result->>'hit')::boolean,false) THEN 0 ELSE 2 END,CASE WHEN coalesce((result->>'hit')::boolean,false) THEN NULL ELSE 'rear' END);END IF;IF result->'result'->'target_piloting_check' IS NOT NULL AND NOT coalesce((result->'result'->'target_piloting_check'->>'passed')::boolean,false) THEN target_fall:=btech_finalize_saved_fall(p_game_id,before_target,0,NULL);END IF;result:=jsonb_set(result,'{result,fall_edges}',jsonb_build_object('attacker',attacker_fall,'target',target_fall),true);SELECT * INTO g FROM btech_games WHERE id=p_game_id;st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;SELECT value INTO after_target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=before_target;IF before_target IS NOT NULL AND (after_target->>'col')::int=before_col AND (after_target->>'row')::int=before_row THEN completion:=btech_complete_blocked_special_displacement(p_game_id,p_attacker_instance_id,before_target,false,attack_direction);result:=jsonb_set(result,'{result,displacement}',completion,true);IF NOT coalesce((completion->>'moved')::boolean,false) THEN PERFORM btech_mark_mech_destroyed(p_game_id,CASE WHEN coalesce((result->>'hit')::boolean,false) THEN before_target ELSE p_attacker_instance_id END);result:=jsonb_set(result,'{result,displacement,destroyed}',to_jsonb(CASE WHEN coalesce((result->>'hit')::boolean,false) THEN before_target ELSE p_attacker_instance_id END),true);END IF;END IF;RETURN result;END $$;
REVOKE ALL ON FUNCTION public.resolve_declared_death_from_above(uuid,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.resolve_declared_death_from_above(uuid,text) TO authenticated;
