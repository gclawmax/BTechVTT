-- SQL 74 used "allocation" both as a PL/pgSQL variable and as a row alias
-- while checking duplicate weapon mounts. Install an explicit resolver rather
-- than text-patching its stored definition, whose formatting can vary.

CREATE OR REPLACE FUNCTION public.btech_process_multi_target_declaration(
 p_catalogue_version text,p_round int,p_state jsonb,p_attacker_instance_id text,p_allocations jsonb,p_resolve boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE st jsonb:=p_state;target_allocation jsonb;checked jsonb;results jsonb:='[]'::jsonb;mounts text[];ammo jsonb;target_id text;primary_count int;
 attacker jsonb;attacker_start jsonb;target jsonb;direction int;facing_diff int;secondary_mod int;usage jsonb:='{}'::jsonb;mount_id text;bin_id text;shots_needed int;available int;
BEGIN
 IF jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Target allocations must be an array';END IF;
 SELECT value INTO attacker FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=p_attacker_instance_id;attacker_start:=attacker->'weaponPhaseStart'->'mech';
 IF jsonb_array_length(coalesce(p_allocations,'[]'::jsonb))=0 THEN RETURN btech_process_weapon_declaration(p_catalogue_version,p_round,st,p_attacker_instance_id,NULL,ARRAY[]::text[],'{}'::jsonb,p_resolve);END IF;
 SELECT count(*) INTO primary_count FROM jsonb_array_elements(p_allocations) value WHERE coalesce((value->>'primary')::boolean,false);
 IF primary_count<>1 THEN RAISE EXCEPTION 'Choose exactly one primary target';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_allocations))<>(SELECT count(DISTINCT value->>'target_instance_id') FROM jsonb_array_elements(p_allocations) value) THEN RAISE EXCEPTION 'Each target may appear only once';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) value WHERE jsonb_typeof(coalesce(value->'weapon_mounts','[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(value->'weapon_mounts','[]'::jsonb))=0) THEN RAISE EXCEPTION 'Each declared target must have at least one allocated weapon';END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) allocation_row CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(allocation_row->'weapon_mounts','[]'::jsonb)) mount GROUP BY mount HAVING count(*)>1) THEN RAISE EXCEPTION 'A weapon mount may be allocated only once';END IF;
 -- Reserve ammunition across every target before accepting the declaration.
 FOR target_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value LOOP
  FOR mount_id IN SELECT jsonb_array_elements_text(coalesce(target_allocation->'weapon_mounts','[]'::jsonb)) LOOP
   bin_id:=target_allocation->'ammo_bins'->>mount_id;IF bin_id IS NULL THEN CONTINUE;END IF;
   shots_needed:=CASE WHEN target_allocation->'ammo_bins'->'__fire_modes'->>mount_id='rapid' THEN 2 ELSE 1 END;
   usage:=jsonb_set(usage,ARRAY[bin_id],to_jsonb(coalesce((usage->>bin_id)::int,0)+shots_needed),true);
  END LOOP;
 END LOOP;
 FOR bin_id,shots_needed IN SELECT key,(value#>>'{}')::int FROM jsonb_each(usage) LOOP
  SELECT coalesce((value->>'shots')::int,0) INTO available FROM jsonb_array_elements(coalesce(attacker_start->'ammoBins','[]'::jsonb)) value WHERE value->>'id'=bin_id;
  IF coalesce(available,0)<shots_needed THEN RAISE EXCEPTION 'Ammunition bin % does not contain enough rounds for every allocated weapon',bin_id;END IF;
 END LOOP;
 -- If any declared target is in the torso-forward arc, Total Warfare requires
 -- one of those targets to be primary.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) target_row JOIN LATERAL jsonb_array_elements(st->'mech_instances') target_unit ON target_unit->>'instanceId'=target_row->>'target_instance_id'
   WHERE (btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_unit->>'col')::int,(target_unit->>'row')::int)-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6 IN (0,1,5))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) target_row JOIN LATERAL jsonb_array_elements(st->'mech_instances') target_unit ON target_unit->>'instanceId'=target_row->>'target_instance_id'
   WHERE coalesce((target_row->>'primary')::boolean,false) AND (btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target_unit->>'col')::int,(target_unit->>'row')::int)-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6 IN (0,1,5))
 THEN RAISE EXCEPTION 'A target in the forward arc must be the primary target';END IF;
 FOR target_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) value ORDER BY CASE WHEN coalesce((value->>'primary')::boolean,false) THEN 0 ELSE 1 END LOOP
  target_id:=target_allocation->>'target_instance_id';mounts:=ARRAY(SELECT jsonb_array_elements_text(coalesce(target_allocation->'weapon_mounts','[]'::jsonb)));ammo:=coalesce(target_allocation->'ammo_bins','{}'::jsonb);
  SELECT value INTO target FROM jsonb_array_elements(st->'mech_instances') value WHERE value->>'instanceId'=target_id;
  direction:=btech_direction_to((attacker_start->>'col')::int,(attacker_start->>'row')::int,(target->>'col')::int,(target->>'row')::int);facing_diff:=(direction-coalesce((attacker_start->>'torsoFacing')::int,(attacker_start->>'facing')::int)+6)%6;
  secondary_mod:=CASE WHEN coalesce((target_allocation->>'primary')::boolean,false) THEN 0 WHEN facing_diff IN (0,1,5) THEN 1 ELSE 2 END;ammo:=jsonb_set(ammo,'{__secondary_modifier}',to_jsonb(secondary_mod),true);
  checked:=btech_process_weapon_declaration(p_catalogue_version,p_round,st,p_attacker_instance_id,target_id,mounts,ammo,p_resolve);
  IF p_resolve THEN st:=checked->'state';results:=results||(SELECT coalesce(jsonb_agg(jsonb_set(value,'{target_instance_id}',to_jsonb(target_id),true)),'[]'::jsonb) FROM jsonb_array_elements(coalesce(checked->'results','[]'::jsonb)) value);END IF;
 END LOOP;
 RETURN jsonb_build_object('state',st,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.btech_process_multi_target_declaration(text,int,jsonb,text,jsonb,boolean) FROM PUBLIC;
