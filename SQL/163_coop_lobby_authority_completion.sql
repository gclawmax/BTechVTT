-- SQL/163 — Complete Coop 1-a lobby authority (issues #13 + #14)
--
-- Two closures, no changes to any other mode's behaviour:
--  (a) update_coop_skirmish_hangar: the hangar-write function the coop lobby
--      already calls (lobby.js saveSkirmishHangar) but which no migration
--      ever created. Without it, pick_own hangars in coop lobbies silently
--      lose every edit and no coop match can ever reach the start gate.
--  (b) set_match_deployment: coop games deploy by FORCE (team model), but the
--      live validator still used the historical per-seat column rule
--      (seat 2 must sit at column >= 11). In coop, seat 2 is the FRIENDLY
--      side, so the rule both rejected every legal coop deployment and would
--      have accepted deployments on the enemy's own edge.
--
-- Non-coop games (skirmish / vs AI / solo) keep byte-identical legacy rules:
-- the seat==force assumption is wrapped, not rewritten.
--
-- Run AFTER SQL/160 (team_assignments reader btech_seat_team), SQL/161 and
-- SQL/162. Safe to re-run: everything below is CREATE OR REPLACE.

-- ── (a) Coop hangar authority ─────────────────────────────────────────────
-- Mirrors update_skirmish_hangar (SQL/120 as amended by SQL/132) with three
-- coop differences: the caller's SEAT comes from their btech_players row and
-- must be 1 or 2 (the AI never edits hangars); a Readied seat is locked; and
-- the dropship tonnage is a TEAM-A SOFT cap (decision 1) — overage is allowed
-- here and confirmed by the host at Start, so this function does not reject
-- on tonnage. Per-unit support and ruleset legality ARE enforced server-side.
CREATE OR REPLACE FUNCTION public.update_coop_skirmish_hangar(p_game_id uuid,p_hangar jsonb,p_deployed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;avatars jsonb;avatar jsonb;unit_ids jsonb;rosters jsonb;ruleset text;entry jsonb;pilot jsonb;normalized_hangar jsonb:='[]'::jsonb;
BEGIN
 IF jsonb_typeof(p_hangar)<>'array' OR jsonb_typeof(p_deployed)<>'array' THEN RAISE EXCEPTION 'Hangar and deployment must be arrays';END IF;
 IF jsonb_array_length(p_hangar)>12 OR jsonb_array_length(p_deployed)>6 THEN RAISE EXCEPTION 'A Skirmish Hangar may hold 12 BattleMechs and deploy 6';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_hangar) item WHERE jsonb_typeof(item)<>'object' OR coalesce(item->>'id','')='' OR coalesce(item->>'unit_id','')='') THEN RAISE EXCEPTION 'Each hangar entry needs an id and unit id';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_hangar))<>(SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_hangar) item) THEN RAISE EXCEPTION 'Each Hangar BattleMech needs a unique id';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_hangar) LOOP
  pilot:=entry->'pilot';IF pilot IS NULL THEN pilot:=jsonb_build_object('id','pilot-'||(entry->>'id'),'name','MechWarrior','gunnery',4,'piloting',5);ELSE IF jsonb_typeof(pilot)<>'object' THEN RAISE EXCEPTION 'Each BattleMech pilot must be an object';END IF;IF length(btrim(coalesce(pilot->>'name','')))<1 OR length(btrim(pilot->>'name'))>48 THEN RAISE EXCEPTION 'Pilot names must be between 1 and 48 characters';END IF;IF coalesce(pilot->>'gunnery','') !~ '^[0-8]$' OR coalesce(pilot->>'piloting','') !~ '^[0-8]$' THEN RAISE EXCEPTION 'Gunnery and Piloting must be whole numbers from 0 to 8';END IF;pilot:=jsonb_build_object('id',coalesce(nullif(pilot->>'id',''),'pilot-'||(entry->>'id')),'name',btrim(pilot->>'name'),'gunnery',(pilot->>'gunnery')::int,'piloting',(pilot->>'piloting')::int);END IF;normalized_hangar:=normalized_hangar||jsonb_build_array(jsonb_set(entry,'{pilot}',pilot,true));
 END LOOP;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 IF NOT FOUND OR g.status<>'lobby' OR coalesce(g.match_type,'skirmish')<>'coop_skirmish' THEN RAISE EXCEPTION 'Coop hangars can be changed only in a coop lobby';END IF;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR player.seat_number NOT IN (1,2) THEN RAISE EXCEPTION 'Only the two human seats may edit hangars';END IF;
 IF player.ready THEN RAISE EXCEPTION 'A Readied seat is locked until the pilot un-readies';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN g.state ELSE '{}'::jsonb END;ruleset:=coalesce(st->>'ruleset','advanced_3060');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT EXISTS(SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=g.catalogue_version AND unit.unit_id=item->>'unit_id' AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false) AND (NOT coalesce((unit.definition->>'custom_design')::boolean,false) OR (unit.definition->>'custom_owner_id'=auth.uid()::text AND NOT coalesce((unit.definition->>'custom_archived')::boolean,false))))) THEN RAISE EXCEPTION 'A hangar contains an unsupported, archived, or another player''s custom BattleMech';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT btech_ruleset_unit_allowed(g.catalogue_version,item->>'unit_id',ruleset)) THEN RAISE EXCEPTION 'A hangar contains a BattleMech unavailable under the % ruleset',ruleset;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE item->>'id'=deployment.entry_id)) THEN RAISE EXCEPTION 'Only BattleMechs in your Hangar may be deployed';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements_text(p_deployed))<>(SELECT count(DISTINCT entry_id) FROM jsonb_array_elements_text(p_deployed) deployment(entry_id)) THEN RAISE EXCEPTION 'A Hangar BattleMech may be deployed once';END IF;
 SELECT coalesce(jsonb_agg(sel.unit_id ORDER BY sel.ord),'[]'::jsonb) INTO unit_ids FROM (
   SELECT dep.ord,(SELECT h.value->>'unit_id' FROM jsonb_array_elements(normalized_hangar) h WHERE h.value->>'id'=dep.entry_id LIMIT 1) AS unit_id
   FROM jsonb_array_elements_text(p_deployed) WITH ORDINALITY dep(entry_id,ord)
 ) sel;
 avatars:=coalesce(st->'skirmish_avatars','{}'::jsonb);avatar:=coalesce(avatars->player.seat_number::text,jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||player.seat_number::text,'callsign','Coop Pilot P'||player.seat_number::text,'gunnery',4,'piloting',5));avatar:=jsonb_set(jsonb_set(avatar,'{hangar}',normalized_hangar,true),'{deployed}',p_deployed,true);avatars:=jsonb_set(avatars,ARRAY[player.seat_number::text],avatar,true);rosters:=jsonb_set(coalesce(st->'rosters','{}'::jsonb),ARRAY[player.seat_number::text],unit_ids,true);st:=jsonb_set(jsonb_set(st,'{skirmish_avatars}',avatars,true),'{rosters}',rosters,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;RETURN avatar;
END $$;
REVOKE ALL ON FUNCTION public.update_coop_skirmish_hangar(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_coop_skirmish_hangar(uuid,jsonb,jsonb) TO authenticated;

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
