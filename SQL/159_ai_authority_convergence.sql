-- 159_ai_authority_convergence.sql
-- Run after SQL 158. Safe to rerun (marker-guarded; skips what is already
-- installed). Best-effort convergence for the partial live application of
-- SQL 126 identified by Step 0 Battle B v11 (see 158 header).
--
-- SQL 126 patches nine functions' actor authorization and extends the
-- submit_ai_phase_state AI-5 decision contract, but it has no explicit
-- transaction, so a substitution failure aborts the remaining statements
-- while earlier EXECUTEd functions stay installed. Live evidence shows the
-- weapon and physical packages patched but find_improvised_club unpatched
-- (fixed directly by SQL 158). The functions and contract in this file are
-- the rest of SQL 126's scope, re-applied idempotently:
--
--   * set_prone_weapon_support_arm      (AI bracing while prone)
--   * declare_death_from_above          (AI DFA declaration)
--   * declare_charge_attack             (AI charge declaration)
--   * resolve_push_attack_legacy        (legacy resolver paths)
--   * resolve_declared_charge_legacy
--   * resolve_declared_death_from_above_legacy
--   * submit_ai_phase_state contract    (ai5_action_contract_v1: movement
--                                         gains declare_charge/declare_dfa,
--                                         physical gains resolve_charge/
--                                         resolve_dfa, weapon_attack gains
--                                         find_club)
--
-- Each function is skipped when its ai5 marker is already present. If a
-- function's live text no longer matches SQL 126's expected pre-patch
-- string, this migration RAISEs naming that function so the drift can be
-- resolved deliberately rather than silently.

DO $$
DECLARE fn regprocedure;source text;patched text;signature text;marker text:='ai5_authoritative_phase_actor_v1';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.set_prone_weapon_support_arm(uuid,text,text)',
  'public.declare_death_from_above(uuid,text,text,integer,integer,integer)',
  'public.declare_charge_attack(uuid,text,text,integer,integer,integer,text,integer,integer)',
  'public.resolve_push_attack_legacy(uuid,text,text)',
  'public.resolve_declared_charge_legacy(uuid,text)',
  'public.resolve_declared_death_from_above_legacy(uuid,text)'
 ] LOOP
  fn:=to_regprocedure(signature);IF fn IS NULL THEN RAISE EXCEPTION 'Could not locate %',signature;END IF;
  source:=pg_get_functiondef(fn);IF position(marker IN source)>0 THEN CONTINUE;END IF;
  patched:=replace(source,'SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';','SELECT * INTO player FROM public.btech_authorized_ai_phase_player(p_game_id); /* ai5_authoritative_phase_actor_v1 */');
  IF patched=source THEN patched:=replace(source,'SELECT * INTO player FROM public.btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role=''player'';','SELECT * INTO player FROM public.btech_authorized_ai_phase_player(p_game_id); /* ai5_authoritative_phase_actor_v1 */');END IF;
  IF patched=source OR position(marker IN patched)=0 THEN RAISE EXCEPTION 'Could not safely authorize AI action in % (live definition drifted from the expected SQL 126 pre-patch text)',signature;END IF;
  EXECUTE patched;
 END LOOP;
END $$;

DO $$
DECLARE fn regprocedure:=to_regprocedure('public.submit_ai_phase_state(uuid,jsonb,jsonb)');source text;patched text;marker text:='ai5_action_contract_v1';
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'SQL 123 AI decision gateway is missing';END IF;
 source:=pg_get_functiondef(fn);IF position(marker IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  '(''move'', ''complete_movement'', ''attempt_stand'', ''remain_prone'', ''attempt_startup'')',
  '(''move'', ''complete_movement'', ''attempt_stand'', ''remain_prone'', ''attempt_startup'', ''declare_charge'', ''declare_dfa'') /* ai5_action_contract_v1 */');
 IF patched=source THEN patched:=replace(source,
  '(''move'',''complete_movement'',''attempt_stand'',''remain_prone'',''attempt_startup'')',
  '(''move'',''complete_movement'',''attempt_stand'',''remain_prone'',''attempt_startup'',''declare_charge'',''declare_dfa'')');END IF;
 patched:=replace(patched,
  '(''physical_attack'', ''no_physical_attack'')',
  '(''physical_attack'', ''resolve_charge'', ''resolve_dfa'', ''no_physical_attack'')');
 IF position('''resolve_dfa''' IN patched)=0 THEN patched:=replace(patched,
  '(''physical_attack'',''no_physical_attack'')',
  '(''physical_attack'',''resolve_charge'',''resolve_dfa'',''no_physical_attack'')');END IF;
 patched:=replace(patched,
  '(''attack'', ''no_fire'')',
  '(''attack'', ''find_club'', ''no_fire'')');
 IF position('''find_club''' IN patched)=0 THEN patched:=replace(patched,
  '(''attack'',''no_fire'')',
  '(''attack'',''find_club'',''no_fire'')');END IF;
 IF position('ai5_action_contract_v1' IN patched)=0 OR position('''declare_charge''' IN patched)=0 OR position('''resolve_dfa''' IN patched)=0 OR position('''find_club''' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend AI-5 action contracts (live SQL 123 definition drifted)';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE signatures text[]:=ARRAY[
 'public.set_prone_weapon_support_arm(uuid,text,text)',
 'public.find_improvised_club(uuid,text)',
 'public.declare_death_from_above(uuid,text,text,integer,integer,integer)',
 'public.declare_charge_attack(uuid,text,text,integer,integer,integer,text,integer,integer)',
 'public.resolve_push_attack_legacy(uuid,text,text)',
 'public.resolve_declared_charge_legacy(uuid,text)',
 'public.resolve_declared_death_from_above_legacy(uuid,text)'
];fn regprocedure;source text;missing text[]:=ARRAY[]::text[];
BEGIN
 FOREACH signature IN ARRAY signatures LOOP
  fn:=to_regprocedure(signature);
  IF fn IS NULL THEN missing:=array_append(missing,signature||' (missing)');CONTINUE;END IF;
  source:=pg_get_functiondef(fn);
  IF position('ai5_authoritative_phase_actor_v1' IN coalesce(source,''))=0 THEN missing:=array_append(missing,signature);END IF;
 END LOOP;
 SELECT pg_get_functiondef(to_regprocedure('public.submit_ai_phase_state(uuid,jsonb,jsonb)')) INTO source;
 IF position('ai5_action_contract_v1' IN coalesce(source,''))=0 OR position('''declare_charge''' IN coalesce(source,''))=0 OR position('''resolve_dfa''' IN coalesce(source,''))=0 OR position('''find_club''' IN coalesce(source,''))=0 THEN missing:=array_append(missing,'submit_ai_phase_state contract');END IF;
 IF array_length(missing,1) IS NOT NULL THEN RAISE EXCEPTION 'AI authority still absent in: %',array_to_string(missing,', ');END IF;
END $$;

NOTIFY pgrst,'reload schema';
