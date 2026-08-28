-- Run after every numbered catalogue part. Safe to rerun.
DO $$
DECLARE unit_count int;mount_count int;slot_count int;ammo_count int;
BEGIN
 SELECT count(*) INTO unit_count FROM public.btech_catalogue_units WHERE catalogue_version='megamek-2026-08-curated-04';
 SELECT count(*) INTO mount_count FROM public.btech_catalogue_mounts WHERE catalogue_version='megamek-2026-08-curated-04';
 SELECT count(*) INTO slot_count FROM public.btech_catalogue_critical_slots WHERE catalogue_version='megamek-2026-08-curated-04';
 SELECT count(*) INTO ammo_count FROM public.btech_catalogue_ammo_bins WHERE catalogue_version='megamek-2026-08-curated-04';
 IF unit_count<>72 OR mount_count<>356 OR slot_count<>3624 OR ammo_count<>159 THEN
  RAISE EXCEPTION 'Catalogue import incomplete: units %/72, mounts %/356, slots %/3624, ammo %/159',unit_count,mount_count,slot_count,ammo_count;
 END IF;
END $$;
