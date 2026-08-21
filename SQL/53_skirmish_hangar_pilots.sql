-- Match-scoped pilots belong to individual Skirmish Hangar entries. The
-- embedded shape is deliberately suitable for promotion to a persistent
-- Avatar or hired-pilot record later. Existing entries are upgraded to a
-- named 4/5 MechWarrior the next time their Hangar is saved.

CREATE OR REPLACE FUNCTION public.update_skirmish_hangar(p_game_id uuid,p_hangar jsonb,p_deployed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 g btech_games%ROWTYPE; player btech_players%ROWTYPE; st jsonb; avatars jsonb; avatar jsonb;
 unit_ids jsonb; rosters jsonb; total_tonnage int; entry jsonb; pilot jsonb; normalized_hangar jsonb:='[]'::jsonb;
BEGIN
 IF jsonb_typeof(p_hangar)<>'array' OR jsonb_typeof(p_deployed)<>'array' THEN RAISE EXCEPTION 'Hangar and deployment must be arrays';END IF;
 IF jsonb_array_length(p_hangar)>12 OR jsonb_array_length(p_deployed)>6 THEN RAISE EXCEPTION 'A Skirmish Hangar may hold 12 BattleMechs and deploy 6';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_hangar) item WHERE jsonb_typeof(item)<>'object' OR coalesce(item->>'id','')='' OR coalesce(item->>'unit_id','')='') THEN RAISE EXCEPTION 'Each hangar entry needs an id and unit id';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_hangar))<>(SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_hangar) item) THEN RAISE EXCEPTION 'Each Hangar BattleMech needs a unique id';END IF;

 FOR entry IN SELECT value FROM jsonb_array_elements(p_hangar) LOOP
  pilot:=entry->'pilot';
  IF pilot IS NULL THEN
   pilot:=jsonb_build_object('id','pilot-'||(entry->>'id'),'name','MechWarrior','gunnery',4,'piloting',5);
  ELSE
   IF jsonb_typeof(pilot)<>'object' THEN RAISE EXCEPTION 'Each BattleMech pilot must be an object';END IF;
   IF length(btrim(coalesce(pilot->>'name','')))<1 OR length(btrim(pilot->>'name'))>48 THEN RAISE EXCEPTION 'Pilot names must be between 1 and 48 characters';END IF;
   IF coalesce(pilot->>'gunnery','') !~ '^[0-8]$' OR coalesce(pilot->>'piloting','') !~ '^[0-8]$' THEN RAISE EXCEPTION 'Gunnery and Piloting must be whole numbers from 0 to 8';END IF;
   pilot:=jsonb_build_object(
    'id',coalesce(nullif(pilot->>'id',''),'pilot-'||(entry->>'id')),
    'name',btrim(pilot->>'name'),
    'gunnery',(pilot->>'gunnery')::int,
    'piloting',(pilot->>'piloting')::int
   );
  END IF;
  normalized_hangar:=normalized_hangar||jsonb_build_array(jsonb_set(entry,'{pilot}',pilot,true));
 END LOOP;

 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'Hangars can be changed only by seated players in a lobby';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE NOT EXISTS (SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=g.catalogue_version AND unit.unit_id=item->>'unit_id' AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false))) THEN RAISE EXCEPTION 'A hangar contains an unsupported BattleMech';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(normalized_hangar) item WHERE item->>'id'=deployment.entry_id)) THEN RAISE EXCEPTION 'Only BattleMechs in your Hangar may be deployed';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements_text(p_deployed))<>(SELECT count(DISTINCT entry_id) FROM jsonb_array_elements_text(p_deployed) deployment(entry_id)) THEN RAISE EXCEPTION 'A Hangar BattleMech may be deployed once';END IF;

 SELECT coalesce(jsonb_agg(item.entry->>'unit_id' ORDER BY deployment.ordinality),'[]'::jsonb) INTO unit_ids
 FROM jsonb_array_elements_text(p_deployed) WITH ORDINALITY deployment(entry_id,ordinality)
 JOIN LATERAL (SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>'id'=deployment.entry_id) item ON true;
 SELECT coalesce(sum((unit.definition->>'mass')::int),0) INTO total_tonnage
 FROM jsonb_array_elements_text(p_deployed) deployment(entry_id)
 JOIN LATERAL (SELECT value AS entry FROM jsonb_array_elements(normalized_hangar) WHERE value->>'id'=deployment.entry_id) item ON true
 JOIN btech_catalogue_units unit ON unit.catalogue_version=g.catalogue_version AND unit.unit_id=item.entry->>'unit_id';

 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 IF total_tonnage>coalesce((st->>'dropship_tonnage')::int,0) THEN RAISE EXCEPTION 'Deployed BattleMechs exceed the dropship tonnage limit';END IF;
 avatars:=coalesce(st->'skirmish_avatars','{}'::jsonb);
 avatar:=coalesce(avatars->player.seat_number::text,jsonb_build_object('id','skirmish-'||p_game_id::text||'-p'||player.seat_number::text,'callsign','Skirmish Commander P'||player.seat_number::text,'gunnery',4,'piloting',5));
 avatar:=jsonb_set(jsonb_set(avatar,'{hangar}',normalized_hangar,true),'{deployed}',p_deployed,true);
 avatars:=jsonb_set(avatars,ARRAY[player.seat_number::text],avatar,true);
 rosters:=jsonb_set(coalesce(st->'rosters','{}'::jsonb),ARRAY[player.seat_number::text],unit_ids,true);
 st:=jsonb_set(jsonb_set(st,'{skirmish_avatars}',avatars,true),'{rosters}',rosters,true);
 UPDATE btech_games SET state=st WHERE id=p_game_id;
 RETURN avatar;
END $$;

REVOKE ALL ON FUNCTION public.update_skirmish_hangar(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_skirmish_hangar(uuid,jsonb,jsonb) TO authenticated;
