-- Server-authoritative LRM indirect fire with simultaneous spotter handling.
-- Run after SQL/64_complete_prone_weapon_fire.sql.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('lrm_indirect_fire_v1' IN source)>0 THEN RETURN;END IF;
 IF position('complete_prone_fire_v1' IN source)=0 THEN RAISE EXCEPTION 'Run SQL/64 before SQL/65';END IF;

 patched:=replace(source,
  'DECLARE st jsonb:=p_state;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;validation_attacker jsonb;',
  'DECLARE st jsonb:=p_state;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;validation_attacker jsonb;spotter jsonb;spotter_start jsonb;indirect boolean:=coalesce((p_ammo_bins->>''__indirect'')::boolean,false);spotter_id text:=p_ammo_bins->>''__spotter'';spotter_move_mod int:=0;indirect_mod int:=0;spotter_firing_mod int:=0;direct_woods int:=0; /* lrm_indirect_fire_v1 */');
 patched:=replace(patched,
  'WHERE chosen.mount_id<>''__fire_modes'' AND NOT chosen.mount_id=ANY(coalesce(p_weapon_mounts,ARRAY[]::text[]))',
  'WHERE chosen.mount_id NOT IN (''__fire_modes'',''__indirect'',''__spotter'',''__spotter_fired'',''__spotting_while_firing'') AND NOT chosen.mount_id=ANY(coalesce(p_weapon_mounts,ARRAY[]::text[]))');
 patched:=replace(patched,
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');',
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');spotter_firing_mod:=CASE WHEN coalesce((p_ammo_bins->>''__spotter_fired'')::boolean,false) OR coalesce((p_ammo_bins->>''__spotting_while_firing'')::boolean,false) THEN 1 ELSE 0 END;');
 patched:=replace(patched,
  E' woods:=btech_intervening_woods(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int)+CASE btech_terrain(map_id,lpad(target_start->>''col'',2,''0'')||lpad(target_start->>''row'',2,''0'')) WHEN ''heavy_woods'' THEN 2 WHEN ''light_woods'' THEN 1 ELSE 0 END;\n IF woods>=3 THEN RAISE EXCEPTION ''Line of sight is blocked by intervening woods'';END IF;\n IF btech_elevation_blocks_los(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int) THEN RAISE EXCEPTION ''Line of sight is blocked by an intervening ridge'';END IF;',
  E' direct_woods:=btech_intervening_woods(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);\n IF indirect THEN\n  IF direct_woods<3 AND NOT btech_elevation_blocks_los(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int) THEN RAISE EXCEPTION ''An attacker with direct line of sight cannot use LRM indirect fire'';END IF;\n  SELECT value INTO spotter FROM jsonb_array_elements(st->''mech_instances'') value WHERE value->>''instanceId''=spotter_id;spotter_start:=spotter->''weaponPhaseStart''->''mech'';\n  IF spotter IS NULL OR spotter_id=p_attacker_instance_id OR (spotter_start->>''owner'')::int<>(attacker_start->>''owner'')::int OR coalesce((spotter_start->>''destroyed'')::boolean,false) OR spotter_start ? ''dfaDeclaration'' OR spotter_start ? ''chargeDeclaration'' THEN RAISE EXCEPTION ''Choose an eligible friendly ground unit to spot'';END IF;\n  IF btech_intervening_woods(map_id,(spotter_start->>''col'')::int,(spotter_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int)>=3 OR btech_elevation_blocks_los(map_id,(spotter_start->>''col'')::int,(spotter_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int) THEN RAISE EXCEPTION ''The selected spotter has no line of sight to the target'';END IF;\n  woods:=btech_intervening_woods(map_id,(spotter_start->>''col'')::int,(spotter_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int)+CASE btech_terrain(map_id,lpad(target_start->>''col'',2,''0'')||lpad(target_start->>''row'',2,''0'')) WHEN ''heavy_woods'' THEN 2 WHEN ''light_woods'' THEN 1 ELSE 0 END;\n  spotter_move_mod:=CASE spotter_start->>''movementMode'' WHEN ''walk'' THEN 1 WHEN ''run'' THEN 2 WHEN ''jump'' THEN 3 ELSE 0 END;indirect_mod:=1;\n ELSE\n  woods:=direct_woods+CASE btech_terrain(map_id,lpad(target_start->>''col'',2,''0'')||lpad(target_start->>''row'',2,''0'')) WHEN ''heavy_woods'' THEN 2 WHEN ''light_woods'' THEN 1 ELSE 0 END;\n  IF direct_woods>=3 THEN RAISE EXCEPTION ''Line of sight is blocked by intervening woods'';END IF;IF btech_elevation_blocks_los(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int) THEN RAISE EXCEPTION ''Line of sight is blocked by an intervening ridge'';END IF;\n END IF;');
 patched:=replace(patched,
  'base_tn:=coalesce((attacker_start->''pilot''->>''gunnery'')::int,4)+move_mod+target_mod+woods+sensor_mod+heat_mod+prone_mod+target_prone_mod;',
  'base_tn:=coalesce((attacker_start->''pilot''->>''gunnery'')::int,4)+move_mod+target_mod+woods+sensor_mod+heat_mod+prone_mod+target_prone_mod+indirect_mod+spotter_move_mod+spotter_firing_mod;');
 patched:=replace(patched,
  'IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;',
  'IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION ''Unsupported weapon mount: %'',selected_mount_id;END IF;IF indirect AND selected_weapon_key NOT LIKE ''lrm%'' THEN RAISE EXCEPTION ''Only LRM weapons may fire indirectly'';END IF;');
 patched:=replace(patched,
  'facing_diff:=(firing_direction-firing_facing+6)%6;IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;',
  'facing_diff:=(firing_direction-firing_facing+6)%6;IF NOT indirect AND facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;');
 patched:=replace(patched,
  '''target_prone'',target_prone_mod,''weapon_accuracy'',accuracy_mod)',
  '''target_prone'',target_prone_mod,''weapon_accuracy'',accuracy_mod,''indirect_fire'',indirect_mod,''spotter_movement'',spotter_move_mod,''spotter_firing'',spotter_firing_mod)');
 IF patched=source OR position('lrm_indirect_fire_v1' IN patched)=0 OR position('spotter_move_mod' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install LRM indirect fire';END IF;
 EXECUTE patched;
END $$;

-- The alternating declaration collector knows every declaration before it
-- resolves any shot, so it can apply spotter-firing modifiers symmetrically.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Simultaneous weapon collector is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('simultaneous_indirect_spotters_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase=''weapon_attack'' AND event.attacker_instance_id=p_attacker_instance_id) THEN RAISE EXCEPTION ''This BattleMech already has a Weapon Attack declaration'';END IF;',
  'IF EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase=''weapon_attack'' AND event.attacker_instance_id=p_attacker_instance_id) THEN RAISE EXCEPTION ''This BattleMech already has a Weapon Attack declaration'';END IF; /* simultaneous_indirect_spotters_v1 */ IF coalesce((p_ammo_bins->>''__indirect'')::boolean,false) AND EXISTS (SELECT 1 FROM btech_combat_events event WHERE event.game_id=p_game_id AND event.round=g.current_round AND event.phase=''weapon_attack'' AND event.declaration->''ammo_bins''->>''__spotter''=p_ammo_bins->>''__spotter'' AND event.target_instance_id IS DISTINCT FROM p_target_instance_id) THEN RAISE EXCEPTION ''A spotter may spot only one target in a Weapon Attack Phase'';END IF;');
 patched:=replace(patched,
  'coalesce(combat_event.declaration->''ammo_bins'',''{}''::jsonb),true);',
  'coalesce(combat_event.declaration->''ammo_bins'',''{}''::jsonb)||jsonb_build_object(''__spotter_fired'',EXISTS(SELECT 1 FROM btech_combat_events spotted WHERE spotted.game_id=p_game_id AND spotted.round=g.current_round AND spotted.phase=''weapon_attack'' AND spotted.attacker_instance_id=combat_event.declaration->''ammo_bins''->>''__spotter'' AND jsonb_array_length(coalesce(spotted.declaration->''weapon_mounts'',''[]''::jsonb))>0),''__spotting_while_firing'',EXISTS(SELECT 1 FROM btech_combat_events indirect_event WHERE indirect_event.game_id=p_game_id AND indirect_event.round=g.current_round AND indirect_event.phase=''weapon_attack'' AND indirect_event.declaration->''ammo_bins''->>''__spotter''=combat_event.attacker_instance_id AND jsonb_array_length(coalesce(combat_event.declaration->''weapon_mounts'',''[]''::jsonb))>0)),true);');
 IF patched=source OR position('simultaneous_indirect_spotters_v1' IN patched)=0 OR position('__spotter_fired' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend the simultaneous collector for indirect fire';END IF;
 EXECUTE patched;
END $$;
