-- SR-5: advanced BattleMech electronic and signature systems. Run after SQL/118.
-- Modes are selected in Initiative, before movement, and persist until changed.

CREATE OR REPLACE FUNCTION public.btech_signature_system_active(p_catalogue_version text,p_mech jsonb,p_system text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce((p_mech->'signatureModes'->>p_system)::boolean,false)
  AND btech_equipment_operational(p_catalogue_version,p_mech,
   CASE p_system
    WHEN 'null' THEN ARRAY['nullsignaturesystem']
    WHEN 'void' THEN ARRAY['voidsignaturesystem']
    WHEN 'chameleon' THEN ARRAY['chameleonlightpolarizationshield','chameleonlightpolarizationfield']
    ELSE ARRAY['']::text[] END)
$$;
REVOKE ALL ON FUNCTION public.btech_signature_system_active(text,jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_signature_heat(p_catalogue_version text,p_mech jsonb)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT (CASE WHEN btech_signature_system_active(p_catalogue_version,p_mech,'null') THEN 10 ELSE 0 END)
      +(CASE WHEN btech_signature_system_active(p_catalogue_version,p_mech,'void') THEN 10 ELSE 0 END)
      +(CASE WHEN btech_signature_system_active(p_catalogue_version,p_mech,'chameleon') THEN 6 ELSE 0 END)
$$;
REVOKE ALL ON FUNCTION public.btech_signature_heat(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_signature_target_modifier(p_catalogue_version text,p_mech jsonb,p_distance int,p_short int,p_medium int)
RETURNS int LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE bracket int:=CASE WHEN p_distance<=p_short THEN 0 WHEN p_distance<=p_medium THEN 1 ELSE 2 END;
BEGIN
 IF btech_signature_system_active(p_catalogue_version,p_mech,'void') THEN
  RETURN CASE WHEN coalesce((p_mech->>'hexesMoved')::int,0)>5 THEN 0 WHEN coalesce((p_mech->>'hexesMoved')::int,0)>2 THEN 1 WHEN coalesce((p_mech->>'hexesMoved')::int,0)>0 THEN 2 ELSE 3 END;
 END IF;
 RETURN bracket * ((btech_signature_system_active(p_catalogue_version,p_mech,'null'))::int+(btech_signature_system_active(p_catalogue_version,p_mech,'chameleon'))::int);
END $$;
REVOKE ALL ON FUNCTION public.btech_signature_target_modifier(text,jsonb,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_battlemech_signature_mode(p_game_id uuid,p_instance_id text,p_system text,p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;units jsonb;systems jsonb;
BEGIN
 IF p_system NOT IN ('null','void','chameleon') THEN RAISE EXCEPTION 'Unsupported signature system';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'Signature systems can be configured only during Initiative';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE coalesce(g.state,'{}'::jsonb) END;
 SELECT value INTO mech FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'hasMoved')::boolean,false) THEN RAISE EXCEPTION 'Only an unmoved friendly BattleMech may change its signature setting';END IF;
 IF NOT btech_signature_system_active(g.catalogue_version,jsonb_set(mech,'{signatureModes}',jsonb_build_object(p_system,true),true),p_system) THEN RAISE EXCEPTION 'This BattleMech has no operational % system',p_system;END IF;
 systems:=coalesce(mech->'signatureModes','{}'::jsonb);systems:=jsonb_set(systems,ARRAY[p_system],to_jsonb(p_active),true);
 IF p_active AND p_system='void' THEN systems:=jsonb_set(jsonb_set(systems,'{null}','false'::jsonb,true),'{chameleon}','false'::jsonb,true);END IF;
 IF p_active AND p_system IN ('null','chameleon') THEN systems:=jsonb_set(systems,'{void}','false'::jsonb,true);END IF;
 mech:=jsonb_set(mech,'{signatureModes}',systems,true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
 RETURN mech;
END $$;
REVOKE ALL ON FUNCTION public.set_battlemech_signature_mode(uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_battlemech_signature_mode(uuid,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_active_probe_range(p_catalogue_version text,p_mech jsonb)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['watchdogcews','watchdogecm']) THEN 5 WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['activeprobe','clanactiveprobe']) THEN 5 WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['beagleactiveprobe']) THEN 4 WHEN btech_equipment_operational(p_catalogue_version,p_mech,ARRAY['lightactiveprobe']) THEN 3 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.btech_active_probe_range(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_target_guidance_ecm(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) emitter WHERE NOT coalesce((emitter->>'destroyed')::boolean,false) AND (emitter->>'owner')::int<>(p_attacker->>'owner')::int AND btech_hex_distance((emitter->>'col')::int,(emitter->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)<=6 AND btech_equipment_operational(p_catalogue_version,emitter,ARRAY['guardianecmsuite','clanecmsuite','ecmsuite','angelecmsuite','watchdogcews','watchdogecm']))
$$;
REVOKE ALL ON FUNCTION public.btech_target_guidance_ecm(text,jsonb,jsonb,jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr5_signature_targeting_v1' IN source)=0 THEN
  -- SQL 90's Targeting Computer extension is already part of the maintained
  -- resolver, so retain its modifier when inserting the signature terms.
  patched:=replace(source,'tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod+targeting_mod;','tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod+targeting_mod+btech_signature_target_modifier(p_catalogue_version,target_start,dist,short_range,medium_range)+CASE WHEN btech_signature_system_active(p_catalogue_version,attacker_start,''void'') THEN 1 ELSE 0 END; /* sr5_signature_targeting_v1 */');
  IF patched=source THEN
   patched:=replace(source,'tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod;','tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod+btech_signature_target_modifier(p_catalogue_version,target_start,dist,short_range,medium_range)+CASE WHEN btech_signature_system_active(p_catalogue_version,attacker_start,''void'') THEN 1 ELSE 0 END; /* sr5_signature_targeting_v1 */');
  END IF;
  IF patched=source OR position('sr5_signature_targeting_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install signature targeting';END IF;EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr5_signature_heat_v1' IN source)=0 THEN
  patched:=replace(source,'+coalesce((mech->>''pendingTerrainHeat'')::int,0); /* heat_ledger_recomputed_v1 */','+coalesce((mech->>''pendingTerrainHeat'')::int,0)+btech_signature_heat(g.catalogue_version,mech); /* heat_ledger_recomputed_v1 */ /* sr5_signature_heat_v1 */');
  IF patched=source OR position('sr5_signature_heat_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install signature heat';END IF;EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.declare_shutdown_override(uuid,text)');IF fn IS NULL THEN RAISE EXCEPTION 'Shutdown override resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr5_signature_override_heat_v1' IN source)=0 THEN
  patched:=replace(source,'+coalesce((mech->>''pendingTerrainHeat'')::int,0)-coalesce(sinks,0)); /* heat_ledger_override_v1 */','+coalesce((mech->>''pendingTerrainHeat'')::int,0)+btech_signature_heat(g.catalogue_version,mech)-coalesce(sinks,0)); /* heat_ledger_override_v1 */ /* sr5_signature_override_heat_v1 */');
  IF patched=source OR position('sr5_signature_override_heat_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install signature override heat';END IF;EXECUTE patched;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_custom_electronic(p_key text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path=public AS $$
DECLARE tons int;engine_weight numeric;
BEGIN
 IF p_key IN ('is_targeting_computer','clan_targeting_computer') THEN tons:=btech_custom_targeting_computer_tons(p_design);RETURN jsonb_build_object('name',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'weight',tons,'slots',tons,'tech',CASE WHEN p_key='clan_targeting_computer' THEN 'clan' ELSE 'inner_sphere' END,'label',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'variable',true);END IF;
 IF p_key='supercharger' THEN engine_weight:=coalesce((btech_validate_custom_design_v78(p_design-'electronics')->'weights'->>'engine')::numeric,0);RETURN jsonb_build_object('name','Supercharger','weight',ceil(engine_weight/5.0)/2.0,'slots',1,'tech',p_design->>'tech_base','label','Supercharger','variable',true);END IF;
 RETURN CASE p_key
  WHEN 'guardian_ecm' THEN '{"name":"Guardian ECM Suite","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Guardian ECM Suite"}' WHEN 'clan_ecm' THEN '{"name":"Clan ECM Suite","weight":1,"slots":1,"tech":"clan","label":"Clan ECM Suite"}' WHEN 'angel_ecm' THEN '{"name":"Angel ECM Suite","weight":2,"slots":2,"tech":"all","label":"Angel ECM Suite"}' WHEN 'watchdog_cews' THEN '{"name":"Watchdog CEWS","weight":1.5,"slots":2,"tech":"clan","label":"Watchdog CEWS"}'
  WHEN 'beagle_probe' THEN '{"name":"Beagle Active Probe","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Beagle Active Probe"}' WHEN 'clan_active_probe' THEN '{"name":"Clan Active Probe","weight":1,"slots":1,"tech":"clan","label":"Clan Active Probe"}' WHEN 'clan_light_active_probe' THEN '{"name":"Clan Light Active Probe","weight":0.5,"slots":1,"tech":"clan","label":"Clan Light Active Probe"}'
  WHEN 'c3_master' THEN '{"name":"C3 Computer (Master)","weight":5,"slots":5,"tech":"inner_sphere","label":"IS C3 Master Computer","repeatable":true}' WHEN 'c3_slave' THEN '{"name":"C3 Computer (Slave)","weight":1,"slots":1,"tech":"inner_sphere","label":"IS C3 Slave Computer"}' WHEN 'c3i' THEN '{"name":"Improved C3 Computer (C3i)","weight":2.5,"slots":2,"tech":"inner_sphere","label":"IS C3i Computer"}'
  WHEN 'tsm' THEN '{"name":"Triple-Strength Myomer","weight":0,"slots":6,"tech":"inner_sphere","label":"Triple Strength Myomer"}' WHEN 'null_signature' THEN '{"name":"Null Signature System","weight":0,"slots":7,"tech":"inner_sphere","label":"Null Signature System"}' WHEN 'void_signature' THEN '{"name":"Void Signature System","weight":0,"slots":7,"tech":"inner_sphere","label":"Void Signature System"}' WHEN 'chameleon_lps' THEN '{"name":"Chameleon Light Polarization Shield","weight":0,"slots":6,"tech":"inner_sphere","label":"Chameleon Light Polarization Shield"}' END::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.btech_custom_electronic(text,jsonb) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_validate_custom_design(jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom BattleMech validator is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr5_all_tech_electronics_v1' IN source)=0 THEN
  patched:=replace(source,'IF profile->>''tech''<>tech_base THEN RAISE EXCEPTION ''% requires % technology'',profile->>''name'',profile->>''tech'';END IF;','IF profile->>''tech'' NOT IN (tech_base,''all'') THEN RAISE EXCEPTION ''% requires % technology'',profile->>''name'',profile->>''tech'';END IF; /* sr5_all_tech_electronics_v1 */');
  IF patched=source OR position('sr5_all_tech_electronics_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely allow all-tech electronic equipment';END IF;EXECUTE patched;
 END IF;
END $$;

NOTIFY pgrst,'reload schema';
