-- Server-authoritative victory detection and match conclusion.
-- Run after SQL/32_authoritative_torso_twist.sql.

CREATE OR REPLACE FUNCTION public.resolve_btech_match_end(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;survivors int[];winner int;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' THEN RAISE EXCEPTION 'Only a seated player in an active game may check its result';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN
  RETURN jsonb_build_object('status','resolved','result',st->'match_result');
 END IF;
 -- Weapon attacks are simultaneous: every unit eligible at the beginning of
 -- the phase must finish its declaration before destruction can end a match.
 IF g.current_phase='weapon_attack' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) unit
  WHERE coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=g.current_round
   AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false)
   AND NOT coalesce((unit->>'hasFired')::boolean,false)
 ) THEN RETURN jsonb_build_object('status','pending_weapon_declarations');END IF;
 SELECT array_agg(DISTINCT (unit->>'owner')::int ORDER BY (unit->>'owner')::int) INTO survivors
 FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) unit
 WHERE NOT coalesce((unit->>'destroyed')::boolean,false);
 IF coalesce(array_length(survivors,1),0)>1 THEN RETURN jsonb_build_object('status','ongoing');END IF;
 winner:=CASE WHEN coalesce(array_length(survivors,1),0)=1 THEN survivors[1] ELSE NULL END;
 result:=jsonb_build_object('winner_seat',winner,'resolved_at',now());
 st:=jsonb_set(st,'{match_result}',result,true);
 st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);
 UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','result',result);
END $$;
REVOKE ALL ON FUNCTION public.resolve_btech_match_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_btech_match_end(uuid) TO authenticated;
