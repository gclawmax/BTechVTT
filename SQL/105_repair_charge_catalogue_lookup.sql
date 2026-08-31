-- Repair the live Charge declaration resolver.  Its local `definition`
-- variable shadowed btech_catalogue_units.definition, so PostgreSQL could
-- not determine which name was meant when a player declared a Charge.
--
-- Also qualify the mass lookups used by the two legacy displacement
-- resolvers.  Those functions are currently safe, but this prevents the
-- same regression if a local `definition` variable is added later.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.declare_charge_attack(uuid,text,text,integer,integer,integer,text,integer,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Charge declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('charge_catalogue_alias_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,'definition jsonb;mp_max int;','unit_definition jsonb;mp_max int;');
 patched:=replace(patched,
  'SELECT definition INTO definition FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=attacker->>''unitId'';',
  'SELECT cu.definition INTO unit_definition FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=attacker->>''unitId''; /* charge_catalogue_alias_v1 */');
 patched:=replace(patched,'(definition->''movement''->>p_mode)::int','(unit_definition->''movement''->>p_mode)::int');
 IF patched=source OR position('charge_catalogue_alias_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely repair the Charge catalogue lookup';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
  to_regprocedure('public.resolve_declared_charge_legacy(uuid,text)'),
  to_regprocedure('public.resolve_declared_death_from_above_legacy(uuid,text)'),
  to_regprocedure('public.resolve_declared_charge(uuid,text)'),
  to_regprocedure('public.resolve_declared_death_from_above(uuid,text)')
 ] LOOP
  IF fn IS NULL THEN CONTINUE;END IF;
  SELECT pg_get_functiondef(fn) INTO source;
  IF position('definition->>''mass''' IN source)=0 OR position('special_attack_catalogue_alias_v1' IN source)>0 THEN CONTINUE;END IF;
  patched:=replace(source,
   'SELECT (definition->>''mass'')::int INTO att_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=attacker->>''unitId'';',
   'SELECT (cu.definition->>''mass'')::int INTO att_mass FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=attacker->>''unitId''; /* special_attack_catalogue_alias_v1 */');
  patched:=replace(patched,
   'SELECT (definition->>''mass'')::int INTO tgt_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=target->>''unitId'';',
   'SELECT (cu.definition->>''mass'')::int INTO tgt_mass FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=target->>''unitId''; /* special_attack_catalogue_alias_v1 */');
  patched:=replace(patched,
   'SELECT (definition->>''mass'')::int INTO attacker_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=attacker->>''unitId'';',
   'SELECT (cu.definition->>''mass'')::int INTO attacker_mass FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=attacker->>''unitId''; /* special_attack_catalogue_alias_v1 */');
  patched:=replace(patched,
   'SELECT (definition->>''mass'')::int INTO target_mass FROM btech_catalogue_units WHERE catalogue_version=g.catalogue_version AND unit_id=target->>''unitId'';',
   'SELECT (cu.definition->>''mass'')::int INTO target_mass FROM btech_catalogue_units cu WHERE cu.catalogue_version=g.catalogue_version AND cu.unit_id=target->>''unitId''; /* special_attack_catalogue_alias_v1 */');
  IF patched=source OR position('special_attack_catalogue_alias_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely qualify a special-attack catalogue lookup';END IF;
  EXECUTE patched;
 END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
