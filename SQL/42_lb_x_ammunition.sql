-- LB-X slug and cluster ammunition modes.
-- Run after SQL/41_ultra_ac_rapid_fire.sql.
--
-- Each LB-X ammunition bin is loaded during Round 1 setup, before either
-- player rolls initiative. This avoids treating one physical ton of
-- ammunition as both slug and cluster rounds.

CREATE OR REPLACE FUNCTION public.btech_expand_ultra_ac_mounts(
 p_catalogue_version text,p_unit_id text,p_mounts text[],p_fire_modes jsonb
) RETURNS text[] LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE mount_id text;weapon_key text;mode text;expanded text[]:=ARRAY[]::text[];mode_key text;
BEGIN
 IF jsonb_typeof(coalesce(p_fire_modes,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Weapon fire modes must be an object keyed by mount';END IF;
 FOR mode_key IN SELECT key FROM jsonb_object_keys(coalesce(p_fire_modes,'{}'::jsonb)) key LOOP
  IF NOT mode_key=ANY(coalesce(p_mounts,ARRAY[]::text[])) THEN RAISE EXCEPTION 'A fire mode was supplied for an undeclared weapon';END IF;
 END LOOP;
 FOREACH mount_id IN ARRAY coalesce(p_mounts,ARRAY[]::text[]) LOOP
  SELECT mount.weapon_key INTO weapon_key FROM btech_catalogue_mounts mount
   WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=p_unit_id AND mount.mount_id=mount_id;
  IF weapon_key IS NULL THEN RAISE EXCEPTION 'Unsupported weapon mount: %',mount_id;END IF;
  mode:=coalesce(p_fire_modes->>mount_id,CASE WHEN weapon_key='lb10x' THEN 'slug' ELSE 'single' END);
  IF weapon_key LIKE 'uac%' THEN
   IF mode NOT IN ('single','rapid') THEN RAISE EXCEPTION 'Ultra AC fire mode must be single or rapid';END IF;
   expanded:=array_append(expanded,mount_id);IF mode='rapid' THEN expanded:=array_append(expanded,mount_id);END IF;
  ELSIF weapon_key='lb10x' THEN
   IF mode NOT IN ('slug','cluster') THEN RAISE EXCEPTION 'LB-X ammunition must be slug or cluster';END IF;
   expanded:=array_append(expanded,mount_id);
  ELSIF mode<>'single' THEN
   RAISE EXCEPTION 'This weapon does not support a selectable fire mode';
  ELSE
   expanded:=array_append(expanded,mount_id);
  END IF;
 END LOOP;
 RETURN expanded;
END $$;
REVOKE ALL ON FUNCTION public.btech_expand_ultra_ac_mounts(text,text,text[],jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_set_ammo_load_type(p_mech jsonb,p_bin_id text,p_load_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_mech;bin jsonb;position bigint;
BEGIN
 FOR bin,position IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(p_mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF bin->>'id'=p_bin_id THEN
   IF bin ? 'loadType' AND bin->>'loadType' IS DISTINCT FROM p_load_type THEN RAISE EXCEPTION 'Selected LB-X bin is loaded with % ammunition',bin->>'loadType';END IF;
   RETURN jsonb_set(result,ARRAY['ammoBins',(position-1)::text,'loadType'],to_jsonb(p_load_type),true);
  END IF;
 END LOOP;
 RAISE EXCEPTION 'Selected ammunition bin no longer exists';
END $$;
REVOKE ALL ON FUNCTION public.btech_set_ammo_load_type(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.submit_round_one_ammo_loadout(p_game_id uuid,p_loadouts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;updated jsonb;units jsonb:='[]'::jsonb;
 bin jsonb;bin_key text;load_type text;expected int:=0;provided int:=0;
BEGIN
 IF jsonb_typeof(coalesce(p_loadouts,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'LB-X loadouts must be an object';END IF;
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_round<>1 OR g.current_phase<>'initiative' THEN RAISE EXCEPTION 'LB-X ammunition is selected only during Round 1 initiative setup';END IF;
 IF EXISTS (SELECT 1 FROM btech_initiative WHERE game_id=p_game_id AND round=1) THEN RAISE EXCEPTION 'LB-X ammunition must be declared before initiative is rolled';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 FOR mech IN SELECT value FROM jsonb_array_elements(coalesce(st->'mech_instances','[]'::jsonb)) value LOOP
  updated:=mech;
  IF (mech->>'owner')::int=player.seat_number THEN
   FOR bin IN SELECT value FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) value LOOP
    IF bin->>'type'='lb10x' THEN
     expected:=expected+1;bin_key:=(mech->>'instanceId')||':'||(bin->>'id');load_type:=p_loadouts->>bin_key;
     IF load_type NOT IN ('slug','cluster') THEN RAISE EXCEPTION 'Choose slug or cluster ammunition for every LB-X bin';END IF;
     updated:=btech_set_ammo_load_type(updated,bin->>'id',load_type);provided:=provided+1;
    END IF;
   END LOOP;
  END IF;
  units:=units||jsonb_build_array(updated);
 END LOOP;
 IF provided<>expected THEN RAISE EXCEPTION 'Every LB-X bin must receive one ammunition type';END IF;
 st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_one_ammo_loadout(uuid,jsonb) TO authenticated;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_initiative_roll(uuid,smallint,smallint)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Initiative resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('LB-X ammunition must be declared before initiative' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'  IF NOT FOUND OR v_game.status <> ''in-progress'' OR v_game.current_phase <> ''initiative'' THEN RAISE EXCEPTION ''Initiative is not currently available''; END IF;',
  E'  IF NOT FOUND OR v_game.status <> ''in-progress'' OR v_game.current_phase <> ''initiative'' THEN RAISE EXCEPTION ''Initiative is not currently available''; END IF;\n  IF v_game.current_round=1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce((CASE jsonb_typeof(v_game.state) WHEN ''string'' THEN (v_game.state#>>''{}'')::jsonb ELSE v_game.state END)->''mech_instances'',''[]''::jsonb)) mech CROSS JOIN LATERAL jsonb_array_elements(coalesce(mech->''ammoBins'',''[]''::jsonb)) bin WHERE bin->>''type''=''lb10x'' AND NOT (bin ? ''loadType'')) THEN RAISE EXCEPTION ''LB-X ammunition must be declared before initiative is rolled'';END IF;');
 IF patched=source OR position('LB-X ammunition must be declared before initiative' IN patched)=0 THEN RAISE EXCEPTION 'Initiative resolver did not contain its expected marker';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 -- Keep an explicit marker in the patched resolver: the helper function name
 -- itself is not part of the resolver body, so it cannot safely identify an
 -- already-applied migration.
 IF position('lb_x_ammo_setup_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'  damage_per_missile:=coalesce((weapon->>''damagePerMissile'')::int,CASE WHEN selected_weapon_key LIKE ''lrm%'' THEN 1 WHEN selected_weapon_key LIKE ''srm%'' THEN 2 END);',
  E'  damage_per_missile:=coalesce((weapon->>''damagePerMissile'')::int,CASE WHEN selected_weapon_key LIKE ''lrm%'' THEN 1 WHEN selected_weapon_key LIKE ''srm%'' THEN 2 END);\n  IF selected_weapon_key=''lb10x'' AND coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''slug'')=''cluster'' THEN cluster_size:=10;damage_per_missile:=1;END IF;');
 patched:=replace(patched,
  E'  IF p_resolve THEN attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);',
  E'  /* lb_x_ammo_setup_v1 */\n  IF selected_weapon_key=''lb10x'' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(attacker->''ammoBins'',''[]''::jsonb)) bin WHERE bin->>''id''=ammo_bin_id AND bin->>''loadType''=coalesce(p_ammo_bins->''__fire_modes''->>selected_mount_id,''slug'')) THEN RAISE EXCEPTION ''Selected LB-X bin was not loaded for that ammunition type during Round 1 setup'';END IF;\n  IF p_resolve THEN attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);');
 patched:=replace(patched,
  E'''missiles_hit'',missiles_hit,''groups'',groups',
  E'''missiles_hit'',missiles_hit,''cluster_kind'',CASE WHEN selected_weapon_key=''lb10x'' THEN ''lb_x'' ELSE ''missile'' END,''groups'',groups');
 IF patched=source THEN RAISE EXCEPTION 'Weapon resolver did not contain a patchable LB-X marker';END IF;
 IF position('cluster_kind' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver cluster-result marker was not found';END IF;
 IF position('lb_x_ammo_setup_v1' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver ammunition-validation marker was not found';END IF;
 EXECUTE patched;
END $$;
