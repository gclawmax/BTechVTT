-- Correct the authoritative heat ledger.  The maintained weapon resolver
-- previously added heat_added once into weaponHeat and again into heat.
-- Heat resolution now independently derives the pre-sink level from the
-- round ledger, repairing any affected in-progress match on its next Heat
-- Management activation.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('heat_ledger_no_double_weapon_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'attacker:=jsonb_set(attacker,''{heat}'',to_jsonb(coalesce((attacker->>''roundStartingHeat'')::int,0)+coalesce((attacker->>''movementHeat'')::int,0)+coalesce((attacker->>''weaponHeat'')::int,0)+coalesce((attacker->>''externalHeat'')::int,0)+heat_added),true);',
  'attacker:=jsonb_set(attacker,''{heat}'',to_jsonb(coalesce((attacker->>''roundStartingHeat'')::int,0)+coalesce((attacker->>''movementHeat'')::int,0)+coalesce((attacker->>''weaponHeat'')::int,0)+coalesce((attacker->>''externalHeat'')::int,0)),true); /* heat_ledger_no_double_weapon_v1 */');
 IF patched=source THEN
  patched:=replace(source,
   'attacker:=jsonb_set(attacker,''{heat}'',to_jsonb(coalesce((attacker->>''roundStartingHeat'')::int,0)+coalesce((attacker->>''movementHeat'')::int,0)+coalesce((attacker->>''weaponHeat'')::int,0)+heat_added),true);',
   'attacker:=jsonb_set(attacker,''{heat}'',to_jsonb(coalesce((attacker->>''roundStartingHeat'')::int,0)+coalesce((attacker->>''movementHeat'')::int,0)+coalesce((attacker->>''weaponHeat'')::int,0)),true); /* heat_ledger_no_double_weapon_v1 */');
 END IF;
 IF patched=source OR position('heat_ledger_no_double_weapon_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely remove duplicated weapon heat';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;ledger text:=
 'before_heat:=coalesce((mech->>''roundStartingHeat'')::int,0)+coalesce((mech->>''movementHeat'')::int,0)+coalesce((mech->>''weaponHeat'')::int,0)+coalesce((mech->>''externalHeat'')::int,0)+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0); /* heat_ledger_recomputed_v1 */';
BEGIN
 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Heat Management resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('heat_ledger_recomputed_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0); /* weathered_heat_v1 */',ledger);
 IF patched=source THEN
  patched:=replace(source,'before_heat:=coalesce((mech->>''heat'')::int,0)+(engine_hits*5);',ledger);
 END IF;
 IF patched=source OR position('heat_ledger_recomputed_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely make Heat Management ledger-authoritative';END IF;
 EXECUTE patched;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.declare_shutdown_override(uuid,text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Shutdown override resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('heat_ledger_override_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'after_heat:=greatest(0,coalesce((mech->>''heat'')::int,0)+(engine_hits*5)-coalesce(sinks,0));',
  'after_heat:=greatest(0,coalesce((mech->>''roundStartingHeat'')::int,0)+coalesce((mech->>''movementHeat'')::int,0)+coalesce((mech->>''weaponHeat'')::int,0)+coalesce((mech->>''externalHeat'')::int,0)+(engine_hits*5)+coalesce((mech->>''pendingTerrainHeat'')::int,0)-coalesce(sinks,0)); /* heat_ledger_override_v1 */');
 IF patched=source OR position('heat_ledger_override_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely correct shutdown override heat';END IF;
 EXECUTE patched;
END $$;

NOTIFY pgrst,'reload schema';
