-- Repairs two legacy resolver hazards exposed by live games:
-- an unqualified DFA catalogue column and the special-ammunition helper that
-- can be absent after an interrupted/older SQL 93 install.

CREATE OR REPLACE FUNCTION public.btech_apply_special_ammo_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean,p_load_type text,p_weapon_key text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE result jsonb;armor_key text:=CASE WHEN p_rear AND p_location IN ('ct','lt','rt') THEN p_location||'_rear' ELSE p_location END;armor_before int:=coalesce((p_mech->'armor'->>armor_key)::int,0);critical_roll int;critical_result jsonb;modifier int;
BEGIN
 IF p_load_type='fragmentation' THEN RETURN jsonb_build_object('mech',p_mech,'critical_checks','[]'::jsonb);END IF;
 result:=btech_apply_weapon_damage(p_mech,p_damage,p_location,p_rear);
 IF p_load_type='armor_piercing' AND armor_before>=p_damage THEN
  modifier:=CASE p_weapon_key WHEN 'ac20' THEN -1 WHEN 'ac10' THEN -2 WHEN 'ac5' THEN -3 ELSE -4 END;
  critical_roll:=floor(random()*6+1)+floor(random()*6+1)+modifier;
  IF critical_roll>=8 THEN
   critical_result:=btech_resolve_critical_slots(result->'mech',p_location,least(12,critical_roll));
   result:=jsonb_set(result,'{mech}',critical_result->'mech',true);
   result:=jsonb_set(result,'{armor_piercing_critical}',jsonb_build_object('roll',critical_roll,'modifier',modifier,'events',critical_result->'events'),true);
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_special_ammo_damage(jsonb,int,text,boolean,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.declare_death_from_above(
 p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_staging_col int,p_staging_row int,p_staging_facing int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;units jsonb;attacker jsonb;target jsonb;
 unit_definition jsonb;mp_max int;heat_penalty int;target_distance int;staging_distance int;heat int;source_level int;target_level int;height_required int;
BEGIN
 IF p_staging_col NOT BETWEEN 0 AND 15 OR p_staging_row NOT BETWEEN 0 AND 11 OR p_staging_facing NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'DFA staging position is outside the battlefield';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;
 IF attacker IS NULL OR (attacker->>'owner')::int<>player.seat_number OR coalesce((attacker->>'hasMoved')::boolean,false) OR coalesce((attacker->>'destroyed')::boolean,false) OR coalesce((attacker->>'prone')::boolean,false) OR coalesce((attacker->>'shutdown')::boolean,false) OR coalesce(attacker->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Attacker is not eligible to declare Death From Above';END IF;
 IF target IS NULL OR (target->>'owner')::int=(attacker->>'owner')::int OR NOT coalesce((target->>'hasMoved')::boolean,false) OR coalesce((target->>'destroyed')::boolean,false) OR target ? 'dfaDeclaration' THEN RAISE EXCEPTION 'Choose an enemy that has completed movement and is not already committed to a special attack';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(st->'mech_instances') unit WHERE unit->>'instanceId'<>p_attacker_instance_id AND (unit->>'col')::int=p_staging_col AND (unit->>'row')::int=p_staging_row AND NOT coalesce((unit->>'destroyed')::boolean,false)) THEN RAISE EXCEPTION 'DFA staging hex is occupied';END IF;
 IF btech_hex_distance(p_staging_col,p_staging_row,(target->>'col')::int,(target->>'row')::int)<>1 THEN RAISE EXCEPTION 'DFA staging hex must be one hex short of the target';END IF;
 SELECT cu.definition INTO unit_definition FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=attacker->>'unitId';
 IF unit_definition IS NULL THEN RAISE EXCEPTION 'BattleMech is missing from the pinned catalogue';END IF;
 heat_penalty:=CASE WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=25 THEN 4 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=20 THEN 3 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=15 THEN 2 WHEN coalesce((attacker->>'roundStartingHeat')::int,coalesce((attacker->>'heat')::int,0))>=10 THEN 1 ELSE 0 END;
 mp_max:=greatest(0,coalesce((unit_definition->'movement'->>'jump')::int,0)-heat_penalty);target_distance:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);staging_distance:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,p_staging_col,p_staging_row);
 source_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(attacker->>'col',2,'0')||lpad(attacker->>'row',2,'0'));target_level:=btech_elevation(coalesce(st->>'map_id','training-grounds'),lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0'));height_required:=greatest(0,target_level+CASE WHEN coalesce((target->>'prone')::boolean,false) THEN 1 ELSE 2 END-source_level);
 IF btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0'))='impassable' THEN RAISE EXCEPTION 'The target hex is prohibited terrain for a DFA landing';END IF;
 IF mp_max<=0 OR target_distance>mp_max OR height_required>mp_max THEN RAISE EXCEPTION 'This BattleMech lacks the Jumping MP to enter and clear the target hex';END IF;
 heat:=coalesce((attacker->>'roundStartingHeat')::int,0)+3+coalesce((attacker->>'weaponHeat')::int,0)+coalesce((attacker->>'externalHeat')::int,0);
 attacker:=jsonb_set(attacker,'{col}',to_jsonb(p_staging_col),true);attacker:=jsonb_set(attacker,'{row}',to_jsonb(p_staging_row),true);attacker:=jsonb_set(attacker,'{facing}',to_jsonb(p_staging_facing),true);attacker:=jsonb_set(attacker,'{torsoFacing}',to_jsonb(p_staging_facing),true);
 attacker:=jsonb_set(attacker,'{movementMode}','"jump"'::jsonb,true);attacker:=jsonb_set(attacker,'{mpUsed}',to_jsonb(target_distance),true);attacker:=jsonb_set(attacker,'{hexesMoved}',to_jsonb(staging_distance),true);attacker:=jsonb_set(attacker,'{hasMoved}','true'::jsonb,true);attacker:=jsonb_set(attacker,'{movementHeat}','3'::jsonb,true);attacker:=jsonb_set(attacker,'{heat}',to_jsonb(heat),true);
 attacker:=jsonb_set(attacker,'{dfaDeclaration}',jsonb_build_object('target_instance_id',p_target_instance_id,'target_col',(target->>'col')::int,'target_row',(target->>'row')::int,'staging_col',p_staging_col,'staging_row',p_staging_row,'staging_facing',p_staging_facing,'target_mp',target_distance),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('status','declared','attacker_instance_id',p_attacker_instance_id,'target_instance_id',p_target_instance_id,'target_mp',target_distance,'staging_hex',lpad(p_staging_col::text,2,'0')||lpad(p_staging_row::text,2,'0'));
END $$;
REVOKE ALL ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_death_from_above(uuid,text,text,int,int,int) TO authenticated;

NOTIFY pgrst,'reload schema';
