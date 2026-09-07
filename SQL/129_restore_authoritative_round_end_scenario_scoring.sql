-- GM-3 follow-up: reattach objective scoring to the currently maintained Heat
-- resolver. SQL/128 defines the scorer; this migration guarantees the scorer
-- is called after the round advances, even if a later Heat migration replaced
-- the historical SQL/75 patch point.
-- Run after SQL/128_authoritative_game_mode_matrix.sql.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat Management resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('gm3_round_end_scenario_scoring_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'PERFORM submit_phase_state_nonphysical_core(p_game_id,units);RETURN jsonb_build_object(''results'',results);',
  'PERFORM submit_phase_state_nonphysical_core(p_game_id,units);PERFORM btech_score_scenario_round(p_game_id,g.current_round); /* gm3_round_end_scenario_scoring_v1 */ RETURN jsonb_build_object(''results'',results);');
 IF patched=source THEN
  patched:=replace(source,
   'PERFORM submit_phase_state_nonphysical_core(p_game_id, units); RETURN jsonb_build_object(''results'', results);',
   'PERFORM submit_phase_state_nonphysical_core(p_game_id, units); PERFORM btech_score_scenario_round(p_game_id,g.current_round); /* gm3_round_end_scenario_scoring_v1 */ RETURN jsonb_build_object(''results'', results);');
 END IF;
 IF patched=source OR position('gm3_round_end_scenario_scoring_v1' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely restore authoritative round-end scenario scoring';
 END IF;
 EXECUTE patched;
END $$;
