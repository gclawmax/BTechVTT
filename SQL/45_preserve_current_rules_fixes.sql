-- Safe follow-up for the Local Model's four rules fixes.
--
-- Run after SQL/44. This migration deliberately patches the *current* live
-- resolvers rather than re-running historical SQL/15, /18, /19, /20, /21 or
-- /31. Those historical definitions pre-date terrain, rough-ground, prone,
-- flamer, Ultra AC and LB-X changes and would erase them if re-applied.

-- Keep hit-location resolution centralised so direct fire, missiles and fall
-- damage use the same corrected front and mirrored side tables.
CREATE OR REPLACE FUNCTION public.btech_roll_mech_hit_location(p_angle text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE da int:=floor(random()*6+1);db int:=floor(random()*6+1);roll_total int;location_id text;
BEGIN
 roll_total:=da+db;
 location_id:=CASE p_angle
  WHEN 'side-right' THEN CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'rt' WHEN 8 THEN 'ct' WHEN 9 THEN 'lt' WHEN 10 THEN 'll' WHEN 11 THEN 'la' ELSE 'head' END
  WHEN 'side-left' THEN CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'la' WHEN 4 THEN 'la' WHEN 5 THEN 'll' WHEN 6 THEN 'lt' WHEN 7 THEN 'lt' WHEN 8 THEN 'ct' WHEN 9 THEN 'rt' WHEN 10 THEN 'rl' WHEN 11 THEN 'ra' ELSE 'head' END
  WHEN 'rear' THEN CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' ELSE 'head' END
  ELSE CASE roll_total WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl' WHEN 6 THEN 'rt' WHEN 7 THEN 'ct' WHEN 8 THEN 'lt' WHEN 9 THEN 'll' WHEN 10 THEN 'la' WHEN 11 THEN 'la' WHEN 12 THEN 'head' ELSE 'la' END
 END;
 RETURN jsonb_build_object('die_a',da,'die_b',db,'total',roll_total,'location',location_id);
END $$;

-- Preserve all post-SQL/21 extensions while updating the live simultaneous
-- weapon resolver's target angle and its Gunnery base number.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing; run SQL/21 through SQL/44 first';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_elevation_blocks_los' IN source)=0
    OR position('btech_expand_ultra_ac_mounts' IN source)=0
    OR position('lb_x_ammo_setup_v1' IN source)=0 THEN
  RAISE EXCEPTION 'Weapon declaration resolver is not at the expected SQL/44 revision';
 END IF;
 patched:=source;
 IF position('attacker_start->''pilot''->>''gunnery''' IN patched)=0 THEN
  patched:=replace(patched,
   'base_tn:=4+move_mod+target_mod+woods+sensor_mod+heat_mod;',
   'base_tn:=coalesce((attacker_start->''pilot''->>''gunnery'')::int,4)+move_mod+target_mod+woods+sensor_mod+heat_mod;');
 END IF;
 IF position('side-right' IN patched)=0 OR position('side-left' IN patched)=0 THEN
  patched:=replace(patched,
   'angle:=CASE WHEN target_diff=0 THEN ''front'' WHEN target_diff IN (1,5) THEN ''side'' ELSE ''rear'' END;',
   'angle:=CASE WHEN target_diff=0 THEN ''front'' WHEN target_diff=1 THEN ''side-right'' WHEN target_diff=5 THEN ''side-left'' ELSE ''rear'' END;');
 END IF;
 IF position('attacker_start->''pilot''->>''gunnery''' IN patched)=0
    OR position('side-right' IN patched)=0 OR position('side-left' IN patched)=0 THEN
  RAISE EXCEPTION 'Weapon declaration resolver could not be patched safely';
 END IF;
 IF patched=source THEN RETURN;END IF;
 EXECUTE patched;
END $$;

-- Preserve terrain/elevation and rough-ground additions while allowing a
-- jump action to declare its free landing facing. Older clients still use the
-- travel-direction fallback. A supplied facing must be one legal hex facing.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Authoritative movement resolver is missing; run SQL/31 through SQL/44 first';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('btech_elevation' IN source)=0 OR position('btech_resolve_rough_ground_piloting_check' IN source)=0 THEN
  RAISE EXCEPTION 'Movement resolver is not at the expected terrain and rough-ground revision';
 END IF;
 IF position('jump landing facing' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'   ELSE\n    current_facing:=btech_direction_to(current_col,current_row,next_col,next_row);\n   END IF;',
  E'   ELSE\n    -- jump landing facing: a jumping BattleMech may choose any legal facing.\n    IF action ? ''facing'' THEN\n     IF action->>''facing'' !~ ''^[0-5]$'' THEN RAISE EXCEPTION ''Jump landing facing must be between 0 and 5'';END IF;\n     current_facing:=(action->>''facing'')::int;\n    ELSE\n     current_facing:=btech_direction_to(current_col,current_row,next_col,next_row);\n    END IF;\n   END IF;');
 IF patched=source OR position('jump landing facing' IN patched)=0 THEN
  RAISE EXCEPTION 'Movement resolver did not contain the expected jump-facing marker';
 END IF;
 EXECUTE patched;
END $$;
