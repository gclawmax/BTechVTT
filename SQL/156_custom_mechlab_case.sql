-- MechLab CASE for custom Inner Sphere BattleMechs.
-- Clan BattleMechs already receive integral CASE protection in
-- btech_location_has_case, so they do not pay a second weight/slot cost.
-- Run after SQL/155_individual_ammunition_setup_recovery.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.btech_custom_electronic(p_key text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path=public AS $$
DECLARE tons int;engine_weight numeric;
BEGIN
 IF p_key IN ('is_targeting_computer','clan_targeting_computer') THEN
  tons:=btech_custom_targeting_computer_tons(p_design);
  RETURN jsonb_build_object('name',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'weight',tons,'slots',tons,'tech',CASE WHEN p_key='clan_targeting_computer' THEN 'clan' ELSE 'inner_sphere' END,'label',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'variable',true);
 END IF;
 IF p_key='supercharger' THEN
  engine_weight:=coalesce((btech_validate_custom_design_v78(p_design-'electronics')->'weights'->>'engine')::numeric,0);
  RETURN jsonb_build_object('name','Supercharger','weight',ceil(engine_weight/5.0)/2.0,'slots',1,'tech',p_design->>'tech_base','label','Supercharger','variable',true);
 END IF;
 RETURN CASE p_key
  WHEN 'case' THEN '{"name":"CASE","weight":0.5,"slots":1,"tech":"inner_sphere","label":"CASE"}'
  WHEN 'guardian_ecm' THEN '{"name":"Guardian ECM Suite","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Guardian ECM Suite"}' WHEN 'clan_ecm' THEN '{"name":"Clan ECM Suite","weight":1,"slots":1,"tech":"clan","label":"Clan ECM Suite"}' WHEN 'angel_ecm' THEN '{"name":"Angel ECM Suite","weight":2,"slots":2,"tech":"all","label":"Angel ECM Suite"}' WHEN 'watchdog_cews' THEN '{"name":"Watchdog CEWS","weight":1.5,"slots":2,"tech":"clan","label":"Watchdog CEWS"}'
  WHEN 'beagle_probe' THEN '{"name":"Beagle Active Probe","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Beagle Active Probe"}' WHEN 'clan_active_probe' THEN '{"name":"Clan Active Probe","weight":1,"slots":1,"tech":"clan","label":"Clan Active Probe"}' WHEN 'clan_light_active_probe' THEN '{"name":"Clan Light Active Probe","weight":0.5,"slots":1,"tech":"clan","label":"Clan Light Active Probe"}'
  WHEN 'c3_master' THEN '{"name":"C3 Computer (Master)","weight":5,"slots":5,"tech":"inner_sphere","label":"IS C3 Master Computer","repeatable":true}' WHEN 'c3_slave' THEN '{"name":"C3 Computer (Slave)","weight":1,"slots":1,"tech":"inner_sphere","label":"IS C3 Slave Computer"}' WHEN 'c3i' THEN '{"name":"Improved C3 Computer (C3i)","weight":2.5,"slots":2,"tech":"inner_sphere","label":"IS C3i Computer"}'
  WHEN 'tsm' THEN '{"name":"Triple-Strength Myomer","weight":0,"slots":6,"tech":"inner_sphere","label":"Triple Strength Myomer"}' WHEN 'null_signature' THEN '{"name":"Null Signature System","weight":0,"slots":7,"tech":"inner_sphere","label":"Null Signature System"}' WHEN 'void_signature' THEN '{"name":"Void Signature System","weight":0,"slots":7,"tech":"inner_sphere","label":"Void Signature System"}' WHEN 'chameleon_lps' THEN '{"name":"Chameleon Light Polarization Shield","weight":0,"slots":6,"tech":"inner_sphere","label":"Chameleon Light Polarization Shield"}' END::jsonb;
END $$;

REVOKE ALL ON FUNCTION public.btech_custom_electronic(text,jsonb) FROM PUBLIC;
NOTIFY pgrst,'reload schema';
COMMIT;
