-- Complete the final supported BattleMech critical-effect edge cases.
-- Cockpit destruction persists pilot death, while a blown-off head or limb
-- destroys every component and ammunition bin in the detached location.

CREATE OR REPLACE FUNCTION public.btech_destroy_cockpit(p_mech jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb:=p_mech;
BEGIN
 m:=jsonb_set(m,'{destroyed}','true'::jsonb,true);
 m:=jsonb_set(m,'{pilot,consciousness}','"dead"'::jsonb,true);
 m:=jsonb_set(m,'{pilot,hits}','6'::jsonb,true);
 RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.btech_finalize_blown_off_location(p_mech jsonb,p_location text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE m jsonb:=p_mech;bins jsonb;
BEGIN
 IF p_location NOT IN ('head','la','ra','ll','rl') THEN RAISE EXCEPTION 'That location cannot be blown off';END IF;
 m:=jsonb_set(m,ARRAY['structure',p_location],'0'::jsonb,true);
 m:=btech_destroy_location_components(m,p_location);
 SELECT coalesce(jsonb_agg(CASE WHEN value->>'id' LIKE p_location||':%' THEN
   jsonb_set(jsonb_set(value,'{shots}','0'::jsonb,true),'{destroyed}','true'::jsonb,true)
  ELSE value END),'[]'::jsonb) INTO bins
 FROM jsonb_array_elements(coalesce(m->'ammoBins','[]'::jsonb)) value;
 m:=jsonb_set(m,'{ammoBins}',bins,true);
 IF p_location='head' THEN m:=btech_destroy_cockpit(m);END IF;
 RETURN m;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Critical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('complete_critical_effect_edges_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'm:=jsonb_set(m,ARRAY[''structure'',loc],''0''::jsonb,true);',
  'm:=btech_finalize_blown_off_location(m,loc); /* complete_critical_effect_edges_v1 */');
 patched:=replace(patched,
  'IF slot_key=''cockpit'' THEN m:=jsonb_set(m,''{destroyed}'',''true''::jsonb,true);END IF;',
  'IF slot_key=''cockpit'' THEN m:=btech_destroy_cockpit(m);END IF;');
 IF patched=source OR position('complete_critical_effect_edges_v1' IN patched)=0
   OR position('btech_destroy_cockpit(m)' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely complete cockpit and blown-off-location effects';
 END IF;
 EXECUTE patched;
END $$;

REVOKE ALL ON FUNCTION public.btech_destroy_cockpit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_finalize_blown_off_location(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btech_destroy_cockpit(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.btech_finalize_blown_off_location(jsonb,text) TO authenticated;
