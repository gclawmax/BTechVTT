-- BattleMech torso/head weapons fire only through the torso forward arc.
-- Arm weapons add their own side arc, but neither arm can fire to the rear.

CREATE OR REPLACE FUNCTION public.btech_mech_weapon_arc_allows(p_mount_location text,p_facing int,p_target_direction int)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE lower(coalesce(p_mount_location,''))
  WHEN 'la' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,2,5)
  WHEN 'ra' THEN ((p_target_direction-p_facing+6)%6) IN (0,1,4,5)
  ELSE ((p_target_direction-p_facing+6)%6) IN (0,1,5)
 END
$$;
REVOKE ALL ON FUNCTION public.btech_mech_weapon_arc_allows(text,int,int) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction)' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'IF NOT indirect AND facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;',
  'IF NOT indirect AND NOT btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;');
 IF patched=source THEN
  patched:=replace(source,
   'IF facing_diff NOT IN (0,1,5) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;',
   'IF NOT btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction) THEN RAISE EXCEPTION ''% target is outside its firing arc'',weapon_name;END IF;');
 END IF;
 IF patched=source OR position('btech_mech_weapon_arc_allows(mount_location,firing_facing,firing_direction)' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install corrected BattleMech weapon arcs';END IF;
 EXECUTE patched;
END $$;
