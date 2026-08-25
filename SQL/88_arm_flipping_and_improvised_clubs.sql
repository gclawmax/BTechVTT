-- Total Warfare BattleMech arm flipping and improvised clubs.
-- Run after SQL/87_weathered_advanced_terrain.sql.

CREATE OR REPLACE FUNCTION public.btech_can_flip_battlemech_arms(p_catalogue_version text,p_mech jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT coalesce((p_mech->>'prone')::boolean,false)
  AND coalesce((p_mech->>'torsoFacing')::int,(p_mech->>'facing')::int)=(p_mech->>'facing')::int
  AND NOT EXISTS (
   SELECT 1 FROM btech_catalogue_critical_slots slot
   WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
    AND slot.location IN ('la','ra') AND slot.label IN ('Lower Arm Actuator','Hand Actuator')
  )
$$;
REVOKE ALL ON FUNCTION public.btech_can_flip_battlemech_arms(text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_mech_weapon_arc_allows(p_mount_location text,p_facing int,p_target_direction int,p_arms_flipped boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN lower(coalesce(p_mount_location,'')) IN ('la','ra') AND p_arms_flipped THEN ((p_target_direction-p_facing+6)%6) IN (2,3,4)
  WHEN lower(coalesce(p_mount_location,''))='la' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,2,5)
  WHEN lower(coalesce(p_mount_location,''))='ra' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,4,5)
  ELSE ((p_target_direction-p_facing+6)%6) IN (0,1,5)
 END
$$;
REVOKE ALL ON FUNCTION public.btech_mech_weapon_arc_allows(text,int,int,boolean) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('authoritative_arm_flip_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  '''__spotter_fired'',''__spotting_while_firing'',''__secondary_modifier'')',
  '''__spotter_fired'',''__spotting_while_firing'',''__secondary_modifier'',''__arms_flipped'')');
 patched:=replace(patched,
  'firing_facing:=CASE WHEN mount_location IN (''lt'',''rt'',''ct'',''head'') THEN coalesce((attacker->>''torsoFacing'')::int,(attacker->>''facing'')::int) ELSE (attacker->>''facing'')::int END;',
  'IF coalesce((p_ammo_bins->>''__arms_flipped'')::boolean,false) AND NOT btech_can_flip_battlemech_arms(p_catalogue_version,attacker_start) THEN RAISE EXCEPTION ''This BattleMech cannot flip its arms while prone, torso-twisted, or fitted with lower-arm/hand actuators'';END IF; /* authoritative_arm_flip_v1 */ firing_facing:=CASE WHEN mount_location IN (''lt'',''rt'',''ct'',''head'',''la'',''ra'') THEN coalesce((attacker->>''torsoFacing'')::int,(attacker->>''facing'')::int) ELSE (attacker->>''facing'')::int END;');
 patched:=replace(patched,
  'btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction)',
  'btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction,coalesce((p_ammo_bins->>''__arms_flipped'')::boolean,false))');
 IF patched=source OR position('authoritative_arm_flip_v1' IN patched)=0 OR position('__arms_flipped' IN patched)=0 OR position('btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction,coalesce' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install BattleMech arm flipping';
 END IF;
 EXECUTE patched;
END $$;

-- Finding a club is declared during Weapon Attacks. Woods always provide a
-- tree club; the VTT's generic rubble represents medium rubble and finds a
-- girder on 7+. Either outcome consumes that BattleMech's weapon declaration.
CREATE OR REPLACE FUNCTION public.find_improvised_club(p_game_id uuid,p_instance_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;mech jsonb;units jsonb;terrain_name text;club_type text;die_a int;die_b int;found boolean:=false;submission jsonb;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your Weapon Attack activation';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO mech FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_instance_id;
 IF mech IS NULL OR (mech->>'owner')::int<>player.seat_number OR coalesce((mech->>'hasFired')::boolean,false) OR coalesce((mech->>'destroyed')::boolean,false) OR coalesce((mech->>'prone')::boolean,false) THEN RAISE EXCEPTION 'Choose an eligible standing BattleMech';END IF;
 IF mech ? 'improvisedClub' THEN RAISE EXCEPTION 'This BattleMech is already holding an improvised club';END IF;
 IF EXISTS (SELECT 1 FROM unnest(ARRAY['la','ra']) arm WHERE coalesce((mech->'structure'->>arm)::int,0)<=0
  OR NOT btech_physical_component_exists(g.catalogue_version,mech,arm,'Hand Actuator')
  OR btech_physical_component_damaged(g.catalogue_version,mech,arm,'Hand Actuator')
  OR btech_physical_component_damaged(g.catalogue_version,mech,arm,'Shoulder')) THEN RAISE EXCEPTION 'Two working arms, shoulders and hands are required to find a club';END IF;
 terrain_name:=coalesce(st->'terrain_overrides'->>(lpad(mech->>'col',2,'0')||lpad(mech->>'row',2,'0')),btech_terrain(coalesce(st->>'map_id','training-grounds'),lpad(mech->>'col',2,'0')||lpad(mech->>'row',2,'0')));
 IF terrain_name IN ('light_woods','heavy_woods') THEN club_type:='tree';found:=true;
 ELSIF terrain_name='rubble' THEN club_type:='girder';die_a:=floor(random()*6+1);die_b:=floor(random()*6+1);found:=die_a+die_b>=7;
 ELSE RAISE EXCEPTION 'An improvised club requires woods or rubble in the BattleMech''s hex';END IF;
 IF found THEN mech:=jsonb_set(mech,'{improvisedClub}',jsonb_build_object('type',club_type,'found_round',g.current_round),true);SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_instance_id THEN mech ELSE value END) INTO units FROM jsonb_array_elements(st->'mech_instances') value;st:=jsonb_set(st,'{mech_instances}',units,true);UPDATE btech_games SET state=st WHERE id=p_game_id;END IF;
 SELECT submit_multi_target_weapon_declaration(p_game_id,p_instance_id,'[]'::jsonb) INTO submission;
 RETURN jsonb_build_object('found',found,'club_type',club_type,'die_a',die_a,'die_b',die_b,'submission',submission);
END $$;
REVOKE ALL ON FUNCTION public.find_improvised_club(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_improvised_club(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_physical_weapon_profile(p_key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_key
  WHEN 'backhoe' THEN '{"label":"Backhoe","to_hit":1,"damage":6,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'chainsaw' THEN '{"label":"Chainsaw","to_hit":0,"damage":5,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'club' THEN '{"label":"Improvised Club","to_hit":-1,"damage_divisor":5,"floor_damage":true,"arc":"forward","damage_actuators":true,"both_arms":true}'::jsonb
  WHEN 'combine' THEN '{"label":"Combine","to_hit":-2,"damage":3,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'dual_saw' THEN '{"label":"Dual Saw","to_hit":0,"damage":7,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'hatchet' THEN '{"label":"Hatchet","to_hit":-1,"damage_divisor":5,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'heavy_duty_pile_driver' THEN '{"label":"Heavy-Duty Pile Driver","to_hit":2,"damage":9,"arc":"forward","damage_actuators":false}'::jsonb
  WHEN 'mining_drill' THEN '{"label":"Mining Drill","to_hit":-1,"damage":4,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'retractable_blade' THEN '{"label":"Retractable Blade","to_hit":-2,"damage_divisor":10,"arc":"arm","damage_actuators":true,"ignore_hand":true}'::jsonb
  WHEN 'rock_cutter' THEN '{"label":"Rock Cutter","to_hit":1,"damage":5,"arc":"arm","damage_actuators":false}'::jsonb
  WHEN 'spot_welder' THEN '{"label":"Spot Welder","to_hit":0,"damage":5,"arc":"arm","damage_actuators":false,"location_table":"punch","heat":2}'::jsonb
  WHEN 'sword' THEN '{"label":"Sword","to_hit":-2,"damage_divisor":10,"damage_bonus":1,"arc":"arm","damage_actuators":true}'::jsonb
  WHEN 'wrecking_ball' THEN '{"label":"Wrecking Ball","to_hit":1,"damage":8,"arc":"forward","damage_actuators":false,"fumble":true}'::jsonb
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.btech_physical_weapon_profile(text) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('authoritative_improvised_club_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF physical_profile IS NOT NULL AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN (''la'',''ra'')) THEN RAISE EXCEPTION ''Choose the arm mounting the physical weapon'';END IF;',
  'IF physical_key=''club'' AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1]<>''ra'') THEN RAISE EXCEPTION ''An improvised club uses both arms'';ELSIF physical_profile IS NOT NULL AND (coalesce(array_length(p_limbs,1),0)<>1 OR p_limbs[1] NOT IN (''la'',''ra'')) THEN RAISE EXCEPTION ''Choose the arm mounting the physical weapon'';END IF; /* authoritative_improvised_club_v1 */');
 patched:=replace(patched,
  'IF physical_profile IS NOT NULL AND (NOT btech_physical_component_exists',
  'IF physical_profile IS NOT NULL AND physical_key<>''club'' AND (NOT btech_physical_component_exists');
 patched:=replace(patched,
  'IF p_attack_type=''kick'' AND (btech_physical_component_damaged',
  'IF physical_key=''club'' THEN IF NOT (attacker_start ? ''improvisedClub'') THEN RAISE EXCEPTION ''This BattleMech is not holding an improvised club'';END IF;IF EXISTS(SELECT 1 FROM unnest(ARRAY[''la'',''ra'']) arm WHERE coalesce((attacker_start->''structure''->>arm)::int,0)<=0 OR btech_physical_component_damaged(p_catalogue_version,attacker_start,arm,''Shoulder'') OR NOT btech_physical_component_exists(p_catalogue_version,attacker_start,arm,''Hand Actuator'') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,arm,''Hand Actuator'')) THEN RAISE EXCEPTION ''Two working arms, shoulders and hands are required to swing a club'';END IF;IF EXISTS(SELECT 1 FROM btech_combat_events event CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(event.declaration->''weapon_mounts'',''[]''::jsonb)) chosen(mount_id) JOIN btech_catalogue_mounts mount ON mount.catalogue_version=p_catalogue_version AND mount.unit_id=attacker_start->>''unitId'' AND mount.mount_id=chosen.mount_id WHERE event.game_id=p_game_id AND event.round=p_round AND event.phase=''weapon_attack'' AND event.attacker_instance_id=p_attacker_id AND mount.location IN (''la'',''ra'')) THEN RAISE EXCEPTION ''A weapon fired from an arm required by the club this round'';END IF;END IF;IF p_attack_type=''kick'' AND (btech_physical_component_damaged');
 patched:=replace(patched,
  E'IF p_attack_type=''punch'' OR physical_profile IS NOT NULL THEN\n   IF btech_physical_component_damaged',
  E'IF p_attack_type=''punch'' OR physical_profile IS NOT NULL THEN\n   IF physical_key=''club'' THEN IF btech_physical_component_damaged(p_catalogue_version,attacker_start,''la'',''Upper Arm Actuator'') THEN tn:=tn+2;reduction:=reduction+1;END IF;IF NOT btech_physical_component_exists(p_catalogue_version,attacker_start,''la'',''Lower Arm Actuator'') OR btech_physical_component_damaged(p_catalogue_version,attacker_start,''la'',''Lower Arm Actuator'') THEN tn:=tn+2;reduction:=reduction+1;END IF;END IF;\n   IF btech_physical_component_damaged');
 patched:=replace(patched,
  'ELSE ceil(unit_mass/(physical_profile->>''damage_divisor'')::numeric)::int END+coalesce((physical_profile->>''damage_bonus'')::int,0);',
  'ELSE CASE WHEN coalesce((physical_profile->>''floor_damage'')::boolean,false) THEN floor(unit_mass/(physical_profile->>''damage_divisor'')::numeric)::int ELSE ceil(unit_mass/(physical_profile->>''damage_divisor'')::numeric)::int END END+coalesce((physical_profile->>''damage_bonus'')::int,0);');
 IF patched=source OR position('authoritative_improvised_club_v1' IN patched)=0 OR position('physical_key<>''club''' IN patched)=0 OR position('floor_damage' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install improvised club attacks';END IF;
 EXECUTE patched;
END $$;
