-- Server-authoritative Heat Management: sinks, heat scale, shutdowns and
-- heat-triggered ammunition explosions. Run after SQL/26_authoritative_standing.sql.

CREATE OR REPLACE FUNCTION public.resolve_heat_management(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb:='[]'::jsonb;
 mech jsonb;processed jsonb;result jsonb;results jsonb:='[]'::jsonb;engine_hits int;sinks int;before_heat int;after_heat int;
 heat_sink_loss int;move_penalty int;gunnery_penalty int;shutdown_target int;shutdown_roll jsonb:=NULL;shutdown boolean;
 ammo_target int;ammo_roll jsonb:=NULL;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb:=NULL;bin_location text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'heat' OR g.active_player_id IS DISTINCT FROM player.id THEN
  RAISE EXCEPTION 'It is not your Heat Management activation';
 END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=st->'mech_instances';
 FOR mech IN SELECT value FROM jsonb_array_elements(before_units) value LOOP
  IF (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasManagedHeat')::boolean,false) THEN
   units:=units||jsonb_build_array(mech);CONTINUE;
  END IF;
  SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId'
    AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Fusion Engine'
    AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT coalesce(sum(CASE WHEN slot.label='Double Heat Sink' THEN 2 ELSE 1 END),0)::int INTO heat_sink_loss
   FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId'
    AND slot.label IN ('Heat Sink','Double Heat Sink')
    AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT greatest(0,coalesce((definition->>'heat_sinks')::int,0)-heat_sink_loss) INTO sinks
   FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
  before_heat:=coalesce((mech->>'heat')::int,0)+(engine_hits*5);
  after_heat:=greatest(0,before_heat-coalesce(sinks,0));
  move_penalty:=CASE WHEN after_heat>=25 THEN 4 WHEN after_heat>=20 THEN 3 WHEN after_heat>=15 THEN 2 WHEN after_heat>=10 THEN 1 ELSE 0 END;
  gunnery_penalty:=CASE WHEN after_heat>=24 THEN 4 WHEN after_heat>=17 THEN 3 WHEN after_heat>=13 THEN 2 WHEN after_heat>=8 THEN 1 ELSE 0 END;
  shutdown_target:=CASE WHEN after_heat>=30 THEN 99 WHEN after_heat>=26 THEN 10 WHEN after_heat>=22 THEN 8 WHEN after_heat>=18 THEN 6 WHEN after_heat>=14 THEN 4 ELSE 0 END;
  shutdown:=coalesce((mech->>'shutdown')::boolean,false);
  IF NOT shutdown AND shutdown_target=99 THEN shutdown:=true;
  ELSIF NOT shutdown AND shutdown_target>0 THEN
   shutdown_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));
   shutdown_roll:=jsonb_set(shutdown_roll,'{total}',to_jsonb((shutdown_roll->>'die_a')::int+(shutdown_roll->>'die_b')::int),true);
   shutdown:=coalesce((shutdown_roll->>'total')::int,0)<shutdown_target;
  END IF;
  ammo_target:=CASE WHEN after_heat>=28 THEN 8 WHEN after_heat>=23 THEN 6 WHEN after_heat>=19 THEN 4 ELSE 0 END;
  IF ammo_target>0 THEN
   ammo_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));
   ammo_roll:=jsonb_set(ammo_roll,'{total}',to_jsonb((ammo_roll->>'die_a')::int+(ammo_roll->>'die_b')::int),true);
   IF coalesce((ammo_roll->>'total')::int,0)<ammo_target THEN
    SELECT value,ordinality INTO bin,bin_pos FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY
     WHERE coalesce((value->>'shots')::int,0)>0 AND NOT coalesce((value->>'destroyed')::boolean,false) ORDER BY random() LIMIT 1;
    IF FOUND THEN
     ammo_type:=bin->>'type';ammo_damage:=CASE ammo_type WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2 WHEN 'lrm20' THEN 20 WHEN 'lrm10' THEN 10 WHEN 'srm6' THEN 12 WHEN 'machine_gun' THEN 2 ELSE 0 END;
     bin_location:=CASE lower(replace(bin->>'location',' ','')) WHEN 'leftarm' THEN 'la' WHEN 'rightarm' THEN 'ra' WHEN 'lefttorso' THEN 'lt' WHEN 'righttorso' THEN 'rt' WHEN 'centertorso' THEN 'ct' WHEN 'leftleg' THEN 'll' WHEN 'rightleg' THEN 'rl' ELSE 'ct' END;
     processed:=jsonb_set(mech,ARRAY['ammoBins',(bin_pos-1)::text,'shots'],'0'::jsonb,true);
     processed:=jsonb_set(processed,ARRAY['ammoBins',(bin_pos-1)::text,'destroyed'],'true'::jsonb,true);
     processed:=btech_apply_internal_damage(processed,bin_location,coalesce((bin->>'shots')::int,0)*ammo_damage);
     mech:=processed;
     ammo_result:=jsonb_build_object('bin_id',bin->>'id','type',ammo_type,'location',bin_location,'shots',(bin->>'shots')::int,'damage',(bin->>'shots')::int*ammo_damage);
    END IF;
   END IF;
  END IF;
  mech:=jsonb_set(mech,'{heat}',to_jsonb(after_heat),true);
  mech:=jsonb_set(mech,'{heatDissipated}',to_jsonb(least(before_heat,coalesce(sinks,0))),true);
  mech:=jsonb_set(mech,'{hasManagedHeat}','true'::jsonb,true);
  mech:=jsonb_set(mech,'{shutdown}',to_jsonb(shutdown),true);
  mech:=jsonb_set(mech,'{heatEffects}',jsonb_build_object('movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'ammo_target',ammo_target),true);
  units:=units||jsonb_build_array(mech);
  results:=results||jsonb_build_array(jsonb_build_object('instance_id',mech->>'instanceId','before',before_heat,'sinks',coalesce(sinks,0),'after',after_heat,'engine_heat',engine_hits*5,'movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'shutdown_roll',shutdown_roll,'shutdown',shutdown,'ammo_target',ammo_target,'ammo_roll',ammo_roll,'ammo_explosion',ammo_result));
 END LOOP;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('results',results);
END $$;
REVOKE ALL ON FUNCTION public.resolve_heat_management(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_heat_management(uuid) TO authenticated;

-- A shut-down unit has no normal activation. This keeps alternating movement,
-- weapon, and physical phases from waiting for a BattleMech that cannot act.
CREATE OR REPLACE FUNCTION public.btech_units_left_to_act(p_units jsonb,p_round int,p_phase text,p_seat int,p_flag text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT count(*)::int FROM jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) unit
 WHERE (unit->>'owner')::int=p_seat
 AND NOT coalesce((unit->>'shutdown')::boolean,false)
 AND CASE WHEN p_phase='weapon_attack'
  THEN coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=p_round AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false)
  ELSE NOT coalesce((unit->>'destroyed')::boolean,false) END
 AND NOT coalesce((unit->>p_flag)::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.btech_units_left_to_act(jsonb,int,text,int,text) FROM PUBLIC;
