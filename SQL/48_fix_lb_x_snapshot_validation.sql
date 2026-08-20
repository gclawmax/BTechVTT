-- The LB-X loadout is immutable after Round 1. Validate the current persisted
-- bin, rather than an older weapon-phase eligibility snapshot.
-- Run once after SQL/47 on an existing deployment.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('lb_x_ammo_setup_v1' IN source)=0 THEN RAISE EXCEPTION 'Weapon declaration resolver is not at the expected LB-X revision';END IF;
 IF position('attacker->''ammoBins''' IN source)>0 THEN RETURN;END IF;
 IF position('attacker_start->''ammoBins''' IN source)=0 THEN RAISE EXCEPTION 'Weapon resolver did not contain the expected LB-X snapshot marker';END IF;
 patched:=replace(source,'attacker_start->''ammoBins''','attacker->''ammoBins''');
 IF patched=source OR position('attacker->''ammoBins''' IN patched)=0 THEN RAISE EXCEPTION 'Weapon resolver could not update LB-X ammunition validation';END IF;
 EXECUTE patched;
END $$;
