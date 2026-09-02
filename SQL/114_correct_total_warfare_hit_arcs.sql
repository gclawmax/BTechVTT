-- Correct Total Warfare BattleMech attack directions used for hit locations.
-- A target in any of the three forward hexes uses the front table; the two
-- remaining lateral hexes use their respective side tables; only the hex
-- directly behind uses the rear table. Run after SQL/113.

CREATE OR REPLACE FUNCTION public.btech_mech_hit_arc(p_facing int,p_attack_direction int)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE ((p_attack_direction-p_facing+6)%6)
  WHEN 0 THEN 'front'
  WHEN 1 THEN 'front'
  WHEN 5 THEN 'front'
  WHEN 2 THEN 'side-left'
  WHEN 4 THEN 'side-right'
  ELSE 'rear'
 END
$$;
REVOKE ALL ON FUNCTION public.btech_mech_hit_arc(int,int) FROM PUBLIC;

-- Physical hit tables use left/right labels. Accept the shared side labels
-- as aliases, so prone targets and normal physical attacks agree on arcs.
CREATE OR REPLACE FUNCTION public.btech_roll_physical_location(p_attack text,p_angle text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE die_roll int:=floor(random()*6+1);location_id text;
 normalized_angle text:=CASE p_angle WHEN 'side-left' THEN 'left' WHEN 'side-right' THEN 'right' ELSE p_angle END;
BEGIN
 IF p_attack='punch' THEN
  location_id:=CASE normalized_angle
   WHEN 'left' THEN CASE WHEN die_roll<=2 THEN 'lt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'la' ELSE 'head' END
   WHEN 'right' THEN CASE WHEN die_roll<=2 THEN 'rt' WHEN die_roll=3 THEN 'ct' WHEN die_roll<=5 THEN 'ra' ELSE 'head' END
   ELSE CASE die_roll WHEN 1 THEN 'la' WHEN 2 THEN 'lt' WHEN 3 THEN 'ct' WHEN 4 THEN 'rt' WHEN 5 THEN 'ra' ELSE 'head' END END;
 ELSIF p_attack='kick' THEN
  location_id:=CASE normalized_angle WHEN 'left' THEN 'll' WHEN 'right' THEN 'rl'
   ELSE CASE WHEN die_roll<=3 THEN 'rl' ELSE 'll' END END;
 ELSE RAISE EXCEPTION 'Unsupported physical attack type';END IF;
 RETURN jsonb_build_object('die',die_roll,'location',location_id);
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('total_warfare_weapon_hit_arc_v2' IN source)=0 THEN
  patched:=replace(source,
   'angle:=CASE WHEN target_diff=0 THEN ''front'' WHEN target_diff=1 THEN ''side-right'' WHEN target_diff=5 THEN ''side-left'' ELSE ''rear'' END;',
   'angle:=btech_mech_hit_arc((target_start->>''facing'')::int,target_direction); /* total_warfare_weapon_hit_arc_v2 */');
  IF patched=source OR position('total_warfare_weapon_hit_arc_v2' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install Total Warfare weapon hit arcs';END IF;
  EXECUTE patched;
 END IF;

 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('total_warfare_physical_hit_arc_v2' IN source)=0 THEN
  patched:=replace(source,
   'angle:=CASE WHEN target_diff=1 THEN ''left'' WHEN target_diff=5 THEN ''right'' WHEN target_diff IN (2,3,4) THEN ''rear'' ELSE ''front'' END;',
   'angle:=btech_mech_hit_arc((target_start->>''facing'')::int,target_direction); /* total_warfare_physical_hit_arc_v2 */');
  IF patched=source OR position('total_warfare_physical_hit_arc_v2' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install Total Warfare physical hit arcs';END IF;
  EXECUTE patched;
 END IF;
END $$;
