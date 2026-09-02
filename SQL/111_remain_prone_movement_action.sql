-- A prone BattleMech may voluntarily remain on the ground. This consumes its
-- Movement activation but preserves prone-fire eligibility for Weapon Attack.

CREATE OR REPLACE FUNCTION public.remain_prone_battlemech(p_game_id uuid,p_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'movement' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Movement activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=coalesce(st->'mech_instances','[]'::jsonb);
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR NOT coalesce((mech->>'prone')::boolean,false) OR coalesce((mech->>'hasMoved')::boolean,false) THEN RAISE EXCEPTION 'Choose one of your prone BattleMechs that has not moved';END IF;
 mech:=jsonb_set(mech,'{hasMoved}','true'::jsonb,true);
 mech:=jsonb_set(mech,'{movementMode}','"prone"'::jsonb,true);
 mech:=jsonb_set(mech,'{mpUsed}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{hexesMoved}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{movementHeat}','0'::jsonb,true);
 mech:=jsonb_set(mech,'{heat}',to_jsonb(coalesce((mech->>'roundStartingHeat')::int,0)+coalesce((mech->>'weaponHeat')::int,0)+coalesce((mech->>'externalHeat')::int,0)),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);
 RETURN jsonb_build_object('instance_id',p_instance_id,'mode','prone','mp_used',0,'hexes_moved',0);
END $$;
REVOKE ALL ON FUNCTION public.remain_prone_battlemech(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remain_prone_battlemech(uuid,text) TO authenticated;
