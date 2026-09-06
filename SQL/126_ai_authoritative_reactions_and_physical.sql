-- AI-5 authoritative reactions, prone support and physical attacks.
-- Run after SQL 125. This changes only actor authorization: all validation,
-- dice, damage, falls, displacement and criticals remain in existing resolvers.

CREATE OR REPLACE FUNCTION public.btech_authorized_ai_phase_player(p_game_id uuid)
RETURNS public.btech_players LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.btech_games%ROWTYPE;actor public.btech_players%ROWTYPE;st jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before submitting an action';END IF;
 SELECT * INTO g FROM public.btech_games WHERE id=p_game_id;
 SELECT * INTO actor FROM public.btech_players WHERE id=g.active_player_id AND game_id=p_game_id AND role='player';
 IF NOT FOUND THEN RAISE EXCEPTION 'The active match seat is invalid';END IF;
 IF actor.user_id=auth.uid() THEN RETURN actor;END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN g.state ELSE '{}'::jsonb END;
 IF coalesce(actor.is_ai,false) AND coalesce((st->>'vs_ai_mode')::boolean,false) AND EXISTS(SELECT 1 FROM public.btech_players controller WHERE controller.game_id=p_game_id AND controller.user_id=auth.uid() AND controller.role='player' AND NOT coalesce(controller.is_ai,false)) THEN RETURN actor;END IF;
 RAISE EXCEPTION 'It is not your active phase';
END $$;
REVOKE ALL ON FUNCTION public.btech_authorized_ai_phase_player(uuid) FROM PUBLIC,authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;signature text;marker text:='ai5_authoritative_phase_actor_v1';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.submit_torso_twist_reaction(uuid,text,integer)',
  'public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[])',
  'public.set_prone_weapon_support_arm(uuid,text,text)',
  'public.find_improvised_club(uuid,text)',
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
  IF patched=source OR position(marker IN patched)=0 THEN RAISE EXCEPTION 'Could not safely authorize AI action in %',signature;END IF;
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
  '(''move'',''complete_movement'',''attempt_stand'',''remain_prone'',''attempt_startup'',''declare_charge'',''declare_dfa'') /* ai5_action_contract_v1 */');END IF;
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
 IF position('ai5_action_contract_v1' IN patched)=0 OR position('''declare_charge''' IN patched)=0 OR position('''resolve_dfa''' IN patched)=0 OR position('''find_club''' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend AI-5 action contracts';END IF;
 EXECUTE patched;
END $$;

DO $$ DECLARE source text;audit_source text;BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[])')) INTO source;
 IF position('ai5_authoritative_phase_actor_v1' IN coalesce(source,''))=0 THEN RAISE EXCEPTION 'AI-5 physical authority was not installed';END IF;
 SELECT pg_get_functiondef(to_regprocedure('public.submit_ai_phase_state(uuid,jsonb,jsonb)')) INTO audit_source;
 IF position('''declare_charge''' IN coalesce(audit_source,''))=0 OR position('''resolve_dfa''' IN coalesce(audit_source,''))=0 OR position('''find_club''' IN coalesce(audit_source,''))=0 THEN RAISE EXCEPTION 'AI-5 decision contracts were not installed completely';END IF;
END $$;

NOTIFY pgrst,'reload schema';
