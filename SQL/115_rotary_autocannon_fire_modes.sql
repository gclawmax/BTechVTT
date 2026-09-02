-- Rotary Autocannon fire modes and jam persistence.
-- Run after SQL/114. Rotary ACs may fire one through six shots: every shot
-- consumes one round and adds the weapon's listed heat. A multi-shot burst
-- makes one to-hit roll, then uses the Cluster Hits Table. A jam is checked
-- from that same firing roll and remains on the mount for the match.

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
  mode:=coalesce(p_fire_modes->>v_mount_id,CASE WHEN weapon_key='lb10x' THEN 'slug' WHEN weapon_key LIKE 'rac%' THEN '1' ELSE 'single' END);
  IF weapon_key LIKE 'uac%' THEN
   IF mode NOT IN ('single','rapid') THEN RAISE EXCEPTION 'Ultra AC fire mode must be single or rapid';END IF;
   expanded:=array_append(expanded,v_mount_id);IF mode='rapid' THEN expanded:=array_append(expanded,v_mount_id);END IF;
  ELSIF weapon_key LIKE 'rac%' THEN
   IF mode NOT IN ('1','2','3','4','5','6') THEN RAISE EXCEPTION 'Rotary AC fire rate must be from one to six shots';END IF;
   expanded:=array_append(expanded,v_mount_id);
  ELSIF weapon_key='lb10x' THEN
   IF mode NOT IN ('slug','cluster') THEN RAISE EXCEPTION 'LB-X ammunition must be slug or cluster';END IF;
   expanded:=array_append(expanded,v_mount_id);
  ELSIF mode<>'single' THEN RAISE EXCEPTION 'This weapon does not support a selectable fire mode';
  ELSE expanded:=array_append(expanded,v_mount_id);
  END IF;
 END LOOP;
 RETURN expanded;
END $$;
REVOKE ALL ON FUNCTION public.btech_expand_ultra_ac_mounts(text,text,text[],jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_ammo_damage_per_shot(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2
  WHEN 'uac20' THEN 20 WHEN 'uac10' THEN 10 WHEN 'uac5' THEN 5 WHEN 'uac2' THEN 2
  WHEN 'rac20' THEN 20 WHEN 'rac10' THEN 10 WHEN 'rac5' THEN 5 WHEN 'rac2' THEN 2
  WHEN 'lb10x' THEN 10 WHEN 'gauss' THEN 0
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

-- End-of-round declaration for the next turn's jam-clearing action. The
-- current game model folds the End Phase into Heat Management, so this control
-- appears after heat sinks are previewed and before Heat Management resolves.
CREATE OR REPLACE FUNCTION public.declare_rotary_autocannon_clear(
 p_game_id uuid,p_instance_id text,p_mount_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;units jsonb;mech jsonb;weapon_key text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'heat' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Heat Management activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasManagedHeat')::boolean,false) THEN RAISE EXCEPTION 'Choose one of your BattleMechs awaiting Heat Management';END IF;
 SELECT mount.weapon_key INTO weapon_key FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=g.catalogue_version AND mount.unit_id=mech->>'unitId' AND mount.mount_id=p_mount_id;
 IF weapon_key NOT LIKE 'rac%' OR NOT coalesce(mech->'weaponJams','[]'::jsonb) ? p_mount_id THEN RAISE EXCEPTION 'Choose a jammed Rotary Autocannon';END IF;
 IF mech ? 'racClearMount' THEN RAISE EXCEPTION 'Only one Rotary AC jam-clear attempt may be declared per BattleMech each round';END IF;
 mech:=jsonb_set(jsonb_set(mech,'{racClearMount}',to_jsonb(p_mount_id),true),'{racClearRound}',to_jsonb(g.current_round),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;
 UPDATE btech_games SET state=jsonb_set(st,'{mech_instances}',units,true) WHERE id=p_game_id;
 RETURN jsonb_build_object('instance_id',p_instance_id,'mount_id',p_mount_id,'round',g.current_round);
END $$;
REVOKE ALL ON FUNCTION public.declare_rotary_autocannon_clear(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_rotary_autocannon_clear(uuid,text,text) TO authenticated;

-- Make the complete Rotary AC family available to the Custom Mech Builder as
-- well as to imported MegaMek designs.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_custom_equipment(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom equipment catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('rotary_autocannon_construction_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''rac2'' THEN ''{"name":"Rotary AC/2","weight":8,"slots":3,"damage":2,"heat":1,"range":[6,12,18],"ammoType":"rac2","rotary":true,"label":"Rotary AC/2"}'' /* rotary_autocannon_construction_v1 */'
   ||' WHEN ''rac5'' THEN ''{"name":"Rotary AC/5","weight":10,"slots":6,"damage":5,"heat":1,"range":[5,10,15],"ammoType":"rac5","rotary":true,"label":"Rotary AC/5"}'''
   ||' WHEN ''rac10'' THEN ''{"name":"Rotary AC/10","weight":14,"slots":7,"damage":10,"heat":3,"range":[4,8,12],"ammoType":"rac10","rotary":true,"label":"Rotary AC/10"}'''
   ||' WHEN ''rac20'' THEN ''{"name":"Rotary AC/20","weight":14,"slots":10,"damage":20,"heat":7,"range":[3,6,9],"ammoType":"rac20","rotary":true,"label":"Rotary AC/20"}'' END::jsonb');
  IF patched=source OR position('rotary_autocannon_construction_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add Rotary AC construction profiles';END IF;
  EXECUTE patched;
 END IF;
 fn:=to_regprocedure('public.btech_custom_ammo(text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom ammunition catalogue is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('rotary_autocannon_ammo_v1' IN source)=0 THEN
  patched:=replace(source,' END::jsonb',
   ' WHEN ''rac2'' THEN ''{"name":"IS Ammo Rotary AC/2","shots":45}'' /* rotary_autocannon_ammo_v1 */ WHEN ''rac5'' THEN ''{"name":"IS Ammo Rotary AC/5","shots":20}'' WHEN ''rac10'' THEN ''{"name":"IS Ammo Rotary AC/10","shots":10}'' WHEN ''rac20'' THEN ''{"name":"IS Ammo Rotary AC/20","shots":5}'' END::jsonb');
  IF patched=source OR position('rotary_autocannon_ammo_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add Rotary AC ammunition profiles';END IF;
  EXECUTE patched;
 END IF;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('rotary_autocannon_v1' IN source)>0 THEN RETURN;END IF;

 -- The electronic-warfare marker is deliberately stable across the maintained
 -- resolver patches and gives the extra per-mount variables an unambiguous home.
 patched:=replace(source,
  '/* electronic_warfare_targeting_v1 */',
  'rac_shots int:=1;rac_jam_target int:=0;rac_jammed boolean:=false;i int; /* rotary_autocannon_v1 */ /* electronic_warfare_targeting_v1 */');
 patched:=replace(patched,
  'heat_inflicted:=0;ams_used:=false;ams_modifier:=0;',
  'heat_inflicted:=0;ams_used:=false;ams_modifier:=0;rac_shots:=1;rac_jam_target:=0;rac_jammed:=false;');
 patched:=replace(patched,
  'targeting_computer:=btech_equipment_operational',
  'IF selected_weapon_key LIKE ''rac%'' THEN mode:=coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''1'');IF mode NOT IN (''1'',''2'',''3'',''4'',''5'',''6'') THEN RAISE EXCEPTION ''Rotary AC fire rate must be from one to six shots'';END IF;rac_shots:=mode::int;rac_jam_target:=CASE WHEN rac_shots IN (2,3) THEN 2 WHEN rac_shots IN (4,5) THEN 3 WHEN rac_shots=6 THEN 4 ELSE 0 END;END IF;targeting_computer:=btech_equipment_operational');
 patched:=replace(patched,
  'IF selected_weapon_key=''lb10x'' AND mode=''cluster'' THEN cluster_size:=10;damage_per_missile:=1;accuracy_mod:=accuracy_mod-1;END IF;',
  'IF selected_weapon_key=''lb10x'' AND mode=''cluster'' THEN cluster_size:=10;damage_per_missile:=1;accuracy_mod:=accuracy_mod-1;END IF;IF selected_weapon_key LIKE ''rac%'' AND rac_shots>1 THEN cluster_size:=rac_shots;damage_per_missile:=weapon_damage;END IF;');
 patched:=replace(patched,
  'IF NOT p_resolve THEN validation_attacker:=btech_consume_selected_ammo(validation_attacker,selected_ammo_type,ammo_bin_id);ELSIF NOT streak THEN attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);END IF;',
  'IF NOT p_resolve THEN FOR i IN 1..rac_shots LOOP validation_attacker:=btech_consume_selected_ammo(validation_attacker,selected_ammo_type,ammo_bin_id);END LOOP;ELSIF NOT streak THEN FOR i IN 1..rac_shots LOOP attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);END LOOP;END IF;');
 patched:=replace(patched,
  'hit:=da+db>=tn AND tn<=12 AND NOT (selected_weapon_key LIKE ''uac%'' AND mode=''rapid'' AND da+db=2);',
  'hit:=da+db>=tn AND tn<=12 AND NOT (selected_weapon_key LIKE ''uac%'' AND mode=''rapid'' AND da+db=2);rac_jammed:=selected_weapon_key LIKE ''rac%'' AND rac_shots>1 AND da+db<=rac_jam_target;');
 patched:=replace(patched,
  'IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RETURN jsonb_build_object(''state'',st,''results'',results);END IF;',
  'IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN IF attacker_start->>''racClearMount'' IS NOT NULL AND coalesce((attacker_start->>''racClearRound'')::int,-1)=p_round-1 THEN IF attacker_start->>''movementMode'' NOT IN (''stand'',''walk'') THEN RAISE EXCEPTION ''A Rotary AC jam-clear attempt requires standing still or walking'';END IF;IF p_resolve THEN selected_mount_id:=attacker_start->>''racClearMount'';tn:=coalesce((attacker_start->''pilot''->>''gunnery'')::int,4)+3;da:=floor(random()*6+1);db:=floor(random()*6+1);hit:=da+db>=tn;IF hit THEN attacker:=jsonb_set(attacker,''{weaponJams}'',(SELECT coalesce(jsonb_agg(to_jsonb(jam.mount_id)),''[]''::jsonb) FROM jsonb_array_elements_text(coalesce(attacker->''weaponJams'',''[]''::jsonb)) jam(mount_id) WHERE jam.mount_id<>selected_mount_id),true);END IF;attacker:=attacker-''racClearMount''-''racClearRound'';results:=results||jsonb_build_array(jsonb_build_object(''mount_id'',selected_mount_id,''rotary_clear_attempt'',true,''to_hit'',jsonb_build_object(''die_a'',da,''die_b'',db,''total'',da+db,''target'',tn),''hit'',hit));SELECT jsonb_agg(CASE WHEN value->>''instanceId''=p_attacker_instance_id THEN attacker ELSE value END) INTO units FROM jsonb_array_elements(st->''mech_instances'') value;st:=jsonb_set(st,''{mech_instances}'',units,true);END IF;END IF;RETURN jsonb_build_object(''state'',st,''results'',results);END IF;');
 patched:=replace(patched,
  'results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''to_hit'',''breakdown'']',
  'IF selected_weapon_key LIKE ''rac%'' THEN results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''rotary_shots''],to_jsonb(rac_shots),true);results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''jam_target''],to_jsonb(rac_jam_target),true);IF rac_shots>1 THEN results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''cluster_kind''],''rotary''::jsonb,true);END IF;IF rac_jammed THEN attacker:=jsonb_set(attacker,''{weaponJams}'',coalesce(attacker->''weaponJams'',''[]''::jsonb)||to_jsonb(selected_mount_id),true);results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''jammed''],''true''::jsonb,true);END IF;END IF;results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,''to_hit'',''breakdown'']');
 patched:=replace(patched,
  'IF NOT streak OR hit THEN heat_added:=heat_added+weapon_heat;END IF;',
  'IF NOT streak OR hit THEN heat_added:=heat_added+(weapon_heat*rac_shots);END IF;');
 patched:=replace(patched,
  'mode IN (''rapid'',''cluster'')',
  'mode IN (''rapid'',''cluster'') OR (selected_weapon_key LIKE ''rac%'' AND rac_shots>1)');

 IF patched=source OR position('rotary_autocannon_v1' IN patched)=0 OR position('rac_shots:=mode::int' IN patched)=0 OR position('FOR i IN 1..rac_shots' IN patched)=0 OR position('rac_jammed:=' IN patched)=0 OR position('rotary_clear_attempt' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install Rotary Autocannon resolution';
 END IF;
 EXECUTE patched;
END $$;
