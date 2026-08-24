-- Advanced BattleMech terrain for the Industrial Crossing map.
-- Adds deep water, solid buildings, rubble, pavement control checks, fire and
-- smoke while retaining every movement/damage consequence installed by SQL 69.

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'ridge-and-ford' THEN CASE WHEN p_code='0703' THEN 'light_woods' WHEN p_code='0903' THEN 'heavy_woods' WHEN p_code IN ('0604','0704','0904','0805') THEN 'rough' WHEN p_code='0804' THEN 'pavement' WHEN p_code IN ('0605','0705') THEN 'shallow_water' WHEN p_code='0905' THEN 'impassable' ELSE 'clear' END
 WHEN 'flatlands-open-terrain' THEN CASE WHEN p_code IN ('0202','0303','0104','0907','1008','1108','0211') THEN 'heavy_woods' WHEN p_code IN ('0102','0302','0103','0203','0204','0906','0908','1007','1009','1109','0111','0311') THEN 'light_woods' ELSE 'clear' END
 WHEN 'desert-hills' THEN CASE WHEN p_code IN ('0600','0601','0602','0603','0705','0706','0707','0708','0709','0809','0810','1308') THEN 'rough' ELSE 'clear' END
 WHEN 'industrial-crossing' THEN CASE
  WHEN p_code IN ('0700','0800','0701','0801','0702','0802','0703','0803','0704','0804','0705','0805','0706','0806','0707','0807','0708','0808','0709','0809','0710','0810','0711','0811') THEN 'pavement'
  WHEN p_code IN ('0305','0405','0505') THEN 'deep_water'
  WHEN p_code IN ('0205','0605') THEN 'shallow_water'
  WHEN p_code IN ('0503','1008') THEN 'rubble'
  WHEN p_code IN ('0603','0903','0608','0908') THEN 'building'
  WHEN p_code='1004' THEN 'fire' WHEN p_code='1104' THEN 'light_smoke' WHEN p_code='1204' THEN 'heavy_smoke'
  ELSE 'clear' END
 ELSE 'clear' END
$$;

-- The existing LOS accumulator is retained as an API name, but now counts all
-- obscuring terrain. Three points, or one intervening building, block LOS.
CREATE OR REPLACE FUNCTION public.btech_intervening_woods(p_map text,ac int,ar int,bc int,br int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;terrain text;points int:=0;guard int:=0;
 dq int[]:=ARRAY[1,1,0,-1,-1,0];dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br);aq:=c-(r-(r&1))/2;nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;
  terrain:=btech_terrain(p_map,lpad(c::text,2,'0')||lpad(r::text,2,'0'));
  points:=points+CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 WHEN 'building' THEN 3 ELSE 0 END;
  guard:=guard+1;
 END LOOP;
 RETURN points;
END $$;

-- A fully submerged unit and a surface unit do not have a supported direct
-- weapon LOS in the current all-BattleMech catalogue.
CREATE OR REPLACE FUNCTION public.btech_elevation_blocks_los(p_map text,ac int,ar int,bc int,br int)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;guard int:=0;
 attacker_elevation int:=btech_elevation(p_map,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'));
 target_elevation int:=btech_elevation(p_map,lpad(bc::text,2,'0')||lpad(br::text,2,'0'));
 dq int[]:=ARRAY[1,1,0,-1,-1,0];dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 IF btech_terrain(p_map,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'))='deep_water'
    OR btech_terrain(p_map,lpad(bc::text,2,'0')||lpad(br::text,2,'0'))='deep_water' THEN RETURN true;END IF;
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br);aq:=c-(r-(r&1))/2;nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;
  IF btech_elevation(p_map,lpad(c::text,2,'0')||lpad(r::text,2,'0'))>greatest(attacker_elevation,target_elevation) THEN RETURN true;END IF;
  guard:=guard+1;
 END LOOP;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.submit_battlemech_movement(
 p_game_id uuid,p_instance_id text,p_mode text,p_path jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
 action jsonb;action_type text;next_col int;next_row int;direction int;terrain_name text;terrain_cost int;
 current_col int;current_row int;current_facing int;current_level int;next_level int;mp_used int:=0;hexes_moved int:=0;mp_max int:=0;heat_penalty int;
 movement_heat int;path_length int;mobility jsonb;water_entry boolean:=false;rubble_entry boolean:=false;pavement_turn boolean:=false;critical_check boolean:=false;
 fire_hexes int:=0;terrain_heat int:=0;turning boolean:=false;reasons text[]:=ARRAY[]::text[];resolved jsonb;raw_check jsonb;fall_result jsonb;check_payload jsonb:=NULL;
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
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) OR coalesce((mech->>'shutdown')::boolean,false) OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Choose one of your eligible BattleMechs that has not moved';END IF;
 IF coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'A prone BattleMech must use the stand-up resolver';END IF;
 mobility:=btech_critical_movement_profile(g.catalogue_version,mech);
 IF coalesce((mobility->>'destroyed_legs')::int,0)>=2 THEN RAISE EXCEPTION 'A BattleMech with both legs destroyed cannot move';END IF;
 IF coalesce((mobility->>'gyro_destroyed')::boolean,false) THEN RAISE EXCEPTION 'A destroyed gyro prevents this BattleMech moving';END IF;
 IF p_mode='stand' THEN IF path_length<>0 THEN RAISE EXCEPTION 'Standing still cannot include a movement path';END IF;
 ELSE heat_penalty:=CASE WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((mech->>'roundStartingHeat')::int,coalesce((mech->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;mp_max:=greatest(0,coalesce((mobility->>p_mode)::int,0)-heat_penalty);IF mp_max<=0 THEN RAISE EXCEPTION 'Critical damage and heat leave no % movement points available',p_mode;END IF;IF path_length=0 THEN RAISE EXCEPTION 'A movement path is required';END IF;END IF;
 current_col:=(mech->>'col')::int;current_row:=(mech->>'row')::int;current_facing:=coalesce((mech->>'facing')::int,0);current_level:=btech_battlemech_level(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'));
 IF p_mode='jump' AND btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'))='deep_water' THEN RAISE EXCEPTION 'A submerged BattleMech cannot use its jump jets';
 ELSIF p_mode='jump' AND btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'))='shallow_water' THEN mp_max:=greatest(0,mp_max-btech_submerged_leg_jump_jets(g.catalogue_version,mech));IF mp_max=0 THEN RAISE EXCEPTION 'No torso jump jets remain available above the water';END IF;END IF;
 FOR action IN SELECT value FROM jsonb_array_elements(p_path) value LOOP
  action_type:=action->>'action';
  IF action_type='turn' THEN
   IF p_mode='jump' OR action->>'direction' NOT IN ('left','right') THEN RAISE EXCEPTION 'Invalid facing change';END IF;
   IF p_mode='run' AND btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'))='pavement' THEN pavement_turn:=true;END IF;
   mp_used:=mp_used+1;current_facing:=(current_facing+CASE action->>'direction' WHEN 'left' THEN 1 ELSE -1 END+6)%6;
  ELSIF action_type='step' THEN
   IF p_mode='jump' THEN RAISE EXCEPTION 'Jump movement must use a jump landing';END IF;
   next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 OR btech_hex_distance(current_col,current_row,next_col,next_row)<>1 THEN RAISE EXCEPTION 'Each walking or running step must enter an adjacent map hex';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot enter an occupied hex';END IF;
   direction:=btech_direction_to(current_col,current_row,next_col,next_row);IF direction=(current_facing+3)%6 AND p_mode<>'walk' THEN RAISE EXCEPTION 'A running BattleMech cannot move backward';END IF;turning:=direction<>current_facing AND direction<>(current_facing+3)%6;
   terrain_name:=btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'));
   IF terrain_name IN ('impassable','building') THEN RAISE EXCEPTION 'That terrain is impassable';END IF;
   next_level:=btech_battlemech_level(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0'));
   IF abs(next_level-current_level)>2 THEN RAISE EXCEPTION 'A BattleMech cannot cross a level change greater than two';END IF;IF direction=(current_facing+3)%6 AND next_level<>current_level THEN RAISE EXCEPTION 'A BattleMech cannot change levels while moving backward';END IF;IF p_mode='run' AND terrain_name IN ('shallow_water','deep_water') THEN RAISE EXCEPTION 'A running BattleMech cannot enter water';END IF;
   terrain_cost:=btech_battlemech_terrain_cost(terrain_name)+abs(next_level-current_level);
   IF terrain_name IN ('shallow_water','deep_water') THEN water_entry:=true;END IF;IF terrain_name='rubble' THEN rubble_entry:=true;END IF;IF terrain_name='fire' THEN fire_hexes:=fire_hexes+1;END IF;
   IF p_mode='run' AND turning AND (terrain_name='pavement' OR btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'))='pavement') THEN pavement_turn:=true;END IF;
   mp_used:=mp_used+CASE WHEN direction=current_facing OR direction=(current_facing+3)%6 THEN 1 ELSE least(abs(direction-current_facing),6-abs(direction-current_facing))+1 END+terrain_cost;
   IF direction<>(current_facing+3)%6 THEN current_facing:=direction;END IF;current_col:=next_col;current_row:=next_row;current_level:=next_level;hexes_moved:=hexes_moved+1;
  ELSIF action_type='jump' THEN
   IF p_mode<>'jump' OR path_length<>1 THEN RAISE EXCEPTION 'A jump must be one direct landing';END IF;next_col:=(action->>'col')::int;next_row:=(action->>'row')::int;
   IF next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11 THEN RAISE EXCEPTION 'Jump landing is outside the map';END IF;
   IF btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(next_col::text,2,'0')||lpad(next_row::text,2,'0')) IN ('impassable','building') THEN RAISE EXCEPTION 'That terrain cannot be used as a jump landing';END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(before_units) unit WHERE unit->>'instanceId'<>p_instance_id AND (unit->>'col')::int=next_col AND (unit->>'row')::int=next_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'A BattleMech cannot land in an occupied hex';END IF;
   mp_used:=btech_hex_distance(current_col,current_row,next_col,next_row);hexes_moved:=mp_used;IF action ? 'facing' THEN IF action->>'facing' !~ '^[0-5]$' THEN RAISE EXCEPTION 'Jump landing facing must be between 0 and 5';END IF;current_facing:=(action->>'facing')::int;ELSE current_facing:=btech_direction_to(current_col,current_row,next_col,next_row);END IF;current_col:=next_col;current_row:=next_row;
  ELSE RAISE EXCEPTION 'Invalid movement action';END IF;
  IF mp_used>mp_max THEN RAISE EXCEPTION 'Movement path exceeds the available % movement points',p_mode;END IF;
 END LOOP;
 movement_heat:=CASE p_mode WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN greatest(3,hexes_moved) ELSE 0 END;terrain_heat:=fire_hexes*2;
 mech:=jsonb_set(mech,'{col}',to_jsonb(current_col),true);mech:=jsonb_set(mech,'{row}',to_jsonb(current_row),true);mech:=jsonb_set(mech,'{facing}',to_jsonb(current_facing),true);mech:=jsonb_set(mech,'{torsoFacing}',to_jsonb(current_facing),true);mech:=jsonb_set(mech,'{movementMode}',to_jsonb(p_mode),true);mech:=jsonb_set(mech,'{mpUsed}',to_jsonb(mp_used),true);mech:=jsonb_set(mech,'{hexesMoved}',to_jsonb(hexes_moved),true);mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);mech:=jsonb_set(mech,'{movementHeat}',to_jsonb(movement_heat),true);
 mech:=jsonb_set(mech,'{externalHeat}',to_jsonb(coalesce((mech->>'externalHeat')::int,0)+terrain_heat),true);mech:=jsonb_set(mech,'{pendingTerrainHeat}',to_jsonb(CASE WHEN btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(current_col::text,2,'0')||lpad(current_row::text,2,'0'))='fire' THEN 5 ELSE 0 END),true);mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+movement_heat+coalesce((mech->>'weaponHeat')::int,0)+coalesce((mech->>'externalHeat')::int,0)),true);
 critical_check:=(p_mode='run' AND (coalesce((mobility->>'hip_hits')::int,0)>0 OR coalesce((mobility->>'gyro_hits')::int,0)>0)) OR (p_mode='jump' AND (coalesce((mobility->>'hip_hits')::int,0)>0 OR coalesce((mobility->>'leg_actuator_hits')::int,0)>0 OR coalesce((mobility->>'gyro_hits')::int,0)>0 OR coalesce((mobility->>'destroyed_legs')::int,0)>0));
 IF water_entry THEN reasons:=array_append(reasons,'entering water');END IF;IF rubble_entry THEN reasons:=array_append(reasons,'entering rubble');END IF;IF pavement_turn THEN reasons:=array_append(reasons,'running turn on pavement');END IF;IF critical_check THEN reasons:=array_append(reasons,CASE WHEN p_mode='run' THEN 'running with damaged hip or gyro' ELSE 'jump landing with gyro or leg damage' END);END IF;
 IF array_length(reasons,1)>0 THEN resolved:=btech_resolve_displacement_psr(g.catalogue_version,mech,array_to_string(reasons,', '),0);mech:=resolved->'mech';raw_check:=resolved->'check';fall_result:=raw_check->'fall';check_payload:=jsonb_build_object('instance_id',p_instance_id,'reasons',to_jsonb(reasons),'to_hit',jsonb_build_object('die_a',raw_check->'die_a','die_b',raw_check->'die_b','total',raw_check->'total','target',raw_check->'target','damage_modifier',raw_check->'damage_modifier'),'automatic',raw_check->'automatic','passed',raw_check->'passed','fell',NOT coalesce((raw_check->>'passed')::boolean,false),'fall_direction_die',fall_result->'fall_direction_die','fall_angle',fall_result->'fall_angle','fall_damage',coalesce(fall_result->'fall_damage','0'::jsonb),'fall_groups',coalesce(fall_result->'fall_groups','[]'::jsonb),'pilot_injury_avoidance',fall_result->'pilot_injury_avoidance','pilot_checks',coalesce(fall_result->'pilot_checks','[]'::jsonb));END IF;
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'mode',p_mode,'col',current_col,'row',current_row,'facing',current_facing,'mp_used',mp_used,'mp_max',mp_max,'hexes_moved',hexes_moved,'movement_heat',movement_heat,'terrain_heat',terrain_heat,'movement_profile',mobility,'movement_piloting_check',check_payload,'terrain_check',CASE WHEN water_entry OR rubble_entry OR pavement_turn THEN check_payload END);
END $$;
REVOKE ALL ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_battlemech_movement(uuid,text,text,jsonb) TO authenticated;

-- Include target-hex smoke/fire in the modifier and improve the shared blocked
-- LOS message. Intervening smoke/buildings are handled by the redefined helper.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_terrain_los_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'WHEN ''heavy_woods'' THEN 2 WHEN ''light_woods'' THEN 1 ELSE 0 END',
  'WHEN ''heavy_woods'' THEN 2 WHEN ''heavy_smoke'' THEN 2 WHEN ''light_woods'' THEN 1 WHEN ''light_smoke'' THEN 1 WHEN ''fire'' THEN 1 ELSE 0 END /* advanced_terrain_los_v1 */');
 patched:=replace(patched,'Line of sight is blocked by an intervening ridge','Line of sight is blocked by terrain or water depth');
 IF patched=source OR position('advanced_terrain_los_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install advanced terrain LOS';END IF;EXECUTE patched;
END $$;

-- Burning terrain occupied at the end of Movement contributes five heat in
-- Heat Management. Transit heat was already added authoritatively above.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_terrain_heat_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5);',
  'before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0); /* advanced_terrain_heat_v1 */');
 patched:=replace(patched,
  'mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);',
  'mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);mech:=jsonb_set(mech,''{pendingTerrainHeat}'',''0''::jsonb,true);mech:=jsonb_set(mech,''{externalHeat}'',''0''::jsonb,true);');
 IF patched=source OR position('advanced_terrain_heat_v1' IN patched)=0 OR position('pendingTerrainHeat' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install burning-terrain heat';END IF;EXECUTE patched;
END $$;
