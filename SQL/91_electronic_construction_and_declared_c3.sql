-- Electronic construction equipment and declared C3/C3i networks.
-- Run after SQL/90_targeting_computers_and_c3_networks.sql.

CREATE OR REPLACE FUNCTION public.btech_custom_targeting_computer_tons(p_design jsonb)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT ceil(coalesce(sum(((public.btech_custom_equipment(item->>'key'))->>'weight')::numeric),0) /
   CASE WHEN p_design->>'tech_base'='clan' THEN 5.0 ELSE 4.0 END)::int
 FROM jsonb_array_elements(coalesce(p_design->'weapons','[]'::jsonb)) item
 WHERE NOT coalesce(((public.btech_custom_equipment(item->>'key'))->>'missileWeapon')::boolean,false)
   AND NOT coalesce(((public.btech_custom_equipment(item->>'key'))->>'supportOnly')::boolean,false)
$$;

CREATE OR REPLACE FUNCTION public.btech_custom_electronic(p_key text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE tons int;
BEGIN
 IF p_key IN ('is_targeting_computer','clan_targeting_computer') THEN
  tons:=btech_custom_targeting_computer_tons(p_design);
  RETURN jsonb_build_object('name',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'weight',tons,'slots',tons,'tech',CASE WHEN p_key='clan_targeting_computer' THEN 'clan' ELSE 'inner_sphere' END,'label',CASE WHEN p_key='clan_targeting_computer' THEN 'Clan Targeting Computer' ELSE 'IS Targeting Computer' END,'variable',true);
 END IF;
 RETURN CASE p_key
  WHEN 'guardian_ecm' THEN '{"name":"Guardian ECM Suite","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Guardian ECM Suite"}'
  WHEN 'clan_ecm' THEN '{"name":"Clan ECM Suite","weight":1,"slots":1,"tech":"clan","label":"Clan ECM Suite"}'
  WHEN 'beagle_probe' THEN '{"name":"Beagle Active Probe","weight":1.5,"slots":2,"tech":"inner_sphere","label":"IS Beagle Active Probe"}'
  WHEN 'clan_active_probe' THEN '{"name":"Clan Active Probe","weight":1,"slots":1,"tech":"clan","label":"Clan Active Probe"}'
  WHEN 'c3_master' THEN '{"name":"C3 Computer (Master)","weight":5,"slots":5,"tech":"inner_sphere","label":"IS C3 Master Computer","repeatable":true}'
  WHEN 'c3_slave' THEN '{"name":"C3 Computer (Slave)","weight":1,"slots":1,"tech":"inner_sphere","label":"IS C3 Slave Computer"}'
  WHEN 'c3i' THEN '{"name":"Improved C3 Computer (C3i)","weight":2.5,"slots":2,"tech":"inner_sphere","label":"IS C3i Computer"}' END::jsonb;
END $$;

DO $$ BEGIN
 IF to_regprocedure('public.btech_build_custom_layout_v78(jsonb)') IS NULL THEN ALTER FUNCTION public.btech_build_custom_layout(jsonb) RENAME TO btech_build_custom_layout_v78;END IF;
 IF to_regprocedure('public.btech_validate_custom_design_v78(jsonb)') IS NULL THEN ALTER FUNCTION public.btech_validate_custom_design(jsonb) RENAME TO btech_validate_custom_design_v78;END IF;
END $$;

CREATE OR REPLACE FUNCTION public.btech_build_custom_layout(p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE layout jsonb;item jsonb;profile jsonb;loc text;counter int;rating int:=(p_design->>'tonnage')::int*(p_design->>'walking_mp')::int;external_sinks int;
BEGIN
 layout:=btech_build_custom_layout_v78(p_design-'electronics');
 FOREACH loc IN ARRAY ARRAY['head','ct','lt','rt','la','ra','ll','rl'] LOOP
  layout:=jsonb_set(layout,ARRAY[loc],(SELECT jsonb_agg(CASE WHEN value#>>'{}' IN ('Jump Jet','Heat Sink') THEN 'null'::jsonb ELSE value END ORDER BY ordinality) FROM jsonb_array_elements(layout->loc) WITH ORDINALITY slot(value,ordinality)),true);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_design->'electronics','[]'::jsonb)) value LOOP
  profile:=btech_custom_electronic(item->>'key',p_design);
  layout:=btech_custom_allocate_slots(layout,item->>'location',profile->>'label',(profile->>'slots')::int);
 END LOOP;
 FOR counter IN 1..(p_design->>'jump_mp')::int LOOP layout:=btech_custom_allocate_any(layout,'Jump Jet',ARRAY['ll','rl','lt','rt','ct']);END LOOP;
 external_sinks:=greatest(0,(p_design->>'heat_sinks')::int-least(10,floor(rating/25.0)::int));FOR counter IN 1..external_sinks LOOP layout:=btech_custom_allocate_any(layout,'Heat Sink',ARRAY['lt','rt','la','ra','ll','rl','ct','head']);END LOOP;
 RETURN layout;
END $$;

CREATE OR REPLACE FUNCTION public.btech_validate_custom_design(p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE result jsonb;electronics jsonb;item jsonb;profile jsonb;tech_base text;electronic_weight numeric:=0;new_total numeric;key_name text;
BEGIN
 result:=btech_validate_custom_design_v78(p_design-'electronics');
 tech_base:=result->>'tech_base';electronics:=coalesce(p_design->'electronics','[]'::jsonb);
 IF jsonb_typeof(electronics)<>'array' OR jsonb_array_length(electronics)>20 THEN RAISE EXCEPTION 'Invalid electronic equipment declaration';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(electronics) value LOOP
  profile:=btech_custom_electronic(item->>'key',p_design);key_name:=item->>'key';
  IF profile IS NULL OR item->>'location' NOT IN ('head','ct','lt','rt','la','ra','ll','rl') THEN RAISE EXCEPTION 'Unsupported electronic equipment: %',key_name;END IF;
  IF profile->>'tech'<>tech_base THEN RAISE EXCEPTION '% requires % technology',profile->>'name',profile->>'tech';END IF;
  IF coalesce((profile->>'slots')::int,0)<1 THEN RAISE EXCEPTION 'A Targeting Computer requires at least one eligible direct-fire weapon';END IF;
  IF key_name<>'c3_master' AND (SELECT count(*) FROM jsonb_array_elements(electronics) other WHERE other->>'key'=key_name)>1 THEN RAISE EXCEPTION 'Only one % may be fitted',profile->>'name';END IF;
  electronic_weight:=electronic_weight+(profile->>'weight')::numeric;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(electronics) e WHERE e->>'key'='c3i') AND EXISTS(SELECT 1 FROM jsonb_array_elements(electronics) e WHERE e->>'key' IN ('c3_master','c3_slave')) THEN RAISE EXCEPTION 'C3i cannot be combined with standard C3 equipment';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(electronics) e WHERE e->>'key'='c3_master') AND EXISTS(SELECT 1 FROM jsonb_array_elements(electronics) e WHERE e->>'key'='c3_slave') THEN RAISE EXCEPTION 'Choose either C3 Master equipment or a C3 Slave';END IF;
 result:=jsonb_set(result,'{critical_layout}',btech_build_custom_layout(p_design),true);
 new_total:=(result->'weights'->>'total')::numeric+electronic_weight;
 IF new_total>(p_design->>'tonnage')::numeric THEN RAISE EXCEPTION 'Design is overweight by % tons',new_total-(p_design->>'tonnage')::numeric;END IF;
 result:=jsonb_set(result,'{weights,electronics}',to_jsonb(electronic_weight),true);
 result:=jsonb_set(result,'{weights,total}',to_jsonb(new_total),true);
 result:=jsonb_set(result,'{weights,remaining}',to_jsonb((p_design->>'tonnage')::numeric-new_total),true);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.btech_validate_custom_design(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.save_btech_custom_design(p_catalogue_version text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE design_id uuid:=gen_random_uuid();unit_id text;calculation jsonb;definition jsonb;layout jsonb;armor jsonb;structure jsonb;item jsonb;profile jsonb;ammo_profile jsonb;location text;slot_label text;slot_index int;mount_index int:=0;bin_index int:=0;counter int;bins int;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM btech_catalogue_releases WHERE version=p_catalogue_version) THEN RAISE EXCEPTION 'Sign in and choose an installed catalogue release';END IF;IF (SELECT count(*) FROM btech_custom_designs WHERE owner_id=auth.uid() AND NOT archived)>=50 THEN RAISE EXCEPTION 'A player may keep up to 50 active custom designs';END IF;
 calculation:=btech_validate_custom_design(p_design);layout:=calculation->'critical_layout';structure:=calculation->'structure';armor:=p_design->'armor';unit_id:='custom-'||replace(design_id::text,'-','');definition:=jsonb_build_object('id',unit_id,'chassis',btrim(p_design->>'name'),'variant',btrim(p_design->>'variant'),'mass',(p_design->>'tonnage')::int,'config','Biped','tech_base',CASE WHEN calculation->>'tech_base'='clan' THEN 'Clan' ELSE 'Inner Sphere' END,'era',3050,'movement',jsonb_build_object('walk',(p_design->>'walking_mp')::int,'run',ceil((p_design->>'walking_mp')::numeric*1.5)::int,'jump',(p_design->>'jump_mp')::int),'heat_sinks',(p_design->>'heat_sinks')::int,'heat_sink_type','Single','heat_sink_capacity',(p_design->>'heat_sinks')::int,'armor',armor,'structure',structure,'construction',calculation->'construction','supported_by_vtt',true,'custom_design',true,'custom_owner_id',auth.uid()::text);
 INSERT INTO btech_custom_designs(id,owner_id,catalogue_version,unit_id,name,design,calculation) VALUES(design_id,auth.uid(),p_catalogue_version,unit_id,btrim(p_design->>'name')||' '||btrim(p_design->>'variant'),p_design,calculation);INSERT INTO btech_catalogue_units(catalogue_version,unit_id,source_uuid,definition) VALUES(p_catalogue_version,unit_id,design_id::text,definition);
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'weapons') value LOOP profile:=btech_custom_equipment(item->>'key');location:=item->>'location';INSERT INTO btech_catalogue_mounts(catalogue_version,unit_id,mount_id,weapon_key,raw_name,location,definition) VALUES(p_catalogue_version,unit_id,(item->>'key')||':'||location||':'||mount_index,item->>'key',profile->>'name',location,(profile-ARRAY['name','weight','slots','label','clan']));mount_index:=mount_index+1;END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_design->'electronics','[]'::jsonb)) value LOOP IF item->>'key'='c3_master' THEN location:=item->>'location';INSERT INTO btech_catalogue_mounts(catalogue_version,unit_id,mount_id,weapon_key,raw_name,location,definition) VALUES(p_catalogue_version,unit_id,'c3_master_tag:'||location||':'||mount_index,'c3_master_tag','C3 Master TAG',location,'{"key":"c3_master_tag","name":"C3 Master TAG","damage":0,"heat":0,"range":[5,9,15],"supportOnly":true}'::jsonb);mount_index:=mount_index+1;END IF;END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'ammo') value LOOP ammo_profile:=btech_custom_ammo(item->>'type');location:=item->>'location';bins:=(item->>'bins')::int;FOR counter IN 1..bins LOOP INSERT INTO btech_catalogue_ammo_bins(catalogue_version,unit_id,bin_id,ammo_type,raw_name,location,shots) VALUES(p_catalogue_version,unit_id,location||':'||bin_index,item->>'type',ammo_profile->>'name',location,(ammo_profile->>'shots')::int);bin_index:=bin_index+1;END LOOP;END LOOP;
 FOREACH location IN ARRAY ARRAY['head','ct','lt','rt','la','ra','ll','rl'] LOOP FOR slot_label,slot_index IN SELECT value#>>'{}',(ordinality-1)::int FROM jsonb_array_elements(layout->location) WITH ORDINALITY slot(value,ordinality) WHERE value<>'null'::jsonb LOOP INSERT INTO btech_catalogue_critical_slots(catalogue_version,unit_id,location,slot_index,label) VALUES(p_catalogue_version,unit_id,location,slot_index,slot_label);END LOOP;END LOOP;
 RETURN jsonb_build_object('id',design_id,'unit_id',unit_id,'catalogue_version',p_catalogue_version,'name',btrim(p_design->>'name')||' '||btrim(p_design->>'variant'),'calculation',calculation);
END $$;
REVOKE ALL ON FUNCTION public.save_btech_custom_design(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_btech_custom_design(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_catalogue_c3_role(p_catalogue_version text,p_unit_id text)
RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE
  WHEN bool_or(btech_equipment_label_key(label) IN ('c3icomputer','improvedc3computer')) THEN 'c3i'
  WHEN bool_or(btech_equipment_label_key(label) IN ('c3mastercomputer','c3master')) THEN 'master'
  WHEN bool_or(btech_equipment_label_key(label) IN ('c3slavecomputer','c3slave')) THEN 'slave' END
 FROM btech_catalogue_critical_slots WHERE catalogue_version=p_catalogue_version AND unit_id=p_unit_id
$$;

CREATE OR REPLACE FUNCTION public.set_match_c3_assignments(p_game_id uuid,p_assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;roster jsonb;entry record;assignment jsonb;idx int;unit_id text;role text;network_id text;parent_idx int;parent_role text;cursor_idx int;depth int;child_roles int;root_count int;network_count int;network_limit int;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;IF NOT FOUND OR g.status<>'lobby' THEN RAISE EXCEPTION 'C3 networks may only be assigned in the lobby';END IF;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';IF NOT FOUND THEN RAISE EXCEPTION 'Only a seated player may assign this network';END IF;
 IF jsonb_typeof(p_assignments)<>'object' OR (SELECT count(*) FROM jsonb_each(p_assignments))>12 THEN RAISE EXCEPTION 'Invalid C3 assignment declaration';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'object' THEN g.state WHEN 'string' THEN coalesce((g.state#>>'{}')::jsonb,'{}'::jsonb) ELSE '{}'::jsonb END;roster:=coalesce(st->'rosters'->player.seat_number::text,'[]'::jsonb);
 FOR entry IN SELECT key,value FROM jsonb_each(p_assignments) LOOP
  IF entry.key !~ '^[0-9]+$' THEN RAISE EXCEPTION 'A C3 assignment has an invalid roster position';END IF;idx:=entry.key::int;
  IF idx<0 OR idx>=jsonb_array_length(roster) THEN RAISE EXCEPTION 'A C3 assignment no longer matches this roster';END IF;unit_id:=roster->>idx;
  IF entry.value->>'unitId' IS DISTINCT FROM unit_id THEN RAISE EXCEPTION 'A C3 assignment no longer matches this BattleMech';END IF;
  role:=btech_catalogue_c3_role(g.catalogue_version,unit_id);network_id:=upper(coalesce(entry.value->>'network',''));
  IF network_id='' THEN CONTINUE;END IF;IF role IS NULL OR network_id NOT IN ('A','B','C','D') THEN RAISE EXCEPTION 'Unsupported C3 network assignment';END IF;
  IF role='c3i' AND (entry.value ? 'parent') AND entry.value->'parent'<>'null'::jsonb THEN RAISE EXCEPTION 'C3i peers do not use a parent Master';END IF;
 END LOOP;
 FOR network_id IN SELECT DISTINCT upper(value->>'network') FROM jsonb_each(p_assignments) WHERE coalesce(value->>'network','')<>'' LOOP
  IF EXISTS(SELECT 1 FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(a.key::int))='c3i') AND EXISTS(SELECT 1 FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(a.key::int))<>'c3i') THEN RAISE EXCEPTION 'Standard C3 and C3i cannot share a network';END IF;
  SELECT count(*)::int INTO network_count FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(a.key::int))='c3i') THEN 6 ELSE 12 END INTO network_limit;
  IF network_count>network_limit THEN RAISE EXCEPTION 'C3 network % exceeds its unit limit',network_id;END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(a.key::int))<>'c3i') THEN CONTINUE;END IF;
  SELECT count(*) INTO root_count FROM jsonb_each(p_assignments) a WHERE upper(a.value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(a.key::int))='master' AND (NOT (a.value ? 'parent') OR a.value->'parent'='null'::jsonb);
  IF root_count<>1 THEN RAISE EXCEPTION 'Standard C3 network % requires exactly one root Master',network_id;END IF;
  FOR entry IN SELECT key,value FROM jsonb_each(p_assignments) WHERE upper(value->>'network')=network_id LOOP
   idx:=entry.key::int;role:=btech_catalogue_c3_role(g.catalogue_version,roster->>idx);
   IF role='slave' AND (NOT (entry.value ? 'parent') OR entry.value->'parent'='null'::jsonb) THEN RAISE EXCEPTION 'Every C3 Slave requires a parent Master';END IF;
   IF entry.value?'parent' AND entry.value->'parent'<>'null'::jsonb THEN parent_idx:=(entry.value->>'parent')::int;assignment:=p_assignments->(parent_idx::text);parent_role:=btech_catalogue_c3_role(g.catalogue_version,roster->>parent_idx);IF assignment IS NULL OR upper(assignment->>'network')<>network_id OR parent_role<>'master' THEN RAISE EXCEPTION 'Every C3 parent must be a Master in the same network';END IF;END IF;
   cursor_idx:=idx;depth:=0;LOOP assignment:=p_assignments->(cursor_idx::text);EXIT WHEN NOT (assignment ? 'parent') OR assignment->'parent'='null'::jsonb;cursor_idx:=(assignment->>'parent')::int;depth:=depth+1;IF depth>12 THEN RAISE EXCEPTION 'C3 network % contains a cycle',network_id;END IF;END LOOP;
  END LOOP;
  FOR entry IN SELECT key,value FROM jsonb_each(p_assignments) WHERE upper(value->>'network')=network_id AND btech_catalogue_c3_role(g.catalogue_version,roster->>(key::int))='master' LOOP
   IF (SELECT count(*) FROM jsonb_each(p_assignments) child WHERE upper(child.value->>'network')=network_id AND child.value->>'parent'=entry.key)>3 THEN RAISE EXCEPTION 'A C3 Master may control at most three units';END IF;
   SELECT count(DISTINCT CASE WHEN btech_catalogue_c3_role(g.catalogue_version,roster->>(child.key::int))='master' THEN 1 ELSE 2 END) INTO child_roles FROM jsonb_each(p_assignments) child WHERE upper(child.value->>'network')=network_id AND child.value->>'parent'=entry.key;
   IF child_roles>1 THEN RAISE EXCEPTION 'A C3 Master may control Masters or Slaves, but not both';END IF;
  END LOOP;
 END LOOP;
 st:=jsonb_set(st,ARRAY['c3_assignments',player.seat_number::text],p_assignments,true);UPDATE btech_games SET state=st WHERE id=p_game_id;UPDATE btech_players SET ready=false WHERE id=player.id;RETURN p_assignments;
END $$;
REVOKE ALL ON FUNCTION public.set_match_c3_assignments(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_c3_assignments(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_c3_connected_root(p_catalogue_version text,p_state jsonb,p_owner int,p_member jsonb,p_network_id text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE current_mech jsonb:=p_member;parent_mech jsonb;parent_id text;role text;depth int:=0;
BEGIN
 LOOP
  IF coalesce((current_mech->>'owner')::int,-1)<>p_owner OR current_mech->'c3Network'->>'id' IS DISTINCT FROM p_network_id OR coalesce((current_mech->>'destroyed')::boolean,false) THEN RETURN NULL;END IF;
  role:=btech_c3_role(p_catalogue_version,current_mech);IF role IS NULL OR btech_ecm_interferes_line(p_catalogue_version,p_state,p_owner,(current_mech->>'col')::int,(current_mech->>'row')::int,(current_mech->>'col')::int,(current_mech->>'row')::int) THEN RETURN NULL;END IF;
  parent_id:=nullif(current_mech->'c3Network'->>'parentInstanceId','');IF parent_id IS NULL THEN RETURN CASE WHEN role='master' THEN current_mech->>'instanceId' END;END IF;
  SELECT coalesce(value->'weaponPhaseStart'->'mech',value)||jsonb_build_object('instanceId',value->>'instanceId') INTO parent_mech FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE value->>'instanceId'=parent_id LIMIT 1;
  IF parent_mech IS NULL OR btech_c3_role(p_catalogue_version,parent_mech) IS DISTINCT FROM 'master' OR btech_ecm_interferes_line(p_catalogue_version,p_state,p_owner,(current_mech->>'col')::int,(current_mech->>'row')::int,(parent_mech->>'col')::int,(parent_mech->>'row')::int) THEN RETURN NULL;END IF;
  current_mech:=parent_mech;depth:=depth+1;IF depth>12 THEN RETURN NULL;END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.btech_c3_range_distance(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS int LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE physical_distance int:=btech_hex_distance((p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int);best_distance int;role text;owner_no int:=(p_attacker->>'owner')::int;network_id text;network_type text;root_id text;live jsonb;candidate jsonb;candidate_role text;
BEGIN
 role:=btech_c3_role(p_catalogue_version,p_attacker);network_id:=p_attacker->'c3Network'->>'id';network_type:=p_attacker->'c3Network'->>'type';IF role IS NULL OR network_id IS NULL OR p_attacker->'c3Network'->>'role' IS DISTINCT FROM role THEN RETURN physical_distance;END IF;
 IF btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_attacker->>'col')::int,(p_attacker->>'row')::int) THEN RETURN physical_distance;END IF;
 IF network_type='standard' THEN root_id:=btech_c3_connected_root(p_catalogue_version,p_state,owner_no,p_attacker,network_id);IF root_id IS NULL THEN RETURN physical_distance;END IF;ELSIF network_type<>'c3i' OR role<>'c3i' THEN RETURN physical_distance;END IF;
 best_distance:=physical_distance;
 FOR live IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value LOOP
  candidate:=coalesce(live->'weaponPhaseStart'->'mech',live)||jsonb_build_object('instanceId',live->>'instanceId');candidate_role:=btech_c3_role(p_catalogue_version,candidate);
  CONTINUE WHEN (candidate->>'owner')::int<>owner_no OR coalesce((candidate->>'destroyed')::boolean,false) OR candidate->'c3Network'->>'id' IS DISTINCT FROM network_id OR candidate->'c3Network'->>'type' IS DISTINCT FROM network_type;
  CONTINUE WHEN (network_type='c3i' AND candidate_role IS DISTINCT FROM 'c3i') OR (network_type='standard' AND btech_c3_connected_root(p_catalogue_version,p_state,owner_no,candidate,network_id) IS DISTINCT FROM root_id);
  CONTINUE WHEN btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(candidate->>'col')::int,(candidate->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);
  IF network_type='c3i' AND btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int) THEN CONTINUE;END IF;
  CONTINUE WHEN btech_intervening_terrain(p_state,(candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)>=3 OR btech_elevation_blocks_los(coalesce(p_state->>'map_id','training-grounds'),(candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int);
  best_distance:=least(best_distance,btech_hex_distance((candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int));
 END LOOP;RETURN best_distance;
END $$;

-- A C3 Master includes a built-in TAG designator. Teach the maintained weapon
-- resolver to recognise its published mount and its shared critical system.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('c3_master_tag_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'tag_attack:=selected_weapon_key=''tag'';','tag_attack:=selected_weapon_key IN (''tag'',''c3_master_tag''); /* c3_master_tag_v1 */');
 patched:=replace(patched,'selected_weapon_key IN (''tag'',''narc'',''ams'')','selected_weapon_key IN (''tag'',''c3_master_tag'',''narc'',''ams'')');
 patched:=replace(patched,'selected_weapon_key NOT IN (''tag'',''narc'',''ams'')','selected_weapon_key NOT IN (''tag'',''c3_master_tag'',''narc'',''ams'')');
 patched:=replace(patched,'btech_weapon_slot_matches(slot.label,selected_weapon_key,critical_label) AND btech_critical_slot_is_damaged','(btech_weapon_slot_matches(slot.label,selected_weapon_key,critical_label) OR (selected_weapon_key=''c3_master_tag'' AND btech_equipment_label_key(slot.label) IN (''c3mastercomputer'',''c3master''))) AND btech_critical_slot_is_damaged');
 IF patched=source OR position('c3_master_tag_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install the C3 Master TAG mount';END IF;EXECUTE patched;
END $$;
