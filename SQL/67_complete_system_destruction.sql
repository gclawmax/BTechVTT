-- Finish system-level destruction consequences: individual repeated weapon
-- mounts and life-support heat injuries. Run after SQL/66.

CREATE OR REPLACE FUNCTION public.btech_mount_for_critical_slot(
 p_version text,p_unit_id text,p_location text,p_slot_index int,p_label text
) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 WITH matching_mounts AS (
  SELECT mount_id,row_number() OVER (ORDER BY mount_id)-1 AS ordinal,count(*) OVER () AS total
  FROM btech_catalogue_mounts mount
  WHERE mount.catalogue_version=p_version AND mount.unit_id=p_unit_id AND mount.location=p_location
    AND btech_weapon_slot_matches(p_label,mount.weapon_key,mount.raw_name)
 ), matching_slots AS (
  SELECT slot_index,row_number() OVER (ORDER BY slot_index)-1 AS ordinal,count(*) OVER () AS total
  FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_version AND slot.unit_id=p_unit_id AND slot.location=p_location
    AND btech_equipment_label_key(slot.label)=btech_equipment_label_key(p_label)
 )
 SELECT mount.mount_id FROM matching_slots slot JOIN matching_mounts mount
   ON floor(slot.ordinal*mount.total::numeric/greatest(slot.total,1))::int=mount.ordinal
 WHERE slot.slot_index=p_slot_index LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.btech_weapon_mount_destroyed(p_version text,p_mech jsonb,p_mount_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(p_mech->'destroyedMounts','[]'::jsonb) ? p_mount_id OR EXISTS (
  SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_version AND slot.unit_id=p_mech->>'unitId'
    AND btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index)
    AND btech_mount_for_critical_slot(p_version,p_mech->>'unitId',slot.location,slot.slot_index,slot.label)=p_mount_id)
$$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Critical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('individual_weapon_mounts_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'gauss_already_damaged boolean;ammo_result jsonb;',
  'gauss_already_damaged boolean;ammo_result jsonb;destroyed_mount text; /* individual_weapon_mounts_v1 */');
 patched:=replace(patched,
  'm:=btech_mark_critical_slot(m,loc,chosen);',
  'm:=btech_mark_critical_slot(m,loc,chosen);destroyed_mount:=btech_mount_for_critical_slot(version_id,m->>''unitId'',loc,chosen,slot_label);IF destroyed_mount IS NOT NULL AND NOT (coalesce(m->''destroyedMounts'',''[]''::jsonb) ? destroyed_mount) THEN m:=jsonb_set(m,''{destroyedMounts}'',coalesce(m->''destroyedMounts'',''[]''::jsonb)||to_jsonb(destroyed_mount),true);END IF;');
 IF patched=source OR position('individual_weapon_mounts_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not install individual weapon-mount destruction';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('individual_mount_validation_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>''unitId'' AND slot.location=mount_location AND btech_weapon_slot_matches(slot.label,selected_weapon_key,critical_label) AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index)) THEN RAISE EXCEPTION ''% was destroyed before this phase'',weapon_name;END IF;',
  '/* individual_mount_validation_v1 */ IF btech_weapon_mount_destroyed(p_catalogue_version,attacker_start,selected_mount_id) THEN RAISE EXCEPTION ''% was destroyed before this phase'',weapon_name;END IF;');
 IF patched=source OR position('individual_mount_validation_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not install individual weapon-mount validation';END IF;
 EXECUTE patched;
END $$;

-- Life-support damage injures the pilot from internal heat during Heat Phase.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');SELECT pg_get_functiondef(fn) INTO source;
 IF position('life_support_heat_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;explosion_result jsonb;',
  'ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;explosion_result jsonb;life_support_hits int;life_support_damage int;pilot_result jsonb;pilot_checks jsonb;life_index int; /* life_support_heat_v1 */');
 patched:=replace(patched,
  'shutdown_roll:=NULL;ammo_roll:=NULL;ammo_result:=NULL;',
  'shutdown_roll:=NULL;ammo_roll:=NULL;ammo_result:=NULL;pilot_checks:=''[]''::jsonb;');
 patched:=replace(patched,
  'IF ammo_damage>0 THEN explosion_result:=btech_apply_ammunition_explosion(processed,bin_location,coalesce((bin->>''shots'')::int,0)*ammo_damage);processed:=explosion_result->''mech'';END IF;mech:=processed;',
  'IF ammo_damage>0 THEN explosion_result:=btech_apply_ammunition_explosion(processed,bin_location,coalesce((bin->>''shots'')::int,0)*ammo_damage);processed:=explosion_result->''mech'';pilot_checks:=pilot_checks||coalesce(explosion_result->''pilot_checks'',''[]''::jsonb);END IF;mech:=processed;');
 patched:=replace(patched,
  'mech:=jsonb_set(mech,''{heat}'',to_jsonb(after_heat),true);',
  'SELECT count(*)::int INTO life_support_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>''unitId'' AND btech_equipment_label_key(slot.label)=''lifesupport'' AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);life_support_damage:=CASE WHEN life_support_hits>0 AND after_heat>=26 THEN 2 WHEN life_support_hits>0 AND after_heat>=15 THEN 1 ELSE 0 END;FOR life_index IN 1..life_support_damage LOOP EXIT WHEN coalesce(mech->''pilot''->>''consciousness'',''conscious'')=''dead'';pilot_result:=btech_apply_pilot_hit(mech,''destroyed life support at high heat'');mech:=pilot_result->''mech'';pilot_checks:=pilot_checks||jsonb_build_array(pilot_result->''check'');END LOOP;mech:=jsonb_set(mech,''{heat}'',to_jsonb(after_heat),true);');
 patched:=replace(patched,
  '''ammo_explosion'',ammo_result)',
  '''ammo_explosion'',ammo_result,''life_support_damage'',life_support_damage,''pilot_checks'',pilot_checks)');
 IF patched=source OR position('life_support_heat_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not install life-support heat consequences';END IF;
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public.btech_mount_for_critical_slot(text,text,text,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_weapon_mount_destroyed(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_mount_for_critical_slot(text,text,text,int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_weapon_mount_destroyed(text,jsonb,text) TO authenticated;
