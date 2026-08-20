-- LB-X Cluster ammunition receives a -1 to-hit modifier and reports the
-- authoritative target-number components in combat-event results.
-- Run once after SQL/46 on an existing deployment.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('lb_x_cluster_tn_v1' IN source)>0 THEN RETURN;END IF;
 IF position('lb_x_ammo_setup_v1' IN source)=0 THEN RAISE EXCEPTION 'Weapon declaration resolver is not at the expected LB-X revision';END IF;
 patched:=regexp_replace(source,
  '(tn[[:space:]]*:=[[:space:]]*base_tn[[:space:]]*\+[[:space:]]*range_mod[[:space:]]*\+[[:space:]]*component_mod[[:space:]]*;)',
  E'\\1\n  /* lb_x_cluster_tn_v1 */\n  IF selected_weapon_key=''lb10x'' AND coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''slug'')=''cluster'' THEN tn:=tn-1;END IF;',
  'g');
 IF patched=source OR position('lb_x_cluster_tn_v1' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver did not contain the expected target-number marker';END IF;
 patched:=replace(patched,
  '''target'',tn)',
  '''target'',tn,''breakdown'',jsonb_build_object(''gunnery'',coalesce((attacker_start->''pilot''->>''gunnery'')::int,4),''attacker_movement'',move_mod,''target_movement'',target_mod,''range'',range_mod,''woods'',woods,''sensors'',sensor_mod,''heat'',heat_mod,''component_damage'',component_mod,''prone'',prone_mod,''target_prone'',target_prone_mod,''lb_x_cluster'',CASE WHEN selected_weapon_key=''lb10x'' AND coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''slug'')=''cluster'' THEN -1 ELSE 0 END))');
 IF position('''breakdown'',jsonb_build_object' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver did not contain the expected result marker';END IF;
 EXECUTE patched;
END $$;
