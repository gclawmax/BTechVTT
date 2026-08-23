-- Player-chosen lobby deployment. Run after SQL/53.
CREATE OR REPLACE FUNCTION public.set_match_deployment(p_game_id uuid,p_positions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE; player btech_players%ROWTYPE; st jsonb; roster jsonb; all_positions jsonb; entry jsonb; count_required int;
BEGIN
 IF jsonb_typeof(p_positions)<>'array' THEN RAISE EXCEPTION 'Deployment positions must be an array'; END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Deployment can be changed only by seated players in a lobby'; END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 roster:=coalesce(st->'rosters'->player.seat_number::text,'[]'::jsonb); count_required:=jsonb_array_length(roster);
 IF jsonb_array_length(p_positions)<>count_required THEN RAISE EXCEPTION 'Place every BattleMech in your roster'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positions) e WHERE jsonb_typeof(e)<>'object' OR (e->>'col') !~ '^[0-9]+$' OR (e->>'row') !~ '^[0-9]+$' OR (e->>'facing') !~ '^[0-5]$') THEN RAISE EXCEPTION 'Each deployment needs col, row and facing'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positions) e WHERE (e->>'col')::int<0 OR (e->>'col')::int>15 OR (e->>'row')::int<0 OR (e->>'row')::int>11 OR (player.seat_number=1 AND (e->>'col')::int>4) OR (player.seat_number=2 AND (e->>'col')::int<11)) THEN RAISE EXCEPTION 'A BattleMech must deploy inside its own deployment zone'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_positions))<>(SELECT count(DISTINCT (e->>'col')||','||(e->>'row')) FROM jsonb_array_elements(p_positions) e) THEN RAISE EXCEPTION 'Two BattleMechs cannot occupy the same hex'; END IF;
 all_positions:=coalesce(st->'deployment_positions','{}'::jsonb);
 IF EXISTS (SELECT 1 FROM jsonb_each(all_positions) owner, jsonb_array_elements(owner.value) e, jsonb_array_elements(p_positions) mine WHERE owner.key<>player.seat_number::text AND (e->>'col')=(mine->>'col') AND (e->>'row')=(mine->>'row')) THEN RAISE EXCEPTION 'That deployment hex is already occupied'; END IF;
 st:=jsonb_set(st,ARRAY['deployment_positions',player.seat_number::text],p_positions,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
 RETURN p_positions;
END $$;
REVOKE ALL ON FUNCTION public.set_match_deployment(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_deployment(uuid,jsonb) TO authenticated;
