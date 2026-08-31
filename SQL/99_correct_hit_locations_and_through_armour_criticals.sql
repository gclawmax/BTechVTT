-- Correct the standard BattleMech hit-location tables and make a natural 2
-- resolve as a through-armour critical (TAC). The damage itself still strikes
-- armour first; the TAC is a separate critical-slot check and must never be
-- represented as internal-structure damage.

CREATE OR REPLACE FUNCTION public.btech_roll_mech_hit_location(p_angle text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE da int:=floor(random()*6+1);db int:=floor(random()*6+1);roll_total int;location_id text;
BEGIN
 roll_total:=da+db;
 location_id:=CASE p_angle
  WHEN 'side-right' THEN CASE roll_total WHEN 2 THEN 'rt' WHEN 3 THEN 'rl' WHEN 4 THEN 'ra' WHEN 5 THEN 'ra' WHEN 6 THEN 'rl' WHEN 7 THEN 'rt' WHEN 8 THEN 'ct' WHEN 9 THEN 'lt' WHEN 10 THEN 'la' WHEN 11 THEN 'll' ELSE 'head' END
  WHEN 'side-left' THEN CASE roll_total WHEN 2 THEN 'lt' WHEN 3 THEN 'll' WHEN 4 THEN 'la' WHEN 5 THEN 'la' WHEN 6 THEN 'll' WHEN 7 THEN 'lt' WHEN 8 THEN 'ct' WHEN 9 THEN 'rt' WHEN 10 THEN 'ra' WHEN 11 THEN 'rl' ELSE 'head' END
  WHEN 'rear' THEN CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END
  ELSE CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END
 END;
 RETURN jsonb_build_object(
  'die_a',da,'die_b',db,'total',roll_total,'location',location_id,
  'through_armor_critical',roll_total=2
 );
END $$;

CREATE OR REPLACE FUNCTION public.btech_apply_resolved_weapon_damage(
 p_mech jsonb,p_damage int,p_location_roll jsonb,p_rear boolean,p_load_type text,p_weapon_key text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE result jsonb;critical_result jsonb;checks jsonb;da int;db int;loc text:=p_location_roll->>'location';
BEGIN
 result:=btech_apply_special_ammo_damage(p_mech,p_damage,loc,p_rear,p_load_type,p_weapon_key);
 IF coalesce((p_location_roll->>'through_armor_critical')::boolean,false) THEN
  da:=floor(random()*6+1);db:=floor(random()*6+1);
  critical_result:=btech_resolve_critical_slots(result->'mech',loc,da+db);
  result:=jsonb_set(result,'{mech}',critical_result->'mech',true);
  checks:=coalesce(result->'critical_checks','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
   'location',loc,'die_a',da,'die_b',db,'total',da+db,
   'hits',critical_result->'hits','events',critical_result->'events','through_armor',true
  ));
  result:=jsonb_set(result,'{critical_checks}',checks,true);
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.btech_apply_resolved_weapon_damage(jsonb,int,jsonb,boolean,text,text) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('hit_location_tac_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'btech_apply_special_ammo_damage(target,weapon_damage,location_roll->>''location'',angle=''rear'',ammo_load_type,selected_weapon_key)',
  'btech_apply_resolved_weapon_damage(target,weapon_damage,location_roll,angle=''rear'',ammo_load_type,selected_weapon_key) /* hit_location_tac_v1 */');
 patched:=replace(patched,
  'btech_apply_special_ammo_damage(target,group_damage,location_roll->>''location'',angle=''rear'',ammo_load_type,selected_weapon_key)',
  'btech_apply_resolved_weapon_damage(target,group_damage,location_roll,angle=''rear'',ammo_load_type,selected_weapon_key)');
 IF patched=source OR position('hit_location_tac_v1' IN patched)=0
    OR position('btech_apply_resolved_weapon_damage(target,group_damage,location_roll' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install corrected weapon hit-location resolution';
 END IF;
 EXECUTE patched;
END $$;
