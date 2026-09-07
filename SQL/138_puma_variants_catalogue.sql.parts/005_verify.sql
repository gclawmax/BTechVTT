-- Run after every numbered catalogue part. Safe to rerun.
DO $$
DECLARE unit_count int;mount_count int;slot_count int;ammo_count int;
BEGIN
 SELECT count(*) INTO unit_count FROM public.btech_catalogue_units WHERE catalogue_version='megamek-2026-09-puma-variants-01';
 SELECT count(*) INTO mount_count FROM public.btech_catalogue_mounts WHERE catalogue_version='megamek-2026-09-puma-variants-01';
 SELECT count(*) INTO slot_count FROM public.btech_catalogue_critical_slots WHERE catalogue_version='megamek-2026-09-puma-variants-01';
 SELECT count(*) INTO ammo_count FROM public.btech_catalogue_ammo_bins WHERE catalogue_version='megamek-2026-09-puma-variants-01';
 IF unit_count<>88 OR mount_count<>464 OR slot_count<>4675 OR ammo_count<>197 THEN
  RAISE EXCEPTION 'Catalogue import incomplete: units %/88, mounts %/464, slots %/4675, ammo %/197',unit_count,mount_count,slot_count,ammo_count;
 END IF;
END $$;
