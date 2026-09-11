-- Follow-up to 153: CASE in a side torso also stops an explosion transferred
-- from its attached arm or leg. Preserve damage in both reached locations.
BEGIN;
DO $$
DECLARE fn regprocedure:=to_regprocedure('public.btech_apply_ammunition_explosion(jsonb,text,integer)');source text;patched text;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'Ammunition explosion resolver missing';END IF;
 source:=pg_get_functiondef(fn);
 IF position('case_transfer_protection_v154' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'available:=coalesce((m->''structure''->>loc)::int,0);used:=least(available,remaining);',
  'protected:=btech_location_has_case(m->>''catalogueVersion'',m,loc); /* case_transfer_protection_v154 */ available:=coalesce((m->''structure''->>loc)::int,0);used:=least(available,remaining);');
 IF patched=source THEN RAISE EXCEPTION 'Could not safely install CASE transfer protection';END IF;
 EXECUTE patched;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
