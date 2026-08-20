-- Pin new matches to an immutable catalogue release and resolve supported
-- direct-fire attacks from that release. Unpinned legacy matches continue to
-- use SQL 15/16 compatibility tables.

CREATE OR REPLACE FUNCTION public.prevent_catalogue_repin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.catalogue_version IS NOT NULL AND NEW.catalogue_version IS DISTINCT FROM OLD.catalogue_version THEN
  RAISE EXCEPTION 'A match catalogue version is immutable once pinned';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS btech_games_catalogue_version_immutable ON public.btech_games;
CREATE TRIGGER btech_games_catalogue_version_immutable BEFORE UPDATE OF catalogue_version ON public.btech_games
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalogue_repin();

CREATE OR REPLACE FUNCTION public.update_lobby_roster(p_game_id uuid,p_roster jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE seat_no int;version_id text;
BEGIN
 IF jsonb_typeof(p_roster)<>'array' OR jsonb_array_length(p_roster)>6 OR EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_roster) entry WHERE jsonb_typeof(entry.value)<>'string'
 ) THEN RAISE EXCEPTION 'Roster must be an array of at most six unit IDs';END IF;
 SELECT player.seat_number,game.catalogue_version INTO seat_no,version_id
 FROM btech_players player JOIN btech_games game ON game.id=player.game_id
 WHERE player.game_id=p_game_id AND player.user_id=auth.uid() AND player.role='player';
 IF seat_no IS NULL THEN RAISE EXCEPTION 'Only a seated player may update a roster';END IF;
 IF version_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(p_roster) chosen(unit_value)
  WHERE NOT EXISTS (SELECT 1 FROM btech_catalogue_units unit
   WHERE unit.catalogue_version=version_id AND unit.unit_id=chosen.unit_value
     AND coalesce((unit.definition->>'supported_by_vtt')::boolean,false))
 ) THEN RAISE EXCEPTION 'Roster contains a unit unsupported by this match catalogue';END IF;
 UPDATE btech_games SET state=jsonb_set(
  CASE jsonb_typeof(state) WHEN 'string' THEN coalesce((state#>>'{}')::jsonb,'{}'::jsonb)
   WHEN 'object' THEN state ELSE '{}'::jsonb END,
  ARRAY['rosters',seat_no::text],p_roster,true)
 WHERE id=p_game_id AND status='lobby';
 IF NOT FOUND THEN RAISE EXCEPTION 'Roster updates are available only while the game is in the lobby';END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_lobby_roster(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lobby_roster(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.btech_critical_label_count(p_mech jsonb,p_label text)
RETURNS int LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE result int;version_id text:=p_mech->>'catalogueVersion';
BEGIN
 IF version_id IS NOT NULL THEN
  SELECT count(*)::int INTO result FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=version_id AND slot.unit_id=p_mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=p_label
   AND btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index);
 ELSE
  SELECT count(*)::int INTO result FROM btech_authoritative_critical_slots slot
  WHERE slot.unit_id=p_mech->>'unitId'
   AND regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=p_label
   AND btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index);
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.btech_resolve_critical_slots(p_mech jsonb,p_location text,p_total int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;loc text:=p_location;hits int;remaining int;chosen int;slot_label text;
 events jsonb:='[]'::jsonb;transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct"}'::jsonb;
 ammo_type text;ammo_damage int;bin jsonb;pos bigint;shots int;version_id text:=p_mech->>'catalogueVersion';
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
    AND slot.label NOT IN ('Endo Steel','Ferro-Fibrous','CASE')
    AND NOT btech_critical_slot_is_damaged(m,loc,slot.slot_index) ORDER BY random() LIMIT 1;
  ELSE
   SELECT slot_index,label INTO chosen,slot_label FROM btech_authoritative_critical_slots slot
   WHERE slot.unit_id=m->>'unitId' AND slot.location=loc
    AND (loc NOT IN ('head','ll','rl') OR slot.slot_index<6)
    AND slot.label NOT IN ('Endo Steel','Ferro-Fibrous','CASE')
    AND NOT btech_critical_slot_is_damaged(m,loc,slot.slot_index) ORDER BY random() LIMIT 1;
  END IF;
  IF NOT FOUND THEN loc:=transfer->>loc;CONTINUE;END IF;
  m:=btech_mark_critical_slot(m,loc,chosen);
  events:=events||jsonb_build_array(jsonb_build_object('location',loc,'slot_index',chosen,'label',slot_label));
  IF regexp_replace(slot_label,'[[:space:]]*\([A-Z]\)$','')='Cockpit' THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  IF regexp_replace(slot_label,'[[:space:]]*\([A-Z]\)$','')='Fusion Engine' AND btech_critical_label_count(m,'Fusion Engine')>=3 THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);END IF;
  ammo_type:=CASE WHEN slot_label ILIKE '%Ammo AC/20%' THEN 'ac20' WHEN slot_label ILIKE '%Ammo AC/10%' THEN 'ac10'
   WHEN slot_label ILIKE '%Ammo AC/5%' THEN 'ac5' WHEN slot_label ILIKE '%Ammo LRM-20%' THEN 'lrm20'
   WHEN slot_label ILIKE '%Ammo LRM-10%' THEN 'lrm10' WHEN slot_label ILIKE '%Ammo SRM-6%' THEN 'srm6'
   WHEN slot_label ILIKE '%Ammo MG%' THEN 'machine_gun' END;
  ammo_damage:=CASE ammo_type WHEN 'ac20' THEN 20 WHEN 'ac10' THEN 10 WHEN 'ac5' THEN 5 WHEN 'lrm20' THEN 20 WHEN 'lrm10' THEN 10 WHEN 'srm6' THEN 12 WHEN 'machine_gun' THEN 2 END;
  IF ammo_type IS NOT NULL THEN
   FOR bin,pos IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
    IF bin->>'type'=ammo_type AND coalesce((bin->>'shots')::int,0)>0 AND NOT coalesce((bin->>'destroyed')::boolean,false) THEN
     shots:=(bin->>'shots')::int;m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'shots'],'0'::jsonb,true);
     m:=jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'destroyed'],'true'::jsonb,true);
     m:=btech_apply_internal_damage(m,loc,shots*ammo_damage);
     events:=events||jsonb_build_array(jsonb_build_object('location',loc,'ammo_explosion',ammo_type,'damage',shots*ammo_damage));EXIT;
    END IF;
   END LOOP;
  END IF;
  remaining:=remaining-1;
 END LOOP;
 m:=jsonb_set(m,'{criticalHits}',to_jsonb(coalesce((m->>'criticalHits')::int,0)+hits-remaining),true);
 RETURN jsonb_build_object('mech',m,'hits',hits-remaining,'events',events);
END $$;

CREATE OR REPLACE FUNCTION public.resolve_standard_weapon_attack(p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE;player btech_players%ROWTYPE;st jsonb;attacker jsonb;target jsonb;v_mount_id text;
 mount_location text;mount_weapon_key text;mount_definition jsonb;mount_name text;weapon_name text;weapon_damage int;weapon_heat int;
 short_range int;medium_range int;long_range int;minimum_range int;ammo_type text;dist int;range_mod int;move_mod int;target_mod int;woods int;tn int;
 da int;db int;lr int;loc text;angle text:='front';damage_result jsonb;results jsonb:='[]'::jsonb;heat_added int:=0;event_id uuid;seq int;arr jsonb;
 firing_facing int;firing_direction int;facing_diff int;target_direction int;target_diff int;map_id text;critical_label text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your weapon-attack turn';END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;
 IF attacker IS NULL OR target IS NULL OR (attacker->>'owner')::int<>player.seat_number OR (target->>'owner')::int=player.seat_number OR coalesce((attacker->>'hasFired')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or target';END IF;
 IF g.catalogue_version IS NOT NULL AND (attacker->>'catalogueVersion' IS DISTINCT FROM g.catalogue_version OR target->>'catalogueVersion' IS DISTINCT FROM g.catalogue_version) THEN RAISE EXCEPTION 'Unit catalogue does not match the pinned match catalogue';END IF;
 IF btech_critical_label_count(attacker,'Sensors')>=2 THEN RAISE EXCEPTION 'Destroyed sensors prevent weapon attacks';END IF;
 IF coalesce(array_length(p_weapon_mounts,1),0)=0 THEN RAISE EXCEPTION 'Choose at least one weapon mount';END IF;
 IF EXISTS (SELECT 1 FROM unnest(p_weapon_mounts) selected(mount_id) GROUP BY selected.mount_id HAVING count(*)>1) THEN RAISE EXCEPTION 'A weapon mount may be declared only once';END IF;
 dist:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);map_id:=coalesce(st->>'map_id','training-grounds');
 move_mod:=CASE attacker->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END+CASE WHEN target->>'movementMode'='jump' THEN 1 ELSE 0 END;
 woods:=btech_intervening_woods(map_id,(attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int)+CASE btech_terrain(map_id,lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 IF woods>=3 THEN RAISE EXCEPTION 'Line of sight is blocked by intervening woods';END IF;
 SELECT coalesce(max(sequence),0)+1 INTO seq FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='weapon_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration)
 VALUES(p_game_id,g.current_round,'weapon_attack',seq,player.id,p_attacker_instance_id,p_target_instance_id,jsonb_build_object('weapon_mounts',p_weapon_mounts,'catalogue_version',g.catalogue_version)) RETURNING id INTO event_id;
 FOREACH v_mount_id IN ARRAY coalesce(p_weapon_mounts,ARRAY[]::text[]) LOOP
  IF g.catalogue_version IS NOT NULL THEN
   SELECT mount.location,mount.weapon_key,mount.definition,mount.raw_name INTO mount_location,mount_weapon_key,mount_definition,mount_name
   FROM btech_catalogue_mounts mount WHERE mount.catalogue_version=g.catalogue_version AND mount.unit_id=attacker->>'unitId' AND mount.mount_id=v_mount_id;
   IF NOT FOUND OR mount_weapon_key IS NULL OR mount_definition ? 'clusterSize' THEN RAISE EXCEPTION 'Unsupported or invalid direct-fire mount: %',v_mount_id;END IF;
   weapon_name:=mount_name;weapon_damage:=(mount_definition->>'damage')::int;weapon_heat:=(mount_definition->>'heat')::int;
   short_range:=(mount_definition->'range'->>0)::int;medium_range:=(mount_definition->'range'->>1)::int;long_range:=(mount_definition->'range'->>2)::int;
   minimum_range:=coalesce((mount_definition->>'minimumRange')::int,0);ammo_type:=mount_definition->>'ammoType';
   critical_label:=CASE mount_weapon_key WHEN 'ac20' THEN 'Autocannon/20' WHEN 'ac10' THEN 'Autocannon/10' WHEN 'ac5' THEN 'Autocannon/5' ELSE weapon_name END;
   IF EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=g.catalogue_version AND slot.unit_id=attacker->>'unitId' AND slot.location=mount_location
    AND (regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=critical_label OR (mount_location IN ('la','ra') AND slot.label='Shoulder'))
    AND btech_critical_slot_is_damaged(attacker,mount_location,slot.slot_index)) THEN RAISE EXCEPTION '% was destroyed by a critical hit',weapon_name;END IF;
  ELSE
   SELECT mount.location,mount.weapon_key,jsonb_build_object('damage',weapon.damage,'heat',weapon.heat,'range',jsonb_build_array(weapon.short_range,weapon.medium_range,weapon.long_range),'minimumRange',weapon.minimum_range,'ammoType',weapon.ammo_type),weapon.name
   INTO mount_location,mount_weapon_key,mount_definition,mount_name FROM btech_authoritative_mounts mount JOIN btech_authoritative_weapons weapon USING(weapon_key)
   WHERE mount.unit_id=attacker->>'unitId' AND mount.mount_id=v_mount_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unsupported or invalid direct-fire mount: %',v_mount_id;END IF;
   weapon_name:=mount_name;weapon_damage:=(mount_definition->>'damage')::int;weapon_heat:=(mount_definition->>'heat')::int;
   short_range:=(mount_definition->'range'->>0)::int;medium_range:=(mount_definition->'range'->>1)::int;long_range:=(mount_definition->'range'->>2)::int;
   minimum_range:=coalesce((mount_definition->>'minimumRange')::int,0);ammo_type:=mount_definition->>'ammoType';
   loc:=CASE mount_location WHEN 'Left Arm' THEN 'la' WHEN 'Right Arm' THEN 'ra' WHEN 'Left Torso' THEN 'lt' WHEN 'Right Torso' THEN 'rt' WHEN 'Center Torso' THEN 'ct' WHEN 'Head' THEN 'head' END;
   critical_label:=CASE mount_weapon_key WHEN 'ac20' THEN 'Autocannon/20' WHEN 'ac10' THEN 'Autocannon/10' WHEN 'ac5' THEN 'Autocannon/5' ELSE weapon_name END;
   IF EXISTS (SELECT 1 FROM btech_authoritative_critical_slots slot WHERE slot.unit_id=attacker->>'unitId' AND slot.location=loc
    AND (regexp_replace(slot.label,'[[:space:]]*\([A-Z]\)$','')=critical_label OR (loc IN ('la','ra') AND slot.label='Shoulder'))
    AND btech_critical_slot_is_damaged(attacker,loc,slot.slot_index)) THEN RAISE EXCEPTION '% was destroyed by a critical hit',weapon_name;END IF;
  END IF;
  firing_facing:=CASE WHEN mount_location IN ('lt','rt','ct','head') OR mount_location ILIKE '%torso%' OR mount_location ILIKE '%head%' THEN coalesce((attacker->>'torsoFacing')::int,(attacker->>'facing')::int) ELSE (attacker->>'facing')::int END;
  firing_direction:=btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);facing_diff:=(firing_direction-firing_facing+6)%6;
  IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION '% target is outside its firing arc',weapon_name;END IF;
  target_direction:=btech_direction_to((target->>'col')::int,(target->>'row')::int,(attacker->>'col')::int,(attacker->>'row')::int);target_diff:=(target_direction-(target->>'facing')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN 'front' WHEN target_diff=1 THEN 'side-right' WHEN target_diff=5 THEN 'side-left' ELSE 'rear' END;
  IF dist>long_range THEN RAISE EXCEPTION '% is beyond long range',weapon_name;END IF;
  range_mod:=CASE WHEN dist<=short_range THEN 0 WHEN dist<=medium_range THEN 2 ELSE 4 END;
  IF minimum_range>0 AND dist<=minimum_range THEN range_mod:=range_mod+(minimum_range-dist+1);END IF;
  tn:=coalesce((attacker->'pilot'->>'gunnery')::int,4)+move_mod+target_mod+range_mod+woods;attacker:=btech_consume_ammo(attacker,ammo_type);da:=floor(random()*6+1);db:=floor(random()*6+1);
  IF da+db>=tn AND tn<=12 THEN
   lr:=floor(random()*6+1)+floor(random()*6+1);loc:=CASE angle
    WHEN 'side-right' THEN CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'rt' WHEN 8 THEN 'ct' WHEN 9 THEN 'lt' WHEN 10 THEN 'll' WHEN 11 THEN 'la' ELSE 'head' END
    WHEN 'side-left' THEN CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'la' WHEN 4 THEN 'la' WHEN 5 THEN 'rl' WHEN 6 THEN 'lt' WHEN 7 THEN 'lt' WHEN 8 THEN 'ct' WHEN 9 THEN 'rt' WHEN 10 THEN 'll' WHEN 11 THEN 'ra' ELSE 'head' END
    WHEN 'rear' THEN CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END
    ELSE CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' WHEN 12 THEN 'head' ELSE 'la' END END;
   damage_result:=btech_apply_direct_damage(target,weapon_damage,loc,angle='rear');target:=damage_result->'mech';
   results:=results||jsonb_build_array(jsonb_build_object('mount_id',v_mount_id,'weapon',weapon_name,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'location',loc,'damage',weapon_damage,'critical_checks',damage_result->'critical_checks'));
  ELSE results:=results||jsonb_build_array(jsonb_build_object('mount_id',v_mount_id,'weapon',weapon_name,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',false));END IF;
  heat_added:=heat_added+weapon_heat;
 END LOOP;
 attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);attacker:=jsonb_set(attacker,'{weaponHeat}',to_jsonb(coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 attacker:=jsonb_set(attacker,'{heat}',to_jsonb(coalesce((attacker->>'roundStartingHeat')::int,0)+coalesce((attacker->>'movementHeat')::int,0)+coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker WHEN value->>'instanceId'=p_target_instance_id THEN target ELSE value END) INTO arr FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',arr,true);UPDATE btech_games SET state=st WHERE id=p_game_id;
 UPDATE btech_combat_events SET status='resolved',resolution=jsonb_build_object('results',results,'state_version','versioned-catalogue-direct-fire-01','catalogue_version',g.catalogue_version),resolved_at=now() WHERE id=event_id;
 RETURN jsonb_build_object('event_id',event_id,'results',results,'catalogue_version',g.catalogue_version);
EXCEPTION WHEN OTHERS THEN
 IF event_id IS NOT NULL THEN UPDATE btech_combat_events SET status='rejected',resolution=jsonb_build_object('error',SQLERRM),resolved_at=now() WHERE id=event_id;END IF;RAISE;
END $$;
REVOKE ALL ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) TO authenticated;
