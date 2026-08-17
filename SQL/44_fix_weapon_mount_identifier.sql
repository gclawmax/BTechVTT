-- Fix an ambiguous PL/pgSQL identifier in the Ultra AC / LB-X fire-mode
-- helper. Run after SQL/43.
--
-- The helper is used for every weapon declaration, including standard
-- weapons. Its loop variable previously shared the table column name
-- `mount_id`, so PostgreSQL rejected declarations before resolving them.

CREATE OR REPLACE FUNCTION public.btech_expand_ultra_ac_mounts(
 p_catalogue_version text,p_unit_id text,p_mounts text[],p_fire_modes jsonb
) RETURNS text[] LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE v_mount_id text;weapon_key text;mode text;expanded text[]:=ARRAY[]::text[];mode_key text;
BEGIN
 IF jsonb_typeof(coalesce(p_fire_modes,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Weapon fire modes must be an object keyed by mount';END IF;
 FOR mode_key IN SELECT key FROM jsonb_object_keys(coalesce(p_fire_modes,'{}'::jsonb)) key LOOP
  IF NOT mode_key=ANY(coalesce(p_mounts,ARRAY[]::text[])) THEN RAISE EXCEPTION 'A fire mode was supplied for an undeclared weapon';END IF;
 END LOOP;
 FOREACH v_mount_id IN ARRAY coalesce(p_mounts,ARRAY[]::text[]) LOOP
  SELECT catalogue_mount.weapon_key INTO weapon_key FROM btech_catalogue_mounts catalogue_mount
   WHERE catalogue_mount.catalogue_version=p_catalogue_version AND catalogue_mount.unit_id=p_unit_id AND catalogue_mount.mount_id=v_mount_id;
  IF weapon_key IS NULL THEN RAISE EXCEPTION 'Unsupported weapon mount: %',v_mount_id;END IF;
  mode:=coalesce(p_fire_modes->>v_mount_id,CASE WHEN weapon_key='lb10x' THEN 'slug' ELSE 'single' END);
  IF weapon_key LIKE 'uac%' THEN
   IF mode NOT IN ('single','rapid') THEN RAISE EXCEPTION 'Ultra AC fire mode must be single or rapid';END IF;
   expanded:=array_append(expanded,v_mount_id);IF mode='rapid' THEN expanded:=array_append(expanded,v_mount_id);END IF;
  ELSIF weapon_key='lb10x' THEN
   IF mode NOT IN ('slug','cluster') THEN RAISE EXCEPTION 'LB-X ammunition must be slug or cluster';END IF;
   expanded:=array_append(expanded,v_mount_id);
  ELSIF mode<>'single' THEN
   RAISE EXCEPTION 'This weapon does not support a selectable fire mode';
  ELSE
   expanded:=array_append(expanded,v_mount_id);
  END IF;
 END LOOP;
 RETURN expanded;
END $$;
REVOKE ALL ON FUNCTION public.btech_expand_ultra_ac_mounts(text,text,text[],jsonb) FROM PUBLIC;
