-- Complete BattleMech location and ammunition-destruction consequences.
-- Run after SQL/61_critical_hit_consequences.sql.

CREATE OR REPLACE FUNCTION public.btech_location_has_case(p_version text,p_mech jsonb,p_location text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce((SELECT definition->>'tech_base' ILIKE '%Clan%'
                  FROM btech_catalogue_units
                  WHERE catalogue_version=p_version AND unit_id=p_mech->>'unitId'),false)
     OR EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot
                WHERE slot.catalogue_version=p_version AND slot.unit_id=p_mech->>'unitId'
                  AND slot.location=p_location
                  AND btech_equipment_label_key(slot.label) IN ('case','caseii'))
$$;

-- Destroying a location destroys every component mounted there.  This is
-- especially important for XL/light-engine slots, heat sinks and jump jets:
-- their existing consequence code reads criticalSlotDamage.
CREATE OR REPLACE FUNCTION public.btech_destroy_location_components(p_mech jsonb,p_location text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;version_id text:=p_mech->>'catalogueVersion';indices jsonb;arm text;engine_hits int;
BEGIN
 IF p_location IS NULL THEN RETURN m;END IF;
 SELECT coalesce(jsonb_agg(slot_index ORDER BY slot_index),'[]'::jsonb) INTO indices
 FROM btech_catalogue_critical_slots
 WHERE catalogue_version=version_id AND unit_id=m->>'unitId' AND location=p_location;
 m:=jsonb_set(m,ARRAY['criticalSlotDamage',p_location],indices,true);
 IF p_location IN ('lt','rt') THEN
  arm:=CASE p_location WHEN 'lt' THEN 'la' ELSE 'ra' END;
  m:=jsonb_set(m,ARRAY['structure',arm],'0'::jsonb,true);
  SELECT coalesce(jsonb_agg(slot_index ORDER BY slot_index),'[]'::jsonb) INTO indices
  FROM btech_catalogue_critical_slots
  WHERE catalogue_version=version_id AND unit_id=m->>'unitId' AND location=arm;
  m:=jsonb_set(m,ARRAY['criticalSlotDamage',arm],indices,true);
 END IF;
 SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot
 WHERE slot.catalogue_version=version_id AND slot.unit_id=m->>'unitId'
   AND btech_equipment_label_key(slot.label) IN ('fusionengine','engine')
   AND btech_critical_slot_is_damaged(m,slot.location,slot.slot_index);
 IF engine_hits>=3 OR p_location IN ('head','ct') THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
 IF p_location='head' THEN
  m:=jsonb_set(m,'{pilot,consciousness}','"dead"'::jsonb,true);
  m:=jsonb_set(m,'{pilot,hits}','6'::jsonb,true);
 END IF;
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_internal_damage(p_mech jsonb,p_location text,p_damage int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;remaining int:=greatest(0,p_damage);available int;used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct","head":"ct"}'::jsonb;
BEGIN
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  available:=coalesce((m->'structure'->>loc)::int,0);used:=least(available,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(available-used),true);remaining:=remaining-used;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT;END IF;
  m:=btech_destroy_location_components(m,loc);
  IF loc IN ('head','ct') THEN EXIT;END IF;
  loc:=transfer->>loc;
 END LOOP;
 RETURN m;
END $$;

-- Ammunition explosions start on internal structure, injure the pilot twice,
-- and transfer inward unless CASE in the exploding location vents the excess.
CREATE OR REPLACE FUNCTION public.btech_apply_ammunition_explosion(p_mech jsonb,p_location text,p_damage int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;remaining int:=greatest(0,p_damage);available int;used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct","head":"ct"}'::jsonb;
 protected boolean;pilot_result jsonb;pilot_checks jsonb:='[]'::jsonb;i int;vented int:=0;
BEGIN
 protected:=btech_location_has_case(m->>'catalogueVersion',m,loc);
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  available:=coalesce((m->'structure'->>loc)::int,0);used:=least(available,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(available-used),true);remaining:=remaining-used;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT;END IF;
  m:=btech_destroy_location_components(m,loc);
  IF loc='ct' THEN
   m:=jsonb_set(m,'{pilot,consciousness}','"dead"'::jsonb,true);
   m:=jsonb_set(m,'{pilot,hits}','6'::jsonb,true);
   pilot_checks:=pilot_checks||jsonb_build_array(jsonb_build_object('reason','centre torso destroyed by ammunition explosion','consciousness','dead'));
   remaining:=0;EXIT;
  ELSIF loc='head' THEN remaining:=0;EXIT;
  ELSIF protected THEN vented:=remaining;remaining:=0;EXIT;END IF;
  loc:=transfer->>loc;
 END LOOP;
 FOR i IN 1..2 LOOP
  EXIT WHEN coalesce(m->'pilot'->>'consciousness','conscious')='dead';
  pilot_result:=btech_apply_pilot_hit(m,'ammunition explosion');m:=pilot_result->'mech';
  pilot_checks:=pilot_checks||jsonb_build_array(pilot_result->'check');
 END LOOP;
 RETURN jsonb_build_object('mech',m,'pilot_checks',pilot_checks,'case_protected',protected,'vented_damage',vented);
END $$;

-- Reinstall the direct-damage resolver so all weapon, physical, fall and
-- displacement damage consistently finalises destroyed locations.
CREATE OR REPLACE FUNCTION public.btech_apply_direct_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;armor_loc text;remaining int:=greatest(0,p_damage);value_now int;used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct","head":"ct"}'::jsonb;
 crits jsonb:='[]'::jsonb;da int;db int;critical_result jsonb;pilot_result jsonb;
BEGIN
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  armor_loc:=CASE WHEN p_rear AND loc IN ('ct','lt','rt') THEN loc||'_rear' ELSE loc END;
  value_now:=coalesce((m->'armor'->>armor_loc)::int,0);used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['armor',armor_loc],to_jsonb(value_now-used),true);remaining:=remaining-used;
  IF remaining=0 THEN EXIT;END IF;
  value_now:=coalesce((m->'structure'->>loc)::int,0);used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(value_now-used),true);remaining:=remaining-used;
  IF used>0 THEN
   da:=floor(random()*6+1);db:=floor(random()*6+1);critical_result:=btech_resolve_critical_slots(m,loc,da+db);m:=critical_result->'mech';
   crits:=crits||jsonb_build_array(jsonb_build_object('location',loc,'die_a',da,'die_b',db,'total',da+db,'hits',critical_result->'hits','events',critical_result->'events'));
  END IF;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT;END IF;
  m:=btech_destroy_location_components(m,loc);
  IF loc IN ('head','ct') THEN EXIT;END IF;
  loc:=transfer->>loc;p_rear:=false;
 END LOOP;
 IF p_location='head' AND p_damage>0 AND coalesce(m->'pilot'->>'consciousness','conscious')<>'dead' THEN pilot_result:=btech_apply_pilot_hit(m,'head hit');m:=pilot_result->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'critical_checks',crits,'pilot_check',pilot_result->'check');
END $$;

-- Route critical-slot ammunition and heat-induced ammunition explosions
-- through the CASE-aware resolver without replacing the mature resolver body.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Critical-slot resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_apply_ammunition_explosion' IN source)=0 THEN
  patched:=replace(source,'gauss_already_damaged boolean;','gauss_already_damaged boolean;ammo_result jsonb;');
  patched:=replace(patched,
   'IF ammo_damage>0 THEN m:=btech_apply_internal_damage(m,loc,shots*ammo_damage);END IF;',
   'IF ammo_damage>0 THEN ammo_result:=btech_apply_ammunition_explosion(m,loc,shots*ammo_damage);m:=ammo_result->''mech'';END IF;');
  patched:=replace(patched,
   '''inert'',ammo_damage=0)',
   '''inert'',ammo_damage=0,''case_protected'',ammo_result->''case_protected'',''vented_damage'',ammo_result->''vented_damage'',''pilot_checks'',ammo_result->''pilot_checks'')');
  IF patched=source OR position('btech_apply_ammunition_explosion' IN patched)=0 THEN RAISE EXCEPTION 'Critical ammunition consequence marker was not found';END IF;
  EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_apply_ammunition_explosion' IN source)=0 THEN
  patched:=replace(source,'ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;',
   'ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;explosion_result jsonb;');
  patched:=replace(patched,
   'IF ammo_damage>0 THEN processed:=btech_apply_internal_damage(processed,bin_location,coalesce((bin->>''shots'')::int,0)*ammo_damage);END IF;mech:=processed;',
   'IF ammo_damage>0 THEN explosion_result:=btech_apply_ammunition_explosion(processed,bin_location,coalesce((bin->>''shots'')::int,0)*ammo_damage);processed:=explosion_result->''mech'';END IF;mech:=processed;');
  patched:=replace(patched,
   '''damage'',(bin->>''shots'')::int*ammo_damage)',
   '''damage'',(bin->>''shots'')::int*ammo_damage,''case_protected'',explosion_result->''case_protected'',''vented_damage'',explosion_result->''vented_damage'',''pilot_checks'',explosion_result->''pilot_checks'')');
  IF patched=source OR position('btech_apply_ammunition_explosion' IN patched)=0 THEN RAISE EXCEPTION 'Heat ammunition consequence marker was not found';END IF;
  EXECUTE patched;
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.btech_location_has_case(text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_destroy_location_components(jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_apply_ammunition_explosion(jsonb,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_location_has_case(text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_destroy_location_components(jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_apply_ammunition_explosion(jsonb,text,int) TO authenticated;
