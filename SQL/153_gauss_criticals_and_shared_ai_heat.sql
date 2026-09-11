-- Run after 152. Shared heat authority and per-rifle Gauss explosions.
-- No historical combat state is rewritten: old missing ammunition deductions
-- cannot be reconstructed safely from incomplete local firing records.
BEGIN;
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');source text;patched text;old_guard text;new_guard text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Critical resolver missing';END IF;
 source:=pg_get_functiondef(fn);
 IF position('gauss_mount_explosion_v153' IN source)>0 THEN RETURN;END IF;
 old_guard:=$old$  gauss_already_damaged:=false;
  IF slot_key='gaussrifle' AND version_id IS NOT NULL THEN
   SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots prior_slot
    WHERE prior_slot.catalogue_version=version_id AND prior_slot.unit_id=m->>'unitId' AND prior_slot.label=slot_label
     AND btech_critical_slot_is_damaged(m,prior_slot.location,prior_slot.slot_index)) INTO gauss_already_damaged;
  END IF;$old$;
 new_guard:=$new$  -- Check the individual mount BEFORE marking this critical slot.
  -- Identical rifles elsewhere on the chassis must explode independently.
  gauss_already_damaged:=false;
  IF slot_key IN ('gaussrifle','lightgaussrifle','heavygaussrifle') AND version_id IS NOT NULL THEN
   destroyed_mount:=btech_mount_for_critical_slot(version_id,m->>'unitId',loc,chosen,slot_label);
   IF destroyed_mount IS NULL THEN RAISE EXCEPTION 'Cannot identify Gauss mount for % slot %',loc,chosen;END IF;
   gauss_already_damaged:=btech_weapon_mount_destroyed(version_id,m,destroyed_mount);
  END IF; /* gauss_mount_explosion_v153 */$new$;
 patched:=replace(source,old_guard,new_guard);
 IF patched=source THEN RAISE EXCEPTION 'Could not safely replace Gauss mount guard';END IF;
 source:=patched;
 patched:=replace(source,$old$  IF slot_key='gaussrifle' AND NOT gauss_already_damaged THEN
   m:=btech_apply_internal_damage(m,loc,20);
   events:=events||jsonb_build_array(jsonb_build_object('location',loc,'gauss_explosion',true,'damage',20));
  END IF;$old$,$new$  IF slot_key IN ('gaussrifle','lightgaussrifle','heavygaussrifle') AND NOT gauss_already_damaged THEN
   ammo_damage:=CASE slot_key WHEN 'lightgaussrifle' THEN 16 WHEN 'heavygaussrifle' THEN 25 ELSE 20 END;
   ammo_result:=btech_apply_ammunition_explosion(m,loc,ammo_damage);m:=ammo_result->'mech';
   events:=events||jsonb_build_array(jsonb_build_object('location',loc,'mount_id',destroyed_mount,'gauss_explosion',true,'damage',ammo_damage,'case_protected',ammo_result->'case_protected','vented_damage',ammo_result->'vented_damage','pilot_checks',ammo_result->'pilot_checks'));
  END IF;$new$);
 IF patched=source THEN RAISE EXCEPTION 'Could not safely replace Gauss explosion damage';END IF;
 -- Even an empty struck bin is destroyed; inert bins never invoke damage.
 patched:=replace(patched,'AND coalesce((bin->>''shots'')::int,0)>0 AND NOT coalesce((bin->>''destroyed'')::boolean,false) THEN',
  'AND NOT coalesce((bin->>''destroyed'')::boolean,false) THEN');
 EXECUTE patched;
END $$;

-- AI controllers use the same heat ledger, cooling, shutdown, ammunition,
-- pilot injury and activation scheduler as a human seat. The authorization
-- helper only permits the seated controller of an explicitly marked AI match.
DO $$
DECLARE fn regprocedure;source text;patched text;signature text;
BEGIN
 IF to_regprocedure('public.btech_authorized_ai_phase_player(uuid)') IS NULL THEN RAISE EXCEPTION 'SQL 126 is required';END IF;
 FOREACH signature IN ARRAY ARRAY['public.resolve_heat_management(uuid)','public.declare_shutdown_override(uuid,text)'] LOOP
  fn:=to_regprocedure(signature);IF fn IS NULL THEN RAISE EXCEPTION 'Missing %',signature;END IF;
  source:=pg_get_functiondef(fn);
  IF position('shared_ai_heat_v153' IN source)>0 THEN CONTINUE;END IF;
  patched:=replace(source,$old$SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';$old$,
   'SELECT * INTO player FROM public.btech_authorized_ai_phase_player(p_game_id); /* shared_ai_heat_v153 */');
  IF patched=source THEN RAISE EXCEPTION 'Could not safely authorize shared AI heat in %',signature;END IF;
  EXECUTE patched;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
