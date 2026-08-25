-- Total Warfare shutdown recovery and conscious-pilot override support.
-- Run after SQL/51_canonical_special_equipment_resolver.sql.

CREATE OR REPLACE FUNCTION public.declare_shutdown_override(
 p_game_id uuid,p_instance_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
 engine_hits int;heat_sink_loss int;sinks int;after_heat int;target_number int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'heat' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Heat Management activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=st->'mech_instances';
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasManagedHeat')::boolean,false) THEN RAISE EXCEPTION 'Choose one of your BattleMechs awaiting Heat Management';END IF;
 IF coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN RAISE EXCEPTION 'Only a conscious MechWarrior may override an automatic shutdown';END IF;
 SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND slot.label='Fusion Engine' AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
 SELECT coalesce(sum(CASE WHEN btech_equipment_label_key(slot.label)='doubleheatsink' THEN 2 ELSE 1 END),0)::int INTO heat_sink_loss FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND btech_equipment_label_key(slot.label) IN ('heatsink','doubleheatsink') AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
 SELECT greatest(0,coalesce((definition->>'heat_sink_capacity')::int,(definition->>'heat_sinks')::int,0)-heat_sink_loss) INTO sinks FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
 after_heat:=greatest(0,coalesce((mech->>'heat')::int,0)+(engine_hits*5)-coalesce(sinks,0));
 target_number:=CASE WHEN after_heat>=30 THEN 99 WHEN after_heat>=26 THEN 10 WHEN after_heat>=22 THEN 8 WHEN after_heat>=18 THEN 6 WHEN after_heat>=14 THEN 4 ELSE 0 END;
 IF target_number=0 THEN RAISE EXCEPTION 'This BattleMech will restart automatically below Heat Level 14';END IF;
 IF target_number=99 THEN RAISE EXCEPTION 'Automatic shutdown cannot be overridden at Heat Level 30 or higher';END IF;
 mech:=jsonb_set(mech,'{shutdownOverrideRequested}','true'::jsonb,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'target',target_number);
END $$;
REVOKE ALL ON FUNCTION public.declare_shutdown_override(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_shutdown_override(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_heat_management(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb:='[]'::jsonb;
 mech jsonb;processed jsonb;results jsonb:='[]'::jsonb;engine_hits int;sinks int;before_heat int;after_heat int;
 heat_sink_loss int;move_penalty int;gunnery_penalty int;shutdown_target int;shutdown_roll jsonb;shutdown boolean;automatic_restart boolean;override_requested boolean;override_attempted boolean;
 ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'heat' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Heat Management activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=st->'mech_instances';
 FOR mech IN SELECT value FROM jsonb_array_elements(before_units) value LOOP
  IF (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasManagedHeat')::boolean,false) THEN units:=units||jsonb_build_array(mech);CONTINUE;END IF;
  shutdown_roll:=NULL;ammo_roll:=NULL;ammo_result:=NULL;automatic_restart:=false;override_attempted:=false;
  SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND slot.label='Fusion Engine' AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT coalesce(sum(CASE WHEN btech_equipment_label_key(slot.label)='doubleheatsink' THEN 2 ELSE 1 END),0)::int INTO heat_sink_loss FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND btech_equipment_label_key(slot.label) IN ('heatsink','doubleheatsink') AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT greatest(0,coalesce((definition->>'heat_sink_capacity')::int,(definition->>'heat_sinks')::int,0)-heat_sink_loss) INTO sinks FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
  before_heat:=coalesce((mech->>'heat')::int,0)+(engine_hits*5);after_heat:=greatest(0,before_heat-coalesce(sinks,0));
  move_penalty:=CASE WHEN after_heat>=25 THEN 4 WHEN after_heat>=20 THEN 3 WHEN after_heat>=15 THEN 2 WHEN after_heat>=10 THEN 1 ELSE 0 END;
  gunnery_penalty:=CASE WHEN after_heat>=24 THEN 4 WHEN after_heat>=17 THEN 3 WHEN after_heat>=13 THEN 2 WHEN after_heat>=8 THEN 1 ELSE 0 END;
  shutdown_target:=CASE WHEN after_heat>=30 THEN 99 WHEN after_heat>=26 THEN 10 WHEN after_heat>=22 THEN 8 WHEN after_heat>=18 THEN 6 WHEN after_heat>=14 THEN 4 ELSE 0 END;shutdown:=coalesce((mech->>'shutdown')::boolean,false);override_requested:=coalesce((mech->>'shutdownOverrideRequested')::boolean,false);
  IF shutdown AND shutdown_target=0 THEN shutdown:=false;automatic_restart:=true;
  ELSIF NOT shutdown AND shutdown_target=99 THEN shutdown:=true;
  ELSIF NOT shutdown AND shutdown_target>0 THEN
   override_attempted:=override_requested AND coalesce(mech->'pilot'->>'consciousness','conscious')='conscious';
   IF override_attempted THEN shutdown_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));shutdown_roll:=jsonb_set(shutdown_roll,'{total}',to_jsonb((shutdown_roll->>'die_a')::int+(shutdown_roll->>'die_b')::int),true);shutdown:=coalesce((shutdown_roll->>'total')::int,0)<shutdown_target;ELSE shutdown:=true;END IF;
  END IF;
  ammo_target:=CASE WHEN after_heat>=28 THEN 8 WHEN after_heat>=23 THEN 6 WHEN after_heat>=19 THEN 4 ELSE 0 END;
  IF ammo_target>0 THEN
   ammo_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));ammo_roll:=jsonb_set(ammo_roll,'{total}',to_jsonb((ammo_roll->>'die_a')::int+(ammo_roll->>'die_b')::int),true);
   IF coalesce((ammo_roll->>'total')::int,0)<ammo_target THEN
    SELECT value,ordinality INTO bin,bin_pos FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY WHERE coalesce((value->>'shots')::int,0)>0 AND value->>'type'<>'gauss' AND NOT coalesce((value->>'destroyed')::boolean,false) ORDER BY random() LIMIT 1;
    IF FOUND THEN
     ammo_type:=bin->>'type';ammo_damage:=btech_ammo_damage_per_shot(ammo_type);bin_location:=CASE lower(replace(bin->>'location',' ','')) WHEN 'leftarm' THEN 'la' WHEN 'rightarm' THEN 'ra' WHEN 'lefttorso' THEN 'lt' WHEN 'righttorso' THEN 'rt' WHEN 'centertorso' THEN 'ct' WHEN 'leftleg' THEN 'll' WHEN 'rightleg' THEN 'rl' ELSE coalesce(nullif(split_part(bin->>'id',':',1),''),'ct') END;
     processed:=jsonb_set(mech,ARRAY['ammoBins',(bin_pos-1)::text,'shots'],'0'::jsonb,true);processed:=jsonb_set(processed,ARRAY['ammoBins',(bin_pos-1)::text,'destroyed'],'true'::jsonb,true);
     IF ammo_damage>0 THEN processed:=btech_apply_internal_damage(processed,bin_location,coalesce((bin->>'shots')::int,0)*ammo_damage);END IF;mech:=processed;
     ammo_result:=jsonb_build_object('bin_id',bin->>'id','type',ammo_type,'location',bin_location,'shots',(bin->>'shots')::int,'damage',(bin->>'shots')::int*ammo_damage);
    END IF;
   END IF;
  END IF;
  mech:=jsonb_set(mech,'{heat}',to_jsonb(after_heat),true);mech:=jsonb_set(mech,'{heatDissipated}',to_jsonb(least(before_heat,coalesce(sinks,0))),true);mech:=jsonb_set(mech,'{hasManagedHeat}','true'::jsonb,true);mech:=jsonb_set(mech,'{shutdown}',to_jsonb(shutdown),true);mech:=jsonb_set(mech,'{shutdownOverrideRequested}','false'::jsonb,true);mech:=jsonb_set(mech,'{heatEffects}',jsonb_build_object('movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'ammo_target',ammo_target),true);
  units:=units||jsonb_build_array(mech);results:=results||jsonb_build_array(jsonb_build_object('instance_id',mech->>'instanceId','before',before_heat,'sinks',coalesce(sinks,0),'after',after_heat,'engine_heat',engine_hits*5,'movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'shutdown_roll',shutdown_roll,'shutdown',shutdown,'automatic_restart',automatic_restart,'override_requested',override_requested,'override_attempted',override_attempted,'ammo_target',ammo_target,'ammo_roll',ammo_roll,'ammo_explosion',ammo_result));
 END LOOP;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);RETURN jsonb_build_object('results',results);
END $$;
REVOKE ALL ON FUNCTION public.resolve_heat_management(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_heat_management(uuid) TO authenticated;
