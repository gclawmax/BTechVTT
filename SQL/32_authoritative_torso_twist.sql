-- Server-authoritative Reaction Phase torso twists.
-- Run after SQL/31_authoritative_movement.sql.

CREATE OR REPLACE FUNCTION public.submit_torso_twist_reaction(
 p_game_id uuid,p_instance_id text,p_torso_facing int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb;mech jsonb;
 leg_facing int;twist_delta int;activation jsonb;phase_complete boolean;next_player uuid;first_player uuid;
BEGIN
 IF p_torso_facing NOT BETWEEN 0 AND 5 THEN RAISE EXCEPTION 'Choose a valid torso facing';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'reaction' OR g.active_player_id IS DISTINCT FROM player.id THEN
  RAISE EXCEPTION 'It is not your Reaction activation';
 END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 before_units:=coalesce(st->'mech_instances','[]'::jsonb);
 SELECT value INTO mech FROM jsonb_array_elements(before_units) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false)
  OR coalesce((mech->>'hasReacted')::boolean,false) OR coalesce((mech->>'shutdown')::boolean,false)
  OR coalesce(mech->'pilot'->>'consciousness','conscious')<>'conscious' THEN
  RAISE EXCEPTION 'Choose one of your eligible BattleMechs that has not reacted';
 END IF;
 leg_facing:=coalesce((mech->>'facing')::int,0);
 twist_delta:=(p_torso_facing-leg_facing+6)%6;
 IF twist_delta NOT IN (0,1,5) THEN RAISE EXCEPTION 'A BattleMech may twist its torso at most one hexside';END IF;
 mech:=jsonb_set(mech,'{torsoFacing}',to_jsonb(p_torso_facing),true);
 mech:=jsonb_set(mech,'{hasReacted}','true'::jsonb,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;
 st:=jsonb_set(st,'{mech_instances}',units,true);
 activation:=btech_advance_unit_activation(st,before_units,g.current_round,'reaction',player.id,player.seat_number,'hasReacted');
 st:=activation->'state';phase_complete:=coalesce((activation->>'phase_complete')::boolean,false);
 IF NOT phase_complete THEN
  next_player:=(activation->>'active_player_id')::uuid;
  st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(next_player),true);
  UPDATE btech_games SET active_player_id=next_player,state=st WHERE id=p_game_id;
  RETURN jsonb_build_object('status','waiting_for_activation','instance_id',p_instance_id,'torso_facing',p_torso_facing,'remaining_in_activation',coalesce((activation->>'remaining')::int,0));
 END IF;
 SELECT jsonb_agg(jsonb_set(jsonb_set(value,'{hasFired}','false'::jsonb,true),'{weaponPhaseStart}',jsonb_build_object('round',g.current_round,'mech',value-'weaponPhaseStart'),true)) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st-'phase_activation','{mech_instances}',units,true);
 SELECT (entry->>'player_id')::uuid INTO first_player FROM jsonb_array_elements(st->'initiative_order') WITH ORDINALITY ordered(entry,pos) WHERE pos=1;
 st:=jsonb_set(st,'{active_player_player_id}',to_jsonb(first_player),true);
 UPDATE btech_games SET current_phase='weapon_attack',active_player_id=first_player,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','reaction_complete','instance_id',p_instance_id,'torso_facing',p_torso_facing);
END $$;
REVOKE ALL ON FUNCTION public.submit_torso_twist_reaction(uuid,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_torso_twist_reaction(uuid,text,int) TO authenticated;

-- Older browsers must not be able to submit a whole reaction snapshot.
CREATE OR REPLACE FUNCTION public.submit_phase_state(p_game_id uuid,p_mech_instances jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE phase_name text;
BEGIN
 SELECT current_phase INTO phase_name FROM btech_games WHERE id=p_game_id;
 IF phase_name='movement' THEN RAISE EXCEPTION 'Movement must use the authoritative movement resolver';END IF;
 IF phase_name='reaction' THEN RAISE EXCEPTION 'Torso twists must use the authoritative Reaction resolver';END IF;
 IF phase_name='physical_attack' THEN RAISE EXCEPTION 'Physical Attacks must use the authoritative declaration resolver';END IF;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,p_mech_instances);
END $$;
REVOKE ALL ON FUNCTION public.submit_phase_state(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_phase_state(uuid,jsonb) TO authenticated;
