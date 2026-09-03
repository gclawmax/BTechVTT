-- SR-6b: catalogue-led Talons and Mechanical Jump Boosters.
-- Shields and AES are later-era Open/Experimental equipment; this migration
-- deliberately recognises their labels but does not silently grant a bonus
-- until their separately selectable defensive modes are implemented.

CREATE OR REPLACE FUNCTION public.btech_specialist_equipment_operational(p_catalogue_version text,p_mech jsonb,p_keys text[],p_location text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
   AND (p_location IS NULL OR slot.location=p_location)
   AND btech_equipment_label_key(slot.label)=ANY(p_keys)
 ) AND NOT EXISTS(
  SELECT 1 FROM btech_catalogue_critical_slots slot
  WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
   AND (p_location IS NULL OR slot.location=p_location)
   AND btech_equipment_label_key(slot.label)=ANY(p_keys)
   AND ((p_mech->'criticalSlotDamage'->slot.location) ? slot.slot_index::text OR coalesce((p_mech->'structure'->>slot.location)::int,0)<=0)
 )
$$;
REVOKE ALL ON FUNCTION public.btech_specialist_equipment_operational(text,jsonb,text[],text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_talon_operational(p_catalogue_version text,p_mech jsonb,p_leg text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT p_leg IN ('ll','rl')
  AND btech_specialist_equipment_operational(p_catalogue_version,p_mech,ARRAY['talons'],p_leg)
  AND NOT btech_physical_component_damaged(p_catalogue_version,p_mech,p_leg,'Foot Actuator')
$$;
REVOKE ALL ON FUNCTION public.btech_talon_operational(text,jsonb,text) FROM PUBLIC;

-- Later source migrations leave this stable marker in the physical resolver.
-- Talons apply only to the selected intact kicking leg.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_physical_declaration(uuid,text,integer,jsonb,text,text,text,text[],boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Physical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr6b_talon_kick_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'damage:=greatest(1,damage);IF p_attack_type NOT IN (''push'',''dfa'') AND coalesce((attacker_start->>''roundStartingHeat'')::int,(attacker_start->>''heat'')::int,0)>=9 AND btech_equipment_operational(p_catalogue_version,attacker_start,ARRAY[''triplestrengthmyomer'']) THEN damage:=damage*2;END IF; /* sr4_tsm_physical_v1 */',
  'damage:=greatest(1,damage);IF p_attack_type=''kick'' AND btech_talon_operational(p_catalogue_version,attacker_start,limb) THEN damage:=ceil(damage*1.5)::int;END IF; /* sr6b_talon_kick_v1 */ IF p_attack_type NOT IN (''push'',''dfa'') AND coalesce((attacker_start->>''roundStartingHeat'')::int,(attacker_start->>''heat'')::int,0)>=9 AND btech_equipment_operational(p_catalogue_version,attacker_start,ARRAY[''triplestrengthmyomer'']) THEN damage:=damage*2;END IF; /* sr4_tsm_physical_v1 */');
 IF patched=source OR position('sr6b_talon_kick_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install Talon kick damage';END IF;
 EXECUTE patched;
END $$;

-- Talons also increase successful DFA damage. Keep this isolated from the
-- DFA's separate self-damage and landing checks.
DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.resolve_declared_death_from_above(uuid,text)');
 IF fn IS NULL THEN RAISE EXCEPTION 'DFA resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('sr6b_talon_dfa_v1' IN source)>0 THEN RETURN;END IF;
 patched:=regexp_replace(source,
  $pattern$target_damage[[:space:]]*:=[[:space:]]*ceil[[:space:]]*[(][[:space:]]*attacker_mass[[:space:]]*[*][[:space:]]*3[[:space:]]*/[[:space:]]*10([.]0)?[[:space:]]*[)][[:space:]]*::int[[:space:]]*;[[:space:]]*remaining[[:space:]]*:=[[:space:]]*target_damage[[:space:]]*;$pattern$,
  $replacement$target_damage:=ceil(attacker_mass*3/10.0)::int;IF btech_talon_operational(g.catalogue_version,attacker,'ll') OR btech_talon_operational(g.catalogue_version,attacker,'rl') THEN target_damage:=ceil(target_damage*1.5)::int;END IF; /* sr6b_talon_dfa_v1 */ remaining:=target_damage;$replacement$);
 IF patched=source OR position('sr6b_talon_dfa_v1' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install Talon DFA damage';END IF;
 EXECUTE patched;
END $$;

NOTIFY pgrst,'reload schema';
