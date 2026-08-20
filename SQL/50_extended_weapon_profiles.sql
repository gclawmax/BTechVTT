-- Reusable accuracy and ammunition support for the expanded MegaMek roster.
-- Run after SQL/49. This extends the live resolver; it does not re-run an
-- historical combat migration.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('weapon_profile_accuracy_v1' IN source)>0 THEN RETURN;END IF;
 IF position('lb_x_cluster_tn_v1' IN source)=0 THEN RAISE EXCEPTION 'Weapon declaration resolver is not at the expected LB-X revision';END IF;
 patched:=replace(source,
  'location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;',
  'location_roll jsonb;cluster_da int;cluster_db int;missiles_hit int;missiles_remaining int;group_damage int;groups jsonb;weapon_accuracy_mod int;');
 patched:=replace(patched,
  'weapon_damage:=(weapon->>''damage'')::int;weapon_heat:=(weapon->>''heat'')::int;short_range:=(weapon->''range''->>0)::int;',
  'weapon_damage:=(weapon->>''damage'')::int;weapon_heat:=(weapon->>''heat'')::int;weapon_accuracy_mod:=coalesce((weapon->>''toHitModifier'')::int,0);short_range:=(weapon->''range''->>0)::int;');
 patched:=replace(patched,
  'tn:=base_tn+range_mod+component_mod;',
  'tn:=base_tn+range_mod+component_mod+weapon_accuracy_mod; /* weapon_profile_accuracy_v1 */');
 IF patched=source OR position('weapon_profile_accuracy_v1' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver did not contain expected profile markers';END IF;
 EXECUTE patched;
END $$;

-- Gauss ammunition has a 15-point damage value for ammunition explosions.
-- This follows the existing heat-ammunition safety mechanism without changing
-- its trigger thresholds.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('''gauss'' THEN 15' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'WHEN ''machine_gun'' THEN 2 ELSE 0 END;',
  'WHEN ''machine_gun'' THEN 2 WHEN ''gauss'' THEN 15 WHEN ''streak_srm2'' THEN 4 WHEN ''ams'' THEN 1 WHEN ''narc'' THEN 0 ELSE 0 END;');
 IF patched=source THEN RAISE EXCEPTION 'Heat resolver did not contain ammunition damage marker';END IF;
 EXECUTE patched;
END $$;
