-- Server-authoritative human-v-human BattleMech movement.
-- Run after SQL/30_prone_weapon_fire.sql.

CREATE OR REPLACE FUNCTION public.submit_battlemech_movement(
 p_game_id uuid,p_instance_id text,p_mode text,p_path jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
 unit_definition jsonb;action jsonb;action_type text;next_col int;next_row int;direction int;terrain_cost int;
 current_col int;current_row int;current_facing int;mp_used int:=0;hexes_moved int:=0;mp_max int;heat_penalty int;
 movement_heat int;activation jsonb;phase_complete boolean;next_player uuid;gyro_hits int;path_length int;
BEGIN
 IF p_mode NOT IN ('stand','walk','run','jump') THEN RAISE EXCEPTION 'Choose stand, walk, run, or jump';END IF;
 IF jsonb_typeof(p_path)<>'array' THEN RAISE EXCEPTION 'Movement path must be an array';END IF;
 path_length:=jsonb_array_length(p_path);
 IF path_length>40 THEN RAISE EXCEPTION 'Movement path is too long';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN
  RAISE EXCEPTION 'It is not your Movement activation';
 END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=coalesce(st->'mech_instances','[]'::jsonb);
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false)
  OR coalesce((mech->>'hasMoved')::boolean,false) OR coalesce((mech->>'shutdown')::boolean,false)
  OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN
  RAISE EXCEPTION 'Choose one of your eligible BattleMechs that has not moved';
 END IF;
 IF coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'A prone BattleMech must use the stand-up resolver';END IF;
 IF coalesce((mech->'structure'->>'ll')::int,0)<=0 OR coalesce((mech->'structure'->>'rl')::int,0)<=0 THEN RAISE EXCEPTION 'A destroyed leg prevents this BattleMech moving';END IF;
 SELECT definition INTO unit_definition FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
 IF unit_definition IS NULL THEN RAISE EXCEPTION 'BattleMech is missing from the pinned catalogue';END IF;
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
   AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
 IF gyro_hits>=2 THEN RAISE EXCEPTION 'A destroyed gyro prevents this BattleMech moving';END IF;

 IF p_mode='stand' THEN
  IF path_length<>0 THEN RAISE EXCEPTION 'Standing still cannot include a movement path';END IF;
 ELSE
  heat_penalty:=CASE WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;
  mp_max:=greatest(0,coalesce((unit_definition->'movement'->>p_mode)::int,0)-heat_penalty);
  IF mp_max<=0 THEN RAISE EXCEPTION 'This BattleMech has no % movement points available',p_mode;END IF;
  IF path_length=0 THEN RAISE EXCEPTION 'A movement path is required';END IF;
 END IF;

 current_col:=(mech->>'col')::int;current_row:=(mech->>'row')::int;current_facing:=coalesce((mech->>'facing')::int,0);
 FOR action IN SELECT value FROM jsonb_array_elements(p_path) value LOOP
  action_type:=action->>'action';
  IF action_type='turn' THEN
   IF p_mode='jump' OR action->>'direction' NOT IN ('left','right') THEN RAISE EXCEPTION 'Invalid facing change';END IF;
   mp_used:=mp_used+1;
   current_facing:=(current_facing+CASE action->>'direction' WHEN 'left' THEN 1 ELSE -1 END+6)%6;
  ELSIF action_type='step' THEN
   IF p_mode='jump' THEN RAISE EXCEPTION 'Jump movement must use a jump landing';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 OR btech_hex_distance(current_col,current_row,next_col,next_row)<>1 THEN RAISE EXCEPTION 'Each walking or running step must enter an adjacent map hex';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot enter an occupied hex';END IF;
   direction:=btech_direction_to(current_col,current_row,next_col,next_row);
   IF direction=(current_facing+3)%6 AND p_mode<>'walk' THEN RAISE EXCEPTION 'A running BattleMech cannot move backward';END IF;
   terrain_cost:=CASE btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0')) WHEN 'light_woods' THEN 1 WHEN 'heavy_woods' THEN 2 ELSE 0 END;
   mp_used:=mp_used+CASE WHEN direction=current_facing OR direction=(current_facing+3)%6 THEN 1 ELSE least(abs(direction-current_facing),6-abs(direction-current_facing))+1 END+terrain_cost;
   IF direction<>(current_facing+3)%6 THEN current_facing:=direction;END IF;
   current_col:=next_col;current_row:=next_row;hexes_moved:=hexes_moved+1;
  ELSIF action_type='jump' THEN
   IF p_mode<>'jump' OR path_length<>1 THEN RAISE EXCEPTION 'A jump must be one direct landing';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 THEN RAISE EXCEPTION 'Jump landing is outside the map';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot land in an occupied hex';END IF;
   mp_used:=btech_hex_distance(current_col,current_row,next_col,next_row);hexes_moved:=mp_used;
   current_facing:=btech_direction_to(current_col,current_row,next_col,next_row);current_col:=next_col;current_row:=next_row;
  ELSE RAISE EXCEPTION 'Invalid movement action';END IF;
  IF mp_used>mp_max THEN RAISE EXCEPTION 'Movement path exceeds the available % movement points',p_mode;END IF;
 END LOOP;

 movement_heat:=CASE p_mode WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 mech:=jsonb_set(mech,'{col}',to_jsonb(current_col),true);mech:=jsonb_set(mech,'{row}',to_jsonb(current_row),true);
 mech:=jsonb_set(mech,'{facing}',to_jsonb(current_facing),true);mech:=jsonb_set(mech,'{torsoFacing}',to_jsonb(current_facing),true);
 mech:=jsonb_set(mech,'{movementMode}',to_jsonb(p_mode),true);mech:=jsonb_set(mech,'{mpUsed}',to_jsonb(mp_used),true);mech:=jsonb_set(mech,'{hexesMoved}',to_jsonb(hexes_moved),true);
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);mech:=jsonb_set(mech,'{movementHeat}',to_jsonb(movement_heat),true);
 mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+movement_heat+coalesce((mech->>'weaponHeat')::int,0)),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'mode',p_mode,'col',current_col,'row',current_row,'facing',current_facing,'mp_used',mp_used,'mp_max',coalesce(mp_max,0),'hexes_moved',hexes_moved,'movement_heat',movement_heat);
END $$;
REVOKE ALL ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) TO authenticated;

-- Normal human movement may no longer post an arbitrary unit snapshot.
CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid,p_mech_instances jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE phase_name text;
BEGIN
 SELECT current_phase INTO phase_name FROM btech_games WHERE id=p_game_id;
 IF phase_name='movement' THEN RAISE EXCEPTION 'Movement must use the authoritative movement resolver';END IF;
 IF phase_name='physical_attack' THEN RAISE EXCEPTION 'Physical Attacks must use the authoritative declaration resolver';END IF;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,p_mech_instances);
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;
