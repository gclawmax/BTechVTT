-- Advanced equipment, first slice: Hatchet physical attacks and flamer heat.
-- Run after SQL/39_expanded_roster_equipment.sql.
--
-- This alters the existing server-authoritative resolvers in place so both
-- players receive the saved damage, critical-hit, and heat results.

CREATE OR REPLACE FUNCTION public.btech_roll_physical_location(p_attack text,p_angle text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE die_roll int:=floor(random()*6+1);location_id text;
BEGIN
 IF p_attack IN ('punch','hatchet') THEN
  location_id:=CASE p_angle
   WHEN 'left' THEN CASE WHEN die_roll<=2 THEN 'lt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'la' ELSE 'head' END
   WHEN 'right' THEN CASE WHEN die_roll<=2 THEN 'rt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'ra' ELSE 'head' END
   ELSE CASE die_roll WHEN 1 THEN 'la' WHEN 2 THEN 'lt' WHEN 3 THEN 'ct' WHEN 4 THEN 'rt' WHEN 5 THEN 'ra' ELSE 'head' END END;
 ELSIF p_attack='kick' THEN
  location_id:=CASE p_angle WHEN 'left' THEN 'll' WHEN 'right' THEN 'rl'
   ELSE CASE WHEN die_roll<=3 THEN 'rl' ELSE 'll' END END;
 ELSE RAISE EXCEPTION 'Unsupported physical attack type';END IF;
 RETURN jsonb_build_object('die',die_roll,'location',location_id);
END $$;
REVOKE ALL ON FUNCTION public.btech_roll_physical_location(text,text) FROM PUBLIC;

-- Keep the established physical resolver and its subsequent pilot-injury
-- patch intact; add Hatchet validation, damage, and hit-location behaviour.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical attack resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('''hatchet''' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'p_attack_type NOT IN (''punch'',''kick'')',
  E'p_attack_type NOT IN (''punch'',''kick'',''hatchet'')');
 patched:=replace(patched,
  E'Choose punch, kick, or pass',
  E'Choose punch, kick, hatchet, or pass');
 patched:=replace(patched,
  E'Standard punches and kicks require an adjacent target',
  E'Standard punches, kicks, and hatchet attacks require an adjacent target');
 patched:=replace(patched,
  E'IF p_attack_type=''punch'' AND attack_diff=3 THEN RAISE EXCEPTION ''Punch target is in the rear arc'';END IF;',
  E'IF p_attack_type IN (''punch'',''hatchet'') AND attack_diff=3 THEN RAISE EXCEPTION ''Punch and hatchet targets are outside the rear arc'';END IF;');
 patched:=replace(patched,
  E' IF p_attack_type=''kick'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN (''ll'',''rl''))',
  E' IF p_attack_type=''hatchet'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1]<>''ra'') THEN RAISE EXCEPTION ''Choose the right arm for a hatchet attack'';END IF;\n IF p_attack_type=''hatchet'' AND (NOT btech_physical_component_exists(p_catalogue_version,attacker_start,''ra'',''Hatchet'') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,''ra'',''Hatchet'')) THEN RAISE EXCEPTION ''A functioning right-arm hatchet is required'';END IF;\n IF p_attack_type=''kick'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN (''ll'',''rl''))');
 patched:=replace(patched,
  E'IF p_attack_type=''punch'' AND ((attack_diff IN (1,2) AND limb<>''la'') OR (attack_diff IN (4,5) AND limb<>''ra'')) THEN RAISE EXCEPTION ''Only the arm facing the target side may punch'';END IF;',
  E'IF p_attack_type IN (''punch'',''hatchet'') AND ((attack_diff IN (1,2) AND limb<>''la'') OR (attack_diff IN (4,5) AND limb<>''ra'')) THEN RAISE EXCEPTION ''Only the arm facing the target side may attack'';END IF;');
 patched:=replace(patched,
  E'IF p_attack_type=''punch'' THEN\n   IF btech_physical_component_damaged',
  E'IF p_attack_type IN (''punch'',''hatchet'') THEN\n   IF btech_physical_component_damaged');
 patched:=replace(patched,
  E'damage:=ceil(unit_mass/10.0)::int;',
  E'damage:=ceil(unit_mass/CASE WHEN p_attack_type=''hatchet'' THEN 5.0 ELSE 10.0 END)::int;');
 IF patched=source OR position('p_attack_type IN (''punch'',''hatchet'')' IN patched)=0 OR position('functioning right-arm hatchet' IN patched)=0 THEN
  RAISE EXCEPTION 'Physical resolver did not contain the expected Hatchet markers';
 END IF;
 EXECUTE patched;
END $$;

-- A standard flamer hit does its normal damage and adds two heat to the
-- target. externalHeat prevents a later declaration in the simultaneous
-- weapon phase from overwriting heat that has already been inflicted.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('externalHeat' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;prone_support_arm text;prone_mod int;target_prone_mod int;',
  E'location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;prone_support_arm text;prone_mod int;target_prone_mod int;heat_inflicted int;');
 patched:=replace(patched,
  E' FOREACH selected_mount_id IN ARRAY p_weapon_mounts LOOP',
  E' FOREACH selected_mount_id IN ARRAY p_weapon_mounts LOOP\n  heat_inflicted:=0;');
 patched:=replace(patched,
  E'target:=damage_result->''mech'';',
  E'target:=damage_result->''mech'';IF selected_weapon_key=''flamer'' THEN heat_inflicted:=2;target:=jsonb_set(target,''{externalHeat}'',to_jsonb(coalesce((target->>''externalHeat'')::int,0)+heat_inflicted),true);target:=jsonb_set(target,''{heat}'',to_jsonb(coalesce((target->>''heat'')::int,0)+heat_inflicted),true);END IF;');
 patched:=replace(patched,
  E'''critical_checks'',damage_result->''critical_checks''',
  E'''critical_checks'',damage_result->''critical_checks'',''heat_inflicted'',coalesce(heat_inflicted,0)');
 patched:=replace(patched,
  E'coalesce((attacker->>''weaponHeat'')::int,0)+heat_added',
  E'coalesce((attacker->>''weaponHeat'')::int,0)+coalesce((attacker->>''externalHeat'')::int,0)+heat_added');
 IF patched=source OR position('externalHeat' IN patched)=0 OR position('heat_inflicted' IN patched)=0 THEN
  RAISE EXCEPTION 'Weapon resolver did not contain the expected flamer markers';
 END IF;
 EXECUTE patched;
END $$;

-- The received heat is part of the current turn only. Clear its accumulator
-- after Heat Management has applied sinks and heat effects.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('externalHeat' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);',
  E'mech:=jsonb_set(mech,''{heatDissipated}'',to_jsonb(least(before_heat,coalesce(sinks,0))),true);mech:=jsonb_set(mech,''{externalHeat}'',''0''::jsonb,true);');
 IF patched=source OR position('externalHeat' IN patched)=0 THEN RAISE EXCEPTION 'Heat resolver did not contain its expected marker';END IF;
 EXECUTE patched;
END $$;
