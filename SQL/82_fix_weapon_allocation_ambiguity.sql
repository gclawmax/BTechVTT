-- SQL 74 used "allocation" both as a PL/pgSQL variable and as a row alias
-- while checking duplicate weapon mounts. PostgreSQL therefore rejected even
-- a valid ammunition allocation before it reached weapon validation.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_multi_target_declaration(text,integer,jsonb,text,jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Multi-target weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('multi_target_allocation_alias_v2' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'DECLARE st jsonb:=p_state;allocation jsonb;',
  'DECLARE st jsonb:=p_state;target_allocation jsonb; /* multi_target_allocation_alias_v2 */');
 patched:=replace(patched,
  'FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value LOOP',
  'FOR target_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value LOOP');
 patched:=replace(patched,
  'SELECT jsonb_array_elements_text(coalesce(allocation->''weapon_mounts'',''[]''::jsonb))',
  'SELECT jsonb_array_elements_text(coalesce(target_allocation->''weapon_mounts'',''[]''::jsonb))');
 patched:=replace(patched,
  'bin_id:=allocation->''ammo_bins''->>mount_id;',
  'bin_id:=target_allocation->''ammo_bins''->>mount_id;');
 patched:=replace(patched,
  'WHEN allocation->''ammo_bins''->''__fire_modes''->>mount_id=',
  'WHEN target_allocation->''ammo_bins''->''__fire_modes''->>mount_id=');
 patched:=replace(patched,
  'target_id:=allocation->>''target_instance_id'';mounts:=ARRAY(SELECT jsonb_array_elements_text(coalesce(allocation->''weapon_mounts'',''[]''::jsonb)));ammo:=coalesce(allocation->''ammo_bins'',''{}''::jsonb);',
  'target_id:=target_allocation->>''target_instance_id'';mounts:=ARRAY(SELECT jsonb_array_elements_text(coalesce(target_allocation->''weapon_mounts'',''[]''::jsonb)));ammo:=coalesce(target_allocation->''ammo_bins'',''{}''::jsonb);');
 patched:=replace(patched,
  'CASE WHEN coalesce((allocation->>''primary'')::boolean,false)',
  'CASE WHEN coalesce((target_allocation->>''primary'')::boolean,false)');
 IF patched=source OR position('multi_target_allocation_alias_v2' IN patched)=0 OR position('FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value LOOP')>0 THEN RAISE EXCEPTION 'Could not safely disambiguate the multi-target weapon resolver';END IF;
 EXECUTE patched;
END $$;
