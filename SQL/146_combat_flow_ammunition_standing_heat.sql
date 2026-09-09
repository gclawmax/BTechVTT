-- Combat flow fixes. Run once after SQL 145. Safe to rerun.
BEGIN;

-- A loadout control belongs to one physical ammunition bin.  Let a player
-- commit one bin at a time; initiative remains guarded until every required
-- bin on both forces has a permanent loadType.

CREATE OR REPLACE FUNCTION public.confirm_round_one_ammunition_bin(p_game_id uuid,p_bin_key text,p_load_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p_loadouts jsonb:=jsonb_build_object(p_bin_key,p_load_type);g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;allowed text[];provided int:=0;special_setup boolean;accepted_keys text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(coalesce(p_loadouts,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Ammunition loadouts must be an object';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_round<>1 OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'Ammunition is selected only during Round 1 initiative setup';END IF;
 IF EXISTS (SELECT 1 FROM btech_initiative WHERE game_id=p_game_id AND round=1) THEN RAISE EXCEPTION 'Ammunition must be declared before initiative is rolled';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;special_setup:=coalesce((st->>'special_ammo_setup_v1')::boolean,false);
 FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value LOOP
  updated:=mech;
  IF (mech->>'owner')::int=player.seat_number THEN
   FOR bin IN SELECT value FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) value LOOP
    allowed:=btech_special_ammo_load_types(bin->>'type');
    IF cardinality(allowed)>1 AND (bin->>'type'='lb10x' OR special_setup) THEN
     bin_key:=(mech->>'instanceId')||':'||(bin->>'id');accepted_keys:=array_append(accepted_keys,bin_key);load_type:=p_loadouts->>bin_key;
     IF load_type IS NOT NULL THEN
      IF NOT (load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Choose a valid ammunition type for every configurable bin';END IF;
      updated:=btech_set_ammo_load_type(updated,bin->>'id',load_type);provided:=provided+1;
     END IF;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_loadouts) requested(bin_key) WHERE NOT requested.bin_key=ANY(accepted_keys)) THEN RAISE EXCEPTION 'An ammunition selection does not belong to one of your configurable bins';END IF;
 IF provided=0 THEN RAISE EXCEPTION 'Choose ammunition for a configurable bin';END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;

REVOKE ALL ON FUNCTION public.confirm_round_one_ammunition_bin(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_round_one_ammunition_bin(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_reset_heat_on_phase_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE st jsonb; units jsonb;
BEGIN
 IF NEW.current_phase='heat' AND OLD.current_phase IS DISTINCT FROM 'heat' THEN
  st:=CASE jsonb_typeof(NEW.state) WHEN 'string' THEN (NEW.state#>>'{}')::jsonb ELSE NEW.state END;
  SELECT coalesce(jsonb_agg(value || '{"hasManagedHeat":false,"heatDissipated":0}'::jsonb),'[]'::jsonb)
   INTO units FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb));
  NEW.state:=jsonb_set(st,'{mech_instances}',units,true);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS btech_heat_phase_entry ON public.btech_games;
CREATE TRIGGER btech_heat_phase_entry BEFORE UPDATE ON public.btech_games
FOR EACH ROW EXECUTE FUNCTION public.btech_reset_heat_on_phase_entry();
REVOKE ALL ON FUNCTION public.btech_reset_heat_on_phase_entry() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.attempt_stand_with_facing_choice(p_game_id uuid,p_instance_id text)
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
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;IF passed AND NOT coalesce((mech->>'destroyed')::boolean,false) THEN
  mech:=jsonb_set(mech,'{hasMoved}','false'::jsonb,true)||jsonb_build_object('standFacingPending',g.current_round);
  SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
  UPDATE btech_games SET state=jsonb_set(st,'{mech_instances}',units,true) WHERE id=p_game_id;
 ELSE PERFORM submit_phase_state_nonphysical_core(p_game_id,units); END IF;
 result:=jsonb_build_object('instance_id',p_instance_id,'passed',passed,'to_hit',jsonb_build_object('die_a',check_result->'die_a','die_b',check_result->'die_b','total',check_result->'total','target',check_result->'target','damage_modifier',check_result->'damage_modifier'),'movement_points_spent',movement_cost,'movement_mode',movement_mode,'fall',fall_result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attempt_stand_with_facing_choice(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attempt_stand_with_facing_choice(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_stand_facing(p_game_id uuid,p_instance_id text,p_facing int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE; player btech_players%ROWTYPE;st jsonb;mech jsonb;units jsonb;
BEGIN
 IF p_facing IS NULL OR p_facing NOT IN (0,1,2,3,4,5) THEN RAISE EXCEPTION 'Choose one of the six hex facings';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'standFacingPending')::int,-1)<>g.current_round OR coalesce((mech->>'hasMoved')::boolean,false) OR coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'This BattleMech is not awaiting a standing facing';END IF;
 mech:=(mech-'standFacingPending')||jsonb_build_object('facing',p_facing,'torsoFacing',p_facing,'hasMoved',true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances');
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
END $$;
REVOKE ALL ON FUNCTION public.confirm_stand_facing(uuid,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_stand_facing(uuid,text,int) TO authenticated;
-- Legacy matches can already be sitting in Heat with stale completion flags.
-- Only reopen positive, unchanged ledgers with zero recorded dissipation and
-- working sinks. Completed heat resolutions are left intact.
DO $$
DECLARE g record; st jsonb; units jsonb; mech jsonb; capacity int; loss int;
BEGIN
 FOR g IN SELECT id,state,catalogue_version FROM btech_games WHERE status='in-progress' AND current_phase='heat' FOR UPDATE LOOP
  st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END; units:='[]'::jsonb;
  FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) LOOP
   IF coalesce((mech->>'hasManagedHeat')::boolean,false) AND coalesce((mech->>'heatDissipated')::int,0)=0
      AND coalesce((mech->>'heat')::int,0)>0 AND (mech->>'heat')::int=coalesce((mech->>'roundStartingHeat')::int,0)+coalesce((mech->>'movementHeat')::int,0)+coalesce((mech->>'weaponHeat')::int,0)+coalesce((mech->>'externalHeat')::int,0) THEN
    SELECT coalesce((definition->>'heat_sink_capacity')::int,(definition->>'heat_sinks')::int,0) INTO capacity FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
    SELECT coalesce(sum(CASE WHEN btech_equipment_label_key(slot.label)='doubleheatsink' THEN 2 ELSE 1 END),0)::int INTO loss FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND btech_equipment_label_key(slot.label) IN ('heatsink','doubleheatsink') AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
    IF capacity-loss>0 THEN mech:=jsonb_set(mech,'{hasManagedHeat}','false'::jsonb,true);END IF;
   END IF;
   units:=units||jsonb_build_array(mech);
  END LOOP;
  UPDATE btech_games SET state=jsonb_set(st,'{mech_instances}',units,true) WHERE id=g.id;
 END LOOP;
END $$;
COMMIT;
