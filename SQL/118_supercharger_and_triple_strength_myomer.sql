-- SR-4: Supercharger and Triple-Strength Myomer. Run after SQL/117.

CREATE OR REPLACE FUNCTION public.btech_apply_supercharger_failure(p_catalogue_version text,p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;damage_da int:=floor(random()*6+1);damage_db int:=floor(random()*6+1);hits int;chosen int;slot_label text;
 events jsonb:='[]'::jsonb;resolved jsonb;raw_check jsonb;engine_hits int;
BEGIN
 hits:=CASE WHEN damage_da+damage_db<=7 THEN 0 WHEN damage_da+damage_db<=9 THEN 1 WHEN damage_da+damage_db<=11 THEN 2 ELSE 3 END;
 FOR hit_index IN 1..hits LOOP
  SELECT slot.slot_index,slot.label INTO chosen,slot_label FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId' AND slot.location='ct'
    AND btech_equipment_label_key(slot.label)='fusionengine' AND NOT btech_critical_slot_is_damaged(m,'ct',slot.slot_index)
   ORDER BY slot.slot_index LIMIT 1;
  EXIT WHEN NOT FOUND;m:=btech_mark_critical_slot(m,'ct',chosen);events:=events||jsonb_build_array(jsonb_build_object('location','ct','slot_index',chosen,'label',slot_label));
 END LOOP;
 m:=jsonb_set(m,'{criticalHits}',to_jsonb(coalesce((m->>'criticalHits')::int,0)+jsonb_array_length(events)),true);
 SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=m->>'unitId' AND slot.location='ct' AND btech_equipment_label_key(slot.label)='fusionengine' AND btech_critical_slot_is_damaged(m,'ct',slot.slot_index);
 IF engine_hits>=3 THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
 resolved:=btech_resolve_displacement_psr(p_catalogue_version,m,'Supercharger failure',0);m:=resolved->'mech';raw_check:=resolved->'check';
 RETURN jsonb_build_object('mech',m,'damage_roll',jsonb_build_object('die_a',damage_da,'die_b',damage_db,'total',damage_da+damage_db),'critical_hits',events,'piloting_check',raw_check);
END $$;
REVOKE ALL ON FUNCTION public.btech_apply_supercharger_failure(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_resolve_supercharger_activation(p_catalogue_version text,p_mech jsonb,p_round int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;use_level int;previous_level int;rounds_since_use int;target int;da int;db int;passed boolean;failure jsonb:=NULL;
BEGIN
 previous_level:=greatest(0,coalesce((m->>'superchargerUseLevel')::int,0));rounds_since_use:=p_round-coalesce((m->>'superchargerLastRound')::int,-99);
 use_level:=CASE WHEN previous_level=0 OR rounds_since_use<=0 THEN 1 WHEN rounds_since_use=1 THEN previous_level+1 ELSE greatest(1,previous_level-rounds_since_use+1) END;
 target:=btech_masc_target(use_level);da:=floor(random()*6+1);db:=floor(random()*6+1);passed:=da+db>=target;
 m:=jsonb_set(m,'{superchargerLastRound}',to_jsonb(p_round),true);m:=jsonb_set(m,'{superchargerUseLevel}',to_jsonb(use_level),true);m:=jsonb_set(m,'{superchargerUsedThisRound}','true'::jsonb,true);
 IF NOT passed THEN failure:=btech_apply_supercharger_failure(p_catalogue_version,m);m:=failure->'mech';END IF;
 RETURN jsonb_build_object('mech',m,'requested',true,'use_level',use_level,'target',target,'die_a',da,'die_b',db,'total',da+db,'passed',passed,'failure',failure-'mech');
END $$;
REVOKE ALL ON FUNCTION public.btech_resolve_supercharger_activation(text,jsonb,int) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;before_step text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr4_supercharger_movement_v1' IN source)=0 THEN
  patched:=replace(source,'DECLARE masc_requested boolean:=false;masc_result jsonb:=NULL; /* authoritative_masc_movement_v1 */','DECLARE masc_requested boolean:=false;masc_result jsonb:=NULL;supercharger_requested boolean:=false;supercharger_result jsonb:=NULL;tsm_active boolean:=false; /* authoritative_masc_movement_v1 */ /* sr4_supercharger_movement_v1 */');
  before_step:=patched;patched:=replace(patched,'SELECT coalesce(bool_or(coalesce((value->>''masc'')::boolean,false)),false) INTO masc_requested FROM jsonb_array_elements(p_path) value;','SELECT coalesce(bool_or(coalesce((value->>''masc'')::boolean,false)),false) INTO masc_requested FROM jsonb_array_elements(p_path) value;SELECT coalesce(bool_or(coalesce((value->>''supercharger'')::boolean,false)),false) INTO supercharger_requested FROM jsonb_array_elements(p_path) value;');IF patched=before_step THEN RAISE EXCEPTION 'Could not locate booster request parsing';END IF;
  before_step:=patched;patched:=replace(patched,'mobility:=btech_critical_movement_profile(g.catalogue_version,mech);','mobility:=btech_critical_movement_profile(g.catalogue_version,mech);tsm_active:=coalesce((mech->>''roundStartingHeat'')::int,(mech->>''heat'')::int,0)>=9 AND btech_equipment_operational(g.catalogue_version,mech,ARRAY[''triplestrengthmyomer'']);IF tsm_active THEN mobility:=jsonb_set(mobility,''{walk}'',to_jsonb(coalesce((mobility->>''walk'')::int,0)+1),true);mobility:=jsonb_set(mobility,''{run}'',to_jsonb(ceil((mobility->>''walk'')::numeric*1.5)::int),true);END IF;IF supercharger_requested THEN IF p_mode<>''run'' THEN RAISE EXCEPTION ''A Supercharger may only boost a running movement'';END IF;IF coalesce((mech->>''superchargerLastRound'')::int,-99)=g.current_round THEN RAISE EXCEPTION ''The Supercharger has already been attempted this round'';END IF;IF NOT btech_equipment_operational(g.catalogue_version,mech,ARRAY[''supercharger'']) THEN RAISE EXCEPTION ''This BattleMech has no operational Supercharger'';END IF;END IF;');IF patched=before_step THEN RAISE EXCEPTION 'Could not locate mobility calculation';END IF;
  before_step:=patched;patched:=replace(patched,'mp_max:=greatest(0,CASE WHEN masc_requested THEN coalesce((mobility->>''walk'')::int,0)*2 ELSE coalesce((mobility->>p_mode)::int,0) END-heat_penalty);','mp_max:=greatest(0,CASE WHEN masc_requested AND supercharger_requested THEN ceil(coalesce((mobility->>''walk'')::numeric,0)*2.5)::int WHEN masc_requested OR supercharger_requested THEN coalesce((mobility->>''walk'')::int,0)*2 ELSE coalesce((mobility->>p_mode)::int,0) END-heat_penalty);');IF patched=before_step THEN RAISE EXCEPTION 'Could not locate boosted MP calculation';END IF;
  before_step:=patched;patched:=replace(patched,'IF masc_requested THEN masc_result:=btech_resolve_masc_activation(g.catalogue_version,mech,g.current_round);','IF supercharger_requested THEN supercharger_result:=btech_resolve_supercharger_activation(g.catalogue_version,mech,g.current_round);mech:=supercharger_result->''mech'';IF NOT coalesce((supercharger_result->>''passed'')::boolean,false) THEN IF coalesce((mech->>''prone'')::boolean,false) OR coalesce((mech->>''destroyed'')::boolean,false) THEN mech:=jsonb_set(mech,''{hasMoved}'',''true''::jsonb,true);mech:=jsonb_set(mech,''{movementMode}'',''"run"''::jsonb,true);mech:=jsonb_set(mech,''{movementHeat}'',''2''::jsonb,true);END IF;SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(before_units) value;PERFORM submit_phase_state_nonphysical_core(p_game_id,units);RETURN jsonb_build_object(''instance_id'',p_instance_id,''mode'',p_mode,''col'',current_col,''row'',current_row,''mp_used'',0,''mp_max'',mp_max,''hexes_moved'',0,''supercharger'',(supercharger_result-''mech'')||jsonb_build_object(''activation_ends'',coalesce((mech->>''prone'')::boolean,false) OR coalesce((mech->>''destroyed'')::boolean,false)));END IF;END IF;IF masc_requested THEN masc_result:=btech_resolve_masc_activation(g.catalogue_version,mech,g.current_round);');IF patched=before_step THEN RAISE EXCEPTION 'Could not locate booster activation';END IF;
  before_step:=patched;patched:=replace(patched,'''masc'',CASE WHEN masc_result IS NULL THEN NULL ELSE masc_result-''mech'' END,''instance_id''','''masc'',CASE WHEN masc_result IS NULL THEN NULL ELSE masc_result-''mech'' END,''supercharger'',CASE WHEN supercharger_result IS NULL THEN NULL ELSE supercharger_result-''mech'' END,''instance_id''');IF patched=before_step THEN RAISE EXCEPTION 'Could not extend movement response';END IF;
  before_step:=patched;patched:=replace(patched,'mech:=jsonb_set(mech,''{mascUsedThisRound}'',to_jsonb(masc_requested),true);','mech:=jsonb_set(mech,''{mascUsedThisRound}'',to_jsonb(masc_requested),true);mech:=jsonb_set(mech,''{superchargerUsedThisRound}'',to_jsonb(supercharger_requested),true);mech:=jsonb_set(mech,''{tsmActiveThisRound}'',to_jsonb(tsm_active),true);');IF patched=before_step THEN RAISE EXCEPTION 'Could not save SR-4 movement state';END IF;
  IF patched=source OR position('sr4_supercharger_movement_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install SR-4 movement';END IF;EXECUTE patched;
 END IF;
END $$;

-- MASC failure chooses random leg criticals through its own helper rather than
-- the general critical resolver, so explicitly protect TSM there as well.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_apply_masc_failure(text,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'MASC failure resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr4_tsm_masc_protection_v1' IN source)=0 THEN
  patched:=replace(source,'''endosteel'',''ferrofibrous'',''case''','''endosteel'',''ferrofibrous'',''case'',''triplestrengthmyomer'' /* sr4_tsm_masc_protection_v1 */');
  IF patched=source OR position('sr4_tsm_masc_protection_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely protect TSM from MASC failure criticals';END IF;EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Physical resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr4_tsm_physical_v1' IN source)=0 THEN
  patched:=replace(source,'damage:=greatest(1,damage);','damage:=greatest(1,damage);IF p_attack_type NOT IN (''push'',''dfa'') AND coalesce((attacker_start->>''roundStartingHeat'')::int,(attacker_start->>''heat'')::int,0)>=9 AND btech_equipment_operational(p_catalogue_version,attacker_start,ARRAY[''triplestrengthmyomer'']) THEN damage:=damage*2;END IF; /* sr4_tsm_physical_v1 */');
  IF patched=source OR position('sr4_tsm_physical_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install TSM physical damage';END IF;EXECUTE patched;
 END IF;
END $$;

-- TSM slots are distributed construction space and cannot receive critical hits.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');IF fn IS NULL THEN RAISE EXCEPTION 'Critical resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr4_tsm_non_hittable_v1' IN source)=0 THEN
  patched:=replace(source,'''endosteel'',''ferrofibrous'',''case''','''endosteel'',''ferrofibrous'',''case'',''triplestrengthmyomer'' /* sr4_tsm_non_hittable_v1 */');
  IF patched=source OR position('sr4_tsm_non_hittable_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely protect distributed TSM slots';END IF;EXECUTE patched;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_custom_electronic(p_key text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE PARALLEL SAFE SET search_path=public AS $$
DECLARE tons int;engine_weight numeric;
BEGIN
 IF p_key IN ('is_targeting_computer','clan_targeting_computer') THEN tons:=btech_custom_targeting_computer_tons(p_design);RETURN jsonb_build_object('name',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'weight',tons,'slots',tons,'tech',CASE WHEN p_key='clan_targeting_computer' THEN 'clan' ELSE 'inner_sphere' END,'label',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'variable',true);END IF;
 IF p_key='supercharger' THEN engine_weight:=coalesce((btech_validate_custom_design_v78(p_design-'electronics')->'weights'->>'engine')::numeric,0);RETURN jsonb_build_object('name','Supercharger','weight',ceil(engine_weight/5.0)/2.0,'slots',1,'tech',p_design->>'tech_base','label','Supercharger','variable',true);END IF;
 RETURN CASE p_key
  WHEN 'guardian_ecm' THEN '{"name":"Guardian ECM Suite","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Guardian ECM Suite"}' WHEN 'clan_ecm' THEN '{"name":"Clan ECM Suite","weight":1,"slots":1,"tech":"clan","label":"Clan ECM Suite"}'
  WHEN 'beagle_probe' THEN '{"name":"Beagle Active Probe","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Beagle Active Probe"}' WHEN 'clan_active_probe' THEN '{"name":"Clan Active Probe","weight":1,"slots":1,"tech":"clan","label":"Clan Active Probe"}'
  WHEN 'c3_master' THEN '{"name":"C3 Computer (Master)","weight":5,"slots":5,"tech":"inner_sphere","label":"IS C3 Master Computer","repeatable":true}' WHEN 'c3_slave' THEN '{"name":"C3 Computer (Slave)","weight":1,"slots":1,"tech":"inner_sphere","label":"IS C3 Slave Computer"}' WHEN 'c3i' THEN '{"name":"Improved C3 Computer (C3i)","weight":2.5,"slots":2,"tech":"inner_sphere","label":"IS C3i Computer"}'
  WHEN 'tsm' THEN '{"name":"Triple-Strength Myomer","weight":0,"slots":6,"tech":"inner_sphere","label":"Triple Strength Myomer"}' END::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.btech_custom_electronic(text,jsonb) FROM PUBLIC;

-- Keep construction placement constraints authoritative. The browser mirrors
-- these checks for immediate feedback, but cannot publish around them.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_validate_custom_design(jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Custom BattleMech validator is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr4_heat_mobility_construction_v1' IN source)=0 THEN
  patched:=replace(source,'profile:=btech_custom_electronic(item->>''key'',p_design);key_name:=item->>''key'';','profile:=btech_custom_electronic(item->>''key'',p_design);key_name:=item->>''key'';IF key_name=''supercharger'' AND item->>''location''<>''ct'' THEN RAISE EXCEPTION ''A Supercharger must be installed in the Center Torso'';END IF;IF key_name=''tsm'' AND item->>''location''=''head'' THEN RAISE EXCEPTION ''Triple-Strength Myomer cannot be installed in the Head'';END IF; /* sr4_heat_mobility_construction_v1 */');
  IF patched=source OR position('sr4_heat_mobility_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install SR-4 construction validation';END IF;EXECUTE patched;
 END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.btech_resolve_supercharger_activation(text,jsonb,int) TO authenticated;
