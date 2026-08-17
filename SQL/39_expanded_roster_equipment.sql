-- Rules support required by the curated roster in SQL/38.
-- Run after SQL/38_curated_3030_3050_roster.sql.

CREATE OR REPLACE FUNCTION public.btech_cluster_hits(p_size int,p_roll int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF p_roll<2 OR p_roll>12 THEN RAISE EXCEPTION 'Cluster roll must be between 2 and 12';END IF;
 RETURN CASE p_size
  WHEN 2 THEN (ARRAY[1,1,1,1,1,1,1,1,2,2,2])[p_roll-1]
  WHEN 4 THEN (ARRAY[1,2,2,2,2,3,3,3,3,4,4])[p_roll-1]
  WHEN 5 THEN (ARRAY[1,2,2,3,3,3,3,4,4,5,5])[p_roll-1]
  WHEN 6 THEN (ARRAY[2,2,3,3,4,4,4,5,5,6,6])[p_roll-1]
  WHEN 10 THEN (ARRAY[3,3,4,6,6,6,6,8,8,10,10])[p_roll-1]
  WHEN 15 THEN (ARRAY[5,5,6,9,9,9,9,12,12,15,15])[p_roll-1]
  WHEN 20 THEN (ARRAY[6,6,9,12,12,12,12,16,16,20,20])[p_roll-1]
  ELSE NULL END;
END $$;

DO $$
DECLARE fn regprocedure;source text;patched text;
BEGIN
 fn:=to_regprocedure('public.btech_resolve_critical_slots(jsonb,text,integer)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Authoritative critical resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('''lb10x''' IN source)>0 THEN RETURN;END IF;
 patched:=replace(source,
  E'WHEN slot_label ILIKE ''%Ammo AC/5%'' THEN ''ac5'' WHEN slot_label ILIKE ''%Ammo LRM-20%'' THEN ''lrm20''',
  E'WHEN slot_label ILIKE ''%Ammo Ultra AC/5%'' THEN ''uac5'' WHEN slot_label ILIKE ''%Ammo LB 10-X%'' THEN ''lb10x'' WHEN slot_label ILIKE ''%Ammo AC/5%'' THEN ''ac5'' WHEN slot_label ILIKE ''%Ammo AC/2%'' THEN ''ac2'' WHEN slot_label ILIKE ''%Ammo LRM-20%'' THEN ''lrm20''');
 patched:=replace(patched,
  E'WHEN slot_label ILIKE ''%Ammo LRM-10%'' THEN ''lrm10'' WHEN slot_label ILIKE ''%Ammo SRM-6%'' THEN ''srm6''',
  E'WHEN slot_label ILIKE ''%Ammo LRM-15%'' THEN ''lrm15'' WHEN slot_label ILIKE ''%Ammo LRM-10%'' THEN ''lrm10'' WHEN slot_label ILIKE ''%Ammo LRM-5%'' THEN ''lrm5'' WHEN slot_label ILIKE ''%Ammo SRM-6%'' THEN ''srm6'' WHEN slot_label ILIKE ''%Ammo SRM-4%'' THEN ''srm4'' WHEN slot_label ILIKE ''%Ammo SRM-2%'' THEN ''srm2''');
 patched:=replace(patched,
  E'WHEN ''ac5'' THEN 5 WHEN ''lrm20'' THEN 20 WHEN ''lrm10'' THEN 10 WHEN ''srm6'' THEN 12 WHEN ''machine_gun'' THEN 2',
  E'WHEN ''ac5'' THEN 5 WHEN ''ac2'' THEN 2 WHEN ''uac5'' THEN 5 WHEN ''lb10x'' THEN 10 WHEN ''lrm20'' THEN 20 WHEN ''lrm15'' THEN 15 WHEN ''lrm10'' THEN 10 WHEN ''lrm5'' THEN 5 WHEN ''srm6'' THEN 12 WHEN ''srm4'' THEN 8 WHEN ''srm2'' THEN 4 WHEN ''machine_gun'' THEN 2');
 IF patched=source OR position('''lrm15''' IN patched)=0 OR position('''srm4''' IN patched)=0 THEN RAISE EXCEPTION 'Critical resolver equipment markers were not found';END IF;
 EXECUTE patched;

 fn:=to_regprocedure('public.btech_process_weapon_declaration(text,integer,jsonb,text,text,text[],jsonb,boolean)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Weapon declaration resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('WHEN ''ac2'' THEN ''Autocannon/2''' IN source)=0 THEN
  patched:=replace(source,E'WHEN ''ac5'' THEN ''Autocannon/5'' ELSE weapon_name END',E'WHEN ''ac5'' THEN ''Autocannon/5'' WHEN ''ac2'' THEN ''Autocannon/2'' ELSE weapon_name END');
  IF patched=source THEN RAISE EXCEPTION 'Weapon critical-label marker was not found';END IF;
  EXECUTE patched;
 END IF;

 fn:=to_regprocedure('public.resolve_heat_management(uuid)');
 IF fn IS NULL THEN RAISE EXCEPTION 'Authoritative heat resolver is missing';END IF;
 SELECT pg_get_functiondef(fn) INTO source;
 IF position('heat_sink_capacity' IN source)=0 THEN
  patched:=replace(source,E'CASE WHEN slot.label=''Double Heat Sink'' THEN 2 ELSE 1 END',E'CASE WHEN slot.label ILIKE ''%Double Heat Sink%'' THEN 2 ELSE 1 END');
  patched:=replace(patched,E'slot.label IN (''Heat Sink'',''Double Heat Sink'')',E'(slot.label=''Heat Sink'' OR slot.label ILIKE ''%Double Heat Sink%'')');
  patched:=replace(patched,E'coalesce((definition->>''heat_sinks'')::int,0)-heat_sink_loss',E'coalesce((definition->>''heat_sink_capacity'')::int,(definition->>''heat_sinks'')::int,0)-heat_sink_loss');
  patched:=replace(patched,
   E'WHEN ''ac5'' THEN 5 WHEN ''ac2'' THEN 2 WHEN ''lrm20'' THEN 20 WHEN ''lrm10'' THEN 10 WHEN ''srm6'' THEN 12 WHEN ''machine_gun'' THEN 2 ELSE 0 END',
   E'WHEN ''ac5'' THEN 5 WHEN ''ac2'' THEN 2 WHEN ''uac5'' THEN 5 WHEN ''lb10x'' THEN 10 WHEN ''lrm20'' THEN 20 WHEN ''lrm15'' THEN 15 WHEN ''lrm10'' THEN 10 WHEN ''lrm5'' THEN 5 WHEN ''srm6'' THEN 12 WHEN ''srm4'' THEN 8 WHEN ''srm2'' THEN 4 WHEN ''machine_gun'' THEN 2 ELSE 0 END');
  IF patched=source OR position('heat_sink_capacity' IN patched)=0 THEN RAISE EXCEPTION 'Heat resolver equipment markers were not found';END IF;
  EXECUTE patched;
 END IF;
END $$;
