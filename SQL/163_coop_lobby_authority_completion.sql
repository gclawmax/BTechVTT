-- SQL/163 — Coop deployment authority: force-based deployment zones (issue #15)
--
-- SCOPE CORRECTION (2026-10-04, live schema audit): an earlier revision of
-- this file also defined a three-argument update_coop_skirmish_hangar.
-- Auditing the LIVE schema proved that a five-argument
-- update_coop_skirmish_hangar ALREADY EXISTS there (authored by SQL/162 and
-- applied). The client's three-argument call therefore fails with PGRST202 as
-- an ARITY MISMATCH, not as a missing function. That is fixed on the client
-- side (calling the 5-arg signature properly), NOT by shadowing the working
-- function with an overload. If you are holding an older copy of this file
-- that CREATEs a three-argument update_coop_skirmish_hangar, discard it and
-- paste this one instead.
--
-- What remains (the actual server gap): coop games deploy by FORCE (team
-- model), but set_match_deployment (SQL/54 -> SQL/79) still used the
-- historical per-seat column rule (seat 2 must sit at column >= 11). In coop,
-- seat 2 is the FRIENDLY side, so the rule rejected every legal coop
-- deployment (the client only offers the shared west side) and would have
-- accepted deployments on the enemy's own edge.
--
-- Non-coop games (skirmish / vs AI / solo) keep byte-identical legacy rules:
-- the seat==force assumption is wrapped, not rewritten.
--
-- Run AFTER SQL/160 (btech_seat_team), SQL/161 and SQL/162. Safe to re-run.

-- ── (b) Deployment zones resolve per FORCE ────────────────────────────────
-- Helper: which default column strip belongs to a force. Authored zones are
-- keyed by force ('1'/'2'), matching js/game/team-model.js and the client's
-- scenarioDeploymentZoneHexes. Seat→force comes from state.team_assignments
-- (shape {A:[seats],B:[seats]}); a seat on both teams is corrupt and refused.
CREATE OR REPLACE FUNCTION public.btech_coop_zone_contains(p_state jsonb,p_seat int,p_code text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ta jsonb;force_key text;dimensions jsonb;cols int;rows int;col_number int;row_number int;depth int;
BEGIN
 IF p_code IS NULL OR p_code !~ '^[0-9]{4}$' OR p_seat IS NULL OR p_seat < 1 THEN RETURN false;END IF;
 ta:=p_state->'team_assignments';
 IF jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'A')='array' AND jsonb_typeof(ta->'B')='array' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'A') a WHERE a::int=p_seat) AND EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'B') b WHERE b::int=p_seat) THEN RAISE EXCEPTION 'Seat % is recorded on both teams A and B; refusing to guess',p_seat;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'A') a WHERE a::int=p_seat) THEN force_key:='1';
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'B') b WHERE b::int=p_seat) THEN force_key:='2';
  ELSE RAISE EXCEPTION 'Seat % has no recorded team assignment in this match; refusing to infer a side',p_seat;
  END IF;
 ELSE RAISE EXCEPTION 'A coop match without team assignments cannot validate deployment';
 END IF;
 IF jsonb_typeof(p_state->'deployment_zones'->force_key)='array' THEN RETURN (p_state->'deployment_zones'->force_key) ? p_code;END IF;
 dimensions:=btech_map_dimensions(coalesce(p_state->>'map_id','training-grounds'));cols:=(dimensions->>'columns')::int;rows:=(dimensions->>'rows')::int;
 col_number:=left(p_code,2)::int;row_number:=right(p_code,2)::int;
 IF col_number<0 OR col_number>=cols OR row_number<0 OR row_number>=rows THEN RETURN false;END IF;
 depth:=least(5,cols);
 RETURN CASE WHEN force_key='1' THEN col_number<depth ELSE col_number>=cols-depth END;
END $$;
REVOKE ALL ON FUNCTION public.btech_coop_zone_contains(jsonb,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_coop_zone_contains(jsonb,int,text) TO authenticated;

-- Rewritten deployment writer. Non-coop games evaluate EXACTLY the historical
-- SQL/79 predicate (the old 16x12 box and per-seat column rule included).
-- Coop games use btech_coop_zone_contains, which gives both friendly seats
-- (team A) the friendly side and refuses hexes on the enemy edge, cross-seat
-- occupancy is still checked against EVERY seat including the AI's.
CREATE OR REPLACE FUNCTION public.set_match_deployment(p_game_id uuid,p_positions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;roster jsonb;count_required int;all_positions jsonb;coop boolean;
BEGIN
 IF jsonb_typeof(p_positions)<>'array' THEN RAISE EXCEPTION 'Deployment positions must be an array';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Deployment can be changed only by seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 roster:=coalesce(st->'rosters'->player.seat_number::text,'[]'::jsonb);count_required:=jsonb_array_length(roster);
 IF jsonb_array_length(p_positions)>count_required THEN RAISE EXCEPTION 'Deployment includes more BattleMechs than the roster';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positions) e WHERE jsonb_typeof(e)<>'object' OR (e->>'col') !~ '^[0-9]+$' OR (e->>'row') !~ '^[0-9]+$' OR (e->>'facing') !~ '^[0-5]$') THEN RAISE EXCEPTION 'Each deployment needs col, row and facing';END IF;
 coop:=coalesce(g.match_type,'skirmish')='coop_skirmish';
 IF NOT coop THEN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positions) e WHERE (e->>'col')::int<0 OR (e->>'col')::int>15 OR (e->>'row')::int<0 OR (e->>'row')::int>11 OR (player.seat_number=1 AND (e->>'col')::int>4) OR (player.seat_number=2 AND (e->>'col')::int<11)) THEN RAISE EXCEPTION 'A BattleMech must deploy inside its own deployment zone';END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_positions) e WHERE NOT btech_coop_zone_contains(st,player.seat_number,lpad((e->>'col')::text,2,'0')||lpad((e->>'row')::text,2,'0'))) THEN RAISE EXCEPTION 'A BattleMech must deploy inside its own deployment zone';END IF;
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_positions))<>(SELECT count(DISTINCT (e->>'col')||','||(e->>'row')) FROM jsonb_array_elements(p_positions) e) THEN RAISE EXCEPTION 'Two BattleMechs cannot occupy the same hex';END IF;
 all_positions:=coalesce(st->'deployment_positions','{}'::jsonb);
 IF EXISTS (SELECT 1 FROM jsonb_each(all_positions) owner, jsonb_array_elements(owner.value) e, jsonb_array_elements(p_positions) mine WHERE owner.key<>player.seat_number::text AND (e->>'col')=(mine->>'col') AND (e->>'row')=(mine->>'row')) THEN RAISE EXCEPTION 'That deployment hex is already occupied';END IF;
 st:=jsonb_set(st,'{deployment_positions}',jsonb_set(coalesce(st->'deployment_positions','{}'::jsonb),ARRAY[player.seat_number::text],p_positions,true),true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
 RETURN p_positions;
END $$;
REVOKE ALL ON FUNCTION public.set_match_deployment(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_deployment(uuid,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
