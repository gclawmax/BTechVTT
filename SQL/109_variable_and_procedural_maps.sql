-- Variable map dimensions for the supported BattleMech duel rules.
-- This deliberately patches only the named, audited authoritative entry
-- points; it does not perform a database-wide source rewrite.

CREATE OR REPLACE FUNCTION public.btech_map_dimensions(p_map text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE custom_id uuid;definition jsonb;cols int:=16;rows int:=17;
BEGIN
 IF p_map LIKE 'custom:%' THEN
  BEGIN custom_id:=substring(p_map FROM 8)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('columns',cols,'rows',rows);END;
  SELECT scenario.definition INTO definition FROM btech_custom_scenarios scenario WHERE scenario.id=custom_id;
  cols:=coalesce((definition->>'columns')::int,(definition->>'cols')::int,16);rows:=coalesce((definition->>'rows')::int,17);
 END IF;
 IF cols NOT BETWEEN 8 AND 48 THEN cols:=16;END IF;IF rows NOT BETWEEN 8 AND 48 THEN rows:=17;END IF;
 RETURN jsonb_build_object('columns',cols,'rows',rows);
END $$;
CREATE OR REPLACE FUNCTION public.btech_map_contains(p_map text,p_col int,p_row int)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p_col>=0 AND p_row>=0 AND p_col<(btech_map_dimensions(p_map)->>'columns')::int AND p_row<(btech_map_dimensions(p_map)->>'rows')::int
$$;
REVOKE ALL ON FUNCTION public.btech_map_dimensions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btech_map_contains(text,int,int) FROM PUBLIC;

-- The current movement resolver is the authoritative route for standing,
-- walking, running and jumping. Only its two map-edge predicates change.
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.submit_battlemech_movement(uuid,text,text,jsonb)');source text;patched text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Movement resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 patched:=replace(source,'next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11','NOT btech_map_contains(coalesce(st->>''map_id'',''training-grounds''),next_col,next_row)');
 patched:=replace(patched,'next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11','NOT btech_map_contains(coalesce(st->>''map_id'',''training-grounds''),next_col,next_row)');
 IF patched=source OR position('btech_map_contains' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend BattleMech movement map bounds';END IF;EXECUTE patched;
END $$;

-- Deployment is the other player-facing map entry point. Its terrain and
-- authored-zone checks remain unchanged.
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.set_match_deployment(uuid,jsonb)');source text;patched text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Deployment resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 patched:=replace(source,'(position->>''col'')::int NOT BETWEEN 0 AND 15 OR (position->>''row'')::int NOT BETWEEN 0 AND 11','NOT btech_map_contains(coalesce(st->>''map_id'',''training-grounds''),(position->>''col'')::int,(position->>''row'')::int)');
 IF patched=source OR position('btech_map_contains' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend BattleMech deployment map bounds';END IF;EXECUTE patched;
END $$;

-- Charge/DFA path validation receives its state as p_state rather than st.
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.btech_validate_special_attack_path(jsonb,text,text,text,jsonb,integer,integer,integer,integer)');source text;patched text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Special-attack path validator is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 patched:=replace(source,'next_col NOT BETWEEN 0 AND 15 OR next_row NOT BETWEEN 0 AND 11','NOT btech_map_contains(coalesce(p_state->>''map_id'',''training-grounds''),next_col,next_row)');
 IF patched=source OR position('btech_map_contains' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend Charge/DFA path map bounds';END IF;EXECUTE patched;
END $$;

-- Custom scenario saving keeps its existing terrain and objective validation,
-- but accepts two-digit coordinates within its declared dimensions.
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.save_btech_custom_scenario(jsonb)');source text;patched text;guard text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Custom scenario saver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 guard:='IF coalesce((p_definition->>''columns'')::int,(p_definition->>''cols'')::int,16) NOT BETWEEN 8 AND 48 OR coalesce((p_definition->>''rows'')::int,17) NOT BETWEEN 8 AND 48 THEN RAISE EXCEPTION ''Custom maps must be between 8 and 48 hexes in each dimension'';END IF;IF EXISTS(SELECT 1 FROM jsonb_each(coalesce(p_definition->''terrain'',''{}''::jsonb)) e WHERE e.key !~ ''^[0-9]{4}$'' OR left(e.key,2)::int>=coalesce((p_definition->>''columns'')::int,(p_definition->>''cols'')::int,16) OR right(e.key,2)::int>=coalesce((p_definition->>''rows'')::int,17)) OR EXISTS(SELECT 1 FROM jsonb_each(coalesce(p_definition->''elevation'',''{}''::jsonb)) e WHERE e.key !~ ''^[0-9]{4}$'' OR left(e.key,2)::int>=coalesce((p_definition->>''columns'')::int,(p_definition->>''cols'')::int,16) OR right(e.key,2)::int>=coalesce((p_definition->>''rows'')::int,17)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_definition->''deployment_zones''->''1'',''[]''::jsonb)||coalesce(p_definition->''deployment_zones''->''2'',''[]''::jsonb)||coalesce(p_definition->''objective_hexes'',''[]''::jsonb)) e(code) WHERE e.code !~ ''^[0-9]{4}$'' OR left(e.code,2)::int>=coalesce((p_definition->>''columns'')::int,(p_definition->>''cols'')::int,16) OR right(e.code,2)::int>=coalesce((p_definition->>''rows'')::int,17)) THEN RAISE EXCEPTION ''Scenario content is outside its declared map'';END IF;';
 patched:=replace(source,'valid_code text:=''^(0[0-9]|1[0-5])(0[0-9]|1[01])$'';','valid_code text:=''^[0-9]{4}$'';');
 patched:=replace(patched,'IF auth.uid() IS NULL THEN RAISE EXCEPTION ''Sign in before saving a custom scenario'';END IF;','IF auth.uid() IS NULL THEN RAISE EXCEPTION ''Sign in before saving a custom scenario'';END IF;'||guard);
 IF patched=source OR position('Custom maps must be between 8 and 48' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend custom scenario dimensions';END IF;EXECUTE patched;
END $$;
