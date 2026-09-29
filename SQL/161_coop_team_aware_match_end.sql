-- Run after SQL/160. Coop Skirmish 1-a: team-aware authoritative match end.
--
-- resolve_btech_match_end and concede_btech_match each decide a winner by
-- *side*. Pre-coop a side was a seat (1 or 2), so they reasoned over distinct
-- surviving seats / the other seated player. Coop seats a third player (the AI)
-- on the same side as the second human, so seat arithmetic stops equaling side
-- arithmetic:
--   * resolve: if the AI (seat 3) is wiped while both friendly humans (seats
--     1 and 2) live, two seats survive but only one side does, and the old
--     logic would declare the match "ongoing" forever.
--   * concede: "the other seated player" is the conceder's friendly *partner*
--     (seat 2), not the AI, so a concession would hand the match to an ally.
--
-- Fix: decide the winner by *force* (side), read through btech_seat_team
-- (the single seat->side reader, SQL/160). Team A -> force 1 (friendly),
-- Team B -> force 2 (opponent/AI).
--
-- Legacy safety: games created before team_assignments existed keep the exact
-- historical seat==force behaviour (the branch below only consults
-- btech_seat_team when a recorded team model is present), so existing
-- in-progress matches are unaffected and btech_seat_team's fail-closed
-- guarantee is preserved -- it is never asked to guess a side for a game with
-- no recorded assignment.
--
-- The recorded winner is the winning *force* (1 or 2), stored in
-- match_result.winner_seat (int, as before). In solo / vs-AI force == seat, so
-- every existing mode is byte-for-byte unchanged. In coop it is the side that
-- won; the human-readable "Player N wins" toast is force-aware wording and is
-- handled in the lobby/UI unit, not here.

-- Annihilation / objective end of an in-progress match.
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
 -- Surviving *forces*. A recorded team model maps each surviving unit's seat to
 -- its side through the single reader; a legacy match (no team_assignments)
 -- keeps the historical seat==force value.
 SELECT array_agg(DISTINCT force ORDER BY force) INTO survivors FROM (
  SELECT CASE WHEN st ? 'team_assignments'
              THEN CASE public.btech_seat_team(p_game_id,(unit->>'owner')::int) WHEN 'A' THEN 1 ELSE 2 END
              ELSE (unit->>'owner')::int END AS force
  FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) unit
  WHERE NOT coalesce((unit->>'destroyed')::boolean,false)
 ) f;
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

-- A seated player concedes; the match is awarded to the opposing *side*.
CREATE OR REPLACE FUNCTION public.concede_btech_match(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;winner int;result jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' THEN RAISE EXCEPTION 'Only a seated player in an active game may concede';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 IF st->'match_result' IS NOT NULL AND st->'match_result'<>'null'::jsonb THEN RETURN jsonb_build_object('status','already_resolved','result',st->'match_result');END IF;
 IF st ? 'team_assignments' THEN
  -- Concession hands the match to the opposing *force* (team A <-> force 1,
  -- team B <-> force 2). In coop the opponent is the AI side, not the
  -- conceder's friendly partner.
  winner:=CASE public.btech_seat_team(p_game_id,player.seat_number) WHEN 'A' THEN 2 ELSE 1 END;
 ELSE
  -- Legacy: the opposing seated player (the AI in a solo / vs-AI match).
  SELECT seat_number INTO winner FROM btech_players WHERE game_id=p_game_id AND role='player' AND seat_number<>player.seat_number ORDER BY seat_number LIMIT 1;
  IF winner IS NULL THEN RAISE EXCEPTION 'A match needs an opposing player before it can be conceded';END IF;
 END IF;
 result:=jsonb_build_object('winner_seat',winner,'resolved_at',now(),'reason','concession','conceding_seat',player.seat_number);
 st:=jsonb_set(st,'{match_result}',result,true);
 st:=jsonb_set(st,'{active_player_player_id}','null'::jsonb,true);
 UPDATE btech_games SET current_phase='end',active_player_id=NULL,state=st WHERE id=p_game_id;
 RETURN jsonb_build_object('status','resolved','result',result);
END $$;
REVOKE ALL ON FUNCTION public.concede_btech_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.concede_btech_match(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';