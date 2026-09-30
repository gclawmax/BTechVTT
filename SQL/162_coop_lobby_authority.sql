-- Run after 161. Coop Skirmish lobby server authority (design doc §2.5, §3, §4).
--
-- Every rule here is keyed off match_type='coop_skirmish' and reads the
-- decision-4 team_assignments data through btech_seat_team. Non-coop behaviour
-- is deliberately untouched: the existing update_skirmish_hangar /
-- update_lobby_roster / update_ai_skirmish_force stay byte-for-byte as they
-- are; coop gets its own authoritative save path (update_coop_skirmish_hangar)
-- plus host-only lobby controls. The single source of the "who may edit this
-- seat" rule is btech_coop_loadout_editable (decision 5: the A/B/C permission
-- model + the ready lock, enforced server-side, not only in the UI).
--
-- The tonnage soft cap (decision 1) re-uses the creation-time dropship
-- tonnage field (state.dropship_tonnage, one of 100/150/200/250): in a
-- coop_skirmish it is interpreted as the TEAM-A total (the dropship carries
-- the whole lance), whereas a plain skirmish keeps its historical per-seat
-- meaning. Mode-dependent interpretation of the same data — no new field.

-- ── (a) btech_seat_team: cast fix ────────────────────────────────────────
-- SQL/160 read each team-array element with (a->>0)::int. That is NULL for a
-- scalar jsonb element (the element is an int, not a nested array), so the
-- EXISTS never matched and every *assigned* seat fail-closed. The element is
-- a scalar int — cast it directly. Everything else (fail-closed contract,
-- both-teams corruption guard, friendly-must-be-human cross-check) is kept.
CREATE OR REPLACE FUNCTION public.btech_seat_team(p_game_id uuid,p_seat_number int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  st jsonb;
  ta jsonb;
  in_a boolean;
  in_b boolean;
BEGIN
  SELECT * INTO g FROM btech_games WHERE id=p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found';END IF;
  IF p_seat_number IS NULL OR p_seat_number < 1 THEN RAISE EXCEPTION 'Invalid seat number';END IF;

  -- btech_games.state is stored as text json; parse defensively (house style).
  st := CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
  ta := st->'team_assignments';

  in_a := jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'A')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'A') a WHERE a::int = p_seat_number);
  in_b := jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'B')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ta->'B') b WHERE b::int = p_seat_number);

  -- Fail closed: no recorded assignment means we must not guess a side.
  IF NOT in_a AND NOT in_b THEN
    RAISE EXCEPTION 'Seat % has no recorded team assignment in this match; refusing to infer a side', p_seat_number;
  END IF;
  -- A seat recorded on both teams is corrupt; refuse rather than pick one.
  IF in_a AND in_b THEN
    RAISE EXCEPTION 'Seat % is recorded on both teams A and B; refusing to guess', p_seat_number;
  END IF;

  IF in_a THEN
    -- Cross-check the stored assignment against btech_players for the coop
    -- mode: a friendly (team A) seat must belong to a human player, never to
    -- the AI. Keeps the sealed "user_id -> seat -> unit" stamp truthful
    -- (design doc section 2.4) and prevents an AI from being a friendly pilot.
    IF coalesce(g.match_type,'skirmish')='coop_skirmish' THEN
      IF NOT EXISTS(SELECT 1 FROM btech_players pl WHERE pl.game_id=p_game_id AND pl.seat_number=p_seat_number AND pl.role='player' AND NOT coalesce(pl.is_ai,false)) THEN
        RAISE EXCEPTION 'Team A (friendly) seat % has no human player in a coop skirmish', p_seat_number;
      END IF;
    END IF;
    RETURN 'A';
  END IF;
  RETURN 'B';
END $$;
REVOKE ALL ON FUNCTION public.btech_seat_team(uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_seat_team(uuid,int) TO authenticated;

-- ── (b) The single "who may edit this seat" rule (decision 5) ────────────
-- Centralised so no UI path can bypass it. Takes the actor explicitly so it
-- is unit-testable; callers pass auth.uid(). Returns TRUE iff the actor may
-- currently save a loadout for p_seat.
--
--   ready lock : a Readied seat is locked from everyone, host included, until
--                Unready (checked first, so it wins over every mode).
--   own seat   : a player always edits their own (not-ready) seat.
--   host_assign: only the host edits that seat.
--   pick_any   : any seated player edits that seat (until it is Readied).
--   pick_own   : (default) only that seat's player — so a *different* player
--                may not edit it.
CREATE OR REPLACE FUNCTION public.btech_coop_loadout_editable(p_game_id uuid,p_seat int,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  st jsonb;
  target btech_players%ROWTYPE;
  actor_seat int;
  mode text;
BEGIN
  -- Read-only gate (STABLE). The caller (update_coop_skirmish_hangar) already
  -- holds the game row lock in its own transaction; no lock needed here.
  SELECT * INTO g FROM btech_games WHERE id=p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found';END IF;
  IF coalesce(g.match_type,'skirmish')<>'coop_skirmish' THEN RAISE EXCEPTION 'Loadout permissions apply to coop skirmishes';END IF;
  IF g.status<>'lobby' THEN RAISE EXCEPTION 'Loadout permissions apply only while the game is in the lobby';END IF;
  IF p_actor_id IS NULL THEN RETURN false;END IF;

  SELECT * INTO target FROM btech_players WHERE game_id=p_game_id AND seat_number=p_seat AND role='player';
  IF NOT FOUND THEN RAISE EXCEPTION 'No seated player at seat %',p_seat;END IF;
  IF coalesce(target.is_ai,false) THEN RETURN false;END IF; -- the AI seat is not a human-editable loadout
  IF target.ready THEN RETURN false;END IF; -- ready lock (everyone, host included)

  SELECT seat_number INTO actor_seat FROM btech_players WHERE game_id=p_game_id AND user_id=p_actor_id AND role='player' AND NOT coalesce(is_ai,false);
  IF actor_seat IS NULL THEN RETURN false;END IF; -- caller is not a seated human

  IF actor_seat = p_seat THEN RETURN true;END IF; -- own (not-ready) seat

  st := CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
  mode := coalesce(st->'loadout_modes'->>(p_seat::text),'pick_own');
  IF mode='host_assign' THEN RETURN g.host_id IS NOT DISTINCT FROM p_actor_id;END IF;
  IF mode='pick_any' THEN RETURN true;END IF;
  RETURN false; -- 'pick_own' (default) and the actor is not that seat's player
END $$;
REVOKE ALL ON FUNCTION public.btech_coop_loadout_editable(uuid,int,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_coop_loadout_editable(uuid,int,uuid) TO authenticated;

-- ── (c) Host-only lobby controls ─────────────────────────────────────────
-- Set the A/B/C permission mode for a seat (design doc §3 table). Host only,
-- lobby only. A mode change is a host setting (not a loadout edit), so it is
-- allowed even if the seat is currently Readied — the ready lock still blocks
-- any actual loadout edit on that seat.
CREATE OR REPLACE FUNCTION public.set_lobby_loadout_mode(p_game_id uuid,p_seat int,p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  st jsonb;
  target btech_players%ROWTYPE;
BEGIN
  IF p_mode NOT IN ('host_assign','pick_own','pick_any') THEN RAISE EXCEPTION 'Unknown loadout mode %',p_mode;END IF;
  SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found';END IF;
  IF coalesce(g.match_type,'skirmish')<>'coop_skirmish' OR g.status<>'lobby' THEN RAISE EXCEPTION 'Loadout modes apply to coop skirmishes in the lobby';END IF;
  IF g.host_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the host may set loadout modes';END IF;
  SELECT * INTO target FROM btech_players WHERE game_id=p_game_id AND seat_number=p_seat AND role='player';
  IF NOT FOUND OR coalesce(target.is_ai,false) THEN RAISE EXCEPTION 'Loadout modes apply to a seated human player';END IF;
  st := CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
  st := jsonb_set(st,ARRAY['loadout_modes',p_seat::text],to_jsonb(p_mode::text),true);
  UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.set_lobby_loadout_mode(uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_lobby_loadout_mode(uuid,int,text) TO authenticated;

-- Host force-Readies or Unreadies a seat (design doc §3: "The host may force a
-- seat Ready or Unready"). Players toggle their own ready state through the
-- normal RLS update; this RPC is the host's authority over other seats.
CREATE OR REPLACE FUNCTION public.force_lobby_ready(p_game_id uuid,p_seat int,p_ready boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  target btech_players%ROWTYPE;
BEGIN
  SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found';END IF;
  IF coalesce(g.match_type,'skirmish')<>'coop_skirmish' OR g.status<>'lobby' THEN RAISE EXCEPTION 'Force-ready applies to coop skirmishes in the lobby';END IF;
  IF g.host_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the host may force a seat ready';END IF;
  SELECT * INTO target FROM btech_players WHERE game_id=p_game_id AND seat_number=p_seat AND role='player';
  IF NOT FOUND THEN RAISE EXCEPTION 'No seated player at seat %',p_seat;END IF;
  IF coalesce(target.is_ai,false) THEN RAISE EXCEPTION 'The AI seat is always ready and cannot be forced';END IF;
  UPDATE btech_players SET ready=p_ready WHERE id=target.id;
  -- Editing loadout after a forced Unready is the expected flow; nothing else
  -- to roll back (ready is the only per-seat lobby gate it interacts with).
END $$;
REVOKE ALL ON FUNCTION public.force_lobby_ready(uuid,int,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_lobby_ready(uuid,int,boolean) TO authenticated;

-- ── (d) Authoritative coop hangar save (decision 1 soft cap + decision 5) ─
-- The coop counterpart of update_skirmish_hangar, with the deltas the design
-- requires: an explicit target seat (host_assign / pick_any), the centralised
-- permission + ready-lock gate, and the TEAM-total tonnage soft cap with
-- explicit overage confirmation. Non-coop callers keep the old function.
CREATE OR REPLACE FUNCTION public.update_coop_skirmish_hangar(p_game_id uuid,p_target_seat int,p_hangar jsonb,p_deployed jsonb,p_overage_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  g btech_games%ROWTYPE;
  st jsonb;
  actor_seat int;
  ruleset text;
  ta jsonb;
  entry jsonb;
  pilot jsonb;
  normalized_hangar jsonb:='[]'::jsonb;
  unit_ids jsonb;
  tonnage_cap int;
  team_tonnage int:=0;
  seat_tonnage int:=0;
  a_seat jsonb;
  avatars jsonb;
  avatar jsonb;
  rosters jsonb;
BEGIN
  IF jsonb_typeof(p_hangar)<>'array' OR jsonb_typeof(p_deployed)<>'array' THEN RAISE EXCEPTION 'Hangar and deployment must be arrays';END IF;
  IF jsonb_array_length(p_hangar)>12 OR jsonb_array_length(p_deployed)>6 THEN RAISE EXCEPTION 'A Skirmish Hangar may hold 12 BattleMechs and deploy 6';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_hangar) item WHERE jsonb_typeof(item)<>'object' OR coalesce(item->>'id','')='' OR coalesce(item->>'unit_id','')='') THEN RAISE EXCEPTION 'Each hangar entry needs an id and unit id';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_hangar))<>(SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_hangar) item) THEN RAISE EXCEPTION 'Each Hangar BattleMech needs a unique id';END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_hangar) LOOP
    pilot:=entry->'pilot';
    IF pilot IS NULL THEN
      pilot:=jsonb_build_object('id','pilot-'||(entry->>'id'),'name','MechWarrior','gunnery',4,'piloting',5);
    ELSE
      IF jsonb_typeof(pilot)<>'object' THEN RAISE EXCEPTION 'Each BattleMech pilot must be an object';END IF;
      IF length(btrim(coalesce(pilot->>'name','')))<1 OR length(btrim(pilot->>'name'))>48 THEN RAISE EXCEPTION 'Pilot names must be between 1 and 48 characters';END IF;
      IF coalesce(pilot->>'gunnery','') !~ '^[0-8]$' OR coalesce(pilot->>'piloting','') !~ '^[0-8]$' THEN RAISE EXCEPTION 'Gunnery and Piloting must be whole numbers from 0 to 8';END IF;
      pilot:=jsonb_build_object('id',coalesce(nullif(pilot->>'id',''),'pilot-'||(entry->>'id')),'name',btrim(pilot->>'name'),'gunnery',(pilot->>'gunnery')::int,'piloting',(pilot->>'piloting')::int);
    END IF;
    normalized_hangar:=normalized_hangar||jsonb_build_array(jsonb_set(entry,'{pilot}',pilot,true));
  END LOOP;

  SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
  IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Hangars can be changed only in a lobby';END IF;
  IF coalesce(g.match_type,'skirmish')<>'coop_skirmish' THEN RAISE EXCEPTION 'This save path is for coop skirmishes';END IF;
  SELECT seat_number INTO actor_seat FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player' AND NOT coalesce(is_ai,false);
  IF actor_seat IS NULL THEN RAISE EXCEPTION 'Only a seated player may update a coop Hangar';END IF;
  IF NOT btech_coop_loadout_editable(p_game_id,p_target_seat,auth.uid()) THEN RAISE EXCEPTION 'You may not edit seat %''s loadout right now (permission mode or ready lock)',p_target_seat;END IF;

  st := CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
  ruleset := coalesce(st->>'ruleset','advanced_3060');
  ta := st->'team_assignments';

  IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT EXISTS(SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=g.catalogue_version AND unit.unit_id=item->>'unit_id' AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false) AND (NOT coalesce((unit.definition->>'custom_design')::boolean,false) OR (unit.definition->>'custom_owner_id'=auth.uid()::text AND NOT coalesce((unit.definition->>'custom_archived')::boolean,false))))) THEN RAISE EXCEPTION 'A hangar contains an unsupported, archived, or another player''s custom BattleMech';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT btech_ruleset_unit_allowed(g.catalogue_version,item->>'unit_id',ruleset)) THEN RAISE EXCEPTION 'A hangar contains a BattleMech unavailable under the % ruleset',ruleset;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE item->>'id'=deployment.entry_id)) THEN RAISE EXCEPTION 'Only BattleMechs in the Hangar may be deployed';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements_text(p_deployed))<>(SELECT count(DISTINCT entry_id) FROM jsonb_array_elements_text(p_deployed) deployment(entry_id)) THEN RAISE EXCEPTION 'A Hangar BattleMech may be deployed once';END IF;

  SELECT coalesce(jsonb_agg(item.entry->>'unit_id' ORDER BY deployment.ordinality),'[]'::jsonb) INTO unit_ids
    FROM jsonb_array_elements_text(p_deployed) WITH ORDINALITY deployment(entry_id,ordinality)
    JOIN LATERAL(SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>'id'=deployment.entry_id)item ON true;

  -- Team-total tonnage: for every team-A seat, use this save's deployment for
  -- the target seat and the stored roster for the rest (0 if not saved yet).
  tonnage_cap := coalesce((st->>'dropship_tonnage')::int,0);
  IF jsonb_typeof(ta)='object' AND jsonb_typeof(ta->'A')='array' THEN
    FOR a_seat IN SELECT value FROM jsonb_array_elements(ta->'A') LOOP
      IF a_seat::int = p_target_seat THEN
        SELECT coalesce(sum((u.definition->>'mass')::int),0) INTO seat_tonnage FROM jsonb_array_elements_text(p_deployed) d(unit_id) JOIN btech_catalogue_units u ON u.catalogue_version=g.catalogue_version AND u.unit_id=d.unit_id;
      ELSE
        SELECT coalesce(sum((u.definition->>'mass')::int),0) INTO seat_tonnage FROM jsonb_array_elements_text(coalesce(st->'rosters'->(a_seat::text),'[]'::jsonb)) d(unit_id) JOIN btech_catalogue_units u ON u.catalogue_version=g.catalogue_version AND u.unit_id=d.unit_id;
      END IF;
      team_tonnage := team_tonnage + seat_tonnage;
    END LOOP;
  END IF;

  IF tonnage_cap>0 AND team_tonnage>tonnage_cap THEN
    IF NOT p_overage_confirmed THEN
      RAISE EXCEPTION 'Team tonnage % exceeds the cap % — confirm to continue',team_tonnage,tonnage_cap;
    END IF;
    st := jsonb_set(st,ARRAY['coop_tonnage_overage'],jsonb_build_object('confirmed',true,'team_tonnage',team_tonnage,'cap',tonnage_cap),true);
  ELSIF tonnage_cap>0 AND st ? 'coop_tonnage_overage' THEN
    st := st - 'coop_tonnage_overage'; -- back under the cap: clear any prior overage
  END IF;

  avatars := coalesce(st->'skirmish_avatars','{}'::jsonb);
  avatar := coalesce(avatars->(p_target_seat::text),jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||p_target_seat::text,'callsign','Skirmish Commander P'||p_target_seat::text,'gunnery',4,'piloting',5));
  avatar := jsonb_set(jsonb_set(avatar,'{hangar}',normalized_hangar,true),'{deployed}',p_deployed,true);
  avatars := jsonb_set(avatars,ARRAY[p_target_seat::text],avatar,true);
  rosters := jsonb_set(coalesce(st->'rosters','{}'::jsonb),ARRAY[p_target_seat::text],unit_ids,true);
  st := jsonb_set(jsonb_set(st,'{skirmish_avatars}',avatars,true),'{rosters}',rosters,true);
  UPDATE btech_games SET state=st WHERE id=p_game_id;
  RETURN avatar;
END $$;
REVOKE ALL ON FUNCTION public.update_coop_skirmish_hangar(uuid,int,jsonb,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_coop_skirmish_hangar(uuid,int,jsonb,jsonb,boolean) TO authenticated;

NOTIFY pgrst,'reload schema';