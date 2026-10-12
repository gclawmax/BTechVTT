-- 165_lobby_placeholder_retention.sql
-- Idle lobby placeholders currently leak forever when a browser closes
-- mid-setup (the in-app Leave path already deletes the row; abandoned tabs
-- have no cleanup). Verified 6/7 Oct: ~50 such rows had accumulated since
-- 11 Aug, newest still 'lobby' with nobody in it. A match lobby older than
-- the cutoff that was never started is dead data by definition — real
-- sessions do not spend days in an unstarted lobby, and STARTED matches run
-- as 'in-progress' until settled, so they are never in this scope.
-- Mirrors the shape of SQL/103's retention job (SECURITY DEFINER, not
-- client-callable, guarded pg_cron schedule at 03:35 so it staggers the
-- existing 03:15 skirmish-retention job). Career settlements keep their
-- ON DELETE RESTRICT protection via NOT EXISTS.
-- Tested on a throwaway Postgres 17 harness (fixture + 8 assertions) before
-- being offered for live apply.

CREATE OR REPLACE FUNCTION public.run_btech_lobby_placeholder_cleanup(p_before timestamptz DEFAULT now()-interval '3 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE expired_ids uuid[];removed_seats int:=0;removed_lobbies int:=0;
BEGIN
 SELECT coalesce(array_agg(g.id),'{}'::uuid[]) INTO expired_ids FROM btech_games g
 WHERE g.status='lobby' AND g.created_at<p_before
  AND NOT EXISTS(SELECT 1 FROM btech_career_settlements s WHERE s.game_id=g.id);
 IF cardinality(expired_ids)=0 THEN RETURN jsonb_build_object('deleted_lobbies',0,'deleted_seat_rows',0,'cutoff',p_before);END IF;
 DELETE FROM btech_players WHERE game_id=ANY(expired_ids);GET DIAGNOSTICS removed_seats=ROW_COUNT;
 DELETE FROM btech_games WHERE id=ANY(expired_ids);GET DIAGNOSTICS removed_lobbies=ROW_COUNT;
 RETURN jsonb_build_object('deleted_lobbies',removed_lobbies,'deleted_seat_rows',removed_seats,'cutoff',p_before);
END $$;
REVOKE ALL ON FUNCTION public.run_btech_lobby_placeholder_cleanup(timestamptz) FROM PUBLIC;

DO $lobby_retention$ DECLARE already_scheduled boolean:=false;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=''btvtt-lobby-retention'')' INTO already_scheduled;
  IF NOT already_scheduled THEN EXECUTE $cron$SELECT cron.schedule('btvtt-lobby-retention','35 3 * * *','SELECT public.run_btech_lobby_placeholder_cleanup()')$cron$;END IF;
 END IF;
END $lobby_retention$;
