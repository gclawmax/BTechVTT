-- Total Warfare line-of-sight heights and BattleMech partial cover.
-- Run after SQL/91_electronic_construction_and_declared_c3.sql.

CREATE OR REPLACE FUNCTION public.btech_state_elevation(p_state jsonb,p_code text)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT CASE WHEN coalesce(p_state->'elevation_overrides','{}'::jsonb) ? p_code
  THEN coalesce((p_state->'elevation_overrides'->>p_code)::int,0)
  ELSE btech_elevation(coalesce(p_state->>'map_id','training-grounds'),p_code) END
$$;
REVOKE ALL ON FUNCTION public.btech_state_elevation(jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_los_analysis(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE c int:=ac;r int:=ar;dir int;aq int;nq int;nr int;guard int:=0;
 observer jsonb;target jsonb;code text;terrain text;level int;feature_height int;cover_height int;observer_level int;target_level int;
 observer_height int;target_height int;points int:=0;blocked boolean:=false;terrain_cover boolean:=false;
 adjacent_observer boolean;adjacent_target boolean;level_intervenes boolean;feature_intervenes boolean;
 dq int[]:=ARRAY[1,1,0,-1,-1,0];dr int[]:=ARRAY[0,-1,-1,0,1,1];
BEGIN
 SELECT coalesce(value->'weaponPhaseStart'->'mech',value) INTO observer FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE (coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int=ac AND (coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int=ar LIMIT 1;
 SELECT coalesce(value->'weaponPhaseStart'->'mech',value) INTO target FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE (coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int=bc AND (coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int=br LIMIT 1;
 observer_level:=btech_state_elevation(p_state,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'));target_level:=btech_state_elevation(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0'));
 observer_height:=observer_level+CASE WHEN coalesce((observer->>'prone')::boolean,false) THEN 1 ELSE 2 END;
 target_height:=target_level+CASE WHEN coalesce((target->>'prone')::boolean,false) THEN 1 ELSE 2 END;
 IF btech_state_terrain(p_state,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'))='deep_water' OR btech_state_terrain(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0'))='deep_water' THEN RETURN jsonb_build_object('blocked',true,'terrain_modifier',0,'partial_cover',false,'reason','water depth');END IF;
 WHILE btech_hex_distance(c,r,bc,br)>1 AND guard<40 LOOP
  dir:=btech_direction_to(c,r,bc,br);aq:=c-(r-(r&1))/2;nq:=aq+dq[dir+1];nr:=r+dr[dir+1];c:=nq+(nr-(nr&1))/2;r:=nr;guard:=guard+1;
  code:=lpad(c::text,2,'0')||lpad(r::text,2,'0');terrain:=btech_state_terrain(p_state,code);level:=btech_state_elevation(p_state,code);
  feature_height:=level+CASE terrain WHEN 'light_woods' THEN 2 WHEN 'heavy_woods' THEN 2 WHEN 'light_smoke' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'building' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END;
  adjacent_observer:=guard=1;adjacent_target:=btech_hex_distance(c,r,bc,br)=1;
  level_intervenes:=level>=greatest(observer_height,target_height) OR (adjacent_observer AND level>=observer_height) OR (adjacent_target AND level>=target_height);
  feature_intervenes:=feature_height>=greatest(observer_height,target_height) OR (adjacent_observer AND feature_height>=observer_height) OR (adjacent_target AND feature_height>=target_height);
  IF level_intervenes OR (terrain='building' AND feature_intervenes) THEN blocked:=true;END IF;
  IF feature_intervenes THEN points:=points+CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 WHEN 'building' THEN 3 ELSE 0 END;END IF;
  cover_height:=CASE WHEN terrain='building' THEN feature_height ELSE level END;
  IF adjacent_target AND NOT coalesce((target->>'prone')::boolean,false) AND observer_height<=target_height AND terrain NOT IN ('light_woods','heavy_woods') AND cover_height=target_level+1 THEN terrain_cover:=true;END IF;
 END LOOP;
 terrain:=btech_state_terrain(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0'));
 points:=points+CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END;
 RETURN jsonb_build_object('blocked',blocked OR points-CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END>=3,'terrain_modifier',points,'partial_cover',NOT coalesce((target->>'prone')::boolean,false) AND (terrain='shallow_water' OR terrain_cover),'reason',CASE WHEN blocked THEN 'terrain' WHEN points-CASE terrain WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END>=3 THEN 'woods or smoke' END);
END $$;
REVOKE ALL ON FUNCTION public.btech_los_analysis(jsonb,int,int,int,int) FROM PUBLIC;

-- Preserve the existing resolver/C3 API names while making their answers
-- height-aware. Target-hex terrain remains part of the attack modifier, not
-- the three-point intervening-terrain blocking test.
CREATE OR REPLACE FUNCTION public.btech_intervening_terrain(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS int LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT greatest(0,(btech_los_analysis(p_state,ac,ar,bc,br)->>'terrain_modifier')::int-
  CASE btech_state_terrain(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0')) WHEN 'heavy_woods' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'light_woods' THEN 1 WHEN 'light_smoke' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END)
$$;
REVOKE ALL ON FUNCTION public.btech_intervening_terrain(jsonb,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_state_elevation_blocks_los(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce((btech_los_analysis(p_state,ac,ar,bc,br)->>'blocked')::boolean,false)
   AND coalesce(btech_los_analysis(p_state,ac,ar,bc,br)->>'reason','') IN ('terrain','water depth')
$$;
REVOKE ALL ON FUNCTION public.btech_state_elevation_blocks_los(jsonb,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_target_has_partial_cover(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce((btech_los_analysis(p_state,ac,ar,bc,br)->>'partial_cover')::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.btech_target_has_partial_cover(jsonb,int,int,int,int) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 IF position('complete_los_cover_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'btech_elevation_blocks_los(map_id,','btech_state_elevation_blocks_los(st,');
 patched:=regexp_replace(patched,'shallow_water_cover\s*:=\s*[^;]+;','shallow_water_cover:=btech_target_has_partial_cover(st,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int); /* complete_los_cover_v1 */','i');
 patched:=replace(patched,'indirect_mod := 1;','indirect_mod := 1; shallow_water_cover:=btech_target_has_partial_cover(st,(spotter_start->>''col'')::int,(spotter_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);shallow_cover_mod:=CASE WHEN shallow_water_cover THEN 1 ELSE 0 END;');
 patched:=replace(patched,'indirect_mod:=1;','indirect_mod:=1;shallow_water_cover:=btech_target_has_partial_cover(st,(spotter_start->>''col'')::int,(spotter_start->>''row'')::int,(target_start->>''col'')::int,(target_start->>''row'')::int);shallow_cover_mod:=CASE WHEN shallow_water_cover THEN 1 ELSE 0 END;');
 IF patched=source OR position('complete_los_cover_v1' IN patched)=0 OR position('btech_state_elevation_blocks_los(st,' IN patched)=0 OR position('shallow_water_cover:=btech_target_has_partial_cover(st,(spotter_start' IN replace(patched,' ',''))=0 THEN RAISE EXCEPTION 'Could not safely install completed line-of-sight and cover rules';END IF;
 EXECUTE patched;
END $$;

-- C3 range support uses the same stateful height rules as weapon fire.
CREATE OR REPLACE FUNCTION public.btech_c3_range_distance(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS int LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE /* c3_complete_los_v1 */ physical_distance int:=btech_hex_distance((p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int);best_distance int;role text;owner_no int:=(p_attacker->>'owner')::int;network_id text;network_type text;root_id text;live jsonb;candidate jsonb;candidate_role text;
BEGIN
 role:=btech_c3_role(p_catalogue_version,p_attacker);network_id:=p_attacker->'c3Network'->>'id';network_type:=p_attacker->'c3Network'->>'type';IF role IS NULL OR network_id IS NULL OR p_attacker->'c3Network'->>'role' IS DISTINCT FROM role THEN RETURN physical_distance;END IF;
 IF btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(p_attacker->>'col')::int,(p_attacker->>'row')::int) THEN RETURN physical_distance;END IF;
 IF network_type='standard' THEN root_id:=btech_c3_connected_root(p_catalogue_version,p_state,owner_no,p_attacker,network_id);IF root_id IS NULL THEN RETURN physical_distance;END IF;ELSIF network_type<>'c3i' OR role<>'c3i' THEN RETURN physical_distance;END IF;
 best_distance:=physical_distance;
 FOR live IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value LOOP
  candidate:=coalesce(live->'weaponPhaseStart'->'mech',live)||jsonb_build_object('instanceId',live->>'instanceId');candidate_role:=btech_c3_role(p_catalogue_version,candidate);
  CONTINUE WHEN (candidate->>'owner')::int<>owner_no OR coalesce((candidate->>'destroyed')::boolean,false) OR candidate->'c3Network'->>'id' IS DISTINCT FROM network_id OR candidate->'c3Network'->>'type' IS DISTINCT FROM network_type;
  CONTINUE WHEN (network_type='c3i' AND candidate_role IS DISTINCT FROM 'c3i') OR (network_type='standard' AND btech_c3_connected_root(p_catalogue_version,p_state,owner_no,candidate,network_id) IS DISTINCT FROM root_id);
  CONTINUE WHEN btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(candidate->>'col')::int,(candidate->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int);
  IF network_type='c3i' AND btech_ecm_interferes_line(p_catalogue_version,p_state,owner_no,(p_attacker->>'col')::int,(p_attacker->>'row')::int,(candidate->>'col')::int,(candidate->>'row')::int) THEN CONTINUE;END IF;
  CONTINUE WHEN coalesce((btech_los_analysis(p_state,(candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)->>'blocked')::boolean,false);
  best_distance:=least(best_distance,btech_hex_distance((candidate->>'col')::int,(candidate->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int));
 END LOOP;RETURN best_distance;
END $$;
