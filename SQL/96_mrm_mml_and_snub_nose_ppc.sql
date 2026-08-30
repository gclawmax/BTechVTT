-- Inner Sphere MRM, MML and Snub-Nose PPC support.
-- Run after SQL/95_authoritative_masc_movement.sql and before the catalogue
-- parts generated for release megamek-2026-08-curated-05.

CREATE OR REPLACE FUNCTION public.btech_special_ammo_load_types(p_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_type='lb10x' THEN ARRAY['slug','cluster']::text[]
  WHEN p_type IN ('srm2','srm4','srm6') THEN ARRAY['standard','inferno','fragmentation']::text[]
  WHEN p_type IN ('ac2','ac5','ac10','ac20') THEN ARRAY['standard','precision','armor_piercing','flechette']::text[]
  WHEN p_type IN ('lrm5','lrm10','lrm15','lrm20') THEN ARRAY['standard','semi_guided','fragmentation']::text[]
  WHEN p_type IN ('mml3','mml5','mml7','mml9') THEN ARRAY['lrm','srm']::text[]
  ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.btech_special_ammo_load_types(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_set_ammo_load_type(p_mech jsonb,p_bin_id text,p_load_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_mech;bin jsonb;position bigint;allowed text[];standard_shots int;loaded_shots int;rack_size int;
BEGIN
 FOR bin,position IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(p_mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF bin->>'id'=p_bin_id THEN
   allowed:=btech_special_ammo_load_types(bin->>'type');
   IF NOT (p_load_type=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid % ammunition load: %',bin->>'type',p_load_type;END IF;
   IF bin ? 'loadType' AND bin->>'loadType' IS DISTINCT FROM p_load_type THEN RAISE EXCEPTION 'Selected bin is already loaded with % ammunition',bin->>'loadType';END IF;
   standard_shots:=coalesce((bin->>'standardShots')::int,(bin->>'maxShots')::int,(bin->>'shots')::int,0);
   rack_size:=coalesce(nullif(substring(bin->>'type' from '[0-9]+'),''),'0')::int;
   loaded_shots:=CASE
    WHEN bin->>'type' LIKE 'mml%' AND p_load_type='lrm' THEN floor(120.0/rack_size)::int
    WHEN bin->>'type' LIKE 'mml%' AND p_load_type='srm' THEN floor(100.0/rack_size)::int
    WHEN p_load_type IN ('precision','armor_piercing') THEN greatest(1,floor(standard_shots/2.0)::int)
    ELSE standard_shots END;
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'standardShots'],to_jsonb(standard_shots),true);
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'maxShots'],to_jsonb(loaded_shots),true);
   result:=jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'shots'],to_jsonb(loaded_shots),true);
   RETURN jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'loadType'],to_jsonb(p_load_type),true);
  END IF;
 END LOOP;
 RAISE EXCEPTION 'Selected ammunition bin no longer exists';
END $$;
REVOKE ALL ON FUNCTION public.btech_set_ammo_load_type(jsonb,text,text) FROM PUBLIC;

-- Complete the standard cluster table for every MRM and MML rack size. The
-- earlier catalogue needed only 2/4/5/6/10/15/20.
CREATE OR REPLACE FUNCTION public.btech_cluster_hits(p_size int,p_roll int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF p_roll<2 OR p_roll>12 THEN RAISE EXCEPTION 'Cluster roll must be between 2 and 12';END IF;
 RETURN CASE p_size
  WHEN 2 THEN (ARRAY[1,1,1,1,1,1,1,1,2,2,2])[p_roll-1]
  WHEN 3 THEN (ARRAY[1,1,1,2,2,2,2,2,3,3,3])[p_roll-1]
  WHEN 4 THEN (ARRAY[1,2,2,2,2,3,3,3,3,4,4])[p_roll-1]
  WHEN 5 THEN (ARRAY[1,2,2,3,3,3,3,4,4,5,5])[p_roll-1]
  WHEN 6 THEN (ARRAY[2,2,3,3,4,4,4,5,5,6,6])[p_roll-1]
  WHEN 7 THEN (ARRAY[2,2,3,4,4,4,4,6,6,7,7])[p_roll-1]
  WHEN 8 THEN (ARRAY[3,3,3,5,5,5,5,6,6,8,8])[p_roll-1]
  WHEN 9 THEN (ARRAY[3,3,4,5,5,5,5,7,7,9,9])[p_roll-1]
  WHEN 10 THEN (ARRAY[3,3,4,6,6,6,6,8,8,10,10])[p_roll-1]
  WHEN 12 THEN (ARRAY[4,4,5,8,8,8,8,10,10,12,12])[p_roll-1]
  WHEN 15 THEN (ARRAY[5,5,6,9,9,9,9,12,12,15,15])[p_roll-1]
  WHEN 20 THEN (ARRAY[6,6,9,12,12,12,12,16,16,20,20])[p_roll-1]
  WHEN 30 THEN (ARRAY[10,10,12,18,18,18,18,24,24,30,30])[p_roll-1]
  WHEN 40 THEN (ARRAY[12,12,18,24,24,24,24,32,32,40,40])[p_roll-1]
  ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION public.btech_cluster_hits(int,int) FROM PUBLIC;

-- One ton of MML ammunition has different capacity in LRM and SRM mode. The
-- base profile records LRM capacity; btech_set_ammo_load_type applies SRM
-- capacity when that mode is declared.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_custom_equipment(text)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom equipment catalogue is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialist_mrm_mml_snub_construction_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''mrm10'' THEN ''{"name":"MRM 10","weight":3,"slots":2,"damage":10,"heat":4,"range":[3,8,15],"ammoType":"mrm10","clusterSize":10,"damagePerMissile":1,"missileWeapon":true,"toHitModifier":1,"label":"MRM 10"}'' /* specialist_mrm_mml_snub_construction_v1 */'
   ||' WHEN ''mrm20'' THEN ''{"name":"MRM 20","weight":7,"slots":3,"damage":20,"heat":6,"range":[3,8,15],"ammoType":"mrm20","clusterSize":20,"damagePerMissile":1,"missileWeapon":true,"toHitModifier":1,"label":"MRM 20"}'''
   ||' WHEN ''mrm30'' THEN ''{"name":"MRM 30","weight":10,"slots":5,"damage":30,"heat":10,"range":[3,8,15],"ammoType":"mrm30","clusterSize":30,"damagePerMissile":1,"missileWeapon":true,"toHitModifier":1,"label":"MRM 30"}'''
   ||' WHEN ''mrm40'' THEN ''{"name":"MRM 40","weight":12,"slots":7,"damage":40,"heat":12,"range":[3,8,15],"ammoType":"mrm40","clusterSize":40,"damagePerMissile":1,"missileWeapon":true,"toHitModifier":1,"label":"MRM 40"}'''
   ||' WHEN ''mml3'' THEN ''{"name":"MML 3","weight":1.5,"slots":2,"damage":3,"heat":2,"range":[7,14,21],"minimumRange":6,"ammoType":"mml3","clusterSize":3,"damagePerMissile":1,"missileWeapon":true,"mml":true,"label":"MML 3"}'''
   ||' WHEN ''mml5'' THEN ''{"name":"MML 5","weight":3,"slots":3,"damage":5,"heat":3,"range":[7,14,21],"minimumRange":6,"ammoType":"mml5","clusterSize":5,"damagePerMissile":1,"missileWeapon":true,"mml":true,"label":"MML 5"}'''
   ||' WHEN ''mml7'' THEN ''{"name":"MML 7","weight":4.5,"slots":4,"damage":7,"heat":4,"range":[7,14,21],"minimumRange":6,"ammoType":"mml7","clusterSize":7,"damagePerMissile":1,"missileWeapon":true,"mml":true,"label":"MML 7"}'''
   ||' WHEN ''mml9'' THEN ''{"name":"MML 9","weight":6,"slots":5,"damage":9,"heat":5,"range":[7,14,21],"minimumRange":6,"ammoType":"mml9","clusterSize":9,"damagePerMissile":1,"missileWeapon":true,"mml":true,"label":"MML 9"}'''
   ||' WHEN ''snub_ppc'' THEN ''{"name":"Snub-Nose PPC","weight":6,"slots":2,"damage":10,"damageByRange":[10,8,5],"heat":10,"range":[9,13,15],"label":"Snub-Nose PPC"}'' END::jsonb');
  IF patched=source OR position('specialist_mrm_mml_snub_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add MRM, MML and Snub-Nose PPC construction profiles';END IF;EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.btech_custom_ammo(text)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom ammunition catalogue is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialist_mrm_mml_ammo_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''mrm10'' THEN ''{"name":"IS Ammo MRM-10","shots":24}'' /* specialist_mrm_mml_ammo_v1 */ WHEN ''mrm20'' THEN ''{"name":"IS Ammo MRM-20","shots":12}'' WHEN ''mrm30'' THEN ''{"name":"IS Ammo MRM-30","shots":8}'' WHEN ''mrm40'' THEN ''{"name":"IS Ammo MRM-40","shots":6}'' WHEN ''mml3'' THEN ''{"name":"IS Ammo MML-3","shots":40}'' WHEN ''mml5'' THEN ''{"name":"IS Ammo MML-5","shots":24}'' WHEN ''mml7'' THEN ''{"name":"IS Ammo MML-7","shots":17}'' WHEN ''mml9'' THEN ''{"name":"IS Ammo MML-9","shots":13}'' END::jsonb');
  IF patched=source OR position('specialist_mrm_mml_ammo_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add MRM and MML ammunition profiles';END IF;EXECUTE patched;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_ammo_damage_per_shot(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2
  WHEN 'uac20' THEN 20 WHEN 'uac10' THEN 10 WHEN 'uac5' THEN 5 WHEN 'uac2' THEN 2
  WHEN 'lb10x' THEN 10 WHEN 'gauss' THEN 0
  WHEN 'lrm20' THEN 20 WHEN 'lrm15' THEN 15 WHEN 'lrm10' THEN 10 WHEN 'lrm5' THEN 5
  WHEN 'cl_lrm20' THEN 20 WHEN 'cl_lrm15' THEN 15 WHEN 'cl_lrm10' THEN 10 WHEN 'cl_lrm5' THEN 5
  WHEN 'srm6' THEN 12 WHEN 'srm4' THEN 8 WHEN 'srm2' THEN 4 WHEN 'streak_srm2' THEN 4
  WHEN 'cl_srm6' THEN 12 WHEN 'cl_srm4' THEN 8 WHEN 'cl_srm2' THEN 4
  WHEN 'mrm40' THEN 40 WHEN 'mrm30' THEN 30 WHEN 'mrm20' THEN 20 WHEN 'mrm10' THEN 10
  WHEN 'mml9' THEN 9 WHEN 'mml7' THEN 7 WHEN 'mml5' THEN 5 WHEN 'mml3' THEN 3
  WHEN 'plasma_rifle' THEN 10 WHEN 'plasma_cannon' THEN 0
  WHEN 'machine_gun' THEN 2 WHEN 'ams' THEN 2 WHEN 'narc' THEN 2
  ELSE 0 END
$$;

-- Rear-facing mounts use the rear three-hex arc independently of torso twist
-- or arm flipping.
CREATE OR REPLACE FUNCTION public.btech_mech_weapon_arc_allows(p_mount_location text,p_facing int,p_target_direction int,p_arms_flipped boolean,p_rear_mounted boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_rear_mounted THEN ((p_target_direction-p_facing+6)%6) IN (2,3,4)
  WHEN lower(coalesce(p_mount_location,'')) IN ('la','ra') AND p_arms_flipped THEN ((p_target_direction-p_facing+6)%6) IN (2,3,4)
  WHEN lower(coalesce(p_mount_location,''))='la' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,2,5)
  WHEN lower(coalesce(p_mount_location,''))='ra' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,4,5)
  ELSE ((p_target_direction-p_facing+6)%6) IN (0,1,5) END
$$;
REVOKE ALL ON FUNCTION public.btech_mech_weapon_arc_allows(text,int,int,boolean,boolean) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;before_step text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('specialist_mrm_mml_snub_v1' IN source)>0 THEN RETURN;END IF;
 patched:=source;

 before_step:=patched;
 patched:=replace(patched,
  'btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction,coalesce((p_ammo_bins->>''__arms_flipped'')::boolean,false))',
  'btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction,coalesce((p_ammo_bins->>''__arms_flipped'')::boolean,false),coalesce((weapon->>''rearMounted'')::boolean,false))');
 IF patched=before_step THEN RAISE EXCEPTION 'Could not safely extend authoritative rear-mounted weapon arcs';END IF;

 before_step:=patched;
 patched:=replace(patched,
  'long_range:=(weapon->''range''->>2)::int;',
  'long_range:=(weapon->''range''->>2)::int;IF weapon ? ''damageByRange'' THEN weapon_damage:=CASE WHEN dist<=short_range THEN (weapon->''damageByRange''->>0)::int WHEN dist<=medium_range THEN (weapon->''damageByRange''->>1)::int ELSE (weapon->''damageByRange''->>2)::int END;END IF; /* specialist_mrm_mml_snub_v1 */');
 IF patched=before_step THEN RAISE EXCEPTION 'Could not safely install Snub-Nose PPC range damage';END IF;

 before_step:=patched;
 patched:=replace(patched,
  'IF indirect AND selected_weapon_key NOT LIKE ''lrm%'' THEN RAISE EXCEPTION ''Only LRM weapons may fire indirectly'';END IF;',
  'IF indirect AND selected_weapon_key NOT LIKE ''lrm%'' AND NOT (selected_weapon_key LIKE ''mml%'' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(attacker_start->''ammoBins'',''[]''::jsonb)) live_bin WHERE live_bin->>''id''=p_ammo_bins->>selected_mount_id AND live_bin->>''loadType''=''lrm'')) THEN RAISE EXCEPTION ''Only LRM weapons or MML launchers loaded with LRMs may fire indirectly'';END IF;');
 IF patched=before_step THEN RAISE EXCEPTION 'Could not safely extend indirect fire to MML LRM mode';END IF;

 before_step:=patched;
 patched:=regexp_replace(patched,
  '(ammo_load_type[[:space:]]*:=[[:space:]]*coalesce\([^;]+;)',
  E'\\1IF selected_weapon_key LIKE ''mml%'' THEN IF ammo_load_type NOT IN (''lrm'',''srm'') THEN RAISE EXCEPTION ''MML ammunition must be declared as LRM or SRM'';END IF;IF ammo_load_type=''lrm'' THEN short_range:=7;medium_range:=14;long_range:=21;minimum_range:=6;damage_per_missile:=1;weapon_damage:=cluster_size;ELSE short_range:=3;medium_range:=6;long_range:=9;minimum_range:=0;damage_per_missile:=2;weapon_damage:=cluster_size*2;END IF;END IF;',1,1,'i');
 IF patched=before_step THEN RAISE EXCEPTION 'Could not safely install MML ammunition-mode resolution';END IF;

 before_step:=patched;
 patched:=replace(patched,
  'CASE WHEN selected_weapon_key LIKE ''lrm%'' THEN least(5,missiles_remaining) ELSE damage_per_missile END',
  'CASE WHEN selected_weapon_key LIKE ''lrm%'' OR selected_weapon_key LIKE ''mrm%'' OR (selected_weapon_key LIKE ''mml%'' AND ammo_load_type=''lrm'') THEN least(5,missiles_remaining) ELSE damage_per_missile END');
 patched:=replace(patched,
  'CASE WHEN selected_weapon_key LIKE ''lrm%'' THEN least(5,missiles_remaining) ELSE 1 END',
  'CASE WHEN selected_weapon_key LIKE ''lrm%'' OR selected_weapon_key LIKE ''mrm%'' OR (selected_weapon_key LIKE ''mml%'' AND ammo_load_type=''lrm'') THEN least(5,missiles_remaining) ELSE 1 END');
 IF patched=before_step THEN RAISE EXCEPTION 'Could not safely install MRM/MML damage grouping';END IF;

 EXECUTE patched;
END $$;

-- A volatile MML bin explodes for its currently declared missile payload.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('mml_ammunition_explosion_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'ammo_damage:=btech_ammo_damage_per_shot(ammo_type);','ammo_damage:=btech_ammo_damage_per_shot(ammo_type);IF ammo_type LIKE ''mml%'' AND bin->>''loadType''=''srm'' THEN ammo_damage:=ammo_damage*2;END IF; /* mml_ammunition_explosion_v1 */');
 IF patched=source OR position('mml_ammunition_explosion_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install MML ammunition explosion damage';END IF;EXECUTE patched;
END $$;

COMMENT ON FUNCTION public.btech_set_ammo_load_type(jsonb,text,text) IS 'Locks configurable ammunition bins, including the LRM/SRM payload and capacity of MML bins.';
