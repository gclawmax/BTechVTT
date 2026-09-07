-- BV-4 usability: BV2 is a complete force-limit format, not an additional
-- Dropship-tonnage cap. New BV2 match state omits dropship_tonnage entirely.
-- Custom scenario storage must accept the same distinction.

DO $$
DECLARE
  fn regprocedure:=to_regprocedure('public.save_btech_custom_scenario(jsonb)');
  source text;
  patched text;
  marker text:='bv2_scenario_without_tonnage_v1';
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'Could not locate custom scenario storage';END IF;
  source:=pg_get_functiondef(fn);
  IF position(marker IN source)>0 THEN RETURN;END IF;
  patched:=replace(source,
    'IF coalesce((p_definition->>''dropship_tonnage'')::int,0) NOT IN (100,150,200,250) THEN RAISE EXCEPTION ''Choose a supported dropship tonnage'';END IF;',
    'IF coalesce(p_definition->''force_limit''->>''mode'',''tonnage'')<>''bv2'' AND coalesce((p_definition->>''dropship_tonnage'')::int,0) NOT IN (100,150,200,250) THEN RAISE EXCEPTION ''Choose a supported dropship tonnage'';END IF; /* bv2_scenario_without_tonnage_v1 */');
  IF patched=source THEN
    patched:=replace(source,
      'IF COALESCE((p_definition ->> ''dropship_tonnage'')::integer, 0) <> ALL (ARRAY[100, 150, 200, 250]) THEN RAISE EXCEPTION ''Choose a supported dropship tonnage''; END IF;',
      'IF coalesce(p_definition->''force_limit''->>''mode'',''tonnage'')<>''bv2'' AND COALESCE((p_definition ->> ''dropship_tonnage'')::integer, 0) <> ALL (ARRAY[100, 150, 200, 250]) THEN RAISE EXCEPTION ''Choose a supported dropship tonnage''; END IF; /* bv2_scenario_without_tonnage_v1 */');
  END IF;
  IF patched=source OR position(marker IN patched)=0 THEN RAISE EXCEPTION 'Could not safely allow BV2 scenarios without tonnage';END IF;
  EXECUTE patched;
END $$;

DO $$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef(to_regprocedure('public.save_btech_custom_scenario(jsonb)')) INTO source;
 IF position('bv2_scenario_without_tonnage_v1' IN coalesce(source,''))=0 THEN RAISE EXCEPTION 'BV2 scenario tonnage isolation was not installed';END IF;
END $$;

NOTIFY pgrst,'reload schema';
