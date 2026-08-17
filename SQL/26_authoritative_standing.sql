-- Server-authoritative standing attempts for prone BattleMechs.
-- Run after SQL/25_authoritative_physical_piloting.sql.

CREATE OR REPLACE FUNCTION public.attempt_stand_battlemech(
 p_game_id uuid,p_instance_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;
 mech jsonb;gyro_hits int;target_number int;die_a int;die_b int;passed boolean;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN
  RAISE EXCEPTION 'It is not your Movement activation';
 END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=st->'mech_instances';
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false)
  OR NOT coalesce((mech->>'prone')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) THEN
  RAISE EXCEPTION 'Choose one of your prone BattleMechs that has not moved';
 END IF;
 IF coalesce((mech->'structure'->>'ll')::int,0)<=0 OR coalesce((mech->'structure'->>'rl')::int,0)<=0 THEN
  RAISE EXCEPTION 'A BattleMech with a destroyed leg cannot stand';
 END IF;
 SELECT count(*)::int INTO gyro_hits FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')='Gyro'
   AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
 target_number:=greatest(2,coalesce((mech->>'pilotingSkill')::int,5)+(gyro_hits*3));
 die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);
 passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);
 IF passed THEN mech:=jsonb_set(mech,'{prone}','false'::jsonb,true);END IF;
 -- A stand attempt consumes the unit's movement activation, successful or not.
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);
 mech:=jsonb_set(mech,'{movementMode}','"stand"'::jsonb,true);
 mech:=jsonb_set(mech,'{mpUsed}','2'::jsonb,true);
 mech:=jsonb_set(mech,'{hexesMoved}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{movementHeat}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+coalesce((mech->>'weaponHeat')::int,0)),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END)
  INTO units FROM jsonb_array_elements(before_units) value;
 -- Reuse the established movement activation scheduler, which advances the
 -- active player or phase atomically after this one unit has acted.
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 result:=jsonb_build_object('instance_id',p_instance_id,'passed',passed,
  'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number,'gyro_modifier',gyro_hits*3),
  'movement_points_spent',2);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.attempt_stand_battlemech(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attempt_stand_battlemech(uuid,text) TO authenticated;

-- Prone is authoritative state created by the physical resolver. An ordinary
-- client-side movement save may not clear or add it.
CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid,p_mech_instances jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE phase_name text;stored_state jsonb;
BEGIN
 SELECT current_phase,CASE jsonb_typeof(state) WHEN 'string' THEN (state#>>'{}')::jsonb ELSE state END
  INTO phase_name,stored_state FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF phase_name='physical_attack' THEN
  RAISE EXCEPTION 'Physical Attacks must use the authoritative declaration resolver';
 END IF;
 IF phase_name='movement' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(coalesce(stored_state->'mech_instances','[]'::jsonb)) existing
  JOIN LATERAL (SELECT value FROM jsonb_array_elements(coalesce(p_mech_instances,'[]'::jsonb)) incoming
    WHERE incoming.value->>'instanceId'=existing.value->>'instanceId') submitted ON true
  WHERE coalesce((existing.value->>'prone')::boolean,false)
    IS DISTINCT FROM coalesce((submitted.value->>'prone')::boolean,false)
 ) THEN
  RAISE EXCEPTION 'Prone state can only change through the stand-up resolver';
 END IF;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,p_mech_instances);
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;
