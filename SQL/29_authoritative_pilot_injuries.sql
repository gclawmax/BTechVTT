-- Server-authoritative pilot injuries, consciousness and recovery.
-- Run after SQL/28_authoritative_startup.sql.

CREATE OR REPLACE FUNCTION public.btech_pilot_consciousness_target(p_hits int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_hits WHEN 1 THEN 3 WHEN 2 THEN 5 WHEN 3 THEN 7 WHEN 4 THEN 9 WHEN 5 THEN 11 ELSE CASE WHEN p_hits>=6 THEN 99 ELSE 2 END END
$$;
REVOKE ALL ON FUNCTION public.btech_pilot_consciousness_target(int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_apply_pilot_hit(p_mech jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE m jsonb:=p_mech;pilot jsonb:=coalesce(p_mech->'pilot','{"hits":0,"consciousness":"conscious"}'::jsonb);
 hits int;target_number int;die_a int;die_b int;consciousness text;
BEGIN
 hits:=coalesce((pilot->>'hits')::int,0)+1;target_number:=btech_pilot_consciousness_target(hits);
 IF hits>=6 THEN consciousness:='dead';m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);die_a:=NULL;die_b:=NULL;
 ELSE
  die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);
  consciousness:=CASE WHEN die_a+die_b>=target_number THEN 'conscious' ELSE 'unconscious' END;
 END IF;
 pilot:=jsonb_set(pilot,'{hits}',to_jsonb(hits),true);
 pilot:=jsonb_set(pilot,'{consciousness}',to_jsonb(consciousness),true);
 m:=jsonb_set(m,'{pilot}',pilot,true);
 RETURN jsonb_build_object('mech',m,'check',jsonb_build_object('reason',p_reason,'hits',hits,'target',target_number,'die_a',die_a,'die_b',die_b,'total',CASE WHEN die_a IS NULL THEN NULL ELSE die_a+die_b END,'consciousness',consciousness));
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_pilot_hit(jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_recover_pilot(p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE m jsonb:=p_mech;pilot jsonb:=coalesce(p_mech->'pilot','{"hits":0,"consciousness":"conscious"}'::jsonb);
 hits int;target_number int;die_a int;die_b int;recovered boolean;
BEGIN
 hits:=coalesce((pilot->>'hits')::int,0);
 IF pilot->>'consciousness'<>'unconscious' THEN RETURN jsonb_build_object('mech',m,'check',NULL);END IF;
 target_number:=btech_pilot_consciousness_target(hits);die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);recovered:=die_a+die_b>=target_number;
 IF recovered THEN pilot:=jsonb_set(pilot,'{consciousness}','"conscious"'::jsonb,true);m:=jsonb_set(m,'{pilot}',pilot,true);END IF;
 RETURN jsonb_build_object('mech',m,'check',jsonb_build_object('hits',hits,'target',target_number,'die_a',die_a,'die_b',die_b,'total',die_a+die_b,'recovered',recovered));
END $$;
REVOKE ALL ON FUNCTION public.btech_recover_pilot(jsonb) FROM PUBLIC;

-- A damaging head hit always injures the pilot. Preserve the roll beside the
-- damage result so weapon, missile, physical and fall logs can render it.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_apply_direct_damage(jsonb,integer,text,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Damage resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_apply_pilot_hit' IN source)=0 THEN
  patched:=replace(source,'critical_result jsonb;','critical_result jsonb;pilot_result jsonb;');
  patched:=replace(patched,
   E' RETURN jsonb_build_object(''mech'',m,''critical_checks'',crits);',
   E' IF p_location=''head'' AND p_damage>0 THEN pilot_result:=btech_apply_pilot_hit(m,''head hit'');m:=pilot_result->''mech'';END IF;\n RETURN jsonb_build_object(''mech'',m,''critical_checks'',crits,''pilot_check'',pilot_result->''check'');');
  IF patched=source OR position('btech_apply_pilot_hit' IN patched)=0 THEN RAISE EXCEPTION 'Damage resolver marker was not found';END IF;
  EXECUTE patched;
 END IF;
END $$;

-- Carry pilot checks into the already-persisted combat-event resolutions.
DO $$
DECLARE signature text;fn regprocedure;source text;patched text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)',
  'public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)'
 ] LOOP
  fn:=to_regprocedure(signature);IF fn IS NULL THEN RAISE EXCEPTION 'Resolver is missing: %',signature;END IF;
  SELECT pg_get_functiondef(fn) INTO source;
  IF position('''pilot_check'',damage_result->''pilot_check''' IN source)>0 THEN CONTINUE;END IF;
  patched:=replace(source,'''critical_checks'',damage_result->''critical_checks''','''critical_checks'',damage_result->''critical_checks'',''pilot_check'',damage_result->''pilot_check''');
  IF patched=source THEN RAISE EXCEPTION 'Pilot-result marker was not found in %',signature;END IF;
  EXECUTE patched;
 END LOOP;
END $$;

-- Extend Heat Management with life-support heat injuries and End Phase
-- recovery checks. A destroyed life-support system causes one pilot hit at
-- 15+ heat and a second at 26+ heat.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('life_support_hits' IN source)=0 THEN
  patched:=replace(source,'ammo_result jsonb:=NULL;bin_location text;','ammo_result jsonb:=NULL;bin_location text;life_support_hits int;pilot_injuries int;pilot_index int;pilot_result jsonb;pilot_checks jsonb;recovery_result jsonb;was_unconscious boolean;');
  patched:=replace(patched,
   E'  SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot',
   E'  pilot_checks:=''[]''::jsonb;recovery_result:=NULL;was_unconscious:=coalesce(mech->''pilot''->>''consciousness'',''conscious'')=''unconscious'';\n  SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot');
  patched:=replace(patched,
   E'  move_penalty:=CASE WHEN after_heat>=25',
   E'  SELECT count(*)::int INTO life_support_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>''unitId'' AND slot.label=''Life Support'' AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);\n  pilot_injuries:=CASE WHEN life_support_hits>0 AND after_heat>=26 THEN 2 WHEN life_support_hits>0 AND after_heat>=15 THEN 1 ELSE 0 END;\n  FOR pilot_index IN 1..pilot_injuries LOOP pilot_result:=btech_apply_pilot_hit(mech,''heat with damaged life support'');mech:=pilot_result->''mech'';pilot_checks:=pilot_checks||jsonb_build_array(pilot_result->''check'');END LOOP;\n  IF was_unconscious AND coalesce(mech->''pilot''->>''consciousness'',''conscious'')=''unconscious'' THEN recovery_result:=btech_recover_pilot(mech);mech:=recovery_result->''mech'';END IF;\n  move_penalty:=CASE WHEN after_heat>=25');
  patched:=replace(patched,'''ammo_explosion'',ammo_result))','''ammo_explosion'',ammo_result,''pilot_checks'',pilot_checks,''pilot_recovery'',recovery_result->''check''))');
  IF patched=source OR position('life_support_hits' IN patched)=0 OR position('btech_apply_pilot_hit(mech' IN patched)=0 OR position('pilot_recovery' IN patched)=0 THEN RAISE EXCEPTION 'Heat resolver markers were not found';END IF;
  EXECUTE patched;
 END IF;
END $$;

-- Unconscious or dead pilots cannot activate their BattleMechs.
CREATE OR REPLACE FUNCTION public.btech_units_left_to_act(p_units jsonb,p_round int,p_phase text,p_seat int,p_flag text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
 SELECT count(*)::int FROM jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) unit
 WHERE (unit->>'owner')::int=p_seat AND NOT coalesce((unit->>'destroyed')::boolean,false)
 AND coalesce(unit->'pilot'->>'consciousness','conscious')='conscious'
 AND (p_phase='movement' OR NOT coalesce((unit->>'shutdown')::boolean,false))
 AND CASE WHEN p_phase='weapon_attack' THEN coalesce(unit->'weaponPhaseStart'->>'round','-1')::int=p_round AND NOT coalesce((unit->'weaponPhaseStart'->'mech'->>'destroyed')::boolean,false) ELSE true END
 AND NOT coalesce((unit->>p_flag)::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.btech_units_left_to_act(jsonb,int,text,int,text) FROM PUBLIC;
