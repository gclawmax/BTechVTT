-- SQL/166 — Finished matches must stop looking Active (soak forensics 2026-11-20).
--
-- When a battle reaches a decisive result, the state-capture trigger (SQL/100)
-- already writes match_completed telemetry and seals the match report — but the
-- btech_games row keeps status='in-progress' forever (only career settlement
-- flips it, SQL/135). Consequences measured live: every step-0 soak game that
-- ended by destruction sat as an Active zombie (10/10 end-phase games, no
-- exceptions), rejoin offered finished matches, and the step-0 rig kept
-- grinding rounds after the battle was decided because its round loop breaks
-- on status='finished'.
--
-- Flip skirmish/coop games to 'finished' at the moment match_result first
-- appears in state, regardless of which write path delivered it (2p resolve
-- RPC, vs-AI direct write, concede RPC). Career games are untouched: their
-- settlement path flips status itself after paying rewards.
--
-- Note: the trigger is restricted to UPDATE OF state, and the inner UPDATE
-- touches only status/completed_at, so it cannot re-fire itself. The capture
-- trigger tolerates a status-only update (its guard and per-row checks all
-- no-op when state is unchanged).

CREATE OR REPLACE FUNCTION public.btech_finish_game_on_match_result()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE old_state jsonb:=CASE jsonb_typeof(OLD.state) WHEN 'string' THEN (OLD.state#>>'{}')::jsonb ELSE OLD.state END;
 new_state jsonb:=CASE jsonb_typeof(NEW.state) WHEN 'string' THEN (NEW.state#>>'{}')::jsonb ELSE NEW.state END;
BEGIN
 IF NEW.status='in-progress' AND coalesce(NEW.match_type,'skirmish')<>'career'
    AND (old_state->'match_result' IS NULL OR old_state->'match_result'='null'::jsonb)
    AND new_state->'match_result' IS NOT NULL AND new_state->'match_result'<>'null'::jsonb THEN
  UPDATE btech_games SET status='finished' WHERE id=NEW.id AND status='in-progress';
 END IF;
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS btech_finish_game_on_match_result_trigger ON public.btech_games;
CREATE TRIGGER btech_finish_game_on_match_result_trigger AFTER UPDATE OF state ON public.btech_games
 FOR EACH ROW EXECUTE FUNCTION public.btech_finish_game_on_match_result();