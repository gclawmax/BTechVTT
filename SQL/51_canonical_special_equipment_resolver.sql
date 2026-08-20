-- Canonical Weapon Attack and Heat resolvers. Run after SQL/49 (SQL/50 is a
-- safe compatibility waypoint and may be run before this file).
-- Unlike SQL/30-50 this installs maintained functions directly and never
-- inspects or rewrites the previously installed function text.

CREATE OR REPLACE FUNCTION public.btech_equipment_label_key(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT regexp_replace(
  regexp_replace(
   regexp_replace(lower(coalesce(p_label,'')),'([[:space:]]*\([^)]*\))+$','','i'),
   '^(is|clan|cl)','','i'),
  '[^a-z0-9]','','g')
$$;

CREATE OR REPLACE FUNCTION public.btech_weapon_slot_matches(p_label text,p_weapon_key text,p_weapon_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT public.btech_equipment_label_key(p_label)=CASE p_weapon_key
  WHEN 'ac20' THEN 'autocannon20' WHEN 'ac10' THEN 'autocannon10'
  WHEN 'ac5' THEN 'autocannon5' WHEN 'ac2' THEN 'autocannon2'
  WHEN 'lb10x' THEN 'lbxac10' WHEN 'ams' THEN 'antimissilesystem'
  WHEN 'narc' THEN 'narcbeacon'
  ELSE public.btech_equipment_label_key(p_weapon_name) END
$$;

CREATE OR REPLACE FUNCTION public.btech_ammo_damage_per_shot(p_type text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'ac2' THEN 2
  WHEN 'uac20' THEN 20 WHEN 'uac10' THEN 10 WHEN 'uac5' THEN 5 WHEN 'uac2' THEN 2
  WHEN 'lb10x' THEN 10 WHEN 'lrm20' THEN 20 WHEN 'lrm15' THEN 15 WHEN 'lrm10' THEN 10 WHEN 'lrm5' THEN 5
  WHEN 'srm6' THEN 12 WHEN 'srm4' THEN 8 WHEN 'srm2' THEN 4 WHEN 'streak_srm2' THEN 4
  WHEN 'machine_gun' THEN 2 WHEN 'ams' THEN 2 WHEN 'narc' THEN 2
  ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.resolve_heat_management(p_game_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;before_units jsonb;units jsonb:='[]'::jsonb;
 mech jsonb;processed jsonb;results jsonb:='[]'::jsonb;engine_hits int;sinks int;before_heat int;after_heat int;
 heat_sink_loss int;move_penalty int;gunnery_penalty int;shutdown_target int;shutdown_roll jsonb;shutdown boolean;
 ammo_target int;ammo_roll jsonb;bin jsonb;bin_pos bigint;ammo_type text;ammo_damage int;ammo_result jsonb;bin_location text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'heat' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Heat Management activation';END IF;
 IF g.catalogue_version IS NULL THEN RAISE EXCEPTION 'This match is missing its pinned catalogue';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;before_units:=st->'mech_instances';
 FOR mech IN SELECT value FROM jsonb_array_elements(before_units) value LOOP
  IF (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'hasManagedHeat')::boolean,false) THEN units:=units||jsonb_build_array(mech);CONTINUE;END IF;
  shutdown_roll:=NULL;ammo_roll:=NULL;ammo_result:=NULL;
  SELECT count(*)::int INTO engine_hits FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND slot.label='Fusion Engine' AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT coalesce(sum(CASE WHEN btech_equipment_label_key(slot.label)='doubleheatsink' THEN 2 ELSE 1 END),0)::int INTO heat_sink_loss FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=mech->>'unitId' AND btech_equipment_label_key(slot.label) IN ('heatsink','doubleheatsink') AND btech_critical_slot_is_damaged(mech,slot.location,slot.slot_index);
  SELECT greatest(0,coalesce((definition->>'heat_sink_capacity')::int,(definition->>'heat_sinks')::int,0)-heat_sink_loss) INTO sinks FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=mech->>'unitId';
  before_heat:=coalesce((mech->>'heat')::int,0)+(engine_hits*5);after_heat:=greatest(0,before_heat-coalesce(sinks,0));
  move_penalty:=CASE WHEN after_heat>=25 THEN 4 WHEN after_heat>=20 THEN 3 WHEN after_heat>=15 THEN 2 WHEN after_heat>=10 THEN 1 ELSE 0 END;
  gunnery_penalty:=CASE WHEN after_heat>=24 THEN 4 WHEN after_heat>=17 THEN 3 WHEN after_heat>=13 THEN 2 WHEN after_heat>=8 THEN 1 ELSE 0 END;
  shutdown_target:=CASE WHEN after_heat>=30 THEN 99 WHEN after_heat>=26 THEN 10 WHEN after_heat>=22 THEN 8 WHEN after_heat>=18 THEN 6 WHEN after_heat>=14 THEN 4 ELSE 0 END;shutdown:=coalesce((mech->>'shutdown')::boolean,false);
  IF NOT shutdown AND shutdown_target=99 THEN shutdown:=true;
  ELSIF NOT shutdown AND shutdown_target>0 THEN shutdown_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));shutdown_roll:=jsonb_set(shutdown_roll,'{total}',to_jsonb((shutdown_roll->>'die_a')::int+(shutdown_roll->>'die_b')::int),true);shutdown:=coalesce((shutdown_roll->>'total')::int,0)<shutdown_target;END IF;
  ammo_target:=CASE WHEN after_heat>=28 THEN 8 WHEN after_heat>=23 THEN 6 WHEN after_heat>=19 THEN 4 ELSE 0 END;
  IF ammo_target>0 THEN
   ammo_roll:=jsonb_build_object('die_a',floor(random()*6+1),'die_b',floor(random()*6+1));ammo_roll:=jsonb_set(ammo_roll,'{total}',to_jsonb((ammo_roll->>'die_a')::int+(ammo_roll->>'die_b')::int),true);
   IF coalesce((ammo_roll->>'total')::int,0)<ammo_target THEN
    SELECT value,ordinality INTO bin,bin_pos FROM jsonb_array_elements(coalesce(mech->'ammoBins','[]'::jsonb)) WITH ORDINALITY WHERE coalesce((value->>'shots')::int,0)>0 AND value->>'type'<>'gauss' AND NOT coalesce((value->>'destroyed')::boolean,false) ORDER BY random() LIMIT 1;
    IF FOUND THEN
     ammo_type:=bin->>'type';ammo_damage:=btech_ammo_damage_per_shot(ammo_type);bin_location:=CASE lower(replace(bin->>'location',' ','')) WHEN 'leftarm' THEN 'la' WHEN 'rightarm' THEN 'ra' WHEN 'lefttorso' THEN 'lt' WHEN 'righttorso' THEN 'rt' WHEN 'centertorso' THEN 'ct' WHEN 'leftleg' THEN 'll' WHEN 'rightleg' THEN 'rl' ELSE coalesce(nullif(split_part(bin->>'id',':',1),''),'ct') END;
     processed:=jsonb_set(mech,ARRAY['ammoBins',(bin_pos-1)::text,'shots'],'0'::jsonb,true);processed:=jsonb_set(processed,ARRAY['ammoBins',(bin_pos-1)::text,'destroyed'],'true'::jsonb,true);
     IF ammo_damage>0 THEN processed:=btech_apply_internal_damage(processed,bin_location,coalesce((bin->>'shots')::int,0)*ammo_damage);END IF;mech:=processed;
     ammo_result:=jsonb_build_object('bin_id',bin->>'id','type',ammo_type,'location',bin_location,'shots',(bin->>'shots')::int,'damage',(bin->>'shots')::int*ammo_damage);
    END IF;
   END IF;
  END IF;
  mech:=jsonb_set(mech,'{heat}',to_jsonb(after_heat),true);mech:=jsonb_set(mech,'{heatDissipated}',to_jsonb(least(before_heat,coalesce(sinks,0))),true);mech:=jsonb_set(mech,'{hasManagedHeat}','true'::jsonb,true);mech:=jsonb_set(mech,'{shutdown}',to_jsonb(shutdown),true);mech:=jsonb_set(mech,'{heatEffects}',jsonb_build_object('movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'ammo_target',ammo_target),true);
  units:=units||jsonb_build_array(mech);results:=results||jsonb_build_array(jsonb_build_object('instance_id',mech->>'instanceId','before',before_heat,'sinks',coalesce(sinks,0),'after',after_heat,'engine_heat',engine_hits*5,'movement_penalty',move_penalty,'gunnery_penalty',gunnery_penalty,'shutdown_target',shutdown_target,'shutdown_roll',shutdown_roll,'shutdown',shutdown,'ammo_target',ammo_target,'ammo_roll',ammo_roll,'ammo_explosion',ammo_result));
 END LOOP;
 PERFORM submit_phase_state_nonphysical_core(p_game_id,units);RETURN jsonb_build_object('results',results);
END $$;
REVOKE ALL ON FUNCTION public.resolve_heat_management(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_heat_management(uuid) TO authenticated;

-- Critical slots are resolved against the catalogue pinned to the match. A
-- slot-backed bin is selected by its stable location:index id, avoiding the
-- historical bug where the first bin of a matching type could be destroyed.
CREATE OR REPLACE FUNCTION public.btech_resolve_critical_slots(p_mech jsonb,p_location text,p_total int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;hits int;remaining int;chosen int;slot_label text;slot_key text;
 events jsonb:='[]'::jsonb;transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct"}'::jsonb;
 ammo_type text;ammo_damage int;bin jsonb;pos bigint;shots int;version_id text:=p_mech->>'catalogueVersion';gauss_already_damaged boolean;
BEGIN
 IF p_total<=7 THEN RETURN jsonb_build_object('mech',m,'hits',0,'events',events);END IF;
 IF p_total=12 AND loc IN ('head','la','ra','ll','rl') THEN
  m:=jsonb_set(m,ARRAY['structure',loc],'0'::jsonb,true);
  IF loc='head' THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  events:=events||jsonb_build_array(jsonb_build_object('location',loc,'special','blown_off'));
  RETURN jsonb_build_object('mech',m,'hits',0,'events',events);
 END IF;
 hits:=CASE WHEN p_total<=9 THEN 1 WHEN p_total<=11 THEN 2 ELSE 3 END;remaining:=hits;
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  IF version_id IS NOT NULL THEN
   SELECT slot_index,label INTO chosen,slot_label FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=version_id AND slot.unit_id=m->>'unitId' AND slot.location=loc
    AND (loc NOT IN ('head','ll','rl') OR slot.slot_index<6)
    AND btech_equipment_label_key(slot.label) NOT IN ('endosteel','ferrofibrous','case')
    AND NOT btech_critical_slot_is_damaged(m,loc,slot.slot_index) ORDER BY random() LIMIT 1;
  ELSE
   SELECT slot_index,label INTO chosen,slot_label FROM btech_authoritative_critical_slots slot
   WHERE slot.unit_id=m->>'unitId' AND slot.location=loc
    AND (loc NOT IN ('head','ll','rl') OR slot.slot_index<6)
    AND btech_equipment_label_key(slot.label) NOT IN ('endosteel','ferrofibrous','case')
    AND NOT btech_critical_slot_is_damaged(m,loc,slot.slot_index) ORDER BY random() LIMIT 1;
  END IF;
  IF NOT FOUND THEN loc:=transfer->>loc;CONTINUE;END IF;
  slot_key:=btech_equipment_label_key(slot_label);
  gauss_already_damaged:=false;
  IF slot_key='gaussrifle' AND version_id IS NOT NULL THEN
   SELECT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots prior_slot
    WHERE prior_slot.catalogue_version=version_id AND prior_slot.unit_id=m->>'unitId' AND prior_slot.label=slot_label
     AND btech_critical_slot_is_damaged(m,prior_slot.location,prior_slot.slot_index)) INTO gauss_already_damaged;
  END IF;
  m:=btech_mark_critical_slot(m,loc,chosen);
  events:=events||jsonb_build_array(jsonb_build_object('location',loc,'slot_index',chosen,'label',slot_label));
  IF slot_key='cockpit' THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  IF slot_key='fusionengine' AND btech_critical_label_count(m,'Fusion Engine')>=3 THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  IF slot_key='gaussrifle' AND NOT gauss_already_damaged THEN
   m:=btech_apply_internal_damage(m,loc,20);
   events:=events||jsonb_build_array(jsonb_build_object('location',loc,'gauss_explosion',true,'damage',20));
  END IF;
  ammo_type:=NULL;
  IF version_id IS NOT NULL THEN
   SELECT catalogue_bin.ammo_type INTO ammo_type FROM btech_catalogue_ammo_bins catalogue_bin
    WHERE catalogue_bin.catalogue_version=version_id AND catalogue_bin.unit_id=m->>'unitId'
     AND catalogue_bin.bin_id=loc||':'||chosen LIMIT 1;
  ELSE
   ammo_type:=CASE WHEN slot_label ILIKE '%Ammo AC/20%' THEN 'ac20' WHEN slot_label ILIKE '%Ammo AC/10%' THEN 'ac10'
    WHEN slot_label ILIKE '%Ammo AC/5%' THEN 'ac5' WHEN slot_label ILIKE '%Ammo LRM-20%' THEN 'lrm20'
    WHEN slot_label ILIKE '%Ammo LRM-10%' THEN 'lrm10' WHEN slot_label ILIKE '%Ammo SRM-6%' THEN 'srm6'
    WHEN slot_label ILIKE '%Ammo MG%' THEN 'machine_gun' END;
  END IF;
  IF ammo_type IS NOT NULL THEN
   FOR bin,pos IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
    IF ((version_id IS NOT NULL AND bin->>'id'=loc||':'||chosen) OR (version_id IS NULL AND bin->>'type'=ammo_type)) AND coalesce((bin->>'shots')::int,0)>0 AND NOT coalesce((bin->>'destroyed')::boolean,false) THEN
     shots:=(bin->>'shots')::int;ammo_damage:=CASE WHEN ammo_type='gauss' THEN 0 ELSE btech_ammo_damage_per_shot(ammo_type) END;
     m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'shots'],'0'::jsonb,true);
     m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'destroyed'],'true'::jsonb,true);
     IF ammo_damage>0 THEN m:=btech_apply_internal_damage(m,loc,shots*ammo_damage);END IF;
     events:=events||jsonb_build_array(jsonb_build_object('location',loc,'ammo_explosion',ammo_type,'damage',shots*ammo_damage,'inert',ammo_damage=0));EXIT;
    END IF;
   END LOOP;
  END IF;
  remaining:=remaining-1;
 END LOOP;
 m:=jsonb_set(m,'{criticalHits}',to_jsonb(coalesce((m->>'criticalHits')::int,0)+hits-remaining),true);
 RETURN jsonb_build_object('mech',m,'hits',hits-remaining,'events',events);
END $$;

CREATE OR REPLACE FUNCTION public.btech_consume_one_live_ammo(p_live jsonb,p_type text,p_bin_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_live;bin jsonb;pos bigint;shots int;
BEGIN
 IF p_type IS NULL THEN RETURN result;END IF;
 FOR bin,pos IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(result->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF bin->>'id'=p_bin_id AND bin->>'type'=p_type AND NOT coalesce((bin->>'destroyed')::boolean,false) THEN
   shots:=coalesce((bin->>'shots')::int,0);IF shots<1 THEN RAISE EXCEPTION 'Selected % ammunition bin is empty',p_type;END IF;
   RETURN jsonb_set(result,ARRAY['ammoBins',(pos-1)::text,'shots'],to_jsonb(shots-1),true);
  END IF;
 END LOOP;
 RAISE EXCEPTION 'Selected % ammunition bin is unavailable',p_type;
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_weapon_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE result jsonb;check_row jsonb;event_row jsonb;exploded boolean:=false;explosion_location text;explosion_damage int;
BEGIN
 result:=btech_apply_direct_damage(p_mech,p_damage,p_location,p_rear);
 FOR check_row IN SELECT value FROM jsonb_array_elements(coalesce(result->'critical_checks','[]'::jsonb)) value LOOP
  FOR event_row IN SELECT value FROM jsonb_array_elements(coalesce(check_row->'events','[]'::jsonb)) value LOOP
   IF NOT exploded AND coalesce((event_row->>'gauss_explosion')::boolean,false) THEN exploded:=true;explosion_location:=event_row->>'location';explosion_damage:=coalesce((event_row->>'damage')::int,20);END IF;
  END LOOP;
 END LOOP;
 IF exploded THEN
  result:=jsonb_set(result,'{gauss_explosion}',jsonb_build_object('location',explosion_location,'damage',explosion_damage),true);
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.btech_process_weapon_declaration(
 p_catalogue_version text,p_round int,p_state jsonb,p_attacker_instance_id text,p_target_instance_id text,
 p_weapon_mounts text[],p_ammo_bins jsonb,p_resolve boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;attacker jsonb;target jsonb;attacker_start jsonb;target_start jsonb;validation_attacker jsonb;
 selected_mount_id text;mount_location text;selected_weapon_key text;weapon jsonb;weapon_name text;weapon_damage int;weapon_heat int;selected_ammo_type text;ammo_bin_id text;
 short_range int;medium_range int;long_range int;minimum_range int;cluster_size int;damage_per_missile int;dist int;range_mod int;move_mod int;target_mod int;woods int;base_tn int;tn int;sensor_mod int;heat_mod int;component_mod int;accuracy_mod int;prone_mod int;target_prone_mod int;
 da int;db int;angle text:='front';damage_result jsonb;results jsonb:='[]'::jsonb;heat_added int:=0;units jsonb;firing_facing int;firing_direction int;facing_diff int;target_direction int;target_diff int;map_id text;critical_label text;
 location_roll jsonb;cluster_da int;cluster_db int;cluster_total int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;heat_inflicted int;hit boolean;streak boolean;narc_attack boolean;tag_attack boolean;narc_guided boolean;ams_bin_id text;ams_used boolean;ams_modifier int;ams_mount_location text;mode text;
BEGIN
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 attacker_start:=attacker->'weaponPhaseStart'->'mech';
 IF attacker IS NULL OR attacker_start IS NULL OR coalesce(attacker->'weaponPhaseStart'->>'round','-1')::int<>p_round OR coalesce((attacker_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Invalid or ineligible attacker';END IF;
 IF attacker_start->>'catalogueVersion' IS DISTINCT FROM p_catalogue_version THEN RAISE EXCEPTION 'Attacker catalogue does not match the pinned match catalogue';END IF;
 IF btech_critical_label_count(attacker_start,'Sensors')>=2 THEN RAISE EXCEPTION 'Destroyed sensors prevent weapon attacks';END IF;
 IF EXISTS (SELECT 1 FROM unnest(coalesce(p_weapon_mounts,ARRAY[]::text[])) selected(mount_id) GROUP BY selected.mount_id HAVING count(*)>1) THEN RAISE EXCEPTION 'A weapon mount may be declared only once';END IF;
 IF jsonb_typeof(coalesce(p_ammo_bins,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Ammunition choices must be an object keyed by weapon mount';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(p_ammo_bins,'{}'::jsonb)) chosen(mount_id) WHERE chosen.mount_id<>'__fire_modes' AND NOT chosen.mount_id=ANY(coalesce(p_weapon_mounts,ARRAY[]::text[]))) THEN RAISE EXCEPTION 'An ammunition choice was supplied for an undeclared weapon';END IF;
 IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RETURN jsonb_build_object('state',st,'results',results);END IF;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;target_start:=target->'weaponPhaseStart'->'mech';
 IF target IS NULL OR target_start IS NULL OR coalesce(target->'weaponPhaseStart'->>'round','-1')::int<>p_round OR (target_start->>'owner')::int=(attacker_start->>'owner')::int OR coalesce((target_start->>'destroyed')::boolean,false) THEN RAISE EXCEPTION 'Choose an eligible enemy target';END IF;
 IF target_start->>'catalogueVersion' IS DISTINCT FROM p_catalogue_version THEN RAISE EXCEPTION 'Target catalogue does not match the pinned match catalogue';END IF;
 dist:=btech_hex_distance((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);map_id:=coalesce(st->>'map_id','training-grounds');
 move_mod:=CASE attacker_start->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target_start->>'hexesMoved')::int,0)>=25 THEN 6 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=18 THEN 5 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target_start->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END+CASE WHEN target_start->>'movementMode'='jump' THEN 1 ELSE 0 END;
 woods:=btech_intervening_woods(map_id,(attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int)+CASE btech_terrain(map_id,lpad(target_start->>'col',2,'0')||lpad(target_start->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 IF woods>=3 THEN RAISE EXCEPTION 'Line of sight is blocked by intervening woods';END IF;
 IF btech_elevation_blocks_los(map_id,(attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int) THEN RAISE EXCEPTION 'Line of sight is blocked by an intervening ridge';END IF;
 sensor_mod:=CASE btech_critical_label_count(attacker_start,'Sensors') WHEN 1 THEN 2 ELSE 0 END;heat_mod:=CASE WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=24 THEN 4 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=17 THEN 3 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=13 THEN 2 WHEN coalesce((attacker_start->>'roundStartingHeat')::int,0)+coalesce((attacker_start->>'movementHeat')::int,0)>=8 THEN 1 ELSE 0 END;
 prone_mod:=CASE WHEN coalesce((attacker_start->>'prone')::boolean,false) THEN 2 ELSE 0 END;target_prone_mod:=CASE WHEN coalesce((target_start->>'prone')::boolean,false) THEN CASE WHEN dist=1 THEN -2 ELSE 1 END ELSE 0 END;
 IF prone_mod>0 AND coalesce(attacker->>'proneSupportArm','') NOT IN ('la','ra') THEN RAISE EXCEPTION 'Choose a supporting arm before firing while prone';END IF;
 base_tn:=coalesce((attacker_start->'pilot'->>'gunnery')::int,4)+move_mod+target_mod+woods+sensor_mod+heat_mod+prone_mod+target_prone_mod;validation_attacker:=attacker_start;

 FOREACH selected_mount_id IN ARRAY btech_expand_ultra_ac_mounts(p_catalogue_version,attacker_start->>'unitId',p_weapon_mounts,coalesce(p_ammo_bins->'__fire_modes','{}'::jsonb)) LOOP
  heat_inflicted:=0;ams_used:=false;ams_modifier:=0;
  SELECT mount.location,mount.weapon_key,mount.definition,mount.raw_name INTO mount_location,selected_weapon_key,weapon,weapon_name FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>'unitId' AND mount.mount_id=selected_mount_id;
  IF NOT FOUND OR selected_weapon_key IS NULL THEN RAISE EXCEPTION 'Unsupported weapon mount: %',selected_mount_id;END IF;
  IF coalesce(attacker_start->'weaponJams','[]'::jsonb) ? selected_mount_id THEN RAISE EXCEPTION '% is jammed',weapon_name;END IF;
  weapon_damage:=coalesce((weapon->>'damage')::int,0);weapon_heat:=coalesce((weapon->>'heat')::int,0);accuracy_mod:=coalesce((weapon->>'toHitModifier')::int,0);short_range:=(weapon->'range'->>0)::int;medium_range:=(weapon->'range'->>1)::int;long_range:=(weapon->'range'->>2)::int;minimum_range:=coalesce((weapon->>'minimumRange')::int,0);selected_ammo_type:=weapon->>'ammoType';cluster_size:=(weapon->>'clusterSize')::int;damage_per_missile:=coalesce((weapon->>'damagePerMissile')::int,CASE WHEN selected_weapon_key LIKE 'lrm%' THEN 1 WHEN selected_weapon_key LIKE 'srm%' OR selected_weapon_key LIKE 'streak_srm%' THEN 2 END);
  streak:=coalesce((weapon->>'streak')::boolean,false);narc_attack:=selected_weapon_key='narc';tag_attack:=selected_weapon_key='tag';mode:=coalesce(p_ammo_bins->'__fire_modes'->>selected_mount_id,CASE WHEN selected_weapon_key='lb10x' THEN 'slug' ELSE 'single' END);
  IF selected_weapon_key='lb10x' AND mode='cluster' THEN cluster_size:=10;damage_per_missile:=1;accuracy_mod:=accuracy_mod-1;END IF;
  ammo_bin_id:=p_ammo_bins->>selected_mount_id;
  IF selected_ammo_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=attacker_start->>'unitId' AND bin.bin_id=ammo_bin_id AND bin.ammo_type=selected_ammo_type) THEN RAISE EXCEPTION 'Selected ammunition bin is not compatible with %',weapon_name;END IF;
  IF selected_weapon_key='lb10x' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(attacker->'ammoBins','[]'::jsonb)) bin WHERE bin->>'id'=ammo_bin_id AND bin->>'loadType'=mode) THEN RAISE EXCEPTION 'Selected LB-X bin was not loaded for that ammunition type during Round 1 setup';END IF;
  IF NOT p_resolve THEN validation_attacker:=btech_consume_selected_ammo(validation_attacker,selected_ammo_type,ammo_bin_id);ELSIF NOT streak THEN attacker:=btech_consume_simultaneous_ammo(attacker,attacker_start,selected_ammo_type,ammo_bin_id);END IF;
  IF coalesce((attacker_start->'structure'->>mount_location)::int,0)<=0 THEN RAISE EXCEPTION '% was mounted in a destroyed location',weapon_name;END IF;
  IF prone_mod>0 AND mount_location=attacker->>'proneSupportArm' THEN RAISE EXCEPTION 'Supporting-arm weapons cannot fire while prone';END IF;
  critical_label:=CASE selected_weapon_key WHEN 'ac20' THEN 'Autocannon/20' WHEN 'ac10' THEN 'Autocannon/10' WHEN 'ac5' THEN 'Autocannon/5' WHEN 'ac2' THEN 'Autocannon/2' ELSE weapon_name END;
  IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND btech_weapon_slot_matches(slot.label,selected_weapon_key,critical_label) AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index)) THEN RAISE EXCEPTION '% was destroyed before this phase',weapon_name;END IF;
  component_mod:=0;IF mount_location IN ('la','ra') THEN IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND slot.label='Shoulder' AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index)) THEN component_mod:=4;ELSE SELECT count(*)::int INTO component_mod FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>'unitId' AND slot.location=mount_location AND slot.label IN ('Upper Arm Actuator','Lower Arm Actuator') AND btech_critical_slot_is_damaged(attacker_start,mount_location,slot.slot_index);END IF;END IF;
  firing_facing:=CASE WHEN mount_location IN ('lt','rt','ct','head') THEN coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int) ELSE (attacker_start->>'facing')::int END;firing_direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_start->>'col')::int,(target_start->>'row')::int);facing_diff:=(firing_direction-firing_facing+6)%6;IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION '% target is outside its firing arc',weapon_name;END IF;
  target_direction:=btech_direction_to((target_start->>'col')::int,(target_start->>'row')::int,(attacker_start->>'col')::int,(attacker_start->>'row')::int);target_diff:=(target_direction-(target_start->>'facing')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN 'front' WHEN target_diff=1 THEN 'side-right' WHEN target_diff=5 THEN 'side-left' ELSE 'rear' END;
  IF dist>long_range THEN RAISE EXCEPTION '% is beyond long range',weapon_name;END IF;range_mod:=CASE WHEN dist<=short_range THEN 0 WHEN dist<=medium_range THEN 2 ELSE 4 END;IF minimum_range>0 AND dist<=minimum_range THEN range_mod:=range_mod+(minimum_range-dist+1);END IF;tn:=base_tn+range_mod+component_mod+accuracy_mod;
  IF p_resolve THEN
   da:=floor(random()*6+1);db:=floor(random()*6+1);hit:=da+db>=tn AND tn<=12 AND NOT (selected_weapon_key LIKE 'uac%' AND mode='rapid' AND da+db=2);
   IF streak AND hit THEN attacker:=btech_consume_one_live_ammo(attacker,selected_ammo_type,ammo_bin_id);END IF;
   IF hit AND tag_attack THEN target:=jsonb_set(target,'{taggedRound}',to_jsonb(p_round),true);results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'tagged',true));
   ELSIF hit AND narc_attack THEN target:=jsonb_set(target,'{narcPod}',jsonb_build_object('round',p_round,'source',p_attacker_instance_id),true);results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'narc_attached',true));
   ELSIF hit AND cluster_size IS NULL THEN location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_weapon_damage(target,weapon_damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';IF selected_weapon_key='flamer' THEN heat_inflicted:=2;target:=jsonb_set(target,'{externalHeat}',to_jsonb(coalesce((target->>'externalHeat')::int,0)+2),true);target:=jsonb_set(target,'{heat}',to_jsonb(coalesce((target->>'heat')::int,0)+2),true);END IF;results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'fire_mode',mode,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'location_roll',location_roll,'location',location_roll->>'location','damage',weapon_damage,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check','gauss_explosion',damage_result->'gauss_explosion','heat_inflicted',heat_inflicted));
   ELSIF hit THEN
    narc_guided:=coalesce((target_start->'narcPod'->>'round')::int,0)>0 AND EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=attacker_start->>'unitId' AND bin.bin_id=ammo_bin_id AND bin.raw_name ILIKE '%Narc-capable%');
    SELECT bin->>'id' INTO ams_bin_id FROM jsonb_array_elements(coalesce(target->'ammoBins','[]'::jsonb)) bin WHERE bin->>'type'='ams' AND coalesce((bin->>'shots')::int,0)>0 AND NOT coalesce((bin->>'destroyed')::boolean,false) LIMIT 1;
    SELECT mount.location INTO ams_mount_location FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=p_catalogue_version AND mount.unit_id=target_start->>'unitId' AND mount.weapon_key='ams' AND NOT EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=target_start->>'unitId' AND slot.location=mount.location AND btech_weapon_slot_matches(slot.label,'ams','Anti-Missile System') AND btech_critical_slot_is_damaged(target_start,slot.location,slot.slot_index)) LIMIT 1;
    IF coalesce((weapon->>'missileWeapon')::boolean,false) AND ams_bin_id IS NOT NULL AND ams_mount_location IS NOT NULL AND target_diff IN (0,1,5) THEN target:=btech_consume_one_live_ammo(target,'ams',ams_bin_id);target:=jsonb_set(target,'{heat}',to_jsonb(coalesce((target->>'heat')::int,0)+1),true);ams_used:=true;ams_modifier:=-4;END IF;
    cluster_da:=floor(random()*6+1);cluster_db:=floor(random()*6+1);cluster_total:=CASE WHEN streak THEN greatest(2,12+ams_modifier) ELSE greatest(2,least(12,cluster_da+cluster_db+CASE WHEN narc_guided THEN 2 ELSE 0 END+ams_modifier)) END;missiles_hit:=btech_cluster_hits(cluster_size,cluster_total);missiles_remaining:=missiles_hit;groups:='[]'::jsonb;
    WHILE missiles_remaining>0 LOOP group_damage:=CASE WHEN selected_weapon_key LIKE 'lrm%' THEN least(5,missiles_remaining) ELSE damage_per_missile END;location_roll:=btech_roll_mech_hit_location(angle);damage_result:=btech_apply_weapon_damage(target,group_damage,location_roll->>'location',angle='rear');target:=damage_result->'mech';groups:=groups||jsonb_build_array(jsonb_build_object('location_roll',location_roll,'location',location_roll->>'location','damage',group_damage,'critical_checks',damage_result->'critical_checks','pilot_check',damage_result->'pilot_check','gauss_explosion',damage_result->'gauss_explosion'));missiles_remaining:=missiles_remaining-CASE WHEN selected_weapon_key LIKE 'lrm%' THEN least(5,missiles_remaining) ELSE 1 END;END LOOP;
    results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'fire_mode',mode,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'cluster_roll',CASE WHEN streak THEN NULL ELSE jsonb_build_object('die_a',cluster_da,'die_b',cluster_db,'total',cluster_da+cluster_db,'modified_total',cluster_total) END,'streak_lock',streak,'narc_guided',narc_guided,'ams',CASE WHEN ams_used THEN jsonb_build_object('bin_id',ams_bin_id,'modifier',ams_modifier) END,'missiles_hit',missiles_hit,'cluster_kind',CASE WHEN selected_weapon_key='lb10x' THEN 'lb_x' ELSE 'missile' END,'groups',groups));
   ELSE IF selected_weapon_key LIKE 'uac%' AND mode='rapid' AND da+db=2 THEN attacker:=jsonb_set(attacker,'{weaponJams}',coalesce(attacker->'weaponJams','[]'::jsonb)||to_jsonb(selected_mount_id),true);END IF;results:=results||jsonb_build_array(jsonb_build_object('mount_id',selected_mount_id,'weapon',weapon_name,'fire_mode',mode,'ammo_bin_id',ammo_bin_id,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',false,'streak_no_lock',streak,'jammed',selected_weapon_key LIKE 'uac%' AND mode='rapid' AND da+db=2));END IF;
   results:=jsonb_set(results,ARRAY[(jsonb_array_length(results)-1)::text,'to_hit','breakdown'],jsonb_build_object('gunnery',coalesce((attacker_start->'pilot'->>'gunnery')::int,4),'attacker_movement',move_mod,'target_movement',target_mod,'range',range_mod,'woods',woods,'sensors',sensor_mod,'heat',heat_mod,'component_damage',component_mod,'prone',prone_mod,'target_prone',target_prone_mod,'weapon_accuracy',accuracy_mod),true);
   IF NOT streak OR hit THEN heat_added:=heat_added+weapon_heat;END IF;
  END IF;
 END LOOP;
 IF p_resolve THEN attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);attacker:=jsonb_set(attacker,'{weaponHeat}',to_jsonb(coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);attacker:=jsonb_set(attacker,'{heat}',to_jsonb(coalesce((attacker->>'roundStartingHeat')::int,0)+coalesce((attacker->>'movementHeat')::int,0)+coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker WHEN value->>'instanceId'=p_target_instance_id THEN target ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);END IF;
 RETURN jsonb_build_object('state',st,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.btech_process_weapon_declaration(text,int,jsonb,text,text,text[],jsonb,boolean) FROM PUBLIC;

COMMENT ON FUNCTION public.btech_process_weapon_declaration(text,int,jsonb,text,text,text[],jsonb,boolean) IS 'canonical-special-equipment-resolver-v1';
