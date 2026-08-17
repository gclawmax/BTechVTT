-- Ultra Autocannon rapid fire.
-- Run after SQL/40_hatchet_and_flamer.sql.
--
-- The declaration supplies __fire_modes alongside the established per-mount
-- ammo-bin object. An Ultra AC in rapid mode expands into two authoritative
-- shots, consuming two rounds and generating double heat. A natural 2 on a
-- rapid shot jams that mount for subsequent Weapon Attack phases.

CREATE OR REPLACE FUNCTION public.btech_expand_ultra_ac_mounts(
 p_catalogue_version text,p_unit_id text,p_mounts text[],p_fire_modes jsonb
) RETURNS text[] LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE mount_id text;weapon_key text;mode text;expanded text[]:=ARRAY[]::text[];mode_key text;
BEGIN
 IF jsonb_typeof(coalesce(p_fire_modes,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Weapon fire modes must be an object keyed by mount';END IF;
 FOR mode_key IN SELECT key FROM jsonb_object_keys(coalesce(p_fire_modes,'{}'::jsonb)) key LOOP
  IF NOT mode_key=ANY(coalesce(p_mounts,ARRAY[]::text[])) THEN RAISE EXCEPTION 'A fire mode was supplied for an undeclared weapon';END IF;
 END LOOP;
 FOREACH mount_id IN ARRAY coalesce(p_mounts,ARRAY[]::text[]) LOOP
  SELECT mount.weapon_key INTO weapon_key FROM btech_catalogue_mounts mount
   WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=p_unit_id AND mount.mount_id=mount_id;
  IF weapon_key IS NULL THEN RAISE EXCEPTION 'Unsupported weapon mount: %',mount_id;END IF;
  mode:=coalesce(p_fire_modes->>mount_id,'single');
  IF weapon_key LIKE 'uac%' THEN
   IF mode NOT IN ('single','rapid') THEN RAISE EXCEPTION 'Ultra AC fire mode must be single or rapid';END IF;
   expanded:=array_append(expanded,mount_id);
   IF mode='rapid' THEN expanded:=array_append(expanded,mount_id);END IF;
  ELSIF mode<>'single' THEN
   RAISE EXCEPTION 'Only Ultra AC mounts support rapid fire';
  ELSE
   expanded:=array_append(expanded,mount_id);
  END IF;
 END LOOP;
 RETURN expanded;
END $$;
REVOKE ALL ON FUNCTION public.btech_expand_ultra_ac_mounts(text,text,text[],jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_expand_ultra_ac_mounts' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E' WHERE NOT chosen.mount_id=ANY(coalesce(p_weapon_mounts,ARRAY[]::text[]))) THEN RAISE EXCEPTION ''An ammunition choice was supplied for an undeclared weapon'';END IF;',
  E' WHERE chosen.mount_id<>''__fire_modes'' AND NOT chosen.mount_id=ANY(coalesce(p_weapon_mounts,ARRAY[]::text[]))) THEN RAISE EXCEPTION ''An ammunition choice was supplied for an undeclared weapon'';END IF;');
 patched:=replace(patched,
  E' FOREACH selected_mount_id IN ARRAY p_weapon_mounts LOOP',
  E' FOREACH selected_mount_id IN ARRAY btech_expand_ultra_ac_mounts(p_catalogue_version,attacker_start->>''unitId'',p_weapon_mounts,coalesce(p_ammo_bins->''__fire_modes'',''{}''::jsonb)) LOOP');
 patched:=replace(patched,
  E'IF da+db>=tn AND tn<=12 THEN',
  E'IF da+db>=tn AND tn<=12 AND NOT (selected_weapon_key LIKE ''uac%'' AND coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''single'')=''rapid'' AND da+db=2) THEN');
 patched:=replace(patched,
  E'  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;',
  E'  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;\n  IF coalesce(attacker_start->''weaponJams'',''[]''::jsonb) ? selected_mount_id THEN RAISE EXCEPTION ''% is jammed'',weapon_name;END IF;');
 patched:=replace(patched,
  E' ELSE results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''ammo_bin_id'',ammo_bin_id,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',false));END IF;',
  E' ELSE\n    IF selected_weapon_key LIKE ''uac%'' AND coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''single'')=''rapid'' AND da+db=2 THEN\n     attacker:=jsonb_set(attacker,''{weaponJams}'',coalesce(attacker->''weaponJams'',''[]''::jsonb)||to_jsonb(selected_mount_id),true);\n     results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''fire_mode'',''rapid'',''ammo_bin_id'',ammo_bin_id,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',false,''jammed'',true));\n    ELSE\n     results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''weapon'',weapon_name,''ammo_bin_id'',ammo_bin_id,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',false));\n    END IF;\n   END IF;');
 patched:=replace(patched,
  E'''weapon'',weapon_name,''ammo_bin_id'',ammo_bin_id',
  E'''weapon'',weapon_name,''fire_mode'',coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''single''),''ammo_bin_id'',ammo_bin_id');
 IF patched=source OR position('btech_expand_ultra_ac_mounts' IN patched)=0 OR position('chosen.mount_id<>''__fire_modes''' IN patched)=0 OR position('weaponJams' IN patched)=0 OR position('__fire_modes' IN patched)=0 THEN
  RAISE EXCEPTION 'Weapon resolver did not contain the expected Ultra AC markers';
 END IF;
 EXECUTE patched;
END $$;
