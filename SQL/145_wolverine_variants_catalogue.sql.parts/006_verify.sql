-- Run after every numbered catalogue part. Safe to rerun.
DO $$
DECLARE unit_count int;mount_count int;slot_count int;ammo_count int;
BEGIN
 SELECT count(*) INTO unit_count FROM public.btech_catalogue_units WHERE catalogue_version='megamek-2026-09-wolverine-variants-01';
 SELECT count(*) INTO mount_count FROM public.btech_catalogue_mounts WHERE catalogue_version='megamek-2026-09-wolverine-variants-01';
 SELECT count(*) INTO slot_count FROM public.btech_catalogue_critical_slots WHERE catalogue_version='megamek-2026-09-wolverine-variants-01';
 SELECT count(*) INTO ammo_count FROM public.btech_catalogue_ammo_bins WHERE catalogue_version='megamek-2026-09-wolverine-variants-01';
 IF unit_count<>93 OR mount_count<>486 OR slot_count<>4952 OR ammo_count<>205 THEN
  RAISE EXCEPTION 'Catalogue import incomplete: units %/93, mounts %/486, slots %/4952, ammo %/205',unit_count,mount_count,slot_count,ammo_count;
 END IF;
END $$;
