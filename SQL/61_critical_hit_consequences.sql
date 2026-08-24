-- Complete BattleMech gyro, leg, hip, actuator and jump-jet consequences.
-- Run after SQL/60_complete_displacement_physical_falls.sql.

-- One canonical summary feeds Piloting, falls, standing and movement. A hip
-- replaces the other actuator modifiers in its leg; a destroyed leg replaces
-- all prior damage modifiers in that leg.
CREATE OR REPLACE FUNCTION public.btech_critical_mobility_state(p_catalogue_version text,p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE gyro_hits int:=0;left_hip int:=0;right_hip int:=0;left_actuators int:=0;right_actuators int:=0;
 left_destroyed boolean:=coalesce((p_mech->'structure'->>'ll')::int,0)<=0;
 right_destroyed boolean:=coalesce((p_mech->'structure'->>'rl')::int,0)<=0;
 gyro_modifier int;left_modifier int;right_modifier int;
BEGIN
 SELECT
  count(*) FILTER (WHERE normalized ILIKE '%gyro%'),
  count(*) FILTER (WHERE location='ll' AND normalized='Hip'),
  count(*) FILTER (WHERE location='rl' AND normalized='Hip'),
  count(*) FILTER (WHERE location='ll' AND normalized IN ('Upper Leg Actuator','Lower Leg Actuator','Foot Actuator')),
  count(*) FILTER (WHERE location='rl' AND normalized IN ('Upper Leg Actuator','Lower Leg Actuator','Foot Actuator'))
 INTO gyro_hits,left_hip,right_hip,left_actuators,right_actuators
 FROM (
  SELECT slot.location,regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','') normalized
  FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
   AND btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index)
 ) damaged;
 gyro_modifier:=CASE WHEN gyro_hits>=2 THEN 6 WHEN gyro_hits=1 THEN 3 ELSE 0 END;
 left_modifier:=CASE WHEN left_destroyed THEN 5 WHEN left_hip>0 THEN 2 ELSE left_actuators END;
 right_modifier:=CASE WHEN right_destroyed THEN 5 WHEN right_hip>0 THEN 2 ELSE right_actuators END;
 RETURN jsonb_build_object(
  'gyro_hits',gyro_hits,'gyro_destroyed',gyro_hits>=2,'gyro_modifier',gyro_modifier,
  'left_hip_hits',left_hip,'right_hip_hits',right_hip,'hip_hits',left_hip+right_hip,
  'left_actuator_hits',left_actuators,'right_actuator_hits',right_actuators,'leg_actuator_hits',left_actuators+right_actuators,
  'left_leg_destroyed',left_destroyed,'right_leg_destroyed',right_destroyed,
  'destroyed_legs',(left_destroyed::int+right_destroyed::int),
  'leg_modifier',left_modifier+right_modifier,
  'piloting_modifier',gyro_modifier+left_modifier+right_modifier);
END $$;
REVOKE ALL ON FUNCTION public.btech_critical_mobility_state(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_critical_movement_profile(p_catalogue_version text,p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE definition jsonb;damage jsonb;base_walk int;base_jump int;walk_mp int;run_mp int;jump_mp int;
 left_deduction int:=0;right_deduction int:=0;unavailable_jets int:=0;
BEGIN
 SELECT unit.definition INTO definition FROM btech_catalogue_units unit
  WHERE unit.catalogue_version=p_catalogue_version AND unit.unit_id=p_mech->>'unitId';
 IF definition IS NULL THEN RAISE EXCEPTION 'BattleMech is missing from the pinned catalogue';END IF;
 damage:=btech_critical_mobility_state(p_catalogue_version,p_mech);
 base_walk:=coalesce((definition->'movement'->>'walk')::int,0);base_jump:=coalesce((definition->'movement'->>'jump')::int,0);
 IF (damage->>'destroyed_legs')::int>=2 OR (damage->>'hip_hits')::int>=2 THEN walk_mp:=0;
 ELSIF (damage->>'destroyed_legs')::int=1 THEN walk_mp:=1;
 ELSE
  IF NOT coalesce((damage->>'left_leg_destroyed')::boolean,false) AND coalesce((damage->>'left_hip_hits')::int,0)=0 THEN left_deduction:=coalesce((damage->>'left_actuator_hits')::int,0);END IF;
  IF NOT coalesce((damage->>'right_leg_destroyed')::boolean,false) AND coalesce((damage->>'right_hip_hits')::int,0)=0 THEN right_deduction:=coalesce((damage->>'right_actuator_hits')::int,0);END IF;
  walk_mp:=CASE WHEN (damage->>'hip_hits')::int=1 THEN ceil(base_walk/2.0)::int ELSE base_walk END-left_deduction-right_deduction;
  walk_mp:=greatest(0,walk_mp);
 END IF;
 run_mp:=CASE WHEN (damage->>'destroyed_legs')::int>0 THEN 0 ELSE ceil(walk_mp*1.5)::int END;
 SELECT count(*)::int INTO unavailable_jets FROM btech_catalogue_critical_slots slot
 WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
  AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','') ILIKE '%Jump Jet%'
  AND (coalesce((p_mech->'structure'->>slot.location)::int,0)<=0 OR btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index));
 jump_mp:=CASE WHEN (damage->>'destroyed_legs')::int>=2 THEN 0 ELSE greatest(0,base_jump-unavailable_jets) END;
 RETURN damage||jsonb_build_object('base_walk',base_walk,'base_jump',base_jump,'walk',walk_mp,'run',run_mp,'jump',jump_mp,'unavailable_jump_jets',unavailable_jets);
END $$;
REVOKE ALL ON FUNCTION public.btech_critical_movement_profile(text,jsonb) FROM PUBLIC;

-- Falling-pilot injury checks use every current gyro/leg damage modifier, not
-- only gyro damage. The fall itself still changes facing and applies damage in
-- five-point groups before the injury-avoidance roll.
CREATE OR REPLACE FUNCTION public.btech_resolve_complete_fall(
 p_catalogue_version text,p_mech jsonb,p_levels int DEFAULT 0,p_forced_angle text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;unit_mass int;fall_die int;facing_delta int;damage_angle text;
 damage_total int;remaining int;group_damage int;location_roll jsonb;damage_result jsonb;
 groups jsonb:='[]'::jsonb;damage_state jsonb;pilot_target int;pilot_a int;pilot_b int;pilot_passed boolean;
 pilot_automatic boolean;pilot_result jsonb:=NULL;pilot_checks jsonb:='[]'::jsonb;
BEGIN
 SELECT (definition->>'mass')::int INTO unit_mass FROM btech_catalogue_units
  WHERE catalogue_version=p_catalogue_version AND unit_id=m->>'unitId';
 IF unit_mass IS NULL THEN RAISE EXCEPTION 'Falling BattleMech is missing from the pinned catalogue';END IF;
 fall_die:=floor(random()*6+1);
 IF p_forced_angle IS NULL THEN
  facing_delta:=CASE fall_die WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 ELSE 5 END;
  damage_angle:=CASE fall_die WHEN 1 THEN 'front' WHEN 2 THEN 'right' WHEN 3 THEN 'right' WHEN 4 THEN 'rear' WHEN 5 THEN 'left' ELSE 'left' END;
 ELSE damage_angle:=p_forced_angle;facing_delta:=CASE p_forced_angle WHEN 'right' THEN 1 WHEN 'rear' THEN 3 WHEN 'left' THEN 5 ELSE 0 END;END IF;
 m:=jsonb_set(m,'{facing}',to_jsonb((coalesce((m->>'facing')::int,0)+facing_delta)%6),true);
 m:=jsonb_set(m,'{torsoFacing}',m->'facing',true);m:=jsonb_set(m,'{prone}','true'::jsonb,true);
 damage_total:=ceil(unit_mass/10.0)::int*(greatest(0,p_levels)+1);remaining:=damage_total;
 WHILE remaining>0 AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  group_damage:=least(5,remaining);remaining:=remaining-group_damage;location_roll:=btech_roll_mech_hit_location(damage_angle);
  damage_result:=btech_apply_direct_damage(m,group_damage,location_roll->>'location',damage_angle='rear');m:=damage_result->'mech';
  groups:=groups||jsonb_build_array(jsonb_build_object('damage',group_damage,'location',location_roll->>'location','location_roll',location_roll,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check'));
 END LOOP;
 damage_state:=btech_critical_mobility_state(p_catalogue_version,m);
 pilot_target:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+coalesce((damage_state->>'piloting_modifier')::int,0)+greatest(0,p_levels-1);
 pilot_automatic:=coalesce(m->'pilot'->>'consciousness','conscious')<>'conscious' OR coalesce((m->>'shutdown')::boolean,false) OR pilot_target>12;
 IF pilot_automatic THEN pilot_a:=NULL;pilot_b:=NULL;pilot_passed:=false;
 ELSE pilot_a:=floor(random()*6+1);pilot_b:=floor(random()*6+1);pilot_passed:=pilot_a+pilot_b>=pilot_target;END IF;
 IF NOT pilot_passed AND coalesce(m->'pilot'->>'consciousness','conscious')<>'dead' THEN pilot_result:=btech_apply_pilot_hit(m,'fall');m:=pilot_result->'mech';pilot_checks:=pilot_checks||jsonb_build_array(pilot_result->'check');END IF;
 RETURN jsonb_build_object('mech',m,'fell',true,'levels',greatest(0,p_levels),'fall_direction_die',fall_die,'fall_angle',damage_angle,
  'fall_damage',damage_total,'fall_groups',groups,'damage_modifier',damage_state->'piloting_modifier',
  'pilot_injury_avoidance',jsonb_build_object('target',pilot_target,'die_a',pilot_a,'die_b',pilot_b,'total',CASE WHEN pilot_a IS NULL THEN NULL ELSE pilot_a+pilot_b END,'automatic',pilot_automatic,'passed',pilot_passed),
  'pilot_checks',pilot_checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_complete_fall(text,jsonb,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_finalize_existing_fall(p_catalogue_version text,p_mech jsonb,p_levels int DEFAULT 0,p_forced_angle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;fall_die int;facing_delta int;damage_angle text;damage_state jsonb;pilot_target int;pilot_a int;pilot_b int;pilot_passed boolean;pilot_automatic boolean;pilot_result jsonb:=NULL;
BEGIN
 fall_die:=floor(random()*6+1);IF p_forced_angle IS NULL THEN facing_delta:=CASE fall_die WHEN 1 THEN 0 WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 3 WHEN 5 THEN 4 ELSE 5 END;damage_angle:=CASE fall_die WHEN 1 THEN 'front' WHEN 2 THEN 'right' WHEN 3 THEN 'right' WHEN 4 THEN 'rear' WHEN 5 THEN 'left' ELSE 'left' END;ELSE damage_angle:=p_forced_angle;facing_delta:=CASE p_forced_angle WHEN 'right' THEN 1 WHEN 'rear' THEN 3 WHEN 'left' THEN 5 ELSE 0 END;END IF;
 m:=jsonb_set(m,'{facing}',to_jsonb((coalesce((m->>'facing')::int,0)+facing_delta)%6),true);m:=jsonb_set(m,'{torsoFacing}',m->'facing',true);m:=jsonb_set(m,'{prone}','true'::jsonb,true);
 damage_state:=btech_critical_mobility_state(p_catalogue_version,m);pilot_target:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+coalesce((damage_state->>'piloting_modifier')::int,0)+greatest(0,p_levels-1);
 pilot_automatic:=coalesce(m->'pilot'->>'consciousness','conscious')<>'conscious' OR coalesce((m->>'shutdown')::boolean,false) OR pilot_target>12;
 IF pilot_automatic THEN pilot_a:=NULL;pilot_b:=NULL;pilot_passed:=false;ELSE pilot_a:=floor(random()*6+1);pilot_b:=floor(random()*6+1);pilot_passed:=pilot_a+pilot_b>=pilot_target;END IF;
 IF NOT pilot_passed AND coalesce(m->'pilot'->>'consciousness','conscious')<>'dead' THEN pilot_result:=btech_apply_pilot_hit(m,'fall');m:=pilot_result->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'fall_direction_die',fall_die,'fall_angle',damage_angle,'damage_modifier',damage_state->'piloting_modifier','pilot_injury_avoidance',jsonb_build_object('target',pilot_target,'die_a',pilot_a,'die_b',pilot_b,'total',CASE WHEN pilot_a IS NULL THEN NULL ELSE pilot_a+pilot_b END,'automatic',pilot_automatic,'passed',pilot_passed),'pilot_check',pilot_result->'check');
END $$;
REVOKE ALL ON FUNCTION public.btech_finalize_existing_fall(text,jsonb,int,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_displacement_psr(p_catalogue_version text,p_mech jsonb,p_reason text,p_modifier int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;damage_state jsonb;target_number int;da int;db int;passed boolean;automatic boolean;fall_result jsonb:=NULL;
BEGIN
 IF coalesce((m->>'destroyed')::boolean,false) OR coalesce((m->>'prone')::boolean,false) THEN RETURN jsonb_build_object('mech',m,'check',NULL);END IF;
 damage_state:=btech_critical_mobility_state(p_catalogue_version,m);
 target_number:=coalesce((m->'pilot'->>'piloting')::int,(m->>'pilotingSkill')::int,5)+coalesce((damage_state->>'piloting_modifier')::int,0)+p_modifier;
 automatic:=coalesce((m->>'shutdown')::boolean,false) OR coalesce((damage_state->>'gyro_destroyed')::boolean,false) OR target_number>12;
 IF automatic THEN da:=NULL;db:=NULL;passed:=false;ELSE da:=floor(random()*6+1);db:=floor(random()*6+1);passed:=target_number<=2 OR da+db>=target_number;END IF;
 IF NOT passed THEN fall_result:=btech_resolve_complete_fall(p_catalogue_version,m,0,NULL);m:=fall_result->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'check',jsonb_build_object('reason',p_reason,'target',target_number,'die_a',da,'die_b',db,'total',CASE WHEN da IS NULL THEN NULL ELSE da+db END,'automatic',automatic,'passed',passed,'damage_modifier',damage_state->'piloting_modifier','situational_modifier',p_modifier,'fall',fall_result));
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_displacement_psr(text,jsonb,text,int) FROM PUBLIC;

-- Movement ratings are recalculated from surviving actuators before heat is
-- applied. Running with a damaged hip/gyro and jumping with mobility damage
-- make one combined end-of-movement Piloting roll.
CREATE OR REPLACE FUNCTION public.submit_battlemech_movement(
 p_game_id uuid,p_instance_id text,p_mode text,p_path jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
 action jsonb;action_type text;next_col int;next_row int;direction int;terrain_name text;terrain_cost int;
 current_col int;current_row int;current_facing int;current_level int;next_level int;mp_used int:=0;hexes_moved int:=0;mp_max int:=0;heat_penalty int;
 movement_heat int;path_length int;mobility jsonb;rough_ground_run boolean:=false;critical_check boolean:=false;
 reasons text[]:=ARRAY[]::text[];resolved jsonb;raw_check jsonb;fall_result jsonb;check_payload jsonb:=NULL;
BEGIN
 IF p_mode NOT IN ('stand','walk','run','jump') THEN RAISE EXCEPTION 'Choose stand, walk, run, or jump';END IF;
 IF jsonb_typeof(p_path)<>'array' THEN RAISE EXCEPTION 'Movement path must be an array';END IF;
 path_length:=jsonb_array_length(p_path);IF path_length>40 THEN RAISE EXCEPTION 'Movement path is too long';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=coalesce(st->'mech_instances','[]'::jsonb);
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false)
  OR coalesce((mech->>'shutdown')::boolean,false) OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Choose one of your eligible BattleMechs that has not moved';END IF;
 IF coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'A prone BattleMech must use the stand-up resolver';END IF;
 mobility:=btech_critical_movement_profile(g.catalogue_version,mech);
 IF coalesce((mobility->>'destroyed_legs')::int,0)>=2 THEN RAISE EXCEPTION 'A BattleMech with both legs destroyed cannot move';END IF;
 IF coalesce((mobility->>'gyro_destroyed')::boolean,false) THEN RAISE EXCEPTION 'A destroyed gyro prevents this BattleMech moving';END IF;
 IF p_mode='stand' THEN IF path_length<>0 THEN RAISE EXCEPTION 'Standing still cannot include a movement path';END IF;
 ELSE
  heat_penalty:=CASE WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;
  mp_max:=greatest(0,coalesce((mobility->>p_mode)::int,0)-heat_penalty);
  IF mp_max<=0 THEN RAISE EXCEPTION 'Critical damage and heat leave no % movement points available',p_mode;END IF;
  IF path_length=0 THEN RAISE EXCEPTION 'A movement path is required';END IF;
 END IF;
 current_col:=(mech->>'col')::int;current_row:=(mech->>'row')::int;current_facing:=coalesce((mech->>'facing')::int,0);
 current_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'));
 FOR action IN SELECT value FROM jsonb_array_elements(p_path) value LOOP
  action_type:=action->>'action';
  IF action_type='turn' THEN
   IF p_mode='jump' OR action->>'direction' NOT IN ('left','right') THEN RAISE EXCEPTION 'Invalid facing change';END IF;
   mp_used:=mp_used+1;current_facing:=(current_facing+CASE action->>'direction' WHEN 'left' THEN 1 ELSE -1 END+6)%6;
  ELSIF action_type='step' THEN
   IF p_mode='jump' THEN RAISE EXCEPTION 'Jump movement must use a jump landing';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 OR btech_hex_distance(current_col,current_row,next_col,next_row)<>1 THEN RAISE EXCEPTION 'Each walking or running step must enter an adjacent map hex';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot enter an occupied hex';END IF;
   direction:=btech_direction_to(current_col,current_row,next_col,next_row);IF direction=(current_facing+3)%6 AND p_mode<>'walk' THEN RAISE EXCEPTION 'A running BattleMech cannot move backward';END IF;
   terrain_name:=btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'));
   IF terrain_name='impassable' THEN RAISE EXCEPTION 'That terrain is impassable';END IF;
   next_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'));
   IF abs(next_level-current_level)>1 THEN RAISE EXCEPTION 'A BattleMech can climb or descend only one elevation level at a time';END IF;
   terrain_cost:=CASE terrain_name WHEN 'light_woods' THEN 1 WHEN 'heavy_woods' THEN 2 WHEN 'rough' THEN 1 WHEN 'shallow_water' THEN 1 ELSE 0 END;
   IF p_mode='run' AND terrain_name='rough' THEN rough_ground_run:=true;END IF;
   mp_used:=mp_used+CASE WHEN direction=current_facing OR direction=(current_facing+3)%6 THEN 1 ELSE least(abs(direction-current_facing),6-abs(direction-current_facing))+1 END+terrain_cost;
   IF direction<>(current_facing+3)%6 THEN current_facing:=direction;END IF;
   current_col:=next_col;current_row:=next_row;current_level:=next_level;hexes_moved:=hexes_moved+1;
  ELSIF action_type='jump' THEN
   IF p_mode<>'jump' OR path_length<>1 THEN RAISE EXCEPTION 'A jump must be one direct landing';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 THEN RAISE EXCEPTION 'Jump landing is outside the map';END IF;
   IF btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'))='impassable' THEN RAISE EXCEPTION 'That terrain cannot be used as a jump landing';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot land in an occupied hex';END IF;
   mp_used:=btech_hex_distance(current_col,current_row,next_col,next_row);hexes_moved:=mp_used;
   IF action ? 'facing' THEN IF action->>'facing' !~ '^[0-5]$' THEN RAISE EXCEPTION 'Jump landing facing must be between 0 and 5';END IF;current_facing:=(action->>'facing')::int;
   ELSE current_facing:=btech_direction_to(current_col,current_row,next_col,next_row);END IF;
   current_col:=next_col;current_row:=next_row;
  ELSE RAISE EXCEPTION 'Invalid movement action';END IF;
  IF mp_used>mp_max THEN RAISE EXCEPTION 'Movement path exceeds the available % movement points',p_mode;END IF;
 END LOOP;
 movement_heat:=CASE p_mode WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN greatest(3,hexes_moved) ELSE 0 END;
 mech:=jsonb_set(mech,'{col}',to_jsonb(current_col),true);mech:=jsonb_set(mech,'{row}',to_jsonb(current_row),true);mech:=jsonb_set(mech,'{facing}',to_jsonb(current_facing),true);mech:=jsonb_set(mech,'{torsoFacing}',to_jsonb(current_facing),true);
 mech:=jsonb_set(mech,'{movementMode}',to_jsonb(p_mode),true);mech:=jsonb_set(mech,'{mpUsed}',to_jsonb(mp_used),true);mech:=jsonb_set(mech,'{hexesMoved}',to_jsonb(hexes_moved),true);mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);mech:=jsonb_set(mech,'{movementHeat}',to_jsonb(movement_heat),true);
 mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+movement_heat+coalesce((mech->>'weaponHeat')::int,0)+coalesce((mech->>'externalHeat')::int,0)),true);
 critical_check:=(p_mode='run' AND (coalesce((mobility->>'hip_hits')::int,0)>0 OR coalesce((mobility->>'gyro_hits')::int,0)>0))
  OR (p_mode='jump' AND (coalesce((mobility->>'hip_hits')::int,0)>0 OR coalesce((mobility->>'leg_actuator_hits')::int,0)>0 OR coalesce((mobility->>'gyro_hits')::int,0)>0 OR coalesce((mobility->>'destroyed_legs')::int,0)>0));
 IF rough_ground_run THEN reasons:=array_append(reasons,'running through rough ground');END IF;
 IF critical_check THEN reasons:=array_append(reasons,CASE WHEN p_mode='run' THEN 'running with damaged hip or gyro' ELSE 'jump landing with gyro or leg damage' END);END IF;
 IF array_length(reasons,1)>0 THEN
  resolved:=btech_resolve_displacement_psr(g.catalogue_version,mech,array_to_string(reasons,', '),0);mech:=resolved->'mech';raw_check:=resolved->'check';fall_result:=raw_check->'fall';
  check_payload:=jsonb_build_object('instance_id',p_instance_id,'reasons',to_jsonb(reasons),'to_hit',jsonb_build_object('die_a',raw_check->'die_a','die_b',raw_check->'die_b','total',raw_check->'total','target',raw_check->'target','damage_modifier',raw_check->'damage_modifier'),'automatic',raw_check->'automatic','passed',raw_check->'passed','fell',NOT coalesce((raw_check->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb));
 END IF;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'mode',p_mode,'col',current_col,'row',current_row,'facing',current_facing,'mp_used',mp_used,'mp_max',mp_max,'hexes_moved',hexes_moved,'movement_heat',movement_heat,'movement_profile',mobility,'movement_piloting_check',check_payload,'terrain_check',CASE WHEN rough_ground_run THEN check_payload END);
END $$;
REVOKE ALL ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) TO authenticated;

-- A one-legged BattleMech may make its single +5 stand attempt. A destroyed
-- gyro or two destroyed legs still make standing impossible.
CREATE OR REPLACE FUNCTION public.attempt_stand_battlemech(p_game_id uuid,p_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;mobility jsonb;resolved jsonb;check_result jsonb;fall_result jsonb;passed boolean;movement_cost int;movement_mode text;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=st->'mech_instances';SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR NOT coalesce((mech->>'prone')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Choose one of your conscious prone BattleMechs that has not moved';END IF;
 mobility:=btech_critical_movement_profile(g.catalogue_version,mech);
 IF coalesce((mobility->>'destroyed_legs')::int,0)>=2 THEN RAISE EXCEPTION 'A BattleMech with both legs destroyed cannot stand';END IF;
 IF coalesce((mobility->>'gyro_destroyed')::boolean,false) THEN RAISE EXCEPTION 'A BattleMech with a destroyed gyro cannot stand';END IF;
 movement_cost:=CASE WHEN coalesce((mobility->>'destroyed_legs')::int,0)=1 THEN 1 ELSE 2 END;movement_mode:=CASE WHEN movement_cost=1 THEN 'run' ELSE 'stand' END;
 mech:=jsonb_set(mech,'{prone}','false'::jsonb,true);resolved:=btech_resolve_displacement_psr(g.catalogue_version,mech,'attempting to stand',0);check_result:=resolved->'check';passed:=coalesce((check_result->>'passed')::boolean,false);mech:=resolved->'mech';fall_result:=check_result->'fall';
 IF NOT passed THEN mech:=jsonb_set(mech,'{prone}','true'::jsonb,true);END IF;
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);mech:=jsonb_set(mech,'{movementMode}',to_jsonb(movement_mode),true);mech:=jsonb_set(mech,'{mpUsed}',to_jsonb(movement_cost),true);mech:=jsonb_set(mech,'{hexesMoved}','0'::jsonb,true);mech:=jsonb_set(mech,'{movementHeat}',to_jsonb(CASE WHEN movement_mode='run' THEN 2 ELSE 0 END),true);mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+CASE WHEN movement_mode='run' THEN 2 ELSE 0 END+coalesce((mech->>'weaponHeat')::int,0)+coalesce((mech->>'externalHeat')::int,0)),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 result:=jsonb_build_object('instance_id',p_instance_id,'passed',passed,'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target','damage_modifier',check_result->'damage_modifier'),'movement_points_spent',movement_cost,'movement_mode',movement_mode,'fall',fall_result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attempt_stand_battlemech(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attempt_stand_battlemech(uuid,text) TO authenticated;

-- Resolve end-of-phase stability from the phase-start snapshot. This catches
-- component hits from direct fire, missile groups, physical weapons, Charge,
-- DFA, ammunition explosions and transferred damage without depending on the
-- shape of a particular attack result.
CREATE OR REPLACE FUNCTION public.btech_resolve_phase_critical_piloting(
 p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb,p_phase text,p_snapshot_key text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;event_row record;attack jsonb;candidate jsonb;unit_id text;unit_mech jsonb;start_mech jsonb;
 current_damage jsonb;start_damage jsonb;pending jsonb:='{}'::jsonb;reasons jsonb;damage_taken int;event_modifier int;automatic_fall boolean;
 resolved jsonb;raw_check jsonb;fall_result jsonb;checks jsonb:='[]'::jsonb;units jsonb;check_payload jsonb;attack_damage int;
BEGIN
 -- Preserve the established kick and 20-point damage triggers.
 FOR event_row IN SELECT event.attacker_instance_id,event.target_instance_id,event.resolution FROM btech_combat_events event
  WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase=p_phase AND event.status='resolved' ORDER BY event.sequence LOOP
  FOR attack IN SELECT value FROM jsonb_array_elements(coalesce(event_row.resolution->'results','[]'::jsonb)) LOOP
   IF p_phase='physical_attack' AND attack->>'attack_type'='kick' AND NOT coalesce((attack->>'target_prone')::boolean,false) THEN
    unit_id:=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN event_row.target_instance_id ELSE event_row.attacker_instance_id END;
    candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[],"modifier":0}'::jsonb);
    reasons:=candidate->'reasons';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(reasons) value WHERE value=CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN 'successful kick' ELSE 'missed kick' END) THEN
     reasons:=reasons||to_jsonb(CASE WHEN coalesce((attack->>'hit')::boolean,false) THEN 'successful kick' ELSE 'missed kick' END);
    END IF;
    candidate:=jsonb_set(candidate,'{reasons}',reasons,true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   END IF;
   IF coalesce((attack->>'hit')::boolean,false) AND coalesce(attack->>'attack_type','standard') NOT IN ('death_from_above','charge_attack','push_attack') THEN
    attack_damage:=coalesce((attack->>'damage')::int,0);
    IF attack ? 'groups' THEN SELECT coalesce(sum(coalesce((value->>'damage')::int,0)),0)::int INTO attack_damage FROM jsonb_array_elements(coalesce(attack->'groups','[]'::jsonb)) value;END IF;
    unit_id:=event_row.target_instance_id;candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[],"modifier":0}'::jsonb);
    candidate:=jsonb_set(candidate,'{damage}',to_jsonb(coalesce((candidate->>'damage')::int,0)+attack_damage),true);pending:=jsonb_set(pending,ARRAY[unit_id],candidate,true);
   END IF;
  END LOOP;
 END LOOP;

 FOR unit_mech IN SELECT value FROM jsonb_array_elements(st->'mech_instances') value LOOP
  unit_id:=unit_mech->>'instanceId';start_mech:=unit_mech->p_snapshot_key->'mech';IF start_mech IS NULL THEN CONTINUE;END IF;
  current_damage:=btech_critical_mobility_state(p_catalogue_version,unit_mech);start_damage:=btech_critical_mobility_state(p_catalogue_version,start_mech);
  candidate:=coalesce(pending->unit_id,'{"damage":0,"reasons":[],"modifier":0}'::jsonb);reasons:=candidate->'reasons';event_modifier:=coalesce((candidate->>'modifier')::int,0);automatic_fall:=false;
  damage_taken:=coalesce((candidate->>'damage')::int,0);
  IF damage_taken>=20 THEN reasons:=reasons||jsonb_build_array('20+ damage in one phase');event_modifier:=event_modifier+1;END IF;
  IF coalesce((current_damage->>'destroyed_legs')::int,0)>coalesce((start_damage->>'destroyed_legs')::int,0) THEN reasons:=reasons||jsonb_build_array('leg destroyed');automatic_fall:=true;END IF;
  IF coalesce((current_damage->>'gyro_destroyed')::boolean,false) AND NOT coalesce((start_damage->>'gyro_destroyed')::boolean,false) THEN reasons:=reasons||jsonb_build_array('gyro destroyed');automatic_fall:=true;
  ELSIF coalesce((current_damage->>'gyro_hits')::int,0)>coalesce((start_damage->>'gyro_hits')::int,0) THEN reasons:=reasons||jsonb_build_array('gyro critical hit');END IF;
  IF coalesce((current_damage->>'hip_hits')::int,0)>coalesce((start_damage->>'hip_hits')::int,0) THEN reasons:=reasons||jsonb_build_array('hip actuator critical hit');END IF;
  IF coalesce((current_damage->>'leg_actuator_hits')::int,0)>coalesce((start_damage->>'leg_actuator_hits')::int,0) THEN reasons:=reasons||jsonb_build_array('leg or foot actuator critical hit');END IF;
  SELECT coalesce(jsonb_agg(DISTINCT value),'[]'::jsonb) INTO reasons FROM jsonb_array_elements(reasons) value;
  IF jsonb_array_length(reasons)=0 OR coalesce((unit_mech->>'destroyed')::boolean,false) OR coalesce((unit_mech->>'prone')::boolean,false) THEN CONTINUE;END IF;
  IF automatic_fall THEN
   fall_result:=btech_resolve_complete_fall(p_catalogue_version,unit_mech,0,NULL);unit_mech:=fall_result->'mech';
   check_payload:=jsonb_build_object('instance_id',unit_id,'reasons',reasons,'damage_taken',damage_taken,'automatic',true,'to_hit',jsonb_build_object('die_a',NULL,'die_b',NULL,'total',NULL,'target',NULL,'damage_modifier',current_damage->'piloting_modifier','situational_modifier',event_modifier),'passed',false,'fell',true,'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',fall_result->'fall_damage','fall_groups',fall_result->'fall_groups','pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',fall_result->'pilot_checks');
  ELSE
   resolved:=btech_resolve_displacement_psr(p_catalogue_version,unit_mech,array_to_string(ARRAY(SELECT jsonb_array_elements_text(reasons)),', '),event_modifier);unit_mech:=resolved->'mech';raw_check:=resolved->'check';fall_result:=raw_check->'fall';
   check_payload:=jsonb_build_object('instance_id',unit_id,'reasons',reasons,'damage_taken',damage_taken,'automatic',raw_check->'automatic','to_hit',jsonb_build_object('die_a',raw_check->'die_a','die_b',raw_check->'die_b','total',raw_check->'total','target',raw_check->'target','damage_modifier',raw_check->'damage_modifier','situational_modifier',raw_check->'situational_modifier'),'passed',raw_check->'passed','fell',NOT coalesce((raw_check->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb));
  END IF;
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=unit_id THEN unit_mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);checks:=checks||jsonb_build_array(check_payload);
 END LOOP;
 RETURN jsonb_build_object('state',st,'checks',checks);
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_phase_critical_piloting(uuid,text,int,jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_weapon_piloting_checks(p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=public AS $$
 SELECT btech_resolve_phase_critical_piloting(p_game_id,p_catalogue_version,p_round,p_state,'weapon_attack','weaponPhaseStart')
$$;
REVOKE ALL ON FUNCTION public.btech_resolve_weapon_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_physical_piloting_checks(p_game_id uuid,p_catalogue_version text,p_round int,p_state jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=public AS $$
 SELECT btech_resolve_phase_critical_piloting(p_game_id,p_catalogue_version,p_round,p_state,'physical_attack','physicalPhaseStart')
$$;
REVOKE ALL ON FUNCTION public.btech_resolve_physical_piloting_checks(uuid,text,int,jsonb) FROM PUBLIC;
