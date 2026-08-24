-- Immutable, player-owned custom BattleMech designs.
-- Run after SQL/75_objectives_and_victory_conditions.sql.
-- The first supported construction tier is standard Inner Sphere biped
-- technology using equipment already resolved by the authoritative VTT.

CREATE TABLE IF NOT EXISTS public.btech_custom_designs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 catalogue_version text NOT NULL REFERENCES public.btech_catalogue_releases(version),
 unit_id text NOT NULL,
 name text NOT NULL,
 design jsonb NOT NULL,
 calculation jsonb NOT NULL,
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(catalogue_version,unit_id)
);
ALTER TABLE public.btech_custom_designs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Players can read their custom BattleMechs" ON public.btech_custom_designs;
CREATE POLICY "Players can read their custom BattleMechs" ON public.btech_custom_designs FOR SELECT TO authenticated USING(owner_id=auth.uid());
GRANT SELECT ON public.btech_custom_designs TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_custom_structure(p_tonnage int)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_tonnage
  WHEN 20 THEN '{"head":3,"ct":6,"lt":5,"rt":5,"la":3,"ra":3,"ll":4,"rl":4}'
  WHEN 25 THEN '{"head":3,"ct":8,"lt":6,"rt":6,"la":4,"ra":4,"ll":6,"rl":6}'
  WHEN 30 THEN '{"head":3,"ct":10,"lt":7,"rt":7,"la":5,"ra":5,"ll":7,"rl":7}'
  WHEN 35 THEN '{"head":3,"ct":11,"lt":8,"rt":8,"la":6,"ra":6,"ll":8,"rl":8}'
  WHEN 40 THEN '{"head":3,"ct":12,"lt":10,"rt":10,"la":6,"ra":6,"ll":10,"rl":10}'
  WHEN 45 THEN '{"head":3,"ct":14,"lt":11,"rt":11,"la":7,"ra":7,"ll":11,"rl":11}'
  WHEN 50 THEN '{"head":3,"ct":16,"lt":12,"rt":12,"la":8,"ra":8,"ll":12,"rl":12}'
  WHEN 55 THEN '{"head":3,"ct":18,"lt":13,"rt":13,"la":9,"ra":9,"ll":13,"rl":13}'
  WHEN 60 THEN '{"head":3,"ct":20,"lt":14,"rt":14,"la":10,"ra":10,"ll":14,"rl":14}'
  WHEN 65 THEN '{"head":3,"ct":21,"lt":15,"rt":15,"la":10,"ra":10,"ll":15,"rl":15}'
  WHEN 70 THEN '{"head":3,"ct":22,"lt":15,"rt":15,"la":11,"ra":11,"ll":15,"rl":15}'
  WHEN 75 THEN '{"head":3,"ct":23,"lt":16,"rt":16,"la":12,"ra":12,"ll":16,"rl":16}'
  WHEN 80 THEN '{"head":3,"ct":25,"lt":17,"rt":17,"la":13,"ra":13,"ll":17,"rl":17}'
  WHEN 85 THEN '{"head":3,"ct":27,"lt":18,"rt":18,"la":14,"ra":14,"ll":18,"rl":18}'
  WHEN 90 THEN '{"head":3,"ct":29,"lt":19,"rt":19,"la":15,"ra":15,"ll":19,"rl":19}'
  WHEN 95 THEN '{"head":3,"ct":30,"lt":20,"rt":20,"la":16,"ra":16,"ll":20,"rl":20}'
  WHEN 100 THEN '{"head":3,"ct":31,"lt":21,"rt":21,"la":17,"ra":17,"ll":21,"rl":21}' END::jsonb
$$;

CREATE OR REPLACE FUNCTION public.btech_standard_engine_weight(p_rating int)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN p_rating BETWEEN 5 AND 400 AND p_rating%5=0 THEN
  (ARRAY[.5,.5,.5,.5,.5,1,1,1,1,1.5,1.5,1.5,2,2,2,2.5,2.5,3,3,3,3.5,3.5,4,4,4,4.5,4.5,5,5,5.5,5.5,6,6,6,7,7,7.5,7.5,8,8.5,8.5,9,9.5,10,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15.5,16,16.5,17.5,18,19,19.5,20.5,21.5,22.5,23.5,24.5,25.5,27,28.5,29.5,31.5,33,34.5,36.5,38.5,41,43.5,46,49,52.5]::numeric[])[p_rating/5] END
$$;

CREATE OR REPLACE FUNCTION public.btech_custom_equipment(p_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_key
  WHEN 'small_laser' THEN '{"name":"Small Laser","weight":0.5,"slots":1,"damage":3,"heat":1,"range":[1,2,3],"label":"Small Laser"}'
  WHEN 'med_laser' THEN '{"name":"Medium Laser","weight":1,"slots":1,"damage":5,"heat":3,"range":[3,6,9],"label":"Medium Laser"}'
  WHEN 'large_laser' THEN '{"name":"Large Laser","weight":5,"slots":2,"damage":8,"heat":8,"range":[5,10,15],"label":"Large Laser"}'
  WHEN 'ppc' THEN '{"name":"PPC","weight":7,"slots":3,"damage":10,"heat":10,"range":[6,12,18],"minimumRange":3,"label":"PPC"}'
  WHEN 'flamer' THEN '{"name":"Flamer","weight":1,"slots":1,"damage":2,"heat":3,"range":[1,2,3],"label":"Flamer"}'
  WHEN 'ac2' THEN '{"name":"Autocannon/2","weight":6,"slots":1,"damage":2,"heat":1,"range":[8,16,24],"minimumRange":4,"ammoType":"ac2","label":"Autocannon/2"}'
  WHEN 'ac5' THEN '{"name":"Autocannon/5","weight":8,"slots":4,"damage":5,"heat":1,"range":[6,12,18],"minimumRange":3,"ammoType":"ac5","label":"Autocannon/5"}'
  WHEN 'ac10' THEN '{"name":"Autocannon/10","weight":12,"slots":7,"damage":10,"heat":3,"range":[5,10,15],"ammoType":"ac10","label":"Autocannon/10"}'
  WHEN 'ac20' THEN '{"name":"Autocannon/20","weight":14,"slots":10,"damage":20,"heat":7,"range":[3,6,9],"ammoType":"ac20","label":"Autocannon/20"}'
  WHEN 'machine_gun' THEN '{"name":"Machine Gun","weight":0.5,"slots":1,"damage":2,"heat":0,"range":[1,2,3],"ammoType":"machine_gun","label":"Machine Gun"}'
  WHEN 'lrm5' THEN '{"name":"LRM 5","weight":2,"slots":1,"damage":5,"heat":2,"range":[7,14,21],"minimumRange":6,"ammoType":"lrm5","clusterSize":5,"damagePerMissile":1,"missileWeapon":true,"label":"LRM 5"}'
  WHEN 'lrm10' THEN '{"name":"LRM 10","weight":5,"slots":2,"damage":10,"heat":4,"range":[7,14,21],"minimumRange":6,"ammoType":"lrm10","clusterSize":10,"damagePerMissile":1,"missileWeapon":true,"label":"LRM 10"}'
  WHEN 'lrm15' THEN '{"name":"LRM 15","weight":7,"slots":3,"damage":15,"heat":5,"range":[7,14,21],"minimumRange":6,"ammoType":"lrm15","clusterSize":15,"damagePerMissile":1,"missileWeapon":true,"label":"LRM 15"}'
  WHEN 'lrm20' THEN '{"name":"LRM 20","weight":10,"slots":5,"damage":20,"heat":6,"range":[7,14,21],"minimumRange":6,"ammoType":"lrm20","clusterSize":20,"damagePerMissile":1,"missileWeapon":true,"label":"LRM 20"}'
  WHEN 'srm2' THEN '{"name":"SRM 2","weight":1,"slots":1,"damage":4,"heat":2,"range":[3,6,9],"ammoType":"srm2","clusterSize":2,"damagePerMissile":2,"missileWeapon":true,"label":"SRM 2"}'
  WHEN 'srm4' THEN '{"name":"SRM 4","weight":2,"slots":1,"damage":8,"heat":3,"range":[3,6,9],"ammoType":"srm4","clusterSize":4,"damagePerMissile":2,"missileWeapon":true,"label":"SRM 4"}'
  WHEN 'srm6' THEN '{"name":"SRM 6","weight":3,"slots":2,"damage":12,"heat":4,"range":[3,6,9],"ammoType":"srm6","clusterSize":6,"damagePerMissile":2,"missileWeapon":true,"label":"SRM 6"}' END::jsonb
$$;

CREATE OR REPLACE FUNCTION public.btech_custom_ammo(p_type text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE p_type
  WHEN 'ac2' THEN '{"name":"IS Ammo AC/2","shots":45}' WHEN 'ac5' THEN '{"name":"IS Ammo AC/5","shots":20}'
  WHEN 'ac10' THEN '{"name":"IS Ammo AC/10","shots":10}' WHEN 'ac20' THEN '{"name":"IS Ammo AC/20","shots":5}'
  WHEN 'machine_gun' THEN '{"name":"IS Ammo MG","shots":200}'
  WHEN 'lrm5' THEN '{"name":"IS Ammo LRM-5","shots":24}' WHEN 'lrm10' THEN '{"name":"IS Ammo LRM-10","shots":12}'
  WHEN 'lrm15' THEN '{"name":"IS Ammo LRM-15","shots":8}' WHEN 'lrm20' THEN '{"name":"IS Ammo LRM-20","shots":6}'
  WHEN 'srm2' THEN '{"name":"IS Ammo SRM-2","shots":50}' WHEN 'srm4' THEN '{"name":"IS Ammo SRM-4","shots":25}'
  WHEN 'srm6' THEN '{"name":"IS Ammo SRM-6","shots":15}' END::jsonb
$$;

CREATE OR REPLACE FUNCTION public.btech_custom_allocate_slots(p_layout jsonb,p_location text,p_label text,p_count int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_layout;slot_limit int:=CASE WHEN p_location IN ('head','ll','rl') THEN 5 ELSE 11 END;start_at int;offset_at int;available boolean;
BEGIN
 IF p_count<1 OR p_count>slot_limit+1 THEN RAISE EXCEPTION '% requires an invalid number of critical slots',p_label;END IF;
 FOR start_at IN 0..slot_limit-p_count+1 LOOP
  available:=true;FOR offset_at IN 0..p_count-1 LOOP IF result->p_location->(start_at+offset_at)<>'null'::jsonb THEN available:=false;EXIT;END IF;END LOOP;
  IF available THEN FOR offset_at IN 0..p_count-1 LOOP result:=jsonb_set(result,ARRAY[p_location,(start_at+offset_at)::text],to_jsonb(p_label),false);END LOOP;RETURN result;END IF;
 END LOOP;
 RAISE EXCEPTION '% does not fit in %',p_label,p_location;
END $$;

CREATE OR REPLACE FUNCTION public.btech_custom_allocate_any(p_layout jsonb,p_label text,p_locations text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:=p_layout;location text;slot_limit int;slot_at int;
BEGIN
 FOREACH location IN ARRAY p_locations LOOP slot_limit:=CASE WHEN location IN ('head','ll','rl') THEN 5 ELSE 11 END;FOR slot_at IN 0..slot_limit LOOP IF result->location->slot_at='null'::jsonb THEN RETURN jsonb_set(result,ARRAY[location,slot_at::text],to_jsonb(p_label),false);END IF;END LOOP;END LOOP;
 RAISE EXCEPTION '% has no legal critical slot remaining',p_label;
END $$;

CREATE OR REPLACE FUNCTION public.btech_build_custom_layout(p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE layout jsonb:='{"head":["Life Support","Sensors","Cockpit",null,"Sensors","Life Support",null,null,null,null,null,null],"ct":["Fusion Engine","Fusion Engine","Fusion Engine","Gyro","Gyro","Gyro","Gyro","Fusion Engine","Fusion Engine","Fusion Engine",null,null],"lt":[null,null,null,null,null,null,null,null,null,null,null,null],"rt":[null,null,null,null,null,null,null,null,null,null,null,null],"la":["Shoulder","Upper Arm Actuator","Lower Arm Actuator","Hand Actuator",null,null,null,null,null,null,null,null],"ra":["Shoulder","Upper Arm Actuator","Lower Arm Actuator","Hand Actuator",null,null,null,null,null,null,null,null],"ll":["Hip","Upper Leg Actuator","Lower Leg Actuator","Foot Actuator",null,null,null,null,null,null,null,null],"rl":["Hip","Upper Leg Actuator","Lower Leg Actuator","Foot Actuator",null,null,null,null,null,null,null,null]}'::jsonb;
 item jsonb;profile jsonb;location text;bins int;counter int;rating int:=(p_design->>'tonnage')::int*(p_design->>'walking_mp')::int;external_sinks int;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'weapons') value LOOP profile:=btech_custom_equipment(item->>'key');layout:=btech_custom_allocate_slots(layout,item->>'location',profile->>'label',(profile->>'slots')::int);END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'ammo') value LOOP bins:=(item->>'bins')::int;FOR counter IN 1..bins LOOP layout:=btech_custom_allocate_slots(layout,item->>'location',btech_custom_ammo(item->>'type')->>'name',1);END LOOP;END LOOP;
 FOR counter IN 1..(p_design->>'jump_mp')::int LOOP layout:=btech_custom_allocate_any(layout,'Jump Jet',ARRAY['ll','rl','lt','rt','ct']);END LOOP;
 external_sinks:=greatest(0,(p_design->>'heat_sinks')::int-least(10,floor(rating/25.0)::int));FOR counter IN 1..external_sinks LOOP layout:=btech_custom_allocate_any(layout,'Heat Sink',ARRAY['lt','rt','la','ra','ll','rl','ct','head']);END LOOP;
 RETURN layout;
END $$;

CREATE OR REPLACE FUNCTION public.btech_validate_custom_design(p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE tonnage int;walking int;jumping int;sinks int;rating int;structure jsonb;armor jsonb;weapons jsonb;ammo jsonb;item jsonb;profile jsonb;ammo_profile jsonb;
 structure_weight numeric;engine_weight numeric;gyro_weight numeric;armor_points int:=0;armor_weight numeric;equipment_weight numeric:=0;ammo_weight numeric:=0;sink_weight numeric;jump_weight numeric;total_weight numeric;layout jsonb;loc text;value_int int;
BEGIN
 IF jsonb_typeof(p_design)<>'object' OR length(btrim(coalesce(p_design->>'name',''))) NOT BETWEEN 1 AND 48 OR length(btrim(coalesce(p_design->>'variant',''))) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'Enter a chassis name and variant';END IF;
 IF btrim(p_design->>'name') !~ '^[A-Za-z0-9][A-Za-z0-9 ._''/-]*$' OR btrim(p_design->>'variant') !~ '^[A-Za-z0-9][A-Za-z0-9 ._''/-]*$' THEN RAISE EXCEPTION 'Names may use letters, numbers, spaces and simple punctuation only';END IF;
 IF coalesce(p_design->>'tech_base','IS_INTRO')<>'IS_INTRO' THEN RAISE EXCEPTION 'This release supports standard Inner Sphere construction only';END IF;
 tonnage:=(p_design->>'tonnage')::int;walking:=(p_design->>'walking_mp')::int;jumping:=(p_design->>'jump_mp')::int;sinks:=(p_design->>'heat_sinks')::int;
 IF tonnage NOT BETWEEN 20 AND 100 OR tonnage%5<>0 THEN RAISE EXCEPTION 'Tonnage must be 20–100 in five-ton steps';END IF;
 rating:=tonnage*walking;engine_weight:=btech_standard_engine_weight(rating);IF walking<1 OR engine_weight IS NULL THEN RAISE EXCEPTION 'The standard engine rating must be between 5 and 400';END IF;
 IF jumping<0 OR jumping>walking THEN RAISE EXCEPTION 'Jumping MP cannot exceed Walking MP';END IF;IF sinks<10 OR sinks>50 THEN RAISE EXCEPTION 'A BattleMech requires 10–50 heat sinks';END IF;
 armor:=coalesce(p_design->'armor','{}'::jsonb);weapons:=coalesce(p_design->'weapons','[]'::jsonb);ammo:=coalesce(p_design->'ammo','[]'::jsonb);
 IF jsonb_typeof(armor)<>'object' OR jsonb_typeof(weapons)<>'array' OR jsonb_typeof(ammo)<>'array' OR jsonb_array_length(weapons)>30 OR jsonb_array_length(ammo)>30 THEN RAISE EXCEPTION 'Invalid armor or equipment declaration';END IF;
 structure:=btech_custom_structure(tonnage);
 FOREACH loc IN ARRAY ARRAY['head','ct','ct_rear','lt','lt_rear','rt','rt_rear','la','ra','ll','rl'] LOOP value_int:=coalesce((armor->>loc)::int,0);IF value_int<0 THEN RAISE EXCEPTION 'Armor cannot be negative';END IF;armor_points:=armor_points+value_int;END LOOP;
 IF coalesce((armor->>'head')::int,0)>9 OR coalesce((armor->>'ct')::int,0)+coalesce((armor->>'ct_rear')::int,0)>2*(structure->>'ct')::int OR coalesce((armor->>'lt')::int,0)+coalesce((armor->>'lt_rear')::int,0)>2*(structure->>'lt')::int OR coalesce((armor->>'rt')::int,0)+coalesce((armor->>'rt_rear')::int,0)>2*(structure->>'rt')::int OR coalesce((armor->>'la')::int,0)>2*(structure->>'la')::int OR coalesce((armor->>'ra')::int,0)>2*(structure->>'ra')::int OR coalesce((armor->>'ll')::int,0)>2*(structure->>'ll')::int OR coalesce((armor->>'rl')::int,0)>2*(structure->>'rl')::int THEN RAISE EXCEPTION 'Armor exceeds a location maximum';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(weapons) value LOOP
  IF item->>'location' NOT IN ('head','ct','lt','rt','la','ra','ll','rl') THEN RAISE EXCEPTION 'A weapon has an invalid location';END IF;profile:=btech_custom_equipment(item->>'key');IF profile IS NULL THEN RAISE EXCEPTION 'Unsupported custom-design weapon: %',item->>'key';END IF;equipment_weight:=equipment_weight+(profile->>'weight')::numeric;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(ammo) value LOOP
  IF item->>'location' NOT IN ('ct','lt','rt','la','ra','ll','rl') OR coalesce((item->>'bins')::int,0) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Each ammunition entry needs 1–4 bins in a legal location';END IF;ammo_profile:=btech_custom_ammo(item->>'type');IF ammo_profile IS NULL THEN RAISE EXCEPTION 'Unsupported ammunition type: %',item->>'type';END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(weapons) weapon WHERE btech_custom_equipment(weapon->>'key')->>'ammoType'=item->>'type') THEN RAISE EXCEPTION 'Ammunition was added without a matching launcher';END IF;ammo_weight:=ammo_weight+(item->>'bins')::int;
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(weapons) weapon WHERE btech_custom_equipment(weapon->>'key') ? 'ammoType' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ammo) bin WHERE bin->>'type'=btech_custom_equipment(weapon->>'key')->>'ammoType')) THEN RAISE EXCEPTION 'Every ammunition weapon needs at least one compatible bin';END IF;
 layout:=btech_build_custom_layout(p_design);
 structure_weight:=tonnage/10.0;gyro_weight:=ceil(rating/100.0);armor_weight:=ceil(armor_points/8.0)*0.5;sink_weight:=greatest(0,sinks-10);jump_weight:=jumping*CASE WHEN tonnage<=55 THEN .5 WHEN tonnage<=85 THEN 1 ELSE 2 END;
 total_weight:=structure_weight+engine_weight+gyro_weight+3+armor_weight+equipment_weight+ammo_weight+sink_weight+jump_weight;
 IF total_weight>tonnage THEN RAISE EXCEPTION 'Design is overweight by % tons',total_weight-tonnage;END IF;
 RETURN jsonb_build_object('valid',true,'engine_rating',rating,'structure',structure,'critical_layout',layout,'armor_points',armor_points,'weights',jsonb_build_object('structure',structure_weight,'engine',engine_weight,'gyro',gyro_weight,'cockpit',3,'armor',armor_weight,'weapons',equipment_weight,'ammo',ammo_weight,'heat_sinks',sink_weight,'jump_jets',jump_weight,'total',total_weight,'remaining',tonnage-total_weight));
END $$;
REVOKE ALL ON FUNCTION public.btech_validate_custom_design(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.save_btech_custom_design(p_catalogue_version text,p_design jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE design_id uuid:=gen_random_uuid();unit_id text;calculation jsonb;definition jsonb;layout jsonb;armor jsonb;structure jsonb;item jsonb;profile jsonb;ammo_profile jsonb;location text;slot_label text;slot_index int;mount_index int:=0;bin_index int:=0;counter int;bins int;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM btech_catalogue_releases WHERE version=p_catalogue_version) THEN RAISE EXCEPTION 'Sign in and choose an installed catalogue release';END IF;
 IF (SELECT count(*) FROM btech_custom_designs WHERE owner_id=auth.uid() AND NOT archived)>=50 THEN RAISE EXCEPTION 'A player may keep up to 50 active custom designs';END IF;
 calculation:=btech_validate_custom_design(p_design);layout:=calculation->'critical_layout';structure:=calculation->'structure';armor:=p_design->'armor';unit_id:='custom-'||replace(design_id::text,'-','');
 definition:=jsonb_build_object('id',unit_id,'chassis',btrim(p_design->>'name'),'variant',btrim(p_design->>'variant'),'mass',(p_design->>'tonnage')::int,'config','Biped','tech_base','Inner Sphere','era',3025,'movement',jsonb_build_object('walk',(p_design->>'walking_mp')::int,'run',ceil((p_design->>'walking_mp')::numeric*1.5)::int,'jump',(p_design->>'jump_mp')::int),'heat_sinks',(p_design->>'heat_sinks')::int,'heat_sink_type','Single','heat_sink_capacity',(p_design->>'heat_sinks')::int,'armor',armor,'structure',structure,'supported_by_vtt',true,'custom_design',true,'custom_owner_id',auth.uid()::text);
 INSERT INTO btech_custom_designs(id,owner_id,catalogue_version,unit_id,name,design,calculation) VALUES(design_id,auth.uid(),p_catalogue_version,unit_id,btrim(p_design->>'name')||' '||btrim(p_design->>'variant'),p_design,calculation);
 INSERT INTO btech_catalogue_units(catalogue_version,unit_id,source_uuid,definition) VALUES(p_catalogue_version,unit_id,design_id::text,definition);
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'weapons') value LOOP profile:=btech_custom_equipment(item->>'key');location:=item->>'location';INSERT INTO btech_catalogue_mounts(catalogue_version,unit_id,mount_id,weapon_key,raw_name,location,definition) VALUES(p_catalogue_version,unit_id,(item->>'key')||':'||location||':'||mount_index,item->>'key',profile->>'name',location,(profile-ARRAY['name','weight','slots','label']));mount_index:=mount_index+1;END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_design->'ammo') value LOOP ammo_profile:=btech_custom_ammo(item->>'type');location:=item->>'location';bins:=(item->>'bins')::int;FOR counter IN 1..bins LOOP INSERT INTO btech_catalogue_ammo_bins(catalogue_version,unit_id,bin_id,ammo_type,raw_name,location,shots) VALUES(p_catalogue_version,unit_id,location||':'||bin_index,item->>'type',ammo_profile->>'name',location,(ammo_profile->>'shots')::int);bin_index:=bin_index+1;END LOOP;END LOOP;
 FOREACH location IN ARRAY ARRAY['head','ct','lt','rt','la','ra','ll','rl'] LOOP FOR slot_label,slot_index IN SELECT value#>>'{}',(ordinality-1)::int FROM jsonb_array_elements(layout->location) WITH ORDINALITY slot(value,ordinality) WHERE value<>'null'::jsonb LOOP INSERT INTO btech_catalogue_critical_slots(catalogue_version,unit_id,location,slot_index,label) VALUES(p_catalogue_version,unit_id,location,slot_index,slot_label);END LOOP;END LOOP;
 RETURN jsonb_build_object('id',design_id,'unit_id',unit_id,'catalogue_version',p_catalogue_version,'name',btrim(p_design->>'name')||' '||btrim(p_design->>'variant'),'calculation',calculation);
END $$;
REVOKE ALL ON FUNCTION public.save_btech_custom_design(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_btech_custom_design(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_btech_custom_design(p_design_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE version_id text;custom_unit_id text;
BEGIN
 UPDATE btech_custom_designs SET archived=true WHERE id=p_design_id AND owner_id=auth.uid() RETURNING catalogue_version,unit_id INTO version_id,custom_unit_id;IF NOT FOUND THEN RAISE EXCEPTION 'Custom design not found';END IF;
 -- Availability metadata may change; the published combat statistics remain immutable.
 UPDATE btech_catalogue_units SET definition=jsonb_set(definition,'{custom_archived}','true'::jsonb,true) WHERE catalogue_version=version_id AND unit_id=custom_unit_id;
END $$;
REVOKE ALL ON FUNCTION public.archive_btech_custom_design(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_btech_custom_design(uuid) TO authenticated;

-- A player may field their own custom entries, never another account's design.
CREATE OR REPLACE FUNCTION public.update_lobby_roster(p_game_id uuid,p_roster jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seat_no int;version_id text;
BEGIN
 IF jsonb_typeof(p_roster)<>'array' OR jsonb_array_length(p_roster)>6 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_roster) entry WHERE jsonb_typeof(entry.value)<>'string') THEN RAISE EXCEPTION 'Roster must be an array of at most six unit IDs';END IF;
 SELECT player.seat_number,game.catalogue_version INTO seat_no,version_id FROM btech_players player JOIN btech_games game ON game.id=player.game_id WHERE player.game_id=p_game_id AND player.user_id=auth.uid() AND player.role='player';IF seat_no IS NULL THEN RAISE EXCEPTION 'Only a seated player may update a roster';END IF;
 IF version_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_roster) chosen(unit_value) WHERE NOT EXISTS (SELECT 1 FROM btech_catalogue_units unit WHERE unit.catalogue_version=version_id AND unit.unit_id=chosen.unit_value AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false) AND (NOT coalesce((unit.definition->>'custom_design')::boolean,false) OR (unit.definition->>'custom_owner_id'=auth.uid()::text AND NOT coalesce((unit.definition->>'custom_archived')::boolean,false))))) THEN RAISE EXCEPTION 'Roster contains an unsupported, archived, or another player''s custom BattleMech';END IF;
 UPDATE btech_games SET state=jsonb_set(CASE jsonb_typeof(state) WHEN 'string' THEN coalesce((state#>>'{}')::jsonb,'{}'::jsonb) WHEN 'object' THEN state ELSE '{}'::jsonb END,ARRAY['rosters',seat_no::text],p_roster,true) WHERE id=p_game_id AND status='lobby';IF NOT FOUND THEN RAISE EXCEPTION 'Roster updates are available only while the game is in the lobby';END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_lobby_roster(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lobby_roster(uuid,jsonb) TO authenticated;

-- Apply the same ownership rule to match-only Skirmish Hangars without
-- replacing the later pilot/deployment implementation.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.update_skirmish_hangar(uuid,jsonb,jsonb)');IF fn IS NULL THEN RAISE EXCEPTION 'Skirmish Hangar function is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('custom_design_hangar_owner_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'AND coalesce((unit.definition->>''supported_by_vtt'')::boolean,false)))','AND coalesce((unit.definition->>''supported_by_vtt'')::boolean,false) AND (NOT coalesce((unit.definition->>''custom_design'')::boolean,false) OR (unit.definition->>''custom_owner_id''=auth.uid()::text AND NOT coalesce((unit.definition->>''custom_archived'')::boolean,false))))) /* custom_design_hangar_owner_v1 */');
 IF patched=source OR position('custom_design_hangar_owner_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely add custom-design ownership to Skirmish Hangars';END IF;EXECUTE patched;
END $$;
