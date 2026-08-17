-- Fix a PL/pgSQL name collision between the local resolution payload and the
-- btech_combat_events.resolution column in the SQL 22/23 batch resolvers.
-- Run after SQL/23_authoritative_physical_attacks.sql.

DO $$
DECLARE
 function_signature text;
 function_oid regprocedure;
 original_definition text;
 fixed_definition text;
BEGIN
 FOREACH function_signature IN ARRAY ARRAY[
  'public.submit_simultaneous_weapon_declaration(uuid,text,text,text[],jsonb)',
  'public.submit_simultaneous_physical_declaration(uuid,text,text,text,text[])'
 ] LOOP
  function_oid:=to_regprocedure(function_signature);
  IF function_oid IS NULL THEN RAISE EXCEPTION 'Required resolver is missing: %',function_signature;END IF;
  SELECT pg_get_functiondef(function_oid) INTO original_definition;
  IF position('resolution=resolution_payload' IN original_definition)>0 THEN CONTINUE;END IF;
  fixed_definition:=replace(original_definition,'resolution jsonb;','resolution_payload jsonb;');
  fixed_definition:=replace(fixed_definition,'resolution:=jsonb_build_object','resolution_payload:=jsonb_build_object');
  fixed_definition:=replace(fixed_definition,'resolution=resolution,','resolution=resolution_payload,');
  IF fixed_definition=original_definition OR position('resolution=resolution_payload' IN fixed_definition)=0 THEN
   RAISE EXCEPTION 'Resolver definition did not contain the expected resolution collision: %',function_signature;
  END IF;
  EXECUTE fixed_definition;
 END LOOP;
END $$;
