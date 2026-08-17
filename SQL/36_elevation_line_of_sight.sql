-- Elevation-aware line of sight for the built-in terrain maps.
-- Run after SQL/35_terrain_and_elevation.sql.
--
-- This layer blocks a direct-fire line when an intervening hex is higher than
-- both BattleMechs. It intentionally does not yet model partial cover; that
-- requires the fuller Total Warfare hit-location treatment rather than a
-- misleading blanket to-hit modifier.

CREATE OR REPLACE FUNCTION public.btech_elevation_blocks_los(
 p_map text,ac int,ar int,bc int,br int
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
 c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;guard int:=0;
 attacker_elevation int:=btech_elevation(p_map,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'));
 target_elevation int:=btech_elevation(p_map,lpad(bc::text,2,'0')||lpad(br::text,2,'0'));
 dq int[]:=ARRAY[1,1,0,-1,-1,0];dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br);aq:=c-(r-(r&1))/2;nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;
  IF btech_elevation(p_map,lpad(c::text,2,'0')||lpad(r::text,2,'0'))>greatest(attacker_elevation,target_elevation) THEN RETURN true;END IF;
  guard:=guard+1;
 END LOOP;
 RETURN false;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_elevation_blocks_los' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E' IF woods>=3 THEN RAISE EXCEPTION ''Line of sight is blocked by intervening woods'';END IF;',
  E' IF woods>=3 THEN RAISE EXCEPTION ''Line of sight is blocked by intervening woods'';END IF;\n IF btech_elevation_blocks_los(map_id,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int) THEN RAISE EXCEPTION ''Line of sight is blocked by an intervening ridge'';END IF;');
 IF patched=source OR position('intervening ridge' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver elevation line-of-sight marker was not found';END IF;
 EXECUTE patched;
END $$;
