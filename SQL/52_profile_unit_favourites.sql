-- Persistent, exact-variant BattleMech favourites on the shared player profile.
-- Run after SQL/51. Unit ids remain catalogue-specific; a favourite that is
-- absent from the current match catalogue is simply not displayed.

ALTER TABLE public.profiles
 ADD COLUMN IF NOT EXISTS btech_favourite_units text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION public.set_btech_unit_favourite(p_unit_id text,p_favourite boolean)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE favourites text[];
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required';END IF;
 IF p_unit_id IS NULL OR length(p_unit_id)>120 OR NOT EXISTS (
  SELECT 1 FROM public.btech_catalogue_units unit WHERE unit.unit_id=p_unit_id
 ) THEN RAISE EXCEPTION 'Unknown BattleMech variant';END IF;
 UPDATE public.profiles profile SET btech_favourite_units=CASE
  WHEN p_favourite AND NOT p_unit_id=ANY(coalesce(profile.btech_favourite_units,ARRAY[]::text[]))
   THEN array_append(coalesce(profile.btech_favourite_units,ARRAY[]::text[]),p_unit_id)
  WHEN NOT p_favourite THEN array_remove(coalesce(profile.btech_favourite_units,ARRAY[]::text[]),p_unit_id)
  ELSE coalesce(profile.btech_favourite_units,ARRAY[]::text[]) END
 WHERE profile.id=auth.uid()
 RETURNING profile.btech_favourite_units INTO favourites;
 IF NOT FOUND THEN RAISE EXCEPTION 'Player profile was not found';END IF;
 IF cardinality(favourites)>100 THEN RAISE EXCEPTION 'A profile can store up to 100 favourite BattleMech variants';END IF;
 RETURN favourites;
END $$;
REVOKE ALL ON FUNCTION public.set_btech_unit_favourite(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_btech_unit_favourite(text,boolean) TO authenticated;

COMMENT ON COLUMN public.profiles.btech_favourite_units IS 'Exact BattleTech catalogue unit ids favourited by this profile.';
