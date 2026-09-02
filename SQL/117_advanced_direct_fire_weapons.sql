-- SR-3: BattleMech-relevant advanced direct-fire weapons. Run after SQL/116.
-- Heavy Gauss has range-dependent damage; every other entry is a normal
-- catalogue profile and therefore needs no new attack-flow exception.

CREATE OR REPLACE FUNCTION public.btech_ammo_damage_per_shot(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2
  WHEN 'uac20' THEN 20 WHEN 'uac10' THEN 10 WHEN 'uac5' THEN 5 WHEN 'uac2' THEN 2
  WHEN 'rac20' THEN 20 WHEN 'rac10' THEN 10 WHEN 'rac5' THEN 5 WHEN 'rac2' THEN 2
  WHEN 'lb10x' THEN 10 WHEN 'gauss' THEN 0 WHEN 'light_gauss' THEN 0 WHEN 'heavy_gauss' THEN 0
  WHEN 'atm3' THEN 6 WHEN 'atm6' THEN 12 WHEN 'atm9' THEN 18 WHEN 'atm12' THEN 24
  WHEN 'tbolt5' THEN 5 WHEN 'tbolt10' THEN 10 WHEN 'tbolt15' THEN 15 WHEN 'tbolt20' THEN 20
  WHEN 'streak_lrm5' THEN 5 WHEN 'streak_lrm10' THEN 10 WHEN 'streak_lrm15' THEN 15 WHEN 'streak_lrm20' THEN 20
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

-- Gauss ammunition is inert: it is never eligible for the heat-phase
-- ammunition-explosion selection, rather than merely dealing zero damage.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_direct_fire_gauss_safety_v1' IN source)=0 THEN
  patched:=replace(source,
   'value->>''type''<>''gauss''',
   'value->>''type'' NOT IN (''gauss'',''light_gauss'',''heavy_gauss'') /* advanced_direct_fire_gauss_safety_v1 */');
  IF patched=source OR position('advanced_direct_fire_gauss_safety_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely preserve Gauss ammunition safety';END IF;
  EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_direct_fire_v1' IN source)=0 THEN
  patched:=replace(source,
   'IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;',
   'IF selected_weapon_key=''heavy_gauss'' THEN weapon_damage:=CASE WHEN dist<=6 THEN 25 WHEN dist<=13 THEN 20 ELSE 10 END;END IF; /* advanced_direct_fire_v1 */ IF dist>long_range THEN RAISE EXCEPTION ''% is beyond long range'',weapon_name;END IF;');
  IF patched=source OR position('advanced_direct_fire_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install Heavy Gauss range damage';END IF;
  EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_custom_equipment(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom equipment catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_direct_fire_construction_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''uac2'' THEN ''{"name":"Ultra AC/2","weight":7,"slots":3,"damage":2,"heat":1,"range":[8,17,25],"minimumRange":3,"ammoType":"uac2","label":"Ultra AC/2"}'' /* advanced_direct_fire_construction_v1 */'
   ||' WHEN ''uac5'' THEN ''{"name":"Ultra AC/5","weight":9,"slots":5,"damage":5,"heat":1,"range":[6,13,20],"minimumRange":2,"ammoType":"uac5","label":"Ultra AC/5"}'''
   ||' WHEN ''uac10'' THEN ''{"name":"Ultra AC/10","weight":13,"slots":7,"damage":10,"heat":4,"range":[6,12,18],"ammoType":"uac10","label":"Ultra AC/10"}'''
   ||' WHEN ''uac20'' THEN ''{"name":"Ultra AC/20","weight":15,"slots":10,"damage":20,"heat":8,"range":[3,7,10],"ammoType":"uac20","label":"Ultra AC/20"}'''
   ||' WHEN ''light_gauss'' THEN ''{"name":"Light Gauss Rifle","weight":12,"slots":5,"damage":8,"heat":1,"range":[8,17,25],"minimumRange":3,"ammoType":"light_gauss","label":"Light Gauss Rifle"}'''
   ||' WHEN ''heavy_gauss'' THEN ''{"name":"Heavy Gauss Rifle","weight":18,"slots":11,"damage":25,"damageByRange":[25,20,10],"heat":2,"range":[6,13,20],"minimumRange":4,"ammoType":"heavy_gauss","label":"Heavy Gauss Rifle"}'''
   ||' WHEN ''er_small_laser'' THEN ''{"name":"ER Small Laser","weight":0.5,"slots":1,"damage":3,"heat":2,"range":[2,4,5],"label":"ER Small Laser"}'''
   ||' WHEN ''er_med_laser'' THEN ''{"name":"ER Medium Laser","weight":1,"slots":1,"damage":5,"heat":5,"range":[4,8,12],"label":"ER Medium Laser"}'''
   ||' WHEN ''er_large_laser'' THEN ''{"name":"ER Large Laser","weight":5,"slots":2,"damage":8,"heat":12,"range":[7,14,19],"label":"ER Large Laser"}'''
   ||' WHEN ''er_ppc'' THEN ''{"name":"ER PPC","weight":7,"slots":3,"damage":10,"heat":15,"range":[7,14,23],"minimumRange":3,"label":"ER PPC"}'''
   ||' WHEN ''small_pulse_laser'' THEN ''{"name":"Small Pulse Laser","weight":1,"slots":1,"damage":3,"heat":2,"range":[1,2,3],"toHitModifier":-2,"label":"Small Pulse Laser"}'''
   ||' WHEN ''med_pulse_laser'' THEN ''{"name":"Medium Pulse Laser","weight":2,"slots":1,"damage":6,"heat":4,"range":[2,4,6],"toHitModifier":-2,"label":"Medium Pulse Laser"}'''
   ||' WHEN ''large_pulse_laser'' THEN ''{"name":"Large Pulse Laser","weight":7,"slots":2,"damage":9,"heat":10,"range":[3,7,10],"toHitModifier":-2,"label":"Large Pulse Laser"}'' END::jsonb');
  IF patched=source OR position('advanced_direct_fire_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add advanced direct-fire construction profiles';END IF;
  EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.btech_custom_ammo(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom ammunition catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('advanced_direct_fire_ammo_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''uac2'' THEN ''{"name":"IS Ammo Ultra AC/2","shots":45}'' /* advanced_direct_fire_ammo_v1 */ WHEN ''uac5'' THEN ''{"name":"IS Ammo Ultra AC/5","shots":20}'' WHEN ''uac10'' THEN ''{"name":"IS Ammo Ultra AC/10","shots":10}'' WHEN ''uac20'' THEN ''{"name":"IS Ammo Ultra AC/20","shots":5}'' WHEN ''light_gauss'' THEN ''{"name":"IS Ammo Light Gauss","shots":16}'' WHEN ''heavy_gauss'' THEN ''{"name":"IS Ammo Heavy Gauss","shots":4}'' END::jsonb');
  IF patched=source OR position('advanced_direct_fire_ammo_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add advanced direct-fire ammunition profiles';END IF;
  EXECUTE patched;
 END IF;
END $$;
