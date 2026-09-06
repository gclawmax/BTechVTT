-- AI-2 complete weapon-package authority.
-- Run after SQL/123. The seated human may invoke the existing authoritative
-- weapon resolver for the active AI seat in a Play vs AI match. No combat
-- calculation is added here: human and AI declarations share one resolver.

CREATE OR REPLACE FUNCTION public.btech_authorized_weapon_player(p_game_id uuid)
RETURNS public.btech_players
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  g public.btech_games%ROWTYPE;
  active_player public.btech_players%ROWTYPE;
  st jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before submitting a weapon declaration';END IF;
  SELECT * INTO g FROM public.btech_games WHERE id=p_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found';END IF;
  SELECT * INTO active_player FROM public.btech_players
    WHERE id=g.active_player_id AND game_id=p_game_id AND role='player';
  IF NOT FOUND THEN RAISE EXCEPTION 'The active match seat is invalid';END IF;

  IF active_player.user_id=auth.uid() THEN RETURN active_player;END IF;
  st:=CASE jsonb_typeof(g.state)
    WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb)
    WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
  IF coalesce(active_player.is_ai,false)
     AND coalesce((st->>'vs_ai_mode')::boolean,false)
     AND EXISTS(
       SELECT 1 FROM public.btech_players controller
       WHERE controller.game_id=p_game_id AND controller.user_id=auth.uid()
         AND controller.role='player' AND NOT coalesce(controller.is_ai,false)
     ) THEN
    RETURN active_player;
  END IF;
  RAISE EXCEPTION 'It is not your weapon-attack turn';
END $$;

REVOKE ALL ON FUNCTION public.btech_authorized_weapon_player(uuid) FROM PUBLIC, authenticated;

-- The maintained multi-target resolver was introduced by SQL 74 and amended
-- by later rules migrations. Patch only its player lookup so every subsequent
-- range, arc, ammunition, heat and damage rule remains exactly the same.
DO $$
DECLARE
  fn regprocedure:=to_regprocedure('public.submit_multi_target_weapon_declaration(uuid,text,jsonb)');
  source text;
  patched text;
  marker text:='ai2_authoritative_weapon_actor_v1';
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'Could not locate the authoritative multi-target weapon resolver';END IF;
  source:=pg_get_functiondef(fn);
  IF position(marker IN source)>0 THEN RETURN;END IF;
  patched:=replace(
    source,
    $needle$SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';$needle$,
    $replacement$SELECT * INTO player FROM public.btech_authorized_weapon_player(p_game_id); /* ai2_authoritative_weapon_actor_v1 */$replacement$
  );
  IF patched=source THEN
    patched:=replace(
      source,
      $needle$SELECT * INTO player FROM public.btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';$needle$,
      $replacement$SELECT * INTO player FROM public.btech_authorized_weapon_player(p_game_id); /* ai2_authoritative_weapon_actor_v1 */$replacement$
    );
  END IF;
  IF patched=source OR position(marker IN patched)=0 THEN
    RAISE EXCEPTION 'Could not safely install authoritative AI weapon declarations';
  END IF;
  EXECUTE patched;
END $$;

-- A resolved declaration can change turn ownership immediately. This narrow
-- endpoint lets the same controller finish the already-created audit record
-- afterward without gaining permission to alter BattleMech combat state.
CREATE OR REPLACE FUNCTION public.finalize_ai_decision(p_game_id uuid,p_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  g public.btech_games%ROWTYPE;
  controller public.btech_players%ROWTYPE;
  decision_row public.btech_ai_decisions%ROWTYPE;
  st jsonb;
  history jsonb;
  decision_id_value text;
  status_value text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before finalizing an AI decision';END IF;
  IF jsonb_typeof(p_decision)<>'object' OR pg_column_size(p_decision)>65536 THEN RAISE EXCEPTION 'AI decision envelope is invalid or too large';END IF;
  decision_id_value:=nullif(p_decision->>'decision_id','');
  status_value:=nullif(p_decision->>'status','');
  IF decision_id_value IS NULL OR status_value NOT IN ('completed','failed') OR jsonb_typeof(p_decision->'outcomes')<>'array' THEN
    RAISE EXCEPTION 'Completed AI decision envelope is incomplete';
  END IF;
  SELECT * INTO g FROM public.btech_games WHERE id=p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found';END IF;
  SELECT * INTO controller FROM public.btech_players
    WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player' AND NOT coalesce(is_ai,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the seated human participant may finalize this AI decision';END IF;
  SELECT * INTO decision_row FROM public.btech_ai_decisions
    WHERE game_id=p_game_id AND decision_id=decision_id_value AND controller_user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The planned AI decision was not recorded';END IF;
  IF decision_row.round<>coalesce((p_decision->>'round')::int,-1)
     OR decision_row.phase IS DISTINCT FROM p_decision->>'phase'
     OR decision_row.engine_version IS DISTINCT FROM p_decision->>'engine_version'
     OR decision_row.seed IS DISTINCT FROM p_decision->>'seed'
     OR decision_row.snapshot_hash IS DISTINCT FROM p_decision->>'snapshot_hash' THEN
    RAISE EXCEPTION 'Completed AI decision does not match its planned envelope';
  END IF;

  UPDATE public.btech_ai_decisions SET status=status_value,decision=p_decision,updated_at=now()
    WHERE id=decision_row.id;
  st:=CASE jsonb_typeof(g.state)
    WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb)
    WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
  SELECT coalesce(jsonb_agg(item ORDER BY ordinal),'[]'::jsonb) INTO history
  FROM (
    SELECT item,ordinal FROM jsonb_array_elements(coalesce(st->'ai_decisions','[]'::jsonb)) WITH ORDINALITY saved(item,ordinal)
    WHERE item->>'decision_id' IS DISTINCT FROM decision_id_value
    UNION ALL SELECT p_decision,2147483647
  ) retained;
  IF jsonb_array_length(history)>50 THEN
    SELECT jsonb_agg(item ORDER BY ordinal) INTO history
    FROM (SELECT item,ordinal FROM jsonb_array_elements(history) WITH ORDINALITY entries(item,ordinal) ORDER BY ordinal DESC LIMIT 50) newest;
  END IF;
  st:=jsonb_set(st,'{ai_engine_version}',to_jsonb(p_decision->>'engine_version'),true);
  st:=jsonb_set(st,'{ai_last_decision}',p_decision,true);
  st:=jsonb_set(st,'{ai_decisions}',coalesce(history,'[]'::jsonb),true);
  UPDATE public.btech_games SET state=st WHERE id=p_game_id;
  RETURN jsonb_build_object('finalized',true,'decision_id',decision_id_value,'status',status_value);
END $$;

REVOKE ALL ON FUNCTION public.finalize_ai_decision(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_ai_decision(uuid,jsonb) TO authenticated;

COMMENT ON FUNCTION public.finalize_ai_decision(uuid,jsonb) IS
  'AI-2 audit-only finalizer; updates an existing controller-owned AI decision after authoritative action resolution.';

DO $$
DECLARE source text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.submit_multi_target_weapon_declaration(uuid,text,jsonb)')) INTO source;
  IF position('ai2_authoritative_weapon_actor_v1' IN coalesce(source,''))=0
     OR to_regprocedure('public.finalize_ai_decision(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'AI-2 authoritative weapon package support was not installed';
  END IF;
END $$;
