-- Electronic warfare and targeting support for the catalogue equipment already
-- present in the live release. Run after SQL/76.
--
-- Scope: Guardian/Clan ECM suppresses Artemis IV and Narc guidance at the
-- protected target hex. TAG enables semi-guided LRM ammunition. Beagle Active
-- Probes are recorded and shown by the client; their normal role is detecting
-- hidden units, which this VTT does not yet model. Standard Beagle probes are
-- deliberately not disabled by ordinary ECM, matching MegaMek/TW behaviour.

CREATE OR REPLACE FUNCTION public.btech_equipment_operational(p_catalogue_version text,p_mech jsonb,p_keys text[])
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE found_slots int;damaged_slots int;
BEGIN
 SELECT count(*),count(*) FILTER (WHERE btech_critical_slot_is_damaged(p_mech,slot.location,slot.slot_index))
 INTO found_slots,damaged_slots
 FROM btech_catalogue_critical_slots slot
 WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=p_mech->>'unitId'
  AND btech_equipment_label_key(slot.label)=ANY(p_keys);
 RETURN coalesce((p_mech->>'destroyed')::boolean,false)=false AND found_slots>0 AND damaged_slots=0;
END $$;
REVOKE ALL ON FUNCTION public.btech_equipment_operational(text,jsonb,text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_target_guidance_ecm(p_catalogue_version text,p_state jsonb,p_attacker jsonb,p_target jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (
  SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'mech_instances','[]'::jsonb)) emitter
  WHERE NOT coalesce((emitter->>'destroyed')::boolean,false)
   AND (emitter->>'owner')::int<>(p_attacker->>'owner')::int
   AND btech_hex_distance((emitter->>'col')::int,(emitter->>'row')::int,(p_target->>'col')::int,(p_target->>'row')::int)<=6
   AND btech_equipment_operational(p_catalogue_version,emitter,ARRAY['guardianecmsuite','clanecmsuite'])
 )
$$;
REVOKE ALL ON FUNCTION public.btech_target_guidance_ecm(text,jsonb,jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.btech_special_ammo_load_types(p_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
  WHEN p_type='lb10x' THEN ARRAY['slug','cluster']::text[]
  WHEN p_type IN ('srm2','srm4','srm6') THEN ARRAY['standard','inferno']::text[]
  WHEN p_type IN ('ac2','ac5','ac10','ac20') THEN ARRAY['standard','precision']::text[]
  WHEN p_type IN ('lrm5','lrm10','lrm15','lrm20') THEN ARRAY['standard','semi_guided']::text[]
  ELSE ARRAY[]::text[] END
$$;
REVOKE ALL ON FUNCTION public.btech_special_ammo_load_types(text) FROM PUBLIC;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing; run SQL/51 through SQL/76 first';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('electronic_warfare_targeting_v1' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  'narc_guided boolean;artemis_guided boolean; /* guided_ammunition_v1 */ ams_bin_id text;',
  'narc_guided boolean;artemis_guided boolean;ecm_guidance boolean:=false;tag_guided boolean:=false; /* guided_ammunition_v1 */ ams_bin_id text; /* electronic_warfare_targeting_v1 */');
 patched:=replace(patched,
  'target_direction:=btech_direction_to((target_start->>''col'')::int,(target_start->>''row'')::int,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int);target_diff:=(target_direction-(target_start->>''facing'')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN ''front'' WHEN target_diff=1 THEN ''side-right'' WHEN target_diff=5 THEN ''side-left'' ELSE ''rear'' END;',
  'target_direction:=btech_direction_to((target_start->>''col'')::int,(target_start->>''row'')::int,(attacker_start->>''col'')::int,(attacker_start->>''row'')::int);target_diff:=(target_direction-(target_start->>''facing'')::int+6)%6;angle:=CASE WHEN target_diff=0 THEN ''front'' WHEN target_diff=1 THEN ''side-right'' WHEN target_diff=5 THEN ''side-left'' ELSE ''rear'' END;ecm_guidance:=btech_target_guidance_ecm(p_catalogue_version,st,attacker_start,target_start);tag_guided:=coalesce((target_start->>''taggedRound'')::int,0)=p_round;');
 patched:=replace(patched,
  'IF ammo_load_type=''precision'' AND selected_weapon_key NOT IN (''ac2'',''ac5'',''ac10'',''ac20'') THEN RAISE EXCEPTION ''Precision ammunition requires a standard autocannon'';END IF;IF ammo_load_type=''inferno'' THEN damage_per_missile:=0;END IF;',
  'IF ammo_load_type=''precision'' AND selected_weapon_key NOT IN (''ac2'',''ac5'',''ac10'',''ac20'') THEN RAISE EXCEPTION ''Precision ammunition requires a standard autocannon'';END IF;IF ammo_load_type=''semi_guided'' AND selected_weapon_key NOT LIKE ''lrm%'' THEN RAISE EXCEPTION ''Semi-guided ammunition requires an LRM launcher'';END IF;IF ammo_load_type=''inferno'' THEN damage_per_missile:=0;END IF;');
 patched:=replace(patched,
  'special_ammo_mod:=CASE WHEN ammo_load_type=''precision'' THEN -least(2,target_mod) ELSE 0 END;tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod;',
  'special_ammo_mod:=CASE WHEN ammo_load_type=''precision'' THEN -least(2,target_mod) WHEN ammo_load_type=''semi_guided'' AND tag_guided THEN CASE WHEN coalesce((p_ammo_bins->>''__indirect'')::boolean,false) THEN -1 ELSE -least(2,woods) END ELSE 0 END;tn:=base_tn+range_mod+component_mod+accuracy_mod+special_ammo_mod;');
 patched:=replace(patched,
  'SELECT bin->>''id'' INTO ams_bin_id',
  'narc_guided:=narc_guided AND NOT ecm_guidance;artemis_guided:=artemis_guided AND NOT ecm_guidance;SELECT bin->>''id'' INTO ams_bin_id');
 patched:=replace(patched,
  '''narc_guided'',narc_guided,''artemis_guided'',artemis_guided,''ams''',
  '''narc_guided'',narc_guided,''artemis_guided'',artemis_guided,''tag_guided'',tag_guided,''ecm_guidance'',ecm_guidance,''ams''');
 IF patched=source OR position('electronic_warfare_targeting_v1' IN patched)=0 OR position('btech_target_guidance_ecm' IN patched)=0 OR position('ammo_load_type=''semi_guided''' IN patched)=0 OR position('tag_guided'',tag_guided' IN patched)=0 THEN
  RAISE EXCEPTION 'Could not safely install every required electronic-warfare targeting rule';
 END IF;
 EXECUTE patched;
END $$;
