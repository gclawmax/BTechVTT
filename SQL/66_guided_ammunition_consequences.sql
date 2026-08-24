-- Complete the guided ammunition types present in the supported catalogue.
-- Narc-capable rounds were introduced by SQL/51; this adds Artemis IV and
-- preserves both forms in result logs. Run after SQL/65_lrm_indirect_fire.sql.

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('guided_ammunition_v1' IN source)>0 THEN RETURN;END IF;
 IF position('lrm_indirect_fire_v1' IN source)=0 THEN RAISE EXCEPTION 'Run SQL/65 before SQL/66';END IF;
 patched:=replace(source,
  'narc_guided boolean;ams_bin_id text;',
  'narc_guided boolean;artemis_guided boolean; /* guided_ammunition_v1 */ ams_bin_id text;');
 patched:=replace(patched,
  'narc_guided:=coalesce((target_start->''narcPod''->>''round'')::int,0)>0 AND EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=attacker_start->>''unitId'' AND bin.bin_id=ammo_bin_id AND bin.raw_name ILIKE ''%Narc-capable%'');',
  'narc_guided:=coalesce((target_start->''narcPod''->>''round'')::int,0)>0 AND EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=attacker_start->>''unitId'' AND bin.bin_id=ammo_bin_id AND bin.raw_name ILIKE ''%Narc-capable%'');artemis_guided:=EXISTS (SELECT 1 FROM btech_catalogue_ammo_bins bin WHERE bin.catalogue_version=p_catalogue_version AND bin.unit_id=attacker_start->>''unitId'' AND bin.bin_id=ammo_bin_id AND bin.raw_name ILIKE ''%Artemis-capable%'') AND EXISTS (SELECT 1 FROM btech_catalogue_critical_slots slot WHERE slot.catalogue_version=p_catalogue_version AND slot.unit_id=attacker_start->>''unitId'' AND btech_equipment_label_key(slot.label) IN (''artemisiv'',''artemisivfcs'') AND NOT btech_critical_slot_is_damaged(attacker_start,slot.location,slot.slot_index));');
 patched:=replace(patched,
  'CASE WHEN narc_guided THEN 2 ELSE 0 END+ams_modifier',
  'CASE WHEN narc_guided OR artemis_guided THEN 2 ELSE 0 END+ams_modifier');
 patched:=replace(patched,
  '''narc_guided'',narc_guided,''ams''',
  '''narc_guided'',narc_guided,''artemis_guided'',artemis_guided,''ams''');
 IF patched=source OR position('guided_ammunition_v1' IN patched)=0 OR position('artemis_guided' IN patched)=0 THEN RAISE EXCEPTION 'Could not safely install guided ammunition rules';END IF;
 EXECUTE patched;
END $$;
