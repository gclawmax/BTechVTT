-- Finish the common terrain interaction used during weapon fire. A standing
-- BattleMech in depth-one water receives partial cover: +1 to hit and leg hits
-- strike the water instead. Run after SQL/67_complete_system_destruction.sql.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('shallow_water_cover_v1' IN source)>0 THEN RETURN;END IF;
 IF position('individual_mount_validation_v1' IN source)=0 THEN RAISE EXCEPTION 'Run SQL/67 before SQL/68';END IF;

 patched:=replace(source,
  'direct_woods int:=0;',
  'direct_woods int:=0;shallow_water_cover boolean:=false;shallow_cover_mod int:=0; /* shallow_water_cover_v1 */');
 patched:=replace(patched,
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');spotter_firing_mod:=',
  'dist:=btech_hex_distance((attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);map_id:=coalesce(st->>''map_id'',''training-grounds'');shallow_water_cover:=btech_terrain(map_id,lpad(target_start->>''col'',2,''0'')||lpad(target_start->>''row'',2,''0''))=''shallow_water'' AND NOT coalesce((target_start->>''prone'')::boolean,false);shallow_cover_mod:=CASE WHEN shallow_water_cover THEN 1 ELSE 0 END;spotter_firing_mod:=');
 patched:=replace(patched,
  '+indirect_mod+spotter_move_mod+spotter_firing_mod;',
  '+indirect_mod+spotter_move_mod+spotter_firing_mod+shallow_cover_mod;');
 patched:=replace(patched,
  'ELSIF hit AND cluster_size IS NULL THEN location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_weapon_damage(target,weapon_damage,location_roll->>''location'',angle=''rear'');target:=damage_result->''mech'';IF',
  'ELSIF hit AND cluster_size IS NULL THEN location_roll:=btech_roll_mech_hit_location(angle);IF shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl'') THEN damage_result:=jsonb_build_object(''mech'',target,''critical_checks'',''[]''::jsonb);ELSE damage_result:=btech_apply_weapon_damage(target,weapon_damage,location_roll->>''location'',angle=''rear'');target:=damage_result->''mech'';END IF;IF');
 patched:=replace(patched,
  '''location'',location_roll->>''location'',''damage'',weapon_damage,''critical_checks''',
  '''location'',location_roll->>''location'',''damage'',CASE WHEN shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl'') THEN 0 ELSE weapon_damage END,''partial_cover'',shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl''),''critical_checks''');
 patched:=replace(patched,
  'location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_weapon_damage(target,group_damage,location_roll->>''location'',angle=''rear'');target:=damage_result->''mech'';groups:=groups||jsonb_build_array(jsonb_build_object(''location_roll'',location_roll,''location'',location_roll->>''location'',''damage'',group_damage,''critical_checks''',
  'location_roll:=btech_roll_mech_hit_location(angle);IF shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl'') THEN damage_result:=jsonb_build_object(''mech'',target,''critical_checks'',''[]''::jsonb);ELSE damage_result:=btech_apply_weapon_damage(target,group_damage,location_roll->>''location'',angle=''rear'');target:=damage_result->''mech'';END IF;groups:=groups||jsonb_build_array(jsonb_build_object(''location_roll'',location_roll,''location'',location_roll->>''location'',''damage'',CASE WHEN shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl'') THEN 0 ELSE group_damage END,''partial_cover'',shallow_water_cover AND location_roll->>''location'' IN (''ll'',''rl''),''critical_checks''');
 patched:=replace(patched,
  '''spotter_firing'',spotter_firing_mod)',
  '''spotter_firing'',spotter_firing_mod,''partial_cover'',shallow_cover_mod)');
 patched:=replace(patched,
  'OR coalesce((spotter_start->>''destroyed'')::boolean,false) OR spotter_start ? ''dfaDeclaration''',
  'OR coalesce((spotter_start->>''destroyed'')::boolean,false) OR coalesce((spotter_start->>''shutdown'')::boolean,false) OR coalesce(spotter_start->''pilot''->>''consciousness'',''conscious'')<>''conscious'' OR spotter_start ? ''dfaDeclaration''');
 IF patched=source OR position('shallow_water_cover_v1' IN patched)=0
   OR position('+shallow_cover_mod;' IN patched)=0
   OR position('''damage'',CASE WHEN shallow_water_cover' IN patched)=0
   OR position('group_damage END,''partial_cover''' IN patched)=0
   OR position('spotter_start->>''shutdown''' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install shallow-water partial cover';
 END IF;
 EXECUTE patched;
END $$;
