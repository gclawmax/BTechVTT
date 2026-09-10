-- Straight centre-to-centre LOS. Run after migration 148.
-- Existing weapon, detection and C3 callers retain their original API.
CREATE OR REPLACE FUNCTION public.btech_los_hex_path(ac int,ar int,bc int,br int,p_side int)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE aq double precision:=ac-(ar-(ar&1))/2; arx double precision:=ar;
 dq double precision:=bc-(br-(br&1))/2-aq;dr double precision:=br-ar;
 scale double precision; q double precision;r double precision; x double precision;y double precision;
 c int;rr int;i int;entry double precision;leave_at double precision;t1 double precision;t2 double precision;
 starts double precision[];deltas double precision[];cells jsonb:='[]';
BEGIN
 scale:=greatest(abs(dq+2*dr),abs(2*dq+dr),1);
 q:=aq-p_side*1e-7*(dq+2*dr)/scale;r:=arx+p_side*1e-7*(2*dq+dr)/scale;
 deltas:=ARRAY[2*dq+dr,dq+2*dr,dq-dr];
 FOR rr IN least(ar,br)-1..greatest(ar,br)+1 LOOP
  FOR c IN least(ac,bc)-1..greatest(ac,bc)+1 LOOP
   CONTINUE WHEN (c=ac AND rr=ar) OR (c=bc AND rr=br);
   x:=q-(c-(rr-(rr&1))/2);y:=r-rr;starts:=ARRAY[2*x+y,x+2*y,x-y];entry:=0;leave_at:=1;
   FOR i IN 1..3 LOOP
    IF abs(deltas[i])<1e-12 THEN
     IF abs(starts[i])>1 THEN leave_at:=-1;EXIT;END IF;
    ELSE
     t1:=(-1-starts[i])/deltas[i];t2:=(1-starts[i])/deltas[i];
     entry:=greatest(entry,least(t1,t2));leave_at:=least(leave_at,greatest(t1,t2));
    END IF;
   END LOOP;
   IF leave_at-entry>1e-6 THEN cells:=cells||jsonb_build_array(jsonb_build_object('col',c,'row',rr,'entry',entry));END IF;
  END LOOP;
 END LOOP;
 RETURN (SELECT coalesce(jsonb_agg(value-'entry' ORDER BY (value->>'entry')::double precision),'[]') FROM jsonb_array_elements(cells));
END $$;
REVOKE ALL ON FUNCTION public.btech_los_hex_path(int,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_los_analysis_path(p_state jsonb,ac int,ar int,bc int,br int,p_side int)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE cell jsonb;c int;r int;
 observer jsonb;target jsonb;code text;terrain text;level int;feature_height int;cover_height int;observer_level int;target_level int;
 observer_height int;target_height int;points int:=0;blocked boolean:=false;terrain_cover boolean:=false;
 adjacent_observer boolean;adjacent_target boolean;level_intervenes boolean;feature_intervenes boolean;
BEGIN
 SELECT coalesce(value->'weaponPhaseStart'->'mech',value) INTO observer FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE (coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int=ac AND (coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int=ar LIMIT 1;
 SELECT coalesce(value->'weaponPhaseStart'->'mech',value) INTO target FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) value WHERE (coalesce(value->'weaponPhaseStart'->'mech',value)->>'col')::int=bc AND (coalesce(value->'weaponPhaseStart'->'mech',value)->>'row')::int=br LIMIT 1;
 observer_level:=btech_state_elevation(p_state,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'));target_level:=btech_state_elevation(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0'));
 observer_height:=observer_level+CASE WHEN coalesce((observer->>'prone')::boolean,false) THEN 1 ELSE 2 END;
 target_height:=target_level+CASE WHEN coalesce((target->>'prone')::boolean,false) THEN 1 ELSE 2 END;
 IF btech_state_terrain(p_state,lpad(ac::text,2,'0')||lpad(ar::text,2,'0'))='deep_water' OR btech_state_terrain(p_state,lpad(bc::text,2,'0')||lpad(br::text,2,'0'))='deep_water' THEN RETURN jsonb_build_object('blocked',true,'terrain_modifier',0,'partial_cover',false,'reason','water depth');END IF;
 FOR cell IN SELECT value FROM jsonb_array_elements(btech_los_hex_path(ac,ar,bc,br,p_side)) LOOP
  c:=(cell->>'col')::int;r:=(cell->>'row')::int;
  code:=lpad(c::text,2,'0')||lpad(r::text,2,'0');terrain:=btech_state_terrain(p_state,code);level:=btech_state_elevation(p_state,code);
  feature_height:=level+CASE terrain WHEN 'light_woods' THEN 2 WHEN 'heavy_woods' THEN 2 WHEN 'light_smoke' THEN 2 WHEN 'heavy_smoke' THEN 2 WHEN 'building' THEN 1 WHEN 'fire' THEN 1 ELSE 0 END;
  adjacent_observer:=btech_hex_distance(c,r,ac,ar)=1;adjacent_target:=btech_hex_distance(c,r,bc,br)=1;
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
REVOKE ALL ON FUNCTION public.btech_los_analysis_path(jsonb,int,int,int,int,int) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_los_analysis(p_state jsonb,ac int,ar int,bc int,br int)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT result FROM (VALUES (btech_los_analysis_path(p_state,ac,ar,bc,br,1)),
 (btech_los_analysis_path(p_state,ac,ar,bc,br,-1))) paths(result)
 ORDER BY (result->>'blocked')::boolean DESC,(result->>'terrain_modifier')::int DESC,
 (result->>'partial_cover')::boolean DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.btech_los_analysis(jsonb,int,int,int,int) FROM PUBLIC;
