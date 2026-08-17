-- Server-authoritative startup attempts for heat-shut-down BattleMechs.
-- Run after SQL/27_authoritative_heat_effects.sql.

CREATE OR REPLACE FUNCTION public.attempt_startup_battlemech(
 p_game_id uuid,p_instance_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;
 mech jsonb;target_number int;die_a int;die_b int;passed boolean;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN
  RAISE EXCEPTION 'It is not your Movement activation';
 END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=st->'mech_instances';
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false)
  OR NOT coalesce((mech->>'shutdown')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) THEN
  RAISE EXCEPTION 'Choose one of your shut-down BattleMechs that has not acted';
 END IF;
 target_number:=CASE WHEN coalesce((mech->>'heat')::int,0)>=30 THEN 99 WHEN coalesce((mech->>'heat')::int,0)>=26 THEN 10 WHEN coalesce((mech->>'heat')::int,0)>=22 THEN 8 WHEN coalesce((mech->>'heat')::int,0)>=18 THEN 6 WHEN coalesce((mech->>'heat')::int,0)>=14 THEN 4 ELSE 2 END;
 die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);
 passed:=target_number<=2 OR (target_number<=12 AND die_a+die_b>=target_number);
 IF passed THEN mech:=jsonb_set(mech,'{shutdown}','false'::jsonb,true);END IF;
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);
 mech:=jsonb_set(mech,'{movementMode}','"startup"'::jsonb,true);
 mech:=jsonb_set(mech,'{mpUsed}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{hexesMoved}','0'::jsonb,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END)
  INTO units FROM jsonb_array_elements(before_units) value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'passed',passed,
  'to_hit',jsonb_build_object('die_a',die_a,'die_b',die_b,'total',die_a+die_b,'target',target_number));
END $$;
REVOKE ALL ON FUNCTION public.attempt_startup_battlemech(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attempt_startup_battlemech(uuid,text) TO authenticated;

-- Shut-down units need a Movement activation to attempt startup, but remain
-- excluded from Weapon and Physical Attack activation counts.
CREATE OR REPLACE FUNCTION public.btech_units_left_to_act(p_units jsonb,p_round int,p_phase text,p_seat int,p_flag text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT count(*)::int FROM jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) unit
 WHERE (unit->>'owner')::int=p_seat
 AND NOT coalesce((unit->>'destroyed')::boolean,false)
 AND (p_phase='movement' OR NOT coalesce((unit->>'shutdown')::boolean,false))
 AND CASE WHEN p_phase='weapon_attack'
  THEN coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=p_round AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false)
  ELSE true END
 AND NOT coalesce((unit->>p_flag)::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.btech_units_left_to_act(jsonb,int,text,int,text) FROM PUBLIC;
