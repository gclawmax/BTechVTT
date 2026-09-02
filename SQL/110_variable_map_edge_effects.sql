-- Follow-up to SQL 109: map-aware edges for the remaining named effects.
-- Each patch is restricted to an identified resolver and refuses to run when
-- its expected current source is not present.

DO $$
DECLARE fn regprocedure:=to_regprocedure('public.set_match_minefields(uuid,jsonb)');source text;patched text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Minefield resolver is missing';END IF;SELECT pg_get_functiondef(fn) INTO source;
 patched:=replace(source,'(field->>''col'')::int NOT BETWEEN 0 AND 15 OR (field->>''row'')::int NOT BETWEEN 0 AND 11','NOT btech_map_contains(coalesce(st->>''map_id'',''training-grounds''),(field->>''col'')::int,(field->>''row'')::int)');
 IF patched=source OR position('btech_map_contains' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely extend minefield map bounds';END IF;EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 FOREACH fn IN ARRAY ARRAY[to_regprocedure('public.resolve_declared_charge_legacy(uuid,text)'),to_regprocedure('public.resolve_declared_charge(uuid,text)'),to_regprocedure('public.resolve_declared_death_from_above(uuid,text)')] LOOP
  IF fn IS NULL THEN CONTINUE;END IF;SELECT pg_get_functiondef(fn) INTO source;
  patched:=replace(source,'dest_col BETWEEN 0 AND 15 AND dest_row BETWEEN 0 AND 11','btech_map_contains(coalesce(st->>''map_id'',''training-grounds''),dest_col,dest_row)');
  IF patched<>source THEN EXECUTE patched;END IF;
 END LOOP;
END $$;
