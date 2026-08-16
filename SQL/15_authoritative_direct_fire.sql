-- Server-authoritative human-v-human direct fire.
-- Deliberately excludes cluster weapons (LRM/SRM); those remain a later slice.

CREATE TABLE IF NOT EXISTS public.btech_authoritative_weapons (
  weapon_key text PRIMARY KEY, name text NOT NULL, damage int NOT NULL, heat int NOT NULL,
  short_range int NOT NULL, medium_range int NOT NULL, long_range int NOT NULL,
  minimum_range int NOT NULL DEFAULT 0, ammo_type text
);
CREATE TABLE IF NOT EXISTS public.btech_authoritative_mounts (
  unit_id text NOT NULL, mount_id text NOT NULL, weapon_key text NOT NULL REFERENCES public.btech_authoritative_weapons,
  location text NOT NULL, shots int NOT NULL DEFAULT 1, PRIMARY KEY (unit_id, mount_id)
);
ALTER TABLE public.btech_authoritative_weapons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_authoritative_mounts ENABLE ROW LEVEL SECURITY;

INSERT INTO public.btech_authoritative_weapons VALUES
 ('med_laser','Medium Laser',5,3,3,6,9,0,NULL), ('small_laser','Small Laser',3,1,1,2,3,0,NULL),
 ('large_laser','Large Laser',8,8,5,10,15,0,NULL), ('ppc','PPC',10,10,3,6,12,3,NULL),
 ('machine_gun','Machine Gun',2,0,1,2,3,0,'machine_gun'), ('ac5','AC/5',5,1,6,12,18,0,'ac5'),
 ('ac10','AC/10',10,3,5,10,15,0,'ac10'), ('ac20','AC/20',20,7,3,6,9,0,'ac20')
ON CONFLICT (weapon_key) DO UPDATE SET name=EXCLUDED.name,damage=EXCLUDED.damage,heat=EXCLUDED.heat,
 short_range=EXCLUDED.short_range,medium_range=EXCLUDED.medium_range,long_range=EXCLUDED.long_range,
 minimum_range=EXCLUDED.minimum_range,ammo_type=EXCLUDED.ammo_type;

INSERT INTO public.btech_authoritative_mounts VALUES
 ('atlas-as7-d','med_laser:Left Arm:0','med_laser','Left Arm',1),
 ('atlas-as7-d','med_laser:Right Arm:1','med_laser','Right Arm',1),
 ('atlas-as7-d','ac20:Right Torso:4','ac20','Right Torso',1),
 ('atlas-as7-d','med_laser:Center Torso:5','med_laser','Center Torso',1),
 ('atlas-as7-d','med_laser:Center Torso:6','med_laser','Center Torso',1),
 ('hunchback-hbk-4g','med_laser:Left Arm:0','med_laser','Left Arm',1),
 ('hunchback-hbk-4g','med_laser:Right Arm:1','med_laser','Right Arm',1),
 ('hunchback-hbk-4g','ac20:Right Torso:2','ac20','Right Torso',1),
 ('hunchback-hbk-4g','small_laser:Head:3','small_laser','Head',1),
 ('locust-lct-1v','machine_gun:Left Arm:0','machine_gun','Left Arm',1),
 ('locust-lct-1v','machine_gun:Right Arm:1','machine_gun','Right Arm',1),
 ('locust-lct-1v','med_laser:Center Torso:2','med_laser','Center Torso',1),
 ('marauder-mad-3r','ppc:Left Arm:0','ppc','Left Arm',1),
 ('marauder-mad-3r','med_laser:Left Arm:1','med_laser','Left Arm',1),
 ('marauder-mad-3r','ppc:Right Arm:2','ppc','Right Arm',1),
 ('marauder-mad-3r','med_laser:Right Arm:3','med_laser','Right Arm',1),
 ('marauder-mad-3r','ac5:Right Torso:4','ac5','Right Torso',1),
 ('enforcer-enf-4r','large_laser:Left Arm:0','large_laser','Left Arm',1),
 ('enforcer-enf-4r','ac10:Right Arm:1','ac10','Right Arm',1),
 ('enforcer-enf-4r','small_laser:Left Torso:2','small_laser','Left Torso',1),
 ('centurion-cn9-a','ac10:Right Arm:0','ac10','Right Arm',1),
 ('centurion-cn9-a','med_laser:Center Torso:2','med_laser','Center Torso',2)
ON CONFLICT (unit_id,mount_id) DO UPDATE SET weapon_key=EXCLUDED.weapon_key,location=EXCLUDED.location,shots=EXCLUDED.shots;

CREATE OR REPLACE FUNCTION public.btech_hex_distance(ac int, ar int, bc int, br int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT greatest(abs((ac-(ar-(ar&1))/2)-(bc-(br-(br&1))/2)),abs(ar-br),abs((-ac+(ar-(ar&1))/2-ar)-(-bc+(br-(br&1))/2-br)))::int $$;

CREATE OR REPLACE FUNCTION public.btech_terrain(p_map text,p_code text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_map
 WHEN 'training-grounds' THEN CASE WHEN p_code IN ('0602','0702','0308','0408') THEN 'light_woods' WHEN p_code IN ('1203','1109') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'woodland-approach' THEN CASE WHEN p_code IN ('0603','0703','0504','0804','0904','0605','0805','0905') THEN 'light_woods' WHEN p_code IN ('0803','0604','0704','0705') THEN 'heavy_woods' ELSE 'clear' END
 WHEN 'open-engagement' THEN CASE WHEN p_code IN ('0404','0504','0405','1108') THEN 'light_woods' WHEN p_code IN ('1107','1207') THEN 'heavy_woods' ELSE 'clear' END
 ELSE 'clear' END $$;

CREATE OR REPLACE FUNCTION public.btech_direction_to(ac int,ar int,bc int,br int) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE aq int:=ac-(ar-(ar&1))/2; arx int:=ar; nq int; nr int; nc int; d int; best int:=0; best_dist int:=2147483647; candidate int;
 dq int[]:=ARRAY[1,1,0,-1,-1,0]; dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 FOR d IN 1..6 LOOP nq:=aq+dq[d]; nr:=arx+dr[d]; nc:=nq+(nr-(nr&1))/2; candidate:=btech_hex_distance(nc,nr,bc,br); IF candidate<best_dist THEN best_dist:=candidate;best:=d-1;END IF; END LOOP;
 RETURN best;
END $$;

CREATE OR REPLACE FUNCTION public.btech_intervening_woods(p_map text,ac int,ar int,bc int,br int) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;terrain text;points int:=0;guard int:=0;
 dq int[]:=ARRAY[1,1,0,-1,-1,0]; dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br); aq:=c-(r-(r&1))/2; nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;
  terrain:=btech_terrain(p_map,lpad(c::text,2,'0')||lpad(r::text,2,'0')); points:=points+CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;guard:=guard+1;
 END LOOP; RETURN points;
END $$;

CREATE OR REPLACE FUNCTION public.btech_consume_ammo(p_mech jsonb,p_type text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE m jsonb:=p_mech;bin jsonb;pos bigint;
BEGIN
 IF p_type IS NULL THEN RETURN m; END IF;
 FOR bin,pos IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) WITH ORDINALITY LOOP
  IF bin->>'type'=p_type AND coalesce((bin->>'shots')::int,0)>0 THEN RETURN jsonb_set(m,ARRAY['ammoBins',(pos-1)::text,'shots'],to_jsonb((bin->>'shots')::int-1),true); END IF;
 END LOOP; RAISE EXCEPTION 'No % ammunition remains',p_type;
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_direct_damage(p_mech jsonb,p_damage int,p_location text,p_rear boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE m jsonb:=p_mech; loc text:=p_location; armor_loc text; remaining int:=p_damage; value_now int; used int;
 transfer jsonb:='{"la":"lt","ra":"rt","ll":"lt","rl":"rt","lt":"ct","rt":"ct","head":"ct"}'::jsonb;
 crits jsonb:='[]'::jsonb; da int; db int;
BEGIN
 WHILE remaining>0 AND loc IS NOT NULL AND NOT coalesce((m->>'destroyed')::boolean,false) LOOP
  armor_loc:=CASE WHEN p_rear AND loc IN ('ct','lt','rt') THEN loc||'_rear' ELSE loc END;
  value_now:=coalesce((m->'armor'->>armor_loc)::int,0); used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['armor',armor_loc],to_jsonb(value_now-used),true); remaining:=remaining-used;
  IF remaining=0 THEN EXIT; END IF;
  value_now:=coalesce((m->'structure'->>loc)::int,0); used:=least(value_now,remaining);
  m:=jsonb_set(m,ARRAY['structure',loc],to_jsonb(value_now-used),true); remaining:=remaining-used;
  IF used>0 THEN da:=floor(random()*6+1); db:=floor(random()*6+1); crits:=crits||jsonb_build_array(jsonb_build_object('location',loc,'die_a',da,'die_b',db,'total',da+db,'hits',CASE WHEN da+db<=7 THEN 0 WHEN da+db<=9 THEN 1 WHEN da+db<=11 THEN 2 ELSE 3 END)); END IF;
  IF coalesce((m->'structure'->>loc)::int,0)>0 THEN EXIT; END IF;
  IF loc IN ('head','ct') THEN m:=jsonb_set(m,'{destroyed}','true'::jsonb,true); EXIT; END IF;
  IF loc='lt' THEN m:=jsonb_set(m,'{structure,la}','0'::jsonb,true); END IF;
  IF loc='rt' THEN m:=jsonb_set(m,'{structure,ra}','0'::jsonb,true); END IF;
  loc:=transfer->>loc; p_rear:=false;
 END LOOP;
 RETURN jsonb_build_object('mech',m,'critical_checks',crits);
END $$;

CREATE OR REPLACE FUNCTION public.resolve_standard_weapon_attack(p_game_id uuid,p_attacker_instance_id text,p_target_instance_id text,p_weapon_mounts text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g btech_games%ROWTYPE; player btech_players%ROWTYPE; st jsonb; attacker jsonb; target jsonb; v_mount_id text;
 mount btech_authoritative_mounts%ROWTYPE; weapon btech_authoritative_weapons%ROWTYPE; dist int; range_mod int; move_mod int; target_mod int; woods int; tn int;
 da int; db int; lr int; loc text; angle text:='front'; damage_result jsonb; results jsonb:='[]'::jsonb; heat_added int:=0; shot int; event_id uuid; seq int; arr jsonb;
 firing_facing int; firing_direction int; facing_diff int; target_direction int; target_diff int; map_id text;
BEGIN
 SELECT * INTO g FROM btech_games WHERE id=p_game_id FOR UPDATE;
 SELECT * INTO player FROM btech_players WHERE game_id=p_game_id AND user_id=auth.uid() AND role='player';
 IF NOT FOUND OR g.status<>'in-progress' OR g.current_phase<>'weapon_attack' OR g.active_player_id IS DISTINCT FROM player.id THEN RAISE EXCEPTION 'It is not your weapon-attack turn'; END IF;
 st:=CASE jsonb_typeof(g.state) WHEN 'string' THEN (g.state#>>'{}')::jsonb ELSE g.state END;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;
 SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_target_instance_id;
 IF attacker IS NULL OR target IS NULL OR (attacker->>'owner')::int<>player.seat_number OR (target->>'owner')::int=player.seat_number OR coalesce((attacker->>'hasFired')::boolean,false) THEN RAISE EXCEPTION 'Invalid attacker or target'; END IF;
 dist:=btech_hex_distance((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int);
 map_id:=coalesce(st->>'map_id','training-grounds');
 move_mod:=CASE attacker->>'movementMode' WHEN 'walk' THEN 1 WHEN 'run' THEN 2 WHEN 'jump' THEN 3 ELSE 0 END;
 target_mod:=CASE WHEN coalesce((target->>'hexesMoved')::int,0)>=10 THEN 4 WHEN coalesce((target->>'hexesMoved')::int,0)>=7 THEN 3 WHEN coalesce((target->>'hexesMoved')::int,0)>=5 THEN 2 WHEN coalesce((target->>'hexesMoved')::int,0)>=3 THEN 1 ELSE 0 END + CASE WHEN target->>'movementMode'='jump' THEN 1 ELSE 0 END;
 woods:=btech_intervening_woods(map_id,(attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int)+CASE btech_terrain(map_id,lpad(target->>'col',2,'0')||lpad(target->>'row',2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'light_woods' THEN 1 ELSE 0 END;
 IF woods>=3 THEN RAISE EXCEPTION 'Line of sight is blocked by intervening woods'; END IF;
 SELECT coalesce(max(sequence),0)+1 INTO seq FROM btech_combat_events WHERE game_id=p_game_id AND round=g.current_round AND phase='weapon_attack';
 INSERT INTO btech_combat_events(game_id,round,phase,sequence,player_id,attacker_instance_id,target_instance_id,declaration)
 VALUES(p_game_id,g.current_round,'weapon_attack',seq,player.id,p_attacker_instance_id,p_target_instance_id,jsonb_build_object('weapon_mounts',p_weapon_mounts)) RETURNING id INTO event_id;
 FOREACH v_mount_id IN ARRAY coalesce(p_weapon_mounts,ARRAY[]::text[]) LOOP
  SELECT * INTO mount FROM btech_authoritative_mounts authoritative_mount WHERE authoritative_mount.unit_id=attacker->>'unitId' AND authoritative_mount.mount_id=v_mount_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unsupported or invalid direct-fire mount: %',v_mount_id; END IF;
  SELECT * INTO weapon FROM btech_authoritative_weapons WHERE weapon_key=mount.weapon_key;
  firing_facing:=CASE WHEN mount.location ILIKE '%torso%' OR mount.location ILIKE '%head%' THEN coalesce((attacker->>'torsoFacing')::int,(attacker->>'facing')::int) ELSE (attacker->>'facing')::int END;
  firing_direction:=btech_direction_to((attacker->>'col')::int,(attacker->>'row')::int,(target->>'col')::int,(target->>'row')::int); facing_diff:=(firing_direction-firing_facing+6)%6;
  IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION '% target is outside its firing arc',weapon.name; END IF;
  target_direction:=btech_direction_to((target->>'col')::int,(target->>'row')::int,(attacker->>'col')::int,(attacker->>'row')::int);target_diff:=(target_direction-(target->>'facing')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN 'front' WHEN target_diff IN (1,5) THEN 'side' ELSE 'rear' END;
  IF dist>weapon.long_range THEN RAISE EXCEPTION '% is beyond long range',weapon.name; END IF;
  range_mod:=CASE WHEN dist<=weapon.short_range THEN 0 WHEN dist<=weapon.medium_range THEN 2 ELSE 4 END;
  IF weapon.minimum_range>0 AND dist<=weapon.minimum_range THEN range_mod:=range_mod+(weapon.minimum_range-dist+1); END IF;
  tn:=4+move_mod+target_mod+range_mod+woods;
  FOR shot IN 1..mount.shots LOOP
   attacker:=btech_consume_ammo(attacker,weapon.ammo_type);
   da:=floor(random()*6+1); db:=floor(random()*6+1);
   IF da+db>=tn AND tn<=12 THEN
    lr:=floor(random()*6+1)+floor(random()*6+1);
    loc:=CASE angle
      WHEN 'side' THEN CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'rt' WHEN 8 THEN 'ct' WHEN 9 THEN 'lt' WHEN 10 THEN 'll' WHEN 11 THEN 'la' ELSE 'head' END
      WHEN 'rear' THEN CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END
      ELSE CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END END;
    damage_result:=btech_apply_direct_damage(target,weapon.damage,loc,angle='rear'); target:=damage_result->'mech';
    results:=results||jsonb_build_array(jsonb_build_object('mount_id',v_mount_id,'weapon',weapon.name,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',true,'angle',angle,'location',loc,'damage',weapon.damage,'critical_checks',damage_result->'critical_checks'));
   ELSE results:=results||jsonb_build_array(jsonb_build_object('mount_id',v_mount_id,'weapon',weapon.name,'to_hit',jsonb_build_object('die_a',da,'die_b',db,'total',da+db,'target',tn),'hit',false)); END IF;
  END LOOP;
  heat_added:=heat_added+weapon.heat*mount.shots;
 END LOOP;
 attacker:=jsonb_set(attacker,'{hasFired}','true'::jsonb,true);
 attacker:=jsonb_set(attacker,'{weaponHeat}',to_jsonb(coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 attacker:=jsonb_set(attacker,'{heat}',to_jsonb(coalesce((attacker->>'roundStartingHeat')::int,0)+coalesce((attacker->>'movementHeat')::int,0)+coalesce((attacker->>'weaponHeat')::int,0)+heat_added),true);
 SELECT jsonb_agg(CASE WHEN value->>'instanceId'=p_attacker_instance_id THEN attacker WHEN value->>'instanceId'=p_target_instance_id THEN target ELSE value END) INTO arr FROM jsonb_array_elements(st->'mech_instances') value;
 st:=jsonb_set(st,'{mech_instances}',arr,true); UPDATE btech_games SET state=st WHERE id=p_game_id;
 UPDATE btech_combat_events SET status='resolved',resolution=jsonb_build_object('results',results,'state_version','authoritative-direct-fire-01'),resolved_at=now() WHERE id=event_id;
 RETURN jsonb_build_object('event_id',event_id,'results',results);
EXCEPTION WHEN OTHERS THEN
 IF event_id IS NOT NULL THEN UPDATE btech_combat_events SET status='rejected',resolution=jsonb_build_object('error',SQLERRM),resolved_at=now() WHERE id=event_id; END IF;
 RAISE;
END $$;

REVOKE ALL ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_standard_weapon_attack(uuid,text,text,text[]) TO authenticated;
