-- Stable schema for generated MegaMek-derived content packs. Unit data is
-- loaded separately, so adding BattleMechs never requires handwritten schema
-- migrations. Matches retain their catalogue_version for reproducibility.

CREATE TABLE IF NOT EXISTS public.btech_catalogue_releases (
  version text PRIMARY KEY,
  source_repository text NOT NULL,
  source_revision text,
  content_sha256 text NOT NULL,
  attribution text NOT NULL,
  generated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.btech_catalogue_units (
  catalogue_version text NOT NULL REFERENCES public.btech_catalogue_releases(version) ON DELETE CASCADE,
  unit_id text NOT NULL,
  source_uuid text,
  definition jsonb NOT NULL,
  PRIMARY KEY (catalogue_version, unit_id)
);

CREATE TABLE IF NOT EXISTS public.btech_catalogue_mounts (
  catalogue_version text NOT NULL,
  unit_id text NOT NULL,
  mount_id text NOT NULL,
  weapon_key text,
  raw_name text NOT NULL,
  location text NOT NULL,
  definition jsonb NOT NULL,
  PRIMARY KEY (catalogue_version, unit_id, mount_id),
  FOREIGN KEY (catalogue_version, unit_id) REFERENCES public.btech_catalogue_units(catalogue_version, unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.btech_catalogue_critical_slots (
  catalogue_version text NOT NULL,
  unit_id text NOT NULL,
  location text NOT NULL,
  slot_index int NOT NULL CHECK (slot_index BETWEEN 0 AND 11),
  label text NOT NULL,
  PRIMARY KEY (catalogue_version, unit_id, location, slot_index),
  FOREIGN KEY (catalogue_version, unit_id) REFERENCES public.btech_catalogue_units(catalogue_version, unit_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.btech_catalogue_ammo_bins (
  catalogue_version text NOT NULL,
  unit_id text NOT NULL,
  bin_id text NOT NULL,
  ammo_type text,
  raw_name text NOT NULL,
  location text NOT NULL,
  shots int,
  PRIMARY KEY (catalogue_version, unit_id, bin_id),
  FOREIGN KEY (catalogue_version, unit_id) REFERENCES public.btech_catalogue_units(catalogue_version, unit_id) ON DELETE CASCADE
);

ALTER TABLE public.btech_games
  ADD COLUMN IF NOT EXISTS catalogue_version text REFERENCES public.btech_catalogue_releases(version);
CREATE INDEX IF NOT EXISTS idx_btech_games_catalogue_version ON public.btech_games(catalogue_version);

ALTER TABLE public.btech_catalogue_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_catalogue_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_catalogue_mounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_catalogue_critical_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btech_catalogue_ammo_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read catalogue releases" ON public.btech_catalogue_releases;
CREATE POLICY "Authenticated users can read catalogue releases" ON public.btech_catalogue_releases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read catalogue units" ON public.btech_catalogue_units;
CREATE POLICY "Authenticated users can read catalogue units" ON public.btech_catalogue_units FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read catalogue mounts" ON public.btech_catalogue_mounts;
CREATE POLICY "Authenticated users can read catalogue mounts" ON public.btech_catalogue_mounts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read catalogue critical slots" ON public.btech_catalogue_critical_slots;
CREATE POLICY "Authenticated users can read catalogue critical slots" ON public.btech_catalogue_critical_slots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read catalogue ammo bins" ON public.btech_catalogue_ammo_bins;
CREATE POLICY "Authenticated users can read catalogue ammo bins" ON public.btech_catalogue_ammo_bins FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.btech_catalogue_releases, public.btech_catalogue_units,
  public.btech_catalogue_mounts, public.btech_catalogue_critical_slots,
  public.btech_catalogue_ammo_bins TO authenticated;
