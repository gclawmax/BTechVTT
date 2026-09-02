-- SR-2: ATM payloads, Thunderbolt missiles and Streak LRMs.
-- Run after SQL/115. ATMs select standard, ER or HE ammunition during the
-- existing Round 1 ammunition setup. Streak LRMs reuse the resolver's lock
-- behaviour: no heat or ammunition is spent when the lock fails.

CREATE OR REPLACE FUNCTION public.btech_special_ammo_load_types(p_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_type='lb10x' THEN ARRAY['slug','cluster']::text[]
  WHEN p_type IN ('srm2','srm4','srm6') THEN ARRAY['standard','inferno','fragmentation']::text[]
  WHEN p_type IN ('ac2','ac5','ac10','ac20') THEN ARRAY['standard','precision','armor_piercing','flechette']::text[]
  WHEN p_type IN ('lrm5','lrm10','lrm15','lrm20') THEN ARRAY['standard','semi_guided','fragmentation']::text[]
  WHEN p_type IN ('mml3','mml5','mml7','mml9') THEN ARRAY['lrm','srm']::text[]
  WHEN p_type IN ('atm3','atm6','atm9','atm12') THEN ARRAY['standard','er','he']::text[]
  ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.btech_special_ammo_load_types(text) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_missile_families_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;',
  'IF selected_weapon_key LIKE ''atm%'' THEN IF ammo_load_type NOT IN (''standard'',''er'',''he'') THEN RAISE EXCEPTION ''ATM ammunition must be Standard, ER or HE'';END IF;IF ammo_load_type=''er'' THEN short_range:=9;medium_range:=18;long_range:=27;minimum_range:=0;damage_per_missile:=1;ELSIF ammo_load_type=''he'' THEN short_range:=3;medium_range:=6;long_range:=9;minimum_range:=0;damage_per_missile:=3;ELSE short_range:=5;medium_range:=10;long_range:=15;minimum_range:=4;damage_per_missile:=2;END IF;weapon_damage:=cluster_size*damage_per_missile;END IF; /* advanced_missile_families_v1 */ IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;');
 IF patched=source OR position('advanced_missile_families_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install ATM ammunition bands';END IF;
 patched:=replace(patched,
  'IF indirect AND selected_weapon_key NOT LIKE ''lrm%'' AND NOT (selected_weapon_key LIKE ''mml%'' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(attacker_start->''ammoBins'',''[]''::jsonb)) live_bin WHERE live_bin->>''id''=p_ammo_bins->>selected_mount_id AND live_bin->>''loadType''=''lrm'')) THEN RAISE EXCEPTION ''Only LRM weapons or MML launchers loaded with LRMs may fire indirectly'';END IF;',
  'IF indirect AND selected_weapon_key NOT LIKE ''lrm%'' AND selected_weapon_key NOT LIKE ''tbolt%'' AND NOT (selected_weapon_key LIKE ''mml%'' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(attacker_start->''ammoBins'',''[]''::jsonb)) live_bin WHERE live_bin->>''id''=p_ammo_bins->>selected_mount_id AND live_bin->>''loadType''=''lrm'')) THEN RAISE EXCEPTION ''Only LRM, Thunderbolt, or MML launchers loaded with LRMs may fire indirectly'';END IF; /* advanced_missile_indirect_v1 */');
 IF position('advanced_missile_indirect_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add Thunderbolt indirect fire';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.btech_ammo_damage_per_shot(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'atm3' THEN 6 WHEN 'atm6' THEN 12 WHEN 'atm9' THEN 18 WHEN 'atm12' THEN 24
  WHEN 'tbolt5' THEN 5 WHEN 'tbolt10' THEN 10 WHEN 'tbolt15' THEN 15 WHEN 'tbolt20' THEN 20
  WHEN 'streak_lrm5' THEN 5 WHEN 'streak_lrm10' THEN 10 WHEN 'streak_lrm15' THEN 15 WHEN 'streak_lrm20' THEN 20
  WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2
  WHEN 'uac20' THEN 20 WHEN 'uac10' THEN 10 WHEN 'uac5' THEN 5 WHEN 'uac2' THEN 2
  WHEN 'rac20' THEN 20 WHEN 'rac10' THEN 10 WHEN 'rac5' THEN 5 WHEN 'rac2' THEN 2 WHEN 'lb10x' THEN 10 WHEN 'gauss' THEN 0
  WHEN 'lrm20' THEN 20 WHEN 'lrm15' THEN 15 WHEN 'lrm10' THEN 10 WHEN 'lrm5' THEN 5
  WHEN 'cl_lrm20' THEN 20 WHEN 'cl_lrm15' THEN 15 WHEN 'cl_lrm10' THEN 10 WHEN 'cl_lrm5' THEN 5
  WHEN 'srm6' THEN 12 WHEN 'srm4' THEN 8 WHEN 'srm2' THEN 4 WHEN 'streak_srm2' THEN 4
  WHEN 'cl_srm6' THEN 12 WHEN 'cl_srm4' THEN 8 WHEN 'cl_srm2' THEN 4
  WHEN 'mrm40' THEN 40 WHEN 'mrm30' THEN 30 WHEN 'mrm20' THEN 20 WHEN 'mrm10' THEN 10
  WHEN 'mml9' THEN 9 WHEN 'mml7' THEN 7 WHEN 'mml5' THEN 5 WHEN 'mml3' THEN 3
  WHEN 'plasma_rifle' THEN 10 WHEN 'plasma_cannon' THEN 0
  WHEN 'machine_gun' THEN 2 WHEN 'ams' THEN 2 WHEN 'narc' THEN 2 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.btech_ammo_damage_per_shot(text) FROM PUBLIC;

-- Make all three families available to the custom BattleMech builder.  The
-- combat resolver remains the authority for ranges, payloads, locks and ammo.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_custom_equipment(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom equipment catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_missile_construction_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''atm3'' THEN ''{"name":"ATM 3","weight":1.5,"slots":2,"damage":6,"heat":2,"range":[5,10,15],"minimumRange":4,"ammoType":"atm3","clusterSize":3,"damagePerMissile":2,"missileWeapon":true,"atm":true,"label":"ATM 3"}'' /* advanced_missile_construction_v1 */'
   ||' WHEN ''atm6'' THEN ''{"name":"ATM 6","weight":3.5,"slots":3,"damage":12,"heat":4,"range":[5,10,15],"minimumRange":4,"ammoType":"atm6","clusterSize":6,"damagePerMissile":2,"missileWeapon":true,"atm":true,"label":"ATM 6"}'''
   ||' WHEN ''atm9'' THEN ''{"name":"ATM 9","weight":5,"slots":4,"damage":18,"heat":6,"range":[5,10,15],"minimumRange":4,"ammoType":"atm9","clusterSize":9,"damagePerMissile":2,"missileWeapon":true,"atm":true,"label":"ATM 9"}'''
   ||' WHEN ''atm12'' THEN ''{"name":"ATM 12","weight":7,"slots":5,"damage":24,"heat":8,"range":[5,10,15],"minimumRange":4,"ammoType":"atm12","clusterSize":12,"damagePerMissile":2,"missileWeapon":true,"atm":true,"label":"ATM 12"}'''
   ||' WHEN ''tbolt5'' THEN ''{"name":"Thunderbolt 5","weight":3,"slots":1,"damage":5,"heat":3,"range":[6,12,18],"ammoType":"tbolt5","missileWeapon":true,"thunderbolt":true,"label":"Thunderbolt 5"}'''
   ||' WHEN ''tbolt10'' THEN ''{"name":"Thunderbolt 10","weight":7,"slots":2,"damage":10,"heat":5,"range":[6,12,18],"ammoType":"tbolt10","missileWeapon":true,"thunderbolt":true,"label":"Thunderbolt 10"}'''
   ||' WHEN ''tbolt15'' THEN ''{"name":"Thunderbolt 15","weight":11,"slots":3,"damage":15,"heat":7,"range":[6,12,18],"ammoType":"tbolt15","missileWeapon":true,"thunderbolt":true,"label":"Thunderbolt 15"}'''
   ||' WHEN ''tbolt20'' THEN ''{"name":"Thunderbolt 20","weight":15,"slots":5,"damage":20,"heat":8,"range":[6,12,18],"ammoType":"tbolt20","missileWeapon":true,"thunderbolt":true,"label":"Thunderbolt 20"}'''
   ||' WHEN ''streak_lrm5'' THEN ''{"name":"Streak LRM 5","weight":2,"slots":1,"damage":5,"heat":2,"range":[7,14,21],"ammoType":"streak_lrm5","clusterSize":5,"damagePerMissile":1,"missileWeapon":true,"streak":true,"label":"Streak LRM 5"}'''
   ||' WHEN ''streak_lrm10'' THEN ''{"name":"Streak LRM 10","weight":5,"slots":2,"damage":10,"heat":4,"range":[7,14,21],"ammoType":"streak_lrm10","clusterSize":10,"damagePerMissile":1,"missileWeapon":true,"streak":true,"label":"Streak LRM 10"}'''
   ||' WHEN ''streak_lrm15'' THEN ''{"name":"Streak LRM 15","weight":7,"slots":3,"damage":15,"heat":5,"range":[7,14,21],"ammoType":"streak_lrm15","clusterSize":15,"damagePerMissile":1,"missileWeapon":true,"streak":true,"label":"Streak LRM 15"}'''
   ||' WHEN ''streak_lrm20'' THEN ''{"name":"Streak LRM 20","weight":10,"slots":5,"damage":20,"heat":6,"range":[7,14,21],"ammoType":"streak_lrm20","clusterSize":20,"damagePerMissile":1,"missileWeapon":true,"streak":true,"label":"Streak LRM 20"}'' END::jsonb');
  IF patched=source OR position('advanced_missile_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add advanced missile construction profiles';END IF;
  EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.btech_custom_ammo(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom ammunition catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_missile_ammo_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''atm3'' THEN ''{"name":"Clan Ammo ATM-3","shots":20}'' /* advanced_missile_ammo_v1 */ WHEN ''atm6'' THEN ''{"name":"Clan Ammo ATM-6","shots":10}'' WHEN ''atm9'' THEN ''{"name":"Clan Ammo ATM-9","shots":7}'' WHEN ''atm12'' THEN ''{"name":"Clan Ammo ATM-12","shots":5}'' WHEN ''tbolt5'' THEN ''{"name":"IS Ammo Thunderbolt-5","shots":12}'' WHEN ''tbolt10'' THEN ''{"name":"IS Ammo Thunderbolt-10","shots":6}'' WHEN ''tbolt15'' THEN ''{"name":"IS Ammo Thunderbolt-15","shots":4}'' WHEN ''tbolt20'' THEN ''{"name":"IS Ammo Thunderbolt-20","shots":3}'' WHEN ''streak_lrm5'' THEN ''{"name":"Clan Streak LRM 5 Ammo","shots":24}'' WHEN ''streak_lrm10'' THEN ''{"name":"Clan Streak LRM 10 Ammo","shots":12}'' WHEN ''streak_lrm15'' THEN ''{"name":"Clan Streak LRM 15 Ammo","shots":8}'' WHEN ''streak_lrm20'' THEN ''{"name":"Clan Streak LRM 20 Ammo","shots":6}'' END::jsonb');
  IF patched=source OR position('advanced_missile_ammo_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add advanced missile ammunition profiles';END IF;
  EXECUTE patched;
 END IF;
END $$;
