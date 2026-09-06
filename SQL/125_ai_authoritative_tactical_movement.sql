-- AI-3 tactical movement authority. Run after SQL 124.
-- The human controller of a Play-vs-AI match may invoke the existing movement,
-- stand, prone and startup resolvers for the active AI seat. All paths, MP,
-- terrain, heat and piloting checks continue through the human rules engine.

CREATE OR REPLACE FUNCTION public.btech_authorized_movement_player(p_game_id uuid)
RETURNS public.btech_players LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.btech_games%ROWTYPE; actor public.btech_players%ROWTYPE; st jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before submitting movement';END IF;
 SELECT * INTO g FROM public.btech_games WHERE id=p_game_id;
 SELECT * INTO actor FROM public.btech_players WHERE id=g.active_player_id AND game_id=p_game_id AND role='player';
 IF NOT FOUND THEN RAISE EXCEPTION 'The active match seat is invalid';END IF;
 IF actor.user_id=auth.uid() THEN RETURN actor;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
 IF coalesce(actor.is_ai,false) AND coalesce((st->>'vs_ai_mode')::boolean,false) AND EXISTS(
   SELECT 1 FROM public.btech_players controller WHERE controller.game_id=p_game_id AND controller.user_id=auth.uid() AND controller.role='player' AND NOT coalesce(controller.is_ai,false)
 ) THEN RETURN actor;END IF;
 RAISE EXCEPTION 'It is not your Movement activation';
END $$;
REVOKE ALL ON FUNCTION public.btech_authorized_movement_player(uuid) FROM PUBLIC, authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;signature text;marker text:='ai3_authoritative_movement_actor_v1';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.submit_battlemech_movement(uuid,text,text,jsonb)',
  'public.attempt_stand_battlemech(uuid,text)',
  'public.remain_prone_battlemech(uuid,text)',
  'public.attempt_startup_battlemech(uuid,text)'
 ] LOOP
  fn:=to_regprocedure(signature);IF fn IS NULL THEN RAISE EXCEPTION 'Could not locate %',signature;END IF;
  source:=pg_get_functiondef(fn);IF position(marker IN source)>0 THEN CONTINUE;END IF;
  patched:=replace(source,
   'SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';',
   'SELECT * INTO player FROM public.btech_authorized_movement_player(p_game_id); /* ai3_authoritative_movement_actor_v1 */');
  IF patched=source THEN patched:=replace(source,
   'SELECT * INTO player FROM public.btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';',
   'SELECT * INTO player FROM public.btech_authorized_movement_player(p_game_id); /* ai3_authoritative_movement_actor_v1 */');END IF;
  IF patched=source OR position(marker IN patched)=0 THEN RAISE EXCEPTION 'Could not safely authorize AI movement in %',signature;END IF;
  EXECUTE patched;
 END LOOP;
END $$;

-- Extend the AI audit contract for the three explicit special movement choices.
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.submit_ai_phase_state(uuid,jsonb,jsonb)');source text;patched text;marker text:='ai3_movement_actions_v1';
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'SQL 123 AI decision gateway is missing';END IF;
 source:=pg_get_functiondef(fn);IF position(marker IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'WHEN ''movement'' THEN action.value->>''type'' NOT IN (''move'',''complete_movement'')',
  'WHEN ''movement'' THEN action.value->>''type'' NOT IN (''move'',''complete_movement'',''attempt_stand'',''remain_prone'',''attempt_startup'') /* ai3_movement_actions_v1 */');
 IF patched=source OR position(marker IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend the AI movement audit contract';END IF;
 EXECUTE patched;
END $$;

DO $$ DECLARE source text;
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)')) INTO source;
 IF position('ai3_authoritative_movement_actor_v1' IN coalesce(source,''))=0 THEN RAISE EXCEPTION 'AI-3 authoritative movement was not installed';END IF;
END $$;
