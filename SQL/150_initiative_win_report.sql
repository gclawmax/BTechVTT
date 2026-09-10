-- Run after 149. Count resolved rounds, never individual rolls or ties.
CREATE OR REPLACE FUNCTION public.btech_initiative_win_statistics(p_game_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH candidates AS (
  SELECT round,event_index AS priority,payload->'rolls' AS rolls
  FROM btech_match_telemetry WHERE game_id=p_game_id AND event_type='initiative_updated'
  UNION ALL
  SELECT i.round,-1,jsonb_agg(jsonb_build_object('seat_number',p.seat_number,'roll',i.roll))
  FROM btech_initiative i JOIN btech_players p ON p.id=i.player_id
  WHERE i.game_id=p_game_id GROUP BY i.round
 ), resolved AS (
  SELECT round,priority,max((r->>'roll')::int) FILTER (WHERE r->>'seat_number'='1') AS first_roll,
   max((r->>'roll')::int) FILTER (WHERE r->>'seat_number'='2') AS second_roll
  FROM candidates CROSS JOIN LATERAL jsonb_array_elements(coalesce(rolls,'[]')) r
  GROUP BY round,priority
 ), winners AS (
  SELECT DISTINCT ON (round) round,CASE WHEN first_roll>second_roll THEN 1 ELSE 2 END AS seat
  FROM resolved WHERE first_roll IS NOT NULL AND second_roll IS NOT NULL AND first_roll<>second_roll
  ORDER BY round,priority DESC
 )
 SELECT jsonb_build_object('1',jsonb_build_object('initiative_wins',count(*) FILTER(WHERE seat=1),'initiative_rounds_recorded',count(*)),
 '2',jsonb_build_object('initiative_wins',count(*) FILTER(WHERE seat=2),'initiative_rounds_recorded',count(*))) FROM winners
$$;
REVOKE ALL ON FUNCTION public.btech_initiative_win_statistics(uuid) FROM PUBLIC;

-- Preserve seats in AI telemetry too, without copying account identifiers.
DO $$
DECLARE source text;patched text;
BEGIN
 SELECT pg_get_functiondef('public.btech_capture_game_state_telemetry()'::regprocedure) INTO source;
 IF position('initiative_seats_v1' IN source)=0 THEN
  patched:=replace(source,$old$jsonb_agg(value-'player_id'-'user_id')$old$, $new$jsonb_agg((value-'player_id'-'user_id') || jsonb_build_object('seat_number',coalesce(value->'seat_number',(SELECT entry->'seat_number' FROM jsonb_array_elements(coalesce(new_state->'initiative_order','[]')) AS order_rows(entry) WHERE entry->>'player_id'=value->>'player_id' LIMIT 1)))) /* initiative_seats_v1 */$new$);
  IF patched=source THEN RAISE EXCEPTION 'Could not add initiative seats to telemetry';END IF;
  EXECUTE patched;
 END IF;
 SELECT pg_get_functiondef('public.btech_build_match_statistics(uuid)'::regprocedure) INTO source;
 IF position('initiative_wins_v1' IN source)=0 THEN
  patched:=replace(source,' RETURN jsonb_build_object(',E' -- initiative_wins_v1
 FOR seat_key IN SELECT unnest(ARRAY[''1'',''2'']) LOOP
  players:=jsonb_set(players,ARRAY[seat_key],coalesce(players->seat_key,''{}''::jsonb)||(btech_initiative_win_statistics(p_game_id)->seat_key),true);
 END LOOP;
 RETURN jsonb_build_object(');
  IF patched=source THEN RAISE EXCEPTION 'Could not add initiative totals to statistics';END IF;
  EXECUTE patched;
 END IF;
END $$;

-- Enrich existing sealed reports without recalculating their combat results.
UPDATE btech_match_reports r SET report=jsonb_set(r.report,'{statistics,players}',
 (r.report#>'{statistics,players}') || jsonb_build_object(
 '1',coalesce(r.report#>'{statistics,players,1}','{}'::jsonb)||(btech_initiative_win_statistics(r.game_id)->'1'),
 '2',coalesce(r.report#>'{statistics,players,2}','{}'::jsonb)||(btech_initiative_win_statistics(r.game_id)->'2')))
WHERE jsonb_typeof(r.report#>'{statistics,players}')='object';
