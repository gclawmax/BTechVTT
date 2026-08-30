-- Run after every numbered catalogue part. Safe to rerun.
DO $$
DECLARE unit_count int;mount_count int;slot_count int;ammo_count int;
BEGIN
 SELECT count(*) INTO unit_count FROM public.btech_catalogue_units WHERE catalogue_version='megamek-2026-08-curated-05';
 SELECT count(*) INTO mount_count FROM public.btech_catalogue_mounts WHERE catalogue_version='megamek-2026-08-curated-05';
 SELECT count(*) INTO slot_count FROM public.btech_catalogue_critical_slots WHERE catalogue_version='megamek-2026-08-curated-05';
 SELECT count(*) INTO ammo_count FROM public.btech_catalogue_ammo_bins WHERE catalogue_version='megamek-2026-08-curated-05';
 IF unit_count<>75 OR mount_count<>370 OR slot_count<>3816 OR ammo_count<>166 THEN
  RAISE EXCEPTION 'Catalogue import incomplete: units %/75, mounts %/370, slots %/3816, ammo %/166',unit_count,mount_count,slot_count,ammo_count;
 END IF;
END $$;
