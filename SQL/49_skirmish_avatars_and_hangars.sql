-- Match-scoped Skirmish Avatars and Hangars. These are intentionally stored
-- in the match state: they last for one skirmish only and are not a campaign
-- progression system.

CREATE OR REPLACE FUNCTION public.ensure_skirmish_avatar(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;avatars jsonb;avatar jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Skirmish Avatars are available only to seated players in a lobby';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 avatars:=coalesce(st->'skirmish_avatars','{}'::jsonb);
 avatar:=avatars->player.seat_number::text;
 IF avatar IS NULL THEN
  avatar:=jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||player.seat_number::text,'callsign','Skirmish Commander P'||player.seat_number::text,'gunnery',4,'piloting',5,'hangar','[]'::jsonb,'deployed','[]'::jsonb);
  avatars:=jsonb_set(avatars,ARRAY[player.seat_number::text],avatar,true);
  st:=jsonb_set(st,'{skirmish_avatars}',avatars,true);
  UPDATE btech_games SET state=st WHERE id=p_game_id;
 END IF;
 RETURN avatar;
END $$;
REVOKE ALL ON FUNCTION public.ensure_skirmish_avatar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_skirmish_avatar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_skirmish_hangar(p_game_id uuid,p_hangar jsonb,p_deployed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;avatars jsonb;avatar jsonb;unit_ids jsonb;rosters jsonb;total_tonnage int;
BEGIN
 IF jsonb_typeof(p_hangar)<>'array' OR jsonb_typeof(p_deployed)<>'array' THEN RAISE EXCEPTION 'Hangar and deployment must be arrays';END IF;
 IF jsonb_array_length(p_hangar)>12 OR jsonb_array_length(p_deployed)>6 THEN RAISE EXCEPTION 'A Skirmish Hangar may hold 12 BattleMechs and deploy 6';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_hangar) entry WHERE jsonb_typeof(entry)<>'object' OR coalesce(entry->>'id','')='' OR coalesce(entry->>'unit_id','')='') THEN RAISE EXCEPTION 'Each hangar entry needs an id and unit id';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_hangar))<>(SELECT count(DISTINCT entry->>'id') FROM jsonb_array_elements(p_hangar) entry) THEN RAISE EXCEPTION 'Each Hangar BattleMech needs a unique id';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Hangars can be changed only by seated players in a lobby';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_hangar) entry WHERE NOT EXISTS (SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=g.catalogue_version AND unit.unit_id=entry->>'unit_id' AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false))) THEN RAISE EXCEPTION 'A hangar contains an unsupported BattleMech';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_hangar) entry WHERE entry->>'id'=deployment)) THEN RAISE EXCEPTION 'Only BattleMechs in your Hangar may be deployed';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements_text(p_deployed))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_deployed)) THEN RAISE EXCEPTION 'A Hangar BattleMech may be deployed once';END IF;
 SELECT coalesce(jsonb_agg(entry->>'unit_id'),'[]'::jsonb) INTO unit_ids FROM jsonb_array_elements(p_hangar) entry WHERE entry->>'id' IN (SELECT value FROM jsonb_array_elements_text(p_deployed));
 SELECT coalesce(sum((unit.definition->>'mass')::int),0) INTO total_tonnage
 FROM jsonb_array_elements(p_hangar) entry
 JOIN btech_catalogue_units unit ON unit.catalogue_version=g.catalogue_version AND unit.unit_id=entry->>'unit_id'
 WHERE entry->>'id' IN (SELECT value FROM jsonb_array_elements_text(p_deployed));
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 IF total_tonnage>coalesce((st->>'dropship_tonnage')::int,0) THEN RAISE EXCEPTION 'Deployed BattleMechs exceed the dropship tonnage limit';END IF;
 avatars:=coalesce(st->'skirmish_avatars','{}'::jsonb);
 avatar:=coalesce(avatars->player.seat_number::text,jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||player.seat_number::text,'callsign','Skirmish Commander P'||player.seat_number::text,'gunnery',4,'piloting',5));
 avatar:=jsonb_set(jsonb_set(avatar,'{hangar}',p_hangar,true),'{deployed}',p_deployed,true);
 avatars:=jsonb_set(avatars,ARRAY[player.seat_number::text],avatar,true);
 rosters:=jsonb_set(coalesce(st->'rosters','{}'::jsonb),ARRAY[player.seat_number::text],unit_ids,true);
 st:=jsonb_set(jsonb_set(st,'{skirmish_avatars}',avatars,true),'{rosters}',rosters,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
 RETURN avatar;
END $$;
REVOKE ALL ON FUNCTION public.update_skirmish_hangar(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_skirmish_hangar(uuid,jsonb,jsonb) TO authenticated;
