-- Career-1b recovery: let the human controller advance a Play-vs-AI activation
-- through the existing authoritative scheduler. SQL 125 authorizes the movement
-- resolver itself, but the resolver then invokes the older shared scheduler,
-- which still rejected the active AI seat as "not your turn".
--
-- Run after SQL 135. This applies to existing Career and normal Play-vs-AI
-- matches; it does not change movement, heat, terrain, or turn-order rules.

DO $$
DECLARE
  fn regprocedure:=to_regprocedure('public.submit_phase_state_nonphysical_core(uuid,jsonb)');
  source text;
  patched text;
  marker text:='career1b_ai_phase_state_actor_v1';
BEGIN
  IF fn IS NULL THEN
    RAISE EXCEPTION 'Could not locate the non-physical phase scheduler';
  END IF;
  IF to_regprocedure('public.btech_authorized_ai_phase_player(uuid)') IS NULL THEN
    RAISE EXCEPTION 'AI phase authorization is missing; run SQL 126 first';
  END IF;

  source:=pg_get_functiondef(fn);
  IF position(marker IN source)>0 THEN
    RETURN;
  END IF;

  patched:=replace(source,
    'SELECT * INTO v_player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';',
    'SELECT * INTO v_player FROM public.btech_authorized_ai_phase_player(p_game_id); /* career1b_ai_phase_state_actor_v1 */');
  IF patched=source THEN
    patched:=replace(source,
      'SELECT * INTO v_player FROM btech_players WHERE game_id = p_game_id AND user_id = auth.uid() AND role = ''player'';',
      'SELECT * INTO v_player FROM public.btech_authorized_ai_phase_player(p_game_id); /* career1b_ai_phase_state_actor_v1 */');
  END IF;
  IF patched=source THEN
    patched:=replace(source,
      'SELECT * INTO v_player FROM public.btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';',
      'SELECT * INTO v_player FROM public.btech_authorized_ai_phase_player(p_game_id); /* career1b_ai_phase_state_actor_v1 */');
  END IF;
  IF patched=source OR position(marker IN patched)=0 THEN
    RAISE EXCEPTION 'Could not safely install Career AI activation authorization';
  END IF;
  EXECUTE patched;
END $$;

DO $$
DECLARE source text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.submit_phase_state_nonphysical_core(uuid,jsonb)')) INTO source;
  IF position('career1b_ai_phase_state_actor_v1' IN coalesce(source,''))=0 THEN
    RAISE EXCEPTION 'Career AI activation authorization was not installed';
  END IF;
END $$;

NOTIFY pgrst,'reload schema';
